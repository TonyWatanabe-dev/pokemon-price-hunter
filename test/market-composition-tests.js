// Fase 6A.2 — composição do mercado, confiança e avisos. Testes puros (A–J do pedido + score inalterado).
import assert from 'node:assert/strict';
import { getIndependentMarketSources, marketReferenceOf, compositionOf, historyDeviation, MARKETPLACE_ONLY_FACTOR, currentReferenceView } from '../src/core/references.js';
import { computeProductStats } from '../src/core/price-engine.js';
import { calculateOpportunity, OPP_VERSION, WEIGHTS, CAPS, BANDS } from '../src/core/opportunity-engine.js';

let n = 0; const t = (name, fn) => { fn(); n++; };
const now = new Date('2026-10-08T12:00:00Z'); const asOf = now;
const off = (id, store, price, x = {}) => ({ id: String(id), store_id: store, marketplace_id: 'direct', seller_key: null, status: 'active', condition: 'new', confirmed: true,
  price, stock_status: 'in_stock', shipping_status: 'unknown', total_price: null, last_seen_at: '2026-10-08T10:00:00Z', events: [], ...x });
const ml = (id, seller, price) => off(id, 'mercadolivre', price, { marketplace_id: 'mercadolivre', seller_key: seller });
const stats = (offers, reference = null, distrust = null) => computeProductStats({ product: { condition: 'new' }, offers, reference, distrust, asOf }).stats;
const O = (x = {}) => ({ id: '1', price: 1250, shipping_status: 'unknown', stock_status: 'in_stock', status: 'active', confirmed: true, anomalous: false, store: { ra_status: null }, seller: {}, ...x });
const opp = (s, o = O()) => calculateOpportunity(s, o, { now });
const codes = (a) => a.map((x) => x.code);
const mlOnly = [ml(1, 'A', 1250), ml(2, 'B', 1800), ml(3, 'C', 1890), ml(4, 'D', 2200)];
const launch = { kind: 'COPAG_OFFICIAL_HISTORICAL', price: 319.99, published_at: '2023-10', status: 'pending' };

t('versão; pesos, travas e faixas intactos', () => {
  assert.equal(OPP_VERSION, 'opportunity-v2.2');
  assert.deepEqual(WEIGHTS, { reference: 0.30, historical: 0.20, market: 0.20, price: 0.10, freight: 0.10, reliability: 0.10 });
  assert.equal(CAPS.anomaly, 49); assert.equal(CAPS.far_above_reference, 49); assert.equal(BANDS[1][0], 75);
  assert.equal(MARKETPLACE_ONLY_FACTOR, 0.85);
});

t('A. 3 lojas tradicionais → MARKET_STORES', () => {
  const s = stats([off(1, 'a', 300), off(2, 'b', 310), off(3, 'c', 320)]);
  assert.equal(s.quality.market_reference.composition, 'MARKET_STORES'); assert.equal(s.reference_confidence, 0.65);
});

t('B. 2 lojas + 3 vendedores de marketplace → MARKET_MIXED', () => {
  const s = stats([off(1, 'a', 300), off(2, 'b', 310), ml(3, 'A', 305), ml(4, 'B', 315), ml(5, 'C', 320)]);
  assert.equal(s.quality.market_reference.composition, 'MARKET_MIXED'); assert.equal(s.quality.market_reference.sources, 5);
  assert.equal(s.reference_confidence, 0.8, 'sem redução: 0,60 + 0,10 + 0,10');
});

t('C. 4 vendedores de marketplace → MARKETPLACE_ONLY', () => {
  const s = stats(mlOnly);
  assert.equal(s.quality.market_reference.composition, 'MARKETPLACE_ONLY'); assert.equal(s.reference_kind, 'MARKET_CURRENT');
  assert.equal(s.reference_confidence, Math.round(0.75 * 0.85 * 1000) / 1000, '(0,60 + 0,05 por oferta + 0,10 por fontes) × 0,85');
});

t('D. 1 vendedor de marketplace → NONE', () => {
  const s = stats([ml(1, 'A', 300), ml(2, 'A', 310), ml(3, 'A', 320)]);
  assert.equal(s.reference_kind, 'NONE'); assert.equal(s.quality.market_reference.composition, 'NONE');
  assert.equal(compositionOf(0, 0), 'NONE');
});

t('E. vários anúncios do mesmo vendedor = 1 fonte', () => {
  const g = getIndependentMarketSources([ml(1, 'A', 300), ml(2, 'A', 301), ml(3, 'A', 302), off(4, 'x', 310)]);
  assert.equal(g.count, 2); assert.equal(g.marketplace_sources, 1); assert.equal(g.direct_sources, 1); assert.equal(g.composition, 'MARKET_MIXED');
  // anúncio de marketplace sem vendedor identificado continua sendo marketplace na composição
  assert.equal(getIndependentMarketSources([ml(1, null, 300), off(2, 'x', 310)]).composition, 'MARKET_MIXED');
});

t('F. vendedor em desconfiança não conta (nem na composição)', () => {
  const offers = [off(1, 'a', 300), off(2, 'a', 305), ml(3, 'A', 310)];
  const s = stats(offers, null, new Map([['mercadolivre:A', '2026-10-09']]));
  assert.equal(s.reference_kind, 'NONE', 'sobrou 1 fonte'); assert.equal(s.quality.market_reference.untrusted_sources, 1);
  const s2 = stats([...offers, off(4, 'b', 320)], null, new Map([['mercadolivre:A', '2026-10-09']]));
  assert.equal(s2.quality.market_reference.composition, 'MARKET_STORES', 'o vendedor desconfiável não torna o mercado misto');
});

t('G. só marketplace: referência válida, mediana real, confiança menor, score igual', () => {
  const s = stats(mlOnly);
  assert.equal(s.reference_price, 1845, 'mediana real, sem correção');
  const a = opp(s);
  // mesmo produto se a composição fosse mista: mesmo score, confiança maior
  const mixed = opp({ ...s, quality: { ...s.quality, market_reference: { ...s.quality.market_reference, composition: 'MARKET_MIXED' } } });
  assert.equal(a.opportunity_score, mixed.opportunity_score); assert.equal(a.raw_score, mixed.raw_score); assert.deepEqual(a.caps, mixed.caps);
  assert.equal(a.confidence, Math.round(mixed.confidence * 0.85 * 100) / 100);
  assert.ok(codes(a.warnings).includes('MARKETPLACE_ONLY') && !codes(mixed.warnings).includes('MARKETPLACE_ONLY'));
  assert.match(a.warnings.find((x) => x.code === 'MARKETPLACE_ONLY').text, /exclusivamente por vendedores de marketplace \(4 fontes\)/);
  assert.equal(a.market_composition, 'MARKETPLACE_ONLY');
});

t('H. só marketplace muito acima do histórico → aviso informativo', () => {
  const s = { ...stats(mlOnly), reference_context: { historical: [launch], community: [] } };
  const o = opp(s); const w = o.warnings.find((x) => x.code === 'MARKET_HIGHLY_DEVIATED_FROM_HISTORY');
  assert.ok(w); assert.match(w.text, /5,77× o preço sugerido de lançamento de 2023-10 \(confiança média\) \(R\$ 319,99\)/); assert.match(w.text, /não altera o score/);
  assert.equal(o.opportunity_score, opp(stats(mlOnly)).opportunity_score, 'o aviso não muda o score');
  assert.equal(o.confidence, opp(stats(mlOnly)).confidence, 'nem a confiança');
  // dentro da régua (55%–300%): sem aviso
  assert.equal(historyDeviation(800, { price: 319.99 }), null); assert.equal(historyDeviation(1000, { price: 319.99 }).direction, 'above');
  assert.equal(historyDeviation(100, { price: 319.99 }).direction, 'below');
  // o próprio histórico (≥ 3 dias) tem prioridade sobre o preço de lançamento
  const own = opp({ ...stats(mlOnly), history_status: 'ok', historical_min: 1700, historical_average: 1800, reference_context: { historical: [launch], community: [] } });
  assert.ok(!codes(own.warnings).includes('MARKET_HIGHLY_DEVIATED_FROM_HISTORY'), 'mercado coerente com o próprio histórico');
});

t('I. sem histórico suficiente → nenhum aviso histórico', () => {
  const o = opp(stats(mlOnly));
  assert.ok(!codes(o.warnings).includes('MARKET_HIGHLY_DEVIATED_FROM_HISTORY'));
  assert.equal(historyDeviation(1000, null), null);
});

t('J. Copag atual: composição do mercado não substitui a Copag', () => {
  const near = [ml(1, 'A', 380), ml(2, 'B', 390), ml(3, 'C', 400), ml(4, 'D', 410)];
  const s = stats(near, { value: 399.99, status: 'verified', source: 'copag_loja', kind: 'COPAG_OFFICIAL_CURRENT', confidence: 95 });
  assert.equal(s.reference_kind, 'COPAG_OFFICIAL_CURRENT'); assert.equal(s.reference_price, 399.99);
  assert.equal(s.quality.market_reference.composition, 'MARKETPLACE_ONLY', 'composição continua registrada como informação');
  const o = opp({ ...s, reference_context: { historical: [launch], community: [] } }, O({ price: 380 }));
  assert.ok(!codes(o.warnings).includes('MARKETPLACE_ONLY') && !codes(o.warnings).includes('MARKET_HIGHLY_DEVIATED_FROM_HISTORY'));
  assert.equal(o.market_composition, null);
});

t('API: composição na referência de mercado', () => {
  const v = currentReferenceView({ kind: 'MARKET_CURRENT', price: 1845, confidence: 0.595, reason: 'robust_current_market', market_sources: 4, market_composition: 'MARKETPLACE_ONLY' });
  assert.equal(v.market_composition, 'MARKETPLACE_ONLY'); assert.equal(v.market_sources, 4);
  assert.ok(!('market_composition' in currentReferenceView({ kind: 'COPAG_OFFICIAL_CURRENT', price: 399.99, confidence: 0.95 })));
  assert.equal(marketReferenceOf([ml(1, 'A', 1)]).composition, 'NONE');
});

console.log(`✓ Composição do mercado + confiança (6A.2): ${n} grupos de testes passaram`);

// Adaptadores Shopify e VTEX com fixtures locais (registrados aqui para entrar no npm test sem alterar o package.json)
await import('./adapters-shopify-vtex-tests.js');
