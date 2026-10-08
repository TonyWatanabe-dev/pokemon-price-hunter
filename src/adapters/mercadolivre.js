// Mercado Livre: só pela API oficial, com acesso OAuth (ver src/mlauth.js). Sem acesso = BLOCKED, sem raspar páginas.
// Caminho 1: busca de anúncios (/sites/MLB/search). Desde 2025 costuma responder 403 para apps comuns.
// Caminho 2 (catálogo): /products/search acha a página única do produto e /products/{id}/items lista
// cada vendedor com o próprio preço. O link publicado é o anúncio do vendedor, onde esse preço aparece.
import { getJson, BlockedError } from '../http.js';
import { searchTerms } from './common.js';
import { accessToken } from '../mlauth.js';
import { matchProduct } from '../match.js';
import { dataPath, readJson, writeJson } from '../db.js';

const API = 'https://api.mercadolibre.com';
const itemUrl = (id) => `https://produto.mercadolivre.com.br/${String(id).replace(/^MLB/, 'MLB-')}-_JM`;
const DAY = 864e5;

// Nome de catálogo do ML é escrito por vendedor: barra kits, caixas fechadas, acessórios de terceiros
// e nomes ambíguos antes de publicar (produto e preço precisam ser exatamente o do link).
const norm = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function mlReject(name, productId, catalog) {
  const t = norm(name); const type = productId.split('-').slice(1).join('-');
  if (/\b(kit|lote|case|unidades|figurinhas?)\b|\d+\s*unid|\+/.test(t)) return 'kit, lote ou caixa fechada';
  if (/^\s*\d+\s*(x\s*)?(blister|booster|4 ?pack|pack|box)/.test(t)) return 'quantidade no começo do nome';
  if (/triplo e quadruplo|quadruplo e triplo/.test(t)) return 'dois produtos no mesmo anúncio';
  if (/^booster$/.test(type) && /\b(36|24|18|12|10|8)\b|display|caixa|\bbox\b|pacotinhos|pacotes/.test(t)) return 'booster avulso com cara de caixa';
  if (/^blister\d$/.test(type) && /\b(24|36)\b|\bcx\b|caixa|display/.test(t)) return 'caixa fechada de blisters';
  if (/fichario/.test(type) && (!/\bbox\b|colecao com fichario/.test(t) || /folhas|argolas|pasta|capa dura|escolar/.test(t))) return 'fichário avulso de terceiros';
  if (/^colecao_ex/.test(type) && (t.match(/\bex\b/g) || []).length > 1) return 'mais de um produto no nome';
  // Outra coleção citada no nome (fora o nome da série, ex.: "Escarlate e Violeta", "Megaevolução").
  const BASE = new Set(['sv1', 'me01']);
  const colId = productId.split('-')[0];
  const mine = norm((catalog.collections || []).find((c) => c.id === colId)?.name || '');
  const others = (catalog.collections || []).filter((c) => c.id !== colId && !BASE.has(c.id) && !mine.includes(norm(c.name)) && t.includes(norm(c.name)));
  if (others.length) return 'nome cita outra coleção';
  // "Megaevolução" é também o nome da série inteira: blister/booster/caixa só valem com código ou mascote do ME01.
  if (colId === 'me01' && /^(blister|booster|box)/.test(type) && !/\bme ?0?1\b|drifloon|drifblim|psyduck|golduck/.test(t)) return 'série Megaevolução sem coleção definida';
  if (colId === 'me01' && /cottonee?|whimsicott|sneasel|weavile|charmeleon|toxel|makuhita/.test(t)) return 'mascote de outra coleção';
  return null;
}
const PER_PRODUCT = Number(process.env.ML_PER_PRODUCT || 6); // ofertas mais baratas por produto de catálogo

export async function search(store, catalog, { log = () => {} } = {}) {
  let auth;
  try { auth = await accessToken(); } catch (e) { throw new BlockedError('Mercado Livre: não foi possível renovar o acesso (' + e.message + '). Rode o workflow "Mercado Livre: autorizar".', 'auth'); }
  if (!auth.token) throw new BlockedError('Mercado Livre ainda não autorizado: crie o app e rode o workflow "Mercado Livre: autorizar".', 'auth');
  const H = { headers: { authorization: `Bearer ${auth.token}` } };
  const call = async (path) => {
    try { return await getJson(API + path, H); } catch (e) { if (e.status === 401) throw new BlockedError('Mercado Livre recusou o acesso (401): autorize de novo.', 401); throw e; }
  };

  // Caminho 1: busca de anúncios. Se der 403/bloqueio, passa para o catálogo.
  let open = true; const out = new Map();
  for (const term of searchTerms(catalog).map((t) => t + ' copag lacrado')) {
    let j;
    try { j = await call(`/sites/MLB/search?q=${encodeURIComponent(term)}&limit=50`); } catch (e) { if (e.blocked || e.status === 403) { open = false; break; } throw e; }
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
  if (open && out.size) return [...out.values()];

  // Caminho 2: catálogo. Os produtos de catálogo de cada coleção ficam em cache por 1 dia.
  const cacheFile = dataPath('ml-catalog.json');
  const cache = readJson(cacheFile, { at: null, products: {}, sellers: {} });
  if (!cache.at || Date.now() - Date.parse(cache.at) > DAY) {
    const found = {};
    for (const term of searchTerms(catalog)) {
      let j;
      try { j = await call(`/products/search?status=active&site_id=MLB&q=${encodeURIComponent(term)}&limit=20`); } catch (e) { if (e.blocked) throw e; log(`ML catálogo: busca "${term}" falhou (${e.message})`); continue; }
      for (const p of j.results || []) {
        const name = p.name || p.title; if (!name || !/pok[eé]mon/i.test(name)) continue;
        const m = matchProduct({ title: name, url: '' }, catalog);
        if (m.productId && !mlReject(name, m.productId, catalog)) found[p.id] = { name, productId: m.productId, image: p.pictures?.[0]?.url || null };
      }
    }
    cache.products = found; cache.at = new Date().toISOString();
  }

  const listings = [];
  for (const [pid, p] of Object.entries(cache.products)) {
    if (mlReject(p.name, p.productId, catalog)) continue;
    let j;
    try { j = await call(`/products/${pid}/items`); } catch (e) { if (e.blocked) throw e; if (e.status === 404) continue; log(`ML catálogo: ofertas de ${pid} falharam (${e.message})`); continue; }
    const items = (j.results || []).filter((it) => (!it.condition || it.condition === 'new') && Number(it.price) > 0)
      .sort((a, b) => a.price - b.price).filter((it, i) => i < PER_PRODUCT || it.official_store_id);
    for (const it of items) {
      const id = it.item_id || it.id; const price = Number(it.price);
      if (!id || !(price > 0)) continue;
      const sid = it.seller_id;
      let seller = it.official_store_name || cache.sellers[sid];
      if (!seller && sid) {
        try { const u = await call(`/users/${sid}`); seller = u.nickname || null; } catch { seller = null; }
        cache.sellers[sid] = seller || `Vendedor ${sid}`; seller = cache.sellers[sid];
      }
      listings.push({
        title: p.name, url: itemUrl(id), price: { base: price }, listPrice: it.original_price > price ? it.original_price : null,
        stock: 'IN_STOCK', quantity: null, // /items do catálogo só lista ofertas ativas
        shipping: it.shipping?.free_shipping ? 0 : null, sku: id, ean: null, image: p.image,
        seller: seller || 'Vendedor no Mercado Livre', sellerId: sid,
        sellerKind: it.official_store_id ? 'official_store' : 'marketplace_seller', sourceType: 'official_api',
      });
    }
  }
  writeJson(cacheFile, cache);
  return listings;
}
