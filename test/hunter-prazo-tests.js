// Prazo dentro da loja (18/10): rodadas canceladas pelo timeout do job (18 min) porque uma loja JSON-LD com centenas de
// páginas seguia lendo depois do prazo. Passado store.deadline, o adaptador para e marca o resto como não lido.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { search } from '../src/adapters/jsonld.js';
const urls = ['https://exemplo.com.br/a', 'https://exemplo.com.br/b', 'https://exemplo.com.br/c'];
const r = await search({ url: 'https://exemplo.com.br', plannedUrls: urls, deadline: Date.now() - 1 });
assert.equal(r.length, 0); assert.deepEqual(r.failed, urls, 'nada lido depois do prazo; tudo fica para a próxima rodada');
assert.equal(r.failReasons[urls[0]], 'prazo da rodada');
assert.match(fs.readFileSync(new URL('../src/run.js', import.meta.url), 'utf8'), /deadline: deadline \+ positiveEnv\('HUNTER_STORE_GRACE_MIN', 3\) \* 60e3/);
console.log('✓ Robô: loja JSON-LD respeita o prazo da rodada');
// 18/10 (dono): leitura antiga não tira a cor nem esmaece fotos e preços.
assert.doesNotMatch(fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8'), /\[data-old\][^{]*\{[^}]*(grayscale|opacity)/, 'sem cinza em leitura antiga');
