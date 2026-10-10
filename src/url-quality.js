// Qualidade de links de oferta e identidade de loja. Funções puras: não abrem rede, não seguem
// redirecionamentos e não decidem reputação. Só olham o texto da URL e o domínio cadastrado da loja.
// Não há canonicalização nem normalização de domínio próprias aqui: a URL canônica é a única do projeto
// (canonicalizeUrl, src/core/offer-key.js) e o domínio é o de normalizeDomain (api/_lib/stores.mjs).
import { canonicalizeUrl } from './core/offer-key.js';
import { normalizeDomain } from '../api/_lib/stores.mjs';

const REDIRECT_PARAM = /^(url|u|redirect|redirect_to|redirect_url|return|returnurl|next|dest|destination|goto|link|target)$/i;

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

// Por que a URL não tem canônica: texto que não é URL ('malformed') ou esquema fora de http(s) ('unsupported_scheme').
function invalidReason(raw) {
  let u;
  try { u = new URL(String(raw ?? '').trim()); } catch { return 'malformed'; }
  return u.protocol === 'http:' || u.protocol === 'https:' ? 'malformed' : 'unsupported_scheme';
}

/**
 * Sinais de risco no texto do link, em relação ao domínio cadastrado da loja (opcional).
 * Cada sinal é um código; nenhum deles é prova de fraude, só motivo para olhar com mais cuidado.
 *  malformed, unsupported_scheme, insecure_http, credentials_in_url, ip_host, punycode_host,
 *  redirect_param (query aponta para outro host), host_mismatch, lookalike_domain
 * Devolve o resultado de canonicalizeUrl ({ original, canonical, valid, removed }) mais { issues, host }.
 * Os sinais são lidos da URL original (a canônica sempre sai em https e sem credenciais).
 */
export function analyzeOfferLink(raw, storeDomain) {
  const c = canonicalizeUrl(raw);
  if (!c.valid) return { ...c, issues: [invalidReason(raw)], host: null };
  const issues = [];
  const src = new URL(c.original.trim());
  const host = normalizeDomain(c.canonical);
  if (src.protocol === 'http:') issues.push('insecure_http');
  if (src.username || src.password) issues.push('credentials_in_url');
  if (isIp(src.hostname)) issues.push('ip_host');
  if (src.hostname.split('.').some((l) => l.startsWith('xn--'))) issues.push('punycode_host');
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
  return { ...c, issues, host };
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
