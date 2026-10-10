// Issue #84 — cálculo de frete por CEP no site: núcleo puro e testável (sem rede, sem banco).
// Regra principal: o valor vem da cotação da loja. Sem cotação confirmada o frete é DESCONHECIDO (null), nunca R$ 0,00.

export const QUOTE_TTL_MS = 5 * 60_000;          // cotação curta: passou disso, é "expirada" e precisa ser refeita
export const RATE_LIMIT = { max: 10, windowMs: 60_000 };
export const STATUS = Object.freeze({ OK: 'ok', UNAVAILABLE: 'unavailable', ERROR: 'error', TIMEOUT: 'timeout', INVALID_CEP: 'invalid_cep', RATE_LIMITED: 'rate_limited' });
export const NOT_AVAILABLE_TEXT = 'Frete não disponível para cálculo no site';

// CEP válido: 8 dígitos (aceita 12345-678 e espaços). 00000000 não é CEP real.
export function normalizeCep(input) {
  if (typeof input !== 'string' && typeof input !== 'number') return null;
  const s = String(input).trim();
  if (!/^\d{5}-?\d{3}$/.test(s)) return null;
  const d = s.replace('-', '');
  return /^0{8}$/.test(d) ? null : d;
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

// Total item + frete só com frete CONFIRMADO. Retorna null (não comparável) para qualquer outro caso.
export function totalWithShipping(itemPrice, quote, quantity = 1) {
  const q = quantityOf(quantity);
  if (!q || typeof itemPrice !== 'number' || !Number.isFinite(itemPrice) || itemPrice <= 0) return null;
  if (quote?.status !== STATUS.OK) return null;
  const best = cheapest(quote.options);
  return best ? Math.round((itemPrice * q + best.price) * 100) / 100 : null;
}

// Ordena por total apenas as ofertas com total comparável; as demais ficam depois, na ordem original.
export function sortByTotal(rows) {
  const known = rows.filter((r) => typeof r.total === 'number');
  return [...known].sort((a, b) => a.total - b.total).concat(rows.filter((r) => typeof r.total !== 'number'));
}

// Serviço: valida entrada, limita abuso, reaproveita cotação curta (só da MESMA chave) e registra origem/horário.
// fetchQuote({ base, itemId, sellerId, quantity, cep }) -> json da loja; pode lançar (timeout/erro). Injetado: o teste não usa rede.
export function createQuoteService({ fetchQuote, now = Date.now, ttlMs = QUOTE_TTL_MS, rate = RATE_LIMIT, maxCache = 500, onAudit = () => {} }) {
  const cache = new Map(); const hits = new Map();

  const limited = (client) => {
    const t = now(); const arr = (hits.get(client) || []).filter((x) => t - x < rate.windowMs);
    if (arr.length >= rate.max) { hits.set(client, arr); return true; }
    arr.push(t); hits.set(client, arr);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((x) => t - x < rate.windowMs)) hits.delete(k);
    return false;
  };

  async function quote(req, { client = 'anon' } = {}) {
    const cep = normalizeCep(req?.cep); const quantity = quantityOf(req?.quantity ?? 1);
    if (!cep) return { status: STATUS.INVALID_CEP, reason: 'CEP inválido: informe 8 dígitos', options: [] };
    if (!quantity) return { status: STATUS.ERROR, reason: 'quantidade inválida', options: [] };
    if (!req.base || !req.itemId) return { status: STATUS.UNAVAILABLE, reason: NOT_AVAILABLE_TEXT, options: [] };
    const key = quoteKey({ ...req, quantity, cep }); const t = now();
    const hit = cache.get(key);
    if (hit && t < hit.expiresAt) return { ...hit.value, cached: true };
    if (limited(client)) return { status: STATUS.RATE_LIMITED, reason: 'muitas consultas: tente novamente em instantes', options: [] };
    let parsed;
    try { parsed = parseVtexSimulation(await fetchQuote({ base: req.base, itemId: req.itemId, sellerId: req.sellerId, quantity, cep })); }
    catch (e) { parsed = { status: e?.name === 'AbortError' || /timeout|timed out/i.test(String(e?.message)) ? STATUS.TIMEOUT : STATUS.ERROR, reason: 'a loja não respondeu à cotação', options: [] }; }
    const value = { ...parsed, source: 'vtex_simulation', quotedAt: new Date(t).toISOString(), expiresAt: new Date(t + ttlMs).toISOString(), cached: false };
    // Auditoria sem o CEP completo: só o prefixo de 3 dígitos.
    onAudit({ source: value.source, status: value.status, quotedAt: value.quotedAt, base: req.base, itemId: req.itemId, cepPrefix: cep.slice(0, 3) });
    if (parsed.status === STATUS.OK) {   // falha não é cacheada: a próxima tentativa consulta de novo
      if (cache.size >= maxCache) cache.delete(cache.keys().next().value);
      cache.set(key, { value, expiresAt: t + ttlMs });
    }
    return value;
  }

  return { quote, _cache: cache };
}

// Estado de exibição de uma cotação já recebida (a UI recalcula/atualiza quando "expired").
export function quoteView(q, nowMs = Date.now()) {
  if (!q) return { state: 'idle' };
  if (q.status === STATUS.OK) return Date.parse(q.expiresAt) <= nowMs ? { state: 'expired' } : { state: q.options.every((o) => o.free) ? 'free_confirmed' : 'paid' };
  return { state: q.status === STATUS.UNAVAILABLE ? 'unavailable' : q.status };
}
