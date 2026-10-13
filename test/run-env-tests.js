// HUNTER_CONCURRENCY / HUNTER_BUDGET_MIN: valor inválido usa o padrão; pool com n inválido processa tudo.
import assert from 'node:assert/strict';
import { positiveEnv, pool } from '../src/run.js';

for (const bad of ['0', '-1', 'abc', '', 'NaN', 'Infinity']) {
  process.env.HUNTER_CONCURRENCY = bad; process.env.HUNTER_BUDGET_MIN = bad;
  assert.equal(positiveEnv('HUNTER_CONCURRENCY', 16), 16, `concorrência ${bad}`);
  assert.equal(positiveEnv('HUNTER_BUDGET_MIN', 7), 7, `orçamento ${bad}`);
}
delete process.env.HUNTER_CONCURRENCY;
assert.equal(positiveEnv('HUNTER_CONCURRENCY', 16), 16);
process.env.HUNTER_CONCURRENCY = '4'; process.env.HUNTER_BUDGET_MIN = '0.5';
assert.equal(positiveEnv('HUNTER_CONCURRENCY', 16), 4);
assert.equal(positiveEnv('HUNTER_BUDGET_MIN', 7), 0.5);
delete process.env.HUNTER_CONCURRENCY; delete process.env.HUNTER_BUDGET_MIN;

for (const n of [0, -1, NaN, undefined, 'abc', 2.5, 3]) {
  const seen = [];
  await pool([1, 2, 3, 4, 5], n, async (x) => { await Promise.resolve(); seen.push(x); });
  assert.deepEqual(seen.sort(), [1, 2, 3, 4, 5], `pool n=${String(n)}`);
}
console.log('run-env-tests ok');
