// Compartilhado pelas funções de SEO. Mesmo algoritmo de URL do site (tools/page.template.html: buildSlugs).
export const RAW = 'https://raw.githubusercontent.com/tonywatanabe-dev/pokemon-price-hunter/data/data/state.json';
export const SITE = 'https://tcg-price-hunter.vercel.app';
const norm = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const slugify = (t) => norm(t).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
export const label = (p) => p.typeLabel + (p.boosters && (p.type === 'booster_box' || p.type === 'combo') ? ` ${p.boosters}` : '') + (p.variant ? ` ${p.variant}` : '');
export function slugs(products) {
  const by = {}, of = {};
  for (const p of [...products].sort((a, b) => (b.offerCount || 0) - (a.offerCount || 0) || a.id.localeCompare(b.id))) {
    const base = slugify(p.collectionName + ' ' + label(p)) || slugify(p.id); let s = base, i = 2;
    while (by[s]) s = base + '-' + i++;
    by[s] = p.id; of[p.id] = s;
  }
  return { by, of };
}
let cache = { t: 0, s: null };
export async function state() {
  if (cache.s && Date.now() - cache.t < 10 * 60e3) return cache.s;
  const r = await fetch(RAW); if (!r.ok) throw new Error('state ' + r.status);
  cache = { t: Date.now(), s: await r.json() }; return cache.s;
}
export const live = (o) => o.stock === 'IN_STOCK' && !o.stale && !o.anomalous && o.total > 0;
