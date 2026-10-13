// Vigia sem nenhum canal configurado (observabilidade T2, lacuna 2): documenta o comportamento atual de main().
// O aviso sai como não entregue, o livro não avança (notifiedStatus continua 'saudavel') e a checagem seguinte avisa
// de novo; quando um canal aparece, o mesmo aviso é entregue e só então o livro avança. Canais simulados.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildRunRecord, mergeOps } from '../src/opstate.js';
import { syncStatus } from '../src/db-health.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-semcanal-'));
const iso = (base, min) => new Date(Date.parse(base) + min * 6e4).toISOString();
const NOW = '2026-10-09T12:00:00.000Z';
let k = 0;
async function load(argv) {
  const saved = process.argv; process.argv = [saved[0], saved[1], ...argv];
  try { return await import(pathToFileURL(path.join(root, 'tools/watchdog.mjs')).href + '?semcanal=' + (++k)); } finally { process.argv = saved; }
}

// cenário parado: meta saudável, rodadas ok, mas os dados publicados têm 1 h
let seq = 0;
function rec(at) {
  seq++; const prev = iso(at, -15);
  return buildRunRecord({ env: { GITHUB_RUN_ID: String(7000 + seq), GITHUB_RUN_ATTEMPT: '1' }, startedAt: at, finishedAt: iso(at, 6), generatedAt: at, prevGeneratedAt: prev,
    reader: { status: 'ok', valid: 500, read: 520, reason: null }, dbSync: syncStatus({ status: 'ok', lastSeenAt: prev, engineAt: prev }, prev),
    stores: { found: 128, active: 54, withListings: 32, empty: 22, blocked: 54, error: 2, deferred: 0 }, offers: 900, alerts: 0 });
}
const T0 = iso(NOW, -15);
const meta = [rec(iso(T0, -15)), rec(T0)].reduce((m, r) => mergeOps(m, r, r.finishedAt), {});
const runs = Array.from({ length: 3 }, (_, i) => ({ status: 'completed', conclusion: 'success', createdAt: iso(NOW, -15 * i - 7), updatedAt: iso(NOW, -15 * i) }));
const w = (f, o) => fs.writeFileSync(path.join(tmp, f), JSON.stringify(o));
w('state.json', { generatedAt: iso(NOW, -60) }); w('meta.json', meta); w('runs.json', runs);
const ledger = path.join(tmp, 'ledger.json');
const files = ['--state', path.join(tmp, 'state.json'), '--meta', path.join(tmp, 'meta.json'), '--runs', path.join(tmp, 'runs.json'), '--ledger', ledger];
const calls = [];
const fetchImpl = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true, status: 200 }; };
const check = async (now, env) => (await load([...files, '--now', now])).main({ env, fetchImpl, log: () => {} });

await t('1. parado sem canal: aviso decidido mas não entregue, canais pulados, saída normal', async () => {
  const r = await check(NOW, {});
  assert.equal(r.status, 'parado'); assert.equal(r.notify, 'falha');
  assert.equal(r.delivered, false); assert.equal(calls.length, 0, 'nada enviado');
  assert.deepEqual(r.channels, [{ name: 'telegram', ok: false, skipped: true }, { name: 'ntfy', ok: false, skipped: true }]);
});

await t('2. o livro é gravado, mas não avança: notifiedStatus continua saudavel, incidente aberto', () => {
  const L = JSON.parse(fs.readFileSync(ledger, 'utf8'));
  assert.equal(L.notifiedStatus, 'saudavel', 'não marca como avisado'); assert.equal(L.notifiedAt, null); assert.deepEqual(L.notifiedCodes, []);
  assert.equal(L.lastStatus, 'parado'); assert.equal(L.lastCheckAt, NOW); assert.equal(L.incidentSince, NOW);
});

await t('3. checagem seguinte, ainda sem canal: o aviso é decidido de novo (não silencia como deduplicado)', async () => {
  const r = await check(iso(NOW, 30), {});
  assert.equal(r.notify, 'falha'); assert.equal(r.delivered, false); assert.equal(calls.length, 0);
  const L = JSON.parse(fs.readFileSync(ledger, 'utf8'));
  assert.equal(L.notifiedStatus, 'saudavel'); assert.equal(L.notifiedAt, null); assert.equal(L.incidentSince, NOW, 'início do incidente preservado'); assert.equal(L.lastCheckAt, iso(NOW, 30));
});

await t('4. canal configurado depois: o mesmo aviso é reenviado, entregue, e só então o livro avança', async () => {
  const r = await check(iso(NOW, 60), { NTFY_TOPIC: 'topico-teste', NTFY_SERVER: 'http://ntfy.invalid/' });
  assert.equal(r.notify, 'falha'); assert.equal(r.delivered, true);
  assert.equal(calls.length, 1); assert.match(calls[0].body.message, /parado/);
  const L = JSON.parse(fs.readFileSync(ledger, 'utf8'));
  assert.equal(L.notifiedStatus, 'parado'); assert.equal(L.notifiedAt, iso(NOW, 60)); assert.equal(L.incidentSince, NOW);
  const again = await check(iso(NOW, 75), { NTFY_TOPIC: 'topico-teste', NTFY_SERVER: 'http://ntfy.invalid/' });
  assert.equal(again.notify, null, 'entregue: deduplica a seguir'); assert.equal(calls.length, 1);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`✓ Vigia sem canal: ${n} grupos passaram`);
