// runAgentCycle sem banco: prazo (deadlineMs), lote (claimed < batch) e isolamento de erro em `candidatos`.
// O banco é um falso que responde por trecho do SQL; o relógio é injetado.
import assert from 'node:assert/strict';
import { runAgentCycle } from '../src/agents/cycle.js';

let n = 0;
const test = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };

const job = (id) => ({ id, type: 'tipo.sem-handler', priority: 100, attempts: 1, max_attempts: 3, payload: {}, run_after: new Date(0), locked_at: new Date(0), idempotency_key: `k${id}` });
// claimSizes: quantos jobs cada chamada de claim devolve (depois da lista, 0).
const fakeDb = ({ claimSizes = [], events = [] } = {}) => {
  const log = { claims: 0, cursor: 0 };
  let id = 0;
  return {
    log,
    query: async (sql) => {
      if (/WITH c AS/.test(sql)) return { rows: Array.from({ length: claimSizes[log.claims++] ?? 0 }, () => job(++id)) };
      if (/AGENT_ALERT_CURSOR' ORDER BY/.test(sql)) return { rows: [] };
      if (/FROM system_event/.test(sql)) return { rows: events };
      if (/INSERT INTO system_event .*AGENT_ALERT_CURSOR/.test(sql)) { log.cursor++; return { rows: [] }; }
      return { rows: [] }; // fail/event/complete dos jobs sem handler
    },
  };
};
const run = (db, o = {}) => runAgentCycle({ db, state: {}, send: async () => ({ delivered: true }), workerId: 'w', ...o });

await test('prazo: relógio além de deadlineMs interrompe o laço antes de reivindicar', async () => {
  const db = fakeDb({ claimSizes: [5, 5, 5] });
  const ticks = [0, 60_000]; // início, depois já passou do prazo
  const r = await run(db, { clock: () => ticks.shift() ?? 60_000, opts: { batch: 5, deadlineMs: 45_000 } });
  assert.equal(r.runs.length, 0); assert.equal(db.log.claims, 0); assert.equal(r.ok, true);
});

await test('prazo: lote cheio continua até o relógio passar de deadlineMs', async () => {
  const db = fakeDb({ claimSizes: [2, 2, 2, 2, 2] });
  let t = 0; // início=0; cada checagem do laço avança 20s: 20s e 40s entram, 60s sai
  const r = await run(db, { clock: () => { const v = t; t += 20_000; return v; }, opts: { batch: 2, deadlineMs: 45_000 } });
  assert.equal(r.runs.length, 2); assert.equal(db.log.claims, 2);
  assert.ok(r.runs.every((s) => s.claimed === 2));
});

await test('lote: claimed < batch encerra o laço mesmo dentro do prazo', async () => {
  const db = fakeDb({ claimSizes: [2, 1, 2] });
  const r = await run(db, { clock: () => 0, opts: { batch: 2, deadlineMs: 45_000 } });
  assert.equal(r.runs.length, 2); assert.equal(db.log.claims, 2);
  assert.deepEqual(r.runs.map((s) => s.claimed), [2, 1]);
});

await test('erro em candidatos não impede o notify', async () => {
  const db = fakeDb({ events: [{ id: 7, type: 'AGENT_JOB_FAILED', payload: { jobType: 'x', error: 'boom' } }] });
  const state = { get unmatched() { throw new Error('estado corrompido'); } };
  const sent = [];
  const r = await run(db, { state, clock: () => 0, send: async (m) => { sent.push(m); return { delivered: true }; } });
  assert.equal(r.ok, false); assert.ok(r.errors.some((e) => /^candidatos: estado corrompido/.test(e)));
  assert.equal(sent.length, 1); assert.equal(r.notify.events, 1); assert.equal(r.notify.delivered, true); assert.equal(db.log.cursor, 1);
});

console.log(`agents-cycle-tests ok (${n})`);
