// Forma de firebase/firestore.rules: sintaxe básica sem rede nem emulador.
// Chaves, colchetes e parênteses balanceados, um único `service cloud.firestore` e nenhum `match` repetido.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const raw = fs.readFileSync(new URL('../firebase/firestore.rules', import.meta.url), 'utf8');

// Remove comentários e strings (que podem conter chaves) antes de contar.
const strip = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, "''");

function balanced(src) {
  const pairs = { ')': '(', ']': '[', '}': '{' };
  const stack = [];
  for (const ch of src) {
    if ('([{'.includes(ch)) stack.push(ch);
    else if (ch in pairs && stack.pop() !== pairs[ch]) return false;
  }
  return stack.length === 0;
}

const code = strip(raw);
assert.ok(balanced(code), 'firestore.rules com chaves, colchetes ou parênteses desbalanceados');

// Sensibilidade: remover uma `}` deve ser detectado.
const i = code.lastIndexOf('}');
assert.ok(!balanced(code.slice(0, i) + code.slice(i + 1)), 'remover uma "}" deveria falhar');

assert.equal((code.match(/\bservice\s+cloud\.firestore\b/g) || []).length, 1, 'esperado exatamente um "service cloud.firestore"');

const matches = [...code.matchAll(/\bmatch\s+(\/[^\s{]*)\s*\{/g)].map((m) => m[1]);
assert.ok(matches.length > 0, 'nenhum match encontrado');
assert.equal(new Set(matches).size, matches.length, `match repetido: ${matches.join(', ')}`);

console.log('firestore-rules-shape-tests: ok');
