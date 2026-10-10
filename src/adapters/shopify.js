// Shopify: /products.json paginado (no máximo 3 páginas) com fallback para a busca preditiva.
import { getJson, netCode } from '../http.js';
import { guard, brl, searchTerms } from './common.js';
import { normalize, detectCollection } from '../match.js';

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

// Filtro do /products.json: só reduz volume, quem decide é o matchProduct (a jusante). Muita loja não escreve "Pokémon"
// no título ("Booster - Megaevolução 4 Caos Ascendente", mox.land): aceita também o título que cita uma coleção do
// catálogo (os mesmos nomes que a busca preditiva usava), com a mesma regra do matchProduct (detectCollection).
const citesCollection = (title, catalog) => {
  if (typeof title !== 'string') return false;
  const cols = (catalog?.collections || []).map((x) => ({ ...x, aliases: x.aliases || [] }));
  const c = detectCollection(normalize(title), cols);
  return !!(c.id || c.ambiguous);
};
const pokemonish = (p, catalog) => /pok[eé]mon/i.test(`${p?.title} ${p?.product_type} ${p?.tags} ${p?.vendor}`) || citesCollection(p?.title, catalog);

const add = (out, base, p) => {
  const vs = p?.variants?.length ? p.variants : [{ price: p?.price, available: p?.available }];
  for (const v of vs) { const l = toListing(base, p, v, vs.length > 1); if (l) out.set(l.url, l); }
};

// Volume: o catálogo público inteiro em 1 a 3 páginas de 250 (antes, uma busca preditiva por coleção do catálogo: 24
// por loja a cada rodada, o que levava a borda da Shopify a devolver 429 para várias lojas de uma vez).
export const MAX_PAGES = 3; const PAGE = 250;
export async function search(store, catalog) {
  const base = store.url.replace(/\/$/, ''); const out = new Map();
  let catalogWorks = true;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${base}/products.json?limit=${PAGE}&page=${page}`; await guard(url);
    let products;
    try { products = (await getJson(url))?.products; }
    // bloqueio, rede/timeout ou falha no meio da paginação: para aqui (nunca vira nova tentativa por outra rota)
    catch (e) { if (e.blocked || page > 1 || netCode(e)) throw e; catalogWorks = false; break; }
    if (!Array.isArray(products) || (page === 1 && !products.length)) { if (page === 1) catalogWorks = false; break; }
    for (const p of products) if (pokemonish(p, catalog)) add(out, base, p);
    if (products.length < PAGE) break; // última página: não pede a vazia
  }
  if (catalogWorks) return [...out.values()];
  // Só quando o catálogo público não existe (404, HTML, vazio): busca preditiva, uma por coleção, parando no 1º erro.
  for (const term of searchTerms(catalog)) {
    const url = `${base}/search/suggest.json?q=${encodeURIComponent(term)}&resources[type]=product&resources[limit]=10`;
    await guard(url);
    const j = await getJson(url);
    for (const p of j?.resources?.results?.products || []) add(out, base, p);
  }
  return [...out.values()];
}
