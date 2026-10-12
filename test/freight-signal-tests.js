// Frete inválido no motor (opportunity-v2.2): frete negativo, total_price < price e shipping_price ausente
// caem em UNKNOWN_FREIGHT, sem sinal de frete e com custo só do produto (cost_basis 'price_only').
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

const assertFreteInvalido = (r, rotulo) => {
  assert.equal(r.freight_signal, null, rotulo);
  assert.ok(codes(r.warnings).includes('UNKNOWN_FREIGHT'), rotulo);
  assert.ok(!codes(r.reasons).some((c) => ['KNOWN_SHIPPING', 'HEAVY_SHIPPING', 'FREE_SHIPPING'].includes(c)), rotulo);
  assert.equal(r.cost_basis, 'price_only', rotulo);
  assert.equal(r.total_cost, 300, rotulo);   // só o preço do produto: nunca abate frete negativo
};

t('frete negativo explícito', () => {
  assertFreteInvalido(C(S(), O({ shipping_status: 'known', shipping_price: -10, total_price: 290 })), 'negativo com total');
  assertFreteInvalido(C(S(), O({ shipping_status: 'known', shipping_price: -10, total_price: null })), 'negativo sem total');
});

t('total_price menor que price (sem shipping_price)', () => {
  assertFreteInvalido(C(S(), O({ shipping_status: 'known', shipping_price: null, total_price: 280 })), 'total < price');
  assertFreteInvalido(C(S(), O({ shipping_status: 'known', total_price: 299.99, shipping_price: undefined })), 'total < price por centavos');
});

t('shipping_price ausente e total_price ausente', () => {
  assertFreteInvalido(C(S(), O({ shipping_status: 'known', shipping_price: null, total_price: null })), 'ambos nulos');
  const o = O({ shipping_status: 'known', total_price: undefined }); delete o.shipping_price;
  assertFreteInvalido(C(S(), o), 'campos ausentes');
});

t('frete inválido reduz a confiança e a evidência fica parcial', () => {
  const ok = C(S(), O({ shipping_status: 'known', shipping_price: 15, total_price: 315 }));
  const bad = C(S(), O({ shipping_status: 'known', shipping_price: -10, total_price: 290 }));
  assert.ok(bad.confidence < ok.confidence);
  assert.equal(bad.evidence, 'partial');
});

t('contraste: frete válido mantém sinal e custo total', () => {
  const r = C(S(), O({ shipping_status: 'known', shipping_price: 15, total_price: 315 }));
  assert.ok(r.freight_signal > 0); assert.equal(r.cost_basis, 'total'); assert.equal(r.total_cost, 315);
  assert.ok(!codes(r.warnings).includes('UNKNOWN_FREIGHT'));
  // total_price derivado quando shipping_price falta mas total > price
  const d = C(S(), O({ shipping_status: 'known', shipping_price: null, total_price: 315 }));
  assert.equal(d.cost_basis, 'total'); assert.equal(d.total_cost, 315);
});

console.log(`✓ Frete inválido no motor: ${n} grupos de testes passaram`);
