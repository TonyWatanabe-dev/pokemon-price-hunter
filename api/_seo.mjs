// Compartilhado pelas funções de SEO. Mesmo algoritmo de URL do site (tools/page.template.html: buildSlugs).
import { byComparableTotal } from './_lib/offer-rank.mjs';
import { classify, usable, stateDataAt } from './_lib/freshness.mjs';
export const RAW = 'https://raw.githubusercontent.com/tonywatanabe-dev/pokemon-price-hunter/data/data/state.json';
export const SITE = 'https://tcgpricehunter.com.br';
const norm = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const slugify = (t) => norm(t).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
// Importado (id terminado em -en/-ja/-zh/-ko, ver src/match.js): o idioma entra no rótulo e no slug, para nunca
// disputar o slug do produto em português.
export const LANG_NAME = { en: 'Inglês', ja: 'Japonês', zh: 'Chinês', ko: 'Coreano' };
export const LANG_TAG = { pt: 'pt-BR', en: 'en', ja: 'ja', zh: 'zh', ko: 'ko' };
export const langOf = (p) => (String(p?.id || '').match(/-(en|ja|zh|ko)$/) || [])[1] || 'pt';
export const label = (p) => p.typeLabel + (p.boosters && (p.type === 'booster_box' || p.type === 'combo') ? ` ${p.boosters}` : '') + (p.variant ? ` ${p.variant}` : '') + (langOf(p) !== 'pt' ? ` ${LANG_NAME[langOf(p)]}` : '');
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
// Prazo do download do state.json (cabeçalhos + corpo): GitHub raw pendurado não pode segurar a página nem o sitemap até
// a plataforma derrubar a função. Estourou = mesma falha de rede de antes: cai no último state bom ainda em dia, ou lança.
export const STATE_TIMEOUT_MS = 5000;
export async function state({ timeoutMs = STATE_TIMEOUT_MS } = {}) {
  if (cache.s && Date.now() - cache.t < 10 * 60e3) return cache.s;
  try {
    const r = await fetch(RAW, { signal: AbortSignal.timeout(timeoutMs) }); if (!r.ok) throw new Error('state ' + r.status);
    cache = { t: Date.now(), s: await r.json() }; return cache.s;
  } catch (e) {
    // Falha do GitHub raw (429/5xx, rede): usa o último state bom enquanto ele ainda estiver dentro do frescor
    // (docs/auditorias/paginas-servidor.md §4, proposta 5). Sem cache ou com cache velho, lança como antes.
    if (cache.s && usable(classify(stateDataAt(cache.s)))) return cache.s;
    throw e;
  }
}
export const live = (o) => o.stock === 'IN_STOCK' && !o.stale && !o.anomalous && o.total > 0;

// ---- Páginas de coleção e de formato (mesmo algoritmo do site: tools/page.template.html) ----
export const slugifyT = slugify;
export const colSlug = (c) => slugify(c.name);
export const typeSlug = (t) => slugify(t.label);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const brl = (v) => v == null ? '' : 'R$ ' + Number(v).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
export const pct = (d) => (d * 100).toFixed(1).replace('.', ',').replace(/,0$/, '') + '%';
/** Melhor oferta com estoque de cada produto (menor total comparável: frete desconhecido não vence frete conhecido,
 *  issue #84 — ver _lib/offer-rank.mjs), e quantas lojas têm estoque. */
export function bestBy(s) {
  const by = {}, n = {};
  for (const o of s.offers || []) { if (!live(o)) continue; n[o.productId] = (n[o.productId] || 0) + 1; if (!by[o.productId] || byComparableTotal(o, by[o.productId]) < 0) by[o.productId] = o; }
  return { by, n };
}
export const pix = (o) => (o && o.priceKind === 'pix' ? ' no Pix' : '');
