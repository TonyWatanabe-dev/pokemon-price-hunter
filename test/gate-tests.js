// Trava de publicação (gate.js): bordas em que o link não traz nome para comparar.
// Nesses casos a trava não bloqueia, e não pode lançar erro nem consultar o catálogo.
import assert from 'node:assert/strict';
import { linkAgrees } from '../src/gate.js';

let n = 0;
const test = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const semMatch = { parsed: {} };

await test('link sem nome (só id) não bloqueia', async () => {
  assert.deepEqual(linkAgrees({ url: 'https://loja.test/p/12345' }, semMatch, null), { ok: true });
  assert.deepEqual(linkAgrees({ url: 'https://loja.test/' }, semMatch, null), { ok: true });
});

await test('link com menos de 3 palavras não bloqueia', async () => {
  assert.deepEqual(linkAgrees({ url: 'https://loja.test/produto-pokemon' }, semMatch, null), { ok: true });
});

await test('URL inválida ou ausente não lança erro e não bloqueia', async () => {
  assert.deepEqual(linkAgrees({ url: 'isto não é url' }, semMatch, null), { ok: true });
  assert.deepEqual(linkAgrees({}, semMatch, null), { ok: true });
});

console.log(`gate-tests: ${n} ok`);
