// Social Media MVP — adaptador Telegram em modo simulação (issue #650; escopo da #631/#560). Desativado por padrão.
// Monta a chamada sendMessage da Bot API oficial a partir de um item APROVADO da fila (fila.js). Por padrão é dry-run:
// devolve a requisição que seria feita (token mascarado) e não chama nada. Só envia com simular === false E um fetch
// injetado pelo chamador; nunca usa o fetch global, nunca lê o ambiente do processo nem secrets: token e chat vêm do chamador.
// Recusa (falha fechada, sem chamar fetch) se SOCIAL_ENABLED não estiver ligado, se o canal estiver pausado
// (SOCIAL_PAUSA), se o item não for um item aprovado do Telegram ou se faltar token/chat. Sem retentativa: repetir
// um envio que pode ter chegado duplicaria o post. Não muda o estado da fila (a transição para 'publicado' segue
// recusada em fila.js); registrar o resultado é decisão do chamador.
import { habilitado, pausado, validarFila, VERSAO } from './fila.js';
import { redact } from '../../redact.js';

export const SOCIAL_ENABLED_DEFAULT = false;
export const CANAL = 'telegram';
export const API_PADRAO = 'https://api.telegram.org';
export const TEXTO_MAX = 4096;          // limite de texto do sendMessage
export const TIMEOUT_PADRAO_MS = 10000;
export const MOTIVOS = Object.freeze({
  DESLIGADO: 'social desativado (SOCIAL_ENABLED)',
  PAUSADO: 'canal pausado (SOCIAL_PAUSA)',
  ITEM_INVALIDO: 'item inválido',
  NAO_APROVADO: 'item não aprovado',
  OUTRO_CANAL: 'item não é do canal telegram',
  TEXTO_INVALIDO: 'texto vazio ou acima do limite',
  SEM_TOKEN: 'token ausente ou inválido (passado pelo chamador)',
  SEM_CHAT: 'chat ausente ou inválido',
  SEM_FETCH: 'envio real exige fetch injetado',
  API_INVALIDA: 'apiBase inválida',
  SEM_FOTO: 'foto ausente ou não é URL https',
  LEGENDA_LONGA: 'legenda acima de 1024 caracteres',
});

const TOKEN = /^\d{1,20}:[\w-]{20,100}$/;
const CHAT = /^(?:-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$/;

const recusa = (motivo, item) => ({ ok: false, status: 'recusado', motivo, itemId: typeof item?.id === 'string' ? item.id : null, requisicao: null });
const mascarar = (s, token) => redact(token ? String(s ?? '').split(token).join('***') : s, { env: {}, max: 200 });

function apiValida(apiBase) {
  try {
    const u = new URL(apiBase);
    return u.protocol === 'https:' && u.host && !u.username && !u.password && !u.search && !u.hash ? u.origin + u.pathname.replace(/\/+$/, '') : null;
  } catch { return null; }
}

/** Confere tudo antes de montar a chamada. Devolve { motivo } na primeira recusa ou { item, url, body } pronto. */
function preparar(item, o) {
  if (!habilitado(o.env)) return { motivo: MOTIVOS.DESLIGADO };
  if (pausado(CANAL, o.env)) return { motivo: MOTIVOS.PAUSADO };
  let it;
  try { it = validarFila({ versao: VERSAO, itens: [item] }).itens[0]; } catch { return { motivo: MOTIVOS.ITEM_INVALIDO }; }
  if (it.estado !== 'aprovado') return { motivo: MOTIVOS.NAO_APROVADO };
  if (it.canal !== CANAL) return { motivo: MOTIVOS.OUTRO_CANAL };
  if (!it.texto.trim() || it.texto.length > TEXTO_MAX) return { motivo: MOTIVOS.TEXTO_INVALIDO };
  if (typeof o.token !== 'string' || !TOKEN.test(o.token)) return { motivo: MOTIVOS.SEM_TOKEN };
  const chat = typeof o.chatId === 'number' && Number.isSafeInteger(o.chatId) ? String(o.chatId) : o.chatId;
  if (typeof chat !== 'string' || !CHAT.test(chat)) return { motivo: MOTIVOS.SEM_CHAT };
  const base = apiValida(o.apiBase ?? API_PADRAO);
  if (!base) return { motivo: MOTIVOS.API_INVALIDA };
  // Texto puro (sem parse_mode): o rascunho não pode virar Markdown/HTML na publicação.
  return { item: it, url: `${base}/bot${o.token}/sendMessage`, body: { chat_id: chat, text: it.texto } };
}

const simulado = (p, token) => ({
  ok: true, status: 'simulado', motivo: '', itemId: p.item.id,
  requisicao: { method: 'POST', url: p.url.split(token).join('***'), headers: { 'content-type': 'application/json' }, body: JSON.stringify(p.body) },
});

/** Requisição sendMessage para um item aprovado, sem enviar. A URL volta com o token mascarado.
 *  opts = { env, token, chatId, apiBase? }. Retorna { ok, status: 'simulado' | 'recusado', motivo, itemId, requisicao }. */
export function montarRequisicao(item, opts = {}) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const p = preparar(item, o);
  return p.motivo ? recusa(p.motivo, item) : simulado(p, o.token);
}

/** Publica (ou simula) um item aprovado. Dry-run por padrão: só com simular === false e fetch injetado chama a API.
 *  opts = { env, token, chatId, fetch, simular = true, apiBase?, timeoutMs? }. Nunca lança por falha de rede/API:
 *  retorna { ok, status: 'simulado' | 'enviado' | 'falhou' | 'recusado', motivo, itemId, requisicao, messageId? },
 *  com o token mascarado em qualquer texto de erro. */
export async function publicar(item, opts = {}) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const p = preparar(item, o);
  if (p.motivo) return recusa(p.motivo, item);
  const sim = simulado(p, o.token);
  if (o.simular !== false) return sim;
  if (typeof o.fetch !== 'function') return recusa(MOTIVOS.SEM_FETCH, item);
  const ms = Number.isFinite(o.timeoutMs) && o.timeoutMs > 0 ? o.timeoutMs : TIMEOUT_PADRAO_MS;
  const base = { itemId: sim.itemId, requisicao: sim.requisicao };
  try {
    const r = await o.fetch(p.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p.body), signal: AbortSignal.timeout(ms) });
    let dado = null;
    try { dado = await r.json(); } catch { /* corpo não-JSON: decide pelo status */ }
    if (!r.ok || dado?.ok !== true) {
      const desc = dado && typeof dado.description === 'string' ? `: ${dado.description}` : '';
      return { ok: false, status: 'falhou', motivo: mascarar(`HTTP ${r.status}${desc}`, o.token), ...base };
    }
    const messageId = Number.isSafeInteger(dado.result?.message_id) ? dado.result.message_id : null;
    return { ok: true, status: 'enviado', motivo: '', ...base, messageId };
  } catch (e) {
    return { ok: false, status: 'falhou', motivo: mascarar(e?.message || 'erro de rede', o.token), ...base };
  }
}

// ---------------------------------------------------------------- sendPhoto (piloto #690)
// Mesmo gate de preparar(), com foto por URL https pública (imagem original da oferta) e legenda até 1024 caracteres.
export const LEGENDA_MAX = 1024;
function fotoValida(u) {
  try { const x = new URL(u); return x.protocol === 'https:' && !x.username && !x.password ? x.href : null; } catch { return null; }
}
function prepararFoto(item, o) {
  const p = preparar(item, o);
  if (p.motivo) return p;
  if (p.item.texto.length > LEGENDA_MAX) return { motivo: MOTIVOS.LEGENDA_LONGA };
  const arquivo = o.arquivo instanceof Uint8Array && o.arquivo.length > 0 ? o.arquivo : null;   // card gerado (JPEG)
  const foto = arquivo ? null : fotoValida(o.foto);
  if (!arquivo && !foto) return { motivo: MOTIVOS.SEM_FOTO };
  const body = { chat_id: p.body.chat_id, photo: foto ?? '(arquivo card.jpg)', caption: p.item.texto };
  if (o.parseMode === 'HTML') body.parse_mode = 'HTML';
  return { item: p.item, url: p.url.replace(/\/sendMessage$/, '/sendPhoto'), body, arquivo };
}
// Envio com arquivo: multipart (FormData nativo do Node); sem arquivo: JSON com a URL da foto.
function corpo(p) {
  if (!p.arquivo) return { headers: { 'content-type': 'application/json' }, body: JSON.stringify(p.body) };
  const fd = new FormData();
  for (const [k, v] of Object.entries(p.body)) if (k !== 'photo') fd.append(k, String(v));
  fd.append('photo', new Blob([p.arquivo], { type: 'image/jpeg' }), 'card.jpg');
  return { body: fd };
}
/** Como publicar(), via sendPhoto. opts = { env, token, chatId, foto | arquivo (Uint8Array JPEG), parseMode?, fetch, simular = true, apiBase?, timeoutMs? }. */
export async function publicarFoto(item, opts = {}) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const p = prepararFoto(item, o);
  if (p.motivo) return recusa(p.motivo, item);
  const sim = simulado(p, o.token);
  if (o.simular !== false) return sim;
  if (typeof o.fetch !== 'function') return recusa(MOTIVOS.SEM_FETCH, item);
  const ms = Number.isFinite(o.timeoutMs) && o.timeoutMs > 0 ? o.timeoutMs : TIMEOUT_PADRAO_MS;
  const base = { itemId: sim.itemId, requisicao: sim.requisicao };
  try {
    const r = await o.fetch(p.url, { method: 'POST', ...corpo(p), signal: AbortSignal.timeout(ms) });
    let dado = null;
    try { dado = await r.json(); } catch { /* corpo não-JSON */ }
    if (!r.ok || dado?.ok !== true) {
      const desc = dado && typeof dado.description === 'string' ? `: ${dado.description}` : '';
      return { ok: false, status: 'falhou', motivo: mascarar(`HTTP ${r.status}${desc}`, o.token), ...base };
    }
    const messageId = Number.isSafeInteger(dado.result?.message_id) ? dado.result.message_id : null;
    return { ok: true, status: 'enviado', motivo: '', ...base, messageId };
  } catch (e) {
    return { ok: false, status: 'falhou', motivo: mascarar(e?.message || 'erro de rede', o.token), ...base };
  }
}
