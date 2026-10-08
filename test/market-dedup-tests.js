// Fase 6A.1 — deduplicação do mercado e fontes independentes. Testes puros (A–L do pedido + matemática da contribuição).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getIndependentMarketSources, marketReferenceOf, sourceOf, MARKET_RULE, currentReferenceView } from '../src/core/references.js';
import { computeProductStats } from '../src/core/price-engine.js';
import { calculateOpportunity, WEIGHTS, OPP_VERSION } from '../src/core/opportunity-engine.js';

let n = 0; const t = (name, fn) => { fn(); n++; };
const now = new Date('2026-10-08T12:00:00Z'); const asOf = now;
const off = (id, store, price, x = {}) => ({ id: String(id), store_id: store, marketplace_id: 'direct', seller_key: null, status: 'active', condition: 'new', confirmed: true,
  price, stock_status: 'in_stock', shipping_status: 'unknown', total_price: null, last_seen_at: '2026-10-08T10:00:00Z', events: [], ...x });
const ml = (id, seller, price) => off(id, 'mercadolivre', price, { marketplace_id: 'mercadolivre', seller_key: seller });
const stats = (offers, reference = null, distrust = null) => computeProductStats({ product: { condition: 'new' }, offers, reference, distrust, asOf }).stats;
const O = (x = {}) => ({ id: '1', price: 300, shipping_status: 'free', stock_status: 'in_stock', status: 'active', confirmed: true, anomalous: false, store: { ra_status: 'BOM' }, seller: {}, ...x });
const opp = (s, o = O()) => calculateOpportunity(s, o, { now });
const copag = { value: 380, status: 'verified', source: 'copag_loja', kind: 'COPAG_OFFICIAL_CURRENT', confidence: 95 };
const five = [off(1, 'a', 300), off(2, 'b', 310), off(3, 'c', 320), off(4, 'd', 330), off(5, 'e', 340)];
// contribuição de cada sinal em pontos (antes das travas): score − 50 = Σ wᵢ·(100·sᵢ − 50), com Σ w = 1 (ver relatório)
const contrib = (o) => ({ reference: o.reference_signal == null ? 0 : WEIGHTS.reference * (100 * o.reference_signal - 50),
  market: o.market_signal == null ? 0 : WEIGHTS.market * (100 * o.market_signal - 50) });

t('versão e pesos preservados', () => {
  assert.equal(OPP_VERSION, 'opportunity-v2.1');
  assert.deepEqual(WEIGHTS, { reference: 0.30, historical: 0.20, market: 0.20, price: 0.10, freight: 0.10, reliability: 0.10 });
});

t('A. Copag atual + mercado: referência e mercado continuam independentes', () => {
  const s = stats(five, copag); assert.equal(s.reference_kind, 'COPAG_OFFICIAL_CURRENT');
  const o = opp(s);
  assert.ok(o.reference_signal != null && o.market_signal != null); assert.equal(o.market_signal_absorbed, false);
  assert.ok(o.reasons.some((x) => x.code === 'BELOW_MARKET'));
  assert.equal(o.coverage, 0.8, 'referência 0,3 + mercado 0,2 + menor preço 0,1 + frete 0,1 + loja 0,1');
});

t('B. Mercado como referência: a mesma mediana não conta duas vezes', () => {
  const s = stats(five); assert.equal(s.reference_kind, 'MARKET_CURRENT');
  const o = opp(s);
  assert.ok(o.reference_signal != null); assert.equal(o.market_signal, null); assert.equal(o.market_signal_absorbed, true);
  assert.ok(!o.reasons.some((x) => x.code === 'BELOW_MARKET' || x.code === 'ABOVE_MARKET'), 'o motivo da mediana não aparece de novo');
  assert.ok(!o.warnings.some((x) => x.code === 'THIN_MARKET'));
  assert.equal(o.coverage, 0.6, 'o peso de 0,2 do mercado sai da cobertura (não é redistribuído)');
  assert.match(o.reasons.find((x) => x.code === 'BELOW_REFERENCE').text, /referência de mercado \(mediana de 5 ofertas de 5 fontes independentes, R\$ 320,00\)/);
  // matemática: score − 50 = Σ wᵢ(100sᵢ − 50); a parcela do mercado some, nada é somado a outro sinal
  const sum = Object.entries({ reference: o.reference_signal, historical: o.historical_signal, market: o.market_signal, price: o.price_signal, freight: o.freight_signal, reliability: o.reliability_signal })
    .reduce((a, [k, v]) => a + (v == null ? 0 : WEIGHTS[k] * (100 * v - 50)), 0);
  assert.ok(Math.abs(50 + sum - (50 + (o.raw_score - 50) * o.coverage)) < 0.05);
  assert.equal(contrib(o).market, 0);
});

t('C. 1 loja + 5 ofertas = 1 fonte → sem mercado', () => {
  const g = getIndependentMarketSources([1, 2, 3, 4, 5].map((i) => off(i, 'a', 300 + i)));
  assert.equal(g.count, 1); assert.equal(g.stores, 1);
  assert.equal(stats([1, 2, 3, 4, 5].map((i) => off(i, 'a', 300 + i))).reference_reason, 'no_copag_single_source');
});

t('D. 2 lojas + 3 ofertas = 2 fontes → pode formar mercado', () => {
  const offers = [off(1, 'a', 300), off(2, 'a', 310), off(3, 'b', 320)];
  assert.equal(getIndependentMarketSources(offers).count, 2);
  assert.equal(stats(offers).reference_kind, 'MARKET_CURRENT');
});

t('E. Mercado Livre: vendedores A, B, C = 3 fontes', () => {
  const g = getIndependentMarketSources([ml(1, 'A', 300), ml(2, 'B', 310), ml(3, 'C', 320)]);
  assert.equal(g.count, 3); assert.equal(g.marketplace_sellers, 3); assert.equal(g.stores, 0);
  assert.deepEqual(g.sources.map((x) => [x.type, x.marketplace, x.seller]), [['MARKETPLACE_SELLER', 'mercadolivre', 'A'], ['MARKETPLACE_SELLER', 'mercadolivre', 'B'], ['MARKETPLACE_SELLER', 'mercadolivre', 'C']]);
  assert.equal(stats([ml(1, 'A', 300), ml(2, 'B', 310), ml(3, 'C', 320)]).reference_kind, 'MARKET_CURRENT');
});

t('F. Mercado Livre: A×3 + B×3 = 2 fontes (anúncios não são fontes)', () => {
  const offers = [ml(1, 'A', 300), ml(2, 'A', 301), ml(3, 'A', 302), ml(4, 'B', 310), ml(5, 'B', 311), ml(6, 'B', 312)];
  const g = getIndependentMarketSources(offers); assert.equal(g.count, 2); assert.deepEqual(g.sources.map((x) => x.offers), [3, 3]);
  const s = stats(offers); assert.equal(s.reference_kind, 'MARKET_CURRENT'); assert.equal(s.quality.market_reference.sources, 2); assert.equal(s.quality.market_reference.offers, 6);
});

t('G. Mercado Livre: A×6 = 1 fonte → sem mercado', () => {
  const offers = [1, 2, 3, 4, 5, 6].map((i) => ml(i, 'A', 300 + i));
  assert.equal(getIndependentMarketSources(offers).count, 1);
  assert.equal(stats(offers).reference_kind, 'NONE');
  // anúncio de marketplace sem vendedor identificado: todos juntos contam como uma fonte (conservador)
  assert.equal(getIndependentMarketSources([ml(1, null, 300), ml(2, null, 310), ml(3, null, 320)]).count, 1);
  assert.equal(sourceOf(ml(1, null, 300)).type, 'STORE');
});

t('H. Fonte em desconfiança não conta', () => {
  const offers = [ml(1, 'A', 300), ml(2, 'B', 310), ml(3, 'C', 320)];
  const d = new Map([['mercadolivre:C', '2026-10-09']]);             // janela própria de um vendedor
  const s = stats(offers, null, d);
  assert.equal(s.quality.market_reference.sources, 2); assert.equal(s.quality.market_reference.untrusted_sources, 1);
  assert.equal(s.reference_kind, 'NONE', 'só 2 ofertas confiáveis: abaixo do mínimo de 3');
  const s2 = stats([...offers, ml(4, 'A', 305)], null, d); assert.equal(s2.reference_kind, 'MARKET_CURRENT'); assert.equal(s2.quality.market_reference.sources, 2);
  const s3 = stats([ml(1, 'A', 300), ml(2, 'A', 301), ml(3, 'C', 320)], null, d); assert.equal(s3.reference_kind, 'NONE', 'restou 1 fonte');
  // loja inteira em desconfiança: nenhum vendedor dela conta
  assert.equal(stats(offers, null, new Map([['mercadolivre', '2026-10-09']])).reference_kind, 'NONE');
  // janela vencida não pune
  assert.equal(stats(offers, null, new Map([['mercadolivre:C', '2026-10-07']])).quality.market_reference.sources, 3);
});

t('I. Loja + vendedor de marketplace = 2 fontes; X, Y + ML A, B = 4', () => {
  assert.equal(getIndependentMarketSources([off(1, 'x', 300), ml(2, 'A', 310)]).count, 2);
  const g = getIndependentMarketSources([off(1, 'x', 300), off(2, 'y', 305), ml(3, 'A', 310), ml(4, 'B', 315)]);
  assert.equal(g.count, 4); assert.equal(g.stores, 2); assert.equal(g.marketplace_sellers, 2);
  // parceiro vendendo DENTRO de uma loja tradicional continua sendo a loja (uma fonte)
  assert.equal(getIndependentMarketSources([off(1, 'rihappy', 300, { seller_key: 'rihappy:1' }), off(2, 'rihappy', 310, { seller_key: 'rihappy:gourmande' })]).count, 1);
});

t('J. Celebração de 30 anos: nenhuma regra especial', () => {
  for (const f of ['src/core/opportunity-engine.js', 'src/core/price-engine.js', 'api/_lib/references.mjs'])
    assert.ok(!/c30|30 anos|Celebra/i.test(fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')), f);
  const s = stats(five); assert.deepEqual(opp({ ...s, product_id: 'c30-etb' }), opp({ ...s, product_id: 'x' }));
});

t('K. Referência comunitária não altera o score', () => {
  const s = stats(five);
  const a = opp(s); const b = opp({ ...s, reference_context: { historical: [], community: [{ price: 199.99 }] } });
  assert.equal(a.opportunity_score, b.opportunity_score); assert.equal(a.confidence, b.confidence); assert.equal(a.coverage, b.coverage);
  assert.match(b.warnings.find((x) => x.code === 'COMMUNITY_REFERENCE').text, /não é preço oficial Copag nem referência atual e não entra no score/);
});

t('L. Referência histórica não altera a referência atual', () => {
  const h = stats(five, { value: 99.99, status: 'verified', source: 'copag_blog', kind: 'COPAG_OFFICIAL_HISTORICAL' });
  assert.equal(h.reference_kind, 'MARKET_CURRENT'); assert.equal(h.reference_price, 320);
  const x = opp({ ...h, reference_context: { historical: [{ kind: 'COPAG_OFFICIAL_HISTORICAL', price: 99.99, published_at: '2023-03' }], community: [] } });
  assert.equal(x.opportunity_score, opp(h).opportunity_score);
});

t('mediana mantida; regras de mercado mantidas', () => {
  assert.equal(stats(five).reference_price, 320); assert.equal(MARKET_RULE.minOffers, 3); assert.equal(MARKET_RULE.minSources, 2); assert.equal(MARKET_RULE.maxAnomalyShare, 1 / 3);
  const r = marketReferenceOf([off(1, 'a', 300), off(2, 'b', 310), off(3, 'c', 320)]);
  assert.equal(r.price, 310); assert.equal(r.confidence, 0.65, '0,60 + 1 fonte além de 2');
});

t('API: referência de mercado informa as fontes independentes', () => {
  assert.equal(currentReferenceView({ kind: 'MARKET_CURRENT', price: 320, confidence: 0.75, reason: 'robust_current_market', market_sources: 5 }).market_sources, 5);
  assert.ok(!('market_sources' in currentReferenceView({ kind: 'COPAG_OFFICIAL_CURRENT', price: 380, confidence: 0.95 })));
});

console.log(`✓ Mercado deduplicado + fontes independentes (6A.1): ${n} grupos de testes passaram`);
