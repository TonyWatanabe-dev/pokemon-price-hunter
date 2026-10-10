// Shopify: /products.json paginado (no máximo 8 páginas) com fallback para a busca preditiva.
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

// Volume: o catálogo público inteiro em páginas de 250 (antes da #188, uma busca preditiva por coleção do catálogo: 24
// por loja a cada rodada, o que levava a borda da Shopify a devolver 429 para várias lojas de uma vez).
// Teto de segurança de 8 páginas (2000 produtos), não 3: loja que vende outros jogos (mox.land, Magic etc.) tinha os
// produtos Pokémon além das 3 primeiras páginas, e a coleta lia 148 anúncios e casava 0 (coleta de 10/10 19:15Z, depois
// da #191). A paginação para na 1ª página vazia ou curta (< 250), então loja comum continua com 1 ou 2 requisições.
// Catálogo maior que o teto NÃO volta às 24 buscas por coleção: a leitura fica parcial e isso é registrado no resultado
// (PARTIAL_REASON em `partial`), sem inventar ofertas para o que não foi lido.
export const MAX_PAGES = 8; export const PAGE = 250;
export const PARTIAL_REASON = `catálogo maior que ${MAX_PAGES} páginas de ${PAGE} produtos; leitura parcial`;
export async function search(store, catalog) {
  const base = store.url.replace(/\/$/, ''); const out = new Map(); const seen = new Set();
  let catalogWorks = true; let capped = false;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${base}/products.json?limit=${PAGE}&page=${page}`; await guard(url);
    let products;
    try { products = (await getJson(url))?.products; }
    // bloqueio (429 com Retry-After, 403), rede/timeout ou 5xx no meio da paginação: para aqui e a loja registra o
    // motivo real (nunca vira nova tentativa por outra rota, nem oferta inventada com o que foi lido pela metade)
    catch (e) { if (e.blocked || page > 1 || netCode(e)) throw e; catalogWorks = false; break; }
    if (!Array.isArray(products) || (page === 1 && !products.length)) { if (page === 1) catalogWorks = false; break; }
    if (!products.length) break; // página vazia: acabou
    for (const p of products) {
      // o mesmo produto repetido entre páginas (catálogo mudando durante a leitura) entra uma vez só
      const key = p?.id != null ? `id:${p.id}` : p?.handle ? `h:${p.handle}` : null;
      if (key) { if (seen.has(key)) continue; seen.add(key); }
      if (pokemonish(p, catalog)) add(out, base, p);
    }
    if (products.length < PAGE) break; // página curta é a última: não pede a vazia
    if (page === MAX_PAGES) capped = true; // teto atingido com a página cheia: pode haver mais produtos
  }
  if (catalogWorks) { const r = [...out.values()]; if (capped) r.partial = PARTIAL_REASON; return r; }
  // Só quando o catálogo público não existe (404, HTML, vazio): busca preditiva, uma por coleção, parando no 1º erro.
  for (const term of searchTerms(catalog)) {
    const url = `${base}/search/suggest.json?q=${encodeURIComponent(term)}&resources[type]=product&resources[limit]=10`;
    await guard(url);
    const j = await getJson(url);
    for (const p of j?.resources?.results?.products || []) add(out, base, p);
  }
  return [...out.values()];
}
