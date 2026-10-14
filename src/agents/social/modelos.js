// Social Media MVP — catálogo de modelos editoriais de post (issue #648; escopo da #631/#560). Desativado por padrão.
// Módulo puro e determinístico: sem IA, sem rede, sem banco, sem secrets. NÃO publica. Cada modelo declara os campos que
// exige e a regra de elegibilidade; sem esses dados o modelo é recusado com motivo explícito (ex.: queda sem histórico).
// O texto final é sempre o de rascunho.js (gerarRascunho); o modelo só acrescenta a linha de abertura (chamada).
// Afiliado não entra em nenhuma regra: a comparação usa só preço/total, nunca comissão.
import { money } from '../../format.js';
import { gerarRascunho, socialEnabled, SOCIAL_ENABLED_DEFAULT } from './rascunho.js';

export { socialEnabled, SOCIAL_ENABLED_DEFAULT };

const H = 3600e3, DIA = 24 * H;
export const REGRAS = Object.freeze({
  ofertaDoDiaHoras: 24,      // "do dia": preço lido nas últimas 24 h
  quedaMinima: 0.01,         // queda menor que 1% não vira post de queda
  historicoDias: 30,         // preço anterior da queda: no máximo 30 dias antes da leitura atual
  comparacaoMinLojas: 2,     // a oferta + ao menos 1 alternativa de outra loja
  toleranciaRelogioMin: 5,   // leitura "no futuro" além disto = relógio/dado inválido
});

export const MOTIVOS = Object.freeze({
  MODELO: 'modelo desconhecido',
  FALTANDO: 'dados obrigatórios ausentes',
  RELOGIO: 'relógio inválido',
  PRECO: 'preço ausente ou inválido',
  LEITURA: 'data de leitura inválida ou no futuro',
  VELHA: 'leitura fora da janela do modelo',
  SEM_HISTORICO: 'sem histórico de preço anterior na janela',
  SEM_QUEDA: 'preço não caiu o suficiente',
  SEM_ESTOQUE: 'estoque atual não confirmado',
  SEM_INDISPONIBILIDADE: 'sem registro de indisponibilidade anterior',
  SEM_ALTERNATIVAS: 'sem alternativas válidas de outras lojas',
  NAO_E_MENOR: 'oferta não é a menor da comparação',
});

const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const preco = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const ms = (iso) => (typeof iso === 'string' && iso ? Date.parse(iso) : NaN);
const nowDe = (now) => (now === undefined ? Date.now() : now instanceof Date ? now.getTime() : typeof now === 'number' ? now : NaN);
const dia = (t) => new Date(t).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' });
const txt = (v) => (typeof v === 'string' ? v.trim() : '');

// Campos da oferta que todo modelo exige (formato de entrada de gerarRascunho).
const BASE = Object.freeze(['oferta.produto.nome', 'oferta.produto.slug', 'oferta.loja.nome', 'oferta.preco', 'oferta.url', 'oferta.lidaEm']);

function valor(dados, caminho) {
  let v = dados;
  for (const k of caminho.split('.')) v = isObj(v) && Object.hasOwn(v, k) ? v[k] : undefined;
  return v;
}
const ausente = (v) => v == null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length);
const nao = (motivo, extra = {}) => ({ ok: false, motivo, ...extra });
const sim = (chamada) => ({ ok: true, motivo: '', chamada });

/** Leitura atual da oferta: número válido e não no futuro (com tolerância). */
function leitura(oferta, t) {
  const lida = ms(oferta.lidaEm);
  if (!Number.isFinite(lida) || lida > t + REGRAS.toleranciaRelogioMin * 60e3) return null;
  return lida;
}

const MODELOS_DEF = {
  'oferta-do-dia': {
    titulo: 'Oferta do dia',
    campos: BASE,
    regra: `preço lido nas últimas ${REGRAS.ofertaDoDiaHoras} h`,
    avaliar(_, { lida, t }) {
      if (t - lida > REGRAS.ofertaDoDiaHoras * H) return nao(MOTIVOS.VELHA);
      return sim('Oferta do dia');
    },
  },
  'queda-de-preco': {
    titulo: 'Queda de preço',
    campos: Object.freeze([...BASE, 'historico']),
    regra: `preço anterior registrado até ${REGRAS.historicoDias} dias antes da leitura e queda de pelo menos ${REGRAS.quedaMinima * 100}%`,
    avaliar({ oferta, historico }, { lida }) {
      if (!Array.isArray(historico)) return nao(MOTIVOS.SEM_HISTORICO);
      // Ponto anterior = o mais recente antes da leitura atual, dentro da janela. Ponto inválido é ignorado.
      let anterior = null;
      for (const p of historico) {
        const v = isObj(p) ? preco(p.preco) : null; const em = isObj(p) ? ms(p.em) : NaN;
        if (v == null || !Number.isFinite(em) || em >= lida || lida - em > REGRAS.historicoDias * DIA) continue;
        if (!anterior || em > anterior.em) anterior = { preco: v, em };
      }
      if (!anterior) return nao(MOTIVOS.SEM_HISTORICO);
      const queda = (anterior.preco - oferta.preco) / anterior.preco;
      if (!(queda >= REGRAS.quedaMinima)) return nao(MOTIVOS.SEM_QUEDA);
      const pctTxt = Math.floor(queda * 100);   // arredonda para baixo: nunca exagera a queda
      return sim(`Queda de preço: de ${money(anterior.preco)} em ${dia(anterior.em)} para ${money(oferta.preco)}${pctTxt >= 1 ? ` (${pctTxt}% menos)` : ''}`);
    },
  },
  reposicao: {
    titulo: 'Reposição',
    campos: Object.freeze([...BASE, 'oferta.emEstoque', 'reposicao.indisponivelEm']),
    regra: 'em estoque agora (emEstoque === true) e indisponível em data anterior à leitura',
    avaliar({ oferta, reposicao }, { lida }) {
      if (oferta.emEstoque !== true) return nao(MOTIVOS.SEM_ESTOQUE);
      const indisp = ms(reposicao?.indisponivelEm);
      if (!Number.isFinite(indisp) || indisp >= lida) return nao(MOTIVOS.SEM_INDISPONIBILIDADE);
      return sim(`De volta ao estoque: estava indisponível em ${dia(indisp)}`);
    },
  },
  comparacao: {
    titulo: 'Comparação de lojas',
    campos: Object.freeze([...BASE, 'comparacao.alternativas']),
    regra: 'ao menos uma alternativa válida de outra loja e a oferta é estritamente a menor, comparando total com frete só quando todas o têm',
    avaliar({ oferta, comparacao }) {
      const lojaOferta = txt(oferta.loja?.nome).toLowerCase();
      const alts = (Array.isArray(comparacao?.alternativas) ? comparacao.alternativas : []).filter((a) => isObj(a)
        && preco(a.preco) != null && txt(a.loja?.nome) && txt(a.loja.nome).toLowerCase() !== lojaOferta);
      if (alts.length + 1 < REGRAS.comparacaoMinLojas) return nao(MOTIVOS.SEM_ALTERNATIVAS);
      // Mesma base para todos: total com frete se todos o conhecem; senão, só o preço do produto (e o texto avisa).
      const total = (o) => (preco(o.precoTotal) != null && o.precoTotal >= o.preco ? o.precoTotal : null);
      const comTotal = total(oferta) != null && alts.every((a) => total(a) != null);
      const base = (o) => (comTotal ? total(o) : o.preco);
      if (alts.some((a) => base(a) <= base(oferta))) return nao(MOTIVOS.NAO_E_MENOR);   // empate não é "menor"
      const lojas = new Set([lojaOferta, ...alts.map((a) => txt(a.loja.nome).toLowerCase())]).size;
      return sim(`Comparação: menor ${comTotal ? 'total com frete' : 'preço (sem contar frete)'} entre ${lojas} lojas comparadas`);
    },
  },
};

/** Catálogo público (somente leitura): { id, titulo, campos, regra } por modelo. */
export const MODELOS = Object.freeze(Object.fromEntries(Object.entries(MODELOS_DEF).map(([id, m]) =>
  [id, Object.freeze({ id, titulo: m.titulo, campos: Object.freeze([...m.campos]), regra: m.regra })])));
export const IDS = Object.freeze(Object.keys(MODELOS));

/** dados = { oferta (formato de gerarRascunho, + emEstoque), historico: [{ preco, em }], reposicao: { indisponivelEm },
 *  comparacao: { alternativas: [{ loja: { nome }, preco, precoTotal }] } }.
 *  Devolve { ok, motivo, faltando, chamada? }; ok:false sempre com motivo explícito. */
export function verificarModelo(id, dados, { now } = {}) {
  if (typeof id !== 'string' || !Object.hasOwn(MODELOS_DEF, id)) return nao(MOTIVOS.MODELO, { faltando: [] });
  const m = MODELOS_DEF[id];
  const d = isObj(dados) ? dados : {};
  const faltando = m.campos.filter((c) => ausente(valor(d, c)));
  if (faltando.length) return nao(MOTIVOS.FALTANDO, { faltando });
  const t = nowDe(now);
  if (!Number.isFinite(t)) return nao(MOTIVOS.RELOGIO, { faltando: [] });
  if (preco(d.oferta.preco) == null) return nao(MOTIVOS.PRECO, { faltando: [] });
  const lida = leitura(d.oferta, t);
  if (lida == null) return nao(MOTIVOS.LEITURA, { faltando: [] });
  return { faltando: [], ...m.avaliar(d, { lida, t }) };
}

/** Modelos em que os dados se encaixam, na ordem do catálogo, e as recusas com motivo (para auditoria). */
export function modelosElegiveis(dados, { now } = {}) {
  const elegiveis = []; const recusados = [];
  for (const id of IDS) {
    const r = verificarModelo(id, dados, { now });
    if (r.ok) elegiveis.push(id); else recusados.push({ id, motivo: r.motivo, faltando: r.faltando });
  }
  return { elegiveis, recusados };
}

const erro = (m, extra) => Object.assign(new Error(`modelo social: ${m}`), { code: 'MODELO_RECUSADO', ...extra });

/** Gera o rascunho de um modelo: recusa (lança) se os dados não servem; senão usa gerarRascunho com a chamada do modelo.
 *  opts = { canal, siteUrl, now }. Devolve { modelo, canal, texto, link, avisos }. */
export function gerarPost(id, dados, { canal, siteUrl, now } = {}) {
  const r = verificarModelo(id, dados, { now });
  if (!r.ok) throw erro(`${String(id)} recusado: ${r.motivo}${r.faltando.length ? ` (${r.faltando.join(', ')})` : ''}`, { motivo: r.motivo, faltando: r.faltando });
  return { modelo: id, ...gerarRascunho(dados.oferta, { canal, siteUrl, chamada: r.chamada }) };
}
