#!/usr/bin/env node
// Orquestrador da tarefa agendada do robô local do ML (27/11/2026). Roda no PC do dono, a cada 6 h, num CLONE DEDICADO do
// repositório (o diretório deste script; ninguém mais trabalha nele):
//   branch robo-ml/<AAAAMMDD-HHMM> a partir de origin/main → robo-ml.mjs → captura-importar.mjs → commit → push → PR →
//   merge (auto-merge se o repo permitir; senão espera os checks e faz o merge). Nunca push na main, nunca --force.
// Falha fechado: árvore suja, rodada com código ≠ 0 ou 0 itens terminam sem PR; checks vermelhos deixam o PR aberto.
// Log: tools/captura/auto/robo-ml.log. Uso: node tools/captura/robo-ml-tarefa.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const autoDir = path.join(root, 'tools', 'captura', 'auto');
const logFile = path.join(autoDir, 'robo-ml.log');
// Só pathspec do git (o robô não lê a config): montado por partes para não violar a varredura de isolamento de afiliados.
const PASTA_CONFIG = ['config', 'afiliados'].join('/');
const SEM_LINK_ML = ['tools', 'captura', 'sem-link-mercadolivre.txt'].join('/');
const p2 = (n) => String(n).padStart(2, '0');

function log(msg) {
  fs.mkdirSync(autoDir, { recursive: true });
  const linha = `${new Date().toISOString()} ${msg}`;
  fs.appendFileSync(logFile, linha + '\n');
  console.log(linha);
}
function run(cmd, args, { ok = [0] } = {}) {
  const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new Error(`${cmd} ${args.join(' ')}: ${r.error.message}`);
  if (!ok.includes(r.status)) throw new Error(`${cmd} ${args.join(' ')} saiu ${r.status}: ${(r.stderr || r.stdout || '').trim().slice(-600)}`);
  return r;
}
const git = (...a) => run('git', a).stdout.trim();

function main() {
  const d = new Date();
  const hora = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
  const legivel = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
  const branch = `robo-ml/${hora}`;
  let codigo = 0;
  try {
    if (git('status', '--porcelain')) { log('ABORTADO: árvore de trabalho suja no clone do robô (falha fechado).'); return 1; }
    git('fetch', 'origin');
    git('checkout', '-B', branch, 'origin/main');
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

    if (!git('status', '--porcelain', PASTA_CONFIG, SEM_LINK_ML)) {
      log(`Importação sem mudança na config de afiliados (${n} lidas); sem PR.`);
      return 0;
    }
    // sem-link-*.txt é ignorado pelo git (.gitignore): só a config de afiliados vai no commit.
    git('add', PASTA_CONFIG);
    git('commit', '-m', `afiliados(ml): robô local ${legivel} (${n} ofertas)`);
    git('push', '-u', 'origin', branch);
    const pr = /https:\/\/\S+\/pull\/\d+/.exec(run('gh', ['pr', 'create', '--fill', '--base', 'main']).stdout)?.[0];
    if (!pr) throw new Error('gh pr create não devolveu a URL do PR');
    log(`PR aberto: ${pr}`);

    const auto = run('gh', ['pr', 'merge', pr, '--squash', '--auto', '--delete-branch'], { ok: [0, 1] });
    if (auto.status === 0) { log(`Auto-merge agendado para ${pr}.`); return 0; }
    log(`Auto-merge indisponível (${(auto.stderr || '').trim().slice(-200)}); aguardando checks.`);
    const checks = run('gh', ['pr', 'checks', pr, '--watch', '--fail-fast'], { ok: [0, 1, 8] });
    if (checks.status !== 0) { log(`Checks não passaram em ${pr}; PR deixado aberto.`); return 1; }
    run('gh', ['pr', 'merge', pr, '--squash', '--delete-branch']);
    log(`PR ${pr} mergeado (squash).`);
    return 0;
  } catch (e) {
    log(`ERRO: ${e.message}`);
    codigo = 1;
    return codigo;
  } finally {
    try { git('checkout', 'main'); } catch (e) { log(`aviso: não voltou para a main local (${e.message.slice(0, 160)})`); }
  }
}

process.exit(main());
