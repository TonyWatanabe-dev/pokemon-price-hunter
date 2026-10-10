// Cliente HTTP educado: UA honesto, timeout, intervalo por domínio, detecção de bloqueio.
// Nunca tenta contornar CAPTCHA, login ou bloqueio: só reporta.
import { assertSafeUrl } from './urlguard.js';
const UA = process.env.HUNTER_UA || 'PokeHunterBR/1.0 (monitor pessoal de precos; respeita robots.txt)';
const DELAY = Number(process.env.HUNTER_DOMAIN_DELAY_MS ?? 1500);
const MAX_REDIRECTS = 5;
let _fetch = globalThis.fetch;
export const setFetch = (f) => { _fetch = f; };
export const userAgent = UA;

// APIs oficiais aguentam mais ritmo que sites de loja.
const HOST_DELAY = { 'api.mercadolibre.com': 300 };
const lastHit = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class BlockedError extends Error {
  // extra: detalhes do motivo real (httpStatus, code, retryAfter) para o diagnóstico e a espera da próxima tentativa.
  constructor(msg, status, extra) { super(msg); this.blocked = true; this.status = status; if (extra) Object.assign(this, extra); }
}

// Retry-After em segundos: número ("120") ou data HTTP. Ausente, inválido ou no passado → null.
export function retryAfterSec(v, now = Date.now()) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  if (/^\d+$/.test(s)) return Number(s);
  const t = Date.parse(s);
  return Number.isFinite(t) && t > now ? Math.ceil((t - now) / 1000) : null;
}
// Código do erro de rede (ENOTFOUND, ECONNREFUSED, ECONNRESET, CERT_*, TIMEOUT…). O fetch do Node guarda em e.cause.
// Só códigos no formato de constante: nunca devolve texto livre da exceção.
export function netCode(e) {
  for (const c of [e?.code, e?.cause?.code, e?.cause?.errors?.[0]?.code, e?.cause?.cause?.code]) if (typeof c === 'string' && /^[A-Z][A-Z0-9_]{1,40}$/.test(c)) return c;
  return null;
}
// Motivo para gravar em sources.json: mensagem + código de rede, sem query/fragmento de URL (token, sessão) e com tamanho limitado.
export function safeReason(e) {
  let m = String(e?.message || e || 'erro desconhecido');
  const code = netCode(e);
  if (code && !m.includes(code)) m += ` (${code})`;
  return m.replace(/(https?:\/\/[^\s?#"'<>]+)[?#][^\s"'<>]*/gi, '$1').replace(/[?&](?:access_)?token=[^\s&]*/gi, '').slice(0, 300);
}

const CHALLENGE = /cf-chl|challenge-platform|captcha-delivery|just a moment\.\.\.|account-verification|are you a robot|access denied/i;

export async function request(url, { method = 'GET', accept = 'text/html', body, headers = {}, timeout = 10000 } = {}) {
  const host = assertSafeUrl(url).host;
  const wait = (lastHit.get(host) || 0) + (HOST_DELAY[host] ?? DELAY) - Date.now();
  if (wait > 0) await sleep(wait);
  lastHit.set(host, Date.now());

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    // Redirecionamentos seguidos à mão: cada destino passa pela guarda antes de ser buscado.
    let cur = url; let m = method; let b = body; let res;
    for (let hop = 0; ; hop++) {
      res = await _fetch(cur, {
        method: m, body: b, signal: ctrl.signal, redirect: 'manual',
        headers: { 'user-agent': UA, accept, 'accept-language': 'pt-BR,pt;q=0.9', ...headers },
      });
      const loc = res.status >= 300 && res.status < 400 ? res.headers?.get?.('location') : null;
      if (!loc) break;
      if (hop >= MAX_REDIRECTS) throw Object.assign(new Error(`Redirecionamentos demais em ${host}`), { code: 'TOO_MANY_REDIRECTS' });
      cur = assertSafeUrl(new URL(loc, cur)).href;
      if (![307, 308].includes(res.status)) { m = 'GET'; b = undefined; }
    }
    if (cur !== url && !res.url) Object.defineProperty(res, 'url', { value: cur });
    const text = await decodeBody(res);
    const finalUrl = res.url || url;
    const looksChallenge = text.length < 30000 && CHALLENGE.test(text.slice(0, 8000));
    if (res.status === 429) {
      // Limite de requisições: não é "barra robôs". Guarda o Retry-After para a próxima tentativa respeitar.
      const retryAfter = retryAfterSec(res.headers?.get?.('retry-after'));
      throw new BlockedError(`Limite de requisições (429) em ${host}${retryAfter != null ? `, Retry-After ${retryAfter} s` : ''}`, 429, { httpStatus: 429, retryAfter });
    }
    if ([401, 403].includes(res.status) || /account-verification|captcha/i.test(finalUrl) || (res.status >= 400 && looksChallenge) || (looksChallenge && !/application\/json/.test(accept))) {
      const what = res.status < 300 ? `desafio anti-robô com HTTP ${res.status}` : String(res.status);
      throw new BlockedError(`Acesso bloqueado (${what}) em ${host}`, res.status, { httpStatus: res.status });
    }
    if (!res.ok) { const e = new Error(`HTTP ${res.status} em ${url}`); e.status = res.status; e.httpStatus = res.status; throw e; }
    return { status: res.status, url: finalUrl, text, json: () => JSON.parse(text) };
  } catch (e) {
    if (e.name === 'AbortError') { const t = new Error(`Timeout em ${host}`); t.status = 0; t.code = 'TIMEOUT'; throw t; }
    // Erro de rede do fetch ("fetch failed"): o motivo real (DNS, conexão recusada, TLS) fica no código.
    if (!e.blocked && e.status == null && !e.unsafe && !(e instanceof SyntaxError)) { const c = netCode(e); if (c) { try { e.code ??= c; } catch { /* exceção congelada */ } if (!e.message.includes(host)) e.message = `Erro de rede em ${host}: ${c}`; } }
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
