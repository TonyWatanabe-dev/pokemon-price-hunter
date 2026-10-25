// "Lendas Azuis" sem o Pokémon (24/10/2026, validação em runtime da #894): "Pokemon Box - Coleção Ex Lendas Azuis" ficou
// sozinho em avulsos-colecao_ex-lendas ("lendas" lido como nome). A linha Lendas Azuis tem 3 caixas (Dialga, Kyogre,
// Xerneas): sem o nome, não dá para saber qual é → sem produto. Com o nome, nada muda. Títulos reais do ramo data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { matchProduct, variantesDe } from '../src/match.js';
const cat = JSON.parse(fs.readFileSync(new URL('../config/catalog.json', import.meta.url), 'utf8'));
const id = (t, c = cat) => matchProduct({ title: t }, c).productId;

assert.equal(id('Pokemon Box - Coleção Ex Lendas Azuis'), null, 'sem o Pokémon: sem produto');
assert.equal(id('Box Coleção: Lendas Azuis - Kyogre Pokémon TCG'), null, 'sem "ex" e sem nome reconhecível: continua sem produto');
const casos = {
  'Pokémon Coleção EX Lendas Azuis - Xerneas EX': 'avulsos-colecao_ex-xerneas',
  'Pokémon - Coleção EX Lendas Azuis - Dialga EX': 'avulsos-colecao_ex-dialga',
  'Box Pokémon Coleção Lendas Azuis Kyogre EX - Certificado FSC': 'avulsos-colecao_ex-kyogre',
  'Pokemon Box - Coleção Ex Lendas Implacáveis - Zacian': 'avulsos-colecao_ex-zacian',
};
for (const [t, esperado] of Object.entries(casos)) assert.equal(id(t), esperado, t);
// Lendas de Paldea (Copag 33017) é outra caixa que a Lendas Implacáveis (35239): desde 25/10 tem variante própria e não
// vai para a coleção da Implacáveis, mesmo com o catálogo automático do robô (test/matching-restante-tests.js).
assert.equal(id('Box Pokémon Lendas de Paldea - KORAIDON EX', { ...cat, variantes: variantesDe(['sv10-colecao_ex-koraidon']) }), 'avulsos-colecao_ex-lendas-de-paldea-koraidon');
// nenhum título vira o produto "lendas"
for (const t of ['Pokemon Box - Coleção Ex Lendas Azuis', ...Object.keys(casos)]) assert.notEqual(id(t), 'avulsos-colecao_ex-lendas', t);
console.log('lendas-sem-nome-tests: ok');
