// Shopify: busca preditiva (leve) com fallback para /products.json paginado.
import { getJson } from '../http.js';
import { guard, brl, searchTerms } from './common.js';

export async function detect(base) {
  try { const j = await getJson(base + '/products.json?limit=1'); return Array.isArray(j.products); } catch (e) { if (e.blocked && e.status === 429) throw e; return false; /* 401/403 numa rota de teste = não é essa plataforma; o bloqueio real aparece na home */ }
}

const absImg = (base, u) => { if (!u || typeof u !== 'string') return null; try { return new URL(u.startsWith('//') ? 'https:' + u : u, base).href; } catch { return null; } };
// Link só http(s): "javascript:", "data:" etc. vindos da loja caem para o handle; sem nenhum dos dois, não há oferta.
const httpHref = (u, base) => { try { const x = new URL(u, base); return /^https?:$/.test(x.protocol) ? x.href.split('?')[0] : null; } catch { return null; } };
function toListing(base, p, v, multi) {
  const link = (p.url && httpHref(p.url, base)) || (p.handle ? `${base}/products/${p.handle}` : null);
  // Sem título não há como identificar o produto (nem casar com o catálogo): não vira oferta "undefined".
  if (!link || typeof p.title !== 'string' || !p.title.trim()) return null;
  return {
    title: p.title + (multi && v.title && v.title !== 'Default Title' ? ' ' + v.title : ''),
    url: link + (multi && v.id ? `?variant=${v.id}` : ''),
    price: { base: brl(v.price ?? p.price) }, listPrice: brl(v.compare_at_price ?? p.compare_at_price_max) || null,
    stock: v.available === true ? 'IN_STOCK' : v.available === false ? 'OUT_OF_STOCK' : 'UNKNOWN', quantity: null,
    sku: v.sku || null, ean: v.barcode || null, seller: null, sourceType: 'store_json',
    image: absImg(base, v.featured_image?.src || p.featured_image?.url || p.featured_image || p.image || p.images?.[0]?.src || p.images?.[0]),
  };
}

export async function search(store, catalog) {
  const base = store.url.replace(/\/$/, ''); const out = new Map();
  let suggestWorks = true;
  for (const term of searchTerms(catalog)) {
    const url = `${base}/search/suggest.json?q=${encodeURIComponent(term)}&resources[type]=product&resources[limit]=10`;
    await guard(url);
    try {
      const j = await getJson(url);
      for (const p of j?.resources?.results?.products || []) {
        const vs = p.variants?.length ? p.variants : [{ price: p.price, available: p.available }];
        for (const v of vs) { const l = toListing(base, p, v, vs.length > 1); if (l) out.set(l.url, l); }
      }
    } catch (e) { if (e.blocked) throw e; suggestWorks = false; break; }
  }
  if (suggestWorks) return [...out.values()];
  for (let page = 1; page <= 8; page++) {
    const url = `${base}/products.json?limit=250&page=${page}`; await guard(url);
    const { products = [] } = await getJson(url); if (!products.length) break;
    for (const p of products) {
      if (!/pok[eé]mon/i.test(`${p.title} ${p.product_type} ${p.tags} ${p.vendor}`)) continue;
      for (const v of p.variants || []) { const l = toListing(base, p, v, p.variants.length > 1); if (l) out.set(l.url, l); }
    }
  }
  return [...out.values()];
}
