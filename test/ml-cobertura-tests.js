// Mercado Livre: mais produtos achados no catálogo (03/11/2026) — paginação da busca por coleção e busca por EAN
// visto nas outras lojas, sem aceitar produto que o título não confirma (sem rede, sem relógio).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mlcob-'));
process.env.HUNTER_DATA_DIR = dir;
process.env.ML_CLIENT_ID = '123';
process.env.ML_CLIENT_SECRET = 'segredo-de-teste';
delete process.env.ML_ACCESS_TOKEN;
process.env.HUNTER_DOMAIN_DELAY_MS ??= '0';

const http = await import('../src/http.js');
http.setSleep(async () => {});
const ml = await import('../src/mlauth.js');
const { search, eansDeOfertas, _setSleep } = await import('../src/adapters/mercadolivre.js');
const catalog = JSON.parse(fs.readFileSync(new URL('../config/catalog.json', import.meta.url)));
_setSleep(async () => {});
globalThis.fetch = async () => new Response(JSON.stringify({ access_token: 'AT-1', refresh_token: 'RT-1', expires_in: 21600, user_id: 9 }), { status: 200 });
await ml.exchange('TG-1');

let n = 0; const t = async (nome, fn) => { try { await fn(); n++; } catch (e) { e.message = `[${nome}] ${e.message}`; throw e; } };
const j = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });

await t('eansDeOfertas: EAN de um produto só, visto 2+ vezes ou com prefixo conhecido; ignora ML e importado', () => {
  const m = eansDeOfertas([
    { productId: 'a', storeId: 'x', ean: '0196214156050' }, // prefixo The Pokémon Company, 1 vez: entra
    { productId: 'b', storeId: 'x', ean: '1234567890123' }, { productId: 'b', storeId: 'y', ean: '1234567890123' }, // 2 vezes: entra
    { productId: 'c', storeId: 'x', ean: '5555555555555' }, // 1 vez, prefixo desconhecido: fora
    { productId: 'd', storeId: 'x', ean: '7896192339454' }, { productId: 'e', storeId: 'y', ean: '7896192339454' }, // dois produtos: fora
    { productId: 'f', storeId: 'mercadolivre', ean: '7896192300001' }, { productId: 'g-ja', storeId: 'x', ean: '7896192300002' },
  ]);
  assert.deepEqual(Object.fromEntries(m), { b: ['1234567890123'], a: ['196214156050'] });
});

const col = catalog.collections.find((c) => c.id === 'me04').name;   // Caos Ascendente
const nome = (tipo) => `Pokémon TCG ${col} ${tipo} Copag`;
await t('busca por coleção pagina quando a página vem cheia; EAN acha o que faltou e recusa nome de outro produto', async () => {
  // Rodada anterior: Blister Triplo e Quádruplo vistos em outras lojas com EAN.
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ offers: [
    { productId: 'me04-blister3', storeId: 'loja', ean: '0196214156050' },
    { productId: 'me04-blister4', storeId: 'loja', ean: '0196214156067' },
  ] }));
  const calls = [];
  http.setFetch(async (url) => {
    calls.push(url);
    if (url.includes('/sites/MLB/search')) return j({ message: 'forbidden' }, 403);
    if (url.includes('product_identifier=0196214156050')) return j({ results: [{ id: 'MLB300', name: nome('Blister Triplo') }] });
    if (url.includes('product_identifier=0196214156067')) return j({ results: [{ id: 'MLB400', name: nome('Treinador Avançado') }] }); // EAN com nome de outro produto
    if (url.includes('/products/search') && url.includes(encodeURIComponent('pokemon ' + col))) {
      if (url.includes('offset=0')) return j({ results: Array.from({ length: 20 }, (_, i) => ({ id: `MLB9${i}`, name: 'Pokémon acessório qualquer' })), paging: { total: 25 } });
      if (url.includes('offset=20')) return j({ results: [{ id: 'MLB111', name: nome('Treinador Avançado') }], paging: { total: 25 } });
    }
    if (url.includes('/products/search')) return j({ results: [] });
    if (/\/products\/MLB(111|300)\/items$/.test(url)) return j({ results: [{ item_id: url.includes('111') ? 'MLB5551' : 'MLB5553', price: 99.9, seller_id: 77, condition: 'new', official_store_id: 1, official_store_name: 'Loja Oficial' }] });
    if (url.includes('/items?ids=')) return j([{ code: 403, body: { message: 'forbidden', error: 'access_denied', status: 403 } }]);
    return j({}, 404);
  });
  const out = await search({ id: 'mercadolivre' }, catalog);
  const busca = calls.filter((u) => u.includes(encodeURIComponent('pokemon ' + col)));
  assert.equal(busca.length, 2, 'parou na 2ª página (total 25)');
  assert.deepEqual(out.map((l) => l.title).sort(), [nome('Blister Triplo'), nome('Treinador Avançado')].sort());
  const dbg = JSON.parse(fs.readFileSync(path.join(dir, 'ml-debug.json'), 'utf8'));
  assert.equal(dbg.catalogSweep.eanAsked, 2); assert.equal(dbg.catalogSweep.eanFound, 1); assert.equal(dbg.catalogSweep.eanConflict, 1);
  const cache = JSON.parse(fs.readFileSync(path.join(dir, 'ml-catalog.json'), 'utf8'));
  assert.equal(cache.products.MLB300.productId, 'me04-blister3'); assert.equal(cache.products.MLB400, undefined);
});

console.log(`✓ ML cobertura: ${n} grupos passaram`);
