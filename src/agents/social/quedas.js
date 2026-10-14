// Social Media — detector de queda de preço relevante para post (issue #652; escopo da #631/#560). Desativado por padrão:
// quem chama confere socialHabilitado (elegiveis.js). Somente rascunho: não publica, não acessa rede, banco nem secrets.
// Não recalcula queda: a mudança vem de classifyOfferChange (api/_lib/offer-change.mjs), que já descarta leitura sem
// estoque confirmado, frete que mudou de base, queda implausível e preço que vai e volta (bounce de 48 h). A oferta precisa
// passar no contrato de ofertaElegivel (leitura válida e ATUAL) e o valor atual dela precisa ser o da queda. Aqui só entra
// o limiar de relevância (configurável). Afiliado, comissão e notas não entram na seleção nem na ordem.
import { ofertaElegivel, chaveDedupe, MOTIVOS as MOTIVOS_ELEGIVEIS } from './elegiveis.js';
import { classifyOfferChange, CHANGE, WINDOW_HOURS, round2 } from '../../core/offer-change.js';

// minPct: queda mínima em fração do valor anterior; minReais: queda mínima em R$; janelaHoras: a queda precisa ser recente.
export const PADROES = Object.freeze({ minPct: 0.05, minReais: 5, janelaHoras: WINDOW_HOURS });

export const MOTIVOS = Object.freeze({
  ...MOTIVOS_ELEGIVEIS,
  SEM_QUEDA: 'sem queda de preço',
  DIVERGENTE: 'valor atual da oferta diverge do histórico',
  ABAIXO_LIMIAR: 'queda abaixo do limiar',
});

const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const txt = (v) => (typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)) ? String(v).trim() : '');
const produtoDe = (o) => txt(o.productId ?? o.product_id ?? (isObj(o.product) ? o.product.id : null));
const lojaDe = (o) => txt(o.storeId ?? o.store_id ?? (isObj(o.store) ? o.store.id : null));
const freteConhecido = (o) => o.shippingKnown === true || (isObj(o.shipping) && (o.shipping.status === 'free' || o.shipping.status === 'known'));

function config({ minPct = PADROES.minPct, minReais = PADROES.minReais, janelaHoras = PADROES.janelaHoras } = {}) {
  if (num(minPct) == null || minPct < 0 || minPct >= 1) throw new TypeError('minPct deve ser número em [0, 1)');
  if (num(minReais) == null || minReais < 0) throw new TypeError('minReais deve ser número >= 0');
  if (num(janelaHoras) == null || janelaHoras <= 0) throw new TypeError('janelaHoras deve ser número > 0');
  return { minPct, minReais, janelaHoras };
}

// Leitura no formato de price_history (price, total_price, stock_status, observed_at) ou de data/history.jsonl
// (t, price, total, stock 'IN_STOCK'). O log local não grava se o frete era conhecido: lá só o preço é comparável.
function leitura(r) {
  if (!isObj(r)) return null;
  if (r.observed_at !== undefined) return r;
  const stock = typeof r.stock === 'string' ? r.stock.toLowerCase() : null;
  return { observed_at: r.t ?? null, price: r.price, total_price: r.shippingKnown === true ? r.total : null, stock_status: stock };
}

// A oferta já passou em ofertaElegivel (ativa, não stale, não anômala, confirmada, estoque confirmado): só falta a data
// de primeira aparição, para que anúncio novo na janela não seja lido como queda.
const ofertaParaMudanca = (o) => ({ status: 'active', stale: false, anomalous: false, confirmed: true, stock_status: 'in_stock', first_seen_at: o.first_seen_at ?? null });

// Valor atual da oferta na mesma base da queda; null se a oferta não tiver valor nessa base.
function valorAtual(o, base) {
  if (base === 'price') return num(o.price);
  if (base === 'total' && freteConhecido(o)) return num(o.total_price) ?? num(o.total);
  return null;
}

/** Queda relevante de UMA oferta. historico = leituras da oferta (incluindo a atual).
 *  Devolve { ok: true, motivo: '', queda } ou { ok: false, motivo }. queda = { de, para, valor, pct, base, em }. */
export function quedaRelevante(oferta, historico, { now, ...opts } = {}) {
  const cfg = config(opts);
  const el = ofertaElegivel(oferta, { now });
  if (!el.ok) return el;
  const t = now === undefined ? Date.now() : now instanceof Date ? now.getTime() : now;
  const mudanca = classifyOfferChange({
    offer: ofertaParaMudanca(oferta), history: (Array.isArray(historico) ? historico : []).map(leitura).filter(Boolean),
    now: t, windowHours: cfg.janelaHoras,
  });
  if (mudanca.kind !== CHANGE.DROP) return { ok: false, motivo: MOTIVOS.SEM_QUEDA, detalhe: mudanca.reason };
  const atual = valorAtual(oferta, mudanca.basis);
  if (atual == null || round2(atual) !== mudanca.to) return { ok: false, motivo: MOTIVOS.DIVERGENTE };
  const valor = round2(mudanca.from - mudanca.to);
  const pct = +(valor / mudanca.from).toFixed(4);
  if (pct < cfg.minPct || valor < cfg.minReais) return { ok: false, motivo: MOTIVOS.ABAIXO_LIMIAR, pct, valor };
  return { ok: true, motivo: '', queda: { de: mudanca.from, para: mudanca.to, valor, pct, base: mudanca.basis, em: mudanca.at } };
}

/** itens = [{ oferta, historico }]. Devolve { quedas, recusadas: [{ id, motivo }] }: quedas ordenadas pela maior queda
 *  percentual (depois a maior em R$ e a ordem de entrada), sem duplicatas (produto + loja + preço) e com o limite aplicado.
 *  Cada queda = { oferta, produtoId, lojaId, de, para, valor, pct, base, em } — a entrada do modelo "queda de preço". */
export function detectarQuedas(itens, { now, limite, ...opts } = {}) {
  config(opts);
  if (limite !== undefined && !(Number.isInteger(limite) && limite >= 0)) throw new TypeError('limite deve ser inteiro >= 0');
  const recusadas = []; const candidatas = [];
  (Array.isArray(itens) ? itens : []).forEach((it, i) => {
    const oferta = isObj(it) ? it.oferta : null;
    const r = quedaRelevante(oferta, isObj(it) ? it.historico : null, { now, ...opts });
    if (r.ok) candidatas.push({ i, q: { oferta, produtoId: produtoDe(oferta), lojaId: lojaDe(oferta), ...r.queda } });
    else recusadas.push({ id: isObj(oferta) ? txt(oferta.id) || null : null, motivo: r.motivo });
  });
  candidatas.sort((a, b) => b.q.pct - a.q.pct || b.q.valor - a.q.valor || a.i - b.i);
  const vistas = new Set(); const quedas = [];
  for (const { q } of candidatas) {
    const k = chaveDedupe(q.oferta);
    if (vistas.has(k)) { recusadas.push({ id: txt(q.oferta.id) || null, motivo: MOTIVOS.DUPLICADA }); continue; }
    vistas.add(k); quedas.push(q);
  }
  return { quedas: limite === undefined ? quedas : quedas.slice(0, limite), recusadas };
}
