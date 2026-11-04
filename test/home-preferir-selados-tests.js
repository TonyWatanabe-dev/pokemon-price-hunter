// Home (04/11/2026, pedido do dono): blister, ETB e demais selados antes de baralho de batalha no pódio e na sequência,
// sem recalcular nota; e o card mostra o nome do produto sem a coleção (dois baralhos não saem com o mesmo nome).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const trecho = (a, b) => { const i = html.indexOf(a); const j = html.indexOf(b, i); assert.ok(i > 0 && j > i, a); return html.slice(i, j); };
const ctx = { String }; vm.createContext(ctx);
vm.runInContext(trecho('const preferirSelados=', 'function loadHomeOpp(){') + trecho('const oppName=', '/* Oportunidades (6B.1)') + '\n;globalThis.__t={preferirSelados,oppName};', ctx);
const { preferirSelados, oppName } = ctx.__t;

const it = (id, type, name) => ({ product: { id, type, name, type_label: 'Tipo' }, opportunity_score: 80 });
const ordem = Array.from(preferirSelados([it('d1', 'deck', 'Box Pokémon - Baralho de Batalha Houndoom ex'), it('b1', 'blister_4'), it('d2', 'deck'), it('e1', 'etb')]), (x) => x.product.id);
assert.deepEqual(ordem, ['b1', 'e1', 'd1', 'd2'], 'baralho depois dos demais, ordem do motor dentro de cada grupo');
assert.equal(preferirSelados([]).length, 0);

assert.equal(oppName({ name: 'Box Pokémon - Baralho de Batalha Houndoom ex', type_label: 'Baralho de Batalha' }), 'Baralho de Batalha Houndoom ex');
assert.equal(oppName({ name: 'Equilíbrio Perfeito - Blister Quádruplo', type_label: 'Blister Quádruplo' }), 'Blister Quádruplo');
assert.equal(oppName({ name: 'Sem separador', type_label: 'Blister' }), 'Blister');
assert.equal(oppName({}), '');

assert.match(html, /top:preferirSelados\(a\.data\)/, 'pódio e sequência usam a lista com selados primeiro');
assert.equal((html.match(/esc\(oppName\(pr\)\)/g) || []).length, 2, 'destaques e oppCard usam o nome completo');
assert.match(html, /const name=oppName\(pr\);/, 'pódio usa o nome completo');
console.log('✓ home: selados antes de baralho e nome completo no card');
