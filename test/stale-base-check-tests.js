// Alerta de PR com base desatualizada (#667): falha quando o PR remove linhas que a main ganhou depois do ponto de
// partida da branch, nos mesmos arquivos (revert silencioso, incidente de 13/10). Repositórios git temporários, sem rede.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verificar, parseDiff, remocoesSuspeitas, significativa, relatorio, MARCADOR } from '../tools/stale-base-check.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'tools', 'stale-base-check.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stale-base-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));

let n = 0;
async function t(name, fn) { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } }

let seq = 0;
function repo() {
  const dir = path.join(tmp, 'r' + (++seq)); fs.mkdirSync(dir);
  const g = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a],
    { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  const w = (f, linhas) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), linhas.join('\n') + '\n'); };
  const c = (msg) => { g('add', '-A'); g('commit', '-q', '--allow-empty', '-m', msg); };
  g('init', '-q', '-b', 'main');
  return { dir, g, w, c };
}
const BASE = ['export function a() {', '  return 1;', '}', '', 'export function b() {', '  return 2;', '}'];
const COM_C = [...BASE, '', 'export function c() {', '  return 3; // da main', '}'];

// main: BASE → (branch parte daqui) → main ganha c() no fim do arquivo.
function cenario() {
  const r = repo();
  r.w('src/x.js', BASE); r.w('src/y.js', ['export const y = 1;']); r.c('base');
  r.g('checkout', '-q', '-b', 'feat');
  r.g('checkout', '-q', 'main'); r.w('src/x.js', COM_C); r.c('main: adiciona c()');
  r.g('checkout', '-q', 'feat');
  return r;
}

await t('1. unidade: parseDiff separa removidas (arquivo antigo) e adicionadas (arquivo novo); ignora cabeçalhos', () => {
  const d = parseDiff(['diff --git a/p.js b/q.js', '--- a/p.js', '+++ b/q.js', '@@ -1,2 +1,2 @@', '-velha', '+nova', '--- não é cabeçalho', '\\ No newline at end of file',
    'diff --git a/n.js b/n.js', '--- /dev/null', '+++ b/n.js', '@@ -0,0 +1 @@', '+criada'].join('\n'));
  assert.deepEqual([...d.removidas], [['p.js', ['velha', '-- não é cabeçalho']]]);
  assert.deepEqual([...d.adicionadas], [['q.js', ['nova']], ['n.js', ['criada']]]);
  assert.equal(significativa('  });'), false); assert.equal(significativa(''), false); assert.equal(significativa('return ç;'), true);
});

await t('2. unidade: multiconjunto — linha readicionada não conta; linha já existente antes só conta até o nº adicionado pela main', () => {
  const M = (o) => new Map(Object.entries(o));
  const efeito = { removidas: M({ 'a.js': ['x = 1;', 'x = 1;', '}', 'y = 2;', 'z = 3;'] }), adicionadas: M({ 'b.js': ['y = 2;'] }) };
  const main = { adicionadas: M({ 'a.js': ['x = 1;', '}', 'y = 2;'] }) };
  assert.deepEqual(remocoesSuspeitas(efeito, main), [{ arquivo: 'a.js', linhas: ['x = 1;'] }]);
});

await t('3. branch desatualizada que mexe em outro trecho do mesmo arquivo: merge preserva a main → ok', () => {
  const r = cenario();
  r.w('src/x.js', BASE.map((l) => l.replace('return 1;', 'return 10;'))); r.c('feat: muda a()');
  const v = verificar({ cwd: r.dir, base: 'main', head: 'feat' });
  assert.equal(v.status, 'ok', relatorio(v));
});

await t('4. "Update branch" e depois arquivo regravado de cópia antiga: remove c() da main → falha com as linhas', () => {
  const r = cenario();
  r.w('src/y.js', ['export const y = 2;']); r.c('feat: muda y');
  r.g('merge', '-q', '--no-ff', '--no-edit', 'main');
  r.w('src/x.js', BASE.map((l) => l.replace('return 1;', 'return 10;'))); r.c('feat: muda a() (cópia antiga)');
  const v = verificar({ cwd: r.dir, base: 'main', head: 'feat' });
  assert.equal(v.status, 'falha');
  assert.deepEqual(v.suspeitas, [{ arquivo: 'src/x.js', linhas: ['export function c() {', '  return 3; // da main'] }], 'só linhas significativas');
  const txt = relatorio(v);
  assert.match(txt, /src\/x\.js/); assert.match(txt, /git merge origin\/main/); assert.ok(txt.includes(MARCADOR));
});

await t('5. branch não desatualizada, ou que só mexe em outros arquivos → ok', () => {
  const r = cenario();
  r.w('src/y.js', ['export const y = 2;']); r.c('feat: muda y');
  assert.equal(verificar({ cwd: r.dir, base: 'main', head: 'feat' }).status, 'ok', 'outro arquivo');
  r.g('checkout', '-q', '-b', 'nova', 'main'); r.w('src/x.js', BASE); r.c('remove c() de propósito');
  const v = verificar({ cwd: r.dir, base: 'main', head: 'nova' });
  assert.equal(v.status, 'ok', 'partiu da main atual: remoção é visível no diff do PR, não é revert silencioso');
  assert.match(v.motivo, /não mudou/);
});

await t('6. mover/renomear arquivo com as linhas recentes da main não é revert', () => {
  const r = cenario();
  r.g('merge', '-q', '--no-ff', '--no-edit', 'main');
  r.g('mv', 'src/x.js', 'src/z.js'); r.c('feat: renomeia');
  const v = verificar({ cwd: r.dir, base: 'main', head: 'feat' });
  assert.equal(v.status, 'ok', relatorio(v));
});

await t('7. marcador de remoção intencional em commit da branch vira aviso', () => {
  const r = cenario();
  r.g('merge', '-q', '--no-ff', '--no-edit', 'main');
  r.w('src/x.js', BASE); r.c('feat: remove c() ' + MARCADOR);
  const v = verificar({ cwd: r.dir, base: 'main', head: 'feat' });
  assert.equal(v.status, 'aviso'); assert.equal(v.suspeitas.length, 1);
});

await t('8. CLI: códigos de saída 0/1/2; ref ausente falha fechado', () => {
  const r = cenario();
  const cli = (...a) => spawnSync(process.execPath, [script, '--repo', r.dir, ...a], { encoding: 'utf8' });
  r.w('src/y.js', ['export const y = 2;']); r.c('feat: muda y');
  assert.equal(cli('--base', 'main', '--head', 'feat').status, 0);
  r.g('merge', '-q', '--no-ff', '--no-edit', 'main'); r.w('src/x.js', BASE); r.c('feat: cópia antiga');
  const f = cli('--base', 'main', '--head', 'feat');
  assert.equal(f.status, 1); assert.match(f.stderr, /return 3; \/\/ da main/);
  const e = cli('--base', 'origin/main', '--head', 'feat');
  assert.equal(e.status, 2); assert.match(e.stderr, /fetch-depth: 0/);
});

console.log(`✓ stale-base-check: ${n} testes`);
