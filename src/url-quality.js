// Qualidade de links de oferta e identidade de loja. Funções puras: não abrem rede, não seguem
// redirecionamentos e não decidem reputação. Só olham o texto da URL e o domínio cadastrado da loja.

const TRACKING_PARAM = /^(utm_.*|gclid|gbraid|wbraid|fbclid|msclkid|dclid|yclid|igshid|srsltid|mc_cid|mc_eid|_ga|_gl|ref|ref_|referrer|aff|aff_.*|affiliate|afiliado|cmpid|campaign|tag|spm|sref)$/i;
const REDIRECT_PARAM = /^(url|u|redirect|redirect_to|redirect_url|return|returnurl|next|dest|destination|goto|link|target)$/i;

/** Domínio comparável: minúsculo, sem www, sem porta, sem ponto final. Aceita URL ou host solto. null se inválido. */
export function normalizeDomain(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  let host;
  try { host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : 'https://' + raw).hostname; } catch { return null; }
  host = host.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  return host && host.includes('.') ? host : null;
}

const isIp = (h) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':');

function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

const sameOrSub = (host, domain) => host === domain || host.endsWith('.' + domain);
const nameOf = (domain) => domain.split('.')[0];

/**
 * URL canônica da oferta, preservando a de origem. Tira tracking e hash, ordena a query e remove
 * porta padrão e barra final; mantém parâmetros que identificam a variante (variant, sku, id...).
 * Não troca http por https (não dá para afirmar que o destino responde em https sem consultá-lo).
 * Retorna { source, canonical, differs, removed, issues } — canonical é null se a URL não for http(s).
 */
export function canonicalizeOfferUrl(raw) {
  const source = String(raw ?? '').trim();
  let u;
  try { u = new URL(source); } catch { return { source, canonical: null, differs: false, removed: [], issues: ['malformed'] }; }
  if (!/^https?:$/.test(u.protocol)) return { source, canonical: null, differs: false, removed: [], issues: ['unsupported_scheme'] };
  const removed = [];
  const kept = [];
  for (const [k, v] of u.searchParams) { if (TRACKING_PARAM.test(k)) removed.push(k); else kept.push([k, v]); }
  kept.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  const path = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, '') : '';
  const qs = new URLSearchParams(kept).toString();
  const canonical = `${u.protocol}//${host}${u.port ? ':' + u.port : ''}${path}${qs ? '?' + qs : ''}`;
  return { source, canonical, differs: canonical !== source, removed, issues: [] };
}

/**
 * Sinais de risco no texto do link, em relação ao domínio cadastrado da loja (opcional).
 * Cada sinal é um código; nenhum deles é prova de fraude, só motivo para olhar com mais cuidado.
 *  malformed, unsupported_scheme, insecure_http, credentials_in_url, ip_host, punycode_host,
 *  redirect_param (query aponta para outro host), host_mismatch, lookalike_domain
 */
export function analyzeOfferLink(raw, storeDomain) {
  const c = canonicalizeOfferUrl(raw);
  const issues = [...c.issues];
  const flags = { ...c, issues };
  if (!c.canonical) return { ...flags, host: null };
  const u = new URL(c.canonical);
  const host = normalizeDomain(u.hostname);
  const src = new URL(c.source);
  if (u.protocol === 'http:') issues.push('insecure_http');
  if (src.username || src.password) issues.push('credentials_in_url');
  if (isIp(u.hostname)) issues.push('ip_host');
  if (u.hostname.split('.').some((l) => l.startsWith('xn--'))) issues.push('punycode_host');
  for (const [k, v] of src.searchParams) {
    if (!REDIRECT_PARAM.test(k) || !/^(https?:)?\/\//i.test(v)) continue;
    const target = normalizeDomain(v);
    if (!target || !host || !sameOrSub(target, host)) { issues.push('redirect_param'); break; }
  }
  const store = normalizeDomain(storeDomain);
  if (store && host && !sameOrSub(host, store)) {
    issues.push('host_mismatch');
    const d = distance(host, store);
    const a = nameOf(host), b = nameOf(store);
    const sameName = a === b || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a)));
    if ((d > 0 && d <= 2) || sameName) issues.push('lookalike_domain');
  }
  return { ...flags, host };
}

/**
 * Consistência entre a loja e os hosts das ofertas dela. Só descreve a evidência observada;
 * não é nota de confiança: "consistent" significa apenas que os links batem com o domínio cadastrado.
 */
export function storeLinkConsistency(store, offers, minSample = 3) {
  const domain = normalizeDomain(store?.domain || store?.url);
  const hosts = {};
  let matching = 0, other = 0, invalid = 0;
  for (const o of offers || []) {
    const h = analyzeOfferLink(o?.url, domain).host;
    if (!h) { invalid++; continue; }
    if (domain && sameOrSub(h, domain)) matching++; else { other++; hosts[h] = (hosts[h] || 0) + 1; }
  }
  const total = matching + other + invalid;
  let verdict = 'insufficient';
  if (!domain) verdict = 'no_domain';
  else if (total >= minSample) verdict = other + invalid === 0 ? 'consistent' : 'inconsistent';
  return { domain, verdict, total, matching, other, invalid, otherHosts: hosts };
}
