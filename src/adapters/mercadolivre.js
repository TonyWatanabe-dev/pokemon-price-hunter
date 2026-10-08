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
// Link do anúncio dentro da página do produto, com o vendedor já selecionado (o mesmo preço que publicamos).
const pdpUrl = (productId, itemId) => `https://www.mercadolivre.com.br/p/${productId}?pdp_filters=item_id%3A${itemId}`;
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
const PER_PRODUCT = Number(process.env.ML_PER_PRODUCT || 6); // ofertas mais baratas por produto nosso
const MIN_SALES = Number(process.env.ML_MIN_SALES || 50); // vendas concluídas mínimas do vendedor

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

  // Vendedor: só publica quem tem reputação no ML (termômetro verde/amarelo e vendas concluídas).
  // Conta nova ou termômetro vermelho/laranja fica de fora — protege quem clica.
  const sellerInfo = async (sid) => {
    let v = cache.sellers[sid];
    if (v && typeof v === 'object' && Date.now() - Date.parse(v.at) < 7 * DAY) return v;
    try {
      const u = await call(`/users/${sid}`); const r = u.seller_reputation || {};
      v = { name: u.nickname || `Vendedor ${sid}`, level: r.level_id || null, sales: r.transactions?.completed ?? r.transactions?.total ?? 0, at: new Date().toISOString() };
    } catch { v = { name: `Vendedor ${sid}`, level: null, sales: 0, at: new Date().toISOString() }; }
    cache.sellers[sid] = v; return v;
  };
  const trusted = (v) => /^(3_yellow|4_light_green|5_green)$/.test(v.level || '') && v.sales >= MIN_SALES;

  const byProduct = {};
  for (const [pid, p] of Object.entries(cache.products)) {
    if (mlReject(p.name, p.productId, catalog)) continue;
    let j;
    try { j = await call(`/products/${pid}/items`); } catch (e) { if (e.blocked) throw e; if (e.status === 404) continue; log(`ML catálogo: ofertas de ${pid} falharam (${e.message})`); continue; }
    for (const it of j.results || []) {
      if (it.condition && it.condition !== 'new') continue;
      const id = it.item_id || it.id; const price = Number(it.price);
      if (!id || !(price > 0)) continue;
      (byProduct[p.productId] ||= []).push({ it, p, pid, id, price });
    }
  }
  const picked = [];
  for (const list of Object.values(byProduct)) {
    list.sort((a, b) => a.price - b.price);
    let kept = 0; const seen = new Set();
    for (const row of list) {
      if (kept >= PER_PRODUCT * 2) break; // folga para a conferência abaixo
      const sid = row.it.seller_id; if (seen.has(sid)) continue; // um anúncio por vendedor
      const official = !!row.it.official_store_id;
      const v = sid ? await sellerInfo(sid) : { name: null, level: null, sales: 0 };
      if (!official && !trusted(v)) continue;
      seen.add(sid); kept++; picked.push({ ...row, v, official });
    }
  }

  // Conferência anúncio a anúncio (/items): ativo, novo, mesmo preço e link oficial do anúncio.
  // Se a API de anúncios não abrir para o app, usa o link da página do produto com o vendedor selecionado.
  const check = new Map(); let itemsApi = true; const dbg = { picked: 0, sample: null, drop: {} };
  const drop = (k) => { dbg.drop[k] = (dbg.drop[k] || 0) + 1; };
  for (let i = 0; i < picked.length && itemsApi; i += 20) {
    const ids = picked.slice(i, i + 20).map((r) => r.id).join(',');
    try {
      const arr = await call(`/items?ids=${ids}&attributes=id,price,status,permalink,condition,available_quantity,catalog_product_id`);
      if (!dbg.sample) dbg.sample = JSON.stringify(arr).slice(0, 600);
      for (const x of arr || []) { const b = x?.body || x; if ((x.code === 200 || !x.code) && b?.id) check.set(b.id, b); }
    } catch (e) { if (e.blocked && e.status === 401) throw e; itemsApi = false; log(`ML: conferência por anúncio indisponível (${e.message}); usando link da página do produto`); }
  }

  const listings = []; const perProduct = {};
  for (const { it, p, pid, id, price, v, official } of picked) {
    if ((perProduct[p.productId] || 0) >= PER_PRODUCT) continue;
    let url = pdpUrl(pid, id); let finalPrice = price; let qty = null;
    if (itemsApi) {
      const b = check.get(id);
      if (!b) { drop('sem resposta'); continue; }
      if (b.status !== 'active') { drop('status ' + b.status); continue; } // fechado/pausado: fora
      if (b.condition && b.condition !== 'new') { drop('usado'); continue; }
      if (Math.abs(Number(b.price) - price) > 0.009) { drop('preço diferente'); continue; } // mudou entre as leituras: espera a próxima rodada
      if (b.catalog_product_id && b.catalog_product_id !== pid) { drop('outro produto'); continue; }
      if (b.permalink) url = b.permalink;
      finalPrice = Number(b.price); qty = b.available_quantity > 1 ? b.available_quantity : null;
    }
    perProduct[p.productId] = (perProduct[p.productId] || 0) + 1;
    listings.push({
      title: p.name, url, price: { base: finalPrice }, listPrice: it.original_price > finalPrice ? it.original_price : null,
      stock: 'IN_STOCK', quantity: qty,
      shipping: it.shipping?.free_shipping ? 0 : null, sku: id, ean: null, image: p.image,
      seller: it.official_store_name || v.name || 'Vendedor no Mercado Livre', sellerId: it.seller_id,
      sellerKind: official ? 'official_store' : 'marketplace_seller', sourceType: 'official_api',
    });
  }
  dbg.picked = picked.length; dbg.itemsApi = itemsApi; dbg.published = listings.length; dbg.at = new Date().toISOString();
  writeJson(dataPath('ml-debug.json'), dbg);
  writeJson(cacheFile, cache);
  return listings;
}
