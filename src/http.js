// Cliente HTTP educado: UA honesto, timeout, intervalo por domínio, detecção de bloqueio.
// Nunca tenta contornar CAPTCHA, login ou bloqueio: só reporta.
const UA = process.env.HUNTER_UA || 'PokeHunterBR/1.0 (monitor pessoal de precos; respeita robots.txt)';
const DELAY = Number(process.env.HUNTER_DOMAIN_DELAY_MS ?? 1500);
let _fetch = globalThis.fetch;
export const setFetch = (f) => { _fetch = f; };
export const userAgent = UA;

// APIs oficiais aguentam mais ritmo que sites de loja.
const HOST_DELAY = { 'api.mercadolibre.com': 300 };
const lastHit = new Map();
const gates = new Map();     // host -> fila: no máximo 1 requisição por vez a cada intervalo, mesmo com lojas em paralelo
const cooldown = new Map();  // host -> instante até o qual o servidor pediu silêncio (Retry-After)
let sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let random = Math.random;
export const setSleep = (f) => { sleep = f; };
export const setRandom = (f) => { random = f; };

// Retry limitado: só falha passageira (timeout, rede, 5xx) e 429 com Retry-After curto. 401/403, CAPTCHA e desafio nunca são repetidos.
const retryCfg = () => ({
  max: Number(process.env.HUNTER_HTTP_RETRIES ?? 2),
  base: Number(process.env.HUNTER_RETRY_BASE_MS ?? 1000),
  cap: Number(process.env.HUNTER_RETRY_MAX_MS ?? 30000),
});
// Espera exponencial com teto e jitter (0,5x a 1x), para lojas não acordarem juntas.
export const backoffDelay = (attempt, base, cap, rnd = random) => Math.min(cap, base * 2 ** attempt) * (0.5 + rnd() / 2);
// Retry-After em segundos ou data HTTP -> ms (null se ausente ou ilegível).
export function parseRetryAfter(v, nowMs = Date.now()) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s) * 1000);
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : Math.max(0, t - nowMs);
}

export class BlockedError extends Error {
  constructor(msg, status) { super(msg); this.blocked = true; this.status = status; }
}

const CHALLENGE = /cf-chl|challenge-platform|captcha-delivery|just a moment\.\.\.|account-verification|are you a robot|access denied/i;

// Um host por vez: quem chega depois entra na fila e só sai quando o intervalo e o Retry-After vencerem.
function takeSlot(host) {
  const turn = (gates.get(host) || Promise.resolve()).then(async () => {
    const wait = Math.max((lastHit.get(host) || 0) + (HOST_DELAY[host] ?? DELAY), cooldown.get(host) || 0) - Date.now();
    if (wait > 0) await sleep(wait);
    lastHit.set(host, Date.now());
  });
  gates.set(host, turn.catch(() => {}));
  return turn;
}

export async function request(url, opts = {}) {
  const host = new URL(url).host;
  const { max, base, cap } = retryCfg();
  const idempotent = ['GET', 'HEAD'].includes((opts.method || 'GET').toUpperCase());
  for (let attempt = 0; ; attempt++) {
    try { return await requestOnce(url, opts); } catch (e) {
      let delay = null;
      if (e.retryAfterMs != null) { // 429 com Retry-After: o servidor manda; acima do teto, desiste sem insistir
        if (e.retryAfterMs <= cap) delay = e.retryAfterMs;
        cooldown.set(host, Date.now() + e.retryAfterMs);
      } else if (!e.blocked && (e.status === 0 || e.status >= 500 || e.network)) delay = backoffDelay(attempt, base, cap);
      if (delay == null || !idempotent || attempt >= max) throw e;
      await sleep(delay);
    }
  }
}

async function requestOnce(url, { method = 'GET', accept = 'text/html', body, headers = {}, timeout = 10000 } = {}) {
  const host = new URL(url).host;
  await takeSlot(host);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await _fetch(url, {
      method, body, signal: ctrl.signal, redirect: 'follow',
      headers: { 'user-agent': UA, accept, 'accept-language': 'pt-BR,pt;q=0.9', ...headers },
    });
    const text = await decodeBody(res);
    const finalUrl = res.url || url;
    const looksChallenge = text.length < 30000 && CHALLENGE.test(text.slice(0, 8000));
    if ([401, 403, 429].includes(res.status) || /account-verification|captcha/i.test(finalUrl) || (res.status >= 400 && looksChallenge) || (looksChallenge && !/application\/json/.test(accept))) {
      const err = new BlockedError(`Acesso bloqueado (${res.status}) em ${host}`, res.status);
      if (res.status === 429) err.retryAfterMs = parseRetryAfter(res.headers?.get?.('retry-after'));
      throw err;
    }
    if (!res.ok) { const e = new Error(`HTTP ${res.status} em ${url}`); e.status = res.status; throw e; }
    return { status: res.status, url: finalUrl, text, json: () => JSON.parse(text) };
  } catch (e) {
    if (e.name === 'AbortError') { const t = new Error(`Timeout em ${host}`); t.status = 0; throw t; }
    if (e.status === undefined && !e.blocked) e.network = true; // falha de rede (DNS, conexão): passageira
    throw e;
  } finally { clearTimeout(timer); }
}

// Algumas lojas ainda servem ISO-8859-1: decodifica pelo charset declarado para não publicar "ESCURID�O".
async function decodeBody(res) {
  if (typeof res.arrayBuffer !== 'function') return res.text();
  const buf = new Uint8Array(await res.arrayBuffer());
  let cs = (res.headers?.get?.('content-type') || '').match(/charset=([\w-]+)/i)?.[1];
  if (!cs) { const head = new TextDecoder('latin1').decode(buf.slice(0, 4096)); cs = head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1]; }
  cs = (cs || 'utf-8').toLowerCase();
  try { return new TextDecoder(/^(iso-8859-1|latin1|windows-1252|cp1252)$/.test(cs) ? 'windows-1252' : cs).decode(buf); } catch { return new TextDecoder('utf-8').decode(buf); }
}

export const get = (url, opts) => request(url, opts);
export const getJson = async (url, opts = {}) => (await request(url, { accept: 'application/json', ...opts })).json();
