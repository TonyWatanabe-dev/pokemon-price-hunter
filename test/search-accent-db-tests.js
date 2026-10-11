// Busca de produtos sem acento (GET /api/v1/produtos?busca=): "pokemon" acha "Pokémon", "colecao" acha "Coleção".
// 1) helper de normalização (sempre); 2) fallback do state.json (sempre); 3) banco (listProducts + contagem) só com
// TEST_DATABASE_URL (banco descartável); sem ele, a parte de banco é pulada como nos demais testes de banco.
import assert from 'node:assert/strict';
import { normalizeSearch, sqlFold } from '../api/_lib/search.mjs';
import { stateListProducts } from '../api/_lib/read-state.mjs';

let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };

// ---------------------------------------------------------------- helper
await t('normalizeSearch tira acentos e põe em minúsculas', () => {
  assert.equal(normalizeSearch('Pokémon'), 'pokemon');
  assert.equal(normalizeSearch('COLEÇÃO'), 'colecao');
  assert.equal(normalizeSearch('Fichário'), 'fichario');
  assert.equal(normalizeSearch('Pokémon'.normalize('NFD')), 'pokemon', 'entrada já decomposta (NFD)');
  assert.equal(normalizeSearch('ÁÀÂÃÄ éèêë íìîï óòôõö úùûü ç ñ'), 'aaaaa eeee iiii ooooo uuuu c n');
  assert.equal(normalizeSearch('100%_off'), '100%_off', '% e _ ficam como estão');
  assert.equal(normalizeSearch(null), ''); assert.equal(normalizeSearch(undefined), '');
});
await t('sqlFold monta translate(lower(...)) com mapa alinhado', () => {
  const s = sqlFold('p.canonical_name');
  assert.match(s, /^translate\(lower\(p\.canonical_name\), '[^']+', '[^']+'\)$/);
  const [, from, to] = s.match(/, '([^']+)', '([^']+)'\)$/);
  assert.equal([...from].length, [...to].length);
  // o mapa do SQL dá o mesmo resultado do helper para cada letra acentuada
  [...from].forEach((ch, i) => assert.equal(to[i], normalizeSearch(ch), ch));
});

// ---------------------------------------------------------------- fallback (state.json)
const NAMES = [
  ['x-poke', 'Escuridão Absoluta', 'Lata Pokémon'],
  ['x-col', 'Fábulas Nebulosas', 'Coleção Premium'],
  ['x-fich', 'Rivais Predestinados', 'Fichário'],
  ['x-epic', 'Chamas Obsidianas', 'ÉPICA Edição'],
  ['x-plain', 'Destinos de Paldea', 'Booster Box'],
];
const stateOf = () => ({ collections: [], offers: [], products: NAMES.map(([id, collectionName, typeLabel], i) => ({ id, collection: 'c' + i, collectionName, type: 'etb', typeLabel })) });
const stIds = (busca) => stateListProducts(stateOf(), { page: 1, limit: 50, busca }).items.map((x) => x.id).sort();
await t('state: busca sem acento acha nome com acento', () => {
  assert.deepEqual(stIds('pokemon'), ['x-poke']);
  assert.deepEqual(stIds('colecao'), ['x-col']);
  assert.deepEqual(stIds('fichario'), ['x-fich']);
  assert.deepEqual(stIds('epica'), ['x-epic'], 'maiúscula acentuada no nome');
});
await t('state: maiúsculas/minúsculas e termo com acento continuam funcionando', () => {
  assert.deepEqual(stIds('POKEMON'), ['x-poke']);
  assert.deepEqual(stIds('Pokémon'), ['x-poke']);
  assert.deepEqual(stIds('COLEÇÃO'), ['x-col']);
  assert.deepEqual(stIds('booster'), ['x-plain']);
});
await t('state: inexistente e caracteres especiais não viram curinga', () => {
  assert.deepEqual(stIds('charizard'), []);
  assert.deepEqual(stIds('%'), []); assert.deepEqual(stIds('_'), []); assert.deepEqual(stIds('lata%'), []);
});

// ---------------------------------------------------------------- banco
if (!process.env.TEST_DATABASE_URL) {
  console.log(`✓ Busca sem acento (helper + state.json): ${n} grupos passaram`);
  console.log('— testes de banco da busca sem acento pulados (sem TEST_DATABASE_URL)');
  process.exit(0);
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.API_DATABASE_URL = process.env.TEST_DATABASE_URL;
const { pool, tx, close } = await import('../src/db/pg.js');
const { syncState } = await import('../src/core/sync.js');
const { listProducts } = await import('../api/_lib/read-db.mjs');
const { closeApiPool } = await import('../api/_lib/db.mjs');
const { execFileSync } = await import('node:child_process');
const p = await pool();
await p.query('DROP SCHEMA IF EXISTS hunter CASCADE');
execFileSync('node', ['tools/db-migrate.mjs'], { env: process.env, stdio: 'pipe' });

const st = stateOf();
const catalog = { collections: st.products.map((x) => ({ id: x.collection, name: x.collectionName, series: 'Teste' })) };
await tx((c) => syncState(c, { state: { ...st, sources: [], reputation: {} }, catalog, historyLines: [] }));
const dbIds = async (busca) => (await listProducts({ page: 1, limit: 50, busca })).items.map((x) => x.id).sort();
const dbTotal = async (busca) => (await listProducts({ page: 1, limit: 50, busca })).total;
// página além do fim: listProducts sem linhas cai em countProducts (a contagem tem de usar a mesma regra)
const dbCount = async (busca) => (await listProducts({ page: 99, limit: 1, busca })).total;

await t('banco: produtos gravados com o nome acentuado', async () => {
  const names = (await p.query("SELECT canonical_name FROM hunter.product WHERE legacy_id = 'x-poke'")).rows.map((r) => r.canonical_name);
  assert.deepEqual(names, ['Escuridão Absoluta - Lata Pokémon']);
});
await t('banco: busca sem acento acha nome com acento (lista e contagem)', async () => {
  for (const [busca, ids] of [['pokemon', ['x-poke']], ['colecao', ['x-col']], ['fichario', ['x-fich']], ['epica', ['x-epic']], ['escuridao', ['x-poke']]]) {
    assert.deepEqual(await dbIds(busca), ids, busca);
    assert.equal(await dbTotal(busca), ids.length, busca + ' (total)');
    assert.equal(await dbCount(busca), ids.length, busca + ' (countProducts)');
  }
});
await t('banco: maiúsculas/minúsculas e termo com acento continuam funcionando', async () => {
  assert.deepEqual(await dbIds('POKEMON'), ['x-poke']);
  assert.deepEqual(await dbIds('Pokémon'), ['x-poke']);
  assert.deepEqual(await dbIds('pokémon'), ['x-poke']);
  assert.deepEqual(await dbIds('COLEÇÃO'), ['x-col']);
  assert.deepEqual(await dbIds('ÉPICA'), ['x-epic']);
  assert.deepEqual(await dbIds('booster'), ['x-plain']);
  assert.equal(await dbCount('Pokémon'), 1);
});
await t('banco: termo inexistente → 0', async () => {
  assert.deepEqual(await dbIds('charizard'), []);
  assert.equal(await dbTotal('charizard'), 0); assert.equal(await dbCount('charizard'), 0);
});
await t('banco: % e _ não viram curinga', async () => {
  for (const busca of ['%', '_', 'lata%', 'p_kemon', '%pokemon%']) {
    assert.deepEqual(await dbIds(busca), [], busca);
    assert.equal(await dbCount(busca), 0, busca + ' (countProducts)');
  }
});
await t('banco: sem busca, todos os produtos (filtro não muda nada)', async () => {
  assert.equal(await dbTotal(null), NAMES.length);
  assert.equal(await dbCount(null), NAMES.length);
});

await closeApiPool(); await close();
console.log(`✓ Busca sem acento (helper + state.json + PostgreSQL): ${n} grupos passaram`);
