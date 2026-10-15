// Fase 5 — critério de saída "score reproduzível para a mesma entrada e explicável por campos".
// Testes puros (sem banco, sem rede). Complementa opportunity-engine-tests.js (cenários) com uma matriz de entradas:
//  1) mesma entrada → mesma saída (cópias independentes, entrada congelada e não mutada, ordem das ofertas irrelevante);
//  2) a nota é recomposta só a partir dos campos gravados (sinais, pesos, cobertura, travas) e cada sinal ausente,
//     trava aplicada ou referência usada aparece em reasons/warnings;
//  3) Price Engine → Opportunity Engine ponta a ponta não depende da ordem das ofertas nem dos eventos.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { calculateOpportunity, productOpportunity, explain, WEIGHTS, CAPS, OPP_VERSION, bandOf } from '../src/core/opportunity-engine.js';
import { computeProductStats } from '../src/core/price-engine.js';

let n = 0; const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const now = new Date('2026-10-15T12:00:00Z');
const clone = (x) => JSON.parse(JSON.stringify(x));
const deepFreeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); } return o; };
const codes = (a) => (a || []).map((x) => x.code);

// ---------------------------------------------------------------- matriz de entradas (determinística, sem Math.random)
const STATS = [
  { reference_price: 400, reference_status: 'verified', reference_kind: 'COPAG_OFFICIAL_CURRENT', history_status: 'ok', history_days: 20, historical_min: 330, historical_average: 380,
    variation_7d: -0.05, number_of_in_stock_offers: 5, median_price: 390, lowest_current_price: 300, quality: { anchor: 380 } },
  { reference_price: 315, reference_status: 'derived', reference_kind: 'MARKET_CURRENT', history_status: 'short', history_days: 2, number_of_in_stock_offers: 4, median_price: 315,
    lowest_current_price: 300, quality: { anchor: 315, market_reference: { offers: 4, sources: 4, composition: 'MARKET_STORES' } } },
  { reference_price: 315, reference_status: 'derived', reference_kind: 'MARKET_CURRENT', history_status: 'ok', history_days: 9, historical_min: 290, historical_average: 320,
    number_of_in_stock_offers: 3, median_price: 315, lowest_current_price: 305, quality: { market_reference: { offers: 3, sources: 3, composition: 'MARKETPLACE_ONLY' } } },
  { reference_price: null, reference_kind: 'NONE', history_status: 'short', history_days: 1, number_of_in_stock_offers: 2, median_price: 210, lowest_current_price: 200,
    reference_context: { historical: [{ kind: 'COPAG_OFFICIAL_HISTORICAL', price: 199.99, published_at: '2023-08' }], community: [{ price: 219.99 }] } },
  { reference_price: null, reference_kind: 'NONE', history_status: 'short', history_days: 0, number_of_in_stock_offers: 1, median_price: null, lowest_current_price: 99 },
  null,
];
const OFFERS = [];
const PRICES = [150, 199.9, 300, 355, 420, 470, 900];
const SHIP = [{ shipping_status: 'free' }, { shipping_status: 'known', shipping_price: 25 }, { shipping_status: 'known', shipping_price: 80 }, { shipping_status: 'unknown' }];
const STOCK = [{ stock_status: 'in_stock', status: 'active' }, { stock_status: 'preorder', status: 'active' }, { stock_status: 'unknown', status: 'active' },
  { stock_status: 'out_of_stock', status: 'active' }, { stock_status: 'in_stock', status: 'pending' }];
const STORE = [{ ra_status: 'OTIMO' }, { ra_status: 'RUIM' }, { ra_status: null }, { ra_status: 'SEM_INDICE' }];
let k = 0;
for (const price of PRICES) for (const ship of SHIP) for (const st of STOCK) {
  const i = k++;
  OFFERS.push({ id: String(100 + i), price, ...ship, ...st, confirmed: i % 7 !== 3, anomalous: i % 11 === 5, store: STORE[i % STORE.length], seller: { is_official: i % 5 === 0 } });
}
const CASES = []; for (const s of STATS) for (const o of OFFERS) CASES.push([s, o]);

// ---------------------------------------------------------------- recomposição da nota a partir dos campos gravados
const SIG = { reference: 'reference_signal', historical: 'historical_signal', market: 'market_signal', price: 'price_signal', freight: 'freight_signal', reliability: 'reliability_signal' };
function recompose(stats, r) {
  const nStock = Number(stats?.number_of_in_stock_offers) || 0;
  let wSum = 0; let acc = 0;
  for (const [key, field] of Object.entries(SIG)) {
    const s = r[field]; if (s == null) continue;
    const w = key === 'market' && nStock === 2 ? WEIGHTS.market / 2 : WEIGHTS[key];
    wSum += w; acc += w * s;
  }
  const raw = wSum ? (acc / wSum) * 100 : 50; const coverage = wSum / Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
  let score = 50 + (raw - 50) * coverage;
  for (const c of r.caps || []) score = Math.min(score, CAPS[c]);
  return { raw, coverage, score: Math.round(Math.max(0, Math.min(100, score))) };
}
// cada trava registrada em caps tem a explicação correspondente
const CAP_EXPLAINED = { anomaly: ['ANOMALY'], far_above_reference: ['ABOVE_REFERENCE'], above_reference: ['ABOVE_REFERENCE'], too_good: ['TOO_GOOD'], unconfirmed: ['UNCONFIRMED'],
  bad_store: ['BAD_STORE'], pending: ['STALE'], out_of_stock: ['OUT_OF_STOCK'], preorder: ['PREORDER'], stock_unknown: ['UNCERTAIN_STOCK'] };

t('matriz: mesma entrada → mesma saída (cópias independentes, entrada congelada e intacta)', () => {
  assert.ok(CASES.length >= 600, `matriz pequena demais: ${CASES.length}`);
  for (const [s, o] of CASES) {
    const before = JSON.stringify([s, o]);
    const a = calculateOpportunity(clone(s), clone(o), { now });
    const b = calculateOpportunity(deepFreeze(clone(s)), deepFreeze(clone(o)), { now: new Date(now.getTime()) });
    assert.deepEqual(a, b, `oferta ${o.id}`);
    assert.equal(JSON.stringify(a), JSON.stringify(b), 'mesma serialização (inclusive ordem de reasons/warnings/caps)');
    assert.equal(JSON.stringify([s, o]), before, 'a entrada não é alterada');
    assert.equal(explain(a), explain(b));
  }
});

t('reprodução fica atrelada à versão do motor e ao instante informado (sem relógio, sorteio ou ambiente)', () => {
  const r = calculateOpportunity(STATS[0], OFFERS[0], { now });
  assert.equal(r.engine_version, OPP_VERSION); assert.equal(r.calculated_at, now.toISOString());
  // o instante só aparece em calculated_at: a nota e a explicação não mudam com ele
  const later = calculateOpportunity(STATS[0], OFFERS[0], { now: new Date('2027-01-01T00:00:00Z') });
  assert.deepEqual({ ...later, calculated_at: null }, { ...r, calculated_at: null });
  for (const f of ['../src/core/opportunity-engine.js', '../src/core/price-engine.js', '../api/_lib/references.mjs']) {
    const src = fs.readFileSync(new URL(f, import.meta.url), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
    assert.ok(!/Math\.random|Date\.now\(|process\.env|crypto\./.test(src), `${f}: fonte não determinística no motor`);
  }
});

t('matriz: a nota é recomposta só pelos campos gravados (sinais, pesos, cobertura, travas)', () => {
  let exact = 0;
  for (const [s, o] of CASES) {
    const r = calculateOpportunity(s, o, { now });
    if (r.opportunity_score == null) { assert.deepEqual(codes(r.warnings), ['NO_PRICE']); continue; }
    const x = recompose(s, r);
    assert.ok(Math.abs(x.raw - r.raw_score) <= 0.05, `raw ${x.raw} × ${r.raw_score} (oferta ${o.id})`);
    assert.ok(Math.abs(x.coverage - r.coverage) <= 1e-4, `cobertura ${x.coverage} × ${r.coverage}`);
    // sinais arredondados a 4 casas: diferença máxima de 1 ponto só por arredondamento na fronteira de .5
    assert.ok(Math.abs(x.score - r.opportunity_score) <= 1, `nota ${x.score} × ${r.opportunity_score} (oferta ${o.id})`);
    if (x.score === r.opportunity_score) exact++;
    // a trava que limitou é a última de caps e a nota é exatamente o teto dela
    if (r.caps.length) assert.equal(r.opportunity_score, CAPS[r.caps.at(-1)]);
    for (const c of r.caps) assert.ok(CAPS[c] >= r.opportunity_score, `trava ${c} registrada sem limitar`);
    assert.equal(r.opportunity_band, bandOf(r.opportunity_score));
  }
  assert.ok(exact / CASES.length > 0.95, `recomposição exata em só ${exact}/${CASES.length}`);
});

t('matriz: cada sinal ausente, trava e referência usada tem explicação por código', () => {
  for (const [s, o] of CASES) {
    const r = calculateOpportunity(s, o, { now });
    if (r.opportunity_score == null) continue;
    const all = [...codes(r.reasons), ...codes(r.warnings)];
    for (const x of [...r.reasons, ...r.warnings]) assert.ok(typeof x.code === 'string' && x.code && typeof x.text === 'string' && x.text, 'reason/warning sem código ou texto');
    if (r.reference_signal != null) {
      assert.ok(all.some((c) => /^(BELOW|AT|ABOVE)_REFERENCE$/.test(c)), 'referência usada sem razão');
      assert.ok(r.reference_kind !== 'NONE' && r.reference_value > 0 && r.reference_gap != null);
      assert.equal(r.reasons.find((x) => /_REFERENCE$/.test(x.code)).reference_kind, r.reference_kind, 'a razão diz qual referência foi usada');
    } else { assert.ok(all.includes('NO_CURRENT_REFERENCE')); assert.equal(r.reference_kind, 'NONE'); assert.equal(r.reference_value, null); }
    if (r.historical_signal == null) assert.ok(all.includes('SHORT_HISTORY'));
    if (r.freight_signal == null) { assert.ok(all.includes('UNKNOWN_FREIGHT')); assert.equal(r.cost_basis, 'price_only'); assert.equal(r.total_cost, r.price, 'frete desconhecido nunca vira R$ 0 somado'); }
    else assert.equal(r.cost_basis, 'total');
    if (r.market_signal == null && !r.market_signal_absorbed) assert.ok(all.includes('THIN_MARKET'), `mercado ausente sem aviso (oferta ${o.id})`);
    if (r.market_signal_absorbed) assert.equal(r.reference_kind, 'MARKET_CURRENT', 'mercado só é absorvido quando a referência atual é o mercado');
    for (const c of r.caps) assert.ok(CAP_EXPLAINED[c].some((code) => all.includes(code)), `trava ${c} sem explicação`);
    const txt = explain(r);
    assert.ok(txt.startsWith(`${r.opportunity_score} — `));
    if (r.caps.length) assert.match(txt, new RegExp(`limitada a ${CAPS[r.caps.at(-1)]}`));
  }
});

t('productOpportunity: ordem das ofertas não muda a melhor oferta nem a avaliação de cada uma', () => {
  const rot = (a, i) => [...a.slice(i), ...a.slice(0, i)];
  for (const s of STATS) {
    const base = productOpportunity(s, OFFERS, { now });
    const byId = (p) => Object.fromEntries(p.offers.map((x) => [x.offer_id, x]));
    for (const perm of [[...OFFERS].reverse(), rot(OFFERS, 7), rot([...OFFERS].reverse(), 13), [...OFFERS].sort((a, b) => b.price - a.price || a.id.localeCompare(b.id))]) {
      const p = productOpportunity(s, perm, { now });
      assert.deepEqual(p.best, base.best); assert.equal(p.reason, base.reason);
      assert.deepEqual(byId(p), byId(base));
    }
  }
  // empate total (mesmo preço, frete, loja): o desempate final é o id, não a posição na lista
  const twin = (id) => ({ ...OFFERS[0], id, price: 300, shipping_status: 'free', stock_status: 'in_stock', status: 'active', confirmed: true, anomalous: false, store: { ra_status: 'OTIMO' }, seller: {} });
  const ids = ['42', '7', '19'];
  for (const order of [ids, [...ids].reverse(), ['19', '42', '7']]) assert.equal(productOpportunity(STATS[0], order.map(twin), { now }).best.offer_id, '7');
});

t('ponta a ponta: Price Engine → Opportunity Engine não depende da ordem de ofertas e eventos', () => {
  const asOf = new Date('2026-10-15T12:00:00Z');
  const ev = (d, price) => ({ observed_at: `2026-10-${String(d).padStart(2, '0')}T10:00:00Z`, price, stock_status: 'in_stock' });
  const off = (id, store, price, x = {}) => ({ id: String(id), store_id: store, marketplace_id: 'direct', status: 'active', condition: 'new', confirmed: true, price, stock_status: 'in_stock',
    shipping_status: 'unknown', total_price: null, last_seen_at: '2026-10-15T10:00:00Z', events: [ev(1, price + 30), ev(5, price + 10), ev(10, price), ev(14, price)], ...x });
  const offers = [off(1, 'a', 300), off(2, 'b', 310, { shipping_status: 'free', total_price: 310 }), off(3, 'c', 320), off(4, 'd', 330, { stock_status: 'out_of_stock' }), off(5, 'e', 3000)];
  const reference = { value: 349.99, status: 'verified', source: 'copag_loja', kind: 'COPAG_OFFICIAL_CURRENT', confidence: 95, verified_at: '2026-10-14T10:00:00Z' };
  const run = (list) => {
    const { stats } = computeProductStats({ product: { condition: 'new' }, offers: list, reference, distrust: null, asOf });
    return productOpportunity(stats, list.map((o) => ({ ...o, store: { ra_status: 'BOM' }, seller: {} })), { now: asOf });
  };
  const a = run(clone(offers));
  const b = run(clone(offers).reverse().map((o) => ({ ...o, events: [...o.events].reverse() })));
  // offers segue a ordem de entrada (lista); o conteúdo de cada oferta e a melhor são idênticos
  const byId = (p) => Object.fromEntries(p.offers.map((x) => [x.offer_id, x]));
  assert.deepEqual(a.best, b.best); assert.equal(a.reason, b.reason); assert.deepEqual(byId(a), byId(b));
  assert.notEqual(a.best.offer_id, '5', 'R$ 3.000 é anômalo e não vira a melhor'); assert.ok(byId(a)['5'].is_anomaly);
  assert.equal(a.best.reference_kind, 'COPAG_OFFICIAL_CURRENT');
  assert.ok(a.best.opportunity_score != null && a.best.engine_version === OPP_VERSION);
});

console.log(`✓ Determinismo e explicabilidade do score (Fase 5): ${n} grupos, ${CASES.length} combinações`);
