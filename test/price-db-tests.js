// Price Engine + limpeza da fila de revisão no PostgreSQL real: só roda com TEST_DATABASE_URL (banco descartável).
import assert from 'node:assert/strict';
if (!process.env.TEST_DATABASE_URL) { console.log('— testes de banco do Price Engine pulados (sem TEST_DATABASE_URL)'); process.exit(0); }
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const { pool, tx, close } = await import('../src/db/pg.js');
const { syncState } = await import('../src/core/sync.js');
const { runPriceEngine } = await import('../src/core/price-stats.js');
const { execFileSync } = await import('node:child_process');
const p = await pool();
const q = async (sql, a = []) => (await p.query(sql, a)).rows;
await p.query('DROP SCHEMA IF EXISTS hunter CASCADE');
execFileSync('node', ['tools/db-migrate.mjs'], { env: process.env, stdio: 'pipe' });

// --- migration 003: as 7 duplicatas legadas nascem rejeitadas, com motivo e auditoria ---
const rej = await q(`SELECT entity_id, status, decision_reason, decided_by_label, decided_at FROM hunter.review_item ORDER BY entity_id`);
assert.equal(rej.length, 7); assert.ok(rej.every((r) => r.status === 'rejected' && /duplicate legacy/.test(r.decision_reason) && r.decided_by_label && r.decided_at));
assert.equal((await q(`SELECT count(*)::int n FROM hunter.system_event WHERE type = 'REVIEW_DECIDED'`))[0].n, 7);

// --- cenário real em miniatura ---
const catalog = { collections: [{ id: 'me05', name: 'Escuridão Absoluta', series: 'Megaevolução' }, { id: 'sv9', name: 'Amigos de Jornada', series: 'Escarlate e Violeta' }] };
const prod = { id: 'me05-etb', collection: 'me05', collectionName: 'Escuridão Absoluta', type: 'etb', typeLabel: 'Treinador Avançado (ETB)', group: 'ETB', boosters: 9,
  copagConfirmed: true, msrp: 400, copag: { source_url: 'https://www.copagloja.com.br/etb/p', confidence: 'OFICIAL', source_timestamp: '2026-10-08T10:00:00Z' } };
const sv9 = { id: 'sv9-etb', collection: 'sv9', collectionName: 'Amigos de Jornada', type: 'etb', typeLabel: 'Treinador Avançado (ETB)', group: 'ETB', boosters: 9 };
const legacy = { ...sv9, id: 'ev09-etb', collection: 'ev09' };   // duplicata legada: não pode reabrir a revisão
const mk = (id, storeId, price, stock, extra = {}) => ({ id, productId: 'me05-etb', storeId, title: 'ETB', url: `https://${storeId}/etb`, price, total: price, shipping: null, shippingKnown: false, stock, matchConfidence: 0.9, firstSeen: '2026-10-05T10:00:00Z', source_timestamp: '2026-10-09T12:00:00Z', ...extra });
const state = {
  collections: [], products: [prod, sv9, legacy],
  sources: ['a', 'b', 'c', 'velha'].map((id) => ({ id, name: id, url: `https://${id}.com.br`, status: 'ACTIVE' })), reputation: {},
  distrust: { stores: ['velha'], until: '2026-10-07' },
  offers: [
    mk('oa', 'a', 380, 'IN_STOCK'),
    mk('ob', 'b', 360, 'IN_STOCK', { shipping: 20, shippingKnown: true, total: 380 }),
    mk('oc', 'c', 300, 'OUT_OF_STOCK'),
  ],
};
const H = [
  { t: '2026-10-05T10:00:00Z', offerId: 'oa', productId: 'me05-etb', storeId: 'a', price: 420, total: 420, stock: 'IN_STOCK' },
  { t: '2026-10-05T10:00:00Z', offerId: 'ov', productId: 'me05-etb', storeId: 'velha', price: 39.9, total: 39.9, stock: 'IN_STOCK' },   // parcela lida como preço
  { t: '2026-10-06T10:00:00Z', offerId: 'og', productId: 'me05-etb', storeId: 'c', price: 350, total: 350, stock: 'IN_STOCK' },        // oferta que depois sumiu
  { t: '2026-10-07T10:00:00Z', offerId: 'og', productId: 'me05-etb', storeId: 'c', stock: 'UNAVAILABLE', event: 'removed' },
  { t: '2026-10-08T10:00:00Z', offerId: 'oa', productId: 'me05-etb', storeId: 'a', price: 380, total: 380, stock: 'IN_STOCK' },
  { t: '2026-10-09T10:00:00Z', offerId: 'ob', productId: 'me05-etb', storeId: 'b', price: 360, shipping: 20, total: 380, stock: 'IN_STOCK' },
  { t: '2026-10-09T10:00:00Z', offerId: 'oc', productId: 'me05-etb', storeId: 'c', price: 300, total: 300, stock: 'OUT_OF_STOCK' },
];
const s1 = await tx((c) => syncState(c, { state, catalog, historyLines: H }));
assert.equal(s1.duplicatesToReview, 1);
assert.equal((await q(`SELECT status FROM hunter.review_item WHERE entity_id = 'ev09-etb'`))[0].status, 'rejected', 'sincronização não reabre duplicata rejeitada');
assert.equal((await q(`SELECT count(*)::int n FROM hunter.review_item WHERE status = 'open'`))[0].n, 0);
assert.equal((await q(`SELECT until_day::text d FROM hunter.source_distrust WHERE store_id = 'velha'`))[0].d, '2026-10-07');
const histBefore = (await q('SELECT count(*)::int n FROM hunter.price_history'))[0].n;

const asOf = new Date('2026-10-10T12:00:00Z');
const e1 = await tx((c) => runPriceEngine(c, { asOf }));
assert.equal(e1.products, 2); assert.equal(e1.statsWritten, 2);
const st = (await q(`SELECT s.* FROM hunter.product_stats s JOIN hunter.product p ON p.id = s.product_id WHERE p.legacy_id = 'me05-etb'`))[0];
const n = (v) => (v == null ? null : Number(v));
assert.equal(n(st.current_price), 360); assert.equal(n(st.current_total_price), 380, 'total só da oferta com frete conhecido');
assert.equal(n(st.lowest_current_price), 360); assert.equal(n(st.highest_current_price), 380);
assert.equal(n(st.average_price), 370); assert.equal(n(st.median_price), 370);
assert.equal(st.number_of_active_offers, 3); assert.equal(st.number_of_in_stock_offers, 2, 'sem estoque fora do preço atual');
assert.equal(st.number_of_stores, 3); assert.equal(st.number_of_marketplaces, 1); assert.equal(n(st.shipping_coverage), 0.5);
assert.equal(n(st.reference_price), 400); assert.equal(st.reference_status, 'verified'); assert.equal(n(st.discount_vs_reference), 0.1);
// histórico: 05 = 420 (39,90 da loja desconfiável fora), 06 = 350 (oferta que sumiu depois), 07 = 350, 08 = 380, 09 = 360, 10 = 360
const daily = await q(`SELECT day::text, min_price::float8 AS v FROM hunter.price_daily d JOIN hunter.product p ON p.id = d.product_id WHERE p.legacy_id = 'me05-etb' AND d.store_id = '' ORDER BY day`);
assert.deepEqual(daily.map((d) => [d.day, d.v]), [['2026-10-05', 420], ['2026-10-06', 350], ['2026-10-07', 350], ['2026-10-08', 380], ['2026-10-09', 360], ['2026-10-10', 360]]);
assert.equal(st.history_status, 'ok'); assert.equal(st.history_days, 6);
// série por loja: a do produto é o menor valor entre as lojas, dia a dia
const per = await q(`SELECT store_id, day::text, min_price::float8 v FROM hunter.price_daily d JOIN hunter.product p ON p.id = d.product_id WHERE p.legacy_id = 'me05-etb' AND d.store_id <> '' ORDER BY day, store_id`);
assert.ok(per.length > 0 && !per.some((r) => r.store_id === 'velha'), 'loja desconfiável sem série');
for (const d of daily) assert.equal(Math.min(...per.filter((r) => r.day === d.day).map((r) => r.v)), d.v, `dia ${d.day}`);
assert.equal(n(st.historical_min), 350); assert.equal(n(st.historical_max), 420); assert.equal(n(st.historical_median), 360);
assert.equal(n(st.historical_average), Math.round(((420 + 350 + 350 + 380 + 360 + 360) / 6) * 100) / 100);
assert.equal(n(st.variation_24h), 0); assert.equal(st.variation_7d, null); assert.equal(st.variation_30d, null);
assert.equal(n(st.distance_from_historical_min), Math.round(((360 - 350) / 350) * 1e4) / 1e4);
// as estatísticas históricas são reproduzíveis em SQL a partir de price_daily
const sqlHist = (await q(`SELECT min(min_price)::float8 mn, max(min_price)::float8 mx, round(avg(min_price), 2)::float8 av, percentile_cont(0.5) WITHIN GROUP (ORDER BY min_price)::float8 md
  FROM hunter.price_daily d JOIN hunter.product p ON p.id = d.product_id WHERE p.legacy_id = 'me05-etb' AND d.store_id = ''`))[0];
assert.deepEqual([sqlHist.mn, sqlHist.mx, sqlHist.av, sqlHist.md], [n(st.historical_min), n(st.historical_max), n(st.historical_average), n(st.historical_median)]);
// produto sem oferta
const empty = (await q(`SELECT s.* FROM hunter.product_stats s JOIN hunter.product p ON p.id = s.product_id WHERE p.legacy_id = 'sv9-etb'`))[0];
assert.equal(empty.data_status, 'no_offers'); assert.equal(empty.current_price, null); assert.equal(empty.history_status, 'insufficient');

// idempotência: rodar de novo não escreve nada
const e2 = await tx((c) => runPriceEngine(c, { asOf }));
assert.equal(e2.statsWritten, 0); assert.equal(e2.dailyWritten, 0); assert.equal(e2.dailyDeleted, 0);
// histórico preservado: o motor não toca em price_history
assert.equal((await q('SELECT count(*)::int n FROM hunter.price_history'))[0].n, histBefore);

// afiliado não influencia: cria links de afiliado para todas as ofertas e recalcula → nada muda
await p.query(`UPDATE hunter.affiliate_program SET status = 'active'`);
await p.query(`INSERT INTO hunter.affiliate_link (program_id, offer_id, url, status) SELECT 'mercadolivre', id, 'https://aff/' || id, 'active' FROM hunter.offer`);
const e3 = await tx((c) => runPriceEngine(c, { asOf }));
assert.equal(e3.statsWritten, 0, 'afiliado não altera nenhuma estatística');

// oferta removida da loja → sai do preço atual; histórico continua
await tx((c) => syncState(c, { state: { ...state, offers: state.offers.filter((o) => o.id !== 'ob') }, catalog, historyLines: H }));
await tx((c) => runPriceEngine(c, { asOf }));
const st2 = (await q(`SELECT s.* FROM hunter.product_stats s JOIN hunter.product p ON p.id = s.product_id WHERE p.legacy_id = 'me05-etb'`))[0];
assert.equal(n(st2.current_price), 380); assert.equal(st2.current_total_price, null, 'sem frete conhecido → sem total (nunca R$ 0)');
assert.equal((await q('SELECT count(*)::int n FROM hunter.price_history'))[0].n, histBefore);
await close();
console.log('OK — Price Engine (PostgreSQL)');
// migration 010 (evidência Copag na view do motor): registrada aqui para não editar o package.json
await import('./reference-evidence-db-tests.js');
