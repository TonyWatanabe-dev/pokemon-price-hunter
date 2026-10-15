#!/usr/bin/env node
// Piloto controlado do Telegram (issue #690). Três modos, nesta ordem de uso:
//   previa   — sem rede: escolhe UMA oferta elegível do state.json e mostra legenda + foto que seriam enviadas.
//   conferir — só leitura na Bot API (getChat): mostra título e tipo do chat de SOCIAL_TELEGRAM_CHAT_ID e confere --titulo.
//   enviar   — envio real de UMA mensagem (sendPhoto). Exige SOCIAL_ENABLED=1, --confirmar ENVIAR e --titulo igual ao
//              título real do chat (evita mandar no grupo de teste). Sem retentativa (repetir poderia duplicar o post).
// Token e chat vêm SÓ do ambiente (SOCIAL_TELEGRAM_BOT_TOKEN, SOCIAL_TELEGRAM_CHAT_ID), configurados como GitHub Secrets;
// nunca são impressos. Uso: node tools/social-telegram-piloto.mjs <previa|conferir|enviar> [--oferta id] [--titulo "..."]
//   [--confirmar ENVIAR] [--state caminho] [--card saida.jpg]
// Legenda no formato aprovado (src/agents/social/legenda.js). Link: afiliado do anúncio quando houver (config/affiliates.json),
// senão a URL da loja; sem --oferta, ofertas com link de afiliado vêm primeiro. --card: baixa a foto da loja e gera o card
// (tools/social-card.py); se a foto não tiver fundo branco recortável ou o card falhar, envia a foto original.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dicaCupom } from '../src/agents/social/cupons.js';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveOutbound, loadAffiliates } from '../api/_lib/affiliates.mjs';
import { montarLegenda, precoAnterior, LEGENDA_MAX } from '../src/agents/social/legenda.js';
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
    if (['--oferta', '--titulo', '--confirmar', '--state', '--card'].includes(a)) {
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} exige valor`);
      o[a.slice(2)] = v; i++;
    } else throw new Error(`argumento desconhecido: ${a}`);
  }
  if (!MODOS.includes(o.modo)) throw new Error(`modo deve ser ${MODOS.join('|')}`);
  return o;
}

/** Link do post: afiliado do anúncio quando configurado, senão a URL da oferta, intacta. */
export function linkDe(oferta, afiliados) {
  const link = resolveOutbound(oferta.url, afiliados);
  return { link, afiliado: link !== oferta.url };
}

/** Todas as ofertas elegíveis agora, já com legenda aprovada, foto e link. Ordem: afiliado primeiro, depois a da prévia. */
const CUPONS = fileURLToPath(new URL('../config/social-cupons.json', import.meta.url));
/** Cupons importados (config/social-cupons.json); sem arquivo ou ilegível: nenhum. */
export function carregarCupons(f = CUPONS) { try { const d = JSON.parse(fs.readFileSync(f, 'utf8')); return Array.isArray(d?.cupons) ? d.cupons : []; } catch { return []; } }

export function candidatos(state, { now, env = {}, afiliados = {}, cupons = carregarCupons() } = {}) {
  const p = gerarPrevia(state, { canais: ['telegram'], now, env, limite: 50 });
  const lista = p.itens.filter((i) => i.canal === 'telegram').map((it) => {
    const o = state.offers.find((x) => x.id === it.ofertaId);
    const { link, afiliado } = linkDe(o, afiliados);
    const leg = montarLegenda({ titulo: o.title, atual: o.price, anterior: precoAnterior(o), loja: o.storeName, link, afiliado });
    const dica = env.SOCIAL_CUPONS === '0' ? null : dicaCupom(o, cupons, now ?? Date.now());   // kill switch: SOCIAL_CUPONS=0
    const { parseMode } = leg; const texto = dica && leg.texto.length + dica.length + 2 <= LEGENDA_MAX ? `${leg.texto}\n\n${dica.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}` : leg.texto;
    const fila = { ...p.fila, itens: p.fila.itens.map((x) => (x.id === it.id ? { ...x, texto } : x)) };
    return { item: { ...it, texto }, fila, oferta: o, foto: o.image ?? null, parseMode, afiliado };
  });
  return lista.sort((a, b) => Number(b.afiliado) - Number(a.afiliado));   // sort estável: mantém a ordem da prévia
}

/** Escolhe a oferta (elegível agora) para o envio manual. Sem --oferta: a primeira de candidatos(). */
export function escolher(state, { oferta, now, env = {}, afiliados = {} } = {}) {
  const lista = candidatos(state, { now, env, afiliados });
  const c = oferta ? lista.find((x) => x.item.ofertaId === oferta) : lista[0];
  if (!c) throw new Error(oferta ? `oferta ${oferta} não está entre as elegíveis agora` : 'nenhuma oferta elegível agora');
  return c;
}

export const ACERVO = fileURLToPath(new URL('../assets/social/produtos/', import.meta.url));
const SLUG_ID = /^[a-z0-9][a-z0-9-]*$/;
/** Foto revisada do acervo (assets/social/produtos/<productId>.webp), se existir. */
export function fotoAcervo(productId, dir = ACERVO) {
  if (typeof productId !== 'string' || !SLUG_ID.test(productId)) return null;
  const f = path.join(dir, `${productId}.webp`);
  return fs.existsSync(f) ? f : null;
}

/** Gera o card. Usa a foto do acervo quando houver; senão baixa a foto da loja. Devolve o JPEG (Uint8Array) ou
 *  null (usa a foto original). Nunca lança. */
const SEM_RECORTE = fileURLToPath(new URL('../config/social-sem-recorte.json', import.meta.url));
/** Produtos cujo recorte saiu ruim (config/social-sem-recorte.json): o post usa a foto original da loja. */
export function semRecorte(productId, f = SEM_RECORTE) {
  try { const d = JSON.parse(fs.readFileSync(f, 'utf8')); return Array.isArray(d?.produtos) && d.produtos.includes(productId); } catch { return false; }
}

export async function gerarCard(foto, saida, fetchFn, run = spawnSync, productId = null, dir = ACERVO) {
  try {
    if (productId && semRecorte(productId)) return null;     // foto original da loja, sem card
    let tmp = fotoAcervo(productId, dir);
    if (!tmp) {
      const r = await fetchFn(foto, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) return null;
      tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'card-')), 'foto');
      fs.writeFileSync(tmp, Buffer.from(await r.arrayBuffer()));
    }
    const script = fileURLToPath(new URL('./social-card.py', import.meta.url));
    const x = run(process.env.SOCIAL_PYTHON || 'python3', [script, '--foto', tmp, '--saida', saida], { encoding: 'utf8', timeout: 180000 });
    return x.status === 0 && fs.existsSync(saida) ? new Uint8Array(fs.readFileSync(saida)) : null;
  } catch { return null; }
}

const mascarar = (s, token) => redact(token ? String(s).split(token).join('***') : String(s), { env: {}, max: 300 });

export async function getChat(fetchFn, token, chatId) {
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
      let afiliados = {}; try { afiliados = loadAffiliates(); } catch { /* sem config: links originais */ }
      const { item, fila, foto, parseMode, afiliado } = escolher(state, { oferta: o.oferta, env, afiliados });
      const card = o.card ? await gerarCard(foto, o.card, fetchFn, spawnSync, item.produtoId ?? state.offers.find((x) => x.id === item.ofertaId)?.productId) : null;
      io.log(`## Prévia Telegram (piloto #690)\n\nOferta: \`${item.ofertaId}\` · chave \`${item.chaveDedupe}\` · link ${afiliado ? 'de afiliado' : 'da loja'}\nFoto: ${foto ?? '(sem foto: não pode ser enviada)'}${o.card ? `\nCard: ${card ? o.card : 'não gerado (usa a foto original)'}` : ''}\n\n\`\`\`\n${item.texto}\n\`\`\``);
      if (o.modo === 'previa') return 0;
      if (o.confirmar !== CONFIRMACAO) { io.error(`envio recusado: --confirmar ${CONFIRMACAO} ausente`); return 2; }
      if (!o.titulo) { io.error('envio recusado: --titulo do grupo esperado ausente'); return 2; }
      if (!token || !chatId) { io.error('envio recusado: SOCIAL_TELEGRAM_BOT_TOKEN/SOCIAL_TELEGRAM_CHAT_ID ausentes'); return 2; }
      const chat = await getChat(fetchFn, token, chatId);
      if (chat.titulo !== o.titulo) { io.error(`envio recusado: título do chat não confere (real: "${chat.titulo}")`); return 2; }
      const aprovado = validarFila(aprovar(fila, item.id, { now: Date.now() }).fila).itens.find((x) => x.id === item.id);
      const r = await publicarFoto(aprovado, { env, token, chatId, foto, arquivo: card, parseMode, fetch: fetchFn, simular: false });
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
