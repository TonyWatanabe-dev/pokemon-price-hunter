// O que mudou numa oferta (#53): queda de preço, novo anúncio ou volta ao estoque, a partir do que o banco já guarda
// (offer.first_seen_at, price_history e stock_event). Função pura e determinística: não lê banco, não calcula nota
// e não mexe no Opportunity Score — só diz qual mudança real a oferta teve na janela, ou por que não há mudança.
// Mesmas regras da atividade do robô (src/activity.js) e dos eventos de alerta (src/run.js):
//  • só oferta com estoque CONFIRMADO agora (in_stock); estoque desconhecido nunca vira disponível nem indisponível;
//  • oferta stale, anômala ou com leitura ainda não confirmada não gera mudança;
//  • restock = o último estoque CONHECIDO antes da leitura era out_of_stock (leitura unknown no meio é pulada;
//    pré-venda que passa a ter estoque é lançamento, não restock);
//  • queda = valor menor que a leitura anterior na MESMA base: total com frete conhecido contra total com frete
//    conhecido, ou preço contra preço quando o frete é desconhecido. Total com frete desconhecido nunca é comparado,
//    e frete que passou a ser (des)conhecido não é queda;
//  • preço que vai e volta não é queda: o novo valor precisa ser o menor das 48 h anteriores (como em activity.js);
//  • queda implausível (fora da régua do Price Engine em relação ao valor anterior) não é queda.
// Vive em api/_lib porque o feed /api/v1/oportunidades usa (a Vercel só publica api/; src/ não vai para a função);
// src/core/offer-change.js reexporta este módulo. A régua de plausibilidade é a do Price Engine (src/core/price-engine.js:
// PLAUSIBLE_MIN/MAX, round2, validPrice); test/opportunity-change-api-tests.js garante que as duas continuam iguais.
export const PLAUSIBLE_MIN = 0.55;
export const PLAUSIBLE_MAX = 3;
export const round2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round((x + Number.EPSILON) * 100) / 100);
export const validPrice = (v) => v != null && Number.isFinite(Number(v)) && Number(v) > 0;
export function plausible(price, anchor) {
  if (!validPrice(price)) return false;
  if (anchor == null) return true;
  return price >= round2(anchor * PLAUSIBLE_MIN) && price <= round2(anchor * PLAUSIBLE_MAX);
}

export const CHANGE = { DROP: 'queda_preco', NEW: 'novo_anuncio', RESTOCK: 'restock' };
export const CHANGE_LABEL = { queda_preco: 'Queda de preço', novo_anuncio: 'Novo anúncio', restock: 'Voltou ao estoque' };
export const WINDOW_HOURS = 48;            // janela padrão em que a mudança ainda é "recente"
export const BOUNCE_HOURS = 48;            // preço que vai e volta (vendedores alternando): mesma janela de activity.js

const ms = (v) => (v instanceof Date ? v.getTime() : Date.parse(v ?? ''));
const iso = (t) => new Date(t).toISOString();
const none = (reason) => ({ kind: null, label: null, at: null, from: null, to: null, basis: null, reason });

// Valor comparável de uma leitura: total só com frete conhecido; com frete desconhecido, o preço do produto.
// price_history grava total_price só quando o frete é conhecido (src/core/mappers.js); shipping_status, quando vier
// (linha de offer), tem a palavra final: 'unknown' descarta qualquer total.
function valueOf(r) {
  const unknownShip = r.shipping_status === 'unknown';
  if (!unknownShip && validPrice(r.total_price)) return { basis: 'total', value: Number(r.total_price) };
  return validPrice(r.price) ? { basis: 'price', value: Number(r.price) } : null;
}

function restockOf(events, since) {
  const ev = (events || []).map((e) => ({ ...e, t: ms(e.observed_at) })).filter((e) => Number.isFinite(e.t)).sort((a, b) => a.t - b.t);
  let lastKnown = null; let found = null;
  for (const e of ev) {
    const from = e.from_status && e.from_status !== 'unknown' ? e.from_status : lastKnown;
    if (e.to_status === 'in_stock' && from === 'out_of_stock' && e.t >= since) found = e;
    if (e.to_status && e.to_status !== 'unknown') lastKnown = e.to_status;
  }
  return found;
}

function dropOf(history, since) {
  // Só leituras com estoque confirmado e valor válido; a última é a leitura atual da oferta.
  const pts = (history || []).map((r) => ({ t: ms(r.observed_at), stock: r.stock_status, v: valueOf(r) }))
    .filter((p) => Number.isFinite(p.t) && p.stock === 'in_stock' && p.v).sort((a, b) => a.t - b.t);
  if (pts.length < 2) return { reason: 'sem leitura anterior com estoque para comparar' };
  const cur = pts[pts.length - 1].v;
  let c = pts.length - 1;   // início da sequência final com o mesmo valor (quando a mudança aconteceu)
  while (c > 0 && pts[c - 1].v.basis === cur.basis && pts[c - 1].v.value === cur.value) c--;
  if (c === 0) return { reason: 'sem mudança de preço' };
  const prev = pts[c - 1]; const at = pts[c].t;
  if (prev.v.basis !== cur.basis) return { reason: 'frete mudou entre as leituras: valores não comparáveis' };
  if (!(cur.value < prev.v.value)) return { reason: 'preço não caiu' };
  if (at < since) return { reason: 'queda fora da janela' };
  if (!plausible(cur.value, prev.v.value)) return { reason: 'queda implausível em relação à leitura anterior' };
  const before = pts.slice(0, c).filter((p) => p.v.basis === cur.basis && p.t >= at - BOUNCE_HOURS * 3600e3);
  if (before.some((p) => p.v.value <= cur.value)) return { reason: 'preço já esteve neste valor nas últimas 48 h' };
  return { at, from: prev.v.value, to: cur.value, basis: cur.basis };
}

/**
 * Mudança real mais recente de uma oferta na janela.
 * @param {object} p
 * @param {object} p.offer   linha de hunter.offer (stock_status, first_seen_at, anomalous, confirmed, status) + stale (frescor da leitura)
 * @param {Array}  p.history leituras de price_history da oferta (price, total_price, stock_status, observed_at; shipping_status
 *                           opcional), incluindo a leitura atual; total_price nulo = frete desconhecido
 * @param {Array}  p.stockEvents linhas de stock_event da oferta (from_status, to_status, observed_at)
 * @returns {{ kind: string|null, label: string|null, at: string|null, from: number|null, to: number|null, basis: 'total'|'price'|null, reason: string }}
 */
export function classifyOfferChange({ offer, history = [], stockEvents = [], now = Date.now(), windowHours = WINDOW_HOURS } = {}) {
  if (!offer) return none('sem oferta');
  if (offer.status && offer.status !== 'active') return none('oferta fora do ar');
  if (offer.stale) return none('leitura antiga (stale): sem mudança confirmada');
  if (offer.anomalous) return none('preço anômalo');
  if (offer.confirmed === false) return none('leitura ainda não confirmada');
  if (offer.stock_status !== 'in_stock') return none(offer.stock_status === 'unknown' || !offer.stock_status ? 'estoque desconhecido' : 'sem estoque confirmado');
  const nowMs = ms(now instanceof Date ? now : new Date(now));
  const since = nowMs - windowHours * 3600e3;
  const out = [];

  const first = ms(offer.first_seen_at);
  if (Number.isFinite(first) && first >= since && first <= nowMs) {
    const pts = (history || []).filter((r) => r.stock_status === 'in_stock' && valueOf(r)).sort((a, b) => ms(a.observed_at) - ms(b.observed_at));
    const v = pts.length ? valueOf(pts[pts.length - 1]) : null;
    // Novo anúncio é a primeira aparição: não há leitura anterior com que comparar queda ou restock.
    return { kind: CHANGE.NEW, label: CHANGE_LABEL[CHANGE.NEW], at: iso(first), from: null, to: v ? round2(v.value) : null, basis: v?.basis ?? null, reason: 'oferta vista pela primeira vez na janela' };
  }

  const rs = restockOf(stockEvents, since);
  if (rs && rs.t <= nowMs) out.push({ kind: CHANGE.RESTOCK, t: rs.t, from: null, to: null, basis: null, reason: 'último estoque conhecido era esgotado' });
  const dr = dropOf(history, since);
  if (dr.at != null && dr.at <= nowMs) out.push({ kind: CHANGE.DROP, t: dr.at, from: dr.from, to: dr.to, basis: dr.basis, reason: dr.basis === 'total' ? 'total com frete conhecido caiu' : 'preço caiu (frete desconhecido: total não comparado)' });
  if (!out.length) return none(rs ? 'restock fora da janela' : dr.reason);
  const x = out.sort((a, b) => b.t - a.t)[0];
  return { kind: x.kind, label: CHANGE_LABEL[x.kind], at: iso(x.t), from: round2(x.from), to: round2(x.to), basis: x.basis, reason: x.reason };
}
