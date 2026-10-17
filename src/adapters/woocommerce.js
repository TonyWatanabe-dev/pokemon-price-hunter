// WooCommerce: Store API pública (/wp-json/wc/store/v1/products), sem chave. Busca "pokemon" (e "copag"), paginada,
// com preço em unidades mínimas e estoque (is_in_stock). Substitui a varredura de sitemap do JSON-LD nas lojas Woo:
// 1 a poucas requisições em vez de dezenas de páginas por rodada. Mesmo guard (robots.txt) dos outros adaptadores.
import { getJson } from '../http.js';
import { guard } from './common.js';

export const PER_PAGE = 100; export const MAX_PAGES = 4; export const TERMS = Object.freeze(['pokemon', 'copag']);
const api = (base, q) => `${base}/wp-json/wc/store/v1/products?${new URLSearchParams(q)}`;

export async function detect(base) {
  try { const url = api(base, { per_page: '1' }); await guard(url); const j = await getJson(url); return Array.isArray(j); }
  catch (e) { if (e.blocked && e.status === 429) throw e; return false; }
}

/** Preço da Store API: string em unidades mínimas ("34990") com currency_minor_unit (2) → 349.9. null se inválido. */
export function preco(p, campo = 'price') {
  const raw = p?.prices?.[campo]; const mu = Number(p?.prices?.currency_minor_unit ?? 2);
  if (raw == null || raw === '' || !/^\d+$/.test(String(raw)) || !Number.isInteger(mu) || mu < 0 || mu > 4) return null;
  const v = Number(raw) / 10 ** mu; return v > 0 ? Math.round(v * 100) / 100 : null;
}
const httpHref = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; } };
const txt = (s) => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#8211;|&ndash;/g, '-').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();

export function toListing(p) {
  const url = httpHref(p?.permalink); const title = txt(p?.name);
  if (!url || !title) return null;
  if (p?.prices?.currency_code && p.prices.currency_code !== 'BRL') return null;
  const price = preco(p, 'price'); const reg = preco(p, 'regular_price');
  return {
    title, url, price: { base: price }, listPrice: reg && price && reg > price ? reg : null,
    stock: p.is_in_stock === true ? 'IN_STOCK' : p.is_in_stock === false ? 'OUT_OF_STOCK' : 'UNKNOWN', quantity: null,
    sku: p.sku || null, ean: null, seller: null, sourceType: 'store_api',
    image: httpHref(p.images?.[0]?.src) || null,
  };
}

export async function search(store) {
  const base = store.url.replace(/\/$/, ''); const out = new Map();
  for (const term of TERMS) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = api(base, { search: term, per_page: String(PER_PAGE), page: String(page) }); await guard(url);
      let list;
      list = await getJson(url);
      if (!Array.isArray(list) || !list.length) break;
      for (const p of list) { if (p?.type === 'variable' && !p.prices?.price) continue; const l = toListing(p); if (l) out.set(l.url, l); }
      if (list.length < PER_PAGE) break;
    }
  }
  return [...out.values()];
}
