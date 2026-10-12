// Fonte da interface: index.html é editado diretamente; o template antigo está defasado e o build não pode
// sobrescrever o index.html por acidente (a #284 foi reprovada por um revisor que confiou no cabeçalho antigo).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0;
async function t(name, fn) { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } }

await t('1. build-page recusa sem --sobrescrever-index e não toca no index.html', () => {
  const idx = path.join(root, 'index.html'); const before = fs.readFileSync(idx);
  const r = spawnSync(process.execPath, [path.join(root, 'tools/build-page.mjs'), '/nao/existe'], { encoding: 'utf8' });
  assert.equal(r.status, 2); assert.match(r.stderr, /defasado/);
  assert.ok(fs.readFileSync(idx).equals(before), 'index.html intacto');
});

await t('2. template e CLAUDE.md dizem que o index.html é a fonte', () => {
  assert.match(fs.readFileSync(path.join(root, 'tools/page.template.html'), 'utf8').split('\n')[0], /DEFASADO.*NÃO EDITAR.*index\.html/);
  assert.match(fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8'), /interface do site é o `index\.html`, editado diretamente/);
  assert.match(fs.readFileSync(path.join(root, 'tools/build-page.mjs'), 'utf8').split('\n')[0], /DEFASADO/);
});

console.log(`✓ Fonte da interface: ${n} grupos de testes passaram`);
