// Motor de oportunidades parado (extraído da PR #15): batida ENGINE_HEARTBEAT em system_event → db-health → estado
// da rodada (engine) → vigia (motor_parado). Puro; a parte em PostgreSQL fica em opportunity-db-tests.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRunRecord, mergeOps, engineSummary, ENGINE_STOP_MIN } from '../src/opstate.js';
import { readDbHealth, syncStatus } from '../src/db-health.js';
import { evaluate, decide } from '../src/ops-watch.js';
import { ENGINE_HEARTBEAT, HEARTBEAT_KEEP_DAYS } from '../src/core/opportunity-run.js';

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

await t('0. tipo da batida fora do prefixo OPPORTUNITY_ (não entra nas consultas LIKE de eventos de transição)', () => {
  assert.equal(ENGINE_HEARTBEAT, 'ENGINE_HEARTBEAT'); assert.equal(HEARTBEAT_KEEP_DAYS, 14);
  assert.ok(!ENGINE_HEARTBEAT.startsWith('OPPORTUNITY_'));
  // a consulta do robô usa o mesmo tipo
  assert.match(fs.readFileSync(path.join(root, 'src/db-health.js'), 'utf8'), new RegExp(`type = '${ENGINE_HEARTBEAT}'`));
  // nenhuma consulta LIKE 'OPPORTUNITY_%' precisa excluir a batida
  for (const f of ['tools/db-validate.mjs', 'test/opportunity-db-tests.js']) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    assert.ok(/LIKE 'OPPORTUNITY_%'/.test(src), `${f} ainda conta eventos de transição por prefixo`);
    assert.ok(!/OPPORTUNITY_ENGINE_RUN/.test(src), `${f}: nada do nome antigo`);
  }
});

// ------------------------------------------------------------------ estado da rodada
await t('1. engine no registro: ok, parado, sem_heartbeat e desconhecido', () => {
  const at = iso(NOW, -5);
  const ok = rec({ at, engine: 4 }); assert.equal(ok.engine.status, 'ok'); assert.equal(ok.engine.lagMin, -4); assert.equal(ok.dbSync.engineRunAt, iso(iso(at, -15), 4));
  assert.equal(rec({ at, engine: -ENGINE_STOP_MIN }).engine.status, 'ok', '30 min antes ainda é ok');
  const st = rec({ at, engine: -45 }); assert.equal(st.engine.status, 'parado'); assert.deepEqual(st.issues, ['motor_parado']); assert.equal(st.health, 'degradado');
  const none = rec({ at, engine: null }); assert.equal(none.engine.status, 'sem_heartbeat'); assert.deepEqual(none.issues, [], 'implantação: sem batida não é problema');
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
await t('2. vigia: motor_parado depois de 2 rodadas paradas; 1 só não avisa; sem_heartbeat nunca avisa', () => {
  const r1 = rec({ at: iso(NOW, -20), engine: -45 }); const r2 = rec({ at: iso(NOW, -5), engine: -60 });
  const ev = evaluate({ now: NOW, stateGeneratedAt: iso(NOW, -5), meta: metaOf(r1, r2), runs: runs() });
  assert.equal(ev.status, 'degradado'); assert.deepEqual(ev.reasons.map((r) => r.code), ['motor_parado']);
  assert.match(ev.reasons[0].text, /Motor de oportunidades parado \(última execução: .+\): as notas podem estar antigas\./);
  const d = decide(ev, null, NOW); assert.equal(d.notify.kind, 'falha'); assert.match(d.notify.text, /Motor de oportunidades parado/);
  const one = evaluate({ now: NOW, stateGeneratedAt: iso(NOW, -5), meta: metaOf(rec({ at: iso(NOW, -20) }), r2), runs: runs() });
  assert.equal(one.status, 'saudavel', '1 rodada só não avisa');
  const sem = evaluate({ now: NOW, stateGeneratedAt: iso(NOW, -5), meta: metaOf(rec({ at: iso(NOW, -20), engine: null }), rec({ at: iso(NOW, -5), engine: null })), runs: runs() });
  assert.equal(sem.status, 'saudavel', 'sem batida (implantação) não avisa');
  // registros antigos (sem engine) também não avisam
  const a = rec({ at: iso(NOW, -20) }); const b = rec({ at: iso(NOW, -5) }); delete a.engine; delete b.engine;
  assert.equal(evaluate({ now: NOW, stateGeneratedAt: iso(NOW, -5), meta: metaOf(a, b), runs: runs() }).status, 'saudavel');
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
  let f = fake([...base, [/to_regclass/, { ok: true }], [/ENGINE_HEARTBEAT/, { run_at: '2026-10-09T11:50:00Z' }]]);
  let h = await readDbHealth({ env: { DATABASE_URL: 'postgres://u:p@h/x' }, loadPg: async () => f.mod });
  assert.equal(h.status, 'ok'); assert.equal(h.engineRunAt, '2026-10-09T11:50:00.000Z');
  assert.equal(f.seen[0], 'BEGIN READ ONLY'); assert.equal(f.seen.at(-1), 'COMMIT');
  assert.ok(f.seen.every((s) => !/\b(INSERT|UPDATE|DELETE)\b/.test(s)), 'só leitura');
  f = fake([...base, [/to_regclass/, { ok: true }], [/ENGINE_HEARTBEAT/, { run_at: null }]]);
  assert.equal((await readDbHealth({ env: { DATABASE_URL: 'postgres://u:p@h/x' }, loadPg: async () => f.mod })).engineRunAt, null, 'sem batida');
  f = fake([...base, [/to_regclass/, { ok: false }]]);
  h = await readDbHealth({ env: { DATABASE_URL: 'postgres://u:p@h/x' }, loadPg: async () => f.mod });
  assert.equal(h.status, 'ok'); assert.equal(h.engineRunAt, null); assert.ok(!f.seen.some((s) => /ENGINE_HEARTBEAT/.test(s)), 'sem tabela, nem consulta');
  assert.equal((await readDbHealth({ env: {} })).engineRunAt, null);
  assert.equal(syncStatus(h, '2026-10-09T11:45:00Z').engineRunAt, null);
});

console.log(`✓ Motor parado (batida ENGINE_HEARTBEAT): ${n} grupos passaram`);
