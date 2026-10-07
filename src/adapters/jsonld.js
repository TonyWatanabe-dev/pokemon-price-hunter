// Genérico: sitemap -> páginas de produto -> JSON-LD Product / Open Graph. Funciona em Nuvemshop, Tray, Loja Integrada, WooCommerce etc.
import { get } from '../http.js';
import { guard, brl } from './common.js';

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

const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const TYPEW = /^(blister|box|display|combo|treinador|avancado|etb|lata|latas|minilata|booster|colecao|deck|baralho|unitario|simples|duplo|triplo|quadruplo|premium|ilustracao|poster|fichario|kit|\d{1,3})$/;
const words = (t) => new Set(norm(t).split(' ').filter((w) => w.length > 1));
/** Similaridade simétrica (Jaccard) entre dois nomes: 1 = mesmas palavras. */
export function nameSim(x, y) { const A = words(x), B = words(y); if (!A.size || !B.size) return 0; let k = 0; for (const w of A) if (B.has(w)) k++; return k / (A.size + B.size - k); }
const typeWords = (t) => new Set(norm(t).split(' ').filter((w) => TYPEW.test(w)));
// Título da página costuma vir encurtado ou com o nome da loja: "Blister Chikorita - Loja X".
const core = (t) => String(t || '').split(/\s+[|–—]\s+|\s+-\s+(?=[^-]*$)/)[0];
const contained = (small, big) => { const A = words(core(small)), B = words(big); if (A.size < 2) return false; for (const w of A) if (!B.has(w)) return false; return true; };
const agrees = (name, page) => !page || (sameTypeWords(name, page) && nameSim(name, page) >= 0.6) || contained(page, name) || contained(name, page);
const sameTypeWords = (a, b) => { const A = typeWords(a), B = typeWords(b); if (A.size !== B.size) return false; for (const w of A) if (!B.has(w)) return false; return true; };
const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&');
const strip = (html) => html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
// Tudo depois destes marcadores é vitrine de outros produtos: nunca serve de fonte de preço.
const RELATED = /(produtos relacionados|voc[eê] tamb[eé]m (pode gostar|vai gostar)|quem viu (este|esse) produto|compre junto|produtos similares|veja tamb[eé]m|aproveite tamb[eé]m)/i;
const mainText = (html) => { const t = strip(html); const i = t.search(RELATED); return i > 0 ? t.slice(0, i) : t; };
const pixMentioned = (html) => /(pagando (com|no|via) pix|(com|no|via|pelo) pix|pix\s*\d+\s*%)/i.test(strip(html));

/** Nuvemshop: LS.product (produto da página) + LS.variants (preço, estoque). */
function nuvemshop(html) {
  const id = html.match(/LS\.product\s*=\s*\{\s*id\s*:\s*(\d+)/)?.[1];
  const raw = html.match(/LS\.variants\s*=\s*(\[[\s\S]*?\]);\s*\n/)?.[1];
  if (!id || !raw) return null;
  let vs; try { vs = JSON.parse(raw); } catch { return null; }
  vs = vs.filter((v) => String(v.product_id) === id && v.is_visible !== false);
  if (!vs.length) return null;
  const avail = vs.filter((v) => v.available);
  const pool = avail.length ? avail : vs;
  const prices = [...new Set(pool.map((v) => v.price_number))];
  if (prices.length > 1) return { ambiguous: 'variações com preços diferentes' };
  const v = pool[0];
  const base = brl(v.price_number); const pixV = brl(v.price_with_payment_discount_short);
  const pix = pixV && base && pixV < base && pixV >= base * 0.8 && pixMentioned(html) ? pixV : null;
  const stock = avail.length ? 'IN_STOCK' : 'OUT_OF_STOCK';
  const quantity = avail.length && avail.every((x) => Number.isFinite(x.stock)) ? avail.reduce((a, x) => a + x.stock, 0) : null;
  const name = html.match(/LS\.product\s*=\s*\{[\s\S]*?name\s*:\s*'((?:[^'\\]|\\.)*)'/)?.[1]?.replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\(.)/g, '$1');
  return { platform: 'nuvemshop', name, price: { pix, base }, listPrice: brl(v.compare_at_price_number) || null, stock, quantity, sku: v.sku || null };
}

/** Preço no Pix só quando aparece logo depois do preço do próprio produto (até ~250 caracteres), antes da vitrine. */
function pixNear(html, base) {
  if (!(base > 0)) return null;
  const t = mainText(html); const b = base.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  for (let i = t.indexOf(b); i >= 0; i = t.indexOf(b, i + 1)) {
    const w = t.slice(i + b.length, i + b.length + 250);
    const m = w.match(/R\$\s?([\d.]+,\d{2})\s*(?:\(?\s*)?(?:no|via|pelo|com|à vista no|a vista no|pagando (?:no|com))\s*pix/i) || w.match(/pix[^R]{0,40}R\$\s?([\d.]+,\d{2})/i);
    if (m) { const v = brl(m[1]); if (v < base && v >= base * 0.8) return v; }
  }
  return null;
}

/** Loja Integrada e outras com microdata: só quando a página tem UM bloco de preço (o do produto). */
function microdata(html) {
  const ps = [...html.matchAll(/itemprop=["']price["'][^>]*content=["']([^"']+)/gi)];
  if (ps.length !== 1) return null;
  const base = brl(ps[0][1]);
  const av = html.match(/itemprop=["']availability["'][^>]*content=["']([^"']+)/i)?.[1]?.split('/').pop().toLowerCase();
  const pix = pixNear(html, base);
  return { platform: 'microdata', price: { pix, base }, stock: AVAIL[av] || 'UNKNOWN' };
}

const fmtBR = (v) => v.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
/** Onde o preço aparece escrito no texto principal da página: { pix: bool, regular: número | null } ou null se não aparece. */
export function visiblePrice(html, value) {
  const t = mainText(html).replace(/&#0?82;&#0?36;/g, 'R$'); const b = fmtBR(value);
  const re = new RegExp('R\\$\\s?' + b.replace(/\./g, '\\.') + '(?!\\d)', 'g');
  let found = null; let seen = false;
  for (const m of t.matchAll(re)) {
    seen = true;
    const after = t.slice(m.index + m[0].length, m.index + m[0].length + 30); const before = t.slice(Math.max(0, m.index - 140), m.index);
    const isPix = /^\s*(\(?\s*)?(via|no|pelo|com|à vista no|a vista no|pagando (no|com))?\s*pix/i.test(after) || /(pix|à vista|a vista)[^R]{0,25}$/i.test(before);
    if (!isPix) continue;
    const prev = [...before.matchAll(/R\$\s?([\d.]+,\d{2})/g)].map((x) => brl(x[1])).filter((v) => v > value && v <= value * 1.25);
    if (!found || (!found.regular && prev.length)) found = { pix: true, regular: prev.length ? prev[prev.length - 1] : null };
  }
  // Rótulo de Pix só vale quando a página também mostra o preço normal (maior); sem ele, fica como preço da loja.
  return seen ? (found?.regular ? found : { pix: false, regular: null }) : null;
}

export function parseProductPage(html, url) {
  const nodes = [];
  for (const [, raw] of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) { try { flatten(JSON.parse(raw.trim()), nodes); } catch { /* JSON-LD inválido */ } }
  const meta = (p) => { const v = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]+content=["']([^"']+)`, 'i'))?.[1] || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${p}["']`, 'i'))?.[1]; return v ? unesc(v) : v; };
  const path = (u) => { try { return decodeURIComponent(new URL(u, url).pathname).replace(/\/$/, '').toLowerCase(); } catch { return ''; } };
  const here = path(url);
  const pageTitle = meta('og:title') || unesc(html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || '').trim();
  // Regra: o produto publicado é o da página. Produto do JSON-LD que aponta para outro link é vitrine ("relacionados") e é descartado.
  const urlsOf = (n) => [n.url, n['@id'], ...[].concat(n.offers || []).map((o) => o?.url)].filter((u) => typeof u === 'string' && /^(https?:|\/)/.test(u));
  const prods = nodes.filter((n) => [].concat(n['@type']).some((t) => /^product$/i.test(String(t))));
  const own = prods.filter((n) => urlsOf(n).some((u) => path(u) === here));
  const foreign = (n) => urlsOf(n).some((u) => path(u) !== here);
  let prod = own.find((n) => agrees(n.name, pageTitle)) || null;
  if (!prod) {
    // Sem URL: só aceita se for o único Product sem link e o nome bater com o título da página.
    const loose = prods.filter((n) => !foreign(n) && n.name);
    if (loose.length === 1 && agrees(loose[0].name, pageTitle)) prod = loose[0];
  }
  const ns = nuvemshop(html);
  if (ns?.ambiguous) return null;
  let title = (ns?.name || prod?.name || pageTitle || '').trim();
  if (!title) return null;
  // Título do produto escolhido precisa concordar com o título da página (pega tema que injeta outro produto).
  if (pageTitle && title !== pageTitle && !agrees(title, pageTitle)) return null;
  let price = { pix: null, base: null }; let listPrice = null; let stock = 'UNKNOWN'; let quantity = null;
  let ean = prod?.gtin13 || prod?.gtin || null; let sku = prod?.sku || null; let sourceType = 'open_graph';
  if (ns) { price = ns.price; listPrice = ns.listPrice; stock = ns.stock; quantity = ns.quantity; sku = ns.sku || sku; sourceType = 'store_page'; }
  else if (prod) {
    const offers = [].concat(prod.offers || []).flatMap((o) => (o['@type'] === 'AggregateOffer' && o.offers ? [].concat(o.offers) : [o]));
    const o = offers.find((x) => x && (x.priceCurrency || 'BRL') === 'BRL') || offers[0];
    if (o) {
      price.base = brl(o.price ?? o.priceSpecification?.price ?? (o['@type'] === 'AggregateOffer' && o.lowPrice === o.highPrice ? o.lowPrice : null));
      const av = String(o.availability || '').split('/').pop().toLowerCase();
      stock = AVAIL[av] || 'UNKNOWN';
      if (o.inventoryLevel?.value != null) quantity = Number(o.inventoryLevel.value);
    }
    sourceType = 'json_ld';
    price.pix = pixNear(html, price.base);
  } else {
    const md = microdata(html);
    if (md) { price = md.price; stock = md.stock; sourceType = 'microdata'; }
    else {
      price.base = brl(meta('product:price:amount') || meta('og:price:amount'));
      const a = (meta('product:availability') || meta('og:availability') || '').toLowerCase().replace(/[\s_-]/g, '');
      stock = AVAIL[a] || 'UNKNOWN';
    }
  }
  // Sem preço do próprio produto não publica (nunca usa preço de parcela ou de vitrine).
  if (!(price.base > 0)) return null;
  // O preço publicado precisa estar ESCRITO na página do produto (antes da vitrine). Loja que só mostra
  // "Fale conosco" ou esconde o preço não entra, mesmo que o código da página traga um número.
  const shown = visiblePrice(html, price.base);
  if (!shown && stock !== 'OUT_OF_STOCK') return null; // esgotado pode esconder o preço: entra só como "sem estoque"
  // Várias plataformas (Loja Integrada, WooCommerce) põem no código o preço do Pix como se fosse o preço normal.
  // Se a página escreve esse valor como Pix/à vista e mostra um preço maior logo antes, separamos os dois.
  if (shown?.pix && !price.pix) price = { pix: price.base, base: shown.regular || price.base };
  let image = prod?.image; if (Array.isArray(image)) image = image[0]; if (image && typeof image === 'object') image = image.url || image.contentUrl;
  image = image || meta('og:image') || null;
  try { image = image ? new URL(String(image), url).href : null; } catch { image = null; }
  return { title, url, image, price, listPrice, stock, quantity, sku, ean, seller: null, sourceType };
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
