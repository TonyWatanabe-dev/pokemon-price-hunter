// Social Media MVP — adaptador Instagram em modo simulação (issue #651; escopo da #631/#560). Desativado por padrão.
// Monta o fluxo oficial da Instagram Graph API (1. criar container de mídia em /{ig-user-id}/media; 2. publicar em
// /{ig-user-id}/media_publish com o creation_id) a partir de um item APROVADO da fila (src/agents/social/fila.js).
// Por padrão é dry-run: só devolve as requisições que seriam feitas, com o token mascarado. Recusa (falha fechada) sem
// SOCIAL_ENABLED, com canal pausado (SOCIAL_PAUSA), sem item aprovado do canal instagram ou sem token passado pelo
// chamador. Não lê process.env nem secrets, não usa o fetch global: rede só com dryRun === false E fetch injetado.
// Não muda a fila (a transição para 'publicado' continua fora do MVP) nem mexe em ranking, preço ou link de afiliado.
import { habilitado, pausado, validarFila, VERSAO } from './fila.js';
import { LIMITES } from './rascunho.js';
import { redact } from '../../redact.js';

export const CANAL = 'instagram';
export const GRAPH_HOST = 'graph.facebook.com';
export const GRAPH_VERSAO = 'v21.0';
export const TOKEN_MASCARA = '***';
export const TIMEOUT_MS = 10000;
export const ETAPAS = Object.freeze(['criar_container', 'publicar']);
export const CREATION_ID_PENDENTE = '<id do container da etapa criar_container>';

const IG_USER = /^\d{1,30}$/;
const VERSAO_RE = /^v\d{1,3}\.\d{1,2}$/;
const ID_RESPOSTA = /^\d{1,40}$/;
const obj = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? o : {});
const https = (u) => { if (typeof u !== 'string') return null; try { const x = new URL(u); return x.protocol === 'https:' && x.host && !x.username && !x.password ? x : null; } catch { return null; } };
const recusa = (motivo) => ({ ok: false, status: 'recusado', motivo, requisicoes: [] });

/** Confere tudo antes de qualquer chamada. Devolve { erro } ou { item, igUserId, imagemUrl, token, versao }. */
function preparar(item, opts) {
  const { env = {}, token, igUserId, imagemUrl, versao = GRAPH_VERSAO } = opts;
  if (!habilitado(env)) return { erro: 'social desativado (SOCIAL_ENABLED)' };
  if (pausado(CANAL, env)) return { erro: 'canal instagram pausado (SOCIAL_PAUSA)' };
  let it;
  try { [it] = validarFila({ versao: VERSAO, itens: [item] }).itens; } catch { return { erro: 'item inválido' }; }
  if (it.canal !== CANAL) return { erro: 'item não é do canal instagram' };
  if (it.estado !== 'aprovado') return { erro: 'item não aprovado' };
  if (!it.texto.trim()) return { erro: 'item sem texto' };
  if (it.texto.length > LIMITES.instagram) return { erro: `legenda acima de ${LIMITES.instagram} caracteres` };
  if (typeof token !== 'string' || !token.trim() || /\s/.test(token.trim())) return { erro: 'token ausente: deve ser passado pelo chamador' };
  if (typeof igUserId !== 'string' || !IG_USER.test(igUserId)) return { erro: 'igUserId inválido' };
  if (!https(imagemUrl)) return { erro: 'imagemUrl não é https' };
  if (typeof versao !== 'string' || !VERSAO_RE.test(versao)) return { erro: 'versão da Graph API inválida' };
  return { item: it, igUserId, imagemUrl: https(imagemUrl).href, token: token.trim(), versao };
}

function requisicao(etapa, p, corpo, token) {
  const caminho = etapa === 'criar_container' ? 'media' : 'media_publish';
  return {
    etapa, metodo: 'POST', url: `https://${GRAPH_HOST}/${p.versao}/${p.igUserId}/${caminho}`,
    cabecalhos: { 'content-type': 'application/x-www-form-urlencoded' },
    corpo: { ...corpo, access_token: token },
  };
}

/** As duas requisições do fluxo oficial, com o token mascarado (o creation_id só existe após a etapa 1). */
function requisicoesMascaradas(p) {
  return [
    requisicao('criar_container', p, { image_url: p.imagemUrl, caption: p.item.texto }, TOKEN_MASCARA),
    requisicao('publicar', p, { creation_id: CREATION_ID_PENDENTE }, TOKEN_MASCARA),
  ];
}

/** Só monta (nunca chama) as requisições que seriam feitas. Mesmas recusas do publicarInstagram. */
export function montarRequisicoes(item, opts = {}) {
  const p = preparar(item, obj(opts));
  if (p.erro) return recusa(p.erro);
  return { ok: true, status: 'simulado', motivo: '', itemId: p.item.id, requisicoes: requisicoesMascaradas(p) };
}

// Erros e respostas da API passam por redact com o token do chamador: o token nunca volta no resultado.
const limpo = (s, token) => redact(s, { env: { IG_ACCESS_TOKEN: token }, max: 200 });

async function chamar(fetchFn, req, token, timeoutMs) {
  const corpo = new URLSearchParams(req.corpo).toString();
  const init = { method: req.metodo, headers: req.cabecalhos, body: corpo, redirect: 'error' };
  if (typeof AbortSignal?.timeout === 'function') init.signal = AbortSignal.timeout(timeoutMs);
  let res;
  try { res = await fetchFn(req.url, init); } catch (e) { return { erro: `falha de rede: ${limpo(e?.message ?? e, token)}` }; }
  let dado = null;
  try { dado = await res.json(); } catch { /* resposta sem JSON é tratada abaixo */ }
  if (!res?.ok) {
    const msg = obj(obj(dado).error).message;
    return { erro: `HTTP ${Number(res?.status) || 0}${msg ? ': ' + limpo(msg, token) : ''}` };
  }
  const id = obj(dado).id;
  if (typeof id !== 'string' || !ID_RESPOSTA.test(id)) return { erro: 'resposta sem id válido' };
  return { id };
}

/** Executa o fluxo para um item aprovado. opts = { env, token, igUserId, imagemUrl, versao?, dryRun = true, fetch?, timeoutMs? }.
 *  dryRun (padrão) devolve { status: 'simulado', requisicoes } sem rede. Só com dryRun === false e fetch injetado chama a API:
 *  { status: 'publicado', creationId, mediaId } ou { status: 'erro', etapa, motivo }. Nunca lança; nunca muta o item. */
export async function publicarInstagram(item, opts = {}) {
  const o = obj(opts);
  const p = preparar(item, o);
  if (p.erro) return recusa(p.erro);
  const requisicoes = requisicoesMascaradas(p);
  if (o.dryRun !== false) return { ok: true, status: 'simulado', motivo: '', itemId: p.item.id, requisicoes };
  if (typeof o.fetch !== 'function') return recusa('fetch não injetado: o adaptador não usa a rede sozinho');
  const timeoutMs = Number.isFinite(o.timeoutMs) && o.timeoutMs > 0 ? o.timeoutMs : TIMEOUT_MS;

  const c = await chamar(o.fetch, requisicao('criar_container', p, { image_url: p.imagemUrl, caption: p.item.texto }, p.token), p.token, timeoutMs);
  if (c.erro) return { ok: false, status: 'erro', etapa: 'criar_container', motivo: c.erro, itemId: p.item.id, requisicoes };
  const m = await chamar(o.fetch, requisicao('publicar', p, { creation_id: c.id }, p.token), p.token, timeoutMs);
  if (m.erro) return { ok: false, status: 'erro', etapa: 'publicar', motivo: m.erro, itemId: p.item.id, creationId: c.id, requisicoes };
  return { ok: true, status: 'publicado', motivo: '', itemId: p.item.id, creationId: c.id, mediaId: m.id, requisicoes };
}
