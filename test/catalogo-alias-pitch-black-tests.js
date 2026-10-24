// "Pitch Black" é o nome em inglês de Escuridão Absoluta (me05, 5ª expansão de Megaevolução; WikiDex "Oscuridad
// Absoluta": English name Pitch Black). Bynx (sonda 40113952087) e o ramo data de 24/10 tinham ETB em inglês sem casar.
// O apelido não pode confundir com outra coleção, nem tirar o produto em português do lugar.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { matchProduct } from '../src/match.js';
const cat = JSON.parse(fs.readFileSync(new URL('../config/catalog.json', import.meta.url), 'utf8'));
const id = (t) => matchProduct({ title: t }, cat).productId;

// uma só coleção com o apelido, e é a me05
const comApelido = cat.collections.filter((c) => Object.values(c.langAliases || {}).flat().includes('pitch black'));
assert.deepEqual(comApelido.map((c) => c.id), ['me05']);
assert.equal(cat.collections.filter((c) => c.id === 'me05').length, 1, 'sem coleção duplicada');

const casos = {
  'Elite Trainer Box - Pitch Black': 'me05-etb-en',                                   // Bynx
  'POKEMON TCG EM INGLES - PITCH BLACK ELITE TRAINER BOX - THE POKÉMON': 'me05-etb-en', // ramo data, 24/10
  'Pokémon TCG Pitch Black Elite Trainer Box': 'me05-etb-en',
  // português continua no produto em português; outras coleções não mudam
  'Treinador Avançado Escuridão Absoluta Copag': 'me05-etb',
  'Pokémon TCG Perfect Order Elite Trainer Box': 'me03-etb-en',
};
for (const [t, esperado] of Object.entries(casos)) assert.equal(id(t), esperado, t);
// título que diz português com o nome em inglês é contraditório; acessório com o nome não vira produto
assert.equal(id('Pokémon Pitch Black ETB em português'), null);
assert.equal(id('Sleeve Pitch Black 100 unidades'), null);
assert.equal(id('Deck Box Pitch Black Pokémon'), null);
console.log('catalogo-alias-pitch-black-tests: ok');
