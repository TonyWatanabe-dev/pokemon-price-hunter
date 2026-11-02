// O próprio site nunca vira loja: a descoberta aceitou tcgpricehunter.com.br em 01/11/2026 e as nossas páginas de produto
// (JSON-LD com o preço de outra loja) viraram "melhor oferta" em 53 produtos, com link para nós mesmos.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { IGNORE, PROPRIO } from '../src/discovery/hosts.js';

for (const h of ['tcgpricehunter.com.br', 'www.tcgpricehunter.com.br']) {
  assert.ok(IGNORE.test(h.replace(/^www\./, '')), `descoberta ignora ${h}`);
  assert.ok(PROPRIO.test(h), `PROPRIO reconhece ${h}`);
}
assert.ok(!PROPRIO.test('tcgpricehunter.com.br.evil.test') && !PROPRIO.test('outraloja.com.br'));
const run = fs.readFileSync(new URL('../src/run.js', import.meta.url), 'utf8');
assert.match(run, /import \{ PROPRIO \} from '\.\/discovery\/hosts\.js';/);
assert.match(run, /if \(known\.has\(host\) \|\| PROPRIO\.test\(host\)\) continue;/, 'lista de lojas (txt e descoberta) pula o próprio site');
assert.match(run, /\.filter\(\(s\) => \{ try \{ return !PROPRIO\.test\(new URL\(s\.url\)\.host\); \}/, 'stores.json também');
assert.match(run, /tcgpricehunter\/\.test\(String\(l\.storeId\)\)\) delete lowest\[pid\]/, 'menor já visto do próprio site sai');
// Loja fora da lista não carrega oferta antiga (src/run.js: `!stores.some((s) => s.id === o.storeId)` → continue).
assert.match(run, /!stores\.some\(\(s\) => s\.id === o\.storeId\)\) continue;/);
console.log('✓ loja-propria: o próprio site nunca entra como loja nem como menor preço');
