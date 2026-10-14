// Social Media MVP — detector de volta ao estoque (issue #653; escopo da #631/#560). Desativado por padrão.
// Módulo puro: não publica, não acessa rede, banco nem secrets; não lê arquivo (o chamador passa as linhas do
// data/history.jsonl e as ofertas atuais). Só aponta candidatos para rascunho → aprovação humana.
// Evento de estoque = linha do history.jsonl (gravada pelo robô só em leitura válida, nunca de oferta stale).
// Reposição de oferta é a MESMA regra do robô (isRestock, src/availability.js): esgotado/indisponível → em estoque;
// pré-venda → estoque é lançamento e desconhecido → estoque não prova nada. O produto "voltou" quando uma oferta repõe
// e, naquele instante, nenhuma outra oferta dele estava em estoque nem com estoque desconhecido (sem prova, sem evento).
// O histórico só aponta o candidato: a oferta do post precisa passar AGORA em ofertaElegivel (estoque confirmado,
// leitura confirmada, frescor "atual"), escolhida pelo menor total (selecionarElegiveis). Afiliado não entra aqui.
import { isRestock } from '../../availability.js';
import { selecionarElegiveis } from './elegiveis.js';

export const SOCIAL_ENABLED_DEFAULT = false;
export const PADROES = Object.freeze({ janelaHoras: 24, minHorasSemEstoque: 0 });
export const MOTIVOS = Object.freeze({
  RELOGIO: 'relógio inválido',
  DADO_INVALIDO: 'histórico com linha inválida',
  FUTURO: 'histórico com horário no futuro',
  SAIU_DE_NOVO: 'saiu de estoque de novo',
  PERIODO_CURTO: 'período sem estoque abaixo do mínimo',
  SEM_OFERTA_ATUAL: 'sem oferta atual confirmada em estoque',
});

const ESTADOS = new Set(['IN_STOCK', 'OUT_OF_STOCK', 'PRE_ORDER', 'UNAVAILABLE', 'UNKNOWN']);
const H = 3600e3;
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const txt = (v) => (typeof v === 'string' ? v.trim() : '');
const estado = (s) => (ESTADOS.has(s) ? s : 'UNKNOWN');   // valor fora do contrato do robô = desconhecido
const nowDe = (now) => (now === undefined ? Date.now() : now instanceof Date ? now.getTime() : typeof now === 'number' ? now : NaN);
const produtoDe = (o) => txt(o.productId ?? o.product_id ?? (isObj(o.product) ? o.product.id : null));
const positivo = (v, nome) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new TypeError(`${nome} deve ser número >= 0`);
  return v;
};

/** Reconstrói, a partir das linhas do history.jsonl, as voltas ao estoque de cada produto.
 *  Devolve { produtos: Map(productId → { emEstoque, voltas: [{ t, offerId, semEstoqueDesde }] }), invalidos: Map(productId → motivo) }.
 *  Linha sem productId/offerId não é atribuível e é ignorada; linha com horário inválido ou futuro invalida o produto
 *  inteiro (pular uma leitura "em estoque" poderia inventar um período sem estoque). */
export function voltasAoEstoque(linhas, { now } = {}) {
  const t0 = nowDe(now);
  if (!Number.isFinite(t0)) throw new TypeError(MOTIVOS.RELOGIO);
  const invalidos = new Map(); const validas = [];
  (Array.isArray(linhas) ? linhas : []).forEach((r, i) => {
    if (!isObj(r)) return;
    const p = txt(r.productId); const o = txt(r.offerId);
    if (!p || !o) return;
    const t = typeof r.t === 'string' ? Date.parse(r.t) : NaN;
    if (!Number.isFinite(t)) { if (!invalidos.has(p)) invalidos.set(p, MOTIVOS.DADO_INVALIDO); return; }
    if (t > t0) { if (!invalidos.has(p)) invalidos.set(p, MOTIVOS.FUTURO); return; }
    validas.push({ t, i, p, o, s: estado(r.stock) });
  });
  validas.sort((a, b) => a.t - b.t || a.i - b.i);

  const produtos = new Map(); const donoDa = new Map();
  const doProduto = (p) => { if (!produtos.has(p)) produtos.set(p, { ofertas: new Map(), emEstoque: false, semEstoqueDesde: null, voltas: [] }); return produtos.get(p); };
  for (const { t, p, o, s } of validas) {
    if (invalidos.has(p)) continue;
    const dono = donoDa.get(o);
    if (dono && dono !== p) doProduto(dono).ofertas.delete(o);   // oferta reclassificada: sai do produto antigo
    donoDa.set(o, p);
    const prod = doProduto(p);
    const anterior = prod.ofertas.get(o);
    const outras = [...prod.ofertas].filter(([id]) => id !== o).map(([, st]) => st);
    if (s === 'IN_STOCK' && isRestock(anterior, s) && !outras.some((x) => x === 'IN_STOCK' || x === 'UNKNOWN')) {
      prod.voltas.push({ t, offerId: o, semEstoqueDesde: prod.semEstoqueDesde });
    }
    prod.ofertas.set(o, s);
    const agora = [...prod.ofertas.values()].includes('IN_STOCK');
    if (!agora && (prod.emEstoque || prod.semEstoqueDesde == null)) prod.semEstoqueDesde = t;
    prod.emEstoque = agora;
  }
  for (const [p, prod] of produtos) if (invalidos.has(p)) produtos.delete(p);
  return { produtos: new Map([...produtos].map(([p, x]) => [p, { emEstoque: x.emEstoque, voltas: x.voltas }])), invalidos };
}

/** Produtos que voltaram ao estoque dentro da janela e têm oferta ATUAL elegível para post.
 *  opts = { now, janelaHoras = 24, minHorasSemEstoque = 0, limite }.
 *  Devolve { reposicoes: [{ productId, voltouEm, semEstoqueDesde, horasSemEstoque, offerIdReposta, oferta }],
 *  recusadas: [{ productId, motivo }] }, da volta mais recente para a mais antiga (empate: productId). */
export function detectarReposicoes({ linhas, ofertas, now, janelaHoras = PADROES.janelaHoras, minHorasSemEstoque = PADROES.minHorasSemEstoque, limite } = {}) {
  if (limite !== undefined && !(Number.isInteger(limite) && limite >= 0)) throw new TypeError('limite deve ser inteiro >= 0');
  positivo(janelaHoras, 'janelaHoras'); positivo(minHorasSemEstoque, 'minHorasSemEstoque');
  const t0 = nowDe(now);
  if (!Number.isFinite(t0)) throw new TypeError(MOTIVOS.RELOGIO);
  const { produtos, invalidos } = voltasAoEstoque(linhas, { now: t0 });
  const atuais = (Array.isArray(ofertas) ? ofertas : []).filter(isObj);
  const recusadas = []; const reposicoes = [];

  for (const [p, prod] of produtos) {
    const v = prod.voltas.filter((x) => t0 - x.t <= janelaHoras * H).at(-1);
    if (!v) continue;
    if (!prod.emEstoque) { recusadas.push({ productId: p, motivo: MOTIVOS.SAIU_DE_NOVO }); continue; }
    const horas = v.semEstoqueDesde == null ? null : (v.t - v.semEstoqueDesde) / H;
    if (minHorasSemEstoque > 0 && !(horas >= minHorasSemEstoque)) { recusadas.push({ productId: p, motivo: MOTIVOS.PERIODO_CURTO }); continue; }
    // O histórico não prova estoque de agora: só vale oferta que, neste instante, passa no contrato de elegíveis.
    const melhor = selecionarElegiveis(atuais.filter((o) => produtoDe(o) === p), { now: t0, limite: 1 }).elegiveis[0];
    if (!melhor) { recusadas.push({ productId: p, motivo: MOTIVOS.SEM_OFERTA_ATUAL }); continue; }
    reposicoes.push({
      productId: p, voltouEm: new Date(v.t).toISOString(),
      semEstoqueDesde: v.semEstoqueDesde == null ? null : new Date(v.semEstoqueDesde).toISOString(),
      horasSemEstoque: horas == null ? null : Math.round(horas * 10) / 10,
      offerIdReposta: v.offerId, oferta: melhor,
    });
  }
  for (const [p, motivo] of invalidos) recusadas.push({ productId: p, motivo });
  reposicoes.sort((a, b) => b.voltouEm.localeCompare(a.voltouEm) || a.productId.localeCompare(b.productId));
  recusadas.sort((a, b) => a.productId.localeCompare(b.productId));
  return { reposicoes: limite === undefined ? reposicoes : reposicoes.slice(0, limite), recusadas };
}
