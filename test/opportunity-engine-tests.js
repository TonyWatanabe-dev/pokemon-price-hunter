// Opportunity Engine (opportunity-v1): testes puros dos 14 cenários obrigatórios + explicação, eventos e determinismo.
import assert from 'node:assert/strict';
import { calculateOpportunity as calc, productOpportunity, explain, eventsFor, EVENTS, bandOf, OPP_VERSION, WEIGHTS, pw } from '../src/core/opportunity-engine.js';

const now = new Date('2026-10-08T12:00:00Z');
let n = 0; const t = (name, fn) => { fn(); n++; };
// produto com Copag verificada (R$ 400), histórico ok e mercado de 5 ofertas
const S = (x = {}) => ({ reference_price: 400, reference_status: 'verified', history_status: 'ok', history_days: 20, historical_min: 330, historical_average: 380,
  variation_7d: -0.05, variation_30d: null, number_of_in_stock_offers: 5, median_price: 390, lowest_current_price: 300, quality: { anchor: 380 }, ...x });
const O = (x = {}) => ({ id: '1', price: 300, total_price: 300, shipping_status: 'free', shipping_price: 0, stock_status: 'in_stock', status: 'active', confirmed: true,
  anomalous: false, store: { ra_status: 'OTIMO' }, seller: { is_official: false }, ...x });
const C = (s, o) => calc(s, o, { now });
const codes = (a) => a.map((x) => x.code);

t('contrato da saída', () => {
  const r = C(S(), O());
  for (const k of ['opportunity_score', 'opportunity_band', 'confidence', 'reasons', 'warnings', 'price_signal', 'historical_signal', 'reference_signal',
    'stock_signal', 'freight_signal', 'market_signal', 'calculated_at', 'engine_version']) assert.ok(k in r, k);
  assert.equal(r.engine_version, OPP_VERSION); assert.equal(r.engine_version, 'opportunity-v1');
  assert.equal(r.calculated_at, now.toISOString());
  assert.equal(Object.values(WEIGHTS).reduce((a, b) => a + b, 0).toFixed(2), '1.00');
  assert.equal(bandOf(90), 'excelente'); assert.equal(bandOf(89), 'boa'); assert.equal(bandOf(75), 'boa'); assert.equal(bandOf(74), 'normal'); assert.equal(bandOf(50), 'normal'); assert.equal(bandOf(49), 'baixa');
  assert.equal(pw(-1, [[0, 0], [1, 1]]), 0); assert.equal(pw(0.5, [[0, 0], [1, 1]]), 0.5); assert.equal(pw(9, [[0, 0], [1, 1]]), 1);
});

t('1. excelente oportunidade', () => {
  const r = C(S(), O({ price: 300 }));    // 25% abaixo da Copag, na mínima histórica, menor preço, frete grátis, loja ótima
  assert.equal(r.opportunity_band, 'excelente'); assert.ok(r.opportunity_score >= 90, String(r.opportunity_score));
  assert.ok(r.confidence >= 0.9); assert.deepEqual(r.warnings, []);
  assert.ok(codes(r.reasons).includes('BELOW_REFERENCE') && codes(r.reasons).includes('AT_HISTORICAL_MIN') && codes(r.reasons).includes('LOWEST_NOW'));
  assert.match(r.reasons[0].text, /25,0% abaixo da referência Copag/);
});

t('2. boa oportunidade', () => {
  const r = C(S({ lowest_current_price: 340 }), O({ price: 350 }));   // 12,5% abaixo da Copag, abaixo da média histórica
  assert.equal(r.opportunity_band, 'boa', String(r.opportunity_score));
});

t('3. oportunidade normal', () => {
  const r = C(S({ lowest_current_price: 380 }), O({ price: 395 }));   // perto da Copag, acima da média histórica
  assert.equal(r.opportunity_band, 'normal', String(r.opportunity_score));
});

t('4. preço ruim', () => {
  const r = C(S({ median_price: 600, lowest_current_price: 590 }), O({ price: 600 }));  // 50% acima da Copag, mesmo sendo o "mercado"
  assert.equal(r.opportunity_band, 'baixa', String(r.opportunity_score));
  assert.ok(r.caps.includes('far_above_reference')); assert.ok(codes(r.reasons).includes('ABOVE_REFERENCE'));
  assert.equal(r.reasons.find((x) => x.code === 'ABOVE_REFERENCE').impact, '-');
  // pouco acima da Copag nunca chega a Boa, mesmo com todo o resto excelente
  const m = C(S({ historical_min: 420, historical_average: 470, median_price: 500, lowest_current_price: 410 }), O({ price: 410 }));
  assert.ok(m.opportunity_score <= 74 && m.caps.includes('above_reference'));
  // caso real (c30-etb): 50% acima da Copag, mas 21% abaixo da mediana e menor preço → Baixa
  const c30 = C(S({ reference_price: 399.9, history_status: 'insufficient', history_days: 2, historical_min: null, historical_average: null, median_price: 760, lowest_current_price: 599.99, number_of_in_stock_offers: 12 }),
    O({ price: 599.99, shipping_status: 'unknown', store: { ra_status: 'BOM' } }));
  assert.equal(c30.opportunity_band, 'baixa');
});

t('5. sem Copag', () => {
  for (const s of [S({ reference_price: null, reference_status: null }), S({ reference_status: 'unverified' })]) {
    const r = C(s, O());
    assert.equal(r.reference_signal, null); assert.ok(codes(r.warnings).includes('NO_REFERENCE'));
    assert.ok(!codes(r.reasons).some((c) => /REFERENCE/.test(c)));
    assert.ok(r.opportunity_score < 90, 'sem Copag não chega a Excelente: ' + r.opportunity_score);
    assert.ok(r.coverage < 1 && r.confidence < C(S(), O()).confidence);
  }
  assert.match(C(S({ reference_status: 'unverified' }), O()).warnings[0].text, /não verificada/);
});

t('6. sem histórico', () => {
  const r = C(S({ history_status: 'none', history_days: 0, historical_min: null, historical_average: null, variation_7d: null }), O());
  assert.equal(r.historical_signal, null); assert.ok(codes(r.warnings).includes('SHORT_HISTORY'));
  assert.ok(!codes(r.reasons).some((c) => /HISTORICAL|PRICE_FALLING|PRICE_RISING/.test(c)));
});

t('7. histórico insuficiente (sem tendência inventada)', () => {
  // mesmo que venha mínimo/variação no stats, sem history_status ok nada de histórico/tendência é usado
  const r = C(S({ history_status: 'insufficient', history_days: 2, variation_7d: -0.2 }), O());
  assert.equal(r.historical_signal, null);
  assert.ok(!codes(r.reasons).includes('PRICE_FALLING'));
  assert.match(r.warnings.find((x) => x.code === 'SHORT_HISTORY').text, /2 dias/);
  assert.ok(r.confidence < C(S(), O()).confidence);
  // tendência só quando calculada e relevante (|v| ≥ 3%)
  assert.ok(codes(C(S({ variation_7d: -0.05 }), O()).reasons).includes('PRICE_FALLING'));
  assert.ok(!codes(C(S({ variation_7d: -0.01 }), O()).reasons).includes('PRICE_FALLING'));
  assert.ok(!codes(C(S({ variation_7d: null }), O()).reasons).includes('PRICE_FALLING'));
});

t('8. sem estoque', () => {
  const r = C(S(), O({ stock_status: 'out_of_stock' }));
  assert.ok(r.opportunity_score <= 30); assert.equal(r.stock_signal, 0); assert.ok(codes(r.warnings).includes('OUT_OF_STOCK'));
  assert.ok(C(S(), O({ stock_status: 'preorder' })).opportunity_score <= 60);
  assert.ok(C(S(), O({ stock_status: 'unknown' })).opportunity_score <= 70);
  assert.ok(C(S(), O({ status: 'pending' })).opportunity_score <= 40);
  assert.ok(codes(C(S(), O({ status: 'pending' })).warnings).includes('STALE'));
});

t('9. frete desconhecido (nunca R$ 0)', () => {
  const r = C(S(), O({ shipping_status: 'unknown', shipping_price: null }));
  assert.equal(r.freight_signal, null); assert.ok(codes(r.warnings).includes('UNKNOWN_SHIPPING'));
  assert.ok(!codes(r.reasons).includes('FREE_SHIPPING'));
  assert.ok(r.confidence < C(S(), O()).confidence);
  // frete conhecido pesa; frete pesado vira motivo negativo
  const k = C(S(), O({ shipping_status: 'known', shipping_price: 15, total_price: 315 })); assert.ok(k.freight_signal > 0 && k.freight_signal < 1);
  const h = C(S(), O({ shipping_status: 'known', shipping_price: 90, total_price: 390 })); assert.ok(codes(h.reasons).includes('HEAVY_SHIPPING'));
  assert.ok(h.opportunity_score < k.opportunity_score);
  // frete "known" sem valor também não é R$ 0
  assert.equal(C(S(), O({ shipping_status: 'known', shipping_price: null, total_price: null })).freight_signal, null);
});

t('10. preço anômalo nunca vira oportunidade', () => {
  const r = C(S(), O({ price: 40, anomalous: true }));
  assert.ok(r.opportunity_score <= 49 && r.is_anomaly); assert.ok(codes(r.warnings).includes('ANOMALY'));
  const impl = C(S({ quality: { anchor: 380 } }), O({ price: 39 }));      // implausível pela régua do Price Engine
  assert.ok(impl.is_anomaly && impl.opportunity_score <= 49);
  const tg = C(S({ historical_min: 220, lowest_current_price: 230 }), O({ price: 230 }));   // 42,5% abaixo: suspeito, trava em 89
  assert.ok(tg.caps.includes('too_good') && tg.opportunity_score <= 89 && codes(tg.warnings).includes('TOO_GOOD'));
  const p = productOpportunity(S(), [O({ id: '1', price: 40, anomalous: true }), O({ id: '2', price: 395 })], { now });
  assert.equal(p.best.offer_id, '2');
});

t('11. oferta pouco confiável', () => {
  const ok = C(S(), O()); const bad = C(S(), O({ store: { ra_status: 'NAO_RECOMENDADA' } }));
  assert.ok(bad.opportunity_score <= 74 && codes(bad.warnings).includes('BAD_STORE'));
  assert.equal(bad.reliability_signal, 0); assert.ok(bad.opportunity_score < ok.opportunity_score);
  const unc = C(S(), O({ confirmed: false }));
  assert.ok(unc.opportunity_score <= 74 && codes(unc.warnings).includes('UNCONFIRMED') && unc.confidence < ok.confidence);
  const unknown = C(S(), O({ store: { ra_status: null } })); assert.equal(unknown.reliability_signal, 0.5);
  assert.equal(C(S(), O({ store: { ra_status: 'BOM' }, seller: { is_official: true } })).reliability_signal, 0.95);
});

t('12. empate determinístico', () => {
  const a = O({ id: '7', price: 300 }); const b = O({ id: '3', price: 300 });
  const p1 = productOpportunity(S(), [a, b], { now }); const p2 = productOpportunity(S(), [b, a], { now });
  assert.equal(p1.best.offer_id, '3'); assert.equal(p2.best.offer_id, '3');
  // mesmo score: confiança decide, depois menor preço
  const c = productOpportunity(S(), [O({ id: '1', store: { ra_status: null } }), O({ id: '2' })], { now });
  assert.equal(c.best.offer_id, '2');
  // determinismo: mesmos dados → mesma saída
  assert.deepEqual(C(S(), O()), C(S(), O()));
});

t('13. produto sem ofertas', () => {
  const p = productOpportunity(S(), [], { now });
  assert.equal(p.best, null); assert.equal(p.reason, 'NO_OFFERS'); assert.deepEqual(p.offers, []);
  const q = productOpportunity(S(), [O({ stock_status: 'out_of_stock' })], { now });
  assert.equal(q.best, null); assert.equal(q.reason, 'NO_BUYABLE_OFFER');
  const np = C(S(), O({ price: null })); assert.equal(np.opportunity_score, null); assert.deepEqual(codes(np.warnings), ['NO_PRICE']);
  // sem product_stats (produto nunca precificado): ainda avalia, com cobertura mínima
  const ns = C(null, O()); assert.ok(ns.opportunity_score >= 0 && ns.reference_signal == null && ns.market_signal == null);
});

t('14. produto com múltiplas ofertas', () => {
  const offers = [O({ id: '1', price: 300 }), O({ id: '2', price: 360, shipping_status: 'unknown' }), O({ id: '3', price: 280, stock_status: 'out_of_stock' }),
    O({ id: '4', price: 420 }), O({ id: '5', price: 30, anomalous: true })];
  const p = productOpportunity(S(), offers, { now });
  assert.equal(p.offers.length, 5); assert.equal(p.best.offer_id, '1');
  const by = Object.fromEntries(p.offers.map((x) => [x.offer_id, x]));
  assert.ok(by['1'].opportunity_score > by['2'].opportunity_score && by['2'].opportunity_score > by['4'].opportunity_score);
  assert.ok(by['3'].opportunity_score <= 30 && by['5'].opportunity_score <= 49);
  // mercado ralo: 2 ofertas = meio peso no mercado; 1 oferta = sem mercado
  assert.ok(C(S({ number_of_in_stock_offers: 2 }), O()).coverage < C(S(), O()).coverage);
  const one = C(S({ number_of_in_stock_offers: 1 }), O()); assert.equal(one.market_signal, null); assert.equal(one.price_signal, null); assert.ok(codes(one.warnings).includes('THIN_MARKET'));
});

t('explicação transparente', () => {
  const e = explain(C(S(), O({ shipping_status: 'unknown' })));
  assert.match(e, /^\d+ — (Excelente|Boa)/); assert.match(e, /\+ 25,0% abaixo da referência Copag/); assert.match(e, /− Frete ainda não confirmado/);
  assert.equal(explain(null), null);
});

t('eventos só em transição', () => {
  const g = { offer_id: '1', opportunity_score: 82, opportunity_band: 'boa', price: 300 };
  const x = { offer_id: '1', opportunity_score: 92, opportunity_band: 'excelente', price: 290 };
  const lo = { offer_id: '1', opportunity_score: 60, opportunity_band: 'normal', price: 380 };
  assert.deepEqual(eventsFor('p', null, g).map((e) => e.type), [EVENTS.FOUND]);
  assert.deepEqual(eventsFor('p', lo, g).map((e) => e.type), [EVENTS.FOUND]);
  assert.deepEqual(eventsFor('p', g, g), []);                                    // nada mudou: sem evento
  assert.deepEqual(eventsFor('p', g, { ...g, opportunity_score: 85 }), []);     // < 10 pontos na mesma faixa
  assert.deepEqual(eventsFor('p', g, x).map((e) => e.type), [EVENTS.CHANGED]);
  assert.deepEqual(eventsFor('p', g, { ...g, offer_id: '2' }).map((e) => e.type), [EVENTS.CHANGED]);
  assert.deepEqual(eventsFor('p', g, lo).map((e) => e.type), [EVENTS.EXPIRED]);
  assert.deepEqual(eventsFor('p', g, null).map((e) => e.type), [EVENTS.EXPIRED]);
  assert.deepEqual(eventsFor('p', lo, lo), []);
  const an = eventsFor('p', null, null, { newAnomalies: [{ offer_id: 9, price: 40, warnings: [{ code: 'ANOMALY' }] }] });
  assert.deepEqual(an.map((e) => e.type), [EVENTS.ANOMALY]); assert.equal(an[0].payload.offer_id, '9');
});

t('afiliado não influencia', () => {
  assert.deepEqual(C(S(), O({ affiliate_url: 'https://x', commission: 0.1 })), C(S(), O()));
});

console.log(`✓ Opportunity Engine: ${n} grupos de testes passaram`);
