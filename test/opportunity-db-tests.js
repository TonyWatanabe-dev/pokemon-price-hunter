// Opportunity Engine no PostgreSQL real: só roda com TEST_DATABASE_URL (banco descartável).
import assert from 'node:assert/strict';
if (!process.env.TEST_DATABASE_URL) { console.log('— testes de banco do Opportunity Engine pulados (sem TEST_DATABASE_URL)'); process.exit(0); }
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const { pool, tx, close } = await import('../src/db/pg.js');
const { syncState } = await import('../src/core/sync.js');
const { runPriceEngine } = await import('../src/core/price-stats.js');
const { runOpportunityEngine, loadOpportunityInputs, computeOpportunities } = await import('../src/core/opportunity-run.js');
const { execFileSync } = await import('node:child_process');
const p = await pool();
const q = async (sql, a = []) => (await p.query(sql, a)).rows;
await p.query('DROP SCHEMA IF EXISTS hunter CASCADE');
execFileSync('node', ['tools/db-migrate.mjs'], { env: process.env, stdio: 'pipe' });

const catalog = { collections: [{ id: 'me05', name: 'Escuridão Absoluta', series: 'Megaevolução' }, { id: 'sv9', name: 'Amigos de Jornada', series: 'Escarlate e Violeta' }] };
const prod = { id: 'me05-etb', collection: 'me05', collectionName: 'Escuridão Absoluta', type: 'etb', typeLabel: 'Treinador Avançado (ETB)', group: 'ETB', boosters: 9,
  copagConfirmed: true, msrp: 400, copag: { source_url: 'https://www.copagloja.com.br/etb/p', confidence: 'OFICIAL', source_timestamp: '2026-10-08T10:00:00Z' } };
const sv9 = { id: 'sv9-etb', collection: 'sv9', collectionName: 'Amigos de Jornada', type: 'etb', typeLabel: 'Treinador Avançado (ETB)', group: 'ETB', boosters: 9 };   // sem Copag, sem oferta
const mk = (id, storeId, price, stock, extra = {}) => ({ id, productId: 'me05-etb', storeId, title: 'ETB', url: `https://${storeId}/etb`, price, total: price, shipping: null, shippingKnown: false, stock, matchConfidence: 0.9, firstSeen: '2026-10-05T10:00:00Z', source_timestamp: '2026-10-09T12:00:00Z', ...extra });
const base = (offers) => ({ collections: [], products: [prod, sv9], sources: ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id, url: `https://${id}.com.br`, status: 'ACTIVE' })),
  reputation: { b: { status: 'OTIMO' } }, offers });
const offers = [
  mk('oa', 'a', 380, 'IN_STOCK'),
  mk('ob', 'b', 360, 'IN_STOCK', { shipping: 20, shippingKnown: true, total: 380 }),
  mk('oc', 'c', 300, 'OUT_OF_STOCK'),
  mk('od', 'd', 39.9, 'IN_STOCK', { anomalous: true }),
];
const H = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'].map((d, i) => ({ t: `${d}T10:00:00Z`, offerId: 'oa', productId: 'me05-etb', storeId: 'a', price: 400 - i * 5, total: 400 - i * 5, stock: 'IN_STOCK' }));
await tx((c) => syncState(c, { state: base(offers), catalog, historyLines: H }));
const asOf = new Date('2026-10-10T12:00:00Z');
await tx((c) => runPriceEngine(c, { asOf }));

const now = new Date('2026-10-10T12:05:00Z');
const r1 = await tx((c) => runOpportunityEngine(c, { now }));
assert.equal(r1.products, 2); assert.equal(r1.offersEvaluated, 4); assert.equal(r1.withBest, 1);
const rows = await q(`SELECT of.legacy_id AS id, o.* FROM hunter.opportunity o JOIN hunter.offer of ON of.id = o.offer_id ORDER BY of.legacy_id`);
const by = Object.fromEntries(rows.map((r) => [r.id, r]));
assert.ok(rows.every((r) => r.engine_version === 'opportunity-v2.1' && new Date(r.calculated_at).getTime() === now.getTime()));
// sem estoque ≤ 30; anomalia ≤ 49 e fora da melhor
assert.ok(by.oc.opportunity_score <= 30 && Number(by.oc.stock_signal) === 0);
assert.ok(by.od.is_anomaly && by.od.opportunity_score <= 49 && by.od.warnings.some((w) => w.code === 'ANOMALY'));
// frete: desconhecido = nulo (nunca R$ 0); conhecido = sinal
assert.equal(by.oa.freight_signal, null); assert.ok(by.oa.warnings.some((w) => w.code === 'UNKNOWN_FREIGHT'));
assert.ok(Number(by.ob.freight_signal) > 0);
// Copag verificada → sinal de referência
assert.ok(rows.every((r) => r.reference_signal != null));
// melhor oportunidade comprável: view = código
const best = await q(`SELECT p.legacy_id, of.legacy_id AS offer FROM hunter.product_opportunity po JOIN hunter.product p ON p.id = po.product_id JOIN hunter.offer of ON of.id = po.offer_id`);
assert.deepEqual(best, [{ legacy_id: 'me05-etb', offer: 'ob' }]);
const js = computeOpportunities(await tx((c) => loadOpportunityInputs(c)), { now });
assert.equal(js.find((x) => x.legacy_id === 'me05-etb').best.offer_id, String(by.ob.offer_id));
assert.equal(js.find((x) => x.legacy_id === 'sv9-etb').reason, 'NO_OFFERS');
// eventos da 1ª rodada: anomalia nova (+ FOUND se a melhor for ≥ 75)
const ev1 = await q(`SELECT type, entity_id, payload FROM hunter.system_event WHERE type LIKE 'OPPORTUNITY_%' ORDER BY id`);
assert.ok(ev1.some((e) => e.type === 'OPPORTUNITY_ANOMALY' && e.entity_id === 'me05-etb' && e.payload.engine_version === 'opportunity-v2.1'));
assert.equal(ev1.some((e) => e.type === 'OPPORTUNITY_FOUND'), by.ob.opportunity_score >= 75);

// idempotência: mesma entrada → nada escrito, nenhum evento novo
const r2 = await tx((c) => runOpportunityEngine(c, { now: new Date('2026-10-10T12:20:00Z') }));
assert.equal(r2.written, 0); assert.equal(r2.removed, 0); assert.deepEqual(r2.events, {});
assert.equal((await q(`SELECT count(*)::int n FROM hunter.system_event WHERE type LIKE 'OPPORTUNITY_%'`))[0].n, ev1.length);

// afiliado não influencia
await p.query(`UPDATE hunter.affiliate_program SET status = 'active'`);
await p.query(`INSERT INTO hunter.affiliate_link (program_id, offer_id, url, status) SELECT 'mercadolivre', id, 'https://aff/' || id, 'active' FROM hunter.offer`);
const r3 = await tx((c) => runOpportunityEngine(c, { now }));
assert.equal(r3.written, 0, 'afiliado não altera nenhuma oportunidade');

// transições: a melhor oferta esgota → muda a melhor / EXPIRED se era ≥ Boa; oferta removida sai da tabela
const prevBest = by.ob.opportunity_score;
await tx((c) => syncState(c, { state: base([mk('oa', 'a', 380, 'IN_STOCK'), mk('ob', 'b', 360, 'OUT_OF_STOCK', { shipping: 20, shippingKnown: true, total: 380 }), mk('od', 'd', 39.9, 'IN_STOCK', { anomalous: true })]), catalog, historyLines: H }));
await tx((c) => runPriceEngine(c, { asOf }));
const r4 = await tx((c) => runOpportunityEngine(c, { now }));
assert.ok(r4.written >= 1);
const best2 = await q(`SELECT of.legacy_id AS offer FROM hunter.product_opportunity po JOIN hunter.offer of ON of.id = po.offer_id`);
assert.deepEqual(best2, [{ offer: 'oa' }]);
assert.equal((await q(`SELECT count(*)::int n FROM hunter.opportunity o JOIN hunter.offer of ON of.id = o.offer_id WHERE of.legacy_id = 'oc'`))[0].n, 0, 'oferta que saiu perde a avaliação');
const oaScore = (await q(`SELECT opportunity_score s FROM hunter.opportunity o JOIN hunter.offer of ON of.id = o.offer_id WHERE of.legacy_id = 'oa'`))[0].s;
const ev4 = await q(`SELECT type FROM hunter.system_event WHERE type LIKE 'OPPORTUNITY_%' ORDER BY id OFFSET $1`, [ev1.length]);
if (prevBest >= 75 && oaScore < 75) assert.deepEqual(ev4.map((e) => e.type), ['OPPORTUNITY_EXPIRED']);
assert.ok(!ev4.some((e) => e.type === 'OPPORTUNITY_ANOMALY'), 'anomalia já conhecida não gera evento de novo');
// checagens do banco: nenhuma anomalia ≥ 50, nenhuma sem estoque ≥ 31
assert.equal((await q(`SELECT count(*)::int n FROM hunter.opportunity WHERE (is_anomaly AND opportunity_score >= 50) OR (stock_signal = 0 AND opportunity_score > 30)`))[0].n, 0);
await close();
console.log(`OK — Opportunity Engine (PostgreSQL) · melhor inicial ${prevBest}, eventos ${JSON.stringify(r1.events)}`);
