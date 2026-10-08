// Opportunity Engine — opportunity-v2 (v1 + referência atual, Fase 6A). Funções puras e determinísticas (mesmos dados → mesmo resultado).
// Não calcula fatos de preço: lê product_stats (Price Engine) e o contexto da oferta, e INTERPRETA.
// Pergunta que o score responde: "quão interessante é comprar esta oferta AGORA?" — não "quão barato é".
//
// Modelo (documentado no relatório da fase 5):
// 1) Sinais de 0 a 1, cada um NULO quando falta dado confiável (nunca inventado):
//    reference  — desconto contra a REFERÊNCIA ATUAL (Copag atual verificada; sem ela, mercado robusto) peso 0,30
//    historical — posição do preço entre a mínima e a média históricas (≥ 3 dias de série)    peso 0,20
//    market     — distância da mediana das ofertas com estoque agora (≥ 2 ofertas; 2 = meio peso) 0,20
//    price      — distância do menor preço com estoque agora (≥ 2 ofertas)                    peso 0,10
//    freight    — frete conhecido e seu peso no preço (desconhecido = nulo, nunca R$ 0)         peso 0,10
//    reliability— reputação pública da loja (Reclame Aqui) e vendedor oficial                 peso 0,10
//    stock      — estoque; não entra na média: é trava (sem estoque não é oportunidade de compra)
// 2) Média ponderada dos sinais disponíveis (bruto, 0–100).
// 3) Encolhimento pela evidência: score = 50 + (bruto − 50) × cobertura, cobertura = pesos disponíveis / pesos totais.
//    Pouca evidência puxa para "Normal": sem Copag e sem histórico, a oferta não chega a "Excelente".
// 4) Travas: sem estoque ≤ 30; pré-venda ≤ 60; estoque incerto ≤ 70; oferta parada (pendente) ≤ 40;
//    preço implausível/anômalo ≤ 49; ≥ 15% acima da referência atual ≤ 49; acima da referência atual ≤ 74;
//    queda não confirmada ≤ 74; loja mal avaliada ≤ 74; desconto > 40% ≤ 89.
// 5) Confiança separada do score (0–1): cobertura × fatores de incerteza (histórico curto, frete, poucas lojas...).
import { plausible, round2, round4 } from './price-engine.js';
import { CURRENT_KINDS } from './references.js';

// v2 (Fase 6A): mesma fórmula, pesos, travas, faixas e confiança da v1; o sinal de 30% passou de "Copag" para REFERÊNCIA ATUAL
// (Copag oficial atual > mercado atual robusto > nenhuma). Histórico e comunitária só geram aviso/contexto.
// v2.1 (Fase 6A.1): quando a referência atual É o mercado (MARKET_CURRENT), o sinal de mercado (mediana) é a MESMA evidência
// e não conta de novo — fica indisponível (absorvido pela referência) e a cobertura cai como para qualquer sinal ausente.
// Com Copag atual, referência e mercado continuam independentes (30% + 20%). Fórmula, pesos, travas, faixas e confiança: iguais.
export const OPP_VERSION = 'opportunity-v2.1';
export const WEIGHTS = { reference: 0.30, historical: 0.20, market: 0.20, price: 0.10, freight: 0.10, reliability: 0.10 };
const W_TOTAL = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
export const BANDS = [[90, 'excelente'], [75, 'boa'], [50, 'normal'], [0, 'baixa']];
export const BAND_LABEL = { excelente: 'Excelente', boa: 'Boa', normal: 'Normal', baixa: 'Baixa' };
export const bandOf = (score) => (score == null ? null : BANDS.find(([min]) => score >= min)[1]);
export const CAPS = { out_of_stock: 30, pending: 40, anomaly: 49, far_above_reference: 49, preorder: 60, stock_unknown: 70, unconfirmed: 74, bad_store: 74, above_reference: 74, too_good: 89 };
const RA = { OTIMO: 1, BOM: 0.85, REGULAR: 0.55, SEM_INDICE: 0.6, NAO_ENCONTRADA: 0.5, RUIM: 0.2, NAO_RECOMENDADA: 0 };
const STOCK = { in_stock: 1, preorder: 0.4, unknown: 0.3, out_of_stock: 0 };

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
/** interpolação linear por pontos [[x, y], ...] (x crescente), presa nas pontas */
export function pw(x, pts) {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0); }
  return pts[pts.length - 1][1];
}
const pct = (x) => `${(Math.abs(x) * 100).toFixed(1).replace('.', ',')}%`;
const brl = (v) => 'R$ ' + Number(v).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/**
 * Oportunidade de UMA oferta.
 * stats: linha de product_stats (números ou strings numéricas; nulos quando o Price Engine não teve dado).
 * offer: { id, price, total_price, shipping_status, shipping_price, stock_status, status, confirmed, anomalous,
 *          store: { ra_status }, seller: { is_official } }
 */
export function calculateOpportunity(stats, offer, { now = new Date() } = {}) {
  const reasons = []; const warnings = [];
  const r = (code, text, impact = '+') => reasons.push({ code, text, impact });
  const w = (code, text) => warnings.push({ code, text });
  const price = num(offer.price);
  const base = { offer_id: offer.id, engine_version: OPP_VERSION, calculated_at: new Date(now).toISOString() };
  if (!(price > 0)) {
    return { ...base, opportunity_score: null, opportunity_band: null, confidence: 0, reasons, warnings: [{ code: 'NO_PRICE', text: 'Oferta sem preço válido' }],
      price_signal: null, historical_signal: null, reference_signal: null, stock_signal: null, freight_signal: null, market_signal: null, reliability_signal: null, is_anomaly: false };
  }
  const st = stats || {};
  // referência ATUAL (resolvida pelo Price Engine em product_stats): Copag oficial atual > mercado atual robusto > NONE
  const ref = num(st.reference_price); const refKind = st.reference_kind ?? null;
  const refOk = CURRENT_KINDS.includes(refKind) && ref > 0 && (refKind === 'MARKET_CURRENT' || st.reference_status === 'verified');
  const nStock = num(st.number_of_in_stock_offers) || 0;
  const median = num(st.median_price); const lowest = num(st.lowest_current_price);
  const hMin = num(st.historical_min); const hAvg = num(st.historical_average); const histOk = st.history_status === 'ok' && hMin > 0 && hAvg > 0;
  const anchor = num(st.quality?.anchor);

  // --- referência atual
  let reference = null; let discount = null;
  if (refOk) {
    const copag = refKind === 'COPAG_OFFICIAL_CURRENT';
    const mr = st.quality?.market_reference || {};
    const mk = !copag && mr.offers ? `mediana de ${mr.offers} ofertas${mr.sources ? ` de ${mr.sources} fontes independentes` : ''}, ` : '';
    const of = copag ? 'do preço sugerido Copag' : 'da referência de mercado'; const at = copag ? 'no preço sugerido Copag' : 'na referência de mercado';
    discount = (ref - price) / ref;
    reference = pw(discount, [[-0.15, 0], [0, 0.35], [0.10, 0.6], [0.20, 0.85], [0.30, 1]]);
    const rr = (code, text, impact) => reasons.push({ code, text, impact, reference_kind: refKind });
    if (discount >= 0.005) rr('BELOW_REFERENCE', `${pct(discount)} abaixo ${of} (${mk}${brl(ref)})`, '+');
    else if (discount <= -0.005) rr('ABOVE_REFERENCE', `${pct(discount)} acima ${of} (${mk}${brl(ref)})`, '-');
    else rr('AT_REFERENCE', `${at} (${mk}${brl(ref)})`, '=');
  } else w('NO_CURRENT_REFERENCE', 'Não há referência atual suficiente: desconto não considerado');
  // contexto (nunca entra no score): preço de lançamento e referência comunitária
  const ctx = st.reference_context || {}; const histCtx = ctx.historical || []; const commCtx = ctx.community || [];
  if (!refOk && histCtx.length) { const h = histCtx[0];
    w('HISTORICAL_REFERENCE_ONLY', `Existe apenas referência histórica: ${h.kind === 'MARKET_HISTORICAL' ? 'histórico de mercado' : 'preço sugerido de lançamento'} de ${brl(h.price)}${h.published_at ? ` (${h.published_at})` : ''}, que não é usado como referência atual`); }
  if (commCtx.length) { const c = commCtx[0]; const d = (price - c.price) / c.price;
    w(!refOk && !histCtx.length ? 'COMMUNITY_REFERENCE_ONLY' : 'COMMUNITY_REFERENCE',
      `Existe uma referência comunitária de ${brl(c.price)} (não é preço oficial Copag nem referência atual e não entra no score)${Math.abs(d) >= 0.005 ? `; esta oferta está ${pct(d)} ${d > 0 ? 'acima' : 'abaixo'} dela` : ''}`); }

  // --- histórico (só com série suficiente; tendências só quando o Price Engine as calculou)
  let historical = null;
  if (histOk) {
    if (price <= hMin) historical = 1;
    else if (price <= hAvg) historical = hAvg > hMin ? 1 - 0.5 * ((price - hMin) / (hAvg - hMin)) : 0.5;
    else historical = pw((price - hAvg) / hAvg, [[0, 0.5], [0.15, 0]]);
    if (price <= hMin) r('AT_HISTORICAL_MIN', `no menor preço já registrado (${brl(hMin)})`);
    else if (price <= hMin * 1.03) r('NEAR_HISTORICAL_MIN', `próximo da mínima histórica (${brl(hMin)})`);
    else if (price < hAvg) r('BELOW_HISTORICAL_AVG', `${pct((hAvg - price) / hAvg)} abaixo da média histórica`);
    else r('ABOVE_HISTORICAL_AVG', `${pct((price - hAvg) / hAvg)} acima da média histórica`, '-');
    for (const [k, d] of [['variation_7d', '7 dias'], ['variation_30d', '30 dias']]) {
      const v = num(st[k]); if (v != null && Math.abs(v) >= 0.03) r(v < 0 ? 'PRICE_FALLING' : 'PRICE_RISING', `melhor preço ${v < 0 ? 'caiu' : 'subiu'} ${pct(v)} em ${d}`, v < 0 ? '+' : '-');
    }
  } else w('SHORT_HISTORY', `Histórico ainda insuficiente para uma comparação confiável (${num(st.history_days) || 0} ${num(st.history_days) === 1 ? 'dia' : 'dias'})`);

  // --- mercado agora (só com ≥ 2 ofertas em estoque; 2 = meio peso)
  // dependência explícita: se a referência atual É o mercado, a mediana já entrou pelo sinal de referência → não conta de novo
  const marketAbsorbed = refOk && refKind === 'MARKET_CURRENT';
  let market = null; let marketWeight = WEIGHTS.market; let priceSig = null;
  if (marketAbsorbed) { /* evidência única: o sinal de mercado fica indisponível e a cobertura normaliza o resto */ }
  else if (nStock >= 2 && median > 0) {
    market = pw((median - price) / median, [[-0.2, 0], [0, 0.5], [0.2, 1]]);
    if (nStock === 2) marketWeight = WEIGHTS.market / 2;
    const m = (median - price) / median;
    if (m >= 0.03) r('BELOW_MARKET', `${pct(m)} abaixo da mediana de ${nStock} ofertas com estoque`);
    else if (m <= -0.03) r('ABOVE_MARKET', `${pct(m)} acima da mediana de ${nStock} ofertas com estoque`, '-');
  } else w('THIN_MARKET', nStock === 1 ? 'Só uma oferta com estoque: sem comparação de mercado' : 'Sem outras ofertas com estoque para comparar');
  if (nStock >= 2 && lowest > 0) {
    priceSig = pw((price - lowest) / lowest, [[0, 1], [0.10, 0.5], [0.25, 0]]);
    if (price <= lowest) r('LOWEST_NOW', `menor preço entre ${nStock} ofertas com estoque`);
  }

  // --- frete (desconhecido = nulo; nunca R$ 0)
  let freight = null;
  if (offer.shipping_status === 'free') { freight = 1; r('FREE_SHIPPING', 'frete grátis'); }
  else if (offer.shipping_status === 'known') {
    const ship = num(offer.shipping_price) ?? (num(offer.total_price) != null ? num(offer.total_price) - price : null);
    if (ship != null && ship >= 0) {
      const share = ship / price; freight = pw(share, [[0, 1], [0.05, 0.8], [0.15, 0.4], [0.30, 0]]);
      if (share > 0.15) r('HEAVY_SHIPPING', `frete de ${brl(ship)} (${pct(share)} do preço)`, '-'); else r('KNOWN_SHIPPING', `frete conhecido (${brl(ship)})`, '=');
    }
  }
  if (freight == null) w('UNKNOWN_FREIGHT', 'Frete não confirmado');

  // --- confiabilidade da loja / vendedor (sempre presente: loja desconhecida = neutro)
  const ra = offer.store?.ra_status || null;
  let reliability = ra && ra in RA ? RA[ra] : 0.5;
  if (offer.seller?.is_official) reliability = Math.min(1, reliability + 0.1);
  if (ra === 'OTIMO' || ra === 'BOM') r('TRUSTED_STORE', `loja com reputação ${ra === 'OTIMO' ? 'ótima' : 'boa'} no Reclame Aqui`);
  if (ra === 'RUIM' || ra === 'NAO_RECOMENDADA') w('BAD_STORE', 'Loja mal avaliada no Reclame Aqui');

  // --- estoque (trava, não média)
  const stockSig = offer.status === 'pending' ? Math.min(0.2, STOCK[offer.stock_status] ?? 0.3) : (STOCK[offer.stock_status] ?? 0.3);
  if (offer.stock_status === 'in_stock' && offer.status !== 'pending') r('IN_STOCK', 'estoque confirmado');

  // --- combinação
  const sig = { reference, historical, market, price: priceSig, freight, reliability };
  let wSum = 0; let acc = 0;
  for (const [k, s] of Object.entries(sig)) { if (s == null) continue; const wk = k === 'market' ? marketWeight : WEIGHTS[k]; wSum += wk; acc += wk * s; }
  const raw = wSum ? (acc / wSum) * 100 : 50;
  const coverage = wSum / W_TOTAL;
  let score = 50 + (raw - 50) * coverage;

  // --- travas e riscos
  const caps = [];
  const cap = (c, code) => { if (score > c) { score = c; } caps.push(code); };
  const implausible = anchor != null && !plausible(price, anchor);
  const isAnomaly = !!offer.anomalous || implausible;
  if (isAnomaly) { cap(CAPS.anomaly, 'anomaly'); w('ANOMALY', implausible ? `Preço fora do esperado para o produto (régua ${brl(anchor)}): conferir antes de comprar` : 'Preço marcado como anômalo pelo robô: conferir antes de comprar'); }
  // pagar acima da referência atual nunca é "Boa"; ≥ 15% acima é preço ruim
  if (refOk && discount <= -0.15) cap(CAPS.far_above_reference, 'far_above_reference');
  else if (refOk && discount <= -0.005) cap(CAPS.above_reference, 'above_reference');
  if (refOk && discount > 0.40 && !isAnomaly) { cap(CAPS.too_good, 'too_good'); w('TOO_GOOD', `Desconto de ${pct(discount)} sobre a referência atual é fora do comum: conferir o anúncio`); }
  if (offer.confirmed === false) { cap(CAPS.unconfirmed, 'unconfirmed'); w('UNCONFIRMED', 'Queda de preço aguardando 2ª leitura'); }
  if (ra === 'RUIM' || ra === 'NAO_RECOMENDADA') cap(CAPS.bad_store, 'bad_store');
  if (offer.status === 'pending') { cap(CAPS.pending, 'pending'); w('STALE', 'Loja não lida recentemente: oferta pode ter mudado'); }
  if (offer.stock_status === 'out_of_stock') { cap(CAPS.out_of_stock, 'out_of_stock'); w('OUT_OF_STOCK', 'Sem estoque agora'); }
  else if (offer.stock_status === 'preorder') { cap(CAPS.preorder, 'preorder'); w('PREORDER', 'Pré-venda: entrega futura'); }
  else if (offer.stock_status !== 'in_stock') { cap(CAPS.stock_unknown, 'stock_unknown'); w('UNCERTAIN_STOCK', 'Estoque não confirmado'); }
  score = Math.round(clamp(score, 0, 100));

  // --- confiança (separada do score)
  let conf = coverage;
  if (!histOk) conf *= 0.85;
  if (freight == null) conf *= 0.9;
  if (nStock < 3) conf *= 0.85;
  if (offer.confirmed === false) conf *= 0.6;
  if (isAnomaly) conf *= 0.4;
  if (!ra || ra === 'NAO_ENCONTRADA' || ra === 'SEM_INDICE') conf *= 0.95;
  const confidence = round2(clamp(conf));

  return {
    ...base, opportunity_score: score, opportunity_band: bandOf(score), confidence,
    reasons, warnings, caps,
    price_signal: round4(priceSig), historical_signal: round4(historical), reference_signal: round4(reference),
    stock_signal: round4(stockSig), freight_signal: round4(freight), market_signal: round4(market), reliability_signal: round4(reliability),
    is_anomaly: isAnomaly, price, raw_score: round2(raw), coverage: round4(coverage), market_signal_absorbed: marketAbsorbed,
  };
}

export const confidenceLevel = (c) => (c == null ? null : c >= 0.75 ? 'alta' : c >= 0.5 ? 'média' : 'baixa');

/** Melhor oportunidade COMPRÁVEL do produto (com estoque, sem anomalia). Empate: score, confiança, menor preço, id. */
const cmpId = (a, b) => { const x = Number(a), y = Number(b); return Number.isFinite(x) && Number.isFinite(y) ? x - y : String(a).localeCompare(String(b)); };
export const oppOrder = (a, b) => (b.opportunity_score ?? -1) - (a.opportunity_score ?? -1) || (b.confidence ?? 0) - (a.confidence ?? 0) || (a.price ?? 1e12) - (b.price ?? 1e12) || cmpId(a.offer_id, b.offer_id);
export function productOpportunity(stats, offers, opts) {
  const all = (offers || []).map((o) => calculateOpportunity(stats, o, opts));
  const buyable = all.filter((x) => x.opportunity_score != null && x.stock_signal === 1 && !x.is_anomaly).sort(oppOrder);
  return { best: buyable[0] || null, offers: all, reason: !all.length ? 'NO_OFFERS' : !buyable.length ? 'NO_BUYABLE_OFFER' : null };
}

/** Texto curto para o site: "91 — 23,7% abaixo da referência Copag · + ... · − ..." */
export function explain(o) {
  if (!o || o.opportunity_score == null) return null;
  const lines = [`${o.opportunity_score} — ${BAND_LABEL[o.opportunity_band]}`];
  for (const x of o.reasons) lines.push(`${x.impact === '-' ? '−' : x.impact === '=' ? '·' : '+'} ${x.text}`);
  for (const x of o.warnings) lines.push(`− ${x.text}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------- eventos (para a futura Automation Core)
// Gerados por PRODUTO (melhor oportunidade comprável), só em transições — nunca a cada rodada.
export const EVENTS = {
  FOUND: 'OPPORTUNITY_FOUND',       // produto passou a ter oportunidade Boa ou Excelente
  CHANGED: 'OPPORTUNITY_CHANGED',   // continua ≥ Boa, mas mudou de faixa, de oferta ou ≥ 10 pontos
  EXPIRED: 'OPPORTUNITY_EXPIRED',   // tinha oportunidade ≥ Boa e deixou de ter (preço subiu, esgotou, saiu)
  ANOMALY: 'OPPORTUNITY_ANOMALY',   // apareceu oferta com preço suspeito (não vira oportunidade; precisa de conferência)
};
const good = (x) => x && x.opportunity_score >= 75;
/** prev/next: melhor oportunidade do produto ({ offer_id, opportunity_score, opportunity_band }) ou null; anomalias: ids novos */
export function eventsFor(productId, prev, next, { newAnomalies = [] } = {}) {
  const ev = []; const snap = (x) => (x ? { offer_id: String(x.offer_id), score: x.opportunity_score, band: x.opportunity_band, price: x.price ?? null } : null);
  if (good(next) && !good(prev)) ev.push({ type: EVENTS.FOUND, product_id: productId, payload: { to: snap(next) } });
  else if (good(prev) && !good(next)) ev.push({ type: EVENTS.EXPIRED, product_id: productId, payload: { from: snap(prev), to: snap(next) } });
  else if (good(prev) && good(next) && (prev.opportunity_band !== next.opportunity_band || String(prev.offer_id) !== String(next.offer_id) || Math.abs(prev.opportunity_score - next.opportunity_score) >= 10))
    ev.push({ type: EVENTS.CHANGED, product_id: productId, payload: { from: snap(prev), to: snap(next) } });
  for (const a of newAnomalies) ev.push({ type: EVENTS.ANOMALY, product_id: productId, payload: { offer_id: String(a.offer_id), price: a.price ?? null, warnings: (a.warnings || []).map((x) => x.code) } });
  return ev;
}
