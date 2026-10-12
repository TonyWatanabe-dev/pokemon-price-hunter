// Frente 1 — Mercado Livre no ranking: estoque derivado do que /products/{id}/items já devolve (available_quantity),
// com /items fechado para o app (403 access_denied). Unidade (catalogStock), adaptador (search) e rodada (runOnce →
// bestDeals) — tudo offline, sem token real.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';

process.env.HUNTER_DOMAIN_DELAY_MS = '0'; process.env.HUNTER_TIPS = '0';
for (const k of ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_SHA', 'GITHUB_EVENT_NAME', 'DATABASE_URL', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'HUNTER_CEP', 'ML_ACCESS_TOKEN']) delete process.env[k];
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-estoque-'));
const saved = { cfg: process.env.HUNTER_CONFIG_DIR, data: process.env.HUNTER_DATA_DIR };
process.env.HUNTER_CONFIG_DIR = path.join(tmp, 'config'); process.env.HUNTER_DATA_DIR = path.join(tmp, 'data');
process.env.ML_CLIENT_ID = '123'; process.env.ML_CLIENT_SECRET = 'segredo-de-teste';
fs.mkdirSync(process.env.HUNTER_CONFIG_DIR, { recursive: true }); fs.mkdirSync(process.env.HUNTER_DATA_DIR, { recursive: true });

const http = await import('../src/http.js');
const mlauth = await import('../src/mlauth.js');
const { catalogStock, apiError, search } = await import('../src/adapters/mercadolivre.js');
const { liveForScore } = await import('../src/run.js');
const fullCatalog = JSON.parse(fs.readFileSync(path.join(root, 'config/catalog.json'), 'utf8'));
const COLL = 'Caos Ascendente'; const PRODUCT = 'me04-etb';
assert.ok(fullCatalog.collections.some((c) => c.name === COLL), 'fixture depende da coleção Caos Ascendente no catálogo');
const readData = (f, fb) => { try { return JSON.parse(fs.readFileSync(path.join(tmp, 'data', f), 'utf8')); } catch { return fb; } };
let n = 0;

// 1. catalogStock: só afirma com evidência.
{
  const S = (it) => catalogStock(it).stock;
  assert.deepEqual(catalogStock({ available_quantity: 5, condition: 'new' }), { stock: 'IN_STOCK', quantity: 5, stockSource: 'ml-catalog' }, 'sem status (lista do catálogo só tem anúncio ativo) + quantidade > 0');
  assert.deepEqual(catalogStock({ available_quantity: 1 }), { stock: 'IN_STOCK', quantity: null, stockSource: 'ml-catalog' }, 'quantidade 1: em estoque, sem exibir quantidade (como os outros adaptadores)');
  assert.deepEqual(catalogStock({ status: 'active', available_quantity: 3 }, 'ml-items'), { stock: 'IN_STOCK', quantity: 3, stockSource: 'ml-items' }, 'origem informada');
  assert.equal(S({ available_quantity: 0 }), 'OUT_OF_STOCK', 'quantidade 0');
  assert.equal(S({ status: 'active', available_quantity: 0 }), 'OUT_OF_STOCK');
  for (const st of ['paused', 'closed', 'inactive', 'under_review']) assert.equal(S({ status: st, available_quantity: 9 }), 'OUT_OF_STOCK', `status ${st} vence a quantidade`);
  assert.deepEqual(catalogStock({ price: 99 }), { stock: 'IN_STOCK', quantity: null, stockSource: 'ml-catalog-listed' }, 'listado no catálogo com preço e sem quantidade: disponível (decisão do dono, 12/10)');
  assert.deepEqual(catalogStock({ price: 99, condition: 'new' }), { stock: 'IN_STOCK', quantity: null, stockSource: 'ml-catalog-listed' });
  assert.equal(S({ price: 99, condition: 'used' }), 'UNKNOWN', 'usado nunca vira disponível'); assert.equal(S({ price: 0 }), 'UNKNOWN', 'sem preço não afirma nada');
  assert.deepEqual(catalogStock({ price: 99 }, 'ml-items'), { stock: 'UNKNOWN', quantity: null, stockSource: null }, 'a regra "listado" vale só para o catálogo');
  assert.equal(S({ available_quantity: null }), 'UNKNOWN'); assert.equal(S({ available_quantity: 'muitos' }), 'UNKNOWN', 'texto não vira estoque');
  assert.equal(S({ status: 'payment_required', available_quantity: 4 }), 'UNKNOWN', 'status desconhecido não afirma nada');
  assert.equal(S(), 'UNKNOWN'); assert.equal(S(null), 'UNKNOWN');
  // corpo de erro estruturado da API, sem token
  assert.deepEqual(apiError({ id: 'MLB1', message: 'Access to the requested resource is forbidden', error: 'access_denied', status: 403, cause: null }),
    { status: 403, error: 'access_denied', message: 'Access to the requested resource is forbidden', cause: null });
  assert.deepEqual(apiError({ message: 'PolicyAgent-Unauthorized', error: 'forbidden', status: 403, cause: [{ code: 'scope', message: 'missing' }, 'texto'] }).cause, [{ code: 'scope', message: 'missing' }, 'texto']);
  assert.equal(apiError('x'), null); assert.equal(apiError(null), null);
  n++;
}

// 2. Adaptador: /items 403 por anúncio → estoque pelo catálogo; esgotado e usado ficam de fora; diagnóstico em ml-debug.json.
const j = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { 'content-type': 'application/json' } });
const ITEMS = [
  { item_id: 'MLB5551', seller_id: 77, price: 299.9, original_price: 349.9, available_quantity: 4, sold_quantity: 120, condition: 'new', listing_type_id: 'gold_special', official_store_id: null, shipping: { free_shipping: true, mode: 'me2' }, seller_address: { city: { name: 'São Paulo' } } },
  { item_id: 'MLB5552', seller_id: 78, price: 250, available_quantity: 7, condition: 'used', shipping: { free_shipping: false } },
  { item_id: 'MLB5553', seller_id: 79, price: 280, available_quantity: 0, condition: 'new', shipping: { free_shipping: false } },
  { item_id: 'MLB5554', seller_id: 80, price: 310, condition: 'new', shipping: { free_shipping: false } },
  { item_id: 'MLB5555', seller_id: 81, price: 330, condition: 'new', official_store_id: 4242, official_store_name: 'Pokémon', shipping: { free_shipping: true } },
];
const ML_403 = { message: 'Access to the requested resource is forbidden', error: 'access_denied', status: 403, cause: null };
const mlFetch = async (url) => {
  if (url.includes('/sites/MLB/search')) return j({ message: 'forbidden', error: 'forbidden', status: 403 }, 403);
  if (url.includes('/products/search')) return j({ results: url.includes(encodeURIComponent('pokemon ' + COLL)) ? [{ id: 'MLB111', name: `Pokémon TCG ${COLL} Treinador Avançado Copag` }] : [] });
  if (url.endsWith('/products/MLB111/items')) return j({ results: ITEMS });
  if (url.includes('/items?ids=')) return j(url.match(/ids=([^&]+)/)[1].split(',').map((id) => ({ code: 403, body: { id, ...ML_403 } })));
  if (/\/users\/(77|79|80)$/.test(url)) return j({ nickname: 'LOJA_' + url.slice(-2), seller_reputation: { level_id: '5_green', transactions: { completed: 900 } } });
  return j({}, 404);
};
globalThis.fetch = async () => new Response(JSON.stringify({ access_token: 'AT-1', refresh_token: 'RT-1', expires_in: 21600, user_id: 9, scope: 'offline_access read' }), { status: 200 });
await mlauth.exchange('TG-123');
http.setFetch(mlFetch);
try {
  const L = await search({ id: 'mercadolivre' }, { ...fullCatalog, collections: fullCatalog.collections.filter((c) => c.name === COLL) });
  const by = Object.fromEntries(L.map((l) => [l.sku, l]));
  assert.ok(by.MLB5551, 'anúncio com quantidade vira oferta');
  assert.equal(by.MLB5551.stock, 'IN_STOCK'); assert.equal(by.MLB5551.quantity, 4); assert.equal(by.MLB5551.stockSource, 'ml-catalog');
  assert.equal(by.MLB5551.url, 'https://www.mercadolivre.com.br/p/MLB111?pdp_filters=item_id%3AMLB5551', 'link da página do produto com o mesmo vendedor do preço');
  assert.equal(by.MLB5551.price.base, 299.9); assert.equal(by.MLB5551.listPrice, 349.9); assert.equal(by.MLB5551.shipping, 0);
  assert.equal(by.MLB5551.sellerId, 77); assert.equal(by.MLB5551.seller, 'LOJA_77');
  assert.ok(Number.isFinite(Date.parse(by.MLB5551.source_timestamp)) && Date.now() - Date.parse(by.MLB5551.source_timestamp) < 60e3, 'source_timestamp da leitura');
  assert.ok(!by.MLB5552, 'usado fica de fora');
  assert.ok(!by.MLB5553, 'quantidade 0 não ocupa vaga');
  assert.equal(by.MLB5554.stock, 'IN_STOCK', 'sem available_quantity mas listado no catálogo com preço: disponível'); assert.equal(by.MLB5554.stockSource, 'ml-catalog-listed');
  const dbg = readData('ml-debug.json');
  assert.equal(dbg.itemsApi, false); assert.equal(dbg.searchApi, false);
  assert.deepEqual(dbg.itemsError, { httpStatus: 200, perItemCode: 403, status: 403, error: 'access_denied', message: 'Access to the requested resource is forbidden', cause: null }, 'erro estruturado do /items');
  assert.equal(dbg.searchError.status, 403); assert.equal(dbg.scope, 'offline_access read');
  assert.deepEqual(dbg.catalogFields, ['available_quantity', 'condition', 'item_id', 'listing_type_id', 'official_store_id', 'original_price', 'price', 'seller_address', 'seller_id', 'shipping', 'sold_quantity']);
  assert.deepEqual(dbg.catalogSample, { item_id: 'MLB5551', available_quantity: 4, sold_quantity: 120, condition: 'new', listing_type_id: 'gold_special', price: 299.9, original_price: 349.9, official_store_id: null, free_shipping: true }, 'amostra só com campos de estoque/preço');
  assert.deepEqual(dbg.catalogStock, { IN_STOCK: 3, OUT_OF_STOCK: 1 }); assert.deepEqual(dbg.publishedStock, { IN_STOCK: 3 });
  assert.deepEqual(dbg.officialStores, { 4242: { name: 'Pokémon', sellerId: 81, listings: 1 } }, 'lojas oficiais vistas no catálogo ficam no diagnóstico');
  assert.equal(by.MLB5555.sellerKind, 'official_store'); assert.equal(by.MLB5555.seller, 'Pokémon'); assert.equal(by.MLB5555.stockSource, 'ml-catalog-listed');
  assert.equal(dbg.drop['catálogo: esgotado ou pausado'], 1); assert.equal(dbg.drop['catálogo: usado'], 1);
  assert.ok(!JSON.stringify(dbg).includes('AT-1') && !JSON.stringify(dbg).includes('RT-1'), 'diagnóstico sem token');
  n++;

  // /items aberto: a conferência por anúncio manda (status, quantidade), com origem 'ml-items'.
  fs.rmSync(path.join(tmp, 'data/ml-catalog.json'));
  http.setFetch(async (url) => {
    if (url.includes('/items?ids=')) return j(url.match(/ids=([^&]+)/)[1].split(',').map((id) => ({ code: 200, body: { id, price: id === 'MLB5551' ? 299.9 : 310, status: 'active', condition: 'new', available_quantity: id === 'MLB5551' ? 2 : 0, permalink: `https://produto.mercadolivre.com.br/${id.replace('MLB', 'MLB-')}-pokemon-_JM`, catalog_product_id: 'MLB111' } })));
    return mlFetch(url);
  });
  const L2 = await search({ id: 'mercadolivre' }, { ...fullCatalog, collections: fullCatalog.collections.filter((c) => c.name === COLL) });
  const b2 = Object.fromEntries(L2.map((l) => [l.sku, l]));
  assert.deepEqual([b2.MLB5551.stock, b2.MLB5551.quantity, b2.MLB5551.stockSource, b2.MLB5551.url], ['IN_STOCK', 2, 'ml-items', 'https://produto.mercadolivre.com.br/MLB-5551-pokemon-_JM']);
  assert.deepEqual([b2.MLB5554.stock, b2.MLB5554.stockSource], ['OUT_OF_STOCK', 'ml-items'], 'anúncio conferido com quantidade 0: esgotado');
  assert.equal(readData('ml-debug.json').itemsError, null);
  n++;

  fs.rmSync(path.join(tmp, 'data/ml-catalog.json'), { force: true });
  // 2b. Vagas por produto (PER_PRODUCT = 6) via search(): loja oficial ganha vaga até 25% acima do menor preço; muito acima, disputa por preço.

  const many = (officialPrice) => [
    ...[100, 110, 115, 130, 140, 150, 160].map((price, i) => ({ item_id: 'MLB60' + (i + 1), seller_id: 91 + i, price, condition: 'new', shipping: { free_shipping: false } })),
    { item_id: 'MLB6099', seller_id: 99, price: officialPrice, condition: 'new', official_store_id: 4242, official_store_name: 'Pokémon', shipping: { free_shipping: true } },
  ];
  const run = async (items) => {
    http.setFetch(async (url) => {
      if (url.includes('/sites/MLB/search')) return j({ message: 'forbidden', error: 'forbidden', status: 403 }, 403);
      if (url.includes('/products/search')) return j({ results: url.includes(encodeURIComponent('pokemon ' + COLL)) ? [{ id: 'MLB111', name: `Pokémon TCG ${COLL} Treinador Avançado Copag` }] : [] });
      if (url.endsWith('/products/MLB111/items')) return j({ results: items });
      if (url.includes('/items?ids=')) return j(url.match(/ids=([^&]+)/)[1].split(',').map((id) => ({ code: 403, body: { id, ...ML_403 } })));
      if (/\/users\/9[1-9]$/.test(url)) return j({ nickname: 'LOJA_' + url.slice(-2), seller_reputation: { level_id: '5_green', transactions: { completed: 900 } } });
      return j({}, 404);
    });
    const r = await search({ id: 'mercadolivre' }, { ...fullCatalog, collections: fullCatalog.collections.filter((c) => c.name === COLL) });
    return r.map((l) => l.sku).sort();
  };
  assert.deepEqual(await run(many(120)), ['MLB601', 'MLB602', 'MLB603', 'MLB604', 'MLB605', 'MLB6099'], 'oficial a 20% acima do menor preço entra nas 6 vagas; a 6ª mais barata (150) fica de fora');
  assert.deepEqual(await run(many(200)), ['MLB601', 'MLB602', 'MLB603', 'MLB604', 'MLB605', 'MLB606'], 'oficial a 100% acima não tem prioridade: só as 6 mais baratas');
  http.setFetch(mlFetch); fs.rmSync(path.join(tmp, 'data/ml-catalog.json'), { force: true }); n++;

  // 3. Rodada completa: produto sem oferta de loja → a oferta do ML em estoque entra no bestDeals (desconto Copag).
  fs.rmSync(path.join(tmp, 'data/ml-catalog.json'), { force: true });
  http.setFetch(mlFetch);
  const cat = structuredClone(fullCatalog);
  cat.collections = cat.collections.filter((c) => c.name === COLL);
  cat.copag[PRODUCT] = { msrp: 349.99, source_url: 'https://www.copag.com.br/exemplo-teste', confidence: 'OFICIAL', source_timestamp: '2026-10-01' };
  fs.writeFileSync(path.join(tmp, 'config/catalog.json'), JSON.stringify(cat));
  fs.writeFileSync(path.join(tmp, 'config/watchlist.json'), JSON.stringify({ settings: {}, rules: [] }));
  fs.writeFileSync(path.join(tmp, 'config/stores.json'), JSON.stringify({ stores: [{ id: 'mercadolivre', name: 'Mercado Livre', url: 'https://api.mercadolibre.com', platform: 'mercadolivre', kind: 'marketplace', evidence: {} }] }));
  const { runOnce } = await import('../src/run.js');
  await runOnce({ log: () => {}, send: {}, now: new Date() });
  const state = readData('state.json');
  const ml = state.offers.filter((o) => o.storeId === 'mercadolivre');
  assert.equal(state.sources.find((s) => s.id === 'mercadolivre')?.status, 'ACTIVE');
  const o = ml.find((x) => x.sku === 'MLB5551');
  assert.ok(o, 'oferta do ML publicada'); assert.equal(o.productId, PRODUCT);
  assert.deepEqual([o.stock, o.quantity, o.stockSource, o.priceKind, o.price, o.total, o.confirmed], ['IN_STOCK', 4, 'ml-catalog', 'base', 299.9, 299.9, true]);
  assert.ok(liveForScore(o), 'entra no conjunto que recebe nota oficial');
  assert.ok(state.bestDeals.includes(o.id), 'ML em estoque entra no bestDeals de produto sem oferta de loja');
  const u = ml.find((x) => x.sku === 'MLB5554');
  assert.equal(u.stock, 'IN_STOCK'); assert.equal(u.stockSource, 'ml-catalog-listed'); assert.ok(liveForScore(u), 'listado no catálogo entra no ranking com origem rastreável');
  assert.ok(!ml.some((x) => x.sku === 'MLB5553'), 'esgotado não é publicado');
  assert.equal(state.products.find((p) => p.id === PRODUCT)?.inStockCount, 3);
  n++;
} finally {
  if (saved.cfg == null) delete process.env.HUNTER_CONFIG_DIR; else process.env.HUNTER_CONFIG_DIR = saved.cfg;
  if (saved.data == null) delete process.env.HUNTER_DATA_DIR; else process.env.HUNTER_DATA_DIR = saved.data;
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`✓ Mercado Livre no ranking (estoque pelo catálogo): ${n} blocos passaram`);
