// Backup do ramo data (extraído da PR #16, Lote 4) por etiquetas (tools/data-backup.mjs) e restauração (tools/data-restore.mjs).
// Tudo num repositório bare temporário que imita o GitHub: o "robô" reescreve o ramo data com push -f (como tools/push-data.sh).
// Com TEST_DATABASE_URL (banco descartável), também faz a volta completa: restaurar → db-sync → mesma contagem de ofertas.
// Sem rede: o remoto é um repositório bare local. Roda dentro de npm test via test/redact-tests.js (await import).
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeGit, runBackup, listBackupTags, validateSnapshot, planPrune, retentionDays, tagFor, tagDate, RETENTION_DEFAULT } from '../tools/data-backup.mjs';
import { restoreTo, verify, tagName } from '../tools/data-restore.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-tests-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
const sh = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
const quiet = []; const log = (s) => quiet.push(s);
const day = (d, h = '04:41') => `${d}T${h}:00.000Z`;

// "GitHub": repositório bare
const bare = path.join(tmp, 'remote.git');
sh(tmp, 'init', '-q', '--bare', '-b', 'main', bare);
const url = 'file://' + bare;

// Retrato realista: a pasta data/ do repositório + meta.json com ops, hist/ e um binário (como ml-auth.enc)
const SRC = path.join(root, 'data');
function snapshotFiles(extra = {}) {
  const files = {};
  for (const f of fs.readdirSync(SRC)) if (fs.statSync(path.join(SRC, f)).isFile()) files[f] = fs.readFileSync(path.join(SRC, f));
  files['meta.json'] = Buffer.from(JSON.stringify({ dataVersion: 3, ops: { version: 1, runs: [], last: { runId: '777', health: 'saudavel' } } }));
  files['hist/me05-etb.json'] = Buffer.from(JSON.stringify([{ t: '2026-10-01', min: 350 }]));
  files['hist/sv1-booster.json'] = Buffer.from(JSON.stringify([{ t: '2026-10-02', min: 25 }]));
  files['ml-auth.enc'] = crypto.randomBytes(2048);
  return { ...files, ...extra };
}
// Mesmo procedimento de tools/push-data.sh: repositório novo, um commit, push -f no ramo data
let pubSeq = 0;
function publish(files) {
  const d = path.join(tmp, `pub-${++pubSeq}`); fs.mkdirSync(d);
  for (const [f, buf] of Object.entries(files)) {
    if (buf == null) continue;
    const p = path.join(d, 'data', f); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, buf);
  }
  sh(d, 'init', '-q', '-b', 'data');
  sh(d, '-c', 'user.name=t', '-c', 'user.email=t@t', 'add', 'data');
  sh(d, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', `dados ${pubSeq}`);
  sh(d, 'push', '-q', '-f', url, 'data');
  return { sha: sh(d, 'rev-parse', 'HEAD'), files };
}
// Clone "do Actions" (só o remoto configurado, como o checkout)
function ciClone(name) {
  const d = path.join(tmp, name); fs.mkdirSync(d);
  sh(d, 'init', '-q', '-b', 'main'); sh(d, 'remote', 'add', 'origin', url);
  return d;
}
const ci = ciClone('ci'); const git = makeGit(ci);
const remoteTags = () => listBackupTags(git).map((x) => x.name).sort();
const backup = (now, o = {}) => runBackup({ git, now, log, ...o });

// ------------------------------------------------------------------ unidades
await t('1. retenção da variável, nome e data da etiqueta, plano de poda', () => {
  assert.equal(retentionDays(undefined), RETENTION_DEFAULT); assert.equal(retentionDays(''), 14); assert.equal(retentionDays('30'), 30);
  for (const bad of ['0', '2', '-5', 'abc', '7.5', '9999']) assert.equal(retentionDays(bad), 14, `"${bad}" cai no padrão`);
  assert.equal(tagFor('2026-10-09T23:59:00-03:00'), 'data-backup/2026-10-10', 'data em UTC');
  assert.equal(tagDate('data-backup/2026-02-30'), null); assert.equal(tagDate('data-backup/antes-da-migracao'), null);
  const names = ['data-backup/2026-10-09', 'data-backup/2026-09-25', 'data-backup/2026-09-24', 'data-backup/2026-09-01', 'data-backup/manual'];
  assert.deepEqual(planPrune(names, { now: day('2026-10-09'), retention: 14 }), ['data-backup/2026-09-01'], '15 dias: 25/09 fica (14), 24/09 é das 3 mais novas');
  assert.deepEqual(planPrune(['data-backup/2026-01-01', 'data-backup/2026-01-02', 'data-backup/2026-01-03'], { now: day('2026-10-09') }), [], 'as 3 últimas nunca saem');
});

// ------------------------------------------------------------------ backup
const p1 = publish(snapshotFiles());
await t('2. cria data-backup/AAAA-MM-DD no commit atual do ramo data (etiqueta anotada com o resumo)', () => {
  const r = backup(day('2026-10-09'));
  assert.equal(r.status, 'created'); assert.equal(r.tag, 'data-backup/2026-10-09'); assert.equal(r.commit, p1.sha);
  const tags = listBackupTags(git); assert.equal(tags.length, 1); assert.equal(tags[0].commit, p1.sha);
  assert.notEqual(tags[0].sha, p1.sha, 'anotada: objeto de etiqueta próprio');
  const state = JSON.parse(p1.files['state.json']);
  const msg = sh(ci, 'for-each-ref', '--format=%(contents)', 'refs/tags/data-backup/2026-10-09');
  assert.match(msg, new RegExp(`ofertas: ${state.offers.length}`)); assert.match(msg, /ops\.last\.runId: 777/);
});

await t('3. idempotente: mesma data não move a etiqueta, nem depois de o robô reescrever o ramo', () => {
  assert.equal(backup(day('2026-10-09', '05:00')).status, 'exists');
  const p2 = publish(snapshotFiles({ 'tips.json': Buffer.from('{"novo":true}') }));
  assert.notEqual(p2.sha, p1.sha);
  const r = backup(day('2026-10-09', '23:00'));
  assert.equal(r.status, 'exists'); assert.equal(listBackupTags(git)[0].commit, p1.sha, 'continua no primeiro retrato do dia');
  // outro clone (nova execução do Actions) enxerga o mesmo
  assert.equal(runBackup({ git: makeGit(ciClone('ci-b')), now: day('2026-10-09'), log }).status, 'exists');
});

await t('4. retrato inválido não é marcado e o job falha visível (código de saída 1)', () => {
  const cases = [
    ['state.json ilegível', { 'state.json': Buffer.from('{"generatedAt": "2026-10-10T00:00:00Z", "offers": [') }, /state\.json ilegível/],
    ['sem generatedAt', { 'state.json': Buffer.from(JSON.stringify({ offers: [] })) }, /sem generatedAt/],
    ['sem offers', { 'state.json': Buffer.from(JSON.stringify({ generatedAt: '2026-10-10T00:00:00Z' })) }, /sem a lista offers/],
    ['meta.json ilegível', { 'meta.json': Buffer.from('nope') }, /meta\.json ilegível/],
    ['sem meta.json', { 'meta.json': null }, /meta\.json ausente/],
  ];
  for (const [name, extra, re] of cases) {
    const p = publish(snapshotFiles(extra));
    const r = backup(day('2026-10-10'));
    assert.equal(r.status, 'invalid', name); assert.match(r.errors.join(';'), re, name); assert.equal(r.commit, p.sha);
    assert.ok(!remoteTags().includes('data-backup/2026-10-10'), `${name}: não marcou`);
  }
  const cli = spawnSync('node', [path.join(root, 'tools/data-backup.mjs'), '--now', day('2026-10-10')], { cwd: ci, encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: path.join(tmp, 'summary.md') } });
  assert.equal(cli.status, 1, cli.stdout + cli.stderr); assert.match(cli.stdout, /Retrato inválido, NÃO marcado/);
  assert.match(fs.readFileSync(path.join(tmp, 'summary.md'), 'utf8'), /❌ Retrato inválido/);
  assert.deepEqual(remoteTags(), ['data-backup/2026-10-09']);
  // sem o ramo data: falha visível
  const empty = path.join(tmp, 'vazio.git'); sh(tmp, 'init', '-q', '--bare', empty);
  const e = ciClone('ci-vazio'); sh(e, 'remote', 'set-url', 'origin', 'file://' + empty);
  assert.equal(spawnSync('node', [path.join(root, 'tools/data-backup.mjs')], { cwd: e, encoding: 'utf8' }).status, 1);
});

await t('5. retenção: apaga etiquetas datadas velhas, guarda as 3 mais novas e as de outro formato', () => {
  publish(snapshotFiles()); // retrato válido de novo
  for (const d of ['2026-08-20', '2026-08-25', '2026-09-10', '2026-09-20', '2026-10-01', 'antes-da-migracao']) {
    sh(ci, 'tag', '-f', `data-backup/${d}`, p1.sha); sh(ci, 'push', '-q', 'origin', `refs/tags/data-backup/${d}`);
  }
  const r = backup(day('2026-10-11'), { retention: 14 });
  assert.equal(r.status, 'created');
  assert.deepEqual(r.pruned.sort(), ['data-backup/2026-08-20', 'data-backup/2026-08-25', 'data-backup/2026-09-10', 'data-backup/2026-09-20']);
  assert.deepEqual(remoteTags(), ['data-backup/2026-10-01', 'data-backup/2026-10-09', 'data-backup/2026-10-11', 'data-backup/antes-da-migracao']);
  // robô parado por um mês: tudo velho, mas as 3 últimas ficam
  const late = backup(day('2026-12-20'), { retention: 14 });
  assert.equal(late.status, 'created');
  assert.deepEqual(remoteTags(), ['data-backup/2026-10-09', 'data-backup/2026-10-11', 'data-backup/2026-12-20', 'data-backup/antes-da-migracao']);
  // retrato inválido não poda nada
  publish(snapshotFiles({ 'state.json': Buffer.from('x') }));
  assert.equal(backup(day('2027-03-01'), { retention: 3 }).status, 'invalid');
  assert.equal(remoteTags().length, 4);
  // simulação não envia nada
  publish(snapshotFiles());
  const dry = backup(day('2027-03-01'), { retention: 3, dryRun: true });
  assert.equal(dry.status, 'created'); assert.equal(dry.pruned.length, 1); assert.equal(remoteTags().length, 4);
});

// ------------------------------------------------------------------ restauração
const out = path.join(tmp, 'restaurado');
await t('6. restaura data-backup/2026-10-09 depois de várias reescritas do ramo: conteúdo idêntico ao original', () => {
  const g = makeGit(ciClone('restore')); // clone novo, sem nada local
  const v = verify(g, '2026-10-09'); assert.ok(v.ok, v.errors.join(';')); assert.equal(v.commit, p1.sha);
  const state = JSON.parse(p1.files['state.json']);
  assert.equal(v.info.offers, state.offers.length); assert.equal(v.info.products, state.products.length);
  assert.equal(v.info.generatedAt, state.generatedAt); assert.equal(v.info.ops, true); assert.equal(v.info.histFiles, 2);
  assert.equal(v.info.files, Object.keys(p1.files).length);
  const dry = restoreTo(g, 'data-backup/2026-10-09', out);
  assert.equal(dry.written, 0); assert.ok(!fs.existsSync(out), 'simulação não grava');
  const r = restoreTo(g, 'data-backup/2026-10-09', out, { apply: true });
  assert.equal(r.written, Object.keys(p1.files).length);
  for (const [f, buf] of Object.entries(p1.files)) assert.ok(fs.readFileSync(path.join(out, 'data', f)).equals(buf), `${f} igual ao original`);
  assert.throws(() => restoreTo(g, '2026-10-09', out, { apply: true }), /não está vazia/);
  assert.throws(() => verify(g, '2030-01-01'), 'etiqueta inexistente');
  assert.throws(() => verify(g, '../../heads/data'), /etiqueta inválida/);
  assert.equal(tagName('2026-10-09'), 'data-backup/2026-10-09');
});

await t('7. linha de comando: --list, --verify, --to (simulação e --apply); nunca envia nada', () => {
  const d = ciClone('cli'); const run = (...a) => spawnSync('node', [path.join(root, 'tools/data-restore.mjs'), ...a], { cwd: d, encoding: 'utf8' });
  const before = sh(tmp, 'ls-remote', url);
  const l = run('--list'); assert.equal(l.status, 0, l.stderr);
  assert.match(l.stdout, new RegExp(`data-backup/2026-10-09\\t${p1.sha}`)); assert.match(l.stdout, /4 etiqueta\(s\)/);
  const v = run('--verify', '2026-10-09'); assert.equal(v.status, 0, v.stderr); assert.match(v.stdout, /meta\.ops: sim/); assert.match(v.stdout, /Retrato válido/);
  const bad = run('--verify', 'nao-existe'); assert.equal(bad.status, 1);
  const target = path.join(tmp, 'cli-out');
  const sim = run('--to', target, '2026-10-09'); assert.equal(sim.status, 0, sim.stderr); assert.match(sim.stdout, /SIMULAÇÃO/); assert.ok(!fs.existsSync(target));
  const ap = run('--to', target, '2026-10-09', '--apply'); assert.equal(ap.status, 0, ap.stderr);
  assert.ok(fs.readFileSync(path.join(target, 'data/state.json')).equals(p1.files['state.json']));
  assert.equal(run().status, 2, 'sem argumentos: ajuda');
  assert.equal(sh(tmp, 'ls-remote', url), before, 'remoto intacto');
});

// ------------------------------------------------------------------ volta completa no banco
if (process.env.TEST_DATABASE_URL) {
  await t('8. restaurar → db-sync → ofertas no banco = ofertas do retrato', async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { pool, close } = await import('../src/db/pg.js');
    const p = await pool();
    await p.query('DROP SCHEMA IF EXISTS hunter CASCADE');
    execFileSync('node', ['tools/db-migrate.mjs'], { cwd: root, env: process.env, stdio: 'pipe' });
    const s = execFileSync('node', ['tools/db-sync.mjs', path.join(out, 'data')], { cwd: root, env: process.env, encoding: 'utf8' });
    const stats = JSON.parse(s.slice(s.indexOf('{')));
    const state = JSON.parse(p1.files['state.json']);
    const ids = new Set(state.products.map((x) => x.id));
    const expected = state.offers.filter((o) => ids.has(o.productId)).length;
    assert.equal(stats.offers, expected);
    const live = (await p.query("SELECT count(*)::int n FROM hunter.offer WHERE status <> 'removed'")).rows[0].n;
    const all = (await p.query('SELECT count(*)::int n FROM hunter.offer WHERE legacy_id = ANY($1::text[])', [state.offers.map((o) => o.id)])).rows[0].n;
    assert.equal(all, expected, 'cada oferta do retrato está no banco');
    assert.equal(live, expected, 'ativas = ofertas do retrato (as removidas são as antigas, só do histórico)');
    await close();
  });
  console.log(`✓ Backup do ramo data: ${n} grupos passaram (com banco)`);
} else console.log(`✓ Backup do ramo data: ${n} grupos passaram; banco pulado (sem TEST_DATABASE_URL)`);
