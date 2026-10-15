// Regras do robots.txt (padrão Google): grupo do nosso agente ou "*", regra mais longa vence. Puro, sem rede.
// Usado pelo robô (src/robots.js) e pela cotação de frete da API (api/_lib/shipping-fetch.mjs, #84), que não pode
// importar src/ (fora do pacote da Vercel). Mesma lógica que antes morava em src/robots.js.

// O hexadecimal de um escape "%xx" não diferencia maiúsculas (RFC 3986 §2.1): "%c3%a7" e "%C3%A7" são o mesmo caminho.
const upperEscapes = (s) => s.replace(/%[0-9a-f]{2}/gi, (m) => m.toUpperCase());

function toRegex(pattern) {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern).replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp('^' + body + (anchored ? '$' : ''));
}

/** Regras que valem para o agente `token` (nome do UA em minúsculas). */
export function parseRobotsRules(txt, token) {
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

/** true se as regras permitem a URL (sem regra que case = permitido; empate de tamanho = Allow vence). */
export function robotsAllows(rules, url) {
  const u = new URL(url);
  const path = upperEscapes(u.pathname + u.search); let best = null;
  for (const rule of rules) if (rule.re.test(path) && (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow))) best = rule;
  return !best || best.allow;
}
