// meta.json com JSON inválido: recordRun recomeça o "ops" (com resetAt), mantém a escrita atômica e a perda do histórico fica documentada.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { buildRunRecord, recordRun } from '../src/opstate.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-corrupt-'));
const file = path.join(dir, 'meta.json');
const NOW = '2026-10-09T12:00:00.000Z';
const rec = buildRunRecord({
  env: { GITHUB_RUN_ID: '1', GITHUB_RUN_ATTEMPT: '1', GITHUB_EVENT_NAME: 'workflow_dispatch' },
  startedAt: NOW, finishedAt: '2026-10-09T12:06:00.000Z', generatedAt: NOW, prevGeneratedAt: null,
  reader: { status: 'ok', valid: 10, read: 10, reason: null },
  dbSync: null, stores: { found: 5, active: 3, withListings: 2, empty: 1, blocked: 1, error: 0, deferred: 0 }, offers: 1, alerts: 0,
});

// histórico anterior válido, depois o arquivo é corrompido
recordRun(file, { ...rec, runId: 'antiga' }, '2026-10-08T00:00:00.000Z');
assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).ops.runs.length, 1);
fs.writeFileSync(file, '{"ops": {"runs": [ corrompido');

const ops = recordRun(file, rec, NOW);
assert.equal(ops.resetAt, NOW, 'ops novo com resetAt');
assert.equal(ops.runs.length, 1, 'histórico anterior perdido: só a rodada atual');
assert.equal(ops.runs[0].runId, rec.runId);
assert.equal(ops.last.runId, rec.runId);

const saved = JSON.parse(fs.readFileSync(file, 'utf8'));   // arquivo voltou a ser JSON válido
assert.equal(saved.ops.resetAt, NOW);
assert.deepEqual(fs.readdirSync(dir), ['meta.json'], 'sem .tmp sobrando');

fs.rmSync(dir, { recursive: true, force: true });
console.log('ops-meta-corrupt-tests: ok');
