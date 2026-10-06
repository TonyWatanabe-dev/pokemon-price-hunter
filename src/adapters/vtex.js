// VTEX: API pública de catálogo + simulação de frete por CEP (orderForms/simulation).
import { getJson, request } from '../http.js';
import { guard, searchTerms } from './common.js';

export async function detect(base) {
  try { const j = await getJson(`${base}/api/catalog_system/pub/products/search?ft=pokemon&_from=0&_to=0`); return Array.isArray(j); } catch (e) { if (e.blocked) throw e; return false; }
}

export async function search(store, catalog) {
  const base = store.url.replace(/\/$/, ''); const out = new Map();
  for (const term of searchTerms(catalog)) {
    const url = `${base}/api/catalog_system/pub/products/search?ft=${encodeURIComponent(term)}&_from=0&_to=49`;
    await guard(url);
    const arr = await getJson(url);
    for (const p of Array.isArray(arr) ? arr : []) for (const it of p.items || []) for (const s of it.sellers || []) {
      const o = s.commertialOffer || {};
      const qty = Number(o.AvailableQuantity ?? 0);
      const l = {
        title: p.productName + (p.items.length > 1 ? ' ' + it.name : ''),
        url: (p.link || `${base}/${p.linkText}/p`) + (p.items.length > 1 ? `?skuId=${it.itemId}` : ''),
        price: { base: o.Price > 0 ? o.Price : null }, listPrice: o.ListPrice > o.Price ? o.ListPrice : null,
        stock: qty > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK', quantity: qty > 0 && qty < 99999 ? qty : null,
        sku: it.itemId, ean: it.ean || null, seller: s.sellerName || null, sellerId: s.sellerId, sourceType: 'store_api',
        _vtex: { base, itemId: it.itemId, sellerId: s.sellerId },
      };
      out.set(l.url + '|' + s.sellerId, l);
    }
  }
  return [...out.values()];
}

export async function shipping(listing, cep) {
  const { base, itemId, sellerId } = listing._vtex;
  const url = `${base}/api/checkout/pub/orderForms/simulation?sc=1`; await guard(url);
  const r = await request(url, { method: 'POST', accept: 'application/json', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ items: [{ id: itemId, quantity: 1, seller: sellerId }], postalCode: cep.replace(/\D/g, ''), country: 'BRA' }) });
  const slas = r.json()?.logisticsInfo?.[0]?.slas || [];
  if (!slas.length) return null;
  return Math.min(...slas.map((s) => s.price)) / 100;
}
