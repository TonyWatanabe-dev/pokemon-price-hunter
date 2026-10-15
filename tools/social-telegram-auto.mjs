#!/usr/bin/env node
// Envio automático do Telegram (#690), uma rodada por execução. Regras em src/agents/social/auto.js.
// Travas, todas obrigatórias: SOCIAL_ENABLED=1, SOCIAL_AUTO=1 (kill switch: variável do repositório), token e chat nos
// secrets, e o título real do chat (getChat) igual a --titulo. Sem retentativa de envio (evita post duplicado).
// Só entra no diário o que a Bot API confirmou. Token nunca é impresso.
// Uso: node tools/social-telegram-auto.mjs --state data/state.json --diario diario.json --titulo "..." [--card-dir dir]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { candidatos, gerarCard, getChat } from './social-telegram-piloto.mjs';
import { loadAffiliates } from '../api/_lib/affiliates.mjs';
import { comLinksSociais } from '../src/agents/social/afiliados-links.js';
import { aprovar, validarFila } from '../src/agents/social/fila.js';
import { publicarFoto } from '../src/agents/social/telegram.js';
import { planejar, registrar } from '../src/agents/social/auto.js';
import { redact } from '../src/redact.js';

export function lerArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i += 2) {
    const a = argv[i]; const v = argv[i + 1];
    if (!['--state', '--diario', '--titulo', '--card-dir'].includes(a)) throw new Error(`argumento desconhecido: ${a}`);
    if (v === undefined || v.startsWith('--')) throw new Error(`${a} exige valor`);
    o[a.slice(2).replace('-d', 'D')] = v;
  }
  for (const k of ['state', 'diario', 'titulo']) if (!o[k]) throw new Error(`--${k} é obrigatório`);
  return o;
}

const lerDiario = (f) => { try { const d = JSON.parse(fs.readFileSync(f, 'utf8')); return Array.isArray(d) ? d : []; } catch { return []; } };

export async function main(argv = process.argv.slice(2), env = process.env, io = { log: console.log, error: console.error }, fetchFn = globalThis.fetch, now = Date.now) {
  let o; try { o = lerArgs(argv); } catch (e) { io.error(e.message); return 1; }
  const token = env.SOCIAL_TELEGRAM_BOT_TOKEN || ''; const chatId = env.SOCIAL_TELEGRAM_CHAT_ID || '';
  const mascarar = (s) => redact(token ? String(s).split(token).join('***') : String(s), { env: {}, max: 300 });
  if (env.SOCIAL_ENABLED !== '1' || env.SOCIAL_AUTO !== '1') { io.log('Envio automático desligado (SOCIAL_ENABLED/SOCIAL_AUTO).'); return 0; }
  if (!token || !chatId) { io.error('SOCIAL_TELEGRAM_BOT_TOKEN/SOCIAL_TELEGRAM_CHAT_ID ausentes'); return 2; }
  try {
    const state = JSON.parse(fs.readFileSync(o.state, 'utf8'));
    let afiliados = {}; try { afiliados = loadAffiliates(); } catch { /* sem config: links originais */ }
    const diario = lerDiario(o.diario);
    let lista = candidatos(state, { now: now(), env, afiliados });
    let plano = planejar(lista, diario, { now: now() });
    if (plano.enviar.length) {   // só resolve os links curtos de afiliado quando há o que postar (ordem: afiliado primeiro)
      afiliados = await comLinksSociais(afiliados, fetchFn);
      lista = candidatos(state, { now: now(), env, afiliados });
      plano = planejar(lista, diario, { now: now() });
    }
    io.log(`## Telegram automático\n\nElegíveis agora: ${lista.length} · nesta rodada: ${plano.enviar.length} (${plano.motivo})`);
    if (!plano.enviar.length) return 0;
    const chat = await getChat(fetchFn, token, chatId);
    if (chat.titulo !== o.titulo) { io.error(`envio recusado: título do chat não confere (real: "${chat.titulo}")`); return 2; }
    const feitos = [];
    let falhou = false;
    for (const [i, c] of plano.enviar.entries()) {
      const card = o.cardDir ? await gerarCard(c.foto, path.join(o.cardDir, `card-${i}.jpg`), fetchFn, undefined, c.oferta?.productId) : null;
      const aprovado = validarFila(aprovar(c.fila, c.item.id, { now: now() }).fila).itens.find((x) => x.id === c.item.id);
      const r = await publicarFoto(aprovado, { env, token, chatId, foto: c.foto, arquivo: card, parseMode: c.parseMode, fetch: fetchFn, simular: false });
      if (!r.ok) { io.error(`- ${c.item.ofertaId}: ${r.status} ${mascarar(r.motivo)}`); falhou = true; break; }
      feitos.push({ ofertaId: c.item.ofertaId, at: new Date(now()).toISOString(), messageId: r.messageId });
      fs.writeFileSync(o.diario, JSON.stringify(registrar(diario, feitos, { now: now() })));   // grava a cada envio
      io.log(`- enviado \`${c.item.ofertaId}\` · message_id ${r.messageId}${c.afiliado ? ' · afiliado' : ''}${card ? ' · card' : ''}`);
    }
    return falhou ? 1 : 0;
  } catch (e) { io.error(mascarar(e?.message || e)); return 1; }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) process.exitCode = await main();
