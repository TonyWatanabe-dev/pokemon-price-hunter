// Casamento de produtos especiais sem coleção no título e brinquedos fora (24/10/2026, amostra de 200 não casados).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { matchProduct } from '../src/match.js';
const cat = JSON.parse(fs.readFileSync(new URL('../config/catalog.json', import.meta.url), 'utf8'));
const id = (t) => matchProduct({ title: t }, cat).productId;
const why = (t) => matchProduct({ title: t }, cat).why?.[0];

assert.equal(id('POKEMON FERRAMENTAS DE TREINADOR FEZANDIPITI EX'), 'avulsos-colecao_especial-ferramentas-de-treinador-fezandipiti');
assert.equal(id('POKEMON FERRAMENTAS DE TREINADOR 2024 - SQUAWKABILLY EX'), 'avulsos-colecao_especial-ferramentas-de-treinador-squawkabilly');
assert.equal(id('Pokemon Box - Ferramentas de Treinador'), null, 'sem o Pokémon da edição: não adivinha');
assert.equal(id('Box Pokémon Coleção Parceiro Inicial - Série 2'), 'avulsos-colecao_ilustracao-parceiro-inicial-serie-2');
assert.equal(id('POKEMON FIRST PARTNER ILLUSTRATION COLLECTION BOX SERIES 3 INGLES'), 'avulsos-colecao_ilustracao-parceiro-inicial-serie-3-en', 'importado com idioma');
assert.equal(id('Box Pokémon Coleção Parceiro Inicial'), null, 'sem série: não adivinha');
assert.equal(id('POKEMON BOX COLEÇÃO DE TORNEIOS LILIAN'), 'avulsos-colecao_especial-torneio-lilian');
assert.equal(id('Box Pokémon Coleção Mega Luar Mega Gengar'), 'avulsos-colecao_especial-mega-luar-gengar');
assert.equal(id('Pokemon Box - Coleção Mega Luar - Clefable com 49 Cartas'), 'avulsos-colecao_especial-mega-luar-clefable');
assert.equal(id('POKEMON BOX COLEÇÃO - DIA DE POKÉMON 2026'), 'avulsos-colecao_especial-dia-de-pokemon-2026');
assert.equal(id('Deck De Batalha Pokémon TCG Deluxe Miraidon'), 'avulsos-deck-deluxe-miraidon');
assert.equal(id('POKEMON BOX COLEÇÃO ILUSTRAÇÃO VICTINI DE UNOVA'), 'avulsos-colecao_ilustracao-victini');

for (const t of ['Funko Pop - Pokemon - Pikachu #553', 'Pokemon - Clipe Pokebola - Rotom + Bola Rápida - Sunny', 'Pokemon - Figura de Vinil 20cm - Squirtle - Sunny',
  '72151 Lego Pokemon - Eevee', 'Pokemon - Boneco Articulado Mewtwo 15cm', 'Pokemon - Pokebola Super - Pikachu', 'Jogo Monopoly Pokemon G0716 - Hasbro'])
  assert.equal(why(t), 'brinquedo, não é carta', t);
assert.notEqual(why('Pokemon - Lata Pokebola Azul - Copag'), 'brinquedo, não é carta', 'lata Pokébola é TCG');
console.log('✓ casamento-especiais: 12 especiais reconhecidos, brinquedos fora, sem adivinhar edição');
