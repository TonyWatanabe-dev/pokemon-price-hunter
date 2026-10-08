// Fase 6A — política de REFERÊNCIA ATUAL (Copag atual > mercado robusto > NONE) e seu uso no Opportunity Engine. Testes puros.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolveCurrentReference, marketReferenceOf, currentReferenceView, contextReferenceView, MARKET_RULE } from '../src/core/references.js';
import { computeProductStats } from '../src/core/price-engine.js';
import { calculateOpportunity, WEIGHTS } from '../src/core/opportunity-engine.js';

let n = 0; const t = (name, fn) => { fn(); n++; };
const now = new Date('2026-10-08T12:00:00Z'); const asOf = now;
const copagRow = { reference_kind: 'COPAG_OFFICIAL_CURRENT', verification_status: 'verified', value: 349.99, source: 'copag_loja', confidence: 95, verified_at: '2026-10-08T10:00:00Z' };
const off = (id, store, price, x = {}) => ({ id: String(id), store_id: store, marketplace_id: 'direct', status: 'active', condition: 'new', confirmed: true, price, stock_status: 'in_stock',
  shipping_status: 'unknown', total_price: null, last_seen_at: '2026-10-08T10:00:00Z', events: [], ...x });
const market5 = [off(1, 'a', 300), off(2, 'b', 310), off(3, 'c', 320), off(4, 'd', 330), off(5, 'e', 3000)];   // um outlier absurdo
const stats = (offers, reference = null, distrust = null) => computeProductStats({ product: { condition: 'new' }, offers, reference, distrust, asOf }).stats;
const O = (x = {}) => ({ id: '1', price: 300, shipping_status: 'free', stock_status: 'in_stock', status: 'active', confirmed: true, anomalous: false, store: { ra_status: 'BOM' }, seller: {}, ...x });
const opp = (s, o = O()) => calculateOpportunity(s, o, { now });
const codes = (a) => a.map((x) => x.code);

t('peso da referência atual continua 30%', () => assert.equal(WEIGHTS.reference, 0.30));

t('1. Copag atual + mercado + histórico + comunitária → COPAG_OFFICIAL_CURRENT', () => {
  const market = marketReferenceOf(market5.slice(0, 4));
  const r = resolveCurrentReference({ copag: copagRow, market });
  assert.equal(r.kind, 'COPAG_OFFICIAL_CURRENT'); assert.equal(r.price, 349.99); assert.equal(r.reason, 'verified_current_copag'); assert.equal(r.confidence, 0.95);
  const s = stats(market5.slice(0, 4), { value: 349.99, status: 'verified', source: 'copag_loja', kind: 'COPAG_OFFICIAL_CURRENT', confidence: 95 });
  assert.equal(s.reference_kind, 'COPAG_OFFICIAL_CURRENT'); assert.equal(s.reference_price, 349.99);
  const o = opp({ ...s, reference_context: { historical: [{ kind: 'COPAG_OFFICIAL_HISTORICAL', price: 369.99, published_at: '2023-08' }], community: [{ price: 399.99 }] } });
  assert.match(o.reasons.find((x) => x.code === 'BELOW_REFERENCE').text, /abaixo do preço sugerido Copag \(R\$ 349,99\)/);
  assert.ok(!codes(o.warnings).includes('HISTORICAL_REFERENCE_ONLY')); assert.ok(codes(o.warnings).includes('COMMUNITY_REFERENCE'));
});

t('2. sem Copag atual + mercado robusto → MARKET_CURRENT (mediana, não média, não menor preço)', () => {
  const s = stats(market5);
  assert.equal(s.reference_kind, 'MARKET_CURRENT'); assert.equal(s.reference_status, 'derived'); assert.equal(s.reference_source, 'market');
  assert.equal(s.reference_reason, 'robust_current_market');
  assert.equal(s.reference_price, 315, 'mediana das 4 plausíveis (o R$ 3.000 é implausível e não entra)');
  assert.notEqual(s.reference_price, s.lowest_current_price);
  assert.ok(s.reference_confidence >= 0.6 && s.reference_confidence <= 0.85 && s.reference_confidence < 0.95);
  const o = opp(s);
  assert.ok(o.reference_signal != null); assert.match(o.reasons.find((x) => x.code === 'BELOW_REFERENCE').text, /abaixo da referência de mercado/);
  assert.ok(!o.reasons.some((x) => /Copag/.test(x.text)), 'mercado nunca é chamado de Copag');
  assert.equal(o.reasons.find((x) => x.code === 'BELOW_REFERENCE').reference_kind, 'MARKET_CURRENT');
});

t('3. sem Copag + mercado insuficiente + Copag histórica → NONE', () => {
  const s = stats(market5.slice(0, 2));
  assert.equal(s.reference_kind, 'NONE'); assert.equal(s.reference_price, null); assert.equal(s.discount_vs_reference, null);
  assert.equal(s.reference_reason, 'no_copag_insufficient_offers');
  const o = opp({ ...s, reference_context: { historical: [{ kind: 'COPAG_OFFICIAL_HISTORICAL', price: 369.99, published_at: '2023-08' }], community: [] } });
  assert.equal(o.reference_signal, null); assert.ok(codes(o.warnings).includes('NO_CURRENT_REFERENCE') && codes(o.warnings).includes('HISTORICAL_REFERENCE_ONLY'));
  assert.match(o.warnings.find((x) => x.code === 'HISTORICAL_REFERENCE_ONLY').text, /preço sugerido de lançamento de R\$ 369,99 \(2023-08\)/);
  assert.ok(!o.reasons.some((x) => /abaixo|acima/.test(x.text) && /Copag/.test(x.text)), 'nada de "% abaixo da Copag"');
});

t('4. sem Copag + mercado insuficiente + comunitária → NONE; comunitária só como aviso', () => {
  const s = stats(market5.slice(0, 2));
  const without = opp(s); const withC = opp({ ...s, reference_context: { historical: [], community: [{ price: 399.99 }] } });
  assert.equal(withC.reference_signal, null);
  assert.equal(withC.opportunity_score, without.opportunity_score, 'comunitária não sobe nem desce o score');
  assert.equal(withC.confidence, without.confidence);
  const w = withC.warnings.find((x) => x.code === 'COMMUNITY_REFERENCE_ONLY');
  assert.ok(w); assert.match(w.text, /referência comunitária de R\$ 399,99/); assert.match(w.text, /não é preço oficial Copag nem referência atual e não entra no score/);
});

t('5. somente Copag histórica → nunca referência atual', () => {
  const r = resolveCurrentReference({ copag: { ...copagRow, reference_kind: 'COPAG_OFFICIAL_HISTORICAL' }, market: null });
  assert.equal(r.kind, 'NONE'); assert.equal(r.price, null);
  const s = stats(market5.slice(0, 2), { value: 369.99, status: 'verified', source: 'copag_blog', kind: 'COPAG_OFFICIAL_HISTORICAL' });
  assert.equal(s.reference_kind, 'NONE'); assert.equal(s.discount_vs_reference, null);
  assert.equal(resolveCurrentReference({ copag: { ...copagRow, reference_kind: 'COMMUNITY_REFERENCE' } }).kind, 'NONE');
  assert.equal(resolveCurrentReference({ copag: { ...copagRow, verification_status: 'pending' } }).kind, 'NONE');
});

t('6. Copag histórica muito abaixo do preço atual → nenhum efeito no score', () => {
  const s = stats(market5.slice(0, 2));
  const a = opp(s, O({ price: 310 }));
  const b = opp({ ...s, reference_context: { historical: [{ kind: 'COPAG_OFFICIAL_HISTORICAL', price: 99.99, published_at: '2023-03' }], community: [] } }, O({ price: 310 }));
  assert.equal(a.opportunity_score, b.opportunity_score); assert.equal(a.raw_score, b.raw_score); assert.deepEqual(a.caps, b.caps);
  // e com mercado robusto: o histórico continua sem efeito
  const m = stats(market5);
  assert.equal(opp(m).opportunity_score, opp({ ...m, reference_context: { historical: [{ kind: 'COPAG_OFFICIAL_HISTORICAL', price: 99.99 }], community: [{ price: 50 }] } }).opportunity_score);
});

t('7. Celebração 30 anos: nenhuma exceção por coleção', () => {
  for (const f of ['src/core/opportunity-engine.js', 'src/core/price-engine.js', 'api/_lib/references.mjs', 'src/core/opportunity-run.js', 'src/core/price-stats.js'])
    assert.ok(!/c30|30 anos|Celebra/i.test(fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')), f);
  // mesmo produto, mesmas ofertas, com ou sem "ser c30": mesmo resultado
  const s = stats(market5);
  assert.deepEqual(opp({ ...s, product_id: 'c30-etb' }), opp({ ...s, product_id: 'sv3-etb' }));
});

t('8. preço muito abaixo do mercado: plausibilidade continua valendo', () => {
  const offers = [...market5.slice(0, 4), off(9, 'ml', 40, { marketplace_id: 'mercadolivre' })];
  const s = stats(offers);
  assert.equal(s.reference_price, 315, 'o R$ 40 não entra na mediana'); assert.equal(s.current_price, 300, 'nem vira preço atual');
  assert.equal(s.quality.market_reference.implausible, 1);
  // muitas anomalias → sem referência de mercado
  const bad = [off(1, 'a', 300), off(2, 'b', 310), off(3, 'c', 320), off(6, 'x', 20), off(7, 'y', 25)];
  const sb = stats(bad);
  assert.ok(sb.reference_kind === 'NONE' || sb.reference_kind === 'MARKET_CURRENT');
  const mk = marketReferenceOf(market5.slice(0, 3), { implausibleInStock: 2 });
  assert.equal(mk.ok, false); assert.equal(mk.reason, 'too_many_anomalies');
  // loja na janela de desconfiança não entra no mercado
  const d = stats(market5.slice(0, 3), null, new Map([['c', '2026-10-09']]));
  assert.equal(d.reference_kind, 'NONE'); assert.equal(d.quality.market_reference.untrusted, 1);
  // uma loja só não é mercado
  assert.equal(marketReferenceOf([off(1, 'a', 300), off(2, 'a', 310), off(3, 'a', 320)]).reason, 'single_source');
  assert.equal(MARKET_RULE.minOffers, 3); assert.equal(MARKET_RULE.minSources, 2);
});

t('9. frete desconhecido não vira zero', () => {
  const s = stats(market5);
  const o = opp(s, O({ shipping_status: 'unknown', total_price: null }));
  assert.equal(o.freight_signal, null); assert.ok(codes(o.warnings).includes('UNKNOWN_FREIGHT'));
  assert.equal(s.current_total_price, null, 'sem frete conhecido não há total');
});

t('10. estoque incerto: regras de estoque mantidas', () => {
  const s = stats(market5);
  const o = opp(s, O({ stock_status: 'unknown' }));
  assert.ok(o.opportunity_score <= 70 && o.caps.includes('stock_unknown') && codes(o.warnings).includes('UNCERTAIN_STOCK'));
  // ofertas sem estoque não entram na referência de mercado
  const s2 = stats([...market5.slice(0, 2), off(3, 'c', 100, { stock_status: 'out_of_stock' })]);
  assert.equal(s2.reference_kind, 'NONE');
});

t('NONE não é zero nem 50: sinal indisponível e cobertura menor', () => {
  const none = opp(stats(market5.slice(0, 2)));
  const withRef = opp(stats(market5.slice(0, 2), { value: 349.99, status: 'verified', source: 'copag_loja', kind: 'COPAG_OFFICIAL_CURRENT', confidence: 95 }));
  assert.equal(none.reference_signal, null); assert.ok(none.coverage < withRef.coverage);
});

t('contrato da API: referência atual, contexto e comunitária', () => {
  assert.deepEqual(currentReferenceView({ kind: 'NONE', reason: 'no_copag_single_source' }), { kind: 'NONE', label: null, price: null, source: null, confidence: null, reason: 'no_copag_single_source' });
  const m = currentReferenceView({ kind: 'MARKET_CURRENT', price: 319.9, confidence: 0.75, reason: 'robust_current_market' });
  assert.equal(m.label, 'Referência de mercado'); assert.equal(m.source, 'market');
  const c = currentReferenceView({ kind: 'COPAG_OFFICIAL_CURRENT', price: 349.99, confidence: 0.95 });
  assert.equal(c.label, 'Preço sugerido Copag'); assert.equal(c.source, 'Copag'); assert.equal(c.confidence, 0.95);
  const h = contextReferenceView({ reference_kind: 'COPAG_OFFICIAL_HISTORICAL', value: 369.99, published_at: '2023-08', confidence: 90, source_url: 'https://copag.com.br/pokemon/blog/detalhes/x' });
  assert.equal(h.label, 'Preço sugerido de lançamento'); assert.equal(h.confidence, 0.9); assert.equal(h.published_at, '2023-08'); assert.equal(h.effective_date, null);
  const k = contextReferenceView({ reference_kind: 'COMMUNITY_REFERENCE', value: 399.99, confidence: 95, source_url: 'https://www.instagram.com/voltztcg/' });
  assert.equal(k.label, 'Referência comunitária'); assert.equal(k.source, 'instagram.com/voltztcg'); assert.ok(!/Copag/.test(k.label));
});

console.log(`✓ Política de referência atual (6A): ${n} grupos de testes passaram`);
