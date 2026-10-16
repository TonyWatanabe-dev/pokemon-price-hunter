// Price Intelligence Agent (Fase 7, item 8) — SÓ EXPLICAÇÃO. Lê o histórico diário por loja (data/hist/<id>.json),
// a janela de desconfiança (meta.json → distrust) e as ofertas atuais (state.json) e explica, por produto, o que
// mudou no menor preço diário: mudança real numa loja × mudança de composição (loja entrou/saiu), persistente ×
// pontual, possível anomalia, com a incerteza declarada e as ressalvas de comparabilidade (Pix × preço normal, frete
// desconhecido, estoque não confirmado, amostra curta, histórico defasado).
//
// Limite duro: NÃO define preço oficial nem referência, NÃO escreve score/oportunidade, NÃO dispara alerta e NÃO grava
// nada. A saída não tem campo de preço de referência nem de nota: só observações e hipóteses para revisão humana.
// O score oficial continua no motor determinístico (src/core/opportunity-engine.js). Puro: sem rede, banco ou relógio.
// Reusa: cleanPoints (src/history.js), trustedPoint (src/distrust.js), MIN_HISTORY_DAYS e median (price-engine).
import { cleanPoints } from '../history.js';
import { trustedPoint } from '../distrust.js';
import { MIN_HISTORY_DAYS, median, round2, round4 } from '../core/price-engine.js';

export const PRICE_INTEL_VERSION = 'price-intel-v1';
export const WINDOW_DAYS = 7;          // base de comparação: mediana do menor preço dos 7 dias anteriores
export const MOVE = 0.05;              // variação abaixo de 5% é "estável"
export const SAME_LEVEL = 0.02;        // dias dentro de ±2% do nível atual contam para a persistência
export const ROBUST_Z = 3.5;           // desvio robusto (mediana/MAD) acima disso = possível anomalia
export const STALE_DAYS = 7;           // último ponto mais velho que isso: histórico defasado
export const ENOUGH_DAYS = 30;         // histórico "suficiente" para o plano (variação de 30 dias)
const DAY = 864e5;
const dayOf = (t) => new Date(t).toISOString().slice(0, 10);
const addDays = (d, n) => dayOf(Date.parse(d + 'T00:00:00Z') + n * DAY);

/** Séries limpas por loja (pontos inválidos e da janela de desconfiança fora) e o menor preço de cada dia com a loja. */
export function bestSeries(hist, distrust = null, asOfDay = null) {
  const stores = {}; let invalid = 0; let untrusted = 0; let future = 0;
  for (const [sid, s] of Object.entries(hist?.stores || {})) {
    const c = cleanPoints(s?.pts); invalid += c.invalid;
    const pts = [];
    for (const [d, v] of c.pts) {
      if (asOfDay && d > asOfDay) { future++; continue; }
      if (!trustedPoint(distrust, sid, d)) { untrusted++; continue; }
      pts.push([d, v]);
    }
    if (pts.length) stores[sid] = { name: s?.name || sid, pts };
  }
  const byDay = new Map();
  for (const [sid, s] of Object.entries(stores)) for (const [d, v] of s.pts) {
    const cur = byDay.get(d);
    if (!cur || v < cur.v || (v === cur.v && sid < cur.store)) byDay.set(d, { d, v, store: sid });
  }
  return { stores, days: [...byDay.values()].sort((a, b) => a.d.localeCompare(b.d)), dropped: { invalid, untrusted, future } };
}

const storeAt = (stores, sid, d) => stores[sid]?.pts.find((p) => p[0] === d)?.[1] ?? null;
const storeMedianIn = (stores, sid, from, to) => median((stores[sid]?.pts || []).filter(([d]) => d >= from && d < to).map(([, v]) => v));

/** Ressalvas de comparabilidade a partir das ofertas atuais do produto (state.offers). */
export function comparability(offers) {
  const live = (offers || []).filter((o) => o && !o.stale && !o.anomalous && o.total > 0);
  const inStock = live.filter((o) => o.stock === 'IN_STOCK');
  const best = [...inStock].sort((a, b) => a.total - b.total || String(a.id).localeCompare(String(b.id)))[0] || null;
  const flags = [];
  if (best?.priceKind === 'pix') flags.push('menor_preco_e_pix');
  if (best && best.shippingKnown === false) flags.push('frete_desconhecido_no_menor_preco');
  if (inStock.some((o) => o.priceKind === 'pix') && inStock.some((o) => o.priceKind && o.priceKind !== 'pix')) flags.push('mistura_pix_e_preco_normal');
  if (inStock.some((o) => o.shippingKnown === false) && inStock.some((o) => o.shippingKnown === true)) flags.push('mistura_com_e_sem_frete');
  if (live.some((o) => o.stock === 'UNKNOWN')) flags.push('estoque_nao_confirmado_em_parte');
  if ((offers || []).some((o) => o?.anomalous)) flags.push('oferta_anomala_excluida');
  return { flags, best: best ? { id: String(best.id), store: best.storeId, total: best.total, priceKind: best.priceKind || null, shippingKnown: best.shippingKnown ?? null, observedAt: best.source_timestamp || null } : null,
    inStock: inStock.length, offers: (offers || []).length };
}

/**
 * Explica um produto. hist: arquivo data/hist/<id>.json; offers: ofertas atuais do produto; asOf: horário de referência.
 * Sempre devolve observação + incerteza; quando o dado não sustenta, abstém-se (abstain) com o motivo.
 */
export function explainProduct({ productId, hist, offers = [], distrust = null, asOf, name = null }) {
  const today = dayOf(asOf);
  const { stores, days, dropped } = bestSeries(hist, distrust, today);
  const cmp = comparability(offers);
  const base = { product: productId, name: name || hist?.name || null, days: days.length, from: days[0]?.d || null, to: days.at(-1)?.d || null,
    stores: Object.keys(stores).length, dropped, comparability: cmp.flags, currentBestOffer: cmp.best };
  const unc = (level, reasons) => ({ level, reasons });
  if (days.length < MIN_HISTORY_DAYS) return { ...base, abstain: 'amostra_insuficiente', uncertainty: unc('alta', [`${days.length} dia(s) válido(s) (mínimo ${MIN_HISTORY_DAYS})`]) };
  const last = days.at(-1);
  if (Date.parse(today) - Date.parse(last.d) > STALE_DAYS * DAY) return { ...base, abstain: 'historico_defasado', uncertainty: unc('alta', [`último ponto em ${last.d}`]) };

  const winFrom = addDays(last.d, -WINDOW_DAYS);
  const prev = days.filter((x) => x.d >= winFrom && x.d < last.d);
  if (!prev.length) return { ...base, abstain: 'sem_base_na_janela', uncertainty: unc('alta', [`nenhum dia entre ${winFrom} e ${last.d}`]) };
  const baseline = median(prev.map((x) => x.v));
  const change = round4(last.v / baseline - 1);
  const direction = Math.abs(change) < MOVE ? 'estavel' : change < 0 ? 'queda' : 'alta';

  // quem fazia o menor preço antes (loja mais frequente na janela) × quem faz hoje
  const freq = {}; for (const x of prev) freq[x.store] = (freq[x.store] || 0) + 1;
  const prevLeader = Object.entries(freq).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  const ownPrev = storeMedianIn(stores, last.store, winFrom, last.d);          // a loja de hoje, na janela
  const leaderBefore = storeMedianIn(stores, prevLeader, winFrom, last.d);     // a loja que liderava, na janela
  const prevLeaderToday = storeAt(stores, prevLeader, last.d);
  const own = ownPrev ? last.v / ownPrev - 1 : null;
  let cause; let causeDetail;
  if (direction === 'estavel') { cause = 'sem_mudanca_relevante'; causeDetail = `variação de ${Math.round(change * 1000) / 10}% (limite ${MOVE * 100}%)`; }
  else if (last.store === prevLeader) {
    if (Math.abs(own) >= MOVE) { cause = 'mudanca_de_preco_na_loja'; causeDetail = `${last.store} mudou de ${round2(ownPrev)} para ${last.v}`; }
    else { cause = 'mudanca_de_composicao'; causeDetail = `${last.store} manteve o preço (${round2(ownPrev)}); a base da janela inclui dias em que outra loja tinha o menor preço`; }
  } else if (direction === 'queda') {
    if (ownPrev == null) { cause = 'loja_nova_no_menor_preco'; causeDetail = `${last.store} não tinha ponto na janela; antes o menor era de ${prevLeader}`; }
    else if (own <= -MOVE) { cause = 'mudanca_de_preco_na_loja'; causeDetail = `${last.store} baixou de ${round2(ownPrev)} para ${last.v} e passou ${prevLeader}`; }
    else { cause = 'mudanca_de_composicao'; causeDetail = `${last.store} manteve o preço (${round2(ownPrev)}); ${prevLeader} ${prevLeaderToday == null ? 'sem ponto hoje' : `foi de ${round2(leaderBefore)} a ${prevLeaderToday}`}`; }
  } else if (prevLeaderToday == null) { cause = 'saida_da_loja_mais_barata'; causeDetail = `${prevLeader} (mediana ${round2(leaderBefore)}) sem ponto em ${last.d}; ${last.store} passou a ter o menor preço`; }
  else if (prevLeaderToday / leaderBefore - 1 >= MOVE) { cause = 'mudanca_de_preco_na_loja'; causeDetail = `${prevLeader} subiu de ${round2(leaderBefore)} para ${prevLeaderToday}; ${last.store} passou a ter o menor preço`; }
  else { cause = 'mudanca_de_composicao'; causeDetail = `${last.store} tem o menor preço hoje; ${prevLeader} foi de ${round2(leaderBefore)} a ${prevLeaderToday}`; }

  // persistência: dias seguidos (terminando no último) dentro de ±2% do nível atual
  let streak = 0;
  for (let i = days.length - 1; i >= 0 && Math.abs(days[i].v / last.v - 1) <= SAME_LEVEL; i--) streak++;
  const persistence = direction === 'estavel' ? null : streak >= 2 ? 'persistente' : 'pontual';

  // anomalia: desvio robusto do último menor preço contra todos os dias anteriores
  const hist0 = days.slice(0, -1).map((x) => x.v);
  const med = median(hist0); const mad = median(hist0.map((v) => Math.abs(v - med)));
  const z = mad > 0 ? round2((0.6745 * (last.v - med)) / mad) : null;
  const rel = med > 0 ? round4(last.v / med - 1) : null;
  const anomaly = { suspect: z != null ? Math.abs(z) > ROBUST_Z : rel != null && Math.abs(rel) > 0.25, method: z != null ? 'mad' : 'desvio_relativo', z, relativeToMedian: rel };

  const reasons = [];
  let level = 0;   // 0 baixa, 1 média, 2 alta
  if (days.length < 7) { level = Math.max(level, 1); reasons.push(`só ${days.length} dias de histórico`); }
  if (Object.keys(stores).length < 2) { level = Math.max(level, 1); reasons.push('uma única loja na série'); }
  if (persistence === 'pontual') { level = Math.max(level, 1); reasons.push('mudança de um dia só'); }
  if (cause === 'mudanca_de_composicao' || cause === 'loja_nova_no_menor_preco' || cause === 'saida_da_loja_mais_barata') { level = Math.max(level, 1); reasons.push('o menor preço mudou de loja'); }
  if (anomaly.suspect) { level = 2; reasons.push('desvio fora do padrão do próprio histórico'); }
  if (dropped.untrusted) reasons.push(`${dropped.untrusted} ponto(s) fora por janela de desconfiança`);
  for (const f of cmp.flags) { if (['menor_preco_e_pix', 'frete_desconhecido_no_menor_preco', 'mistura_pix_e_preco_normal', 'mistura_com_e_sem_frete'].includes(f)) level = Math.max(level, 1); reasons.push(f); }
  reasons.push('histórico guarda o menor total do dia por loja, sem marcar Pix/frete');

  const evidence = [
    { code: 'MENOR_PRECO_DO_DIA', detail: `${last.d}: ${last.v} (${last.store})`, source: `data/hist/${productId}.json`, basis: 'observado' },
    { code: 'BASE_JANELA', detail: `mediana de ${prev.length} dia(s) entre ${winFrom} e ${addDays(last.d, -1)}: ${round2(baseline)} (loja mais frequente: ${prevLeader})`, source: `data/hist/${productId}.json`, basis: 'observado' },
    { code: 'CAUSA_PROVAVEL', detail: causeDetail, source: `data/hist/${productId}.json`, basis: 'inferido' },
    ...(cmp.best ? [{ code: 'OFERTA_ATUAL', detail: `${cmp.best.store}: ${cmp.best.total}${cmp.best.priceKind ? ` (${cmp.best.priceKind})` : ''}${cmp.best.shippingKnown === false ? ', frete desconhecido' : ''}`, source: 'state.offers', basis: 'observado', observedAt: cmp.best.observedAt }] : []),
  ];
  return { ...base, abstain: null,
    observed: { lastDay: last.d, lastMin: last.v, lastStore: last.store, baselineMedian: round2(baseline), windowDays: prev.length, change },
    direction, cause, persistence, streakDays: direction === 'estavel' ? null : streak, anomaly,
    uncertainty: unc(['baixa', 'media', 'alta'][level], reasons), evidence };
}

/** Pré-requisitos do plano: histórico suficiente e confiável, matching preciso, comparabilidade, golden temporais. */
export function priceIntelPrerequisites(items, { offers = [], temporalGoldenCases = 0 } = {}) {
  const days = items.map((x) => x.days).sort((a, b) => a - b);
  const med = days.length ? days[days.length >> 1] : 0;
  const live = offers.filter((o) => o && o.stock === 'IN_STOCK' && !o.stale);
  const pix = live.filter((o) => o.priceKind === 'pix').length; const noShip = live.filter((o) => o.shippingKnown === false).length;
  return [
    { id: 'historico_suficiente', status: med >= ENOUGH_DAYS ? 'atendido' : med >= MIN_HISTORY_DAYS ? 'parcial' : 'nao_atendido',
      detail: `${items.length} produto(s) com histórico; mediana de ${med} dia(s) (mínimo do motor ${MIN_HISTORY_DAYS}; variação de 30 dias pede ${ENOUGH_DAYS})` },
    { id: 'historico_confiavel', status: 'parcial', detail: 'pontos inválidos e janela de desconfiança descartados (cleanPoints/trustedPoint); ponto é só [dia, valor], sem horário nem URL de origem' },
    { id: 'comparabilidade', status: 'nao_atendido', detail: `histórico não marca Pix × preço normal nem com/sem frete; agora ${pix}/${live.length} oferta(s) em estoque em Pix e ${noShip}/${live.length} com frete desconhecido` },
    { id: 'matching_preciso', status: 'parcial', detail: 'golden de matching só sintético; precisão em dados reais não medida' },
    { id: 'golden_temporais', status: temporalGoldenCases > 0 ? 'atendido' : 'nao_atendido', detail: `${temporalGoldenCases} caso(s) temporal(is) em test/golden/cases.json` },
  ];
}

/**
 * Relatório completo. hist: { [productId]: arquivo data/hist/<id>.json }; state: data/state.json (produtos/ofertas atuais);
 * distrust: meta.json → distrust ({ stores, until }); asOf obrigatório (ou state.generatedAt). Puro.
 */
export function priceIntelReport({ hist = {}, state = null, distrust = null, asOf, temporalGoldenCases = 0, only = null } = {}) {
  const at = asOf ? new Date(asOf) : new Date(state?.generatedAt || NaN);
  if (!Number.isFinite(at.getTime())) throw new Error('asOf ausente: informe o horário de referência (--as-of ou state.generatedAt)');
  const offersBy = new Map();
  for (const o of state?.offers || []) if (o?.productId) (offersBy.get(o.productId) || offersBy.set(o.productId, []).get(o.productId)).push(o);
  const names = new Map((state?.products || []).map((p) => [p.id, p.name]));
  const ids = Object.keys(hist).filter((id) => !only || only.includes(id)).sort();
  const items = ids.map((id) => explainProduct({ productId: id, hist: hist[id], offers: offersBy.get(id) || [], distrust, asOf: at, name: names.get(id) || null }));
  const count = (f) => items.reduce((a, x) => { const k = f(x); if (k != null) a[k] = (a[k] || 0) + 1; return a; }, {});
  const rank = (x) => (x.abstain ? -1 : (x.anomaly?.suspect ? 10 : 0) + Math.abs(x.observed?.change || 0));
  items.sort((a, b) => rank(b) - rank(a) || a.product.localeCompare(b.product));
  return {
    agent: 'price-intel', version: PRICE_INTEL_VERSION, mode: 'explicacao', writes: false, autoApply: false,
    notDefined: ['preco_oficial', 'referencia', 'score', 'oportunidade', 'alerta'],
    asOf: at.toISOString(), inputs: { productsWithHistory: ids.length, offers: state?.offers?.length ?? null, distrustStores: distrust?.stores?.length ?? 0 },
    prerequisites: priceIntelPrerequisites(items, { offers: state?.offers || [], temporalGoldenCases }),
    summary: { products: items.length, abstained: count((x) => x.abstain), direction: count((x) => x.direction), cause: count((x) => x.cause),
      anomalies: items.filter((x) => x.anomaly?.suspect).length, uncertainty: count((x) => x.uncertainty.level) },
    items,
  };
}

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
const pct = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${Math.round(v * 1000) / 10}%`);
/** Markdown para o resumo do job / revisão humana. */
export function priceIntelMarkdown(rep, { max = 30 } = {}) {
  const s = rep.summary;
  const moving = rep.items.filter((x) => !x.abstain && (x.direction !== 'estavel' || x.anomaly.suspect));
  const out = [`# Price Intelligence — explicação de variações (${rep.asOf})`, '',
    `Modo **somente explicação**: não define ${rep.notDefined.join(', ')}; nada foi gravado. O score oficial continua no motor determinístico.`, '',
    `Produtos com histórico: ${s.products}. Abstenções: ${Object.entries(s.abstained).map(([k, v]) => `${k} ${v}`).join(', ') || 'nenhuma'}. Direção: ${Object.entries(s.direction).map(([k, v]) => `${k} ${v}`).join(', ') || '—'}. Possíveis anomalias: ${s.anomalies}.`, '',
    '## Pré-requisitos', '', '| item | status | detalhe |', '|---|---|---|', ...rep.prerequisites.map((p) => `| ${p.id} | ${p.status} | ${esc(p.detail)} |`), '',
    `## Mudanças e anomalias (${moving.length})`, '', '| produto | dias | menor preço (dia, loja) | base 7d | variação | causa provável | persistência | anomalia | incerteza |', '|---|---|---|---|---|---|---|---|---|'];
  for (const x of moving.slice(0, max)) {
    out.push(`| ${esc(x.name || x.product)} | ${x.days} | ${x.observed.lastMin} (${x.observed.lastDay}, ${esc(x.observed.lastStore)}) | ${x.observed.baselineMedian} | ${pct(x.observed.change)} | ${esc(x.cause)}: ${esc(x.evidence.find((e) => e.code === 'CAUSA_PROVAVEL')?.detail)} | ${x.persistence || '—'} | ${x.anomaly.suspect ? `sim (${x.anomaly.method}${x.anomaly.z != null ? ` z=${x.anomaly.z}` : ''})` : 'não'} | ${x.uncertainty.level}: ${esc(x.uncertainty.reasons.slice(0, 3).join('; '))} |`);
  }
  if (moving.length > max) out.push('', `… e mais ${moving.length - max} (ver JSON).`);
  return out.join('\n') + '\n';
}
