// Alertas de preço por usuário no Telegram (decisão do proprietário, 15/10/2026; docs/alertas-telegram-usuario.md).
// Desligado por padrão: só liga com ALERTAS_TELEGRAM_USUARIO=1 + FIREBASE_SERVICE_ACCOUNT + TELEGRAM_BOT_TOKEN (o bot de
// alertas que já existe). Falta qualquer um = tudo desligado, nenhum comando de terceiros é atendido (como antes).
//
// Vínculo (consentimento explícito): o site grava em users/{uid}.telegramPedido o hash SHA-256 de um segredo aleatório e
// abre https://t.me/<bot>?start=<uid>_<segredo>. O /start com esse token, numa conversa privada com o bot, liga o chat_id
// à conta (users/{uid}.telegram, gravado só pelo robô) e apaga o pedido: uso único, válido por TTL_MS a partir da criação
// (medido pela hora da mensagem no Telegram, não pela hora em que a rodada leu). /parar desliga; /status mostra.
// Nenhum e-mail ou telefone é guardado. Os comandos chegam pelo getUpdates que a rodada já faz (src/inbox.js; offset em
// data/inbox.json): GitHub Actions não recebe webhook, e o bot só aceita um leitor de getUpdates.
//
// Envio: o mesmo emissor dos alertas do dono (evaluate/dedupe/compose/capPerUser de src/alerts.js) roda por usuário, só
// com as regras do próprio documento (alerts: [{ p, v }]) e só para o chat ligado a ele. O registro de envios fica em
// users/{uid}.telegram.envios (apagado junto com a conta); cada envio é reservado ANTES de sair (no máximo um aviso por
// condição mesmo se a rodada cair no meio) e a reserva de um envio que falhou é desfeita (a próxima rodada tenta de novo).
import crypto from 'node:crypto';
import { evaluate, dedupe, compose, capPerUser, pruneSent, telegramBody, CHANNEL_DOWN_AFTER } from './alerts.js';
import { parseServiceAccount, motivoServiceAccount, firestoreClient } from './firestore-rest.js';
import { shipKnown } from '../api/_lib/offer-rank.mjs';

export const FLAG = 'ALERTAS_TELEGRAM_USUARIO';
export const TTL_MS = 30 * 60e3;          // vínculo vale 30 min a partir da criação no site
export const SKEW_MS = 2 * 60e3;          // tolerância de relógio (a regra do Firestore aceita criadoEm até 2 min fora)
export const MAX_DIA_PADRAO = 10;         // alertas por usuário por dia (capPerUser)
export const MAX_USUARIOS = 500;          // usuários ligados lidos por rodada
export const MAX_COMANDOS = 50;           // comandos de usuários atendidos por rodada
export const MAX_REGRAS = 50;             // = limite de alertas da página e da regra do Firestore
export const API_TIMEOUT_MS = 10000;

export const TEXTOS = Object.freeze({
  AJUDA: 'Para receber seus alertas de preço aqui, entre no site, abra "Alertas de preço" e toque em "Ativar alertas no Telegram".',
  PRIVADO: 'Use este comando numa conversa privada com o bot.',
  INVALIDO: 'Esse link de ativação não vale (já foi usado ou foi trocado por outro). Gere um novo no site, em "Alertas de preço".',
  EXPIRADO: 'Esse link de ativação expirou (vale 30 minutos). Gere um novo no site, em "Alertas de preço".',
  LIGADO: '✅ Alertas ligados. Você vai receber aqui os alertas de preço da sua conta, no máximo alguns por dia.\n\n/status mostra o estado · /parar desliga',
  JA_LIGADO: 'Os alertas desta conta já estão ligados neste chat. /parar desliga.',
  DESLIGADO: 'Alertas desligados. Nada mais será enviado aqui. Para ligar de novo, use o botão no site.',
  NADA: 'Nenhuma conta está ligada a este chat. Para ligar, use o botão no site, em "Alertas de preço".',
  ERRO: 'Não consegui concluir agora. Tente de novo em alguns minutos.',
});

export const ligado = (env = {}) => String(env[FLAG] || '') === '1';
export const sha256hex = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const iguais = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Comando do usuário: /start [token], /parar, /status (aceita /cmd@NomeDoBot). null = não é comando de usuário. */
export function parseComando(text) {
  const m = String(text || '').trim().match(/^\/(start|parar|status)(?:@[A-Za-z0-9_]{1,64})?(?:\s+(\S+))?\s*$/);
  return m ? { cmd: m[1], arg: m[2] || '' } : null;
}
/** Token do deep link: <uid>_<segredo de 32 hex> (até 64 caracteres, o limite do parâmetro start). */
export function parseToken(arg) {
  const m = String(arg || '').match(/^([A-Za-z0-9]{1,31})_([0-9a-f]{32})$/);
  return m ? { uid: m[1], segredo: m[2] } : null;
}

/**
 * Trata um comando de usuário. msg = message do Telegram; ctx = { fs, reply(chatId, texto) }.
 * Idempotente: repetir o mesmo update (rodada que caiu antes de gravar o offset) não muda o resultado.
 * Retorna a ação ('ligado' | 'ja-ligado' | 'invalido' | 'expirado' | 'desligado' | 'nada' | 'status' | 'ajuda' | 'privado').
 */
export async function tratarComando(msg, { fs, reply }) {
  const c = parseComando(msg?.text); if (!c) return null;
  const chat = msg.chat?.id;
  if (!Number.isSafeInteger(chat)) return null;
  const responder = async (t, acao) => { await reply(chat, t); return acao; };
  if (msg.chat.type !== 'private') return responder(TEXTOS.PRIVADO, 'privado');
  if (c.cmd === 'start') {
    if (!c.arg) return responder(TEXTOS.AJUDA, 'ajuda');
    const tk = parseToken(c.arg); if (!tk) return responder(TEXTOS.INVALIDO, 'invalido');
    const h = sha256hex(tk.segredo);
    const u = await fs.getUser(tk.uid);
    const t = u?.data?.telegram;
    if (t && t.chatId === chat && iguais(t.hash, h)) return responder(TEXTOS.JA_LIGADO, 'ja-ligado');
    const p = u?.data?.telegramPedido;
    if (!u || !p || !iguais(p.hash, h)) return responder(TEXTOS.INVALIDO, 'invalido');
    const idade = Number(msg.date) * 1000 - Number(p.criadoEm);
    if (!Number.isFinite(idade) || idade > TTL_MS || idade < -SKEW_MS) return responder(TEXTOS.EXPIRADO, 'expirado');
    // Liga e consome o pedido na MESMA gravação, só se o documento não mudou desde a leitura (uso único).
    await fs.patchUser(tk.uid, { telegram: { chatId: chat, ligadoEm: new Date(Number(msg.date) * 1000).toISOString(), hash: h, envios: {}, dia: '', nDia: 0 } },
      ['telegram', 'telegramPedido'], { updateTime: u.updateTime });
    return responder(TEXTOS.LIGADO, 'ligado');
  }
  const contas = await fs.linkedUsers({ chatId: chat, limit: 20 });
  if (c.cmd === 'parar') {
    if (!contas.length) return responder(TEXTOS.NADA, 'nada');
    for (const u of contas) await fs.patchUser(u.uid, {}, ['telegram'], { updateTime: u.updateTime });
    return responder(TEXTOS.DESLIGADO, 'desligado');
  }
  if (!contas.length) return responder(TEXTOS.NADA, 'nada');
  const n = contas.reduce((s, u) => s + (Array.isArray(u.data.alerts) ? u.data.alerts.length : 0), 0);
  return responder(`Alertas no Telegram: ligados${contas.length > 1 ? ` (${contas.length} contas)` : ''}. Você tem ${n} ${n === 1 ? 'alerta' : 'alertas'} de preço.\n\n/parar desliga`, 'status');
}

/** Alertas do documento (página: [{ p: produto, v: preço-alvo }]) como regras de preço-alvo do emissor. */
export function regrasDoUsuario(alerts) {
  const out = [];
  for (const a of Array.isArray(alerts) ? alerts.slice(0, MAX_REGRAS) : []) {
    if (!a || typeof a.p !== 'string' || !a.p || !(typeof a.v === 'number' && Number.isFinite(a.v) && a.v > 0)) continue;
    out.push({ id: 'usuario', label: 'Seu alerta de preço', mode: 'target', filter: { productId: a.p }, maxPrice: a.v });
  }
  return out;
}

const DIA = (now) => new Date(now.getTime() - 3 * 3600e3).toISOString().slice(0, 10); // dia em Brasília (UTC-3)

/** Pura: o que vai para um usuário nesta rodada. Só lê o próprio documento (alerts e telegram.envios). */
export function planejar(data, { offers, products, opp = new Map(), now = new Date(), settings = {}, maxDia = MAX_DIA_PADRAO }) {
  const t = data?.telegram || {}; const envios = t.envios && typeof t.envios === 'object' ? t.envios : {};
  const offersById = Object.fromEntries((offers || []).map((o) => [o.id, o]));
  const prods = Object.fromEntries(Object.entries(products || {}));
  const rules = regrasDoUsuario(data?.alerts).filter((r) => prods[r.filter.productId]);
  const hits = evaluate(rules, (offers || []).filter((o) => prods[o.productId]), [], prods, { opp }).sort((a, b) => a.key.localeCompare(b.key));
  const hoje = DIA(now); const jaHoje = t.dia === hoje ? Number(t.nDia) || 0 : 0;
  return { enviar: capPerUser(dedupe(hits, envios, settings, now.getTime(), offersById), jaHoje, maxDia), hoje, jaHoje, envios };
}

/** Envia ao chat do usuário. 'ok' | 'bloqueado' (403: a pessoa bloqueou o bot = retirou o consentimento) | 'falhou'. */
export async function enviar(msg, chatId, { token, fetch: f, timeoutMs = API_TIMEOUT_MS }) {
  try {
    const r = await f(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(timeoutMs), body: JSON.stringify(telegramBody(msg, chatId)) });
    if (r.status === 403) return 'bloqueado';
    const j = await r.json().catch(() => null);
    return r.ok && j?.ok === true ? 'ok' : 'falhou';
  } catch { return 'falhou'; }
}

/**
 * Entrega os alertas de todos os usuários ligados. ctx = { fs, token, fetch, offers, products, opp, now, settings, maxDia, maxUsuarios }.
 * Retorna contagens (nunca uid nem chat: o log da Action é público).
 */
export async function entregar(ctx) {
  const { fs, now = new Date(), maxUsuarios = MAX_USUARIOS } = ctx;
  const st = { usuarios: 0, enviados: 0, falhas: 0, bloqueados: 0, erros: 0 };
  let seguidas = 0;
  for (const u of await fs.linkedUsers({ limit: maxUsuarios })) {
    const t = u.data?.telegram; if (!t || !Number.isSafeInteger(t.chatId) || t.chatId <= 0) continue;
    st.usuarios++;
    const plano = planejar(u.data, ctx); if (!plano.enviar.length) continue;
    const at = now.toISOString();
    const reg = (h, estado) => ({ at, total: h.offer.total, shippingKnown: shipKnown(h.offer), discount: h.offer.discount ?? null, offerId: h.offer.id, estado });
    // 1) Reserva: grava antes de enviar. Se a gravação falhar (documento mudou, ex.: desligou no site), não envia nada.
    const base = pruneSent(plano.envios, now);
    const reservado = { ...base }; for (const h of plano.enviar) reservado[h.key] = reg(h, 'enviando');
    let upd;
    try { upd = await fs.patchUser(u.uid, { telegram: { ...t, envios: reservado, dia: plano.hoje, nDia: plano.jaHoje + plano.enviar.length } }, ['telegram'], { updateTime: u.updateTime }); }
    catch { st.erros++; continue; }
    // 2) Envio, só para o chat deste usuário.
    const final = { ...base }; let ok = 0; let bloqueado = false;
    for (const h of plano.enviar) {
      const r = seguidas >= CHANNEL_DOWN_AFTER || bloqueado ? 'falhou' : await enviar(compose(h), t.chatId, ctx);
      if (r === 'ok') { ok++; seguidas = 0; final[h.key] = reg(h, 'ok'); continue; }
      if (r === 'bloqueado') bloqueado = true; else seguidas++;
      if (plano.envios[h.key]) final[h.key] = plano.envios[h.key]; // falhou: volta ao registro anterior (a próxima rodada tenta de novo)
    }
    st.enviados += ok; st.falhas += plano.enviar.length - ok;
    // 3) Confirma. Bloqueou o bot: desliga o vínculo. Se esta gravação falhar, a reserva fica e conta como enviado: um
    //    alerta pode se perder até o fim do cooldown, mas nunca sai em dobro.
    try {
      if (bloqueado) { st.bloqueados++; await fs.patchUser(u.uid, {}, ['telegram'], { updateTime: upd.updateTime }); }
      else await fs.patchUser(u.uid, { telegram: { ...t, envios: final, dia: plano.hoje, nDia: plano.jaHoje + ok } }, ['telegram'], { updateTime: upd.updateTime });
    } catch { st.erros++; }
  }
  return st;
}

/**
 * Contexto da rodada (src/run.js). null = recurso desligado ou sem configuração (falha fechada).
 * env: ALERTAS_TELEGRAM_USUARIO, FIREBASE_SERVICE_ACCOUNT, TELEGRAM_BOT_TOKEN, ALERTAS_TELEGRAM_USUARIO_MAX_DIA (opcional).
 * opts.fs permite injetar o cliente do Firestore (testes).
 */
export function contexto(env = {}, { fetch: f = globalThis.fetch, fs, log = () => {} } = {}) {
  if (!ligado(env)) return null;
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) { log('[alertas-usuario] ligado, mas sem TELEGRAM_BOT_TOKEN: desligado'); return null; }
  if (!fs) {
    const sa = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT);
    if (!sa) { log(`[alertas-usuario] ligado, mas sem FIREBASE_SERVICE_ACCOUNT válido (${motivoServiceAccount(env.FIREBASE_SERVICE_ACCOUNT)}): desligado`); return null; }
    fs = firestoreClient({ serviceAccount: sa, fetch: f });
  }
  const maxDia = Math.max(1, Math.min(50, Math.floor(Number(env.ALERTAS_TELEGRAM_USUARIO_MAX_DIA) || MAX_DIA_PADRAO)));
  let nomeBot;
  return {
    fs, token, maxDia,
    tratar: (msg, reply) => tratarComando(msg, { fs, reply }),
    entregar: (dados) => entregar({ ...dados, fs, token, fetch: f, maxDia }),
    /** Nome público do bot (getMe), para o link t.me/<bot> do site. null se não der para ler. */
    async bot() {
      if (nomeBot !== undefined) return nomeBot;
      try {
        const r = await f(`https://api.telegram.org/bot${token}/getMe`, { method: 'POST', signal: AbortSignal.timeout(API_TIMEOUT_MS) });
        const u = (await r.json())?.result?.username;
        nomeBot = typeof u === 'string' && /^[A-Za-z0-9_]{5,32}$/.test(u) ? u : null;
      } catch { nomeBot = null; }
      return nomeBot;
    },
  };
}
