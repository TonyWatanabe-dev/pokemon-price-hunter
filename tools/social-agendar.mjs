#!/usr/bin/env node
// Agenda a linha editorial no Instagram/TikTok via Zernio a partir de config/social/agenda/<semana>.json.
// Uso: node tools/social-agendar.mjs --agenda config/social/agenda/semana1.json [--modo simular|agendar] [--so id1,id2]
// Modo padrão = simular (a Zernio valida e não agenda). Vídeo sem arquivo nem "drive" fica pendente e é pulado.
// "drive" = id de arquivo do Google Drive compartilhado como "qualquer pessoa com o link".
// Env: SOCIAL_ZERNIO_API_KEY, SOCIAL_ZERNIO_PROFILE_ID (secrets do GitHub; nunca impressos).
import { readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { criarCliente, validarItem, montarPost, urlDeVideo } from '../src/agents/social/zernio.js';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const caminho = arg('agenda');
const modo = arg('modo', 'simular');
const so = (arg('so', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
if (!caminho) { console.error('informe --agenda'); process.exit(2); }
if (!['simular', 'agendar', 'cancelar', 'contas', 'agendados', 'metricas'].includes(modo)) { console.error('--modo simular|agendar|cancelar|contas|agendados|metricas'); process.exit(2); }

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
  if (it.tipo === 'video' && !it.arquivos?.length && it.url) {
    // vídeo renderizado e publicado no próprio repositório (raw.githubusercontent.com), só https desse host
    const r = await fetch(urlDeVideo(it.url), { redirect: 'follow' });
    if (!r.ok) throw new Error(`URL do vídeo não respondeu (HTTP ${r.status})`);
    return [{ nome: `${it.id}.mp4`, bytes: new Uint8Array(await r.arrayBuffer()) }];
  }
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

if (modo === 'metricas') {
  // Desempenho dos posts publicados nos últimos 30 dias, uma anotação por rede (sem ids).
  const de = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10), ate = new Date().toISOString().slice(0, 10);
  for (const rede of ['instagram', 'tiktok']) {
    try {
      const ps = await cli.metricas(perfil, rede, de, ate);
      const l = ps.map((p) => `${String(p.publicado ?? '').slice(0, 16)} v${p.views} c${p.curtidas} m${p.comentarios} s${p.compart}${p.alcance != null ? ' a' + p.alcance : ''}${p.salvos != null ? ' sv' + p.salvos : ''} «${p.texto}»`).sort();
      anota('notice', `métricas ${rede} (${l.length}): ${l.join(' | ')}`);
    } catch (e) { anota('warning', `métricas ${rede}: ${e.message}`); }
  }
  process.exit(0);
}

if (modo === 'agendados') {
  // Resumo do que está agendado no perfil, numa anotação só (o Actions mostra no máximo 10 avisos por passo).
  const lista = await cli.agendados(perfil);
  // trecho do texto (sem quebra de linha) para casar o post com o item da agenda; o id curto ajuda a conferir cancelamentos
  const linhas = lista.map((p) => `${new Date(new Date(p.scheduledFor).getTime() - 3 * 3600e3).toISOString().slice(0, 16)} ${(p.platforms ?? []).map((x) => x?.platform).join('+')} ${(p.mediaItems ?? []).map((m) => m?.type?.[0] ?? '?').join('')} «${String(p.content ?? p.title ?? '').replace(/\s+/g, ' ').slice(0, 48)}»`).sort();
  // o Actions corta anotação longa: em blocos de 30 linhas (até 10 avisos por passo)
  for (let i = 0; i < linhas.length; i += 30) anota('notice', `agendados ${i + 1}-${Math.min(i + 30, linhas.length)} de ${linhas.length}: ${linhas.slice(i, i + 30).join(' | ')}`);
  process.exit(0);
}

if (modo === 'cancelar') {
  // Cancela posts agendados listados em agenda.cancelar ({ quando, plataforma }): casa pelo horário (UTC-3) e pela rede.
  const alvos = Array.isArray(agenda.cancelar) ? agenda.cancelar : [];
  const lista = await cli.agendados(perfil);
  for (const c of alvos) {
    const utc = new Date(`${c.quando}:00-03:00`).toISOString().slice(0, 16);
    // trecho (opcional): o texto do post precisa conter esse pedaço — separa dois posts da mesma rede no mesmo horário
    const achados = lista.filter((p) => String(p.scheduledFor ?? '').slice(0, 16) === utc
      && (p.platforms ?? []).some((x) => x?.platform === c.plataforma)
      && (!c.trecho || String(p.content ?? '').includes(c.trecho)));
    // manterUm: o horário tem cópias duplicadas; cancela todas menos a primeira (mesmo conteúdo).
    if (c.manterUm ? achados.length < 2 : achados.length !== 1) { falhas++; anota('error', `✗ cancelar ${c.quando} ${c.plataforma}: achei ${achados.length} post(s) agendado(s); nada cancelado`); continue; }
    for (const alvo of c.manterUm ? achados.slice(1) : achados) {
      try { await cli.cancelar(alvo._id); anota('notice', `✓ cancelado ${c.quando} · ${c.plataforma} · ${c.motivo ?? ''}`); }
      catch (e) { falhas++; anota('error', `✗ cancelar ${c.quando}: ${e.message}`); }
    }
  }
  process.exit(falhas ? 1 : 0);
}

for (const it of itens) {
  if (it.tipo === 'video' && !it.arquivos?.length && !it.drive && !it.url) { anota('notice', `⏸ ${it.id}: vídeo pendente (sem arquivo/drive)`); continue; }
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
