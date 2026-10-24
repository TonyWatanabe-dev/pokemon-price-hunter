#!/usr/bin/env node
// "Top 3" e "Top 10 do site" nos grupos (pedido do dono em 24/10/2026). Três passos, cada um num job do workflow:
//   arte     — lê GET /api/v1/oportunidades (ordem do Opportunity Score, a mesma do site), gera a legenda e a arte
//              (HTML → JPG com Playwright, instalado só no workflow). Falha fechada: dado velho ou incompleto não vira post.
//   telegram — envia arte + legenda ao grupo do Telegram (sendPhoto), conferindo o título do chat antes.
//   whatsapp — envia ao grupo do WhatsApp (Baileys, mesma sessão cifrada do envio automático) e registra no diário,
//              para o teto de mensagens em 24 h valer também para estes posts.
// Uso: node tools/social-top.mjs arte --tipo top3|top10 --dir pasta [--json resposta.json]
//      node tools/social-top.mjs telegram --tipo top3 --dir pasta --titulo "..."
//      node tools/social-top.mjs whatsapp --tipo top3 --dir pasta --sessao arq --diario arq --titulo "..."
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { itensDaApi, legenda, legendaTelegram, arteHtml, TIPOS } from '../src/agents/social/top.js';
import { cifrarSessao, decifrarSessao, acharGrupo } from '../src/agents/social/whatsapp.js';
import { registrar, REGRAS_WHATSAPP } from '../src/agents/social/auto.js';

/** Diário do WhatsApp → pode enviar agora? Mesmo post na mesma hora não repete; teto de 24 h vale; devolve a espera do intervalo mínimo (hoje 0). */
export function vez(diario, id, now, regras = REGRAS_WHATSAPP) {
  const ts = (Array.isArray(diario) ? diario : []).map((d) => ({ id: d?.ofertaId, t: Date.parse(d?.at) })).filter((d) => Number.isFinite(d.t));
  if (ts.some((d) => d.id === id)) return { pode: false, motivo: `${id} já enviado` };
  if (regras.maxDia && ts.filter((d) => now - d.t < 24 * 3600e3).length >= regras.maxDia) return { pode: false, motivo: `teto de ${regras.maxDia} mensagens em 24 h` };
  const ultimo = Math.max(0, ...ts.map((d) => d.t));
  return { pode: true, esperaMs: Math.max(0, ultimo + regras.intervaloMin * 60e3 - now) };
}
import { redact } from '../src/redact.js';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
export const API = 'https://tcgpricehunter.com.br/api/v1/oportunidades?limite=15&pagina=1&ordem=score';
const OPCOES = ['--tipo', '--dir', '--json', '--titulo', '--sessao', '--diario'];

export function lerArgs(argv) {
  const o = { modo: argv[0] };
  if (!['arte', 'telegram', 'whatsapp'].includes(o.modo)) throw new Error('modo deve ser arte|telegram|whatsapp');
  for (let i = 1; i < argv.length; i += 2) {
    const a = argv[i]; const v = argv[i + 1];
    if (!OPCOES.includes(a)) throw new Error(`argumento desconhecido: ${a}`);
    if (v === undefined || v.startsWith('--')) throw new Error(`${a} exige valor`);
    o[a.slice(2)] = v;
  }
  if (!TIPOS[o.tipo]) throw new Error('--tipo deve ser top3|top10');
  if (!o.dir) throw new Error('--dir é obrigatório');
  if (o.modo !== 'arte' && !o.titulo) throw new Error('--titulo é obrigatório');
  if (o.modo === 'whatsapp') for (const k of ['sessao', 'diario']) if (!o[k]) throw new Error(`--${k} é obrigatório`);
  return o;
}

/** Foto do item: recorte revisado do acervo; senão a foto https da loja; senão o logo oficial da coleção. */
export function fotoDe(i, raiz = RAIZ) {
  const acervo = path.join(raiz, 'assets/social/produtos', `${i.id}.webp`);
  if (fs.existsSync(acervo)) return pathToFileURL(acervo).href;
  if (/^https:\/\//.test(i.imagem || '')) return i.imagem;
  return pathToFileURL(path.join(raiz, 'logos/colecoes', `${i.colecaoCodigo}.webp`)).href;
}

async function renderizar(html, saida) {
  const { chromium } = await import('playwright');
  const tmp = path.join(path.dirname(saida), path.basename(saida, '.jpg') + '.html');
  fs.writeFileSync(tmp, html);
  const b = await chromium.launch();
  try {
    const pg = await b.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 2 });
    await pg.goto(pathToFileURL(tmp).href, { waitUntil: 'networkidle', timeout: 60000 });
    await pg.evaluate(() => document.fonts.ready);
    await pg.screenshot({ path: saida, type: 'jpeg', quality: 90 });
  } finally { await b.close(); }
}

const ler = (dir, tipo) => ({ jpg: fs.readFileSync(path.join(dir, `${tipo}.jpg`)), txt: fs.readFileSync(path.join(dir, `${tipo}.txt`), 'utf8') });
const lerJson = (f, padrao) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return padrao; } };

export async function main(argv = process.argv.slice(2), env = process.env, io = { log: console.log, error: console.error },
  { fetchFn = globalThis.fetch, render = renderizar, conectar = null, now = Date.now, esperar = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let o; try { o = lerArgs(argv); } catch (e) { io.error(e.message); return 1; }
  const token = env.SOCIAL_TELEGRAM_BOT_TOKEN || '';
  const mascarar = (s) => redact(token ? String(s).split(token).join('***') : String(s), { env: {}, max: 300 });
  try {
    if (o.modo === 'arte') {
      let resp;
      if (o.json) resp = lerJson(o.json, null);
      else { const r = await fetchFn(API, { signal: AbortSignal.timeout(20000) }); resp = r.ok ? await r.json() : null; if (!r.ok) { io.error(`API respondeu HTTP ${r.status}`); return 2; } }
      const d = itensDaApi(resp, o.tipo, now());
      if (d.erro) { io.error(`sem post: ${d.erro}`); return 2; }
      fs.mkdirSync(o.dir, { recursive: true });
      const txt = legenda(o.tipo, d);
      fs.writeFileSync(path.join(o.dir, `${o.tipo}.txt`), txt);
      // foto da loja só entra se baixar de verdade (imagem válida); senão o logo da coleção, nunca um quadro quebrado
      const fotos = new Map();
      for (const i of d.itens) {
        let f = fotoDe(i);
        if (f.startsWith('https://')) {
          try {
            const r = await fetchFn(f, { signal: AbortSignal.timeout(15000) });
            const tipoImg = r.headers?.get?.('content-type') || '';
            if (!r.ok || !/^image\//.test(tipoImg)) throw new Error('não é imagem');
            const arq = path.join(o.dir, `foto-${i.id}.${tipoImg.includes('png') ? 'png' : tipoImg.includes('webp') ? 'webp' : 'jpg'}`);
            fs.writeFileSync(arq, new Uint8Array(await r.arrayBuffer())); f = pathToFileURL(arq).href;
          } catch { f = fotoDe({ ...i, imagem: null }); }
        }
        fotos.set(i.id, f);
      }
      const html = arteHtml(o.tipo, d, { fonte: pathToFileURL(path.join(RAIZ, 'assets/web/rubik-v1.woff2')).href, logo: pathToFileURL(path.join(RAIZ, 'assets/web/logo-v1.webp')).href, foto: (i) => fotos.get(i.id) });
      await render(html, path.join(o.dir, `${o.tipo}.jpg`));
      io.log(`## ${o.tipo === 'top3' ? 'Top 3' : 'Top 10'} do site\n\nPreços de ${d.quando}: ${d.itens.map((i) => i.id).join(', ')}\n\n\`\`\`\n${txt}\n\`\`\``);
      return 0;
    }
    if (env.SOCIAL_ENABLED !== '1') { io.log('Social desligado (SOCIAL_ENABLED).'); return 0; }
    const { jpg, txt } = ler(o.dir, o.tipo);
    if (o.modo === 'telegram') {
      const chatId = env.SOCIAL_TELEGRAM_CHAT_ID || '';
      if (!token || !chatId) { io.error('SOCIAL_TELEGRAM_BOT_TOKEN/SOCIAL_TELEGRAM_CHAT_ID ausentes'); return 2; }
      const base = `https://api.telegram.org/bot${token}`;
      const c = await (await fetchFn(`${base}/getChat?chat_id=${encodeURIComponent(chatId)}`, { signal: AbortSignal.timeout(10000) })).json().catch(() => null);
      if (c?.result?.title !== o.titulo) { io.error(`envio recusado: título do chat não confere (real: "${c?.result?.title ?? '?'}")`); return 2; }
      const fd = new FormData();
      fd.set('chat_id', chatId); fd.set('caption', legendaTelegram(txt)); fd.set('parse_mode', 'HTML');
      fd.set('photo', new Blob([jpg], { type: 'image/jpeg' }), `${o.tipo}.jpg`);
      const r = await fetchFn(`${base}/sendPhoto`, { method: 'POST', body: fd, signal: AbortSignal.timeout(30000) });
      const j = await r.json().catch(() => null);
      if (!r.ok || j?.ok !== true) { io.error(`Telegram: HTTP ${r.status} ${mascarar(j?.description ?? '')}`); return 1; }
      io.log(`- Telegram: enviado ${o.tipo} · message_id ${j.result?.message_id}`);
      return 0;
    }
    // WhatsApp
    const segredo = env.SOCIAL_WHATSAPP_CHAVE || '';
    if (!segredo) { io.error('SOCIAL_WHATSAPP_CHAVE ausente'); return 2; }
    if (!fs.existsSync(o.sessao)) { io.error('sessão do WhatsApp não encontrada'); return 2; }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-top-'));
    for (const [n, c] of Object.entries(decifrarSessao(fs.readFileSync(o.sessao), segredo))) if (!n.includes('/') && !n.startsWith('.')) fs.writeFileSync(path.join(dir, n), c);
    const salvar = () => fs.writeFileSync(o.sessao, cifrarSessao(Object.fromEntries(fs.readdirSync(dir).map((n) => [n, fs.readFileSync(path.join(dir, n), 'utf8')])), segredo));
    const id = `${o.tipo}:${new Date(now()).toISOString().slice(0, 13)}`;
    const v = vez(lerJson(o.diario, []), id, now());
    if (!v.pode) { io.log(`- WhatsApp: ${o.tipo} não enviado (${v.motivo})`); fs.rmSync(dir, { recursive: true, force: true }); return 0; }
    if (v.esperaMs > 0) { io.log(`- WhatsApp: esperando ${Math.ceil(v.esperaMs / 60e3)} min (intervalo de ${REGRAS_WHATSAPP.intervaloMin} min entre mensagens)`); await esperar(v.esperaMs); }
    const con = await (conectar ?? (await import('./social-whatsapp.mjs')).conectarBaileys)(dir, {});
    try {
      await esperar(2000);
      const jid = acharGrupo(await con.sock().groupFetchAllParticipating(), o.titulo);
      if (!jid) { io.error(`envio recusado: grupo "${o.titulo}" não encontrado (ou mais de um com esse nome)`); salvar(); return 2; }
      const r = await con.sock().sendMessage(jid, { image: Buffer.from(jpg), caption: txt });
      const diario = lerJson(o.diario, []);
      const at = new Date(now()).toISOString();
      fs.writeFileSync(o.diario, JSON.stringify(registrar(Array.isArray(diario) ? diario : [], [{ ofertaId: id, afiliado: false, at, messageId: r?.key?.id ?? null }], { now: now(), regras: REGRAS_WHATSAPP })));
      io.log(`- WhatsApp: enviado ${o.tipo}`);
      return 0;
    } finally {
      await esperar(8000);                                   // deixa a sessão sincronizar as chaves antes de salvar
      try { salvar(); } catch { /* mantém a sessão anterior */ }
      await con.fechar(); fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch (e) { io.error(`${o.modo}: ${mascarar(e?.message || e)}`); return 1; }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) process.exitCode = await main();
