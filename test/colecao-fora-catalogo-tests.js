// Coleção fora do catálogo não cai na coleção base da série pelo fallback.
// Caso real (ramo data, 25/10/2026): anúncios "Megaevolução - Reinado Delta (ME06)" da geekstorebrasil casavam em ME01
// (Megaevolução) pelo fallbackAlias "megaevolucao"; a página do ETB ME01 mostrava R$ 399,88 com o link do ETB ME06.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalize, detectCollection, parseListing } from '../src/match.js';

const catalog = JSON.parse(fs.readFileSync(new URL('../config/catalog.json', import.meta.url), 'utf8'));
const col = (title) => detectCollection(normalize(title), catalog.collections).id;
let n = 0; const t = (name, fn) => { fn(); n++; };

const ME06 = [
  'Elite Trainer Box (ETB) Megaevolução - Reinado Delta (ME06) — PT',
  'Booster Box Megaevolução - Reinado Delta (ME06) — PT — 36 Boosters',
  'Blister Unitário Megaevolução - Reinado Delta (ME06) — PT — 1 Booster',
  'Blister Triplo Megaevolução - Reinado Delta (ME06) — PT — 3 Boosters',
  'Blister Quádruplo Megaevolução - Reinado Delta (ME06) — PT — 4 Boosters',
  'Combo Booster Box Pokémon Reinado Delta Megaevolução ME06 - 18 Pacotes',
];

t('títulos reais de ME06 (fora do catálogo) não casam em ME01', () => {
  for (const title of ME06) {
    assert.equal(col(title), null, title);
    assert.notEqual(parseListing(title, catalog).collection, 'me01', title);
  }
});

t('ME01 de verdade continua casando (por código e pelo fallback sem código)', () => {
  for (const title of [
    'Pokémon - Treinador Avançado ME01 - Megaevolução',
    'Pokémon TCG Blister Unitário – Mega Evolução ME01',
    'Blister Quádruplo Megaevolução (ME01) — Golduck — PT — 4 Boosters',
    'Booster Avulso Megaevolução (ME01) — PT — 1 Booster',
    'Box Treinador Avançado Pokémon Megaevolução Copag',
  ]) assert.equal(col(title), 'me01', title);
});

t('o mesmo vale para as outras séries com fallback', () => {
  assert.equal(col('Booster Box Escarlate e Violeta SV99 Copag'), null);
  assert.equal(col('Booster Espada e Escudo SWSH99 Copag'), null);
  assert.equal(col('Booster Escarlate e Violeta Copag'), 'sv1');
  assert.equal(col('Booster Escarlate e Violeta SV01 Copag'), 'sv1');
});

t('coleções do catálogo citadas por código continuam casando', () => {
  assert.equal(col('Blister Triplo Escuridão Absoluta ME05'), 'me05');
  assert.equal(col('Booster Box Megaevolução ME05 Copag'), 'me05');
  assert.equal(col('ETB Fogo Fantasmagórico ME02'), 'me02');
});

console.log(`✓ Coleção fora do catálogo não cai na base da série: ${n} grupos de testes passaram`);
