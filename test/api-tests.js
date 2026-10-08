// API v1 (FASE 3): resumo da Home, endpoints, paginação, cache, fallback, consistência com o state.json.
// Parte A roda sempre (fonte state.json). Parte B roda com TEST_DATABASE_URL (banco descartável).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { slimHome } from '../api/_lib/home.mjs';
import { setLegacyLoader } from '../api/_lib/legacy.mjs';
import { compareHome, compareEndpoints, homeView } from '../tools/api-compare.mjs';

const now = Date.now(); const T = (h) => new Date(now - h * 3600e3).toISOString();
const fx = () => ({
  generatedAt: T(0), coverage: { stores: 3 }, totals: { offers: 7 },
  collections: [{ id: 'me05', name: 'Escuridão Absoluta', series: 'Megaevolução', aliases: ['me5'] }, { id: 'sv9', name: 'Amigos de Jornada', series: 'Escarlate e Violeta', aliases: [] }],
  types: [{ id: 'etb', label: 'Treinador Avançado (ETB)', group: 'ETB' }, { id: 'booster_pack', label: 'Booster', group: 'Boosters' }, { id: 'lata', label: 'Lata', group: 'Latas' }],
  products: [
    { id: 'me05-etb', collection: 'me05', collectionName: 'Escuridão Absoluta', type: 'etb', typeLabel: 'Treinador Avançado (ETB)', group: 'ETB', boosters: 9, image: 'https://img/etb.png', firstSeen: T(48),
      copagConfirmed: true, msrp: 400, copag: { source_url: 'https://www.copagloja.com.br/etb/p', confidence: 'OFICIAL', source_timestamp: T(10) }, offerCount: 6, inStockCount: 3, lowestHistorical: { total: 350, at: T(30), storeId: 'a', offerId: 'oa' } },
    { id: 'me05-booster', collection: 'me05', collectionName: 'Escuridão Absoluta', type: 'booster_pack', typeLabel: 'Booster', group: 'Boosters', boosters: 1, firstSeen: T(48), copagConfirmed: false, msrp: null, offerCount: 1 },  // sem referência
    { id: 'sv9-lata', collection: 'sv9', collectionName: 'Amigos de Jornada', type: 'lata', typeLabel: 'Lata', group: 'Latas', boosters: 4, firstSeen: T(48), copagConfirmed: false, msrp: null, copagReference: 99.9, copagReferenceUrl: 'https://ref/lata', offerCount: 0 }, // sem ofertas
  ],
  offers: [
    { id: 'oa', productId: 'me05-etb', storeId: 'a', storeName: 'Loja A', title: 'ETB', url: 'https://a/etb', image: 'https://a/i.png', price: 380, priceKind: 'pix', prices: { pix: 380, base: 399 }, shipping: null, shippingKnown: false, total: 380, perBooster: 42.22, stock: 'IN_STOCK', firstSeen: T(40), source_timestamp: T(1), confirmed: true, anomalous: false, stale: false, discount: 0.05, savings: 20, dealScore: 61, scoreParts: { copag: 5 }, matchConfidence: 0.9, sourceType: 'store_api', source_url: 'https://a/etb', sku: 'ETB-ME05' },
    { id: 'ob', productId: 'me05-etb', storeId: 'b', storeName: 'Loja B', title: 'ETB', url: 'https://b/etb', price: 360, priceKind: 'base', shipping: 20, shippingKnown: true, total: 380, perBooster: 42.22, stock: 'IN_STOCK', firstSeen: T(40), source_timestamp: T(1), confirmed: true, anomalous: false, stale: false, discount: 0.05, savings: 20, dealScore: 70, matchConfidence: 0.9 },
    { id: 'oc', productId: 'me05-etb', storeId: 'rihappycombr', storeName: 'Ri Happy', seller: 'Gourmande', sellerKind: 'store', title: 'ETB', url: 'https://rh/etb', price: 300, priceKind: 'base', shipping: null, shippingKnown: false, total: 300, perBooster: 33.33, stock: 'OUT_OF_STOCK', firstSeen: T(40), source_timestamp: T(1), confirmed: true, anomalous: false, stale: false, discount: 0.25, savings: 100, dealScore: null },
    { id: 'od', productId: 'me05-etb', storeId: 'mercadolivre', storeName: 'Mercado Livre', seller: 'VENDEDOR_X', sellerId: '77', sellerKind: 'marketplace_seller', sku: 'MLB1', title: 'ETB', url: 'https://ml/p/1', price: 340, priceKind: 'base', shipping: 0, shippingKnown: true, total: 340, perBooster: 37.78, stock: 'IN_STOCK', firstSeen: T(40), source_timestamp: T(1), confirmed: false, anomalous: false, stale: false, discount: 0.15, savings: 60, dealScore: null },
    { id: 'oe', productId: 'me05-etb', storeId: 'a', storeName: 'Loja A', title: 'ETB caixa', url: 'https://a/etb2', price: 410, priceKind: 'base', shipping: null, shippingKnown: false, total: 410, perBooster: 45.56, stock: 'IN_STOCK', firstSeen: T(40), source_timestamp: T(30), confirmed: true, anomalous: false, stale: true, discount: -0.025, savings: -10, dealScore: null },
    { id: 'of', productId: 'me05-booster', storeId: 'b', storeName: 'Loja B', title: 'Booster', url: 'https://b/bst', price: 30, priceKind: 'base', shipping: null, shippingKnown: false, total: 30, perBooster: 30, stock: 'IN_STOCK', firstSeen: T(40), source_timestamp: T(1), confirmed: true, anomalous: false, stale: false, discount: null, savings: null, dealScore: null },
  ],
  activity: [{ t: T(2), productId: 'me05-etb', offerId: 'oa', storeName: 'Loja A', to: 380, from: 400, msrp: 400, type: 'drop' }, { t: T(24 * 30), productId: 'me05-etb', offerId: 'oa', storeName: 'Loja A', to: 390, type: 'new' }],
  tips: [{ key: 'tg:1', id: 't1', source: 'Telegram x', title: 'ETB barata', text: 'texto bruto longo do canal', productId: 'me05-etb', price: 330, discount: 0.17, postedAt: T(3), url: 'https://t.me/x/1' }],
  sources: [{ id: 'a', name: 'Loja A', url: 'https://a.com.br', status: 'ACTIVE', score: { evidence: ['CNPJ'] }, secretNote: 'interno' }, { id: 'b', name: 'Loja B', url: 'https://b.com.br', status: 'ACTIVE' },
    { id: 'rihappycombr', name: 'Ri Happy', url: 'https://rihappy.com.br', status: 'ACTIVE' }, { id: 'mercadolivre', name: 'Mercado Livre', url: 'https://mercadolivre.com.br', status: 'ACTIVE' }],
  reputation: { consultadoEm: '2026-10-01', lojas: { b: { status: 'BOM', nota: 7.9 }, z: { status: 'RUIM' } } },
  distrust: null, unmatched: [{ title: 'x' }], rules: [{ id: 'r' }], recentAlerts: [{ id: 'al' }],
});

// ------------------------------------------------------------------ A) resumo da Home (puro)
const st = fx(); const h = slimHome(st, { source: 'state', now });
// produto sem ofertas fica de fora; os outros entram com contagens prontas
assert.deepEqual(h.products.map((p) => p.id).sort(), ['me05-booster', 'me05-etb']);
const pe = h.products.find((p) => p.id === 'me05-etb');
assert.equal(pe.liveCount, 3, 'oa, ob e od com estoque (no site, "viva" não olha confirmação; oe é stale; oc sem estoque)');
assert.ok(pe.codes.includes('ETB-ME05') && pe.codes.includes('MLB1'));
assert.equal(pe.collectionName, undefined, 'nome da coleção vem de collections'); assert.equal(pe.typeLabel, undefined);
assert.deepEqual(pe.lowestHistorical, { total: 350, at: st.products[0].lowestHistorical.at });
// ofertas: melhor com estoque, melhor oportunidade, sem a inteira da atividade
const ids = h.offers.map((o) => o.id).sort();
// od: melhor com estoque (340); ob: melhor oportunidade (Deal Score 70); of: único do booster. oe (stale), oc (sem estoque) e oa ficam de fora
assert.deepEqual(ids, ['ob', 'od', 'of']);
assert.deepEqual(h.offerKinds, { oa: 'pix' }, 'oferta citada só na atividade: viaja apenas o selo "no Pix"');
assert.equal(h.activity.length, 1, 'atividade só dos últimos 7 dias');
assert.deepEqual(h.counts, { products: 3, productsWithOffers: 2, liveOffers: 4, stores: 3, pre: 0, tips: 1, offersIncluded: h.offers.length });
// o que a Home mostra é igual com o resumo e com o estado completo
const vFull = homeView({ ...st, products: st.products, offers: st.offers, counts: h.counts }); const vSlim = homeView(h);
assert.deepEqual(Object.fromEntries(Object.entries(vSlim.best).map(([k, o]) => [k, o.id])), Object.fromEntries(Object.entries(vFull.best).filter(([k]) => vSlim.P.has(k)).map(([k, o]) => [k, o.id])));
assert.deepEqual(vSlim.poolList, vFull.poolList); assert.deepEqual(vSlim.wall, vFull.wall);
// nada interno: varre todas as chaves do resumo
const FORBIDDEN = /^(matchConfidence|match_confidence|sourceType|source_url|sellerId|external_id|affiliate.*|quality|text|secretNote|unmatched|rules|recentAlerts|distrust|copag|prices|password|token|legacy_id|decided_by.*|review.*)$/i;
const keys = new Set(); (function walk(x) { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) { keys.add(k); walk(v); } })(h);
assert.deepEqual([...keys].filter((k) => FORBIDDEN.test(k)), [], 'resumo da Home sem campos internos');
assert.deepEqual(Object.keys(h.reputation.lojas), ['b'], 'reputação só das lojas presentes no resumo');
// tamanho: com um estado real (se houver) ≤ 150 KB; com o fixture, mínimo
const real = ['data/state.json', 'test/.demo-state.json'].map((f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }).find((x) => x?.products?.length > 100);
if (real) { const b = Buffer.byteLength(JSON.stringify(slimHome(real, { now: Date.parse(real.generatedAt) || now }))); assert.ok(b <= 150 * 1024, `resumo da Home com dados reais: ${b} bytes`); console.log(`  resumo da Home com dados reais: ${(b / 1024).toFixed(1)} KB`); }

// ------------------------------------------------------------------ A) endpoints pelo state.json
setLegacyLoader(async () => fx());
delete process.env.API_DATABASE_URL;
const { default: api, _cache } = await import('../api/v1.mjs');
const call = async (url, method = 'GET') => { const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } }; await api({ url, method }, res); return { status: res.statusCode, headers: res.headers, json: JSON.parse(res.body) }; };
let r = await call('/api/v1/home');
assert.equal(r.status, 200); assert.equal(r.headers['X-Data-Source'], 'state'); assert.equal(r.headers['X-Cache'], 'MISS'); assert.match(r.headers['Cache-Control'], /s-maxage=60/);
r = await call('/api/v1/home'); assert.equal(r.headers['X-Cache'], 'HIT', 'segundo pedido sai do cache');
// paginação
r = await call('/api/v1/produtos?limite=2&pagina=1'); assert.equal(r.json.data.length, 2); assert.deepEqual(r.json.meta, { page: 1, limit: 2, total: 3, pages: 2 });
r = await call('/api/v1/produtos?limite=2&pagina=2'); assert.equal(r.json.data.length, 1);
r = await call('/api/v1/produtos?limite=999'); assert.equal(r.json.meta.limit, 50, 'limite máximo 50');
r = await call('/api/v1/produtos?pagina=9'); assert.equal(r.json.data.length, 0); assert.equal(r.json.meta.total, 3);
r = await call('/api/v1/produtos?ordem=xpto'); assert.equal(r.status, 400);
// produto inexistente / identificador inválido / rota / método
assert.equal((await call('/api/v1/produtos/nao-existe')).status, 404);
assert.equal((await call('/api/v1/produtos/..%2F..%2Fetc')).status, 400);
assert.equal((await call('/api/v1/xyz')).status, 404);
assert.equal((await call('/api/v1/home', 'POST')).status, 405);
// preço atual, estoque, referência (state)
r = await call('/api/v1/produtos/me05-etb'); const ps = r.json.data.stats;
assert.equal(ps.market.current_price, 360, 'menor preço com estoque e confirmado (od não confirmada fica de fora)'); assert.equal(ps.market.current_total_price, 380);
assert.equal(ps.coverage.in_stock_offers, 2); assert.deepEqual(ps.reference, { value: 400, status: 'verified', source: null, verified_at: null });
r = await call('/api/v1/produtos/me05-booster'); assert.equal(r.json.data.references.length, 0); assert.equal(r.json.data.stats.reference, null, 'sem referência');
r = await call('/api/v1/produtos/sv9-lata'); assert.equal(r.json.data.stats.status, 'no_offers'); assert.equal(r.json.data.stats.market.current_price, null, 'sem ofertas');
assert.equal(r.json.data.references[0].status, 'pending');
r = await call('/api/v1/produtos/me05-etb/ofertas?limite=10'); assert.equal(r.json.meta.total, 5);
assert.equal(r.json.data.find((o) => o.id === 'oa').total_price, null, 'frete desconhecido: total nulo, nunca o preço');
r = await call('/api/v1/oportunidades'); assert.equal(r.json.meta.status, 'not_computed'); assert.deepEqual(r.json.data, []);
r = await call('/api/v1/referencias?status=verified'); assert.equal(r.json.data.length, 1);

// ------------------------------------------------------------------ B) banco (PostgreSQL)
if (!process.env.TEST_DATABASE_URL) { console.log('OK — API v1 (state.json); banco pulado (sem TEST_DATABASE_URL)'); process.exit(0); }
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const { pool, tx, close } = await import('../src/db/pg.js');
const { syncState } = await import('../src/core/sync.js');
const { runPriceEngine } = await import('../src/core/price-stats.js');
const { execFileSync } = await import('node:child_process');
const p = await pool(); await p.query('DROP SCHEMA IF EXISTS hunter CASCADE');
execFileSync('node', ['tools/db-migrate.mjs'], { env: process.env, stdio: 'pipe' });
const S0 = fx();
await tx((c) => syncState(c, { state: S0, catalog: { collections: S0.collections }, historyLines: [] }));
await tx((c) => runPriceEngine(c));
process.env.API_DATABASE_URL = process.env.TEST_DATABASE_URL; _cache.clear();
r = await call('/api/v1/home'); assert.equal(r.headers['X-Data-Source'], 'db');
const hDb = r.json; const hSt = slimHome(S0, { now });
const cmp = compareHome(hDb, hSt);
assert.equal(cmp.critical, 0, JSON.stringify(cmp.details));
assert.deepEqual(cmp.summary.offerFieldDiffs, 0, JSON.stringify(cmp.details.offerFieldDiffs));
assert.equal(hDb.offers.find((o) => o.id === 'ob')?.dealScore, 70, 'Deal Score do robô sobreposto pelo id da oferta');
// vendedor parceiro preservado (Ri Happy) — o site mostra "Gourmande via Ri Happy"
r = await call('/api/v1/produtos/me05-etb/ofertas?limite=50'); assert.equal(r.json.data.find((o) => o.id === 'oc').seller, 'Gourmande');
assert.equal(r.json.data.find((o) => o.id === 'oa').total_price, null);
// paginação e filtros no banco
r = await call('/api/v1/produtos?limite=1&pagina=2&ordem=nome'); assert.equal(r.json.data.length, 1); assert.deepEqual(r.json.meta, { page: 2, limit: 1, total: 3, pages: 3 });
r = await call('/api/v1/produtos?estoque=1'); assert.deepEqual(r.json.data.map((x) => x.id).sort(), ['me05-booster', 'me05-etb']);
r = await call('/api/v1/produtos?colecao=sv9'); assert.deepEqual(r.json.data.map((x) => x.id), ['sv9-lata']);
r = await call('/api/v1/produtos?busca=lata'); assert.deepEqual(r.json.data.map((x) => x.id), ['sv9-lata']);
// preço atual, estoque e referência vindos do Price Engine
r = await call('/api/v1/produtos/me05-etb'); const ds = r.json.data.stats;
assert.equal(ds.market.current_price, 360); assert.equal(ds.market.current_total_price, 380); assert.equal(ds.coverage.in_stock_offers, 2);
assert.equal(ds.reference.value, 400); assert.equal(ds.reference.status, 'verified'); assert.equal(ds.discount_vs_reference, 0.1);
assert.equal((await call('/api/v1/produtos/me05-booster')).json.data.stats.reference, null);
assert.equal((await call('/api/v1/produtos/sv9-lata')).json.data.stats.status, 'no_offers');
assert.equal((await call('/api/v1/produtos/nao-existe')).status, 404);
r = await call('/api/v1/produtos/me05-etb/historico?dias=7'); assert.ok(Array.isArray(r.json.data.series));
r = await call('/api/v1/produtos/me05-etb/estatisticas'); assert.equal(r.json.data.stats.market.current_price, 360);
// slug também funciona
const slug = (await call('/api/v1/produtos/me05-etb')).json.data.slug; assert.equal((await call(`/api/v1/produtos/${slug}`)).json.data.id, 'me05-etb');
// endpoints × state.json
const DB = await import('../api/_lib/read-db.mjs'); const ST = await import('../api/_lib/read-state.mjs');
const ce = await compareEndpoints(S0, DB, ST);
assert.equal(ce.currentPrice.diffCount, 0, JSON.stringify(ce.currentPrice.diffs)); assert.equal(ce.inStock.diffCount, 0); assert.equal(ce.reference.diffCount, 0); assert.equal(ce.offers.diffCount, 0, JSON.stringify(ce.offers.diffs));
// nada interno nas respostas do banco
const all = JSON.stringify([(await call('/api/v1/produtos/me05-etb')).json, (await call('/api/v1/produtos/me05-etb/ofertas')).json, (await call('/api/v1/produtos?limite=50')).json, hDb]);
for (const k of ['match_confidence', 'external_id', 'external_offer_id', 'affiliate', 'decided_by', 'quality', 'anchor', '"product_id"', 'legacy_id', 'seller_id']) assert.ok(!all.includes(k), `resposta não pode conter ${k}`);
// banco fora do ar → fallback seguro para o state.json
const { closeApiPool } = await import('../api/_lib/db.mjs'); await closeApiPool();
process.env.API_DATABASE_URL = 'postgres://x:y@127.0.0.1:1/nada'; _cache.clear();
r = await call('/api/v1/produtos/me05-etb'); assert.equal(r.status, 200); assert.equal(r.headers['X-Data-Source'], 'state'); assert.equal(r.headers['X-Fallback'], 'db-indisponivel');
r = await call('/api/v1/home'); assert.equal(r.status, 200); assert.equal(r.json.source, 'state');
await closeApiPool(); await close();
console.log('OK — API v1 (state.json e PostgreSQL)');
