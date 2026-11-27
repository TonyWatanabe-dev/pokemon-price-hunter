#!/usr/bin/env node
// Orquestrador da tarefa agendada do robô local do ML (27/11/2026). Roda no PC do dono, a cada 6 h, num CLONE DEDICADO do
// repositório (o diretório deste script; ninguém mais trabalha nele):
//   branch robo-ml/<AAAAMMDD-HHMM> a partir de origin/main → robo-ml.mjs → captura-importar.mjs → commit → push → PR →
//   merge (auto-merge se o repo permitir; senão espera os checks e faz o merge). Nunca push na main, nunca --force.
// Falha fechado: árvore suja, rodada com código ≠ 0 ou 0 itens terminam sem PR; checks vermelhos deixam o PR aberto.
// Log: tools/captura/auto/robo-ml.log. Uso: node tools/captura/robo-ml-tarefa.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { criarRun, criarGit, prepararBranch, mudouConfig, publicarMudancas, voltarParaMain, SEM_LINK_ML, p2 } from './publicar-pr.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const autoDir = path.join(root, 'tools', 'captura', 'auto');
const logFile = path.join(autoDir, 'robo-ml.log');

function log(msg) {
  fs.mkdirSync(autoDir, { recursive: true });
  const linha = `${new Date().toISOString()} ${msg}`;
  fs.appendFileSync(logFile, linha + '\n');
  console.log(linha);
}
const run = criarRun(root);
const git = criarGit(run);

function main() {
  const d = new Date();
  const hora = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
  const legivel = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
  const branch = `robo-ml/${hora}`;
  let codigo = 0;
  try {
    if (!prepararBranch({ git, log, branch })) return 1;
    log(`Rodada ${legivel} na branch ${branch}`);

    const robo = run(process.execPath, [path.join('tools', 'captura', 'robo-ml.mjs')], { ok: [0, 1, 2] });
    for (const l of robo.stdout.split(/\r?\n/).filter(Boolean)) log(`  robo-ml: ${l}`);
    const arq = /^ARQUIVO: (.+)$/m.exec(robo.stdout);
    if (robo.status !== 0 && !arq) { log(`Rodada terminou com código ${robo.status}; sem PR.`); return robo.status; }
    if (robo.status === 2) log('Rodada parcial (bloqueio no meio): publica só o que foi lido antes da parada.');
    if (!arq) { log('Rodada sem itens; sem PR.'); return 0; }
    const arquivo = arq[1].trim();
    const n = JSON.parse(fs.readFileSync(arquivo, 'utf8')).itens.length;

    const imp = run(process.execPath, [path.join('tools', 'captura-importar.mjs'), arquivo]);
    for (const l of imp.stdout.split(/\r?\n/).filter(Boolean).slice(-15)) log(`  importar: ${l}`);

    if (!mudouConfig(git, [SEM_LINK_ML])) {
      log(`Importação sem mudança na config de afiliados (${n} lidas); sem PR.`);
      return 0;
    }
    const titulo = `afiliados(ml): robô local ${legivel} (${n} ofertas)`;
    const corpo = `Rodada do robô local do ML em ${legivel}: ${n} ofertas lidas das buscas públicas, importadas por tools/captura-importar.mjs.

Gerado por tools/captura/robo-ml-tarefa.mjs.`;
    return publicarMudancas({ run, git, log, branch, titulo, corpo }).estado === 'checks-falharam' ? 1 : 0;
  } catch (e) {
    log(`ERRO: ${e.message}`);
    codigo = 1;
    return codigo;
  } finally {
    voltarParaMain({ git, log });
  }
}

process.exit(main());
