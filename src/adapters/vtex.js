// VTEX: API pública de catálogo + simulação de frete por CEP (orderForms/simulation).
import { getJson, request } from '../http.js';
import { guard, searchTerms } from './common.js';

export async function detect(base) {
  try { const j = await getJson(`${base}/api/catalog_system/pub/products/search?ft=pokemon&_from=0&_to=0`); return Array.isArray(j); } catch (e) { if (e.blocked && e.status === 429) throw e; return false; /* 401/403 numa rota de teste = não é essa plataforma; o bloqueio real aparece na home */ }
}

const PAGE_SIZE = 50; // a API pública devolve no máximo 50 produtos por chamada (_from/_to)
const MAX_PAGES = 10; // teto de páginas por termo; ao atingi-lo com página cheia, a leitura fica parcial
const PARTIAL_PAGES = `VTEX: teto de ${MAX_PAGES} páginas por termo atingido; resultados podem estar incompletos`;

export async function search(store, catalog) {
  const base = store.url.replace(/\/$/, ''); const out = new Map(); let partial = null;
  for (const term of ['pokemon', ...searchTerms(catalog)]) for (let page = 0; ; page++) {
    const url = `${base}/api/catalog_system/pub/products/search?ft=${encodeURIComponent(term)}&_from=${page * PAGE_SIZE}&_to=${page * PAGE_SIZE + PAGE_SIZE - 1}`;
    await guard(url);
    const arr = await getJson(url);
    // Só o vendedor padrão: é o preço que a página do link mostra. Vendedor secundário do marketplace
    // tem outro preço na mesma página, e publicar o dele levaria o visitante a um valor diferente.
    for (const p of Array.isArray(arr) ? arr : []) for (const it of p.items || []) for (const s of (it.sellers || []).filter((x, _, all) => !all.some((y) => y.sellerDefault) || x.sellerDefault)) {
      // Link só http(s) (senão o linkText na própria loja); preço só número positivo (texto, zero ou negativo = sem preço).
      const link = typeof p.link === 'string' && /^https?:\/\//i.test(p.link) ? p.link : p.linkText ? `${base}/${p.linkText}/p` : null;
      // Sem nome de produto não há como identificar a oferta: não vira título "undefined".
      if (!link || typeof p.productName !== 'string' || !p.productName.trim()) continue;
      const o = s.commertialOffer || {};
      const qty = Number(o.AvailableQuantity ?? 0);
      const price = typeof o.Price === 'number' && Number.isFinite(o.Price) && o.Price > 0 ? o.Price : null;
      // Nome do SKU só se for texto: SKU sem nome fica com o nome do produto (nunca "… undefined").
      const skuName = p.items.length > 1 && typeof it.name === 'string' ? it.name.trim() : '';
      const l = {
        title: p.productName + (skuName ? ' ' + skuName : ''),
        url: link + (p.items.length > 1 ? `?skuId=${it.itemId}` : ''),
        price: { base: price }, listPrice: price && typeof o.ListPrice === 'number' && Number.isFinite(o.ListPrice) && o.ListPrice > price ? o.ListPrice : null,
        stock: qty > 0 && o.IsAvailable !== false && price ? 'IN_STOCK' : 'OUT_OF_STOCK', quantity: qty > 0 && qty < 99999 ? qty : null,
        sku: it.itemId, ean: it.ean || null, image: it.images?.[0]?.imageUrl || null, seller: s.sellerName || null, sellerId: s.sellerId, sourceType: 'store_api',
        _vtex: { base, itemId: it.itemId, sellerId: s.sellerId },
      };
      out.set(l.url + '|' + s.sellerId, l);
    }
    if (!Array.isArray(arr) || arr.length < PAGE_SIZE) break;
    if (page + 1 >= MAX_PAGES) { partial = PARTIAL_PAGES; break; }
  }
  const r = [...out.values()]; if (partial) r.partial = partial; return r;
}

export async function shipping(listing, cep) {
  const { base, itemId, sellerId } = listing._vtex;
  const url = `${base}/api/checkout/pub/orderForms/simulation?sc=1`; await guard(url);
  const r = await request(url, { method: 'POST', accept: 'application/json', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ items: [{ id: itemId, quantity: 1, seller: sellerId }], postalCode: cep.replace(/\D/g, ''), country: 'BRA' }) });
  // Sem opção de entrega (ou preço ilegível) é falha da simulação, com motivo: quem chama decide (nunca inventa frete).
  const slas = r.json()?.logisticsInfo?.[0]?.slas || [];
  const prices = slas.map((s) => s?.price).filter((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0);
  if (!prices.length) throw new Error(slas.length ? 'simulação de frete sem preço legível' : 'simulação de frete sem opção de entrega para o CEP');
  return Math.min(...prices) / 100;
}
