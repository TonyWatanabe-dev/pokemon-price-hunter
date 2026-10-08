// Price Engine — FASE 2. Funções puras e determinísticas (mesma entrada → mesma saída), sem banco, sem IA,
// sem afiliado. Quem chama (price-stats.js) só carrega os dados e grava o resultado.
//
// Definições (todas documentadas aqui e no relatório da fase):
// • Oferta elegível: status 'active', preço > 0, mesma condição do produto, preço confirmado (o robô exige
//   2ª leitura para queda > 3%) e preço plausível (entre 55% e 300% da âncora; mesma regra do isAnomalous do robô).
// • Âncora do preço atual: referência Copag verificada; sem ela, mediana dos preços atuais em estoque (≥ 3 ofertas);
//   sem isso, não filtra (mesma regra do robô: com 1–2 ofertas, uma errada puxaria a mediana).
// • Âncora do histórico: a do preço atual; sem ela, mediana das ofertas atuais em estoque (≥ 1); sem oferta atual,
//   mediana do histórico confiável (≥ 3 pontos). Assim leituras antigas erradas não viram régua de si mesmas.
// • Preço atual: só elegíveis EM ESTOQUE. Frete desconhecido nunca vira R$ 0: o total só existe com frete conhecido.
// • Histórico: o robô grava mudanças (não leituras repetidas). A série diária reconstrói o estado de cada oferta
//   dia a dia (último valor conhecido vale até a próxima mudança, saída da loja ou última leitura).
//   Pontos de lojas em janela de desconfiança (source_distrust) e preços implausíveis não entram.
//   Série = melhor preço em estoque de cada dia (UTC). Estatísticas históricas exigem MIN_HISTORY_DAYS dias.
// • Variação N dias: (preço atual − melhor preço do dia D−N) / melhor preço do dia D−N; sem esse dia, nulo.
import { marketReferenceOf, resolveCurrentReference } from './references.js';
export const ENGINE_VERSION = 'pe-1';
export const MIN_HISTORY_DAYS = 3;
export const PLAUSIBLE_MIN = 0.55;
export const PLAUSIBLE_MAX = 3;
const DAY = 864e5;

export const round2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round((x + Number.EPSILON) * 100) / 100);
export const round4 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round((x + Number.EPSILON) * 1e4) / 1e4);
export const validPrice = (v) => v != null && Number.isFinite(Number(v)) && Number(v) > 0;

export function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; }
export function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
// Dinheiro em centavos inteiros: média/mediana sem erro de ponto flutuante, arredondando meio centavo para cima
// (igual ao round() do PostgreSQL para valores positivos). Ex.: 7678,89 / 6 = 1279,815 → 1279,82.
const cents = (v) => Math.round(Number(v) * 100);
export const moneyMean = (xs) => (xs.length ? Math.round(xs.reduce((a, v) => a + cents(v), 0) / xs.length) / 100 : null);
export const moneyMedian = (xs) => {
  if (!xs.length) return null;
  const s = xs.map(cents).sort((a, b) => a - b); const m = s.length >> 1;
  return (s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)) / 100;
};
export const min = (xs) => (xs.length ? Math.min(...xs) : null);
export const max = (xs) => (xs.length ? Math.max(...xs) : null);
/** (a − b) / b, ou nulo se faltar dado */
export const ratio = (a, b) => (a == null || b == null || !(b > 0) ? null : round4((a - b) / b));

export const dayOf = (t) => new Date(t).toISOString().slice(0, 10);
const dayStart = (d) => Date.parse(d + 'T00:00:00Z');
const addDays = (d, n) => dayOf(dayStart(d) + n * DAY);

export function plausible(price, anchor) {
  if (!validPrice(price)) return false;
  if (anchor == null) return true;
  // limites em centavos: 0,55 × 100 em ponto flutuante dá 55,000000000000007 e recusaria R$ 55,00
  return price >= round2(anchor * PLAUSIBLE_MIN) && price <= round2(anchor * PLAUSIBLE_MAX);
}

/** Ponto confiável? (loja fora da janela de desconfiança). distrust: Map store_id → 'YYYY-MM-DD' (inclusive). */
export const trusted = (distrust, storeId, t) => !distrust?.has(storeId) || dayOf(t) > distrust.get(storeId);

/**
 * Reconstrói a série diária (UTC) do melhor preço em estoque.
 * offers: [{ id, store_id, status, last_seen_at, events: [{ t, price, stock_status, removed? }] }] (eventos de qualquer ordem)
 * Retorna [{ day, min, max, avg, close, offers }] em ordem de dia.
 */
export function dailySeries(offers, { asOf, anchor = null, distrust = null } = {}) {
  const asOfMs = new Date(asOf).getTime(); const lastDay = dayOf(asOfMs);
  const perOffer = [];
  let firstDay = null;
  for (const o of offers) {
    const ev = (o.events || []).filter((e) => new Date(e.t).getTime() <= asOfMs).sort((a, b) => new Date(a.t) - new Date(b.t));
    if (!ev.length) continue;
    // estado após cada evento: preço válido em estoque, ou nada
    const states = ev.map((e) => {
      const t = new Date(e.t).getTime();
      const ok = !e.removed && e.stock_status === 'in_stock' && trusted(distrust, o.store_id, t) && plausible(Number(e.price), anchor);
      return { t, price: ok ? Number(e.price) : null };
    });
    // até quando o último estado vale: oferta ativa → agora; senão → última leitura conhecida
    const lastT = states[states.length - 1].t;
    const end = o.status === 'active' ? asOfMs : Math.max(lastT, o.last_seen_at ? new Date(o.last_seen_at).getTime() : lastT);
    perOffer.push({ states, end });
    const d0 = dayOf(states[0].t); if (!firstDay || d0 < firstDay) firstDay = d0;
  }
  if (!firstDay) return [];
  const out = [];
  for (let d = firstDay; d <= lastDay; d = addDays(d, 1)) {
    const s = dayStart(d); const e = d === lastDay ? asOfMs : s + DAY - 1;
    const lows = []; const highs = []; const closes = [];
    for (const { states, end } of perOffer) {
      if (states[0].t > e || end < s) continue;              // oferta ainda não existia / já tinha saído
      let carry = null; const vals = [];
      for (const st of states) { if (st.t < s) carry = st; else if (st.t <= e && st.t <= end) vals.push(st); }
      if (carry && carry.price != null) vals.unshift(carry);  // valor herdado do dia anterior
      const prices = vals.map((v) => v.price).filter((p) => p != null);
      if (prices.length) { lows.push(Math.min(...prices)); highs.push(Math.max(...prices)); }
      // fechamento: estado vigente no fim do dia (se a oferta ainda estiver valendo)
      if (end >= e) {
        const last = [...states].reverse().find((st) => st.t <= e);
        if (last && last.price != null) closes.push(last.price);
      }
    }
    if (lows.length) out.push({ day: d, min: round2(Math.min(...lows)), max: round2(Math.max(...highs)), avg: moneyMean(lows), close: closes.length ? round2(Math.min(...closes)) : null, offers: lows.length });
  }
  return out;
}

/** Âncora de plausibilidade (ver cabeçalho). */
export function anchorOf({ reference, currentInStock = [] }) {
  if (reference?.status === 'verified' && validPrice(reference.value)) return Number(reference.value);
  if (currentInStock.length >= 3) return median(currentInStock);
  return null;
}
export function historyAnchorOf({ reference, currentInStock = [], historyPrices = [] }) {
  const a = anchorOf({ reference, currentInStock }); if (a != null) return a;
  if (currentInStock.length >= 1) return median(currentInStock);
  if (historyPrices.length >= 3) return median(historyPrices);
  return null;
}

/**
 * Estatísticas de um produto.
 * input: { product: { condition }, offers: [...com events], reference: { value, status, source, verified_at, kind, confidence } | null, distrust: Map, asOf }
 *   reference = Copag oficial ATUAL verificada (ou null). Histórico e comunitária não são entrada do motor.
 *   Fase 6A: a REFERÊNCIA ATUAL gravada é resolvida aqui — Copag atual > mercado atual robusto (mediana das ofertas elegíveis
 *   em estoque, ver marketReferenceOf) > NONE. O desconto (discount_vs_reference) é contra essa referência.
 * offers[i]: { id, store_id, marketplace_id, status, condition, confirmed, price, stock_status, shipping_status, total_price, last_seen_at, events }
 */
export function computeProductStats({ product, offers, reference = null, distrust = null, asOf }) {
  // defesa: preço de lançamento (histórico) ou referência comunitária nunca entram como referência atual, mesmo se alguém as passar
  if (reference && (reference.kind ?? 'COPAG_OFFICIAL_CURRENT') !== 'COPAG_OFFICIAL_CURRENT') reference = null;
  const q = { removed: 0, pending: 0, no_price: 0, other_condition: 0, unconfirmed: 0, implausible: 0, untrusted_points: 0, implausible_points: 0 };
  const sameCond = offers.filter((o) => { const ok = (o.condition || 'new') === (product.condition || 'new'); if (!ok) q.other_condition++; return ok; });
  const live = sameCond.filter((o) => {
    if (o.status === 'removed') { q.removed++; return false; }
    if (o.status !== 'active') { q.pending++; return false; }
    if (!validPrice(o.price)) { q.no_price++; return false; }
    if (o.confirmed === false) { q.unconfirmed++; return false; }
    return true;
  });
  // âncora: referência verificada > mediana atual em estoque (≥3) > mediana do histórico confiável (≥3)
  const histPrices = [];
  for (const o of sameCond) for (const e of o.events || []) {
    if (e.removed || e.stock_status !== 'in_stock' || !validPrice(e.price)) continue;
    if (!trusted(distrust, o.store_id, e.t)) { q.untrusted_points++; continue; }
    histPrices.push(Number(e.price));
  }
  const curIn = live.filter((o) => o.stock_status === 'in_stock').map((o) => Number(o.price));
  const anchor = anchorOf({ reference, currentInStock: curIn });
  const hAnchor = historyAnchorOf({ reference, currentInStock: curIn, historyPrices: histPrices });
  const elig = live.filter((o) => { const ok = plausible(Number(o.price), anchor); if (!ok) q.implausible++; return ok; });
  q.implausible_points = histPrices.filter((p) => !plausible(p, hAnchor)).length;
  const inStock = elig.filter((o) => o.stock_status === 'in_stock');
  const prices = inStock.map((o) => Number(o.price));
  const best = inStock.reduce((a, o) => (!a || Number(o.price) < Number(a.price) || (Number(o.price) === Number(a.price) && Number(o.id) < Number(a.id)) ? o : a), null);
  const withTotal = inStock.filter((o) => o.shipping_status !== 'unknown' && validPrice(o.total_price));
  const bestTotal = withTotal.reduce((a, o) => (!a || Number(o.total_price) < Number(a.total_price) || (Number(o.total_price) === Number(a.total_price) && Number(o.id) < Number(a.id)) ? o : a), null);

  // série diária (inclui a leitura atual de cada oferta ativa como último ponto conhecido)
  const seriesOffers = sameCond.map((o) => {
    const ev = [...(o.events || [])];
    if (o.status === 'active' && o.confirmed !== false && o.last_seen_at && validPrice(o.price)) ev.push({ t: o.last_seen_at, price: Number(o.price), stock_status: o.stock_status });
    return { id: o.id, store_id: o.store_id, status: o.status, last_seen_at: o.last_seen_at, events: ev };
  });
  const series = dailySeries(seriesOffers, { asOf, anchor: hAnchor, distrust });
  // a mesma série, loja por loja (gráfico do site: uma linha por loja + a do melhor preço)
  const storeSeries = {};
  for (const sid of [...new Set(seriesOffers.map((o) => o.store_id).filter(Boolean))].sort()) {
    const ss = dailySeries(seriesOffers.filter((o) => o.store_id === sid), { asOf, anchor: hAnchor, distrust });
    if (ss.length) storeSeries[sid] = ss;
  }
  const lows = series.map((d) => d.min);
  const enough = series.length >= MIN_HISTORY_DAYS;
  const today = dayOf(asOf);
  const at = (n) => series.find((d) => d.day === addDays(today, -n))?.min ?? null;
  const current = best ? round2(Number(best.price)) : null;
  const hist = enough ? { min: round2(min(lows)), max: round2(max(lows)), avg: moneyMean(lows), med: moneyMedian(lows) } : { min: null, max: null, avg: null, med: null };
  const refOk = reference?.status === 'verified' && validPrice(reference.value);
  // referência ATUAL (Copag atual > mercado robusto > NONE); mercado só com ofertas elegíveis em estoque de lojas confiáveis
  const implausibleInStock = live.filter((o) => o.stock_status === 'in_stock').length - inStock.length;
  const market = marketReferenceOf(inStock, { implausibleInStock, isTrusted: (o) => trusted(distrust, o.store_id, asOf) });
  const cur = resolveCurrentReference({ copag: refOk ? { reference_kind: 'COPAG_OFFICIAL_CURRENT', verification_status: 'verified', value: reference.value,
    source: reference.source, confidence: reference.confidence ?? null, verified_at: reference.verified_at } : null, market });

  return {
    stats: {
      as_of_day: today,
      data_status: !elig.length ? 'no_offers' : inStock.length ? 'ok' : 'no_stock',
      current_price: current,
      current_offer_id: best ? best.id : null,
      current_total_price: bestTotal ? round2(Number(bestTotal.total_price)) : null,
      current_total_offer_id: bestTotal ? bestTotal.id : null,
      lowest_current_price: round2(min(prices)),
      highest_current_price: round2(max(prices)),
      average_price: moneyMean(prices),
      median_price: moneyMedian(prices),
      history_days: series.length,
      history_from: series[0]?.day ?? null,
      history_status: enough ? 'ok' : 'insufficient',
      historical_min: hist.min, historical_max: hist.max, historical_average: hist.avg, historical_median: hist.med,
      variation_24h: ratio(current, at(1)),
      variation_7d: ratio(current, at(7)),
      variation_30d: ratio(current, at(30)),
      distance_from_historical_average: ratio(current, hist.avg),
      distance_from_historical_min: ratio(current, hist.min),
      // referência ATUAL resolvida (única fonte de verdade para o Opportunity Engine e a API)
      reference_kind: cur.kind,                                   // COPAG_OFFICIAL_CURRENT | MARKET_CURRENT | NONE
      reference_price: cur.price,
      reference_status: cur.kind === 'COPAG_OFFICIAL_CURRENT' ? 'verified' : cur.kind === 'MARKET_CURRENT' ? 'derived' : null,
      reference_source: cur.source,
      reference_verified_at: cur.verified_at,
      reference_confidence: cur.confidence != null ? round4(cur.confidence) : null,
      reference_reason: cur.reason,
      discount_vs_reference: cur.price != null && current != null ? round4((cur.price - current) / cur.price) : null,
      number_of_active_offers: elig.length,
      number_of_in_stock_offers: inStock.length,
      number_of_stores: new Set(elig.map((o) => o.store_id).filter(Boolean)).size,
      number_of_marketplaces: new Set(elig.map((o) => o.marketplace_id).filter(Boolean)).size,
      shipping_coverage: inStock.length ? round4(withTotal.length / inStock.length) : null,
      quality: { ...q, anchor: round2(anchor), anchor_source: refOk ? 'reference' : anchor == null ? null : 'current_median',
        market_reference: { ok: market.ok, reason: market.reason, offers: market.offers, stores: market.stores, marketplaces: market.marketplaces,
          untrusted: market.untrusted, implausible: market.implausible, price: market.ok ? market.price : null },
        history_anchor: round2(hAnchor), history_anchor_source: hAnchor == null ? null : hAnchor === anchor ? (refOk ? 'reference' : 'current_median') : curIn.length ? 'current_median_small' : 'history_median' },
      engine_version: ENGINE_VERSION,
    },
    series,
    storeSeries,
  };
}
