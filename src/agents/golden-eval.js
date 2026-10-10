// Avaliação offline com casos dourados SINTÉTICOS (test/golden/cases.json): matching, preço, frete e estoque.
// Determinística, sem rede, sem banco e sem IA. Só lê os módulos de produção; não escreve nada.
// Os números daqui medem regressão contra casos escritos à mão, nunca desempenho em produção.
import { matchProduct } from '../match.js';
import { calculateOpportunity } from '../core/opportunity-engine.js';
import { reviewCandidates } from './matching-review.js';

export const NOW = new Date('2026-10-08T12:00:00Z');
// Quando pedir revisão humana (política da avaliação): oportunidade com sinal de dado suspeito ou não confirmado.
export const REVIEW_WARNING_CODES = ['ANOMALY', 'TOO_GOOD', 'UNCONFIRMED'];

// Produto com Copag verificada (R$ 400), histórico ok e mercado de 5 ofertas, loja ótima, frete grátis, em estoque.
const baseStats = () => ({ reference_price: 400, reference_status: 'verified', reference_kind: 'COPAG_OFFICIAL_CURRENT', history_status: 'ok', history_days: 20,
  historical_min: 330, historical_average: 380, variation_7d: -0.05, variation_30d: null, number_of_in_stock_offers: 5, median_price: 390, lowest_current_price: 300, quality: { anchor: 380 } });
const baseOffer = () => ({ id: 'golden', price: 300, total_price: 300, shipping_status: 'free', shipping_price: 0, stock_status: 'in_stock', status: 'active', confirmed: true,
  anomalous: false, store: { ra_status: 'OTIMO' }, seller: { is_official: false } });

export function evalMatching(c, catalog) {
  const { listing } = c;
  const m = matchProduct(listing, catalog);
  const got = m.productId ?? null;
  const state = got
    ? { offers: [{ id: c.id, storeId: listing.store, url: listing.url, title: listing.title, productId: got, matchConfidence: m.confidence }], unmatched: [] }
    : { offers: [], unmatched: [{ store: listing.store, url: listing.url, title: listing.title, why: m.why }] };
  const review = reviewCandidates(state, { catalog })[0]?.payload.proposal.kind ?? null;
  const want = c.expect.productId ?? null;
  const failures = [];
  // falso positivo = casou o que não devia (ou o produto errado); falso negativo = deixou de casar o que devia
  if (want == null && got != null) failures.push({ kind: 'falso_positivo', expected: want, got });
  else if (want != null && got == null) failures.push({ kind: 'falso_negativo', expected: want, got });
  else if (want != null && got !== want) failures.push({ kind: 'produto_errado', expected: want, got });
  if (review !== (c.expect.review ?? null)) failures.push({ kind: 'revisao', expected: c.expect.review ?? null, got: review });
  return { id: c.id, area: 'matching', want, got, review, failures };
}

export function evalOpportunity(c) {
  const r = calculateOpportunity({ ...baseStats(), ...(c.stats || {}) }, { ...baseOffer(), ...(c.offer || {}) }, { now: NOW });
  const e = c.expect;
  const codes = (a) => (a || []).map((x) => x.code);
  const warnings = codes(r.warnings); const reasons = codes(r.reasons); const caps = r.caps || [];
  const review = warnings.some((w) => REVIEW_WARNING_CODES.includes(w));
  const failures = [];
  const bad = (kind, expected, got) => failures.push({ kind, expected, got });
  if (e.minScore != null && !(r.opportunity_score >= e.minScore)) bad('score_abaixo_do_minimo', e.minScore, r.opportunity_score);
  if (e.maxScore != null && !(r.opportunity_score <= e.maxScore)) bad('score_acima_do_maximo', e.maxScore, r.opportunity_score);
  for (const k of e.caps || []) if (!caps.includes(k)) bad('trava_ausente', k, caps);
  for (const k of e.notCaps || []) if (caps.includes(k)) bad('trava_indevida', `sem ${k}`, caps);
  for (const k of e.warnings || []) if (!warnings.includes(k)) bad('aviso_ausente', k, warnings);
  for (const k of e.notWarnings || []) if (warnings.includes(k)) bad('aviso_indevido', `sem ${k}`, warnings);
  for (const k of e.reasons || []) if (!reasons.includes(k)) bad('motivo_ausente', k, reasons);
  if ('freightSignal' in e) {
    const f = r.freight_signal; const want = e.freightSignal;
    const ok = want === null ? f === null : f !== null && f >= want[0] && f <= want[1];
    if (!ok) bad('sinal_de_frete', want, f);
  }
  if (e.review !== undefined && review !== e.review) bad('revisao', e.review, review);
  return { id: c.id, area: c.area, score: r.opportunity_score, review, failures };
}

/** Roda todos os casos. `failures` é o registro de regressões (vazio = nenhuma). */
export function runGolden(file) {
  const results = [
    ...file.matching.map((c) => evalMatching(c, file.catalog)),
    ...file.opportunity.map((c) => evalOpportunity(c)),
  ];
  const failures = results.flatMap((r) => r.failures.map((f) => ({ id: r.id, area: r.area, ...f })));
  const count = (kind) => failures.filter((f) => f.kind === kind).length;
  const m = results.filter((r) => r.area === 'matching');
  return {
    synthetic: true,
    total: results.length,
    passed: results.filter((r) => !r.failures.length).length,
    byArea: Object.fromEntries([...new Set(results.map((r) => r.area))].map((a) => [a, results.filter((r) => r.area === a).length])),
    matching: { cases: m.length, falsePositives: count('falso_positivo') + count('produto_errado'), falseNegatives: count('falso_negativo'), reviewMismatches: failures.filter((f) => f.kind === 'revisao' && f.area === 'matching').length },
    failures,
  };
}
