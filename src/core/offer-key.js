// Chave explicável de deduplicação de ofertas e URL canônica. Funções puras, sem I/O.
// Não substitui match.canonicalUrl (chave de revisão/override, que descarta a query inteira): aqui a query relevante fica.
// A URL original nunca é alterada; quem usa guarda url (original) e a canônica lado a lado.

// Parâmetros de rastreio/sessão. Qualquer outro parâmetro é mantido (pode mudar produto ou variante: sku, variant, id, color...).
const TRACKING = /^(utm_[a-z0-9_]+|gclid|gbraid|wbraid|fbclid|msclkid|dclid|yclid|igshid|mc_cid|mc_eid|_ga|_gl|ref|ref_|referrer|aff|affiliate|affid|src|source|campaign|cmpid|trk|tracking|sid|sessionid|srsltid|pf_rd_[a-z]+|pd_rd_[a-z]+|psc|th|tag|linkcode|hash|matt_[a-z_]+|sclid)$/i;
const DEFAULT_PORT = { 'http:': '80', 'https:': '443' };

/** Normaliza a URL mantendo o que identifica produto/variante. Devolve { original, canonical, valid, removed }. */
export function canonicalizeUrl(input) {
  const original = input == null ? '' : String(input);
  const bad = { original, canonical: null, valid: false, removed: [] };
  let u;
  try { u = new URL(original.trim()); } catch { return bad; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return bad;
  if (!u.hostname) return bad;
  const removed = [];
  const kept = [];
  for (const [k, v] of u.searchParams) (TRACKING.test(k) ? removed.push(k) : kept.push([k, v]));
  kept.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const port = u.port && u.port !== DEFAULT_PORT[u.protocol] ? `:${u.port}` : '';
  const path = u.pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  const qs = new URLSearchParams(kept).toString();
  // o fragmento (#) nunca identifica página diferente
  return { original, canonical: `https://${host}${port}${path}${qs ? `?${qs}` : ''}`, valid: true, removed };
}

const norm = (s) => (s == null ? '' : String(s).trim().toLowerCase());

/**
 * Chave de deduplicação com a razão. Prioridade: loja+SKU > loja+URL canônica > sem chave segura.
 * A chave sempre inclui loja e vendedor (o mesmo SKU em lojas/vendedores diferentes são ofertas diferentes)
 * e o SKU/variante, para não colapsar produtos diferentes. URL inválida sem SKU não gera chave (nunca agrupa).
 * offer: { storeId, sellerId?, sku?, url }
 */
export function offerDedupeKey(offer) {
  const store = norm(offer?.storeId);
  const seller = norm(offer?.sellerId);
  if (!store) return { key: null, basis: 'none', reason: 'sem loja' };
  const sku = norm(offer?.sku);
  const c = canonicalizeUrl(offer?.url);
  const scope = `${store}|${seller}`;
  if (sku) return { key: `${scope}|sku:${sku}`, basis: 'sku', reason: 'mesma loja, vendedor e SKU', canonicalUrl: c.canonical };
  if (c.valid) return { key: `${scope}|url:${c.canonical}`, basis: 'url', reason: 'mesma loja, vendedor e URL canônica (query relevante mantida)', canonicalUrl: c.canonical };
  return { key: null, basis: 'none', reason: 'URL inválida e sem SKU: não agrupa', canonicalUrl: null };
}

/** Agrupa ofertas pela chave. Ofertas sem chave ficam em `ungrouped` (nunca são colapsadas). */
export function groupDuplicateOffers(offers) {
  const groups = new Map();
  const ungrouped = [];
  for (const o of offers || []) {
    const k = offerDedupeKey(o);
    if (!k.key) { ungrouped.push(o); continue; }
    if (!groups.has(k.key)) groups.set(k.key, { key: k.key, basis: k.basis, reason: k.reason, offers: [] });
    groups.get(k.key).offers.push(o);
  }
  const all = [...groups.values()];
  return { groups: all, duplicates: all.filter((g) => g.offers.length > 1), ungrouped };
}
