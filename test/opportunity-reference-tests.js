// Opportunity Engine: referência histórica/comunitária, texto por tipo de referência e os dois ramos de anomalia (motor-oportunidades T4–T6).
import assert from 'node:assert/strict';
import { calculateOpportunity as calc } from '../src/core/opportunity-engine.js';

const now = new Date('2026-10-08T12:00:00Z');
let n = 0; const t = (name, fn) => { fn(); n++; };
const S = (x = {}) => ({ reference_price: 400, reference_status: 'verified', reference_kind: 'COPAG_OFFICIAL_CURRENT', history_status: 'ok', history_days: 20, historical_min: 330, historical_average: 380,
  variation_7d: -0.05, variation_30d: null, number_of_in_stock_offers: 5, median_price: 390, lowest_current_price: 300, quality: { anchor: 380 }, ...x });
const O = (x = {}) => ({ id: '1', price: 300, total_price: 300, shipping_status: 'free', shipping_price: 0, stock_status: 'in_stock', status: 'active', confirmed: true,
  anomalous: false, store: { ra_status: 'OTIMO' }, seller: { is_official: false }, ...x });
const C = (s, o) => calc(s, o, { now });
const codes = (a) => a.map((x) => x.code);

t('T4. referência histórica/comunitária não altera nota nem reference_kind', () => {
  const none = { reference_price: null, reference_status: null, reference_kind: 'NONE' };
  const ctx = { historical: [{ kind: 'COPAG_OFFICIAL_HISTORICAL', price: 350, published_at: '2024-01-01', status: 'verified' }], community: [{ price: 320 }] };
  for (const base of [S(none), S()]) {
    const sem = C(base, O({ price: 360 })); const com = C({ ...base, reference_context: ctx }, O({ price: 360 }));
    assert.equal(com.opportunity_score, sem.opportunity_score);
    assert.equal(com.reference_kind, sem.reference_kind);
    assert.equal(com.confidence, sem.confidence);
  }
  const r = C({ ...S(none), reference_context: ctx }, O({ price: 360 }));
  assert.equal(r.reference_kind, 'NONE'); assert.equal(r.reference_value, null); assert.equal(r.reference_signal, null);
  assert.ok(codes(r.warnings).includes('HISTORICAL_REFERENCE_ONLY'));
  const c = C({ ...S(none), reference_context: { community: ctx.community } }, O({ price: 360 }));
  assert.equal(c.reference_kind, 'NONE'); assert.ok(codes(c.warnings).includes('COMMUNITY_REFERENCE_ONLY'));
});

t('T5. texto da referência de mercado não cita Copag e vice-versa', () => {
  const refText = (r) => r.reasons.filter((x) => x.reference_kind).map((x) => x.text);
  const mk = C(S({ reference_kind: 'MARKET_CURRENT', reference_status: null, quality: { anchor: 380, market_reference: { offers: 4, sources: 3 } } }), O({ price: 350 }));
  assert.equal(mk.reference_kind, 'MARKET_CURRENT');
  assert.ok(refText(mk).length > 0);
  for (const x of refText(mk)) { assert.doesNotMatch(x, /copag/i); assert.match(x, /referência de mercado/); }
  const cp = C(S(), O({ price: 350 }));
  assert.equal(cp.reference_kind, 'COPAG_OFFICIAL_CURRENT');
  assert.ok(refText(cp).length > 0);
  for (const x of refText(cp)) { assert.match(x, /Copag/); assert.doesNotMatch(x, /mercado/i); }
});

t('T6. dois ramos de anomalia: nota ≤ 49, confiança ×0,4 e aviso distinto', () => {
  const warn = (r) => r.warnings.find((x) => x.code === 'ANOMALY');
  // ramo 1: offer.anomalous (preço dentro da régua)
  const base1 = C(S(), O({ price: 300 })); const flag = C(S(), O({ price: 300, anomalous: true }));
  // ramo 2: fora da régua (anchor 380 → mínimo 209), sem a marcação do robô
  const base2 = C(S({ quality: {} }), O({ price: 100 })); const ruler = C(S(), O({ price: 100 }));
  assert.ok(base1.opportunity_score > 49 && base2.opportunity_score > 49);
  for (const [r, base] of [[flag, base1], [ruler, base2]]) {
    assert.ok(r.is_anomaly); assert.ok(r.opportunity_score <= 49); assert.ok(r.caps.includes('anomaly'));
    assert.ok(Math.abs(r.confidence - base.confidence * 0.4) <= 0.01, `${r.confidence} vs ${base.confidence}`);
    assert.ok(warn(r));
  }
  assert.match(warn(flag).text, /marcado como anômalo pelo robô/);
  assert.match(warn(ruler).text, /régua/);
  assert.notEqual(warn(flag).text, warn(ruler).text);
});

console.log(`✓ Referência e anomalia do motor: ${n} grupos de testes passaram`);
