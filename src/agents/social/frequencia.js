// Social Media — frequência por produto (issue #661; escopo da #631/#560). Desativado por padrão: quem chama confere
// SOCIAL_ENABLED (fila.js/elegiveis.js). Regra complementar à fila: a fila deduplica por chaveDedupe (produto + loja +
// preço) em 24 h; aqui o MESMO PRODUTO entra no máximo 1 vez por canal dentro da janela (padrão 72 h), qualquer loja ou
// preço, salvo queda de preço NOVA acima do limiar em relação ao menor preço já postado do produto naquela janela.
// Puro e determinístico: não publica, não acessa rede, banco nem secrets; o histórico de posts vem do chamador e não é
// mutado. Histórico inválido ou no futuro lança erro (falha fechado). Não reordena: a ordem dos candidatos é a do
// chamador (ranking não muda aqui); afiliado e comissão não entram na regra.
import { PADROES as PADROES_QUEDA } from './quedas.js';

export const SOCIAL_ENABLED_DEFAULT = false;
// Limiar da exceção = o mesmo do detector de quedas (quedas.js): fração do valor anterior E valor mínimo em R$.
export const PADROES = Object.freeze({ janelaHoras: 72, minPct: PADROES_QUEDA.minPct, minReais: PADROES_QUEDA.minReais });
export const MOTIVOS = Object.freeze({
  INVALIDO: 'candidato inválido (canal, produto ou preço)',
  REPETIDO: 'produto já postado no canal dentro da janela',
  QUEDA_PEQUENA: 'produto já postado no canal dentro da janela; queda abaixo do limiar',
});

const H = 3600e3;
const CANAL = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const txt = (v) => (typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)) ? String(v).trim() : '');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const round2 = (v) => Math.round(v * 100) / 100;
const erro = (msg) => new Error('social/frequencia: ' + msg);
const produtoDe = (o) => txt(o.productId ?? o.product_id ?? (isObj(o.product) ? o.product.id : null));
const precoDe = (o) => num(o.preco ?? o.price);
const canalOk = (c) => typeof c === 'string' && CANAL.test(c);

function instante(now) {
  const ms = now instanceof Date ? now.getTime() : typeof now === 'number' ? now : typeof now === 'string' ? Date.parse(now) : NaN;
  if (!Number.isFinite(ms)) throw erro('now inválido ou ausente');
  return ms;
}

function config({ janelaHoras = PADROES.janelaHoras, minPct = PADROES.minPct, minReais = PADROES.minReais } = {}) {
  if (num(janelaHoras) == null || janelaHoras <= 0) throw erro('janelaHoras deve ser número > 0');
  if (num(minPct) == null || minPct < 0 || minPct >= 1) throw erro('minPct deve ser número em [0, 1)');
  if (num(minReais) == null || minReais < 0) throw erro('minReais deve ser número >= 0');
  return { janelaHoras, minPct, minReais };
}

/** Normaliza o histórico de posts: [{ canal, productId, em (ISO), preco }]. Lança no primeiro registro inválido ou com
 *  horário depois de now (relógio adiantado ou dado corrompido não pode liberar repetição). */
function normalizarHistorico(historico, t0) {
  if (historico == null) return [];
  if (!Array.isArray(historico)) throw erro('histórico não é lista');
  return historico.map((r, i) => {
    if (!isObj(r)) throw erro(`histórico ${i}: não é objeto`);
    if (!canalOk(r.canal)) throw erro(`histórico ${i}: canal inválido`);
    const p = produtoDe(r);
    if (!p) throw erro(`histórico ${i}: produto ausente`);
    const t = typeof r.em === 'string' ? Date.parse(r.em) : NaN;
    if (!Number.isFinite(t)) throw erro(`histórico ${i}: horário inválido`);
    if (t > t0) throw erro(`histórico ${i}: horário no futuro`);
    const preco = precoDe(r);
    if (preco == null || preco <= 0) throw erro(`histórico ${i}: preço inválido`);
    return { canal: r.canal, productId: p, t, preco };
  });
}

// Decisão para um candidato já normalizado contra registros já normalizados.
function decidir({ canal, productId, preco }, registros, t0, cfg) {
  const naJanela = registros.filter((r) => r.canal === canal && r.productId === productId && t0 - r.t < cfg.janelaHoras * H);
  if (!naJanela.length) return { ok: true, motivo: '', anterior: null };
  const ultimo = naJanela.reduce((a, b) => (b.t >= a.t ? b : a));
  const referencia = Math.min(...naJanela.map((r) => r.preco));
  const anterior = { em: new Date(ultimo.t).toISOString(), precoReferencia: referencia };
  const valor = round2(referencia - preco);
  if (valor <= 0) return { ok: false, motivo: MOTIVOS.REPETIDO, anterior };
  const pct = +(valor / referencia).toFixed(4);
  if (pct < cfg.minPct || valor < cfg.minReais) return { ok: false, motivo: MOTIVOS.QUEDA_PEQUENA, anterior, queda: { de: referencia, para: preco, valor, pct } };
  return { ok: true, motivo: '', anterior, queda: { de: referencia, para: preco, valor, pct } };
}

function candidatoDe(c, canalPadrao) {
  if (!isObj(c)) return null;
  const canal = c.canal ?? canalPadrao;
  const productId = produtoDe(c);
  const preco = precoDe(c);
  if (!canalOk(canal) || !productId || preco == null || preco <= 0) return null;
  return { canal, productId, preco };
}

/** Pode postar este produto neste canal agora? candidato = { canal, productId, preco } (aceita product_id/product.id e
 *  price). historico = posts já feitos/enfileirados [{ canal, productId, em, preco }].
 *  Devolve { ok, motivo, anterior, queda? }: anterior = { em, precoReferencia } do produto no canal dentro da janela
 *  (null se não houver); queda = { de, para, valor, pct } quando o preço caiu em relação a essa referência. */
export function podePostar(candidato, historico, { now, ...opts } = {}) {
  const cfg = config(opts);
  const t0 = instante(now);
  const registros = normalizarHistorico(historico, t0);
  const c = candidatoDe(candidato);
  if (!c) return { ok: false, motivo: MOTIVOS.INVALIDO, anterior: null };
  return decidir(c, registros, t0, cfg);
}

/** Aplica a regra a uma lista de candidatos na ordem recebida. Um candidato liberado conta como post no instante now
 *  para os seguintes: o mesmo produto no mesmo canal não sai duas vezes no mesmo lote, salvo nova queda acima do limiar.
 *  opts = { now, canal (padrão para candidatos sem canal), janelaHoras = 72, minPct, minReais }.
 *  Devolve { liberados: [{ indice, candidato, anterior, queda? }], bloqueados: [{ indice, productId, canal, motivo, anterior }] }. */
export function filtrarPorFrequencia(candidatos, historico, { now, canal, ...opts } = {}) {
  const cfg = config(opts);
  const t0 = instante(now);
  if (canal !== undefined && !canalOk(canal)) throw erro('canal inválido');
  const registros = normalizarHistorico(historico, t0);
  const liberados = []; const bloqueados = [];
  (Array.isArray(candidatos) ? candidatos : []).forEach((cand, indice) => {
    const c = candidatoDe(cand, canal);
    if (!c) {
      bloqueados.push({ indice, productId: isObj(cand) ? produtoDe(cand) || null : null, canal: (isObj(cand) && cand.canal) || canal || null, motivo: MOTIVOS.INVALIDO, anterior: null });
      return;
    }
    const d = decidir(c, registros, t0, cfg);
    if (!d.ok) { bloqueados.push({ indice, productId: c.productId, canal: c.canal, motivo: d.motivo, anterior: d.anterior }); return; }
    liberados.push({ indice, candidato: cand, anterior: d.anterior, ...(d.queda ? { queda: d.queda } : {}) });
    registros.push({ ...c, t: t0 });
  });
  return { liberados, bloqueados };
}
