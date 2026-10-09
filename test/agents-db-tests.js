// Hunter Orchestrator no PostgreSQL real: só roda com TEST_DATABASE_URL (banco descartável).
import assert from 'node:assert/strict';
if (!process.env.TEST_DATABASE_URL) { console.log('— testes de banco do Orchestrator pulados (sem TEST_DATABASE_URL)'); process.exit(0); }
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const { pool, close } = await import('../src/db/pg.js');
const { createOrchestrator, backoffMs } = await import('../src/agents/orchestrator.js');
const { pgStore } = await import('../src/agents/stores.js');
const { reviewProposeHandler, pgReviewSink } = await import('../src/agents/handlers/review-propose.js');
const { execFileSync } = await import('node:child_process');
const p = await pool();
const q = async (sql, a = []) => (await p.query(sql, a)).rows;
await p.query('DROP SCHEMA IF EXISTS hunter CASCADE');
execFileSync('node', ['tools/db-migrate.mjs'], { env: process.env, stdio: 'pipe' });

let n = 0;
let t = Date.parse('2026-10-10T12:00:00Z');
const now = () => new Date(t);
const store = pgStore(p);
const sink = pgReviewSink(p);
const orch = (workerId, handlers = [reviewProposeHandler({ sink })], o = {}) => createOrchestrator({ store, now, workerId, handlers, aiEnabled: false, ...o });
const proposal = (k) => ({ category: 'matching', entityType: 'offer', entityId: 'o1', confidence: 70, dedupeKey: k, proposal: { productId: 'me05-etb' } });
const PROTECTED = ['product', 'offer', 'price_history', 'price_daily', 'reference_price', 'product_stats', 'opportunity'];
const counts = async () => Object.fromEntries(await Promise.all(PROTECTED.map(async (tb) => {
  const ex = (await q('SELECT to_regclass($1) AS r', [`hunter.${tb}`]))[0].r;
  return [tb, ex ? Number((await q(`SELECT count(*)::int AS c FROM ${tb}`))[0].c) : null];
})));
const before = await counts();

// 1. idempotência do enfileiramento
const a = orch('w1');
const e1 = await a.enqueue({ type: 'review.propose', idempotencyKey: 'db:k1', payload: proposal('dk1') });
const e2 = await a.enqueue({ type: 'review.propose', idempotencyKey: 'db:k1', payload: proposal('outro') });
assert.equal(e1.created, true); assert.equal(e2.created, false); assert.equal(String(e1.job.id), String(e2.job.id));
assert.equal((await q(`SELECT count(*)::int c FROM automation_job WHERE idempotency_key = 'db:k1'`))[0].c, 1);
n++;

// 2. sucesso + item de revisão único por dedupe_key
await a.enqueue({ type: 'review.propose', idempotencyKey: 'db:k2', payload: proposal('dk1') });
assert.equal((await a.runOnce()).completed, 2);
const jobs = await q(`SELECT idempotency_key, status, attempts, result, locked_by FROM automation_job ORDER BY id`);
assert.deepEqual(jobs.map((j) => [j.status, j.attempts, j.locked_by]), [['completed', 1, null], ['completed', 1, null]]);
assert.equal(jobs[0].result.created, true); assert.equal(jobs[1].result.created, false); assert.equal(jobs[0].result.reviewItemId, jobs[1].result.reviewItemId);
const items = await q(`SELECT status, category, proposal FROM review_item WHERE dedupe_key = 'dk1'`);
assert.equal(items.length, 1); assert.equal(items[0].status, 'open'); assert.equal(items[0].proposal._source.jobType, 'review.propose');
assert.equal((await a.runOnce()).claimed, 0);
n++;

// 3. dois workers concorrentes nunca pegam o mesmo job (FOR UPDATE SKIP LOCKED)
for (let i = 0; i < 8; i++) await a.enqueue({ type: 'review.propose', idempotencyKey: `db:c${i}`, payload: proposal(`dc${i}`) });
const [ca, cb] = await Promise.all([store.claim({ now: now(), workerId: 'A', limit: 5, leaseMs: 60_000 }), store.claim({ now: now(), workerId: 'B', limit: 5, leaseMs: 60_000 })]);
const ids = [...ca, ...cb].map((j) => String(j.id));
assert.equal(ids.length, 8); assert.equal(new Set(ids).size, 8);
// fencing: B não conclui job de A; A conclui o seu
assert.equal(await store.complete(ca[0].id, 'B', { x: 1 }, now()), false);
assert.equal(await store.complete(ca[0].id, 'A', { x: 1 }, now()), true);
// lease expira: worker C reassume o resto e conclui; escrita tardia de A é ignorada
t += 60_001;
const c = orch('C', undefined, { leaseMs: 60_000 });
assert.equal((await c.runOnce({ limit: 10 })).completed, 7);
assert.equal(await store.complete(ca[1].id, 'A', { late: true }, now()), false);
assert.equal((await q(`SELECT count(*)::int c FROM automation_job WHERE idempotency_key LIKE 'db:c%' AND status = 'completed'`))[0].c, 8);
assert.equal((await q(`SELECT count(*)::int c FROM review_item WHERE dedupe_key LIKE 'dc%'`))[0].c, 7, 'ca[0] foi concluído à mão, sem handler');
n++;

// 4. retry com backoff, falha definitiva com evento, blocked sem consumir tentativa
let calls = 0;
const flaky = { type: 'catalog.flaky', run: async () => { calls++; throw new Error('timeout da loja'); } };
const ai = { type: 'catalog.ai_match', ai: true, run: async () => ({}) };
const f = orch('F', [flaky, ai]);
await f.enqueue({ type: 'catalog.flaky', idempotencyKey: 'db:f1', maxAttempts: 2 });
await f.enqueue({ type: 'catalog.ai_match', idempotencyKey: 'db:ai1' });
await f.enqueue({ type: 'alert.compose', idempotencyKey: 'db:u1' });
assert.deepEqual(await f.runOnce(), { claimed: 3, completed: 0, retried: 1, failed: 0, blocked: 2, lost: 0 });
let [fj] = await q(`SELECT status, attempts, run_after, error, finished_at FROM automation_job WHERE idempotency_key = 'db:f1'`);
assert.equal(fj.status, 'retry'); assert.equal(fj.attempts, 1); assert.equal(fj.finished_at, null);
assert.equal(new Date(fj.run_after).getTime(), t + backoffMs(1));
assert.equal((await f.runOnce()).claimed, 0);
t += backoffMs(1);
assert.equal((await f.runOnce()).failed, 1);
[fj] = await q(`SELECT status, attempts, finished_at FROM automation_job WHERE idempotency_key = 'db:f1'`);
assert.equal(fj.status, 'failed'); assert.equal(fj.attempts, 2); assert.ok(fj.finished_at); assert.equal(calls, 2);
const blocked = await q(`SELECT idempotency_key, status, attempts, error FROM automation_job WHERE status = 'blocked' ORDER BY id`);
assert.deepEqual(blocked.map((b) => [b.idempotency_key, b.attempts, b.error]), [['db:ai1', 0, 'ai_disabled'], ['db:u1', 0, 'sem handler registrado']]);
const ev = await q(`SELECT type, count(*)::int c FROM system_event WHERE entity_type = 'automation_job' GROUP BY type ORDER BY type`);
assert.deepEqual(ev.map((e) => [e.type, e.c]), [['AGENT_JOB_BLOCKED', 2], ['AGENT_JOB_FAILED', 1]]);
n++;

// 5. o Orchestrator não escreveu em nenhuma tabela de preço, oferta, referência ou oportunidade
assert.deepEqual(await counts(), before);
n++;

await p.query('DROP SCHEMA IF EXISTS hunter CASCADE');
await close();
console.log(`✓ Hunter Orchestrator: ${n} grupos de testes passaram (banco)`);
