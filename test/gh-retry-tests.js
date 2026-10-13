// Retentativa limitada do gh: só leituras (`gh api` GET); escrita não é repetida.
import assert from 'node:assert/strict';
import { comRetry, ehLeitura } from '../tools/gh-retry.mjs';

let n = 0;
const test = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const falso = (falhas) => { const f = { chamadas: 0, run: async () => { if (++f.chamadas <= falhas) throw new Error('502'); return 'ok'; } }; return f; };
const esperas = [];
const opts = { sleep: async (ms) => { esperas.push(ms); }, baseMs: 10 };

await test('ehLeitura distingue GET de escrita', () => {
  assert.equal(ehLeitura(['api', 'repos/a/b/issues']), true);
  assert.equal(ehLeitura(['api', '-X', 'GET', 'x']), true);
  assert.equal(ehLeitura(['api', '-X', 'PATCH', 'x', '-f', 'body=1']), false);
  assert.equal(ehLeitura(['api', 'x', '-f', 'body=1']), false);
  assert.equal(ehLeitura(['api', 'x', '--input', '-']), false);
  assert.equal(ehLeitura(['api', 'x'], 'corpo'), false);
  assert.equal(ehLeitura(['issue', 'comment', '1']), false);
});

await test('2 falhas e a 3ª tentativa devolve, com backoff', async () => {
  esperas.length = 0;
  const f = falso(2);
  assert.equal(await comRetry(f.run, ['api', 'x'], undefined, opts), 'ok');
  assert.equal(f.chamadas, 3); assert.deepEqual(esperas, [10, 20]);
});

await test('4 falhas propagam o erro (limite de 3 tentativas)', async () => {
  const f = falso(4);
  await assert.rejects(comRetry(f.run, ['api', 'x'], undefined, opts), /502/);
  assert.equal(f.chamadas, 3);
});

await test('escrita não é repetida', async () => {
  const f = falso(1);
  await assert.rejects(comRetry(f.run, ['api', '-X', 'PATCH', 'x', '-f', 'body=1'], undefined, opts), /502/);
  assert.equal(f.chamadas, 1);
});

console.log(`gh-retry-tests ok (${n})`);
