// --check-age de tools/data-backup.mjs: sai 1 sem etiqueta ou com etiqueta mais velha que N dias; 0 caso contrário.
// Remoto: repositório bare temporário, sem rede. Roda dentro de npm test (test/run-all.mjs).
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'tools', 'data-backup.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-age-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
const sh = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

const bare = path.join(tmp, 'remote.git');
sh(tmp, 'init', '-q', '--bare', '-b', 'main', bare);
const work = path.join(tmp, 'work');
sh(tmp, 'clone', '-q', 'file://' + bare, work);
sh(work, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'x');
const NOW = '2026-10-13T05:00:00.000Z';
const age = (...extra) => spawnSync('node', [script, '--check-age', '--now', NOW, ...extra], { cwd: work, encoding: 'utf8' });

let r = age();
assert.equal(r.status, 1, 'sem etiquetas → 1');

sh(work, 'tag', 'data-backup/antes-da-migracao'); sh(work, 'push', '-q', 'origin', 'data-backup/antes-da-migracao');
assert.equal(age().status, 1, 'etiqueta de outro formato não conta');

sh(work, 'tag', 'data-backup/2026-10-10'); sh(work, 'push', '-q', 'origin', 'data-backup/2026-10-10');
assert.equal(age('--max-days', '2').status, 1, '3 dias com N=2 → 1');
assert.equal(age('--max-days', '3').status, 0, '3 dias com N=3 → 0');

sh(work, 'tag', 'data-backup/2026-10-13'); sh(work, 'push', '-q', 'origin', 'data-backup/2026-10-13');
assert.equal(age('--max-days', '2').status, 0, 'etiqueta de hoje → 0');

console.log('backup-age-tests ok');
