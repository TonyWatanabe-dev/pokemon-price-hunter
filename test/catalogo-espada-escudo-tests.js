// Coleções Espada e Escudo (PT-BR) no catálogo: anúncios dessas coleções passam a casar.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { matchProduct } from '../src/match.js';

const catalog = JSON.parse(readFileSync(new URL('../config/catalog.json', import.meta.url)));
const casos = [
  ['Pokémon Booster Box Céus em Evolução 36 boosters Copag', 'swsh7'],
  ['Booster Box Golpe Fusão Pokémon TCG 36 Boosters', 'swsh8'],
  ['Pokémon TCG Box Display Tempestade Prateada 36 boosters', 'swsh12'],
  ['Pokémon Elite Trainer Box Realeza Absoluta', 'swsh12_5'],
];
for (const [titulo, col] of casos) {
  const m = matchProduct({ title: titulo, price: 300 }, catalog);
  assert.ok(m.productId && m.productId.startsWith(col + '-'), `${titulo} → ${m.productId} (${(m.why || []).join(';')})`);
}
const ids = catalog.collections.map((c) => c.id);
assert.ok(ids.indexOf('swsh12_5') < ids.indexOf('sv1'), 'coleções antigas antes das novas (ordem do catálogo = mais antiga primeiro)');
console.log('catalogo-espada-escudo-tests ok');
