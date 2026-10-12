// Executor da suíte (test/run-all.mjs): todo *-tests.js roda exatamente uma vez — direto ou importado por outro —
// sem precisar editar o package.json (fim do conflito de linha única entre PRs paralelas).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { descobrir, ORDEM_HISTORICA } from './run-all.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
let n = 0;
async function t(name, fn) { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } }

await t('1. package.json só chama o executor', () => {
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, '..', 'package.json'), 'utf8')).scripts.test, 'node test/run-all.mjs');
});

await t('2. cobertura total: cada *-tests.js roda direto ou via import, sem duplicata', () => {
  const lista = descobrir();
  assert.equal(new Set(lista).size, lista.length, 'sem duplicata');
  const todos = fs.readdirSync(dir).filter((f) => /-tests\.m?js$/.test(f));
  const importados = new Set(todos.flatMap((f) => [...fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/import\(?\s*['"]\.\/([\w.-]+-tests\.m?js)['"]/g)].map((m) => m[1]).filter((x) => x !== f)));
  for (const f of todos) assert.ok(lista.includes(f) !== importados.has(f), `${f}: roda ${lista.includes(f) ? 'direto' : ''}${importados.has(f) ? ' e importado' : ''}`);
  assert.ok(lista.includes('run-all-discovery-tests.js'));
});

await t('3. ordem: histórica primeiro, novos em ordem alfabética; importado sai da raiz', () => {
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'suite-'));
  const w = (f, s = '') => fs.writeFileSync(path.join(tmp, f), s);
  w('zeta-tests.js'); w('alfa-tests.js', "await import('./filho-tests.js');"); w('filho-tests.js'); w('helper.js'); w(ORDEM_HISTORICA[1]); w(ORDEM_HISTORICA[0]);
  assert.deepEqual(descobrir(tmp), [ORDEM_HISTORICA[0], ORDEM_HISTORICA[1], 'alfa-tests.js', 'zeta-tests.js']);
  assert.ok(Object.isFrozen(ORDEM_HISTORICA));
});

console.log(`✓ Executor da suíte: ${n} grupos de testes passaram`);
