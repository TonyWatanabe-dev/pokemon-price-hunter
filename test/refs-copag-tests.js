// Código de referência da Copag: minerado das ofertas casadas e usado só quando o título não identifica o produto.
import assert from 'node:assert/strict';
import { minerar, refsDe } from '../tools/refs-copag.mjs';
import { matchProduct } from '../src/match.js';
import { readJson, configPath } from '../src/db.js';

assert.deepEqual(refsDe('Blister Triplo Ref 36859 Copag 2026'), ['36859']); assert.deepEqual(refsDe('EAN 7896214136859'), []);
const products = { 'me03-blister3': { collection: 'me03', type: 'blister_3', boosters: 3 }, 'me02_5-colecao_ex-mega-x': { collection: 'me02_5', type: 'colecao_ex', variant: 'Mega X ex' } };
const offers = { a: { productId: 'me03-blister3', title: 'Blister Triplo 36859' }, b: { productId: 'me03-blister3', title: 'x', sku: '36859' },
  c: { productId: 'me02_5-colecao_ex-mega-x', title: '36657' }, d: { productId: 'me02_5-colecao_ex-mega-x', title: '36657' }, e: { productId: 'me03-blister3', title: 'só 31111' } };
const m = minerar(offers, products);
assert.deepEqual(Object.keys(m), ['36859'], 'variante e código visto 1 vez ficam fora'); assert.equal(m['36859'].productId, 'me03-blister3');

const cat = readJson(configPath('catalog.json')); cat.refs = { '36859': { productId: 'me03-blister3', collection: 'me03', type: 'blister_3', boosters: 3 } };
let r = matchProduct({ title: 'Pokémon TCG Blister Copag Ref. 36859' }, cat);
assert.equal(r.productId, 'me03-blister3'); assert.equal(r.via, 'ref-copag'); assert.equal(r.confidence, 0.75);
r = matchProduct({ title: 'Cartas Pokémon Copag', sku: 'COP-36859' }, cat); assert.equal(r.productId, 'me03-blister3', 'código no SKU');
r = matchProduct({ title: 'Pokémon Blister Triplo Caos Ascendente 36859' }, cat); assert.notEqual(r.via, 'ref-copag', 'título já identifica: código não manda');
r = matchProduct({ title: 'Pokémon TCG Booster japonês 36859' }, cat); assert.equal(r.productId, null, 'recusa (idioma) continua valendo');
const semRef = { ...cat, refs: {} }; assert.equal(matchProduct({ title: 'Pokémon TCG Blister Copag Ref. 36859' }, semRef).productId, null);
const real = readJson(configPath('refs-copag.json')); assert.ok(Object.keys(real.refs).length >= 10, 'arquivo gerado no repositório');
console.log('refs-copag-tests: ok');
