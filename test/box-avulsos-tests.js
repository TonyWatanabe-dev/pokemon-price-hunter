// Box/baralho com Pokémon em destaque sem coleção no título: vai para a coleção conhecida da mesma caixa ou para "avulsos".
import assert from 'node:assert/strict';
import { matchProduct, variantesDe, AVULSOS } from '../src/match.js';
import { readJson, configPath } from '../src/db.js';

const cat = readJson(configPath('catalog.json'));
cat.variantes = variantesDe(['me03-colecao_ex-mega-zygarde', 'sv9-colecao_ex-zacian', 'sv8-colecao_ex-zacian', 'avulsos-deck-mewtwo', 'me01-blister3']);
assert.deepEqual(cat.variantes, { 'colecao_ex|mega-zygarde': 'me03' }, 'só variante única; ambígua e avulsos fora');
let r = matchProduct({ title: 'Cartas Pokemon Box Mega Zygarde Ex' }, cat);
assert.equal(r.productId, 'me03-colecao_ex-mega-zygarde'); assert.equal(r.via, 'variante-conhecida');
r = matchProduct({ title: 'Pokémon TCG Melmetal Ex Baralho Batalha Ex Copag' }, cat);
assert.equal(r.productId, `${AVULSOS}-deck-melmetal`); assert.equal(r.product.collectionName, 'Box Pokémon'); assert.equal(r.confidence, 0.65);
assert.equal(matchProduct({ title: 'Pokémon Coleção EX Lendas Azuis - Xerneas EX' }, cat).productId, 'avulsos-colecao_ex-xerneas', '"<nome> ex" certo, não "lendas"');
assert.equal(matchProduct({ title: 'Box Pokémon Zacian ex ou Koraidon ex Copag' }, cat).productId, null, 'loja escolhe qual vem: não casa');
assert.equal(matchProduct({ title: 'Top Loader Magnético Pokemon' }, cat).productId, null);
assert.equal(matchProduct({ title: 'Pokémon Box Mega Gengar ex japonês' }, cat).productId, null, 'idioma continua recusando');
assert.equal(matchProduct({ title: 'Box Pokémon Coleção Mega Zygarde ex Equilíbrio Perfeito' }, cat).via, undefined, 'título com coleção: caminho normal');
console.log('box-avulsos-tests: ok');
