// Price Engine (FASE 2): regras matemáticas e de elegibilidade, sem banco.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mean, median, min, max, ratio, round2, plausible, trusted, dailySeries, computeProductStats, MIN_HISTORY_DAYS, anchorOf, historyAnchorOf, moneyMean, moneyMedian } from '../src/core/price-engine.js';

// --- estatística básica ---
assert.equal(mean([10, 20, 30]), 20); assert.equal(mean([]), null);
assert.equal(median([3, 1, 2]), 2); assert.equal(median([4, 1, 3, 2]), 2.5); assert.equal(median([]), null);
assert.equal(min([5, 2, 9]), 2); assert.equal(max([5, 2, 9]), 9); assert.equal(min([]), null);
assert.equal(ratio(90, 100), -0.1); assert.equal(ratio(110, 100), 0.1); assert.equal(ratio(100, null), null); assert.equal(ratio(null, 100), null); assert.equal(ratio(1, 0), null);
assert.equal(round2(10.005), 10.01); assert.equal(round2(1 / 3), 0.33);
assert.equal(plausible(50, 100), false); assert.equal(plausible(55, 100), true); assert.equal(plausible(301, 100), false); assert.equal(plausible(0, null), false); assert.equal(plausible(999, null), true);
const D = new Map([['velha', '2026-10-07']]);
assert.equal(trusted(D, 'velha', '2026-10-07T23:00:00Z'), false); assert.equal(trusted(D, 'velha', '2026-10-08T00:00:00Z'), true); assert.equal(trusted(D, 'outra', '2026-10-01T00:00:00Z'), true);
assert.equal(anchorOf({ reference: { value: 50, status: 'verified' } }), 50);
assert.equal(anchorOf({ reference: { value: 50, status: 'pending' }, currentInStock: [10, 20, 30] }), 20, 'referência pendente não ancora');
assert.equal(anchorOf({ currentInStock: [10, 20] }), null);

// dinheiro em centavos: mesmo arredondamento do PostgreSQL (caso real: 6 ETBs, média 1279,815)
assert.equal(moneyMean([1190, 1249.9, 1290, 1299, 1299.99, 1350]), 1279.82);
assert.equal(moneyMean([0.1, 0.2]), 0.15); assert.equal(moneyMedian([1299, 1290]), 1294.5); assert.equal(moneyMedian([0.01, 0.02]), 0.02);
// âncora do histórico: sem referência e com poucas ofertas, a régua vem das ofertas atuais, não do histórico (que pode ter leituras erradas)
assert.equal(historyAnchorOf({ currentInStock: [49.9, 118.66], historyPrices: [118.66, 1399, 1795.5, 59.99] }), 84.28);
assert.equal(historyAnchorOf({ historyPrices: [10, 20, 30] }), 20);

// --- caso real (sv1-booster): sem referência, 2 ofertas atuais, histórico com box casada como booster ---
{
  const o = (id, price, extra = []) => ({ id, store_id: 'mercadolivre', marketplace_id: 'mercadolivre', status: 'active', condition: 'new', confirmed: true, price, stock_status: 'in_stock', shipping_status: 'unknown', total_price: null, last_seen_at: '2026-10-08T13:30:00Z',
    events: [{ t: '2026-10-08T12:19:25Z', price, stock_status: 'in_stock' }, ...extra] });
  const sv = computeProductStats({ product: { condition: 'new' }, asOf: '2026-10-08T14:00:00Z', offers: [o('1', 49.9), o('2', 118.66),
    { ...o('3', 1399), status: 'removed' }, { ...o('4', 1795.5), status: 'removed' }] }).stats;
  assert.equal(sv.current_price, 49.9, 'a oferta mais barata não pode ser descartada por um histórico contaminado');
  assert.equal(sv.number_of_in_stock_offers, 2); assert.equal(sv.quality.anchor, null); assert.equal(sv.quality.implausible_points, 2);
}

// --- cenário: um produto, várias ofertas ---
const asOf = '2026-10-10T12:00:00Z';
const ev = (t, price, stock = 'in_stock') => ({ t, price, stock_status: stock });
const base = { store_id: 'a', marketplace_id: 'direct', status: 'active', condition: 'new', confirmed: true, stock_status: 'in_stock', shipping_status: 'unknown', total_price: null, last_seen_at: '2026-10-10T11:00:00Z' };
const offers = [
  { ...base, id: '1', store_id: 'a', price: 100, events: [ev('2026-10-05T10:00:00Z', 120), ev('2026-10-08T10:00:00Z', 100)] },            // carrega 120 até 08, depois 100
  { ...base, id: '2', store_id: 'b', price: 90, shipping_status: 'known', total_price: 110, events: [ev('2026-10-09T10:00:00Z', 90)] },   // frete conhecido
  { ...base, id: '3', store_id: 'c', price: 80, stock_status: 'out_of_stock', events: [ev('2026-10-09T10:00:00Z', 80, 'out_of_stock')] }, // sem estoque: fora do preço atual
  { ...base, id: '4', store_id: 'd', price: 60, status: 'removed', events: [ev('2026-10-06T10:00:00Z', 60), { t: '2026-10-07T10:00:00Z', removed: true }] }, // removida: só no histórico
  { ...base, id: '5', store_id: 'e', price: 20, events: [ev('2026-10-09T10:00:00Z', 20)] },                                                // implausível (< 55% da referência)
  { ...base, id: '6', store_id: 'f', price: 70, confirmed: false, events: [] },                                                          // queda não confirmada
  { ...base, id: '7', store_id: 'g', price: 75, condition: 'used', events: [ev('2026-10-09T10:00:00Z', 75)] },                           // outra condição
  { ...base, id: '8', store_id: 'velha', price: 95, events: [ev('2026-10-05T10:00:00Z', 1)] },                                          // ponto antigo de loja desconfiável
  { ...base, id: '9', store_id: 'h', price: null, events: [] },                                                                          // sem preço
];
const reference = { value: 100, status: 'verified', source: 'copag_loja', verified_at: '2026-10-09T00:00:00Z' };
const distrust = new Map([['velha', '2026-10-07']]);
const r = computeProductStats({ product: { condition: 'new' }, offers, reference, distrust, asOf });
const s = r.stats;

// preço atual: só ativas, confirmadas, plausíveis, mesma condição e em estoque → ofertas 1 (100), 2 (90), 8 (95)
assert.equal(s.number_of_in_stock_offers, 3);
assert.equal(s.current_price, 90); assert.equal(s.current_offer_id, '2');
assert.equal(s.lowest_current_price, 90); assert.equal(s.highest_current_price, 100);
assert.equal(s.average_price, 95); assert.equal(s.median_price, 95);
// total só com frete conhecido; frete desconhecido nunca vira 0
assert.equal(s.current_total_price, 110); assert.equal(s.current_total_offer_id, '2');
assert.equal(s.shipping_coverage, 0.3333);
// oferta sem estoque conta como ativa, não como em estoque
assert.equal(s.number_of_active_offers, 4);
assert.equal(s.number_of_stores, 4); assert.equal(s.number_of_marketplaces, 1);
// referência Copag separada do preço de mercado
assert.equal(s.reference_price, 100); assert.equal(s.reference_status, 'verified');
assert.equal(s.discount_vs_reference, 0.1);
// qualidade: cada exclusão contada
assert.deepEqual([s.quality.removed, s.quality.unconfirmed, s.quality.implausible, s.quality.other_condition, s.quality.no_price], [1, 1, 1, 1, 1]);
assert.equal(s.quality.anchor_source, 'reference');

// histórico: série diária reconstruída (estado vale até a próxima mudança)
const byDay = Object.fromEntries(r.series.map((d) => [d.day, d.min]));
assert.equal(byDay['2026-10-05'], 120, 'loja desconfiável (R$ 1) fora; oferta 1 a 120');
assert.equal(byDay['2026-10-06'], 60, 'oferta 4 entra a 60');
assert.equal(byDay['2026-10-07'], 60, 'no dia da saída, o valor do início do dia ainda conta');
assert.equal(byDay['2026-10-08'], 100, 'oferta 4 saiu; oferta 1 caiu para 100');
assert.equal(byDay['2026-10-09'], 90);
assert.equal(byDay['2026-10-10'], 90);
assert.equal(r.series.find((d) => d.day === '2026-10-07').close, 120, 'fechamento do dia 07: oferta 4 já tinha saído');
assert.equal(s.history_days, 6); assert.equal(s.history_status, 'ok'); assert.equal(s.history_from, '2026-10-05');
const lows = [120, 60, 60, 100, 90, 90];
assert.equal(s.historical_min, 60); assert.equal(s.historical_max, 120);
assert.equal(s.historical_average, round2(lows.reduce((a, b) => a + b) / 6)); assert.equal(s.historical_median, 90);
// variações: atual 90 vs melhor preço de D−1 (90) e D−N inexistente
assert.equal(s.variation_24h, 0); assert.equal(s.variation_7d, null, 'sem o dia D−7 → nulo'); assert.equal(s.variation_30d, null);
assert.equal(s.distance_from_historical_min, 0.5); assert.equal(s.distance_from_historical_average, ratio(90, s.historical_average));
// 3 dias antes (07): 60 → variação seria positiva; confere a função de série diretamente
const r3 = computeProductStats({ product: { condition: 'new' }, offers, reference, distrust, asOf: '2026-10-08T23:00:00Z' });
assert.equal(r3.stats.variation_24h, ratio(90, 60), 'D−1 = 07/10 (60); preço atual é sempre o das ofertas de agora (90)');

// referência pendente: exibida, mas sem desconto calculado
const rp = computeProductStats({ product: { condition: 'new' }, offers, reference: { ...reference, status: 'pending' }, distrust, asOf });
assert.equal(rp.stats.reference_status, 'pending'); assert.equal(rp.stats.discount_vs_reference, null);

// histórico insuficiente
const short = computeProductStats({ product: { condition: 'new' }, offers: [{ ...base, id: '1', price: 100, events: [ev('2026-10-09T10:00:00Z', 100)] }], reference: null, distrust: null, asOf });
assert.equal(short.stats.history_days, 2); assert.ok(short.stats.history_days < MIN_HISTORY_DAYS);
assert.equal(short.stats.history_status, 'insufficient');
assert.equal(short.stats.historical_min, null); assert.equal(short.stats.historical_average, null); assert.equal(short.stats.distance_from_historical_min, null);
assert.equal(short.stats.variation_24h, 0, 'variação 24h só precisa do dia anterior');

// sem ofertas / sem estoque
assert.equal(computeProductStats({ product: {}, offers: [], asOf }).stats.data_status, 'no_offers');
const ns = computeProductStats({ product: {}, offers: [{ ...base, id: '1', price: 100, stock_status: 'out_of_stock', events: [] }], asOf }).stats;
assert.equal(ns.data_status, 'no_stock'); assert.equal(ns.current_price, null); assert.equal(ns.number_of_active_offers, 1); assert.equal(ns.shipping_coverage, null);

// idempotência e determinismo: mesma entrada → mesma saída, em qualquer ordem
const again = computeProductStats({ product: { condition: 'new' }, offers: [...offers].reverse().map((o) => ({ ...o, events: [...o.events].reverse() })), reference, distrust, asOf });
assert.deepEqual(again, r);

// afiliado não influencia: campos extras de afiliado são ignorados e nenhum arquivo do motor fala de afiliado
const withAff = computeProductStats({ product: { condition: 'new' }, offers: offers.map((o) => ({ ...o, affiliate_url: 'https://x', affiliate_commission: 0.12 })), reference, distrust, asOf });
assert.deepEqual(withAff, r);
for (const f of ['../src/core/price-engine.js', '../src/core/price-stats.js']) {
  const src = fs.readFileSync(new URL(f, import.meta.url), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.ok(!/affiliate/i.test(src), `${f} não pode usar afiliado`);
}

// série vazia quando não há evento
assert.deepEqual(dailySeries([], { asOf }), []);
console.log('OK — Price Engine (regras)');
