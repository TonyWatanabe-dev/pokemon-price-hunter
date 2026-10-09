// Hunter Orchestrator (puro, sem banco): idempotência, falhas, retry/backoff, timeout, lease, IA opcional.
import assert from 'node:assert/strict';
import { createOrchestrator, PermanentError, backoffMs, PROTECTED_NAMESPACES } from '../src/agents/orchestrator.js';
import { memoryStore } from '../src/agents/stores.js';
import { reviewProposeHandler, memoryReviewSink, validateReviewProposal } from '../src/agents/handlers/review-propose.js';

let n = 0;
const T0 = Date.parse('2026-10-10T12:00:00Z');
const clock = () => { let t = T0; return { now: () => new Date(t), advance: (ms) => { t += ms; } }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const proposal = (k = 'm:1') => ({ category: 'matching', entityType: 'offer', entityId: 'o1', confidence: 62, dedupeKey: k, proposal: { productId: 'me05-etb', reason: 'título ambíguo' } });
function setup({ handlers, ...o } = {}) {
  const store = memoryStore(); const sink = memoryReviewSink(); const c = clock();
  const orch = createOrchestrator({ store, now: c.now, workerId: 'w1', handlers: handlers ?? [reviewProposeHandler({ sink })], aiEnabled: false, ...o });
  return { store, sink, c, orch };
}
const test = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };

await test('enfileirar é idempotente e não aceita a mesma chave para outro tipo', async () => {
  const { orch, store } = setup();
  const a = await orch.enqueue({ type: 'review.propose', idempotencyKey: 'k1', payload: proposal() });
  const b = await orch.enqueue({ type: 'review.propose', idempotencyKey: 'k1', payload: proposal('outro') });
  assert.equal(a.created, true); assert.equal(b.created, false); assert.equal(a.job.id, b.job.id);
  assert.equal(store.jobs.length, 1); assert.equal(store.jobs[0].payload.dedupeKey, 'm:1');
  await assert.rejects(orch.enqueue({ type: 'catalog.match', idempotencyKey: 'k1' }), /já pertence/);
  await assert.rejects(orch.enqueue({ type: 'review.propose' }), /idempotencyKey/);
});

await test('sucesso: job concluído, item de revisão aberto, rodar de novo não reprocessa', async () => {
  const { orch, store, sink } = setup();
  await orch.enqueue({ type: 'review.propose', idempotencyKey: 'k1', payload: proposal() });
  assert.deepEqual(await orch.runOnce(), { claimed: 1, completed: 1, retried: 0, failed: 0, blocked: 0, lost: 0 });
  const j = store.jobs[0];
  assert.equal(j.status, 'completed'); assert.equal(j.attempts, 1); assert.equal(j.locked_by, null);
  assert.deepEqual(j.result, { reviewItemId: '1', created: true });
  assert.equal(sink.items.length, 1); assert.equal(sink.items[0].status, 'open');
  assert.deepEqual(sink.items[0].proposal._source, { jobId: '1', jobType: 'review.propose' });
  assert.equal((await orch.runOnce()).claimed, 0);
  // outro job com a mesma dedupeKey não cria segundo item
  await orch.enqueue({ type: 'review.propose', idempotencyKey: 'k2', payload: proposal() });
  await orch.runOnce();
  assert.equal(sink.items.length, 1); assert.deepEqual(store.jobs[1].result, { reviewItemId: '1', created: false });
});

await test('falha transitória: retry com backoff, só volta depois do prazo, depois conclui', async () => {
  let calls = 0;
  const h = { type: 'catalog.flaky', run: async () => { if (++calls < 3) throw new Error('loja fora do ar'); return { ok: calls }; } };
  const { orch, store, c } = setup({ handlers: [h] });
  await orch.enqueue({ type: 'catalog.flaky', idempotencyKey: 'f1' });
  assert.equal((await orch.runOnce()).retried, 1);
  const j = store.jobs[0];
  assert.equal(j.status, 'retry'); assert.equal(j.attempts, 1); assert.match(j.error, /fora do ar/);
  assert.equal(j.run_after.getTime(), T0 + backoffMs(1));
  assert.equal((await orch.runOnce()).claimed, 0, 'não roda antes do backoff');
  c.advance(backoffMs(1)); assert.equal((await orch.runOnce()).retried, 1);
  assert.equal(j.run_after.getTime(), T0 + backoffMs(1) + backoffMs(2), 'backoff dobra');
  c.advance(backoffMs(2)); assert.equal((await orch.runOnce()).completed, 1);
  assert.equal(j.status, 'completed'); assert.equal(j.attempts, 3); assert.deepEqual(j.result, { ok: 3 });
  assert.equal(backoffMs(30), 3_600_000, 'backoff tem teto');
});

await test('tentativas esgotadas: failed definitivo com evento', async () => {
  const h = { type: 'catalog.broken', run: async () => { throw new Error('sempre falha'); } };
  const { orch, store, c } = setup({ handlers: [h] });
  await orch.enqueue({ type: 'catalog.broken', idempotencyKey: 'b1', maxAttempts: 2 });
  await orch.runOnce(); c.advance(backoffMs(1));
  assert.equal((await orch.runOnce()).failed, 1);
  const j = store.jobs[0];
  assert.equal(j.status, 'failed'); assert.equal(j.attempts, 2); assert.ok(j.finished_at);
  assert.equal(store.events.length, 1); assert.equal(store.events[0].type, 'AGENT_JOB_FAILED');
  c.advance(10 * 3_600_000); assert.equal((await orch.runOnce()).claimed, 0);
});

await test('erro permanente e payload inválido não fazem retry', async () => {
  const h = { type: 'catalog.perm', run: async () => { throw new PermanentError('dado impossível'); } };
  const { orch, store, sink } = setup({ handlers: [h, reviewProposeHandler({ sink: memoryReviewSink() })] });
  await orch.enqueue({ type: 'catalog.perm', idempotencyKey: 'p1' });
  await orch.enqueue({ type: 'review.propose', idempotencyKey: 'p2', payload: { ...proposal(), category: 'preco_novo' } });
  assert.equal((await orch.runOnce()).failed, 2);
  assert.deepEqual(store.jobs.map((j) => [j.status, j.attempts]), [['failed', 1], ['failed', 1]]);
  assert.match(store.jobs[1].error, /categoria desconhecida/);
  assert.equal(sink.items.length, 0);
});

await test('handler que lança de forma síncrona é tratado como falha', async () => {
  const h = { type: 'catalog.sync', run: () => { throw new Error('síncrono'); } };
  const { orch, store } = setup({ handlers: [h] });
  await orch.enqueue({ type: 'catalog.sync', idempotencyKey: 's1' });
  assert.equal((await orch.runOnce()).retried, 1); assert.match(store.jobs[0].error, /síncrono/);
});

await test('timeout: handler travado é abortado e vai para retry sem travar a rodada', async () => {
  let aborted = false;
  const h = { type: 'catalog.hang', timeoutMs: 25, run: (_p, { signal }) => new Promise(() => { signal.addEventListener('abort', () => { aborted = true; }); }) };
  const { orch, store } = setup({ handlers: [h] });
  await orch.enqueue({ type: 'catalog.hang', idempotencyKey: 't1' });
  const t = Date.now(); const s = await orch.runOnce();
  assert.ok(Date.now() - t < 1000); assert.equal(s.retried, 1); assert.equal(aborted, true);
  assert.equal(store.jobs[0].status, 'retry'); assert.match(store.jobs[0].error, /timeout/);
});

await test('timeout com gravação tardia + retry: um único item de revisão', async () => {
  const sink = memoryReviewSink();
  const slow = { items: sink.items, propose: async (i) => { await sleep(60); return sink.propose(i); } }; // grava depois do timeout
  const { orch, store, c } = setup({ handlers: [reviewProposeHandler({ sink: slow, timeoutMs: 20 })] });
  await orch.enqueue({ type: 'review.propose', idempotencyKey: 'late', payload: proposal('dup') });
  assert.equal((await orch.runOnce()).retried, 1);
  await sleep(80); assert.equal(sink.items.length, 1, 'escrita tardia aconteceu');
  c.advance(backoffMs(1));
  const fast = createOrchestrator({ store, now: c.now, workerId: 'w2', handlers: [reviewProposeHandler({ sink })] });
  assert.equal((await fast.runOnce()).completed, 1);
  assert.equal(sink.items.length, 1); assert.deepEqual(store.jobs[0].result, { reviewItemId: '1', created: false });
});

await test('lease: worker morto é substituído e a escrita tardia dele é ignorada', async () => {
  let release;
  const h = { type: 'catalog.slow', timeoutMs: 5_000, run: () => new Promise((r) => { release = r; }) };
  const store = memoryStore(); const c = clock();
  const a = createOrchestrator({ store, now: c.now, workerId: 'A', handlers: [h], leaseMs: 60_000 });
  const b = createOrchestrator({ store, now: c.now, workerId: 'B', handlers: [{ type: 'catalog.slow', run: async () => ({ by: 'B' }) }], leaseMs: 60_000 });
  await a.enqueue({ type: 'catalog.slow', idempotencyKey: 'l1' });
  const pa = a.runOnce(); await sleep(5);
  assert.equal((await b.runOnce()).claimed, 0, 'lease ativa protege o job');
  c.advance(60_001);
  assert.equal((await b.runOnce()).completed, 1);
  release({ by: 'A' }); const sa = await pa;
  assert.equal(sa.lost, 1); assert.equal(sa.completed, 0);
  assert.deepEqual(store.jobs[0].result, { by: 'B' }); assert.equal(store.jobs[0].attempts, 2);
});

await test('lease expirada com tentativas esgotadas: failed sem executar de novo', async () => {
  let runs = 0;
  const store = memoryStore(); const c = clock();
  const h = { type: 'catalog.x', run: async () => { runs++; return {}; } };
  const orch = createOrchestrator({ store, now: c.now, workerId: 'w', handlers: [h], leaseMs: 1_000 });
  await orch.enqueue({ type: 'catalog.x', idempotencyKey: 'x', maxAttempts: 1 });
  await store.claim({ now: c.now(), workerId: 'morto', limit: 1, leaseMs: 1_000 }); // pegou e morreu
  c.advance(1_001);
  assert.equal((await orch.runOnce()).failed, 1); assert.equal(runs, 0);
  assert.equal(store.jobs[0].status, 'failed'); assert.equal(store.events[0].type, 'AGENT_JOB_FAILED');
});

await test('sem handler ou IA desligada: blocked, sem consumir tentativa', async () => {
  const ai = { type: 'catalog.ai_match', ai: true, run: async () => ({ ai: true }) };
  const { orch, store } = setup({ handlers: [ai] });
  await orch.enqueue({ type: 'alert.compose', idempotencyKey: 'u1' });
  await orch.enqueue({ type: 'catalog.ai_match', idempotencyKey: 'a1' });
  assert.equal((await orch.runOnce()).blocked, 2);
  assert.deepEqual(store.jobs.map((j) => [j.status, j.attempts, j.error]), [['blocked', 0, 'sem handler registrado'], ['blocked', 0, 'ai_disabled']]);
  assert.deepEqual(store.events.map((e) => e.type), ['AGENT_JOB_BLOCKED', 'AGENT_JOB_BLOCKED']);
  // com IA ligada o mesmo tipo roda
  const on = setup({ handlers: [ai], aiEnabled: true });
  await on.orch.enqueue({ type: 'catalog.ai_match', idempotencyKey: 'a2' });
  assert.equal((await on.orch.runOnce()).completed, 1);
});

await test('IA não pode ser registrada em preço, score, ranking ou oportunidade', async () => {
  for (const ns of PROTECTED_NAMESPACES)
    assert.throws(() => setup({ handlers: [{ type: `${ns}.ai`, ai: true, run: async () => ({}) }] }), /determinísticos/);
  assert.doesNotThrow(() => setup({ handlers: [{ type: 'price.recompute', ai: false, run: async () => ({}) }] }));
  assert.throws(() => setup({ handlers: [{ type: 'a.b', run: async () => ({}) }, { type: 'a.b', run: async () => ({}) }] }), /duplicado/);
});

await test('resultado grande ou não serializável falha sem retry', async () => {
  const big = { type: 'catalog.big', run: async () => ({ s: 'x'.repeat(40_000) }) };
  const cyc = { type: 'catalog.cyc', run: async () => { const o = {}; o.o = o; return o; } };
  const { orch, store } = setup({ handlers: [big, cyc] });
  await orch.enqueue({ type: 'catalog.big', idempotencyKey: 'g1' });
  await orch.enqueue({ type: 'catalog.cyc', idempotencyKey: 'g2' });
  assert.equal((await orch.runOnce()).failed, 2);
  assert.match(store.jobs[0].error, /acima de/); assert.match(store.jobs[1].error, /não serializável/);
});

await test('prioridade e limite por rodada', async () => {
  const seen = [];
  const h = { type: 'catalog.p', run: async (p) => { seen.push(p.i); return {}; } };
  const { orch } = setup({ handlers: [h] });
  for (const [i, pr] of [[1, 100], [2, 10], [3, 50]]) await orch.enqueue({ type: 'catalog.p', idempotencyKey: `p${i}`, payload: { i }, priority: pr });
  assert.equal((await orch.runOnce({ limit: 2 })).claimed, 2); assert.deepEqual(seen, [2, 3]);
  await orch.runOnce(); assert.deepEqual(seen, [2, 3, 1]);
});

await test('validação do handler de revisão', async () => {
  assert.equal(validateReviewProposal(proposal()), null);
  assert.match(validateReviewProposal({ ...proposal(), confidence: 101 }), /confidence/);
  assert.match(validateReviewProposal({ ...proposal(), dedupeKey: '' }), /dedupeKey/);
  assert.match(validateReviewProposal({ ...proposal(), proposal: [] }), /proposal/);
  assert.match(validateReviewProposal({ ...proposal(), proposal: { t: 'x'.repeat(9000) } }), /bytes/);
  assert.match(validateReviewProposal(null), /objeto/);
});

console.log(`✓ Hunter Orchestrator: ${n} grupos de testes passaram (puro)`);
