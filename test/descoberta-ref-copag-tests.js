// Descoberta pelos códigos Copag: consultas determinísticas, lançamentos primeiro, código inválido fora.
import assert from 'node:assert/strict';
import { generateQueries, refQueries, CITIES } from '../src/discovery/queries.js';

const catalog = { collections: [{ id: 'sv1', name: 'Escarlate e Violeta' }, { id: 'me05', name: 'Escuridão Absoluta' }], products: [] };
const refs = { '33487': { productId: 'sv1-blister1', collection: 'sv1', type: 'blister_1' }, '36936': { productId: 'me05-desafio', collection: 'me05', type: 'desafio' }, 'xx': { collection: 'me05' } };
assert.deepEqual(refQueries(refs, catalog.collections).map(([c]) => c), ['36936', '33487'], 'mais nova primeiro; código inválido fora');
const qs = generateQueries(catalog, refs); const r = qs.filter((q) => q.kind === 'ref');
assert.deepEqual(r.map((q) => q.q), ['"36936" pokémon copag', '"33487" pokémon copag']); assert.equal(r[0].product, 'me05-desafio');
assert.deepEqual(generateQueries(catalog, refs), qs, 'determinístico');
assert.equal(generateQueries(catalog).filter((q) => q.kind === 'ref').length, 0, 'sem códigos, nada muda');
assert.ok(qs.some((q) => q.q === 'loja de brinquedos cartas pokémon copag')); assert.ok(CITIES.includes('Belém'));
console.log('descoberta-ref-copag-tests: ok');
