// Feed /api/v1/oportunidades (#53): campo ADITIVO `change` (queda / novo anúncio / restock) calculado por classifyOfferChange.
// (a) cliente de banco falso: formato do campo, UMA consulta em lote para N oportunidades (sem N+1), janela de 48 h,
//     retrocompatibilidade (campos antigos, ordem e parâmetros da consulta principal iguais) e falha da consulta extra
//     sem derrubar o feed; (b) PostgreSQL real só com TEST_DATABASE_URL (sem ela, pula — sem encerrar o processo, porque
//     este arquivo é importado no fim de test/offer-change-tests.js).
import assert from 'node:assert/strict';
import { listOpportunities, offerChanges } from '../api/_lib/read-db.mjs';
import * as API from '../api/_lib/offer-change.mjs';
import * as CORE from '../src/core/offer-change.js';
import * as PE from '../src/core/price-engine.js';

const NOW = Date.parse('2026-10-10T12:00:00Z');
const H = (h) => new Date(NOW - h * 3600e3).toISOString();
let n = 0;
const t = async (name, fn) => { try { await fn(); n++; } catch (e) { e.message = `${name}: ${e.message}`; throw e; } };

// linha da consulta principal (como o pg devolve)
const row = (offerId, legacy, extra = {}) => ({ offer_id: offerId, legacy_id: legacy, slug: legacy, canonical_name: 'ETB ' + legacy, attrs: { type: 'etb', typeLabel: 'ETB', group: 'ETB' },
  product_image: null, col_code: 'me05', col_name: 'Escuridão Absoluta', offer_legacy: 'of-' + legacy, url: `https://loja/${legacy}`, title_raw: 'ETB', offer_image: null,
  first_seen_at: new Date('2026-10-01T10:00:00Z'), price_kind: null, total_price: '370.00', shipping_status: 'known', stock_status: 'in_stock', store_id: 'a', store_name: 'Loja A',
  marketplace_id: 'store', price: '350.00', opportunity_score: 80, opportunity_band: 'boa', confidence: '0.80', reasons: [], warnings: [], engine_version: 'opportunity-v2.2',
  calculated_at: new Date('2026-10-10T11:00:00Z'), opp_reference_kind: null, opp_reference_value: null, opp_reference_gap: null, variation_7d: null, reference_kind: null,
  reference_price: null, reference_confidence: null, reference_reason: null, market_sources: null, market_composition: 'NONE', historical: [], community: null, total_rows: '3', ...extra });
// linha da consulta em lote (offer + jsonb de price_history e stock_event)
const chg = (offerId, extra = {}) => ({ offer_id: offerId, status: 'active', stock_status: 'in_stock', first_seen_at: '2026-10-01T10:00:00Z', confirmed: true, anomalous: false,
  history: [], stock_events: [], ...extra });
const ph = (h, price, total = null, stock = 'in_stock') => ({ observed_at: H(h), price, total_price: total, stock_status: stock });

function fakeDb(mainRows, changeRows, { failChanges = false } = {}) {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    if (/FROM hunter\.offer f\s+WHERE f\.id = ANY/.test(sql)) { if (failChanges) throw new Error('timeout'); return changeRows; }
    return mainRows;
  };
  return { calls, query };
}
const OLD_KEYS = ['product', 'offer', 'price', 'total', 'shipping', 'stock', 'store', 'marketplace', 'opportunity_score', 'opportunity_band', 'confidence', 'confidence_level',
  'current_reference', 'market_composition', 'reference_comparison', 'product_variation_7d', 'historical_context', 'community_reference', 'warnings', 'reasons', 'engine_version', 'updated_at'];
const CHANGE_KEYS = ['kind', 'label', 'at', 'from', 'to', 'basis', 'reason'];

await t('módulo único: src/core reexporta o mesmo classificador que a API usa', () => {
  assert.equal(CORE.classifyOfferChange, API.classifyOfferChange);
  assert.equal(CORE.WINDOW_HOURS, 48);
});

await t('régua de plausibilidade igual à do Price Engine', () => {
  assert.equal(API.PLAUSIBLE_MIN, PE.PLAUSIBLE_MIN); assert.equal(API.PLAUSIBLE_MAX, PE.PLAUSIBLE_MAX);
  for (const anchor of [null, 1, 9.9, 55, 100, 333.33, 400]) for (const p of [-1, 0, 0.5, 5.44, 5.45, 30, 54.99, 55, 100, 299.99, 300, 300.01, 1000, NaN, null])
    assert.equal(API.plausible(p, anchor), PE.plausible(p, anchor), `plausible(${p}, ${anchor})`);
  for (const x of [null, 0, 1.005, 2.675, 370.123, NaN]) assert.equal(API.round2(x), PE.round2(x));
  for (const v of [null, undefined, 0, -1, '10', 'x', 3.5]) assert.equal(API.validPrice(v), PE.validPrice(v));
});

await t('lote: N oportunidades → 1 consulta principal + 1 consulta de mudanças (sem N+1), janela de 48 h', async () => {
  const main = [row(11, 'p1'), row(12, 'p2', { shipping_status: 'unknown', total_price: null }), row(13, 'p3'), row(11, 'p4')];
  const db = fakeDb(main, [
    chg(11, { history: [ph(60, 400, 420), ph(5, 350, 370)] }),
    chg(12, { first_seen_at: H(10), history: [ph(10, 300)] }),
    chg(13, { stock_events: [{ from_status: 'in_stock', to_status: 'out_of_stock', observed_at: H(30) }, { from_status: 'out_of_stock', to_status: 'unknown', observed_at: H(20) },
      { from_status: 'unknown', to_status: 'in_stock', observed_at: H(3) }] }),
  ]);
  const r = await listOpportunities({ page: 1, limit: 20, todas: true, query: db.query, now: NOW });
  assert.equal(db.calls.length, 2, 'uma consulta só para as mudanças de todas as oportunidades');
  const [, batch] = db.calls;
  assert.match(batch.sql, /hunter\.price_history/); assert.match(batch.sql, /hunter\.stock_event/);
  assert.deepEqual(batch.params[0], ['11', '12', '13'], 'ids únicos da página, numa lista só');
  assert.equal(batch.params[2].toISOString(), H(48), 'stock_event: últimas 48 h');
  assert.equal(batch.params[1].toISOString(), H(96), 'price_history: 48 h + janela anti-vai-e-volta');
  assert.equal(batch.params[3].toISOString(), H(0));
  assert.deepEqual(r.items.map((x) => x.product.id), ['p1', 'p2', 'p3', 'p4'], 'ordem da consulta principal preservada');
  assert.equal(r.total, 3);
  for (const x of r.items) assert.deepEqual(Object.keys(x.change), CHANGE_KEYS);
  assert.deepEqual(r.items[0].change, { kind: 'queda_preco', label: 'Queda de preço', at: H(5), from: 420, to: 370, basis: 'total', reason: 'total com frete conhecido caiu' });
  assert.equal(r.items[1].change.kind, 'novo_anuncio'); assert.equal(r.items[1].change.at, H(10));
  assert.equal(r.items[2].change.kind, 'restock', 'unknown no meio é pulado: o último estado conhecido era esgotado');
  assert.equal(r.items[2].change.at, H(3));
  assert.deepEqual(r.items[3].change, r.items[0].change, 'mesma oferta em duas linhas: mesma mudança, consultada uma vez');
});

await t('retrocompatível: campos antigos, valores e parâmetros da consulta principal iguais', async () => {
  const db = fakeDb([row(11, 'p1', { shipping_status: 'unknown', total_price: null })], [chg(11)]);
  const args = { page: 2, limit: 5, faixa: 'boa', colecao: 'me05', minimo: 50, ordem: 'preco', categoria: 'ETB', referencia: 'copag', abaixo: 10, confiancaMinima: 60, produto: 'p1' };
  const r = await listOpportunities({ ...args, query: db.query, now: NOW });
  assert.deepEqual(db.calls[0].params, ['boa', 'me05', 50, 5, 5, 'ETB', 'COPAG_OFFICIAL_CURRENT', 0.1, 0.6, 'p1'], 'mesmos filtros e paginação');
  assert.match(db.calls[0].sql, /ORDER BY o\.price ASC, o\.opportunity_score DESC, o\.offer_id\s+LIMIT \$4 OFFSET \$5/, 'mesma ordenação');
  const x = r.items[0];
  assert.deepEqual(Object.keys(x).filter((k) => k !== 'change'), OLD_KEYS, 'nenhum campo antigo some, muda de nome ou aparece fora do change');
  assert.equal(x.price, 350); assert.equal(x.total, null, 'total com frete desconhecido continua nulo'); assert.equal(x.shipping, 'unknown');
  assert.equal(x.opportunity_score, 80); assert.equal(x.confidence, 0.8); assert.equal(x.confidence_level, 'alta');
  assert.deepEqual(x.offer, { id: 'of-p1', title: 'ETB', url: 'https://loja/p1', image: null, first_seen_at: '2026-10-01T10:00:00.000Z', price_kind: null });
  assert.ok(!('offer_id' in x) && !JSON.stringify(x).includes('"offer_id"'), 'id interno da oferta não vaza');
});

await t('regras de dado ausente: estoque unknown, frete que mudou, sem histórico, sem linha, falha da consulta', async () => {
  const db = fakeDb([row(1, 'a'), row(2, 'b'), row(3, 'c'), row(4, 'd'), row(5, 'e')], [
    chg(1, { stock_status: 'unknown', history: [ph(60, 400), ph(5, 300)] }),
    chg(2, { history: [ph(60, 400, 420), ph(5, 360)] }),           // total conhecido → só preço (frete desconhecido): não compara
    chg(3),                                                          // banco sem leituras
    chg(5, { stock_events: [{ from_status: null, to_status: 'unknown', observed_at: H(3) }] }),
  ]);
  const r = await listOpportunities({ page: 1, limit: 20, query: db.query, now: NOW });
  const by = Object.fromEntries(r.items.map((x) => [x.product.id, x.change]));
  assert.equal(by.a.kind, null); assert.equal(by.a.reason, 'estoque desconhecido');
  assert.equal(by.b.kind, null); assert.match(by.b.reason, /frete mudou/);
  assert.equal(by.c.kind, null); assert.ok(by.c.reason);
  assert.equal(by.d.kind, null); assert.equal(by.d.reason, 'sem dados da oferta');
  assert.equal(by.e.kind, null, 'unknown não vira restock');
  const bad = fakeDb([row(1, 'a')], [], { failChanges: true });
  const err = console.error; console.error = () => {};
  try {
    const r2 = await listOpportunities({ page: 1, limit: 20, query: bad.query, now: NOW });
    assert.equal(r2.items.length, 1); assert.equal(r2.items[0].price, 350, 'feed continua com os campos antigos');
    assert.equal(r2.items[0].change.kind, null); assert.equal(r2.items[0].change.reason, 'histórico indisponível no momento');
  } finally { console.error = err; }
});

await t('página vazia: nenhuma consulta de mudanças', async () => {
  const db = fakeDb([], []);
  const r = await listOpportunities({ page: 1, limit: 20, query: db.query, now: NOW });
  assert.deepEqual(r, { items: [], total: 0 }); assert.equal(db.calls.length, 1);
  assert.equal((await offerChanges([], { query: db.query })).size, 0); assert.equal(db.calls.length, 1);
});

// ------------------------------------------------------------------ (b) PostgreSQL real (banco descartável do CI)
if (!process.env.TEST_DATABASE_URL) {
  console.log('— teste de banco da mudança da oferta no feed pulado (sem TEST_DATABASE_URL)');
} else {
  const savedDb = process.env.DATABASE_URL; const savedApi = process.env.API_DATABASE_URL;
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL; process.env.API_DATABASE_URL = process.env.TEST_DATABASE_URL;
  const { pool, tx, close } = await import('../src/db/pg.js');
  const { syncState } = await import('../src/core/sync.js');
  const { runPriceEngine } = await import('../src/core/price-stats.js');
  const { runOpportunityEngine } = await import('../src/core/opportunity-run.js');
  const { q: apiQ, closeApiPool } = await import('../api/_lib/db.mjs');
  const { execFileSync } = await import('node:child_process');
  try {
    const p = await pool();
    await p.query('DROP SCHEMA IF EXISTS hunter CASCADE');
    execFileSync('node', ['tools/db-migrate.mjs'], { env: process.env, stdio: 'pipe' });
    const catalog = { collections: [{ id: 'me05', name: 'Escuridão Absoluta', series: 'Megaevolução' }] };
    const prod = { id: 'me05-etb', collection: 'me05', collectionName: 'Escuridão Absoluta', type: 'etb', typeLabel: 'Treinador Avançado (ETB)', group: 'ETB', boosters: 9 };
    const mk = (id, storeId, price, stock, firstSeen) => ({ id, productId: 'me05-etb', storeId, title: 'ETB', url: `https://${storeId}/etb`, price, total: price, shipping: null,
      shippingKnown: false, stock, matchConfidence: 0.9, firstSeen, source_timestamp: H(1) });
    const state = { collections: [], products: [prod], sources: ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id, url: `https://${id}.com.br`, status: 'ACTIVE' })), reputation: {},
      offers: [mk('oa', 'a', 360, 'IN_STOCK', H(24 * 9)), mk('ob', 'b', 380, 'IN_STOCK', H(10)), mk('oc', 'c', 390, 'IN_STOCK', H(24 * 9)), mk('od', 'd', 370, 'UNKNOWN', H(24 * 9))] };
    await tx((c) => syncState(c, { state, catalog, historyLines: [] }));
    const ids = Object.fromEntries((await p.query(`SELECT legacy_id, id, product_id FROM hunter.offer`)).rows.map((r) => [r.legacy_id, r]));
    // leituras e eventos controlados (o que o robô gravaria): queda em oa (frete desconhecido → preço), restock em oc com unknown no meio
    await p.query('DELETE FROM hunter.price_history'); await p.query('DELETE FROM hunter.stock_event');
    const addH = (o, h, price, stock = 'in_stock') => p.query(`INSERT INTO hunter.price_history (offer_id, product_id, price, total_price, stock_status, observed_at)
      VALUES ($1, $2, $3, NULL, $4, $5)`, [ids[o].id, ids[o].product_id, price, stock, H(h)]);
    await addH('oa', 24 * 8, 400); await addH('oa', 5, 360);              // leitura anterior fora da janela de 96 h: entra como a última antes dela
    await addH('ob', 10, 380); await addH('oc', 24 * 8, 390); await addH('od', 60, 400, 'unknown'); await addH('od', 5, 370, 'unknown');
    for (const [from, to, h] of [['in_stock', 'out_of_stock', 72], ['out_of_stock', 'unknown', 20], ['unknown', 'in_stock', 3]])
      await p.query(`INSERT INTO hunter.stock_event (offer_id, from_status, to_status, observed_at) VALUES ($1, $2, $3, $4)`, [ids.oc.id, from, to, H(h)]);
    await tx((c) => runPriceEngine(c, { asOf: new Date(NOW) }));
    await tx((c) => runOpportunityEngine(c, { now: new Date(NOW) }));
    let calls = 0; const counted = (sql, params) => { calls++; return apiQ(sql, params); };
    const base = await listOpportunities({ page: 1, limit: 50, todas: true, query: apiQ, now: NOW });
    const r = await listOpportunities({ page: 1, limit: 50, todas: true, query: counted, now: NOW });
    assert.equal(calls, 2, 'banco real: 1 consulta principal + 1 em lote');
    assert.equal(r.items.length, 4); assert.deepEqual(r.items.map((x) => x.offer.id), base.items.map((x) => x.offer.id));
    const by = Object.fromEntries(r.items.map((x) => [x.offer.id, x.change]));
    assert.equal(by.oa.kind, 'queda_preco'); assert.equal(by.oa.basis, 'price'); assert.equal(by.oa.from, 400); assert.equal(by.oa.to, 360); assert.equal(by.oa.at, H(5));
    assert.equal(by.ob.kind, 'novo_anuncio'); assert.equal(by.ob.at, H(10));
    assert.equal(by.oc.kind, 'restock'); assert.equal(by.oc.at, H(3));
    assert.equal(by.od.kind, null); assert.equal(by.od.reason, 'estoque desconhecido');
    // padrão (melhor oferta por produto) também traz o campo, sem mudar a escolha
    const best = await listOpportunities({ page: 1, limit: 50, query: apiQ, now: NOW });
    assert.equal(best.items.length, 1); assert.deepEqual(Object.keys(best.items[0].change), CHANGE_KEYS);
    n++;
  } finally {
    await closeApiPool(); await close();
    if (savedDb === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = savedDb;
    if (savedApi === undefined) delete process.env.API_DATABASE_URL; else process.env.API_DATABASE_URL = savedApi;
  }
}

console.log(`✓ Feed de oportunidades com a mudança da oferta (#53, campo aditivo change): ${n} grupos passaram`);
