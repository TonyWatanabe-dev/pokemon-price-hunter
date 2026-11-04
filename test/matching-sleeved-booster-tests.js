// "Sleeved Booster" (03/11/2026): nome que a Amazon e a Pokémon usam para o pacote de booster avulso em embalagem plástica.
// Antes ficava "tipo de produto não identificado". Agora é booster_pack (1 booster), em PT e EN; com outro formato no título
// (bundle, display, blister, kit, N boosters) não vira booster avulso.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { matchProduct } from '../src/match.js';

const catalog = JSON.parse(fs.readFileSync(new URL('../config/catalog.json', import.meta.url), 'utf8'));
catalog.products ||= []; catalog.copag ||= {};
const id = (title) => matchProduct({ title }, catalog).productId;
let n = 0; const t = (name, fn) => { try { fn(); } catch (e) { e.message = `${name}: ${e.message}`; throw e; } n++; };

t('1. Sleeved Booster em português = booster avulso da coleção', () => {
  assert.equal(id('Pokémon TCG: Mega Evolução - Caos Ascendente - Sleeved Booster - Português'), 'me04-booster');
  assert.equal(id('Pokémon TCG: Mega Evolução - Equilíbrio Perfeito - Sleeved Booster - Português'), 'me03-booster');
  assert.equal(id('Pokémon TCG: Mega Evolução - Escuridão Absoluta - Sleeved Booster - Português, Jogo de Cartas'), 'me05-booster');
});

t('2. Sleeved Booster em inglês = booster avulso EN', () => {
  assert.equal(id('Pokémon TCG: Mega Evolution - Pitch Black - Sleeved Booster - Inglês'), 'me05-booster-en');
  assert.equal(id('Pokémon TCG: Mega Evolution - Perfect Order - Sleeved Booster - Inglês'), 'me03-booster-en');
});

t('3. com outro formato no título não vira booster avulso', () => {
  for (const title of ['Pokémon TCG: Mega Evolution - Perfect Order - Sleeved Booster Bundle - Inglês',
    'Pokémon TCG: Mega Evolução - Caos Ascendente - Sleeved Booster Display - Português',
    'Kit 3 Sleeved Booster Pokémon Escuridão Absoluta']) assert.ok(!/-booster(-en)?$/.test(id(title) || ''), title);
});

console.log(`✓ Sleeved Booster no matcher: ${n} grupos passaram`);
