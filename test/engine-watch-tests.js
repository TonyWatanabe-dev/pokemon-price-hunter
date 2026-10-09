// Lote 3 — motor de oportunidades parado (batida em system_event → db-health → estado da rodada → vigia) e o portão
// do aviso imediato de falha do hunter.yml (só na transição). Puro; a parte em PostgreSQL fica em opportunity-db-tests.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildRunRecord, mergeOps, engineSummary, ENGINE_STOP_MIN } from '../src/opstate.js';
import { readDbHealth, syncStatus } from '../src/db-health.js';
import { evaluate, decide } from '../src/ops-watch.js';
import { gate } from '../tools/failure-alert-gate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };
const iso = (base, min) => new Date(Date.parse(base) + min * 6e4).toISOString();
const NOW = '2026-10-09T12:00:00.000Z';

// rodada sintética: engine = minutos da batida em relação ao generatedAt anterior (positivo = depois); null = sem batida
let seq = 0;
function rec({ at, sync = 'ok', engine = 5 } = {}) {
  seq++; const prev = iso(at, -15);
  const health = sync === 'off' ? { status: 'off' } : sync === 'erro' ? { status: 'error', reason: 'ECONNREFUSED' }
    : { status: 'ok', lastSeenAt: sync === 'atrasado' ? iso(at, -60) : prev, engineAt: prev, engineRunAt: engine == null ? null : iso(prev, engine) };
  return buildRunRecord({ env: { GITHUB_RUN_ID: String(5000 + seq), GITHUB_RUN_ATTEMPT: '1' }, startedAt: at, finishedAt: iso(at, 6), generatedAt: at, prevGeneratedAt: prev,
    reader: { status: 'ok', valid: 400, read: 420, reason: null }, dbSync: syncStatus(health, prev),
    stores: { found: 100, active: 50, withListings: 30, empty: 20, blocked: 40, error: 2, deferred: 0 }, offers: 900, alerts: 0 });
}
const metaOf = (...recs) => recs.reduce((m, r) => mergeOps(m, r, r.finishedAt), {});
const runs = (k = 3) => Array.from({ length: k }, (_, i) => ({ status: 'completed', conclusion: 'success', createdAt: iso(NOW, -15 * i - 7), updatedAt: iso(NOW, -15 * i) }));

// ------------------------------------------------------------------ estado da rodada
await t('1. engine no registro: ok, parado, sem_heartbeat e desconhecido', () => {
  const at = iso(NOW, -5);
  const ok = rec({ at, engine: 4 }); assert.equal(ok.engine.status, 'ok'); assert.equal(ok.engine.lagMin, -4); assert.equal(ok.dbSync.engineRunAt, iso(iso(at, -15), 4));
  assert.equal(rec({ at, engine: -ENGINE_STOP_MIN }).engine.status, 'ok', '30 min antes ainda é ok');
  const st = rec({ at, engine: -45 }); assert.equal(st.engine.status, 'parado'); assert.deepEqual(st.issues, ['motor_parado']); assert.equal(st.health, 'degradado');
  const none = rec({ at, engine: null }); assert.equal(none.engine.status, 'sem_heartbeat'); assert.deepEqual(none.issues, [], 'rollout: sem batida não é problema');
  assert.equal(rec({ at, sync: 'off' }).engine.status, 'desconhecido');
  assert.equal(rec({ at, sync: 'erro' }).engine.status, 'desconhecido');
  // sync atrasado: o problema é a sincronização (o motor roda depois dela), não "motor parado"
  assert.equal(rec({ at, sync: 'atrasado', engine: -45 }).engine.status, 'ok', 'até 60 min com sync atrasado: ok');
  assert.equal(rec({ at, sync: 'atrasado', engine: -90 }).engine.status, 'desconhecido');
  assert.equal(engineSummary(null).status, 'desconhecido');
  assert.equal(engineSummary({ status: 'sem_referencia', prevGeneratedAt: null, engineRunAt: NOW }).status, 'desconhecido');
  // compatível: registro antigo (sem engine) continua válido no meta.json
  const old = rec({ at }); delete old.engine; assert.equal(metaOf(old).ops.runs.length, 1);
});

// ------------------------------------------------------------------ vigia
await t('2. vigia: motor_parado depois de 2 rodadas paradas; 1 só registra; sem_heartbeat nunca avisa', () => {
  const r1 = rec({ at: iso(NOW, -20), engine: -45 }); const r2 = rec({ at: iso(NOW, -5), engine: -60 });
  const ev = evaluate({ now: NOW, stateGeneratedAt: iso(NOW, -5), meta: metaOf(r1, r2), runs: runs() });
  assert.equal(ev.status, 'degradado'); assert.deepEqual(ev.reasons.map((r) => r.code), ['motor_parado']);
  assert.match(ev.reasons[0].text, /Motor de oportunidades parado \(última execução: .+\): as notas podem estar antigas\./);
  const d = decide(ev, null, NOW); assert.equal(d.notify.kind, 'falha'); assert.match(d.notify.text, /Motor de oportunidades parado/);
  const one = evaluate({ now: NOW, stateGeneratedAt: iso(NOW, -5), meta: metaOf(rec({ at: iso(NOW, -20) }), r2), runs: runs() });
  assert.equal(one.status, 'saudavel', '1 rodada só não avisa');
  const sem = evaluate({ now: NOW, stateGeneratedAt: iso(NOW, -5), meta: metaOf(rec({ at: iso(NOW, -20), engine: null }), rec({ at: iso(NOW, -5), engine: null })), runs: runs() });
  assert.equal(sem.status, 'saudavel', 'sem batida (implantação) não avisa');
  // recuperação lista o rótulo do código
  const L = { notifiedStatus: 'degradado', notifiedAt: iso(NOW, -30), notifiedCodes: ['motor_parado'], incidentSince: iso(NOW, -30), lastStatus: 'saudavel' };
  const ok = evaluate({ now: NOW, stateGeneratedAt: iso(NOW, -5), meta: metaOf(rec({ at: iso(NOW, -20) }), rec({ at: iso(NOW, -5) })), runs: runs() });
  assert.match(decide(ok, L, NOW).notify.text, /motor de oportunidades parado/);
});

// ------------------------------------------------------------------ db-health
await t('3. readDbHealth: engineRunAt da batida; null sem batida ou sem a tabela; tudo numa transação só de leitura', async () => {
  const fake = (rows) => { const seen = []; return { seen, mod: { default: { Client: class {
    on() {} async connect() {} async end() {}
    async query(sql) { seen.push(sql); for (const [re, r] of rows) if (re.test(sql)) return { rows: [r] }; return { rows: [] }; } } } } }; };
  const base = [[/last_seen_at/, { last_seen_at: '2026-10-09T11:45:00Z' }], [/calculated_at/, { engine_at: '2026-10-09T11:46:00Z' }]];
  let f = fake([...base, [/to_regclass/, { ok: true }], [/OPPORTUNITY_ENGINE_RUN/, { run_at: '2026-10-09T11:50:00Z' }]]);
  let h = await readDbHealth({ env: { DATABASE_URL: 'postgres://u:p@h/x' }, loadPg: async () => f.mod });
  assert.equal(h.status, 'ok'); assert.equal(h.engineRunAt, '2026-10-09T11:50:00.000Z');
  assert.equal(f.seen[0], 'BEGIN READ ONLY'); assert.equal(f.seen.at(-1), 'COMMIT');
  assert.ok(f.seen.every((s) => !/\b(INSERT|UPDATE|DELETE)\b/.test(s)), 'só leitura');
  f = fake([...base, [/to_regclass/, { ok: true }], [/OPPORTUNITY_ENGINE_RUN/, { run_at: null }]]);
  assert.equal((await readDbHealth({ env: { DATABASE_URL: 'postgres://u:p@h/x' }, loadPg: async () => f.mod })).engineRunAt, null, 'sem batida');
  f = fake([...base, [/to_regclass/, { ok: false }]]);
  h = await readDbHealth({ env: { DATABASE_URL: 'postgres://u:p@h/x' }, loadPg: async () => f.mod });
  assert.equal(h.status, 'ok'); assert.equal(h.engineRunAt, null); assert.ok(!f.seen.some((s) => /OPPORTUNITY_ENGINE_RUN/.test(s)), 'sem tabela, nem consulta');
  assert.equal((await readDbHealth({ env: {} })).engineRunAt, null);
  assert.equal(syncStatus(h, '2026-10-09T11:45:00Z').engineRunAt, null);
});

// ------------------------------------------------------------------ portão do aviso de falha (hunter.yml)
await t('4. portão: anterior falhou → não avisa; anterior ok → avisa; erro/lista vazia → avisa; cancelada não conta', () => {
  const r = (id, conclusion, min, status = 'completed') => ({ databaseId: id, status, conclusion, createdAt: iso(NOW, min), updatedAt: iso(NOW, min + 6) });
  const cur = r(10, '', 0, 'in_progress');
  assert.equal(gate([cur, r(9, 'failure', -15), r(8, 'success', -30)], 10).decision, 'skip');
  assert.equal(gate([cur, r(9, 'timed_out', -15)], 10).decision, 'skip');
  assert.equal(gate([cur, r(9, 'success', -15), r(8, 'failure', -30)], 10).decision, 'send', 'primeira falha avisa já');
  assert.equal(gate([cur, r(9, 'cancelled', -15), r(8, 'failure', -30)], 10).decision, 'skip', 'cancelada é ignorada');
  assert.equal(gate([cur, r(9, 'cancelled', -15), r(8, 'success', -30)], 10).decision, 'send');
  assert.equal(gate([cur], 10).decision, 'send', 'sem anterior');
  assert.equal(gate(null, 10).decision, 'send'); assert.equal(gate('erro', 10).decision, 'send');
  assert.equal(gate([r(11, 'failure', 5), cur, r(9, 'success', -15)], 10).decision, 'send', 'rodada mais nova que a atual não conta');
  assert.equal(gate([r(9, 'failure', -15)], 10).decision, 'skip', 'atual fora da lista: usa a última concluída');
  // CLI: arquivo com erro do gh, ausente ou ilegível → "send"; nunca falha
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-'));
  const cli = (file, cur) => execFileSync('node', ['tools/failure-alert-gate.mjs', '--runs', file, '--current', cur], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  fs.writeFileSync(path.join(tmp, 'erro.json'), 'erro\n'); assert.equal(cli(path.join(tmp, 'erro.json'), '10'), 'send');
  assert.equal(cli(path.join(tmp, 'nao-existe.json'), '10'), 'send');
  fs.writeFileSync(path.join(tmp, 'ok.json'), JSON.stringify([cur, r(9, 'failure', -15)])); assert.equal(cli(path.join(tmp, 'ok.json'), '10'), 'skip');
  fs.rmSync(tmp, { recursive: true, force: true });
});
await t('5. hunter.yml: aviso imediato mantido, gate antes do envio, gh com token do workflow e actions: read, falha do gh = avisa', () => {
  const y = fs.readFileSync(path.join(root, '.github/workflows/hunter.yml'), 'utf8');
  assert.match(y, /permissions:\s*\n\s*contents: write\s*\n\s*actions: read/);
  const step = y.slice(y.indexOf('- name: Avisar falha no Telegram'));
  assert.match(step, /if: failure\(\)/); assert.match(step, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(step, /gh run list[^\n]*--workflow hunter\.yml[\s\S]*\|\| echo 'erro' > "\$R"/, 'erro do gh vira lista ilegível (= avisa)');
  assert.match(step, /decision=\$\(node tools\/failure-alert-gate\.mjs --runs "\$R" --current "\$GITHUB_RUN_ID" \|\| true\)/);
  assert.match(step, /\[ "\$decision" = "skip" \] && exit 0\n\s*curl -s --max-time 20[^\n]*sendMessage/, 'só "skip" explícito silencia');
  assert.doesNotMatch(step, /(echo|printf)[^\n]*(TELEGRAM_BOT_TOKEN|GH_TOKEN|secrets\.)/, 'nenhum segredo impresso');
});

console.log(`✓ Motor parado e aviso de falha (Lote 3): ${n} grupos passaram`);
