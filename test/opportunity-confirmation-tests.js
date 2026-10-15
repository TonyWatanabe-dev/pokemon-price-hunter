// Feed /api/v1/oportunidades (#53): criteria.confirmation — oportunidade só é CONFIRMADA com preço sugerido Copag atual,
// preço abaixo dele, custo total comparável (frete conhecido), leitura fresca, estoque confirmado e preço sem anomalia
// nem queda pendente. Campo ADITIVO: nota, faixa, ordem e parâmetros da consulta não mudam. Cliente de banco falso.
import assert from 'node:assert/strict';
import { listOpportunities, opportunityCriteria } from '../api/_lib/read-db.mjs';

const NOW = Date.parse('2026-10-15T12:00:00Z');
const M = (min) => new Date(NOW - min * 60e3);
let n = 0;
const t = async (name, fn) => { try { await fn(); n++; } catch (e) { e.message = `${name}: ${e.message}`; throw e; } };

const COPAG = { opp_reference_kind: 'COPAG_OFFICIAL_CURRENT', opp_reference_value: '400.00', opp_reference_gap: '0.1250',
  reasons: [{ code: 'BELOW_REFERENCE', text: '12,5% abaixo do preço sugerido Copag', impact: '+', reference_kind: 'COPAG_OFFICIAL_CURRENT' }] };
const row = (extra = {}) => ({ offer_id: 1, legacy_id: 'p1', slug: 'p1', canonical_name: 'ETB p1', attrs: { type: 'etb' }, product_image: null, col_code: 'me05', col_name: 'X',
  offer_legacy: 'of-p1', url: 'https://loja/p1', title_raw: 'ETB', offer_image: null, first_seen_at: new Date('2026-10-01T10:00:00Z'), price_kind: null,
  total_price: '370.00', shipping_status: 'known', stock_status: 'in_stock', store_id: 'a', store_name: 'Loja A', marketplace_id: 'store', last_seen_at: M(10),
  offer_status: 'active', price: '350.00', opportunity_score: 80, opportunity_band: 'boa', confidence: '0.80', reasons: [], warnings: [], caps: [],
  engine_version: 'opportunity-v2.2', calculated_at: M(60), variation_7d: null, reference_kind: null, reference_price: null, reference_confidence: null,
  reference_reason: null, market_sources: null, market_composition: 'NONE', historical: [], community: null, total_rows: '1', ...COPAG, ...extra });
const conf = (extra) => opportunityCriteria(row(extra), NOW).confirmation;
const codes = (extra) => conf(extra).blockers.map((b) => b.code);

await t('todos os dados essenciais: confirmada, sem bloqueios', () => {
  assert.deepEqual(conf({}), { confirmed: true, blockers: [] });
  assert.equal(conf({ shipping_status: 'free', total_price: '350.00' }).confirmed, true, 'frete grátis é custo conhecido');
});

await t('sem preço sugerido Copag atual: não confirma (mercado não substitui, nada é inferido)', () => {
  assert.deepEqual(codes({ opp_reference_kind: 'NONE', opp_reference_value: null, opp_reference_gap: null }), ['no_copag_reference']);
  assert.deepEqual(codes({ opp_reference_kind: null, opp_reference_value: null, opp_reference_gap: null }), ['no_copag_reference'], 'linha não avaliada');
  const m = conf({ opp_reference_kind: 'MARKET_CURRENT', reasons: [] });
  assert.equal(m.confirmed, false); assert.match(m.blockers[0].reason, /só referência de mercado/);
});

await t('preço igual ou acima da referência Copag: não confirma', () => {
  assert.deepEqual(codes({ opp_reference_gap: '0' }), ['not_below_reference']);
  assert.deepEqual(codes({ opp_reference_gap: '-0.0800', price: '432.00', total_price: '450.00' }), ['not_below_reference']);
});

await t('frete desconhecido continua desconhecido: sem custo total comparável, não confirma', () => {
  assert.deepEqual(codes({ shipping_status: 'unknown', total_price: null }), ['unknown_shipping']);
  assert.deepEqual(codes({ shipping_status: 'known', total_price: null }), ['unknown_shipping'], 'total ausente');
  assert.equal(opportunityCriteria(row({ shipping_status: 'unknown', total_price: null }), NOW).dedupe_key, 'p1|a|35000', 'chave não depende do frete');
});

await t('oferta stale (pendente ou leitura velha/indisponível) não vira confirmada', () => {
  assert.deepEqual(codes({ offer_status: 'pending' }), ['stale']);
  assert.deepEqual(codes({ last_seen_at: M(91) }), ['stale'], 'desatualizado');
  assert.deepEqual(codes({ last_seen_at: null }), ['stale'], 'sem horário');
  assert.deepEqual(codes({ last_seen_at: M(90) }), [], 'atrasado (≤ 90 min) ainda vale');
});

await t('sem estoque confirmado, anomalia ou queda aguardando 2ª leitura: não confirma', () => {
  for (const s of ['out_of_stock', 'preorder', 'unknown', null]) assert.deepEqual(codes({ stock_status: s }), ['stock_not_confirmed'], String(s));
  assert.deepEqual(codes({ warnings: [{ code: 'ANOMALY', text: 'x' }] }), ['anomaly']);
  assert.deepEqual(codes({ warnings: [{ code: 'UNCONFIRMED', text: 'x' }] }), ['price_unconfirmed']);
  assert.deepEqual(codes({ warnings: [{ code: 'UNKNOWN_FREIGHT', text: 'x' }] }), [], 'aviso informativo não bloqueia sozinho');
});

await t('vários bloqueios juntos, cada um com motivo legível', () => {
  const c = conf({ opp_reference_kind: 'NONE', opp_reference_gap: null, shipping_status: 'unknown', total_price: null, offer_status: 'pending', stock_status: 'unknown' });
  assert.equal(c.confirmed, false);
  assert.deepEqual(c.blockers.map((b) => b.code), ['no_copag_reference', 'unknown_shipping', 'stale', 'stock_not_confirmed']);
  for (const b of c.blockers) assert.ok(typeof b.reason === 'string' && b.reason.length > 5, b.code);
});

await t('listOpportunities: confirmação aditiva, nota/faixa/ordem intactas', async () => {
  const rows = [row({ offer_id: 1 }), row({ offer_id: 2, legacy_id: 'p2', shipping_status: 'unknown', total_price: null })];
  const calls = []; const query = async (sql, params) => { calls.push(params); return /FROM hunter\.offer f\s+WHERE f\.id = ANY/.test(sql) ? [] : rows; };
  const r = await listOpportunities({ page: 1, limit: 10, query, now: NOW });
  assert.deepEqual(r.items.map((x) => [x.product.id, x.opportunity_score, x.opportunity_band, x.criteria.confirmation.confirmed]), [['p1', 80, 'boa', true], ['p2', 80, 'boa', false]]);
  assert.equal(r.items[1].total, null, 'frete desconhecido: total segue nulo');
});

console.log(`✓ Confirmação de oportunidade no feed (#53): ${n} grupos passaram`);
