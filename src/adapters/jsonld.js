// Genérico: sitemap -> páginas de produto -> JSON-LD Product / Open Graph. Funciona em Nuvemshop, Tray, Loja Integrada, WooCommerce etc.
import { get } from '../http.js';
import { guard, brl, findPix } from './common.js';

const PRODUCT_URL = /pokemon/i;
const SEALED_HINT = /(booster|box|display|caixa|combo|kit|treinador|etb|elite|blister|colecao|cole%c3%a7%c3%a3o)/i;

export async function productUrls(base, max = 60) {
  const seen = new Set(); const queue = [`${base}/sitemap.xml`]; const urls = [];
  while (queue.length && seen.size < 15 && urls.length < max) {
    const sm = queue.shift(); if (seen.has(sm)) continue; seen.add(sm);
    try { await guard(sm); } catch { continue; }
    let xml; try { xml = (await get(sm, { accept: 'application/xml' })).text; } catch { continue; }
    for (const [, loc] of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
      if (/\.xml(\.gz)?$/i.test(loc)) { if (/product|produto|sitemap/i.test(loc)) queue.push(loc); }
      else if (PRODUCT_URL.test(loc) && SEALED_HINT.test(loc)) urls.push(loc);
    }
  }
  return [...new Set(urls)].slice(0, max);
}

function flatten(node, acc = []) {
  if (Array.isArray(node)) node.forEach((n) => flatten(n, acc));
  else if (node && typeof node === 'object') { acc.push(node); if (node['@graph']) flatten(node['@graph'], acc); }
  return acc;
}
const AVAIL = { instock: 'IN_STOCK', outofstock: 'OUT_OF_STOCK', soldout: 'OUT_OF_STOCK', preorder: 'PRE_ORDER', presale: 'PRE_ORDER', backorder: 'PRE_ORDER', discontinued: 'UNAVAILABLE', limitedavailability: 'IN_STOCK', instoreonly: 'UNAVAILABLE' };

export function parseProductPage(html, url) {
  const nodes = [];
  for (const [, raw] of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) { try { flatten(JSON.parse(raw.trim()), nodes); } catch { /* JSON-LD inválido */ } }
  const meta = (p) => html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]+content=["']([^"']+)`, 'i'))?.[1];
  // Páginas de loja costumam trazer vários Product (relacionados, "compre junto"). Fica com o da própria página:
  // mesma URL, ou mesmo nome do og:title / <title>. Na dúvida com vários, usa o primeiro só se os nomes baterem.
  const prods = nodes.filter((n) => [].concat(n['@type']).some((t) => /product/i.test(t)));
  const norm = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const path = (u) => { try { return new URL(u, url).pathname.replace(/\/$/, ''); } catch { return ''; } };
  const pageTitle = meta('og:title') || html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || '';
  const here = path(url);
  let prod = prods.find((n) => [n.url, n['@id'], n.offers?.url].some((u) => u && path(u) === here));
  const sim = (x, y) => { const A = new Set(norm(x).split(' ').filter((w) => w.length > 1)); const B = new Set(norm(y).split(' ').filter((w) => w.length > 1)); if (!A.size || !B.size) return 0; let k = 0; for (const w of A) if (B.has(w)) k++; return k / Math.min(A.size, B.size); };
  const TYPEW = /^(blister|box|display|combo|treinador|avancado|etb|lata|latas|minilata|booster|colecao|deck|baralho|unitario|simples|duplo|triplo|quadruplo|premium|ilustracao|poster|fichario|kit|\d{1,3})$/;
  const tw = (t) => new Set(norm(t).split(' ').filter((w) => TYPEW.test(w)));
  const sameAsPage = (n) => { if (!pageTitle) return true; const pt = tw(pageTitle), nt = tw(n.name); for (const w of pt) if (!nt.has(w)) return false; return sim(n.name, pageTitle) >= 0.5; };
  if (prod && !sameAsPage(prod) && !(prods.length === 1 && !pageTitle)) prod = sameAsPage(prod) ? prod : (prods.find((n) => n.name && sameAsPage(n)) || null);
  if (!prod) prod = prods.find((n) => n.name && pageTitle && sameAsPage(n)) || (prods.length === 1 && sameAsPage(prods[0]) ? prods[0] : null);
  let title = prod?.name || meta('og:title'); let price = null; let stock = 'UNKNOWN'; let ean = prod?.gtin13 || prod?.gtin || null; let sku = prod?.sku || null; let quantity = null;
  if (prod) {
    const offers = [].concat(prod.offers || []).flatMap((o) => (o['@type'] === 'AggregateOffer' && o.offers ? [].concat(o.offers) : [o]));
    const o = offers.find((x) => x && (x.priceCurrency || 'BRL') === 'BRL') || offers[0];
    if (o) {
      price = brl(o.price ?? o.lowPrice ?? o.priceSpecification?.price);
      const av = String(o.availability || '').split('/').pop().toLowerCase();
      stock = AVAIL[av] || 'UNKNOWN';
      if (o.inventoryLevel?.value != null) quantity = Number(o.inventoryLevel.value);
    }
  }
  if (price == null) price = brl(meta('product:price:amount') || meta('og:price:amount'));
  if (stock === 'UNKNOWN') { const a = (meta('product:availability') || meta('og:availability') || '').toLowerCase().replace(/\s/g, ''); stock = AVAIL[a] || (a === 'instock' ? 'IN_STOCK' : 'UNKNOWN'); }
  if (!title) return null;
  let image = prod?.image; if (Array.isArray(image)) image = image[0]; if (image && typeof image === 'object') image = image.url || image.contentUrl;
  image = image || meta('og:image') || null;
  try { image = image ? new URL(String(image), url).href : null; } catch { image = null; }
  return { title: String(title).trim(), url, image, price: { pix: findPix(html), base: price }, stock, quantity, sku, ean, seller: null, sourceType: prod ? 'json_ld' : 'open_graph' };
}

export async function detect(base) {
  try { await guard(base + '/'); const html = (await get(base + '/')).text; return /pok[eé]mon/i.test(html); } catch (e) { if (e.blocked) throw e; return false; }
}

export async function search(store) {
  const base = store.url.replace(/\/$/, '');
  const urls = store.plannedUrls || [...new Set([...(store.productUrls || []), ...(await productUrls(base, store.maxPages || 60))])];
  const out = [];
  for (const u of urls) {
    try { await guard(u); const r = await get(u); const l = parseProductPage(r.text, r.url); if (l) out.push(l); }
    catch (e) { if (e.blocked && e.status !== 'robots' && e.status !== 'unreachable') throw e; }
  }
  return out;
}
