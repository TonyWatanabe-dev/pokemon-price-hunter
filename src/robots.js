// robots.txt: grupo do nosso agente ou "*", regra mais longa vence (padrão Google).
import { request, userAgent } from './http.js';
const cache = new Map();
const token = userAgent.split('/')[0].toLowerCase();

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
      lastWasAgent = false; if (val) current.rules.push({ allow: key === 'allow', path: val, re: toRegex(val) });
    } else lastWasAgent = false;
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== '*' && token.includes(a)));
  const chosen = mine.length ? mine : groups.filter((g) => g.agents.includes('*'));
  return chosen.flatMap((g) => g.rules);
}

async function load(origin) {
  try { return { rules: parseRobots((await request(origin + '/robots.txt', { accept: 'text/plain' })).text) }; }
  catch (e) {
    if (e.blocked) return { rules: [], blocked: true };
    if (e.status >= 400 && e.status < 500) return { rules: [] }; // sem robots = liberado
    return { rules: [], unreachable: true };                      // 5xx/timeout = não rastrear
  }
}

export async function allowed(url) {
  const u = new URL(url);
  if (!cache.has(u.origin)) cache.set(u.origin, load(u.origin));
  const r = await cache.get(u.origin);
  if (r.blocked || r.unreachable) return false;
  const path = u.pathname + u.search; let best = null;
  for (const rule of r.rules) if (rule.re.test(path) && (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow))) best = rule;
  return !best || best.allow;
}
export const _resetRobots = () => cache.clear();
