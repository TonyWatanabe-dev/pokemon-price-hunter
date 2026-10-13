// Integridade dos fallbackAliases (matching-novos T5): lê config/catalog.json (só leitura).
// Um fallbackAlias de uma coleção não pode ser alias nem fallbackAlias de outra, senão o fallback de detectCollection fica ambíguo.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalize } from '../src/match.js';

const catalog = JSON.parse(fs.readFileSync(new URL('../config/catalog.json', import.meta.url), 'utf8'));
const cols = catalog.collections;
let n = 0; const t = (name, fn) => { fn(); n++; };

// Violações: [coleção do fallback, alias, coleção que também o possui].
export function fallbackConflicts(collections) {
  const out = [];
  for (const c of collections) {
    for (const f of c.fallbackAliases || []) {
      for (const o of collections) {
        if (o === c) continue;
        if ([...(o.aliases || []), ...(o.fallbackAliases || [])].some((a) => normalize(a) === normalize(f))) out.push([c.id, f, o.id]);
      }
    }
  }
  return out;
}

t('nenhum fallbackAlias do catálogo atual aparece em outra coleção', () => {
  assert.deepEqual(fallbackConflicts(cols), []);
});

t('o detector acusa fallbackAlias repetido em outra coleção', () => {
  const fake = [
    { id: 'a', aliases: ['a1'], fallbackAliases: ['serie x'] },
    { id: 'b', aliases: ['Série X'] },
    { id: 'c', aliases: ['c1'], fallbackAliases: ['serie x'] },
  ];
  assert.deepEqual(fallbackConflicts(fake), [['a', 'serie x', 'b'], ['a', 'serie x', 'c'], ['c', 'serie x', 'a'], ['c', 'serie x', 'b']]);
});

console.log(`✓ Integridade dos fallbackAliases (catalog.json): ${n} grupos de testes passaram`);
