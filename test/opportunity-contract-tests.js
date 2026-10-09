// Fase 6B.0 — contrato de /api/v1/oportunidades: categoria, referência, comparação com a referência ATUAL usada pelo motor,
// filtros e ordens. Parte A pura (sempre). Parte B no PostgreSQL com TEST_DATABASE_URL (banco descartável).
import assert from 'node:assert/strict';
import { referenceComparison, opportunityConfidenceLevel } from '../src/core/references.js';
import { calculateOpportunity, confidenceLevel } from '../src/core/opportunity-engine.js';

let n = 0; const t = (name, fn) => { fn(); n++; };
const now = new Date('2026-10-08T12:00:00Z');
const O = (x = {}) => ({ id: '1', price: 360, shipping_status: 'unknown', stock_status: 'in_stock', status: 'active', confirmed: true, anomalous: false, store: { ra_status: null }, seller: {}, ...x });
const ST = (x = {}) => ({ number_of_in_stock_offers: 3, median_price: 380, lowest_current_price: 360, history_status: 'insufficient', ...x });

// ------------------------------------------------------------------ A) puro
t('motor: grava a referência atual que usou (Copag verificada) e a distância, sem mudar score', () => {
  const s = ST({ reference_kind: 'COPAG_OFFICIAL_CURRENT', reference_price: 400, reference_status: 'verified' });
  const o = calculateOpportunity(s, O(), { now });
  assert.equal(o.reference_kind, 'COPAG_OFFICIAL_CURRENT'); assert.equal(o.reference_value, 400); assert.equal(o.reference_gap, 0.1);
  assert.ok(o.reasons.some((r) => r.code === 'BELOW_REFERENCE'));
});
t('motor: mercado atual → MARKET_CURRENT; Copag não verificada → NONE (como o score já tratava)', () => {
  const m = calculateOpportunity(ST({ reference_kind: 'MARKET_CURRENT', reference_price: 1845, reference_status: 'derived' }), O({ price: 1250 }), { now });
  assert.equal(m.reference_kind, 'MARKET_CURRENT'); assert.equal(m.reference_gap, 0.3225);
  const p = calculateOpportunity(ST({ reference_kind: 'COPAG_OFFICIAL_CURRENT', reference_price: 400, reference_status: 'pending' }), O(), { now });
  assert.equal(p.reference_kind, 'NONE'); assert.equal(p.reference_value, null); assert.equal(p.reference_gap, null);
  assert.equal(p.reference_signal, null, 'o score também não usava essa referência');
});
t('motor: histórico e comunitária nunca viram referência atual', () => {
  const ctx = { historical: [{ kind: 'COPAG_OFFICIAL_HISTORICAL', price: 319.99, published_at: '2023-10', status: 'verified' }], community: [{ kind: 'COMMUNITY_REFERENCE', price: 299, source_url: 'https://x' }] };
  const o = calculateOpportunity(ST({ reference_kind: 'NONE', reference_price: null, reference_context: ctx }), O({ price: 250 }), { now });
  assert.equal(o.reference_kind, 'NONE'); assert.equal(o.reference_value, null); assert.equal(o.reference_gap, null);
});
t('referenceComparison: Copag, mercado, acima, ausente', () => {
  const below = [{ code: 'BELOW_REFERENCE', reference_kind: 'COPAG_OFFICIAL_CURRENT' }];
  assert.deepEqual(referenceComparison({ kind: 'COPAG_OFFICIAL_CURRENT', value: '400.00', gap: '0.1000', price: '360.00', reasons: below }),
    { available: true, reference_kind: 'COPAG_OFFICIAL_CURRENT', reference_label: 'Preço sugerido Copag', reference_value: 400, percentage_below: 10, amount_below: 40, position: 'below' });
  const m = referenceComparison({ kind: 'MARKET_CURRENT', value: 1844.95, gap: 0.3225, price: 1250, reasons: [{ code: 'BELOW_REFERENCE', reference_kind: 'MARKET_CURRENT' }] });
  assert.equal(m.percentage_below, 32.25); assert.equal(m.amount_below, 594.95); assert.equal(m.reference_label, 'Referência de mercado');
  const up = referenceComparison({ kind: 'MARKET_CURRENT', value: 100, gap: -0.2, price: 120, reasons: [{ code: 'ABOVE_REFERENCE', reference_kind: 'MARKET_CURRENT' }] });
  assert.equal(up.percentage_below, -20); assert.equal(up.amount_below, -20); assert.equal(up.position, 'above');
  assert.equal(referenceComparison({ kind: 'COPAG_OFFICIAL_CURRENT', value: 50, gap: 0.002, price: 49.9, reasons: [{ code: 'AT_REFERENCE' }] }).position, 'at', 'posição = classificação do motor');
  const none = referenceComparison({ kind: 'NONE', value: null, gap: null, price: 30 });
  assert.deepEqual(none, { available: false, reference_kind: 'NONE', reference_value: null, percentage_below: null, amount_below: null, position: null, reason: 'no_current_reference' });
  assert.equal(referenceComparison({ kind: null, value: null, gap: null, price: 30 }).reason, 'not_evaluated', 'linha ainda não regravada pelo motor');
});
t('referenceComparison: tipos históricos/comunitários nunca são comparação atual', () => {
  for (const kind of ['COPAG_OFFICIAL_HISTORICAL', 'MARKET_HISTORICAL', 'COMMUNITY_REFERENCE'])
    assert.equal(referenceComparison({ kind, value: 319.99, gap: 0.5, price: 160 }).available, false, kind);
});

t('confidence_level da API = faixas do motor (0 a 1, passo 0,001)', () => {
  for (let i = 0; i <= 1000; i++) { const c = i / 1000; assert.equal(opportunityConfidenceLevel(c), confidenceLevel(c), String(c)); }
  assert.equal(opportunityConfidenceLevel(null), null);
});

// validação de parâmetros (sem banco: o erro sai antes da leitura)
const { default: api, _cache } = await import('../api/v1.mjs');
// Lote 2: os dados destes testes são de 08/10 12:00 (now); o frescor é avaliado nesse mesmo relógio.
const { setFreshnessClock } = await import('../api/_lib/freshness.mjs'); setFreshnessClock(() => now.getTime());
const call = async (url) => { const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } }; await api({ url, method: 'GET' }, res); return { status: res.statusCode, headers: res.headers, json: JSON.parse(res.body) }; };
const savedDb = process.env.API_DATABASE_URL; delete process.env.API_DATABASE_URL;
for (const bad of ['categoria=x-1', 'categoria=Outros', 'referencia=historica', 'referencia=comunitaria', 'ordem=desconto', 'ordem=drop', 'produto=..%2Fx', 'produto=a%20b', 'produto=a%27b'])
  assert.equal((await call(`/api/v1/oportunidades?${bad}`)).status, 400, bad);
for (const ok of ['categoria=etb', 'categoria=Blisters', 'categoria=Cole%C3%A7%C3%B5es', 'referencia=copag', 'abaixo=10', 'confianca_minima=50', 'produto=me05-etb', 'produto=me05-etb&ofertas=todas',
  ...['score', 'preco', 'confianca', 'abaixo', 'economia', 'queda', 'recentes'].map((o) => `ordem=${o}`)])
  assert.equal((await call(`/api/v1/oportunidades?${ok}`)).status, 200, ok);
n++;
if (savedDb) process.env.API_DATABASE_URL = savedDb;

if (!process.env.TEST_DATABASE_URL) { console.log(`✓ Contrato de oportunidades (6B.0): ${n} grupos puros passaram; banco pulado (sem TEST_DATABASE_URL)`); process.exit(0); }

// ------------------------------------------------------------------ B) banco
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const { pool, tx, close } = await import('../src/db/pg.js');
const { syncState } = await import('../src/core/sync.js');
const { runPriceEngine } = await import('../src/core/price-stats.js');
const { runOpportunityEngine } = await import('../src/core/opportunity-run.js');
const { execFileSync } = await import('node:child_process');
const p = await pool(); await p.query('DROP SCHEMA IF EXISTS hunter CASCADE');
execFileSync('node', ['tools/db-migrate.mjs'], { env: process.env, stdio: 'pipe' });

const catalog = { collections: [{ id: 'me05', name: 'Escuridão Absoluta', series: 'Megaevolução' }, { id: 'sv4', name: 'Fenda Paradoxal', series: 'Escarlate e Violeta' }] };
const products = [
  { id: 'me05-etb', collection: 'me05', collectionName: 'Escuridão Absoluta', type: 'etb', typeLabel: 'Treinador Avançado (ETB)', group: 'ETB', boosters: 9, image: 'https://img/etb.png',
    copagConfirmed: true, msrp: 400, copag: { source_url: 'https://www.copagloja.com.br/etb/p', confidence: 'OFICIAL', source_timestamp: '2026-10-08T10:00:00Z' } },
  { id: 'sv4-box', collection: 'sv4', collectionName: 'Fenda Paradoxal', type: 'booster_box', typeLabel: 'Booster Box', group: 'Boosters', boosters: 36 },
  { id: 'me05-blister3', collection: 'me05', collectionName: 'Escuridão Absoluta', type: 'blister_3', typeLabel: 'Blister Triplo', group: 'Blisters', boosters: 3 },
];
const mk = (id, productId, storeId, price, first, x = {}) => ({ id, productId, storeId, storeName: storeId, title: id, url: `https://${storeId}/${id}`, price, total: price, shipping: null, shippingKnown: false,
  stock: 'IN_STOCK', matchConfidence: 0.9, firstSeen: first, source_timestamp: '2026-10-08T11:00:00Z', confirmed: true, ...x });
const ml = (id, seller, price, first) => mk(id, 'sv4-box', 'mercadolivre', price, first, { storeName: 'Mercado Livre', seller, sellerId: seller, sellerKind: 'marketplace_seller', sku: 'MLB' + id });
const offers = [
  mk('e1', 'me05-etb', 'a', 360, '2026-10-01T10:00:00Z'), mk('e2', 'me05-etb', 'b', 380, '2026-10-01T10:00:00Z'), mk('e3', 'me05-etb', 'c', 390, '2026-10-01T10:00:00Z'),
  ml('m1', 'A', 1250, '2026-10-07T10:00:00Z'), ml('m2', 'B', 1800, '2026-10-02T10:00:00Z'), ml('m3', 'C', 1890, '2026-10-02T10:00:00Z'), ml('m4', 'D', 2200, '2026-10-02T10:00:00Z'),
  mk('b1', 'me05-blister3', 'a', 30, '2026-10-05T10:00:00Z'),
];
const state = { collections: [], products, offers, reputation: {},
  sources: ['a', 'b', 'c', 'mercadolivre'].map((id) => ({ id, name: id, url: `https://${id}.com.br`, status: 'ACTIVE' })) };
await tx((c) => syncState(c, { state, catalog, historyLines: [] }));
// contexto que NÃO pode virar referência atual: preço de lançamento (histórico) e referência comunitária
const pid = async (id) => (await p.query('SELECT id FROM hunter.product WHERE legacy_id = $1', [id])).rows[0].id;
for (const [prod, kind, value, extra] of [['sv4-box', 'COPAG_OFFICIAL_HISTORICAL', 319.99, { published_at: '2023-10', status: 'pending' }], ['sv4-box', 'COMMUNITY_REFERENCE', 999, {}],
  ['me05-blister3', 'COPAG_OFFICIAL_HISTORICAL', 29.9, { published_at: '2024-01', status: 'verified' }], ['me05-blister3', 'COMMUNITY_REFERENCE', 25, {}]])
  await p.query(`INSERT INTO hunter.reference_price (product_id, value, source, source_url, verification_status, confidence, reference_kind, published_at)
    VALUES ($1, $2, $3, $4, $5, 60, $6, $7)`, [await pid(prod), value, kind === 'COMMUNITY_REFERENCE' ? 'comunidade' : 'copag', kind === 'COMMUNITY_REFERENCE' ? 'https://ligapokemon.com.br/x' : 'https://www.copag.com.br/blog/x',
    extra.status || 'verified', kind, extra.published_at || null]);
await tx((c) => runPriceEngine(c, { asOf: new Date('2026-10-08T12:00:00Z') }));
await tx((c) => runOpportunityEngine(c, { now }));
process.env.API_DATABASE_URL = process.env.TEST_DATABASE_URL; _cache.clear();
const get = async (qs = '') => { _cache.clear(); const r = await call(`/api/v1/oportunidades?limite=50${qs ? '&' + qs : ''}`); assert.equal(r.status, 200, qs + ' ' + JSON.stringify(r.json)); return r.json; };
const ids = (j) => j.data.map((x) => x.product.id);

// compatibilidade: sem filtros, contrato antigo inteiro + campos novos
const all = await get();
assert.equal(all.meta.total, 3); assert.equal(all.meta.engine, 'opportunity-v2.2');
for (const x of all.data) {
  for (const k of ['product', 'offer', 'price', 'total', 'stock', 'store', 'marketplace', 'opportunity_score', 'opportunity_band', 'confidence', 'current_reference', 'market_composition',
    'historical_context', 'community_reference', 'warnings', 'reasons', 'updated_at', 'reference_comparison', 'product_variation_7d', 'confidence_level']) assert.ok(k in x, k);
  assert.equal(x.confidence_level, opportunityConfidenceLevel(x.confidence));
  for (const k of ['type', 'type_label', 'group', 'image', 'collection']) assert.ok(k in x.product, 'product.' + k);
  for (const k of ['id', 'title', 'url', 'image', 'first_seen_at', 'price_kind']) assert.ok(k in x.offer, 'offer.' + k);
}
const scores = all.data.map((x) => x.opportunity_score); assert.deepEqual(scores, [...scores].sort((a, b) => b - a), 'ordem padrão continua score');
const by = Object.fromEntries(all.data.map((x) => [x.product.id, x]));

// Copag atual
const etb = by['me05-etb'];
assert.equal(etb.current_reference.kind, 'COPAG_OFFICIAL_CURRENT');
assert.deepEqual(etb.reference_comparison, { available: true, reference_kind: 'COPAG_OFFICIAL_CURRENT', reference_label: 'Preço sugerido Copag', reference_value: 400, percentage_below: 10, amount_below: 40, position: 'below' });
assert.equal(etb.reference_comparison.reference_value, etb.current_reference.price, 'mesma referência atual do contrato');
// mercado (só marketplace): a comparação usa a mediana do mercado, nunca o histórico (319,99) nem a comunitária (999)
const box = by['sv4-box'];
assert.equal(box.current_reference.kind, 'MARKET_CURRENT'); assert.equal(box.current_reference.market_composition, 'MARKETPLACE_ONLY');
assert.ok(box.warnings.some((w) => w.code === 'MARKETPLACE_ONLY'));
assert.equal(box.reference_comparison.reference_kind, 'MARKET_CURRENT'); assert.equal(box.reference_comparison.reference_value, box.current_reference.price);
assert.equal(box.reference_comparison.percentage_below, Math.round((box.current_reference.price - box.price) / box.current_reference.price * 10000) / 100);
assert.ok(box.historical_context.some((h) => h.price === 319.99) && box.community_reference?.price === 999, 'contexto continua exposto como contexto');
assert.ok(![319.99, 999].includes(box.reference_comparison.reference_value));
// sem referência atual: nenhum percentual, mesmo com histórico verificado e comunitária
const bl = by['me05-blister3'];
assert.equal(bl.current_reference.kind, 'NONE');
assert.deepEqual(bl.reference_comparison, { available: false, reference_kind: 'NONE', reference_value: null, percentage_below: null, amount_below: null, position: null, reason: 'no_current_reference' });
assert.ok(bl.historical_context.some((h) => h.price === 29.9 && h.status === 'verified') && bl.community_reference?.price === 25);
n += 4;

// categoria = a do site (tipo ou grupo do produto)
assert.deepEqual(ids(await get('categoria=ETB')), ['me05-etb']); assert.deepEqual(ids(await get('categoria=etb')), ['me05-etb']);
assert.deepEqual(ids(await get('categoria=Boosters')), ['sv4-box']); assert.deepEqual(ids(await get('categoria=booster_box')), ['sv4-box']);
assert.deepEqual(ids(await get('categoria=Blisters')), ['me05-blister3']); assert.deepEqual((await get('categoria=Latas')).data, []);
// referência atual
assert.deepEqual(ids(await get('referencia=copag')), ['me05-etb']); assert.deepEqual(ids(await get('referencia=mercado')), ['sv4-box']);
assert.deepEqual(ids(await get('referencia=nenhuma')), ['me05-blister3']);
// abaixo da referência (no backend, sobre a distância gravada pelo motor)
assert.deepEqual(ids(await get('abaixo=20')), ['sv4-box']); assert.deepEqual(ids(await get('abaixo=5')).sort(), ['me05-etb', 'sv4-box']);
// confiança mínima e combinações
const cmin = Math.round(Math.min(...all.data.map((x) => x.confidence)) * 100) + 1;
assert.ok((await get(`confianca_minima=${cmin}`)).data.every((x) => x.confidence * 100 >= cmin));
assert.deepEqual((await get('confianca_minima=100')).data, []);
assert.deepEqual(ids(await get('categoria=Boosters&referencia=mercado&abaixo=30')), ['sv4-box']);
n += 4;

// ordens (todas no servidor; sem dado → fim da lista)
assert.deepEqual(ids(await get('ordem=abaixo')), ['sv4-box', 'me05-etb', 'me05-blister3']);
assert.deepEqual(ids(await get('ordem=economia')), ['sv4-box', 'me05-etb', 'me05-blister3']);
assert.deepEqual(ids(await get('ordem=preco')), ['me05-blister3', 'me05-etb', 'sv4-box']);
assert.deepEqual(ids(await get('ordem=recentes')), ['sv4-box', 'me05-blister3', 'me05-etb'], 'm1 (07/10), b1 (05/10), e1 (01/10)');
assert.deepEqual(ids(await get('ordem=queda')), ids(all), 'sem variação de 7 dias: mesma ordem do score');
const cf = (await get('ordem=confianca')).data.map((x) => x.confidence); assert.deepEqual(cf, [...cf].sort((a, b) => b - a));
n += 1;

// filtro por produto (6C.2): mesma fonte, mesma nota; com ofertas=todas, a nota oficial de cada oferta avaliada do produto
{
  const one = await get('produto=me05-etb');
  assert.deepEqual(ids(one), ['me05-etb']); assert.equal(one.meta.total, 1);
  assert.deepEqual(one.data[0], by['me05-etb'], 'idêntico ao item da lista geral');
  const slug = by['me05-etb'].product.slug; assert.ok(slug && slug !== 'me05-etb');
  assert.deepEqual(await get(`produto=${slug}`), one, 'aceita o slug');
  const allOffers = await get('ofertas=todas');
  const each = await get('produto=me05-etb&ofertas=todas');
  assert.deepEqual(each.data.map((x) => x.offer.id).sort(), ['e1', 'e2', 'e3']);
  assert.ok(each.data.every((x) => x.product.id === 'me05-etb'));
  const sc = each.data.map((x) => x.opportunity_score); assert.deepEqual(sc, [...sc].sort((a, b) => b - a), 'ordem padrão: score');
  for (const x of each.data) assert.deepEqual(x, allOffers.data.find((y) => y.offer.id === x.offer.id), `oferta ${x.offer.id} igual à lista geral`);
  assert.equal(each.data[0].offer.id, one.data[0].offer.id, 'a melhor oferta do produto é a mesma da lista por produto');
  assert.deepEqual((await get('produto=nao-existe')).data, []); assert.deepEqual((await get('produto=nao-existe&ofertas=todas')).data, []);
  assert.deepEqual(ids(await get('produto=me05-etb&categoria=Boosters')), [], 'combina com os outros filtros');
}
n += 1;

// nada interno vazou
const keys = new Set(); (function walk(x) { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) { keys.add(k); walk(v); } })(all);
for (const k of ['offer_id', 'product_id', 'reference_gap', 'opp_reference_kind', 'legacy_id', 'match_confidence', 'external_id']) assert.ok(!keys.has(k), k);
n++;
await close();
console.log(`✓ Contrato de oportunidades (6B.0): ${n} grupos passaram (puro + banco)`);
