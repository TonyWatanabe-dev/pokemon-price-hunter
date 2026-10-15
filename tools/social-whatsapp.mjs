#!/usr/bin/env node
// WhatsApp do TCG Price Hunter (#690) — automação NÃO oficial (Baileys, sessão de "aparelho conectado"), por decisão
// do proprietário em 14/10/2026 ("sim, assumo o risco"). O número do bot é admin do grupo; o proprietário também.
//
//   parear — liga o número ao bot: imprime um código de pareamento (WhatsApp → Aparelhos conectados → Conectar com
//            número de telefone), espera a conexão e salva a sessão CIFRADA (AES-256-GCM, chave SOCIAL_WHATSAPP_CHAVE).
//   enviar — uma rodada: restaura a sessão, confere o grupo pelo título exato, planeja com REGRAS_WHATSAPP (30 min,
//            1 nova por rodada, teto de 20/24 h, madrugada só novidades, 1×/24 h por oferta), posta e salva a sessão.
// A biblioteca Baileys é instalada só no workflow (npm install --no-save); aqui é importada dinamicamente.
// Uso: node tools/social-whatsapp.mjs parear --sessao arq --numero 5511...
//      node tools/social-whatsapp.mjs enviar --sessao arq --state state.json --diario diario.json --titulo "..." [--card-dir dir]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { candidatos, gerarCard } from './social-telegram-piloto.mjs';
import { loadAffiliates } from '../api/_lib/affiliates.mjs';
import { planejar, registrar, REGRAS_WHATSAPP } from '../src/agents/social/auto.js';
import { legendaWhatsApp, cifrarSessao, decifrarSessao, acharGrupo } from '../src/agents/social/whatsapp.js';

const OPCOES = ['--sessao', '--numero', '--state', '--diario', '--titulo', '--card-dir'];
export function lerArgs(argv) {
  const o = { modo: argv[0] };
  if (!['parear', 'enviar'].includes(o.modo)) throw new Error('modo deve ser parear|enviar');
  for (let i = 1; i < argv.length; i += 2) {
    const a = argv[i]; const v = argv[i + 1];
    if (!OPCOES.includes(a)) throw new Error(`argumento desconhecido: ${a}`);
    if (v === undefined || v.startsWith('--')) throw new Error(`${a} exige valor`);
    o[a.slice(2).replace('-d', 'D')] = v;
  }
  if (!o.sessao) throw new Error('--sessao é obrigatório');
  if (o.modo === 'parear' && !/^55\d{10,11}$/.test(o.numero || '')) throw new Error('--numero no formato 55DDDNUMERO');
  if (o.modo === 'enviar') for (const k of ['state', 'diario', 'titulo']) if (!o[k]) throw new Error(`--${k} é obrigatório`);
  return o;
}

const lerJson = (f, padrao) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return padrao; } };
const pastaTemp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wa-'));
function despejar(arquivos, dir) { for (const [n, c] of Object.entries(arquivos)) if (!n.includes('/') && !n.startsWith('.')) fs.writeFileSync(path.join(dir, n), c); }
function recolher(dir) { return Object.fromEntries(fs.readdirSync(dir).map((n) => [n, fs.readFileSync(path.join(dir, n), 'utf8')])); }

/** Conexão real (Baileys). Devolve { sock, aberta: Promise, fechar() }. Reconecta uma vez em "restart required". */
export async function conectarBaileys(dir, { aoCodigo, numero, timeoutMs = 90000 } = {}) {
  const b = await import('@whiskeysockets/baileys');
  const pino = (await import('pino')).default;
  const makeWASocket = b.default || b.makeWASocket;
  const { state, saveCreds } = await b.useMultiFileAuthState(dir);
  let sock; let pediuCodigo = false;
  const abrir = () => new Promise((resolve, reject) => {
    sock = makeWASocket({ auth: state, logger: pino({ level: 'silent' }), browser: b.Browsers.ubuntu('Chrome'), markOnlineOnConnect: false, syncFullHistory: false });
    sock.ev.on('creds.update', saveCreds);
    const t = setTimeout(() => reject(new Error('tempo esgotado esperando a conexão com o WhatsApp')), timeoutMs);
    sock.ev.on('connection.update', async (u) => {
      if (u.qr && numero && !pediuCodigo && !state.creds.registered) {
        pediuCodigo = true;
        try { aoCodigo?.(await sock.requestPairingCode(numero)); } catch (e) { clearTimeout(t); reject(e); }
      }
      if (u.connection === 'open') { clearTimeout(t); resolve(); }
      if (u.connection === 'close') {
        clearTimeout(t);
        const code = u.lastDisconnect?.error?.output?.statusCode;
        if (code === b.DisconnectReason.restartRequired) abrir().then(resolve, reject);
        else reject(new Error(`conexão fechada (código ${code ?? 'desconhecido'})`));
      }
    });
  });
  await abrir();
  return { sock: () => sock, fechar: async () => { try { await sock.end(undefined); } catch { /* já fechada */ } } };
}

export async function main(argv = process.argv.slice(2), env = process.env, io = { log: console.log, error: console.error },
  { conectar = conectarBaileys, fetchFn = globalThis.fetch, now = Date.now, esperar = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let o; try { o = lerArgs(argv); } catch (e) { io.error(e.message); return 1; }
  const segredo = env.SOCIAL_WHATSAPP_CHAVE || '';
  const dir = pastaTemp();
  let con = null;
  const salvar = () => { fs.writeFileSync(o.sessao, cifrarSessao(recolher(dir), segredo)); };
  try {
    if (o.modo === 'parear') {
      if (!segredo) { io.error('SOCIAL_WHATSAPP_CHAVE ausente'); return 2; }
      con = await conectar(dir, { numero: o.numero, timeoutMs: 8 * 60e3, aoCodigo: (c) => io.log(`## Código de pareamento: \`${c}\`\n\nNo celular do número do bot: WhatsApp → Aparelhos conectados → Conectar aparelho → Conectar com número de telefone. Válido por poucos minutos.`) });
      await esperar(8000);                                  // deixa a sessão sincronizar as chaves antes de salvar
      const grupos = await con.sock().groupFetchAllParticipating();
      io.log(`\n**Conectado.** Grupos visíveis: ${Object.values(grupos).map((g) => `"${g.subject}"`).join(', ') || '(nenhum)'}`);
      salvar();
      return 0;
    }
    if (env.SOCIAL_ENABLED !== '1' || env.SOCIAL_WHATSAPP_AUTO !== '1') { io.log('WhatsApp automático desligado (SOCIAL_ENABLED/SOCIAL_WHATSAPP_AUTO).'); return 0; }
    if (!segredo) { io.error('SOCIAL_WHATSAPP_CHAVE ausente'); return 2; }
    if (!fs.existsSync(o.sessao)) { io.error('sessão do WhatsApp não encontrada: rode o workflow de pareamento'); return 2; }
    despejar(decifrarSessao(fs.readFileSync(o.sessao), segredo), dir);
    const state = lerJson(o.state, null);
    if (!state) { io.error('state.json ilegível'); return 1; }
    let afiliados = {}; try { afiliados = loadAffiliates(); } catch { /* links originais */ }
    const diario = lerJson(o.diario, []);
    const lista = candidatos(state, { now: now(), env, afiliados });
    const plano = planejar(lista, Array.isArray(diario) ? diario : [], { now: now(), regras: REGRAS_WHATSAPP });
    io.log(`## WhatsApp automático\n\nElegíveis agora: ${lista.length} · nesta rodada: ${plano.enviar.length} (${plano.motivo})`);
    if (!plano.enviar.length) return 0;                     // não conecta à toa
    // Prepara cards e fotos ANTES de conectar: o card pode levar mais de um minuto (modelo de recorte) e o WhatsApp
    // derruba conexão ociosa ("Connection Closed"). Conectado, só confere o grupo e posta.
    const prontos = [];
    for (const [i, c] of plano.enviar.entries()) {
      let img = o.cardDir ? await gerarCard(c.foto, path.join(o.cardDir, `wa-card-${i}.jpg`), fetchFn, undefined, c.oferta?.productId) : null;
      if (!img && c.foto) { try { const r = await fetchFn(c.foto, { signal: AbortSignal.timeout(15000) }); if (r.ok) img = new Uint8Array(await r.arrayBuffer()); } catch { /* sem foto */ } }
      const caption = legendaWhatsApp(c.item.texto);
      prontos.push({ c, msg: img ? { image: Buffer.from(img), caption } : { text: caption } });
    }
    // Uma reconexão se a conexão cair logo depois de abrir (comum na 1ª conexão após o pareamento).
    const tentar = async (fn) => {
      try { return await fn(); } catch (e) {
        if (!/connection closed|conexão fechada/i.test(String(e?.message))) throw e;
        await con.fechar(); await esperar(3000); con = await conectar(dir, {});
        return fn();
      }
    };
    con = await conectar(dir, {});
    await esperar(2000);
    const jid = acharGrupo(await tentar(() => con.sock().groupFetchAllParticipating()), o.titulo);
    if (!jid) { io.error(`envio recusado: grupo "${o.titulo}" não encontrado (ou mais de um com esse nome)`); salvar(); return 2; }
    const feitos = [];
    for (const { c, msg } of prontos) {
      const r = await tentar(() => con.sock().sendMessage(jid, msg));
      feitos.push({ ofertaId: c.item.ofertaId, at: new Date(now()).toISOString(), messageId: r?.key?.id ?? null });
      fs.writeFileSync(o.diario, JSON.stringify(registrar(Array.isArray(diario) ? diario : [], feitos, { now: now(), regras: REGRAS_WHATSAPP })));
      io.log(`- enviado \`${c.item.ofertaId}\`${msg.image ? ' · com imagem' : ' · só texto'}`);
    }
    await esperar(3000);
    salvar();
    return 0;
  } catch (e) {
    io.error(`WhatsApp: ${String(e?.message || e).slice(0, 300)}`);
    io.log(`WhatsApp: ${String(e?.message || e).slice(0, 300)}`);
    try { if (o.modo === 'enviar' && fs.readdirSync(dir).length) salvar(); } catch { /* mantém a sessão anterior */ }
    return 1;
  } finally {
    if (con) await con.fechar();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) process.exitCode = await main();
