// robots.txt: grupo do nosso agente ou "*", regra mais longa vence (padrão Google).
import { request, userAgent, netCode } from './http.js';
const cache = new Map();
const token = userAgent.split('/')[0].toLowerCase();
// O hexadecimal de um escape "%xx" não diferencia maiúsculas (RFC 3986 §2.1): "%c3%a7" e "%C3%A7" são o mesmo caminho.
const upperEscapes = (s) => s.replace(/%[0-9a-f]{2}/gi, (m) => m.toUpperCase());

function toRegex(pattern) {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern).replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp('^' + body + (anchored ? '$' : ''));
}

export function parseRobots(txt) {
  const groups = []; let current = null; let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim(); if (!line) continue;
    const [k, ...rest] = line.split(':'); const key = k.trim().toLowerCase(); const val = rest.join(':').trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) { current = { agents: [], rules: [] }; groups.push(current); }
      current.agents.push(val.toLowerCase()); lastWasAgent = true;
    } else if ((key === 'allow' || key === 'disallow') && current) {
      // A URL comparada já vem percent-encoded (new URL); a regra com acento ("/coleção") também precisa vir (RFC 9309 §2.2.2).
      const p = upperEscapes(val.replace(/[^\x00-\x7F]+/g, encodeURIComponent));
      lastWasAgent = false; if (p) current.rules.push({ allow: key === 'allow', path: p, re: toRegex(p) });
    } else lastWasAgent = false;
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== '*' && token.includes(a)));
  const chosen = mine.length ? mine : groups.filter((g) => g.agents.includes('*'));
  return chosen.flatMap((g) => g.rules);
}

async function load(origin) {
  try { return { rules: parseRobots((await request(origin + '/robots.txt', { accept: 'text/plain' })).text) }; }
  catch (e) {
    // Guarda o motivo real (status HTTP, Retry-After, código de rede) para o diagnóstico; a decisão continua a mesma.
    const fail = { httpStatus: Number.isInteger(e.httpStatus ?? e.status) && (e.httpStatus ?? e.status) > 0 ? (e.httpStatus ?? e.status) : null, code: netCode(e), retryAfter: e.retryAfter ?? null };
    if (e.blocked) return { rules: [], blocked: true, fail };
    if (e.status >= 400 && e.status < 500) return { rules: [] }; // sem robots = liberado
    return { rules: [], unreachable: true, fail };                // 5xx/timeout/rede = não rastrear
  }
}

// Motivo explícito: o robots.txt proíbe, ou o site nem deixa ler o robots.txt (bloqueio de robô/firewall).
export async function check(url) {
  const u = new URL(url);
  if (!cache.has(u.origin)) cache.set(u.origin, load(u.origin));
  const r = await cache.get(u.origin);
  if (r.blocked) return { ok: false, why: 'blocked' };
  if (r.unreachable) return { ok: false, why: 'unreachable' };
  const path = upperEscapes(u.pathname + u.search); let best = null;
  for (const rule of r.rules) if (rule.re.test(path) && (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow))) best = rule;
  return !best || best.allow ? { ok: true } : { ok: false, why: 'robots' };
}
export async function allowed(url) { return (await check(url)).ok; }
// Por que o robots.txt desta origem não abriu: { httpStatus, code, retryAfter } (null se abriu).
export async function failureOf(url) {
  const u = new URL(url);
  if (!cache.has(u.origin)) cache.set(u.origin, load(u.origin));
  return (await cache.get(u.origin)).fail || null;
}
export const _resetRobots = () => cache.clear();
