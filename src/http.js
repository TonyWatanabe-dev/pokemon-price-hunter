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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class BlockedError extends Error {
  constructor(msg, status) { super(msg); this.blocked = true; this.status = status; }
}

const CHALLENGE = /cf-chl|challenge-platform|captcha-delivery|just a moment\.\.\.|account-verification|are you a robot|access denied/i;

const MAX_BYTES = Number(process.env.HUNTER_MAX_BODY_BYTES ?? 8 * 1024 * 1024);

// Só http(s), sem usuário:senha na URL. Falha antes de qualquer conexão.
export function checkUrl(url) {
  let u;
  try { u = new URL(url); } catch { const e = new Error('URL inválida'); e.status = 0; e.invalidUrl = true; throw e; }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) { const e = new Error(`URL recusada (${u.protocol || 'sem protocolo'})`); e.status = 0; e.invalidUrl = true; throw e; }
  return u;
}

// URL para mensagens de erro e logs: sem credenciais, query e fragmento (podem carregar tokens).
export const safeUrl = (url) => { try { const u = new URL(url); return u.origin + u.pathname; } catch { return '(URL inválida)'; } };

// Mascara segredos que sobraram em texto livre (token do Telegram, Bearer, parâmetros de token).
export const redact = (s) => String(s ?? '')
  .replace(/\bbot\d{5,}:[\w-]{10,}/gi, 'bot***')
  .replace(/\b(bearer|basic)\s+[\w.~+/=-]{8,}/gi, '$1 ***')
  .replace(/([?&;\s"'](?:access_token|token|api[_-]?key|key|secret|client_secret|password|authorization)=)[^&\s"']+/gi, '$1***');

export async function request(url, { method = 'GET', accept = 'text/html', body, headers = {}, timeout = 10000 } = {}) {
  const host = checkUrl(url).host;
  const wait = (lastHit.get(host) || 0) + (HOST_DELAY[host] ?? DELAY) - Date.now();
  if (wait > 0) await sleep(wait);
  lastHit.set(host, Date.now());

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await _fetch(url, {
      method, body, signal: ctrl.signal, redirect: 'follow',
      headers: { 'user-agent': UA, accept, 'accept-language': 'pt-BR,pt;q=0.9', ...headers },
    });
    if (Number(res.headers?.get?.('content-length')) > MAX_BYTES) { const e = new Error(`Resposta grande demais em ${host}`); e.status = 0; throw e; }
    const text = await decodeBody(res);
    if (text.length > MAX_BYTES) { const e = new Error(`Resposta grande demais em ${host}`); e.status = 0; throw e; }
    const finalUrl = res.url || url;
    const looksChallenge = text.length < 30000 && CHALLENGE.test(text.slice(0, 8000));
    if ([401, 403, 429].includes(res.status) || /account-verification|captcha/i.test(finalUrl) || (res.status >= 400 && looksChallenge) || (looksChallenge && !/application\/json/.test(accept))) {
      throw new BlockedError(`Acesso bloqueado (${res.status}) em ${host}`, res.status);
    }
    if (!res.ok) { const e = new Error(`HTTP ${res.status} em ${safeUrl(url)}`); e.status = res.status; throw e; }
    return { status: res.status, url: finalUrl, text, json: () => { try { return JSON.parse(text); } catch { const e = new Error(`Resposta não é JSON válido em ${host}`); e.status = res.status; e.malformed = true; throw e; } } };
  } catch (e) {
    if (e.name === 'AbortError') { const t = new Error(`Timeout em ${host}`); t.status = 0; throw t; }
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
