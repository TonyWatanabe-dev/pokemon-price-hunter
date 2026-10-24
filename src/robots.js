// robots.txt: grupo do nosso agente ou "*", regra mais longa vence (padrão Google).
// A leitura das regras (pura) mora em api/_lib/robots-rules.mjs: a cotação de frete da API usa a mesma (#84).
import { request, userAgent, netCode } from './http.js';
import { parseRobotsRules, robotsAllows } from '../api/_lib/robots-rules.mjs';
const cache = new Map();
const token = userAgent.split('/')[0].toLowerCase();

export function parseRobots(txt) { return parseRobotsRules(txt, token); }
// Linhas "Sitemap:" do robots.txt (RFC 9309 §2.6): só do mesmo host (com ou sem www) e no máximo 5, para o leitor JSON-LD
// achar o mapa do site quando ele não está em /sitemap.xml (24/10/2026: lojas "ativas" sem nenhuma página de produto).
export function sitemapsFrom(txt, origin) {
  const host = new URL(origin).host.replace(/^www\./, ''); const out = [];
  for (const m of String(txt || '').matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)) {
    try { const u = new URL(m[1].trim()); if (/^https?:$/.test(u.protocol) && u.host.replace(/^www\./, '') === host && !out.includes(u.href)) out.push(u.href); } catch { /* linha inválida */ }
    if (out.length >= 5) break;
  }
  return out;
}

async function load(origin) {
  try { const txt = (await request(origin + '/robots.txt', { accept: 'text/plain' })).text; return { rules: parseRobots(txt), sitemaps: sitemapsFrom(txt, origin) }; }
  catch (e) {
    // Guarda o motivo real (status HTTP, Retry-After, código de rede) para o diagnóstico; a decisão continua a mesma.
    const fail = { httpStatus: Number.isInteger(e.httpStatus ?? e.status) && (e.httpStatus ?? e.status) > 0 ? (e.httpStatus ?? e.status) : null, code: netCode(e), retryAfter: e.retryAfter ?? null, forensics: e.forensics || null };
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
  return robotsAllows(r.rules, u.href) ? { ok: true } : { ok: false, why: 'robots' };
}
export async function allowed(url) { return (await check(url)).ok; }
// Por que o robots.txt desta origem não abriu: { httpStatus, code, retryAfter } (null se abriu).
export async function failureOf(url) {
  const u = new URL(url);
  if (!cache.has(u.origin)) cache.set(u.origin, load(u.origin));
  return (await cache.get(u.origin)).fail || null;
}
/** Mapas do site declarados no robots.txt desta origem (vazio se o robots não abriu). */
export async function sitemapsOf(url) {
  const u = new URL(url);
  if (!cache.has(u.origin)) cache.set(u.origin, load(u.origin));
  return (await cache.get(u.origin)).sitemaps || [];
}
export const _resetRobots = () => cache.clear();
