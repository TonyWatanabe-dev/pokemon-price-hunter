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
// ofertas: melhor com estoque, sem a inteira da atividade
const ids = h.offers.map((o) => o.id).sort();
// od: melhor com estoque (340); of: único do booster. ob (maior Deal Score) não entra mais: a oportunidade vem do Opportunity Engine
// (pódio pela API /oportunidades), não de uma seleção pelo Deal Score. oe (stale), oc (sem estoque) e oa ficam de fora
assert.deepEqual(ids, ['od', 'of']);
assert.ok(h.offers.every((o) => !('dealScore' in o) && !('scoreParts' in o)), 'Deal Score não vai ao navegador');
assert.deepEqual(h.offerKinds, { oa: 'pix' }, 'oferta citada só na atividade: viaja apenas o selo "no Pix"');
assert.equal(h.activity.length, 1, 'atividade só dos últimos 7 dias');
assert.deepEqual(h.counts, { products: 3, productsWithOffers: 2, liveOffers: 4, stores: 3, pre: 0, tips: 1, offersIncluded: h.offers.length });
// o que a Home mostra é igual com o resumo e com o estado completo
const vFull = homeView({ ...st, products: st.products, offers: st.offers, counts: h.counts }); const vSlim = homeView(h);
assert.deepEqual(Object.fromEntries(Object.entries(vSlim.best).map(([k, o]) => [k, o.id])), Object.fromEntries(Object.entries(vFull.best).filter(([k]) => vSlim.P.has(k)).map(([k, o]) => [k, o.id])));
assert.deepEqual(vSlim.poolList, vFull.poolList); assert.deepEqual(vSlim.wall, vFull.wall);
// nada interno: varre todas as chaves do resumo
const FORBIDDEN = /^(matchConfidence|match_confidence|sourceType|source_url|sellerId|external_id|affiliate.*|quality|text|secretNote|unmatched|rules|recentAlerts|copag|prices|password|token|legacy_id|decided_by.*|review.*)$/i;
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
r = await call('/api/v1/produtos?limite=2&pagina=1'); assert.equal(r.json.data.length, 2); { const { freshness, ...m } = r.json.meta; assert.deepEqual(m, { page: 1, limit: 2, total: 3, pages: 2 }); assert.equal(freshness.status, 'atual'); assert.equal(freshness.source, 'state'); }
r = await call('/api/v1/produtos?limite=2&pagina=2'); assert.equal(r.json.data.length, 1);
r = await call('/api/v1/produtos?limite=999'); assert.equal(r.json.meta.limit, 50, 'limite máximo 50');
r = await call('/api/v1/produtos?pagina=9'); assert.equal(r.json.data.length, 0); assert.equal(r.json.meta.total, 3);
r = await call('/api/v1/produtos?ordem=xpto'); assert.equal(r.status, 400);
// produto inexistente / identificador inválido / rota / método
assert.equal((await call('/api/v1/produtos/nao-existe')).status, 404);
assert.equal((await call('/api/v1/produtos/..%2F..%2Fetc')).status, 400);
assert.equal((await call('/api/v1/xyz')).status, 404);
assert.equal((await call('/api/v1/home', 'POST')).status, 405);
// inputs extremos: limites fixados, valores absurdos não quebram nem estouram
r = await call('/api/v1/produtos?limite=-5&pagina=0'); assert.equal(r.status, 200); assert.equal(r.json.meta.limit, 1); assert.equal(r.json.meta.page, 1);
r = await call('/api/v1/produtos?limite=abc&pagina=99999999999999999999'); assert.equal(r.status, 200); assert.equal(r.json.meta.limit, 24); assert.equal(r.json.meta.page, 10_000);
r = await call('/api/v1/produtos?busca=' + 'x'.repeat(100_000)); assert.equal(r.status, 200, 'busca gigante é truncada, não rejeitada');
r = await call('/api/v1/site/ofertas?produtos=' + Array.from({ length: 200 }, (_, i) => `p${i}`).join(',')); assert.equal(r.status, 400, 'mais de 60 ids');
r = await call('/api/v1/site/produtos?limite=100000&pagina=100000'); assert.equal(r.json.limit, 60); assert.equal(r.json.page, 1000);
assert.equal((await call('/api/v1/produtos/' + 'a'.repeat(500))).status, 400, 'slug longo demais');
{ const n = _cache.size; for (let i = 0; i < 20; i++) await call(`/api/v1/produtos?limite=2&lixo=${i}`); assert.ok(_cache.size <= n + 1, 'parâmetros desconhecidos não multiplicam entradas do cache'); }
// prazo total: fonte que não responde vira 503 curto com Retry-After (não deixa o pedido pendurado até a plataforma matar a função)
{
  setLegacyLoader(() => new Promise(() => {}));
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  const t0 = Date.now(); await api({ url: '/api/v1/produtos?pagina=77', method: 'GET' }, res, { deadlineMs: 50 });
  assert.equal(res.statusCode, 503); assert.equal(res.headers['Retry-After'], '5'); assert.equal(res.headers['Cache-Control'], 'no-store'); assert.ok(Date.now() - t0 < 2000);
  setLegacyLoader(async () => fx());
}
// preço atual, estoque, referência (state)
r = await call('/api/v1/produtos/me05-etb'); const ps = r.json.data.stats;
assert.equal(ps.market.current_price, 360, 'menor preço com estoque e confirmado (od não confirmada fica de fora)'); assert.equal(ps.market.current_total_price, 380);
assert.equal(ps.coverage.in_stock_offers, 2); assert.deepEqual(ps.reference, { value: 400, status: 'verified', source: null, verified_at: null });
r = await call('/api/v1/produtos/me05-booster'); assert.equal(r.json.data.references.length, 0); assert.equal(r.json.data.stats.reference, null, 'sem referência');
r = await call('/api/v1/produtos/sv9-lata'); assert.equal(r.json.data.stats.status, 'no_offers'); assert.equal(r.json.data.stats.market.current_price, null, 'sem ofertas');
assert.equal(r.json.data.references[0].status, 'pending');
r = await call('/api/v1/produtos/me05-etb/ofertas?limite=10'); assert.equal(r.json.meta.total, 5);
assert.equal(r.json.data.find((o) => o.id === 'oa').total_price, null, 'frete desconhecido: total nulo, nunca o preço');
r = await call('/api/v1/oportunidades'); assert.equal(r.status, 200); assert.equal(r.json.meta.status, 'requires_db'); assert.deepEqual(r.json.data, []);
assert.equal((await call('/api/v1/oportunidades?faixa=otima')).status, 400); assert.equal((await call('/api/v1/oportunidades?ofertas=x')).status, 400);
r = await call('/api/v1/referencias?status=verified'); assert.equal(r.json.data.length, 1);


// ------------------------------------------------------------------ A) FASE 4 — páginas do site (state.json)
// lista de produtos: filtros, ordenação, paginação, "sem preço sugerido" sob demanda
r = await call('/api/v1/site/produtos'); assert.equal(r.status, 200); assert.equal(r.headers['X-Data-Source'], 'state');
assert.deepEqual(r.json.items.map((e) => e.p.id), ['me05-etb'], 'modo guardar: só produto com referência');
assert.equal(r.json.items[0].o.id, 'od', 'melhor oferta: menor preço com estoque (od R$ 340; como no site, "viva" não exige confirmação)');
assert.equal(r.json.noCopagCount, 1); assert.equal(r.json.noCopag, undefined, 'lista sem referência não vem na 1ª carga');
assert.deepEqual(r.json.facets.groups, [['Boosters', 1], ['ETB', 1]]); assert.ok(r.json.facets.stores.some(([id]) => id === 'mercadolivre'));
r = await call('/api/v1/site/produtos?semref=1'); assert.deepEqual(r.json.items.map((e) => e.p.id), ['me05-booster']);
r = await call('/api/v1/site/produtos?modo=abrir&ordem=ppb'); assert.deepEqual(r.json.items.map((e) => e.p.id), ['me05-booster', 'me05-etb'], 'abrir: por preço por booster');
r = await call('/api/v1/site/produtos?modo=abrir&limite=1&pagina=2'); assert.equal(r.json.items.length, 1); assert.equal(r.json.pages, 2); assert.equal(r.json.total, 2);
r = await call('/api/v1/site/produtos?loja=b'); assert.equal(r.json.items[0].o.id, 'ob', 'filtro de loja: a melhor oferta daquela loja (empate de total com oa desfeito pelo Deal Score)');
r = await call('/api/v1/site/produtos?max=300'); assert.equal(r.json.total, 0, 'preço até R$ 300: nenhuma ETB com estoque');
r = await call('/api/v1/site/produtos?estoque=0&loja=rihappycombr'); assert.equal(r.json.total, 0, 'sem estoque negado: oferta sem estoque (oc) não entra');
r = await call('/api/v1/site/produtos?grupo=Latas'); assert.equal(r.json.total, 0, 'produto sem oferta não aparece na lista');
for (const bad of ['modo=x', 'ordem=x', 'grupo=x', 'max=-1']) assert.equal((await call('/api/v1/site/produtos?' + bad)).status, 400, bad);
// produto: ofertas, frete, referência, pistas; inexistente; sem ofertas
r = await call('/api/v1/site/produto/me05-etb'); const sp = r.json;
assert.equal(sp.offers.length, 5); assert.equal(sp.liveCount, 3); assert.equal(sp.product.msrp, 400);
assert.equal(sp.offers.find((o) => o.id === 'ob').shipping, 20); assert.ok(!sp.offers.find((o) => o.id === 'oa').shippingKnown, 'frete desconhecido continua desconhecido');
assert.equal(sp.tips.length, 1); assert.equal(sp.tips[0].text, undefined, 'pista sem texto bruto');
assert.equal((await call('/api/v1/site/produto/nao-existe')).status, 404);
r = await call('/api/v1/site/produto/sv9-lata'); assert.equal(r.status, 200); assert.deepEqual(r.json.offers, []); assert.equal(r.json.product.copagReference, 99.9);
// coleção, tipo e busca: só as ofertas candidatas
r = await call('/api/v1/site/ofertas?colecao=me05'); assert.deepEqual(r.json.offers.map((o) => o.id).sort(), ['oc', 'od', 'of'], 'melhor com estoque (od), menor de todas para o cartão sem estoque (oc), booster (of)');
assert.equal(r.json.liveCount['me05-etb'], 3);
r = await call('/api/v1/site/ofertas?tipo=lata'); assert.deepEqual(r.json.offers, []);
r = await call('/api/v1/site/ofertas?busca=etb%20barata&produtos=me05-etb'); assert.equal(r.json.tips.length, 1);
assert.equal((await call('/api/v1/site/ofertas')).status, 400);

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
// oportunidades: lidas do resultado persistido do Opportunity Engine (nada é recalculado no request)
{ const { runOpportunityEngine } = await import('../src/core/opportunity-run.js'); await tx((c) => runOpportunityEngine(c)); _cache.clear();
  const ro = await call('/api/v1/oportunidades?limite=50'); assert.equal(ro.status, 200); assert.equal(ro.headers['X-Data-Source'], 'db');
  assert.ok(ro.json.data.length > 0); assert.equal(ro.json.meta.engine, 'opportunity-v2.2');
  for (const x of ro.json.data) {
    for (const k of ['product', 'offer', 'price', 'total', 'stock', 'store', 'marketplace', 'opportunity_score', 'opportunity_band', 'confidence', 'current_reference', 'historical_context', 'community_reference', 'warnings', 'reasons', 'updated_at']) assert.ok(k in x, k);
    assert.ok(['COPAG_OFFICIAL_CURRENT', 'MARKET_CURRENT', 'NONE'].includes(x.current_reference.kind));
    assert.ok(!('offer_id' in x) && !('product_id' in x), 'sem ids internos');
  }
  const scores = ro.json.data.map((x) => x.opportunity_score); assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
  const all = await call('/api/v1/oportunidades?ofertas=todas&limite=50'); assert.ok(all.json.meta.total >= ro.json.meta.total);
  _cache.clear();
}
const hDb = r.json; const hSt = slimHome(S0, { now });
const cmp = compareHome(hDb, hSt);
assert.equal(cmp.critical, 0, JSON.stringify(cmp.details));
assert.deepEqual(cmp.summary.offerFieldDiffs, 0, JSON.stringify(cmp.details.offerFieldDiffs));
assert.ok(hDb.offers.every((o) => !('dealScore' in o) && !('scoreParts' in o)), 'Deal Score do robô não vai mais ao navegador');
// nota oficial por oferta (6C.2): a mesma linha de hunter.opportunity de /oportunidades?ofertas=todas
{ const { clearCatalogCache } = await import('../api/_lib/catalog.mjs'); clearCatalogCache(); _cache.clear();
  const h2 = (await call('/api/v1/home')).json; const allOpp = (await call('/api/v1/oportunidades?ofertas=todas&limite=50')).json.data;
  const byOffer = new Map(allOpp.map((x) => [x.offer.id, x])); let withOpp = 0;
  for (const o of h2.offers) {
    const x = byOffer.get(o.id);
    if (!x) { assert.ok(!o.opp, `oferta ${o.id} sem avaliação não ganha nota`); continue; }
    withOpp++; assert.deepEqual(o.opp, { score: x.opportunity_score, band: x.opportunity_band, confidence: x.confidence, level: x.confidence_level }, `oferta ${o.id}`);
  }
  assert.ok(withOpp > 0, 'alguma oferta com nota oficial');
  const sp = (await call('/api/v1/site/produto/me05-etb')).json;
  for (const o of sp.offers) { assert.ok(!('dealScore' in o) && !('scoreParts' in o)); if (byOffer.has(o.id)) assert.equal(o.opp.score, byOffer.get(o.id).opportunity_score, `produto: oferta ${o.id}`); }
  clearCatalogCache(); _cache.clear();
}
// vendedor parceiro preservado (Ri Happy) — o site mostra "Gourmande via Ri Happy"
r = await call('/api/v1/produtos/me05-etb/ofertas?limite=50'); assert.equal(r.json.data.find((o) => o.id === 'oc').seller, 'Gourmande');
assert.equal(r.json.data.find((o) => o.id === 'oa').total_price, null);
// paginação e filtros no banco
r = await call('/api/v1/produtos?limite=1&pagina=2&ordem=nome'); assert.equal(r.json.data.length, 1); { const { freshness, ...m } = r.json.meta; assert.deepEqual(m, { page: 2, limit: 1, total: 3, pages: 3 }); assert.equal(freshness.source, 'db'); assert.equal(freshness.ageMin, 60, 'horário do banco = última leitura sincronizada (T(1))'); assert.equal(freshness.status, 'atrasado'); }
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
// FASE 4 — páginas pelo banco: mesmas respostas que pelo state.json (regras do site no servidor)
const { clearCatalogCache: ccc } = await import('../api/_lib/catalog.mjs'); ccc(); _cache.clear();
// a ordem padrão ("Melhor oportunidade") usa a nota oficial, que só existe no banco; as demais ordens seguem iguais nas duas fontes
for (const q of ['?ordem=price', '?semref=1&ordem=disc', '?modo=abrir', '?loja=mercadolivre&ordem=price', '?estoque=0&ordem=new', '?grupo=ETB&ordem=disc', '?max=1000&abaixo=1&ordem=price']) {
  const a = (await call('/api/v1/site/produtos' + q)).json; const b = (await call('/api/v1/site/produtos' + q + (q ? '&' : '?') + 'fonte=state')).json;
  assert.equal(a.source, 'db'); assert.equal(b.source, 'state');
  assert.deepEqual(a.items.map((e) => [e.p.id, e.o.id, e.o.total, e.n]), b.items.map((e) => [e.p.id, e.o.id, e.o.total, e.n]), `lista ${q}`);
  assert.ok([...a.items, ...b.items].every((e) => !('dealScore' in e.o) && !('scoreParts' in e.o)), `sem Deal Score ${q}`);
  assert.deepEqual(a.facets, b.facets, `filtros ${q}`); assert.equal(a.noCopagCount, b.noCopagCount);
}
// "Melhor oportunidade" (padrão): banco ordena pela nota oficial da oferta exibida; sem banco não há nota e segue o desconto
{ const a = (await call('/api/v1/site/produtos?estoque=0')).json; const b = (await call('/api/v1/site/produtos?estoque=0&fonte=state')).json;
  const s = (e) => e.o.opp?.score ?? -1; const okOrder = (items, f) => items.every((e, i) => i === 0 || f(items[i - 1]) >= f(e));
  assert.ok(okOrder(a.items, s), 'banco: nota oficial decrescente'); assert.ok(a.items.some((e) => e.o.opp), 'banco: há notas');
  assert.ok(b.items.every((e) => !e.o.opp), 'state.json: sem nota oficial (nada estimado)');
  assert.ok(okOrder(b.items, (e) => e.o.discount ?? -9), 'state.json: sem nota, segue o desconto');
  assert.deepEqual(a.items.map((e) => e.p.id).sort(), b.items.map((e) => e.p.id).sort(), 'mesmos produtos nas duas fontes'); }
// página do produto pelo banco: Price Engine define preço médio; frete e estoque iguais ao state.json
r = await call('/api/v1/site/produto/me05-etb'); assert.equal(r.headers['X-Data-Source'], 'db');
assert.equal(r.json.stats.market.average, 370, 'preço médio = Price Engine (média do preço com estoque)'); assert.equal(r.json.product.marketAverage, 370);
const so = (await call('/api/v1/site/produto/me05-etb?fonte=state')).json;
const key = (o) => [o.id, o.price, o.total, o.stock, o.shipping ?? null, o.storeName, o.seller ?? null];
assert.deepEqual(r.json.offers.map(key).sort(), so.offers.map(key).sort(), 'ofertas do produto: banco = state.json');
r = await call('/api/v1/site/produto/me05-booster'); assert.equal(r.json.product.msrp ?? null, null); assert.equal(r.json.stats.reference, null, 'produto sem referência');
r = await call('/api/v1/site/produto/sv9-lata'); assert.equal(r.json.stats.status, 'no_offers'); assert.equal(r.json.stats.history.status, 'insufficient', 'produto sem histórico');
// histórico por loja (gráfico): a linha do produto é o menor valor entre as lojas, dia a dia
r = await call('/api/v1/produtos/me05-etb/historico?dias=30&lojas=1'); const hs = r.json.data;
assert.ok(hs.stores && Object.keys(hs.stores).length >= 2);
for (const d of hs.series) assert.equal(Math.min(...Object.values(hs.stores).flatMap((x) => x.series.filter((q) => q.day === d.day).map((q) => q.min))), d.min);
r = await call('/api/v1/produtos/sv9-lata/historico?lojas=1'); assert.deepEqual(r.json.data.series, []);
// coleção pelo banco = state.json
const ca = (await call('/api/v1/site/ofertas?colecao=me05')).json, cb = (await call('/api/v1/site/ofertas?colecao=me05&fonte=state')).json;
assert.deepEqual(ca.offers.map((o) => o.id).sort(), cb.offers.map((o) => o.id).sort()); assert.deepEqual(ca.liveCount, cb.liveCount);
// cache: segunda chamada sai da memória
await call('/api/v1/site/produtos'); assert.equal((await call('/api/v1/site/produtos')).headers['X-Cache'], 'HIT');
// nada interno nas respostas das páginas
const pages = JSON.stringify([(await call('/api/v1/site/produtos')).json, (await call('/api/v1/site/produto/me05-etb')).json, ca]);
for (const k of ['match_confidence', 'matchConfidence', 'external_id', 'affiliate', 'quality', 'legacy_id', 'seller_id', 'sourceType', '"text"']) assert.ok(!pages.includes(k), `página não pode conter ${k}`);
// banco fora do ar → fallback seguro para o state.json
const { closeApiPool } = await import('../api/_lib/db.mjs'); await closeApiPool();
process.env.API_DATABASE_URL = 'postgres://x:y@127.0.0.1:1/nada'; _cache.clear();
const { clearCatalogCache } = await import('../api/_lib/catalog.mjs'); clearCatalogCache();   // sem isso, até 60 s servindo a última foto do banco (comportamento esperado)
r = await call('/api/v1/produtos/me05-etb'); assert.equal(r.status, 200); assert.equal(r.headers['X-Data-Source'], 'state'); assert.equal(r.headers['X-Fallback'], 'db-indisponivel');
r = await call('/api/v1/home'); assert.equal(r.status, 200); assert.equal(r.json.source, 'state');
r = await call('/api/v1/site/produtos'); assert.equal(r.status, 200); assert.equal(r.json.source, 'state'); assert.equal(r.headers['X-Fallback-Reason'], 'ECONNREFUSED');
r = await call('/api/v1/site/produto/me05-etb'); assert.equal(r.status, 200); assert.equal(r.json.source, 'state');
await closeApiPool(); await close();
console.log('OK — API v1 (state.json e PostgreSQL)');
