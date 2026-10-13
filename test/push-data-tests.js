// tools/push-data.sh recusa publicar data/ vazio/inválido (exit 1, ramo "data" intacto) e publica data/ válido.
// Roda o script real contra um remoto bare local (PUSH_DATA_REMOTE); nunca usa a rede.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(root, 'tools/push-data.sh');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pushdata-'));
const gcfg = path.join(tmp, 'gitconfig'); fs.writeFileSync(gcfg, '');
const ENV = { ...process.env, GIT_CONFIG_GLOBAL: gcfg, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };
const git = (cwd, ...a) => execFileSync('git', a, { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const remote = path.join(tmp, 'origin.git'); git(tmp, 'init', '-q', '--bare', remote);
const work = path.join(tmp, 'work'); fs.mkdirSync(work);
const run = () => spawnSync('bash', [SCRIPT], { cwd: work, env: { ...ENV, PUSH_DATA_REMOTE: remote }, encoding: 'utf8' });
const setData = (files) => { fs.rmSync(path.join(work, 'data'), { recursive: true, force: true }); fs.mkdirSync(path.join(work, 'data'));
  for (const [f, t] of Object.entries(files)) fs.writeFileSync(path.join(work, 'data', f), t); };
const head = () => { try { return git(tmp, '--git-dir', remote, 'rev-parse', 'refs/heads/data'); } catch { return null; } };

// data/ válido → publicado
setData({ 'state.json': JSON.stringify({ generatedAt: '2026-01-01T00:00:00Z', offers: [] }) });
let r = run(); assert.equal(r.status, 0, r.stderr);
const publicado = head(); assert.ok(publicado);

// data/ vazio, sem offers ou sem generatedAt → exit 1 e ramo intacto
for (const files of [{}, { 'state.json': '{}' }, { 'state.json': JSON.stringify({ offers: [] }) },
  { 'state.json': JSON.stringify({ generatedAt: 'x' }) }, { 'state.json': 'lixo' }]) {
  setData(files); r = run();
  assert.equal(r.status, 1, JSON.stringify(files));
  assert.equal(head(), publicado, 'ramo data deve ficar intacto');
}
console.log('push-data-tests ok');
