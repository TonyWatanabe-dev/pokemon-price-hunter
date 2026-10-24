// Baralho/Deck de Batalha (24/10/2026): "batalha" virava o nome do Pokémon e baralhos diferentes caíam num produto só
// (sv6_5/sv5/avulsos-deck-batalha, "Baralho de Batalha Batalha ex"). Títulos reais do ramo data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { matchProduct } from '../src/match.js';
const cat = JSON.parse(fs.readFileSync(new URL('../config/catalog.json', import.meta.url), 'utf8'));
const id = (t) => matchProduct({ title: t }, cat).productId;
const casos = {
  'Pokémon Baralho Batalha Ex Houndoom | Copag': 'avulsos-deck-houndoom',
  'Pokémon Baralho De Batalha ex Melmetal': 'avulsos-deck-melmetal',
  'Pokemon Baralho de Batalha Ex Ampharos Copag': 'avulsos-deck-ampharos',
  'Deck de Batalha EX Lucario 32657 - Copag': 'avulsos-deck-lucario',
  'Pokémon - Baralho de Batalha ex - Tinkaton ex': 'avulsos-deck-tinkaton',
  'Pokémon - Baralho de Batalha ex - Chien-Pao ex': 'avulsos-deck-pao',                 // mesmo id que já existia (variante de uma palavra)
  'Cartas - Pokemon Deck Batalha ex - Kangaskhan COPAG DA AMAZONIA': 'avulsos-deck-kangaskhan',
  'Pokémon EV05 Deck Batalha ex Greninja - Copag': 'sv5-deck-greninja',
  'Deck de Batalha EX Pokémon Fabulas Nebulosas EV6.5 - MIRAIDON': 'sv6_5-deck-miraidon',
  // padrão "<nome> ex" e Mega continuam iguais
  'Pokémon TCG Melmetal Ex Baralho Batalha Ex Copag': 'avulsos-deck-melmetal',
  'Deck Batalha de Liga Pokemon Mega Lucario EX Copag': 'avulsos-deck-mega-lucario',
  'Carta Pokemon - Baralho Batalha Rivais - Mega Gengar ex': 'avulsos-deck-mega-gengar',
};
for (const [t, esperado] of Object.entries(casos)) assert.equal(id(t), esperado, t);
// nunca o produto genérico "batalha"; dois baralhos ou sem nome: fica sem produto (não adivinha)
for (const t of Object.keys(casos)) assert.doesNotMatch(String(id(t)), /-deck-batalha$/);
assert.equal(id('Cartas Pokémon - Deck Batalha Ex - Melmetal E Houndoom - Copag'), null, 'dois baralhos no anúncio');
assert.equal(id('CARTAS POKEMON DECK DE BATALHA EX MELMETAL E HOUDOOM COPAG REF. 33946'), null);
assert.equal(id('Pokémon Baralho De Batalha ex'), null, 'sem nome do Pokémon');
console.log('✓ deck-batalha-variante: baralhos diferentes não se juntam; ids existentes preservados');
