// "Batalha de Liga" (24/10/2026, triagem das lojas lidas sem produto): baralho de 60 cartas (League Battle Deck).
// Títulos sem "baralho"/"deck" caíam em "coleção não identificada" ou em "Box Pokémon ex" (colecao_ex), produto diferente.
// Títulos reais do ramo data e da Mais Coimbra (sonda 40113956394).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { matchProduct } from '../src/match.js';
const cat = JSON.parse(fs.readFileSync(new URL('../config/catalog.json', import.meta.url), 'utf8'));
const id = (t) => matchProduct({ title: t }, cat).productId;
const casos = {
  'Jogo de Cartas Copag Pokémon Batalha de Liga Mewtwo ex com 60 Cartas': 'avulsos-deck-mewtwo',
  'Pokémon Box Copag Batalha de Liga - Mega Lucario ex': 'avulsos-deck-mega-lucario',
  'Box Pokémon 60 Cartas Coleção Batalha de Liga Charizard Ex Copag 290-4': 'avulsos-deck-charizard',
  'Box Pokémon Batalha De Liga Pokémon Miraidon Ex - 33598 - Copag': 'avulsos-deck-miraidon',
  // já casavam e continuam iguais
  'Deck Batalha de Liga Pokemon Mega Lucario EX Copag': 'avulsos-deck-mega-lucario',
  'Pokémon Baralho Batalha de Liga Charizard ex': 'avulsos-deck-charizard',
  'Pokémon Box Coleção Mega Lucario EX - Copag': 'avulsos-colecao_ex-mega-lucario',
  'Box Coleção Charizard ex em Dobro - Pokémon': 'avulsos-colecao_ex-charizard',
  'Box Pokémon Lendas de Paldea - Miraidon EX - 33017 Copag': 'avulsos-colecao_ex-miraidon',
};
for (const [t, esperado] of Object.entries(casos)) assert.equal(id(t), esperado, t);
console.log('batalha-de-liga-tests: ok');
