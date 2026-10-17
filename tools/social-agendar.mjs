#!/usr/bin/env node
// Agenda a linha editorial no Instagram/TikTok via Zernio a partir de config/social/agenda/<semana>.json.
// Uso: node tools/social-agendar.mjs --agenda config/social/agenda/semana1.json [--modo simular|agendar] [--so id1,id2]
// Modo padrão = simular (a Zernio valida e não agenda). Vídeo sem arquivo nem "drive" fica pendente e é pulado.
// "drive" = id de arquivo do Google Drive compartilhado como "qualquer pessoa com o link".
// Env: SOCIAL_ZERNIO_API_KEY, SOCIAL_ZERNIO_PROFILE_ID (secrets do GitHub; nunca impressos).
import { readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { criarCliente, validarItem, montarPost } from '../src/agents/social/zernio.js';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const caminho = arg('agenda');
const modo = arg('modo', 'simular');
const so = (arg('so', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
if (!caminho) { console.error('informe --agenda'); process.exit(2); }
if (!['simular', 'agendar', 'cancelar', 'contas'].includes(modo)) { console.error('--modo simular|agendar|cancelar|contas'); process.exit(2); }

const agenda = JSON.parse(readFileSync(caminho, 'utf8'));
const itens = agenda.itens.filter((i) => !so.length || so.includes(i.id));
const erros = itens.flatMap((i) => validarItem(i).map((p) => `${i.id}: ${p}`));
if (erros.length) { console.error(erros.join('\n')); process.exit(1); }

const agora = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 16); // horário de Brasília (UTC-3)
const chave = process.env.SOCIAL_ZERNIO_API_KEY;
const perfil = process.env.SOCIAL_ZERNIO_PROFILE_ID;
const cli = criarCliente({ chave, fetch: globalThis.fetch });
const contas = {};
let falhas = 0;
// Anotações do Actions: o resultado de cada item fica legível pela API (check-runs/annotations) sem baixar o log.
const anota = (nivel, msg) => { console.log(msg); if (process.env.GITHUB_ACTIONS) console.log(`::${nivel}::${msg.replace(/\r?\n/g, ' ')}`); };

async function midias(it) {
  if (it.tipo === 'video' && !it.arquivos?.length) {
    const r = await fetch(`https://drive.usercontent.google.com/download?id=${encodeURIComponent(it.drive)}&export=download&confirm=t`, { redirect: 'follow' });
    const tipo = r.headers.get('content-type') || '';
    if (!r.ok || !/video|octet-stream/.test(tipo)) throw new Error(`Drive não entregou o vídeo (HTTP ${r.status}, ${tipo.split(';')[0]}): o arquivo precisa estar como "qualquer pessoa com o link"`);
    return [{ nome: `${it.id}.mp4`, bytes: new Uint8Array(await r.arrayBuffer()) }];
  }
  return it.arquivos.map((a) => ({ nome: basename(a), bytes: new Uint8Array(readFileSync(join(agenda.pasta, a))) }));
}

if (modo === 'contas') {
  // Diagnóstico: quais redes estão conectadas no perfil (rede e @, nunca ids ou tokens).
  for (const c of await cli.contas(perfil)) anota('notice', `conta: ${c.rede} · ${c.usuario || '(sem nome)'} · ${c.ativa ? 'ativa' : 'inativa'}`);
  process.exit(0);
}

if (modo === 'cancelar') {
  // Cancela posts agendados listados em agenda.cancelar ({ quando, plataforma }): casa pelo horário (UTC-3) e pela rede.
  const alvos = Array.isArray(agenda.cancelar) ? agenda.cancelar : [];
  const lista = await cli.agendados(perfil);
  for (const c of alvos) {
    const utc = new Date(`${c.quando}:00-03:00`).toISOString().slice(0, 16);
    const achados = lista.filter((p) => String(p.scheduledFor ?? '').slice(0, 16) === utc
      && (p.platforms ?? []).some((x) => x?.platform === c.plataforma));
    if (achados.length !== 1) { falhas++; anota('error', `✗ cancelar ${c.quando} ${c.plataforma}: achei ${achados.length} post(s) agendado(s); nada cancelado`); continue; }
    try { await cli.cancelar(achados[0]._id); anota('notice', `✓ cancelado ${c.quando} · ${c.plataforma} · ${c.motivo ?? ''}`); }
    catch (e) { falhas++; anota('error', `✗ cancelar ${c.quando}: ${e.message}`); }
  }
  process.exit(falhas ? 1 : 0);
}

for (const it of itens) {
  if (it.tipo === 'video' && !it.arquivos?.length && !it.drive) { anota('notice', `⏸ ${it.id}: vídeo pendente (sem arquivo/drive)`); continue; }
  if (it.quando <= agora) { anota('notice', `⏭ ${it.id}: horário ${it.quando} já passou`); continue; }
  try {
    const urls = [];
    for (const m of await midias(it)) urls.push(await cli.enviar(m.bytes, m.nome));
    for (const plataforma of it.plataformas) {
      contas[plataforma] ??= await cli.conta(plataforma, perfil);
      if (modo === 'simular' && plataforma !== 'tiktok') { anota('notice', `✓ ${it.id} · ${plataforma} · mídia enviada (a Zernio só simula TikTok; post não validado)`); continue; }
      const corpo = montarPost(it, { accountId: contas[plataforma], plataforma, urls, simular: modo === 'simular' });
      const idem = createHash('sha256').update(`${it.id}|${plataforma}|${it.quando}|${it.legenda ?? ''}|${urls.join(',')}`).digest('hex').slice(0, 32);
      const r = await cli.postar(corpo, modo === 'agendar' ? idem : undefined);
      anota(r.status === 'invalido' ? 'error' : 'notice', `${r.status === 'invalido' ? '✗' : '✓'} ${it.id} · ${plataforma} · ${it.quando} · ${r.status}${r.detalhe ? ' · ' + r.detalhe : ''}`);
      if (r.status === 'invalido') falhas++;
    }
  } catch (e) { falhas++; anota('error', `✗ ${it.id}: ${e.message}`); }
}
process.exit(falhas ? 1 : 0);
