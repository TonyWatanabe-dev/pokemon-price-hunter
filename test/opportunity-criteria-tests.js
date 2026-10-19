// Feed /api/v1/oportunidades (#664): campo ADITIVO `criteria` por item — referência, desconto, frescor e confiança que o
// Opportunity Engine já usou e gravou, mais a chave de deduplicação. Cliente de banco falso: nada é recalculado, nota,
// faixa, ordem e parâmetros da consulta principal ficam iguais; a chave tem o mesmo formato de chaveDedupe (Social Media).
import assert from 'node:assert/strict';
import { listOpportunities, opportunityCriteria } from '../api/_lib/read-db.mjs';
import { chaveDedupe } from '../src/agents/social/elegiveis.js';
import { confidenceLevel } from '../src/core/opportunity-engine.js';

const NOW = Date.parse('2026-10-14T12:00:00Z');
const M = (min) => new Date(NOW - min * 60e3);
let n = 0;
const t = async (name, fn) => { try { await fn(); n++; } catch (e) { e.message = `${name}: ${e.message}`; throw e; } };

// linha da consulta principal (como o pg devolve: numeric vem como string)
const row = (offerId, legacy, extra = {}) => ({ offer_id: offerId, legacy_id: legacy, slug: legacy, canonical_name: 'ETB ' + legacy, attrs: { type: 'etb' },
  product_image: null, col_code: 'me05', col_name: 'Escuridão Absoluta', offer_legacy: 'of-' + legacy, url: `https://loja/${legacy}`, title_raw: 'ETB', offer_image: null,
  first_seen_at: new Date('2026-10-01T10:00:00Z'), price_kind: null, total_price: '370.00', shipping_status: 'known', stock_status: 'in_stock', store_id: 'a', store_name: 'Loja A',
  marketplace_id: 'store', last_seen_at: M(10), offer_status: 'active', price: '350.00', opportunity_score: 80, opportunity_band: 'boa', confidence: '0.80', reasons: [], warnings: [],
  caps: [], engine_version: 'opportunity-v2.2', calculated_at: new Date('2026-10-14T11:00:00Z'), opp_reference_kind: null, opp_reference_value: null, opp_reference_gap: null,
  variation_7d: null, reference_kind: null, reference_price: null, reference_confidence: null, reference_reason: null, market_sources: null, market_composition: 'NONE',
  historical: [], community: null, total_rows: '4', ...extra });
const COPAG = { opp_reference_kind: 'COPAG_OFFICIAL_CURRENT', opp_reference_value: '400.00', opp_reference_gap: '0.1250',
  reasons: [{ code: 'BELOW_REFERENCE', text: '12,5% abaixo do preço sugerido Copag (R$ 400,00)', impact: '+', reference_kind: 'COPAG_OFFICIAL_CURRENT' }] };

function fakeDb(mainRows) {
  const calls = [];
  const query = async (sql, params) => { calls.push({ sql, params }); return /FROM hunter\.offer f\s+WHERE f\.id = ANY/.test(sql) ? [] : mainRows; };
  return { calls, query };
}

await t('com referência atual: referência, desconto, frescor e confiança gravados pelo motor', async () => {
  const c = opportunityCriteria(row(1, 'p1', COPAG), NOW);
  assert.deepEqual(c.reference, { available: true, kind: 'COPAG_OFFICIAL_CURRENT', value: 400 });
  assert.deepEqual(c.discount, { available: true, fraction: 0.125, percentage_below: 12.5, amount_below: 50, position: 'below' });
  assert.deepEqual(c.freshness, { status: 'atual', age_min: 10, last_seen_at: M(10).toISOString(), stale: false });
  assert.deepEqual(c.confidence, { value: 0.8, level: 'alta' });
  assert.equal(c.dedupe_key, 'p1|a|35000');
});

await t('sem referência atual: nada é estimado, com o motivo', () => {
  const none = opportunityCriteria(row(1, 'p1', { opp_reference_kind: 'NONE' }), NOW);
  assert.deepEqual(none.reference, { available: false, kind: 'NONE', value: null, reason: 'no_current_reference' });
  assert.deepEqual(none.discount, { available: false, fraction: null, percentage_below: null, amount_below: null, position: null });
  const notEval = opportunityCriteria(row(1, 'p1'), NOW);
  assert.equal(notEval.reference.reason, 'not_evaluated', 'linha ainda não regravada pelo motor');
  assert.equal(notEval.discount.fraction, null);
});

await t('frescor da própria oferta (mesmos limites da API) e oferta pendente = stale', () => {
  const st = (min, extra = {}) => opportunityCriteria(row(1, 'p1', { last_seen_at: min == null ? null : M(min), ...extra }), NOW).freshness;
  assert.equal(st(30).status, 'atual'); assert.equal(st(31).status, 'atrasado'); assert.equal(st(91).status, 'desatualizado');
  assert.equal(st(25 * 60).status, 'indisponivel');
  assert.deepEqual(st(null), { status: 'indisponivel', age_min: null, last_seen_at: null, stale: false }, 'sem horário: indisponível, nunca herdado');
  assert.equal(st(10, { offer_status: 'pending' }).stale, true, 'oferta pendente (trava pending do motor)');
  assert.equal(opportunityCriteria(row(1, 'p1'), new Date(NOW)).freshness.age_min, 10, 'aceita Date como relógio');
});

await t('confiança: mesmas faixas do motor', () => {
  for (const c of [null, 0, 0.3, 0.49, 0.5, 0.74, 0.75, 1]) {
    const x = opportunityCriteria(row(1, 'p1', { confidence: c == null ? null : String(c) }), NOW).confidence;
    assert.deepEqual(x, { value: c, level: confidenceLevel(c) }, `confiança ${c}`);
  }
});

await t('dedupe_key = chaveDedupe do Social Media no formato da API (produto|loja|centavos)', () => {
  for (const [legacy, store, price] of [['p1', 'a', '350.00'], ['me05-etb', 'kabum', '349.99'], ['x', 'b', '0.105'], ['p1', null, '10'], ['p1', 'a', null], ['p1', 'a', '0'], [null, 'a', '1']]) {
    const r = row(1, legacy, { store_id: store, price });
    const api = { product: { id: legacy }, store: { id: store }, price: price == null ? null : Number(price) };
    assert.equal(opportunityCriteria(r, NOW).dedupe_key, chaveDedupe(api), `${legacy}/${store}/${price}`);
  }
  assert.equal(opportunityCriteria(row(1, 'p1', { price: '349.99' }), NOW).dedupe_key, 'p1|a|34999');
});

await t('listOpportunities: criteria aditivo, nota/ordem/parâmetros intactos', async () => {
  const rows = [row(11, 'p1', COPAG), row(12, 'p2', { offer_status: 'pending', last_seen_at: M(120) }), row(13, 'p3', { store_id: null }), row(11, 'p1', COPAG)];
  const db = fakeDb(rows);
  const args = { page: 2, limit: 5, faixa: 'boa', colecao: 'me05', minimo: 50, ordem: 'preco', categoria: 'ETB', referencia: 'copag', abaixo: 10, confiancaMinima: 60, produto: 'p1' };
  const r = await listOpportunities({ ...args, query: db.query, now: NOW });
  assert.deepEqual(db.calls[0].params, ['boa', 'me05', 50, 5, 5, 'ETB', 'COPAG_OFFICIAL_CURRENT', 0.1, 0.6, 'p1', null, null, null], 'mesmos filtros e paginação (idioma nulo com produto)');
  assert.match(db.calls[0].sql, /ORDER BY o\.price ASC, o\.opportunity_score DESC, o\.offer_id\s+LIMIT \$4 OFFSET \$5/, 'mesma ordenação');
  assert.match(db.calls[0].sql, /f\.last_seen_at, f\.status AS offer_status/, 'frescor e status lidos da própria oferta, na mesma consulta');
  assert.equal(db.calls.length, 2, 'sem N+1: consulta principal + mudança em lote');
  assert.deepEqual(r.items.map((x) => x.product.id), ['p1', 'p2', 'p3', 'p1'], 'ordem do banco preservada');
  assert.equal(r.total, 4);
  for (const x of r.items) { assert.equal(x.opportunity_score, 80); assert.equal(x.opportunity_band, 'boa'); assert.equal(x.confidence, 0.8); }
  assert.deepEqual(r.items.map((x) => Object.keys(x.criteria)), r.items.map(() => ['reference', 'discount', 'freshness', 'confidence', 'dedupe_key', 'confirmation']));
  const cmp = r.items[0].reference_comparison;
  assert.deepEqual(r.items[0].criteria.discount, { available: true, fraction: 0.125, percentage_below: cmp.percentage_below, amount_below: cmp.amount_below, position: cmp.position },
    'desconto = os mesmos números de reference_comparison');
  assert.deepEqual(r.items[1].criteria.freshness, { status: 'desatualizado', age_min: 120, last_seen_at: M(120).toISOString(), stale: true });
  assert.equal(r.items[2].criteria.dedupe_key, null, 'sem loja: sem chave');
  assert.equal(r.items[0].criteria.dedupe_key, r.items[3].criteria.dedupe_key, 'mesma oferta: mesma chave');
  assert.notEqual(r.items[0].criteria.dedupe_key, r.items[1].criteria.dedupe_key);
});

console.log(`✓ Critérios por item do feed de oportunidades (#664): ${n} grupos passaram`);
