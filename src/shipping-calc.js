// Issue #84 — cálculo de frete por CEP no site: núcleo testável (a rede é injetável; o teste não usa rede nem banco).
// Regra principal: o valor vem da cotação da loja. Sem cotação confirmada o frete é DESCONHECIDO
// (shippingKnown:false, sem preço de frete e sem total), nunca R$ 0,00 e nunca estimado.
//
// Segurança (por que o cliente não escolhe o destino):
// • o cliente manda só { offerId, cep, quantity }. Loja (base), item e vendedor vêm do SERVIDOR (resolveOffer);
//   base/itemId/sellerId vindos do cliente são ignorados (senão o endpoint viraria proxy para qualquer URL — SSRF);
// • a cotação sai por request() de src/http.js (UA honesto, timeout, fila por host) depois de assertSafeUrl e do robots.txt;
// • 429 (ou bloqueio) de uma loja → cooldown POR LOJA: nenhuma chamada a ela até vencer (desenho da #188: não insistir).
//
// Endpoint DESLIGADO por padrão: createShippingCalcHandler só responde com SHIPPING_CALC_ENABLED=1 e ainda não está
// registrado em nenhuma rota (api/ ou src/server.js). Ligar depende de decisão do usuário (lojas e limites — ver docs).
import { request } from './http.js';
import { assertSafeUrl } from './urlguard.js';
import { guard } from './adapters/common.js';
import { byComparableTotal } from '../api/_lib/offer-rank.mjs';

// Cache: cotação OK vale 5 min (QUOTE_TTL_MS) para a MESMA chave loja+item+vendedor+quantidade+CEP. Passou disso é
// "expirada" e é refeita. Falha, timeout, indisponível e cooldown NÃO são cacheados como cotação.
export const QUOTE_TTL_MS = 5 * 60_000;
// Rate limit: por cliente (IP) 10 consultas novas/min; por chave 3 consultas novas/min (repetição da mesma consulta
// que falhou não martela a loja). Cache hit não consome limite.
export const RATE_LIMIT = { max: 10, windowMs: 60_000 };
export const KEY_RATE_LIMIT = { max: 3, windowMs: 60_000 };
// Cooldown por loja depois de 429/bloqueio: no mínimo 30 min (mesmo piso da curva de run.js para 429); um Retry-After
// maior é respeitado, até 6 h. Durante o cooldown a loja não é chamada.
export const COOLDOWN = { minMs: 30 * 60_000, maxMs: 6 * 3600_000 };
export const STATUS = Object.freeze({ OK: 'ok', UNAVAILABLE: 'unavailable', ERROR: 'error', TIMEOUT: 'timeout', INVALID_CEP: 'invalid_cep', RATE_LIMITED: 'rate_limited', COOLDOWN: 'store_cooldown' });
export const NOT_AVAILABLE_TEXT = 'Frete não disponível para cálculo no site';
export const ENABLE_FLAG = 'SHIPPING_CALC_ENABLED';

// CEP válido: 8 dígitos (aceita 12345-678 e espaços nas pontas), normalizado para "12345678".
// Rejeita: formato errado, faixa inexistente (o menor CEP do Brasil é 01000-000, então "00…" não existe) e
// sequências de um só dígito (11111-111, 99999-999…), que são CEPs de preenchimento, não endereços.
export function normalizeCep(input) {
  if (typeof input !== 'string' && typeof input !== 'number') return null;
  const s = String(input).trim();
  if (!/^\d{5}-?\d{3}$/.test(s)) return null;
  const d = s.replace('-', '');
  if (d.startsWith('00') || /^(\d)\1{7}$/.test(d)) return null;
  return d;
}

export const quantityOf = (q) => { const n = Number(q); return Number.isInteger(n) && n >= 1 && n <= 99 ? n : null; };

// A chave inclui TUDO que muda a cotação: loja, produto/variante (itemId), vendedor, quantidade e CEP.
export function quoteKey({ base, itemId, sellerId, quantity, cep }) {
  return [base, itemId, sellerId, quantity, cep].map((v) => encodeURIComponent(String(v ?? ''))).join('|');
}

// "3bd" = 3 dias úteis; "2d" = 2 dias corridos; "4h"/"90m" = horas/minutos. Formato desconhecido = sem prazo (null), não chute.
export function parseEstimate(s) {
  const m = /^(\d{1,3})(bd|d|h|m)$/i.exec(String(s ?? '').trim());
  if (!m) return null;
  const unit = { bd: 'business_days', d: 'days', h: 'hours', m: 'minutes' }[m[2].toLowerCase()];
  return { value: Number(m[1]), unit };
}

// Resposta de orderForms/simulation da VTEX -> opções exatamente como a loja devolveu (preço em centavos -> reais).
// Sem opção legível = indisponível (com motivo), nunca frete zero.
export function parseVtexSimulation(json) {
  const slas = json?.logisticsInfo?.[0]?.slas;
  if (!Array.isArray(slas) || !slas.length) return { status: STATUS.UNAVAILABLE, reason: 'a loja não oferece entrega para este CEP', options: [] };
  const options = [];
  for (const s of slas) {
    if (!s || typeof s.price !== 'number' || !Number.isFinite(s.price) || s.price < 0) continue;
    const method = typeof s.name === 'string' && s.name.trim() ? s.name.trim().slice(0, 80) : (typeof s.id === 'string' ? s.id.slice(0, 80) : null);
    if (!method) continue;
    const price = Math.round(s.price) / 100;
    options.push({ method, price, free: price === 0, estimate: parseEstimate(s.shippingEstimate) });
  }
  if (!options.length) return { status: STATUS.UNAVAILABLE, reason: 'cotação da loja sem preço legível', options: [] };
  return { status: STATUS.OK, options };
}

export const cheapest = (options) => (options?.length ? options.reduce((a, b) => (b.price < a.price ? b : a)) : null);
// Modalidade usada no total: a escolhida pela pessoa (se existir na cotação); sem escolha, a mais barata.
// Modalidade pedida que a loja não devolveu = sem total (não troca por outra em silêncio).
const pickOption = (quote, method) => (method == null ? cheapest(quote?.options) : quote?.options?.find((o) => o.method === method) || null);

// Total item + frete só com frete CONFIRMADO. Retorna null (não comparável) para qualquer outro caso.
export function totalWithShipping(itemPrice, quote, quantity = 1, method = null) {
  const q = quantityOf(quantity);
  if (!q || typeof itemPrice !== 'number' || !Number.isFinite(itemPrice) || itemPrice <= 0) return null;
  if (quote?.status !== STATUS.OK) return null;
  const opt = pickOption(quote, method);
  return opt ? Math.round((itemPrice * q + opt.price) * 100) / 100 : null;
}

// Oferta (contrato de api/_lib: price, shipping, shippingKnown, total) atualizada com a cotação recebida.
// Frete confirmado: shipping = preço da modalidade, total = preço × quantidade + frete.
// Qualquer outro caso: shippingKnown:false e shipping:null; o total da oferta continua o da oferta (preço sem frete,
// "Preço antes do frete"), exatamente como a main já trata frete desconhecido. Nunca soma R$ 0,00 de frete inventado.
export function applyQuote(offer, quote, { quantity = 1, method = null } = {}) {
  const total = totalWithShipping(offer?.price, quote, quantity, method);
  if (total == null) return { ...offer, shipping: null, shippingKnown: false, shippingMethod: null };
  const opt = pickOption(quote, method);
  return { ...offer, shipping: opt.price, shippingKnown: true, shippingMethod: opt.method, total };
}

// Ordenação por "menor total": SEMPRE a regra única do servidor (api/_lib/offer-rank.mjs, byComparableTotal).
// Não há regra própria aqui (a antiga sortByTotal foi removida por divergir dela).
export const rankByComparableTotal = (rows) => [...(rows || [])].sort(byComparableTotal);

// Cotação real na VTEX (orderForms/simulation), pelo cliente HTTP da main. `target` vem do servidor (resolveOffer).
// assertSafeUrl na base e na URL final (request() repete a guarda a cada redirecionamento) e robots.txt (guard).
export async function vtexFetchQuote({ base, itemId, sellerId, quantity, cep }, { timeout = 8000, robots = guard } = {}) {
  const origin = assertSafeUrl(base).origin;
  const url = assertSafeUrl(`${origin}/api/checkout/pub/orderForms/simulation?sc=1`).href;
  await robots(url);
  const r = await request(url, { method: 'POST', accept: 'application/json', timeout, headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ items: [{ id: String(itemId), quantity, seller: String(sellerId ?? '1') }], postalCode: cep, country: 'BRA' }) });
  return r.json();
}

const hostOf = (base) => { try { return new URL(base).host; } catch { return null; } };
const fail = (status, reason, extra) => ({ status, reason, options: [], shippingKnown: false, total: null, ...extra });

// Serviço: valida entrada, limita abuso, respeita cooldown por loja, reaproveita cotação curta (só da MESMA chave)
// e registra origem/horário. fetchQuote(target) -> json da loja; pode lançar (timeout/erro/429). Injetado nos testes.
export function createQuoteService({ fetchQuote = vtexFetchQuote, now = Date.now, ttlMs = QUOTE_TTL_MS, rate = RATE_LIMIT, keyRate = KEY_RATE_LIMIT, cooldown = COOLDOWN, maxCache = 500, onAudit = () => {} } = {}) {
  const cache = new Map(); const hits = new Map(); const keyHits = new Map(); const cooldowns = new Map();

  const limited = (map, id, lim) => {
    const t = now(); const arr = (map.get(id) || []).filter((x) => t - x < lim.windowMs);
    if (arr.length >= lim.max) { map.set(id, arr); return true; }
    arr.push(t); map.set(id, arr);
    if (map.size > 5000) for (const [k, v] of map) if (!v.some((x) => t - x < lim.windowMs)) map.delete(k);
    return false;
  };

  // target: { base, itemId, sellerId } resolvido no servidor. req: { cep, quantity } do cliente.
  async function quote(target, req, { client = 'anon' } = {}) {
    const cep = normalizeCep(req?.cep); const quantity = quantityOf(req?.quantity ?? 1);
    if (!cep) return fail(STATUS.INVALID_CEP, 'CEP inválido: informe 8 dígitos');
    if (!quantity) return fail(STATUS.ERROR, 'quantidade inválida');
    const host = target?.base ? hostOf(target.base) : null;
    if (!host || !target.itemId) return fail(STATUS.UNAVAILABLE, NOT_AVAILABLE_TEXT);
    const t = now();
    const key = quoteKey({ base: target.base, itemId: target.itemId, sellerId: target.sellerId, quantity, cep });
    const hit = cache.get(key);
    if (hit && t < hit.expiresAt) return { ...hit.value, cached: true };
    const cd = cooldowns.get(host);
    if (cd && t < cd) return fail(STATUS.COOLDOWN, 'a loja pediu para esperar: cotação suspensa até o horário indicado', { retryAt: new Date(cd).toISOString() });
    if (limited(hits, client, rate) || limited(keyHits, key, keyRate)) return fail(STATUS.RATE_LIMITED, 'muitas consultas: tente novamente em instantes');
    let parsed;
    try { parsed = parseVtexSimulation(await fetchQuote({ base: target.base, itemId: target.itemId, sellerId: target.sellerId, quantity, cep })); }
    catch (e) {
      if (e?.blocked) {
        // 429/bloqueio: não insiste. Retry-After (s) respeitado, com piso e teto; a loja fica fora até vencer.
        const asked = Number.isFinite(e.retryAfter) && e.retryAfter > 0 ? e.retryAfter * 1000 : 0;
        const until = t + Math.min(cooldown.maxMs, Math.max(cooldown.minMs, asked));
        cooldowns.set(host, until);
        parsed = fail(STATUS.COOLDOWN, 'a loja limitou as consultas: cotação suspensa', { retryAt: new Date(until).toISOString() });
      } else {
        const timedOut = e?.code === 'TIMEOUT' || e?.name === 'AbortError' || /timeout|timed out/i.test(String(e?.message));
        parsed = fail(timedOut ? STATUS.TIMEOUT : STATUS.ERROR, 'a loja não respondeu à cotação');
      }
    }
    const ok = parsed.status === STATUS.OK;
    const value = { ...parsed, shippingKnown: ok, total: null, source: 'vtex_simulation', quotedAt: new Date(t).toISOString(), expiresAt: ok ? new Date(t + ttlMs).toISOString() : null, cached: false };
    // Auditoria sem o CEP completo: só o prefixo de 3 dígitos.
    onAudit({ source: value.source, status: value.status, quotedAt: value.quotedAt, store: host, itemId: target.itemId, cepPrefix: cep.slice(0, 3) });
    if (ok) {   // falha não é cacheada: a próxima tentativa (respeitando limite e cooldown) consulta de novo
      if (cache.size >= maxCache) cache.delete(cache.keys().next().value);
      cache.set(key, { value, expiresAt: t + ttlMs });
    }
    return value;
  }

  return { quote, _cache: cache, _cooldowns: cooldowns };
}

// Handler do endpoint (ainda não registrado em rota). Desligado por padrão: sem SHIPPING_CALC_ENABLED=1 responde 404
// sem consultar nada. Do cliente só lê offerId, cep e quantity; a loja/item/vendedor vêm de resolveOffer (servidor).
// resolveOffer(offerId) -> { base, itemId, sellerId } | null (null = loja sem integração autorizada).
export function createShippingCalcHandler({ resolveOffer, service = createQuoteService(), enabled = process.env[ENABLE_FLAG] === '1' } = {}) {
  return async function handle(query = {}, { ip = 'anon' } = {}) {
    if (!enabled) return { status: 404, body: { error: 'cálculo de frete por CEP desligado' } };
    const offerId = typeof query.offerId === 'string' ? query.offerId.slice(0, 200) : '';
    if (!offerId) return { status: 400, body: { error: 'offerId obrigatório' } };
    const target = typeof resolveOffer === 'function' ? await resolveOffer(offerId) : null;
    if (!target) return { status: 200, body: fail(STATUS.UNAVAILABLE, NOT_AVAILABLE_TEXT) };
    const r = await service.quote({ base: target.base, itemId: target.itemId, sellerId: target.sellerId }, { cep: query.cep, quantity: query.quantity }, { client: String(ip) });
    const code = r.status === STATUS.INVALID_CEP ? 400 : r.status === STATUS.RATE_LIMITED ? 429 : 200;
    return { status: code, body: r };
  };
}

// Estado de exibição de uma cotação já recebida (a UI recalcula/atualiza quando "expired").
export function quoteView(q, nowMs = Date.now()) {
  if (!q) return { state: 'idle' };
  if (q.status === STATUS.OK) return Date.parse(q.expiresAt) <= nowMs ? { state: 'expired' } : { state: q.options.every((o) => o.free) ? 'free_confirmed' : 'paid' };
  return { state: q.status === STATUS.UNAVAILABLE ? 'unavailable' : q.status };
}
