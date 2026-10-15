// Issue #84 — cotação VTEX (orderForms/simulation) feita pela API da Vercel. A função não leva src/ no pacote
// (.vercelignore), então não usa o request() do robô (src/http.js): este é o cliente mínimo da cotação, com as
// garantias que importam aqui:
// • destino: só a base resolvida NO SERVIDOR (resolveVtexOffer), conferida por assertSafeUrl (http/https, sem
//   credenciais, sem loopback/privado/link-local) antes de qualquer conexão;
// • redirecionamento NÃO é seguido (3xx = falha): a cotação nunca salta para outro destino;
// • UA honesto (o mesmo do robô), timeout, resposta limitada a 1 MB, uma requisição por loja por vez (fila por host);
// • robots.txt da loja lido antes (cache de 1 h por loja): proibido = indisponível; robots que não abre = não consulta;
// • 429, 401 e 403 = bloqueio (blocked): o serviço põe a loja em cooldown e não insiste.
import { assertSafeUrl } from './urlguard.mjs';
import { parseRobotsRules, robotsAllows } from './robots-rules.mjs';

export const UA = 'PokeHunterBR/1.0 (monitor pessoal de precos; respeita robots.txt)';
const TOKEN = UA.split('/')[0].toLowerCase();
const MAX_BYTES = 1 << 20;
export const ROBOTS_TTL_MS = 3600_000;
const ROBOTS_DOWN_TTL_MS = 5 * 60_000;    // robots que não abriu: tenta de novo em 5 min (não fica 1 h sem cotação)

const defaultFetch = (...a) => globalThis.fetch(...a);
let _fetch = defaultFetch;
const robots = new Map(); const gates = new Map();
/** Só para testes: troca o fetch (loja falsa) e zera caches e filas. */
export const setShippingFetch = (f) => { _fetch = f || defaultFetch; robots.clear(); gates.clear(); };

// Retry-After em segundos: número ("120") ou data HTTP. Ausente, inválido ou no passado → null (mesma regra do robô).
export function retryAfterSec(v, now = Date.now()) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  if (/^\d+$/.test(s)) return Number(s);
  const t = Date.parse(s);
  return Number.isFinite(t) && t > now ? Math.ceil((t - now) / 1000) : null;
}

async function once(url, { method = 'GET', body, headers = {}, accept = 'application/json', timeout = 6000 } = {}) {
  const u = assertSafeUrl(url);
  // fila por host: a próxima requisição à mesma loja só sai quando a anterior terminar
  const prev = gates.get(u.host) || Promise.resolve();
  let release; const mine = new Promise((r) => { release = r; }); const tail = prev.then(() => mine);
  gates.set(u.host, tail);
  await prev;
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await _fetch(u.href, { method, body, redirect: 'manual', signal: ctrl.signal,
      headers: { 'user-agent': UA, accept, 'accept-language': 'pt-BR,pt;q=0.9', ...headers } });
    if (res.status >= 300 && res.status < 400) throw Object.assign(new Error(`redirecionamento não seguido em ${u.host}`), { status: res.status });
    if (res.status === 429) throw Object.assign(new Error(`Limite de requisições (429) em ${u.host}`), { blocked: true, status: 429, retryAfter: retryAfterSec(res.headers?.get?.('retry-after')) });
    if (res.status === 401 || res.status === 403) throw Object.assign(new Error(`Acesso bloqueado (${res.status}) em ${u.host}`), { blocked: true, status: res.status });
    if (Number(res.headers?.get?.('content-length')) > MAX_BYTES) throw Object.assign(new Error(`Resposta grande demais em ${u.host}`), { status: 0 });
    const text = await res.text();
    if (text.length > MAX_BYTES) throw Object.assign(new Error(`Resposta grande demais em ${u.host}`), { status: 0 });
    return { status: res.status, ok: res.status >= 200 && res.status < 300, text };
  } catch (e) {
    if (e?.name === 'AbortError') throw Object.assign(new Error(`Timeout em ${u.host}`), { code: 'TIMEOUT' });
    throw e;
  } finally {
    clearTimeout(timer); release();
    if (gates.get(u.host) === tail) gates.delete(u.host);
  }
}

// robots.txt: 2xx = regras; 4xx = sem robots (liberado); 5xx, timeout, rede ou redirecionamento = não consulta.
// 429/401/403 no robots.txt = bloqueio (propaga: cooldown da loja).
async function robotsOf(origin, now, timeout) {
  const hit = robots.get(origin);
  if (hit && now < hit.until) return hit.v;
  let v;
  try {
    const r = await once(origin + '/robots.txt', { accept: 'text/plain', timeout });
    v = r.ok ? { rules: parseRobotsRules(r.text, TOKEN) } : r.status >= 400 && r.status < 500 ? { rules: [] } : { down: true };
  } catch (e) {
    if (e?.blocked) throw e;
    v = { down: true };
  }
  robots.set(origin, { v, until: now + (v.down ? ROBOTS_DOWN_TTL_MS : ROBOTS_TTL_MS) });
  return v;
}

/** fetchQuote padrão da API: { base, itemId, sellerId, quantity, cep } (todos do servidor, cep já normalizado) → json da loja. */
export async function apiVtexFetchQuote({ base, itemId, sellerId, quantity, cep }, { timeout = 6000, robotsTimeout = 3000, now = Date.now } = {}) {
  const origin = assertSafeUrl(base).origin;
  const url = assertSafeUrl(`${origin}/api/checkout/pub/orderForms/simulation?sc=1`).href;
  const rb = await robotsOf(origin, now(), robotsTimeout);
  if (rb.down) throw Object.assign(new Error(`robots.txt de ${new URL(origin).host} não abriu`), { code: 'ROBOTS_UNREACHABLE' });
  if (!robotsAllows(rb.rules, url)) throw Object.assign(new Error('robots.txt da loja não permite a cotação'), { robots: true });
  const r = await once(url, { method: 'POST', timeout, headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ items: [{ id: String(itemId), quantity, seller: String(sellerId ?? '1') }], postalCode: cep, country: 'BRA' }) });
  if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status} na cotação`), { status: r.status });
  try { return JSON.parse(r.text); } catch { throw Object.assign(new SyntaxError('cotação da loja não é JSON válido'), { malformed: true }); }
}
