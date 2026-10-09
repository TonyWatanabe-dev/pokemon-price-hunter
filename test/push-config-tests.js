// Lote 6 — gravação do robô em config/ no main (tools/push-config.sh), com repositórios Git locais temporários:
// sem mudança · só o robô mudou · humano mudou outro arquivo durante a rodada (rebase limpo) · humano mudou o mesmo
// trecho (conflito: rebase abortado, edição humana preservada, aviso, saída 0) · remoto inacessível (saída 1).
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(root, 'tools/push-config.sh');
let n = 0;
async function t(name, fn) { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pushcfg-'));
// Git isolado da configuração da máquina (sem hooks, assinatura ou editor do usuário)
const ENV = { ...process.env, GIT_CONFIG_GLOBAL: path.join(tmp, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', PUSH_CONFIG_RETRY_SEC: '0' };
fs.writeFileSync(ENV.GIT_CONFIG_GLOBAL, '[init]\n\tdefaultBranch = main\n[advice]\n\tdetachedHead = false\n');
const git = (cwd, ...a) => execFileSync('git', a, { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const write = (dir, f, txt) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), txt); };
const read = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8');
const lines = (k) => Array.from({ length: 12 }, (_, i) => `linha ${i + 1}${i === k ? ' (mudou)' : ''}`).join('\n') + '\n';

let seq = 0;
/** remoto "origin" com main contendo config/ e data/; clones do robô e de um humano, como no Actions. */
function setup() {
  const base = path.join(tmp, `c${++seq}`); fs.mkdirSync(base);
  const origin = path.join(base, 'origin.git'); git(base, 'init', '-q', '--bare', origin);
  const seed = path.join(base, 'seed'); git(base, 'clone', '-q', origin, seed);
  for (const d of [seed]) { git(d, 'config', 'user.name', 'semente'); git(d, 'config', 'user.email', 's@x'); }
  write(seed, 'config/stores.json', lines(-1)); write(seed, 'config/catalog.json', lines(-1)); write(seed, 'README.md', 'x\n');
  git(seed, 'add', '.'); git(seed, 'commit', '-qm', 'início'); git(seed, 'push', '-q', 'origin', 'main');
  const clone = (name) => { const d = path.join(base, name); git(base, 'clone', '-q', origin, d); git(d, 'config', 'user.name', name); git(d, 'config', 'user.email', `${name}@x`); return d; };
  return { origin, robot: clone('robo'), human: clone('humano') };
}
const runScript = (cwd) => spawnSync('bash', [SCRIPT, 'origin', 'main'], { cwd, env: ENV, encoding: 'utf8' });
const originHead = (s) => git(s.robot, 'ls-remote', s.origin, 'refs/heads/main').split(/\s/)[0];
const originFile = (s, f) => git(s.robot, '--git-dir', s.origin, 'show', `main:${f}`) + '\n';
const humanPush = (s, f, txt) => { write(s.human, f, txt); git(s.human, 'commit', '-qam', 'edição humana'); git(s.human, 'push', '-q', 'origin', 'main'); };
const rebasing = (d) => fs.existsSync(path.join(d, '.git', 'rebase-merge')) || fs.existsSync(path.join(d, '.git', 'rebase-apply'));

await t('1. sem mudança em config/: sai 0, nenhum commit', () => {
  const s = setup(); const before = originHead(s);
  write(s.robot, 'data/state.json', '{}');          // fora de config/: nunca vai para o main por este script
  const r = runScript(s.robot);
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /sem mudança/);
  assert.equal(originHead(s), before);
  assert.equal(git(s.robot, 'rev-list', '--count', 'HEAD'), '1');
});

await t('2. só o robô mudou config/: commit e push no main', () => {
  const s = setup();
  write(s.robot, 'config/stores.json', lines(3));
  const r = runScript(s.robot);
  assert.equal(r.status, 0, r.stderr + r.stdout); assert.match(r.stdout, /publicada/);
  assert.equal(originFile(s, 'config/stores.json'), lines(3));
  assert.match(git(s.robot, '--git-dir', s.origin, 'log', '-1', '--format=%s', 'main'), /^config /);
});

await t('3. humano mudou OUTRO arquivo durante a rodada: rebase limpo, as duas mudanças ficam', () => {
  const s = setup();
  humanPush(s, 'config/catalog.json', lines(5));     // edição humana depois do checkout do robô
  write(s.robot, 'config/stores.json', lines(3));
  const r = runScript(s.robot);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(originFile(s, 'config/stores.json'), lines(3));
  assert.equal(originFile(s, 'config/catalog.json'), lines(5));
  assert.doesNotMatch(r.stdout, /::warning::/);
  // histórico linear: o commit do robô vem depois do humano
  assert.deepEqual(git(s.robot, '--git-dir', s.origin, 'log', '--format=%s', 'main').split('\n').slice(0, 2).map((x) => x.split(' ')[0]), ['config', 'edição']);
});

await t('3b. humano mudou outro trecho do MESMO arquivo: rebase limpo, as duas mudanças ficam', () => {
  const s = setup();
  humanPush(s, 'config/catalog.json', lines(0));
  write(s.robot, 'config/catalog.json', lines(-1).replace('linha 11\n', 'linha 11 (robô)\n'));
  const r = runScript(s.robot);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const out = originFile(s, 'config/catalog.json');
  assert.match(out, /linha 1 \(mudou\)/); assert.match(out, /linha 11 \(robô\)/);
});

await t('4. CONFLITO com edição humana: rebase abortado, edição humana intacta, aviso com o arquivo, saída 0', () => {
  const s = setup();
  humanPush(s, 'config/stores.json', lines(-1).replace('linha 4', 'linha 4 (humano)'));
  const humanHead = originHead(s);
  write(s.robot, 'config/stores.json', lines(-1).replace('linha 4', 'linha 4 (robô)'));
  write(s.robot, 'config/catalog.json', lines(7));     // a mudança do robô sem conflito também não sai (commit único)
  const r = runScript(s.robot);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /::warning::.*config\/stores\.json/);
  assert.doesNotMatch(r.stdout, /linha 4/);           // só nomes de arquivo, nada de conteúdo
  assert.equal(originHead(s), humanHead);               // nada publicado por cima
  assert.equal(originFile(s, 'config/stores.json'), lines(-1).replace('linha 4', 'linha 4 (humano)'));
  assert.equal(rebasing(s.robot), false);               // nenhum rebase pendurado
  assert.equal(git(s.robot, 'status', '--porcelain', '--untracked-files=no'), '');
});

await t('5. remoto inacessível: 3 tentativas e saída 1 (rodada vermelha, como antes)', () => {
  const s = setup();
  write(s.robot, 'config/stores.json', lines(2));
  git(s.robot, 'remote', 'set-url', 'origin', path.join(tmp, 'nao-existe.git'));
  const r = runScript(s.robot);
  assert.equal(r.status, 1); assert.match(r.stdout, /::error::/);
  assert.equal(rebasing(s.robot), false);
});

await t('6. hunter.yml usa o script e não tem mais resolução automática de conflito', () => {
  const y = fs.readFileSync(path.join(root, '.github/workflows/hunter.yml'), 'utf8');
  assert.match(y, /bash tools\/push-config\.sh origin main/);
  assert.doesNotMatch(y, /-X\s*theirs|-X\s*ours|--strategy-option/);
  for (const f of fs.readdirSync(path.join(root, '.github/workflows'))) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, '.github/workflows', f), 'utf8'), /-X\s*theirs/, f);
  }
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`OK — gravação de config/ no main: ${n} testes`);
