#!/usr/bin/env node
// Piloto controlado do Telegram (issue #690). Três modos, nesta ordem de uso:
//   previa   — sem rede: escolhe UMA oferta elegível do state.json e mostra legenda + foto que seriam enviadas.
//   conferir — só leitura na Bot API (getChat): mostra título e tipo do chat de SOCIAL_TELEGRAM_CHAT_ID e confere --titulo.
//   enviar   — envio real de UMA mensagem (sendPhoto). Exige SOCIAL_ENABLED=1, --confirmar ENVIAR e --titulo igual ao
//              título real do chat (evita mandar no grupo de teste). Sem retentativa (repetir poderia duplicar o post).
// Token e chat vêm SÓ do ambiente (SOCIAL_TELEGRAM_BOT_TOKEN, SOCIAL_TELEGRAM_CHAT_ID), configurados como GitHub Secrets;
// nunca são impressos. Uso: node tools/social-telegram-piloto.mjs <previa|conferir|enviar> [--oferta id] [--titulo "..."]
//   [--confirmar ENVIAR] [--state caminho]
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gerarPrevia, STATE_PADRAO } from './social-preview.mjs';
import { aprovar, validarFila } from '../src/agents/social/fila.js';
import { publicarFoto, API_PADRAO } from '../src/agents/social/telegram.js';
import { redact } from '../src/redact.js';

export const MODOS = Object.freeze(['previa', 'conferir', 'enviar']);
export const CONFIRMACAO = 'ENVIAR';

export function lerArgs(argv) {
  const o = { modo: argv[0] };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]; const v = argv[i + 1];
    if (['--oferta', '--titulo', '--confirmar', '--state'].includes(a)) {
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} exige valor`);
      o[a.slice(2)] = v; i++;
    } else throw new Error(`argumento desconhecido: ${a}`);
  }
  if (!MODOS.includes(o.modo)) throw new Error(`modo deve ser ${MODOS.join('|')}`);
  return o;
}

/** Escolhe o rascunho do Telegram (da prévia) e a foto original da oferta. Puro. */
export function escolher(state, { oferta, now, env = {} } = {}) {
  const p = gerarPrevia(state, { canais: ['telegram'], now, env, limite: 50 });
  const itens = p.itens.filter((i) => i.canal === 'telegram');
  const it = oferta ? itens.find((i) => i.ofertaId === oferta) : itens[0];
  if (!it) throw new Error(oferta ? `oferta ${oferta} não está entre as elegíveis agora` : 'nenhuma oferta elegível agora');
  const o = state.offers.find((x) => x.id === it.ofertaId);
  return { item: it, fila: p.fila, foto: o?.image ?? null };
}

const mascarar = (s, token) => redact(token ? String(s).split(token).join('***') : String(s), { env: {}, max: 300 });

async function getChat(fetchFn, token, chatId) {
  const r = await fetchFn(`${API_PADRAO}/bot${token}/getChat?chat_id=${encodeURIComponent(chatId)}`, { signal: AbortSignal.timeout(10000) });
  const d = await r.json().catch(() => null);
  if (!r.ok || d?.ok !== true) throw new Error(`getChat falhou: HTTP ${r.status}${d?.description ? ': ' + d.description : ''}`);
  return { titulo: d.result?.title ?? null, tipo: d.result?.type ?? null };
}

export async function main(argv = process.argv.slice(2), env = process.env, io = { log: console.log, error: console.error }, fetchFn = globalThis.fetch) {
  let o;
  try { o = lerArgs(argv); } catch (e) { io.error(e.message); return 1; }
  const token = env.SOCIAL_TELEGRAM_BOT_TOKEN || ''; const chatId = env.SOCIAL_TELEGRAM_CHAT_ID || '';
  try {
    if (o.modo === 'previa' || o.modo === 'enviar') {
      const state = JSON.parse(fs.readFileSync(o.state || STATE_PADRAO, 'utf8'));
      const { item, fila, foto } = escolher(state, { oferta: o.oferta, env });
      io.log(`## Prévia Telegram (piloto #690)\n\nOferta: \`${item.ofertaId}\` · chave \`${item.chaveDedupe}\`\nFoto: ${foto ?? '(sem foto: não pode ser enviada)'}\n\n\`\`\`\n${item.texto}\n\`\`\``);
      if (o.modo === 'previa') return 0;
      if (o.confirmar !== CONFIRMACAO) { io.error(`envio recusado: --confirmar ${CONFIRMACAO} ausente`); return 2; }
      if (!o.titulo) { io.error('envio recusado: --titulo do grupo esperado ausente'); return 2; }
      if (!token || !chatId) { io.error('envio recusado: SOCIAL_TELEGRAM_BOT_TOKEN/SOCIAL_TELEGRAM_CHAT_ID ausentes'); return 2; }
      const chat = await getChat(fetchFn, token, chatId);
      if (chat.titulo !== o.titulo) { io.error(`envio recusado: título do chat não confere (real: "${chat.titulo}")`); return 2; }
      const aprovado = validarFila(aprovar(fila, item.id, { now: Date.now() }).fila).itens.find((x) => x.id === item.id);
      const r = await publicarFoto(aprovado, { env, token, chatId, foto, fetch: fetchFn, simular: false });
      if (!r.ok) { io.error(`envio ${r.status}: ${mascarar(r.motivo, token)}`); return 1; }
      io.log(`\n**Enviado** ao grupo "${chat.titulo}" · message_id ${r.messageId} · ${new Date().toISOString()}`);
      return 0;
    }
    if (!token || !chatId) { io.error('SOCIAL_TELEGRAM_BOT_TOKEN/SOCIAL_TELEGRAM_CHAT_ID ausentes'); return 2; }
    const chat = await getChat(fetchFn, token, chatId);
    io.log(`Chat configurado: "${chat.titulo}" (${chat.tipo})${o.titulo ? (chat.titulo === o.titulo ? ' — confere ✓' : ` — NÃO confere com "${o.titulo}"`) : ''}`);
    return o.titulo && chat.titulo !== o.titulo ? 2 : 0;
  } catch (e) { io.error(mascarar(e?.message || e, token)); return 1; }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) process.exitCode = await main();
