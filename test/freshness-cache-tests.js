// Cache de 60 s do horário do banco (dbDataAt): duas chamadas em < 60 s fazem 1 consulta; depois de 60 s, 2.
// Sem banco real: o Pool é criado sem conectar e o query é trocado por um contador.
import assert from 'node:assert/strict';
import { dbDataAt, setFreshnessClock, clearFreshnessCache } from '../api/_lib/freshness.mjs';
import { apiPool, closeApiPool } from '../api/_lib/db.mjs';

let n = 0;
async function t(name, fn) { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } }

const env0 = process.env.API_DATABASE_URL;
process.env.API_DATABASE_URL = 'postgres://x:y@127.0.0.1:1/nada';
await closeApiPool();
const pool = await apiPool();
let calls = 0; let at = '2026-10-09T17:50:00.000Z';
pool.query = async () => { calls++; return { rows: [{ at }] }; };

let now = Date.parse('2026-10-09T18:00:00.000Z');
setFreshnessClock(() => now);
const reset = () => { calls = 0; clearFreshnessCache(); };

try {
  await t('1. duas chamadas em menos de 60 s fazem 1 consulta', async () => {
    reset();
    assert.equal(await dbDataAt(), at);
    now += 59_000;
    assert.equal(await dbDataAt(), at);
    assert.equal(calls, 1);
  });

  await t('2. depois de 60 s a consulta é refeita', async () => {
    reset(); now += 1;
    await dbDataAt();
    now += 60_000;
    await dbDataAt();
    assert.equal(calls, 2);
  });

  await t('3. clearFreshnessCache zera o cache', async () => {
    reset();
    await dbDataAt(); await dbDataAt();
    assert.equal(calls, 1);
    clearFreshnessCache();
    await dbDataAt();
    assert.equal(calls, 2);
  });

  await t('4. setFreshnessClock também zera o cache', async () => {
    reset();
    await dbDataAt();
    setFreshnessClock(() => now);
    await dbDataAt();
    assert.equal(calls, 2);
  });
} finally {
  await closeApiPool();
  if (env0 === undefined) delete process.env.API_DATABASE_URL; else process.env.API_DATABASE_URL = env0;
}
console.log(`freshness-cache-tests: ${n} ok`);
