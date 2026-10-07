// Mercado Livre: só via API oficial com token OAuth (ML_ACCESS_TOKEN). Sem token = BLOCKED, sem scraping.
import { getJson, BlockedError } from '../http.js';
import { searchTerms } from './common.js';

export async function search(store, catalog) {
  const token = process.env.ML_ACCESS_TOKEN;
  if (!token) throw new BlockedError('Mercado Livre exige token OAuth (ML_ACCESS_TOKEN); a busca pública retorna 403 desde 2025', 'auth');
  const out = new Map();
  for (const term of searchTerms(catalog).map((t) => t + ' copag lacrado')) {
    const j = await getJson(`https://api.mercadolibre.com/sites/MLB/search?q=${encodeURIComponent(term)}&limit=50`, { headers: { authorization: `Bearer ${token}` } });
    for (const r of j.results || []) {
      if (r.condition && r.condition !== 'new') continue;
      out.set(r.id, {
        title: r.title, url: r.permalink, price: { base: r.price }, listPrice: r.original_price || null,
        stock: r.available_quantity > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK', quantity: r.available_quantity > 1 ? r.available_quantity : null,
        shipping: r.shipping?.free_shipping ? 0 : null, sku: r.id, ean: null, image: r.thumbnail ? r.thumbnail.replace(/^http:/, 'https:') : null,
        seller: r.official_store_name || r.seller?.nickname || String(r.seller?.id || ''), sellerId: r.seller?.id,
        sellerKind: r.official_store_id ? 'official_store' : 'marketplace_seller', sourceType: 'official_api',
      });
    }
  }
  return [...out.values()];
}
