// Social Media MVP — aprovação humana dos rascunhos e trilha de auditoria (issue #636; escopo em #631/#560).
// Módulo puro: não publica, não acessa rede, banco nem secrets. Desativado por padrão (SOCIAL_ENABLED ausente =
// desligado). Só operador autorizado (TAREFAS_OPERADORES, padrão: dono do repo) decide; rejeição exige motivo;
// item já decidido não muda. Cada decisão gera um evento append-only encadeado por sha256 (hashAnterior → hash),
// e a aprovação fixa o texto pelo hash: qualquer edição posterior invalida a aprovação.
// O evento guarda só o login do operador e hashes; o motivo passa por src/redact.js.
import { createHash } from 'node:crypto';
import { redact } from '../../redact.js';

export const SOCIAL_ENABLED_DEFAULT = false;
export const DECISOES = Object.freeze(['aprovar', 'rejeitar']);
export const STATUS = Object.freeze({ RASCUNHO: 'rascunho', APROVADO: 'aprovado', REJEITADO: 'rejeitado' });
export const HASH_INICIAL = '0'.repeat(64);
export const MOTIVO_MAX = 200;

const ESTADO_POR_DECISAO = { aprovar: STATUS.APROVADO, rejeitar: STATUS.REJEITADO };
const HEX64 = /^[a-f0-9]{64}$/;
const LOGIN = /^[a-z0-9](?:[a-z0-9-]{0,38})$/i;     // formato de login do GitHub: nada além do login do operador
const lower = (s) => String(s ?? '').trim().toLowerCase();
const operatorSet = (ops) => new Set((Array.isArray(ops) ? ops : String(ops ?? '').split(',')).map(lower).filter(Boolean));
const obj = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? o : {});

export const sha256 = (s) => createHash('sha256').update(String(s), 'utf8').digest('hex');

/** SOCIAL_ENABLED=1|true liga; ausente ou qualquer outro valor = desligado. */
export function socialEnabled(env = process.env) {
  const v = lower(obj(env).SOCIAL_ENABLED);
  return v ? v === '1' || v === 'true' : SOCIAL_ENABLED_DEFAULT;
}

/** Operadores autorizados como no tarefas.yml: TAREFAS_OPERADORES ou, na falta, o dono do repo (GITHUB_REPOSITORY). */
export function operadoresPadrao(env = process.env) {
  const e = obj(env);
  return [...operatorSet(e.TAREFAS_OPERADORES || String(e.GITHUB_REPOSITORY || '').split('/')[0])];
}

function isoDe(now) {
  const d = now instanceof Date ? now : new Date(now ?? Date.now());
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

// Ordem fixa dos campos no hash: o evento é verificável sem depender da ordem das chaves do objeto.
const conteudo = (e) => JSON.stringify([1, e.ts, e.operador, e.acao, e.itemId, e.hashTexto, e.motivo, e.hashAnterior]);

/** Registro de auditoria encadeado. hash = sha256 do conteúdo, incluindo hashAnterior (HASH_INICIAL no primeiro). */
export function eventoAuditoria({ ts, operador, acao, itemId, hashTexto, motivo = '', hashAnterior = HASH_INICIAL } = {}) {
  const e = {
    v: 1, ts: String(ts ?? ''), operador: lower(operador), acao: String(acao ?? ''), itemId: String(itemId ?? ''),
    hashTexto: String(hashTexto ?? ''), motivo: motivo ? redact(motivo, { max: MOTIVO_MAX }) : '', hashAnterior: String(hashAnterior ?? ''),
  };
  e.hash = sha256(conteudo(e));
  return Object.freeze(e);
}

/** Último hash da trilha (ponto de ancoragem para detectar remoção no fim). */
export const ultimoHash = (eventos) => (Array.isArray(eventos) && eventos.length ? String(eventos[eventos.length - 1]?.hash ?? '') : HASH_INICIAL);

/** Verifica a trilha: hash de cada evento, encadeamento, campos válidos e uma decisão por item.
 *  Detecta alteração, remoção ou reordenação no meio/início; para remoção no fim, informe `ultimoHash` guardado à parte. */
export function verificarTrilha(eventos, opts = {}) {
  const { ultimoHash: ancora } = obj(opts);
  if (!Array.isArray(eventos)) return { ok: false, erros: [{ indice: -1, motivo: 'trilha ausente ou inválida' }] };
  const erros = [];
  const decididos = new Set();
  let anterior = HASH_INICIAL;
  eventos.forEach((ev, i) => {
    const e = obj(ev);
    if (!DECISOES.includes(e.acao)) erros.push({ indice: i, motivo: 'ação inválida' });
    if (!LOGIN.test(String(e.operador ?? ''))) erros.push({ indice: i, motivo: 'operador inválido' });
    if (!e.itemId) erros.push({ indice: i, motivo: 'item ausente' });
    if (!HEX64.test(String(e.hashTexto ?? ''))) erros.push({ indice: i, motivo: 'hash do texto inválido' });
    if (e.acao === 'rejeitar' && !String(e.motivo ?? '').trim()) erros.push({ indice: i, motivo: 'rejeição sem motivo' });
    if (e.hash !== sha256(conteudo(e))) erros.push({ indice: i, motivo: 'evento alterado (hash não confere)' });
    if (e.hashAnterior !== anterior) erros.push({ indice: i, motivo: 'encadeamento quebrado (remoção ou reordenação)' });
    if (e.itemId && decididos.has(e.itemId)) erros.push({ indice: i, motivo: 'item decidido mais de uma vez' });
    decididos.add(e.itemId);
    anterior = e.hash;
  });
  if (ancora != null && ancora !== ultimoHash(eventos)) erros.push({ indice: eventos.length, motivo: 'último hash diverge da âncora (evento removido no fim)' });
  return { ok: erros.length === 0, erros };
}

const falha = (item, erro) => ({ ok: false, erro, item, evento: null });

/** Decide um rascunho. item = { id, texto, status? }; trilha = eventos anteriores (o novo evento encadeia no último).
 *  Retorna { ok, erro, item, evento }; em falha o item volta inalterado e nenhum evento é gerado (falha fechada). */
export function decidir(item, opts = {}) {
  const { decisao, operador, motivo, now, operadores, trilha = [], env = process.env } = obj(opts);
  const enabled = obj(opts).enabled ?? socialEnabled(env);
  if (enabled !== true) return falha(item, 'social desativado (SOCIAL_ENABLED)');
  const it = obj(item);
  if (!it.id || typeof it.texto !== 'string' || !it.texto.trim()) return falha(item, 'item inválido: id e texto obrigatórios');
  if (!DECISOES.includes(decisao)) return falha(item, 'decisão inválida');
  const login = lower(operador);
  const autorizados = operatorSet(operadores ?? operadoresPadrao(env));
  if (!LOGIN.test(login) || !autorizados.has(login)) return falha(item, 'operador não autorizado');
  if (decisao === 'rejeitar' && !String(motivo ?? '').trim()) return falha(item, 'rejeição exige motivo');
  if ((it.status ?? STATUS.RASCUNHO) !== STATUS.RASCUNHO || it.aprovacao) return falha(item, 'item já decidido');
  const v = verificarTrilha(trilha);
  if (!v.ok) return falha(item, 'trilha de auditoria inválida');
  if (trilha.some((e) => e.itemId === String(it.id))) return falha(item, 'item já decidido');
  const ts = isoDe(now);
  if (!ts) return falha(item, 'data inválida');
  const evento = eventoAuditoria({
    ts, operador: login, acao: decisao, itemId: it.id, hashTexto: sha256(it.texto),
    motivo: motivo ? String(motivo).trim() : '', hashAnterior: ultimoHash(trilha),
  });
  const aprovacao = Object.freeze({ decisao, operador: login, ts, hashTexto: evento.hashTexto, evento: evento.hash });
  return { ok: true, erro: '', item: Object.freeze({ ...it, status: ESTADO_POR_DECISAO[decisao], aprovacao }), evento };
}

/** A aprovação só vale para o texto aprovado: editar o texto depois (hash diferente) a invalida.
 *  Com `trilha`, exige também trilha íntegra contendo o evento de aprovação deste item. */
export function aprovacaoValida(item, opts = {}) {
  const it = obj(item); const a = obj(it.aprovacao);
  if (it.status !== STATUS.APROVADO || a.decisao !== 'aprovar' || typeof it.texto !== 'string') return false;
  if (a.hashTexto !== sha256(it.texto)) return false;
  const { trilha } = obj(opts);
  if (trilha === undefined) return true;
  if (!verificarTrilha(trilha).ok) return false;
  return trilha.some((e) => e.hash === a.evento && e.itemId === String(it.id) && e.acao === 'aprovar' && e.hashTexto === a.hashTexto);
}
