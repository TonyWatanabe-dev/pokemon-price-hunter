// Mercado Livre: cofre do token, renovação e leitura pelo catálogo (sem rede).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-'));
process.env.HUNTER_DATA_DIR = dir;
process.env.ML_CLIENT_ID = '123';
process.env.ML_CLIENT_SECRET = 'segredo-de-teste';
delete process.env.ML_ACCESS_TOKEN;

const http = await import('../src/http.js');
const ml = await import('../src/mlauth.js');
const { search } = await import('../src/adapters/mercadolivre.js');
const catalog = JSON.parse(fs.readFileSync(new URL('../config/catalog.json', import.meta.url)));

// cofre: abre com a chave certa, falha com a errada, e não guarda texto puro
const box = ml.seal({ refresh: 'TG-abc' });
assert.deepEqual(ml.open(box), { refresh: 'TG-abc' });
assert.throws(() => ml.open(box, 'outra-chave'));
assert.ok(!box.includes('TG-abc'));

// troca de código e renovação (fetch global = OAuth)
let tokenCalls = [];
globalThis.fetch = async (url, opt) => {
  const p = Object.fromEntries(new URLSearchParams(opt.body));
  tokenCalls.push(p.grant_type);
  return new Response(JSON.stringify({ access_token: 'AT-' + tokenCalls.length, refresh_token: 'RT-' + tokenCalls.length, expires_in: 21600, user_id: 9 }), { status: 200 });
};
await ml.exchange('TG-123');
assert.equal((await ml.accessToken()).token, 'AT-1');
assert.equal(tokenCalls.length, 1, 'não renova token ainda válido');
const t = ml.load(); t.expiresAt = Date.now() + 60e3; fs.writeFileSync(path.join(dir, 'ml-auth.enc'), ml.seal(t));
const r = await ml.accessToken();
assert.equal(r.token, 'AT-2'); assert.equal(r.refreshed, true); assert.equal(ml.load().refresh, 'RT-2', 'guarda o token renovável novo');
assert.ok(!fs.readFileSync(path.join(dir, 'ml-auth.enc'), 'utf8').includes('RT-2'));

// busca aberta dá 403 → catálogo
const coll = catalog.collections[0].name;
const seen = [];
http.setFetch(async (url, opt) => {
  seen.push(url);
  assert.equal(opt.headers.authorization, 'Bearer AT-2');
  const j = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
  if (url.includes('/sites/MLB/search')) return j({ message: 'forbidden' }, 403);
  if (url.includes('/products/search') && url.includes(encodeURIComponent('pokemon ' + coll))) return j({ results: [
    { id: 'MLB111', name: `Pokémon TCG ${coll} Treinador Avançado Copag` },
    { id: 'MLB222', name: 'Capa de celular qualquer' },
  ] });
  if (url.includes('/products/search')) return j({ results: [] });
  if (url.endsWith('/products/MLB111/items')) return j({ results: [
    { item_id: 'MLB5551', price: 299.9, seller_id: 77, condition: 'new', shipping: { free_shipping: true } },
    { item_id: 'MLB5552', price: 250, seller_id: 78, condition: 'used' },
    { item_id: 'MLB5553', price: 99, seller_id: 79, condition: 'new' },
  ] });
  if (url.includes('/items?ids=')) return j(url.match(/ids=([^&]+)/)[1].split(',').map((id) => ({ code: 200, body: { id, price: id === 'MLB5551' ? 299.9 : 99, status: 'active', condition: 'new', permalink: 'https://produto.mercadolivre.com.br/' + id.replace('MLB', 'MLB-') + '-pokemon-_JM', catalog_product_id: 'MLB111' } })));
  if (url.endsWith('/users/77')) return j({ nickname: 'LOJA_TCG', seller_reputation: { level_id: '5_green', transactions: { completed: 900 } } });
  if (url.endsWith('/users/79')) return j({ nickname: 'CONTA_NOVA', seller_reputation: { level_id: null, transactions: { completed: 0 } } });
  return j({}, 404);
});
const L = await search({ id: 'mercadolivre' }, catalog);
assert.ok(L.length >= 1, 'achou oferta pelo catálogo');
const o = L.find((x) => x.sku === 'MLB5551');
assert.equal(o.url, 'https://produto.mercadolivre.com.br/MLB-5551-pokemon-_JM', 'usa o link oficial do anúncio');
assert.equal(o.price.base, 299.9); assert.equal(o.shipping, 0); assert.equal(o.seller, 'LOJA_TCG');
assert.ok(!L.some((x) => x.sku === 'MLB5552'), 'usado fica de fora');
assert.ok(!L.some((x) => x.sku === 'MLB5553'), 'vendedor sem reputação fica de fora');
assert.ok(!seen.some((u) => u.includes('MLB222')), 'produto fora do catálogo não é consultado');
assert.ok(fs.existsSync(path.join(dir, 'ml-catalog.json')));

// /items fechado para o app → link da página do produto com o vendedor selecionado
fs.rmSync(path.join(dir, 'ml-catalog.json'));
const prevFetch = http.setFetch;
http.setFetch(async (url) => {
  const j = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { 'content-type': 'application/json' } });
  if (url.includes('/items?ids=')) return j({ message: 'forbidden' }, 403);
  if (url.includes('/sites/MLB/search')) return j({}, 403);
  if (url.includes('/products/search') && url.includes(encodeURIComponent('pokemon ' + coll))) return j({ results: [{ id: 'MLB111', name: `Pokémon TCG ${coll} Treinador Avançado Copag` }] });
  if (url.includes('/products/search')) return j({ results: [] });
  if (url.endsWith('/products/MLB111/items')) return j({ results: [{ item_id: 'MLB5551', price: 299.9, seller_id: 77, condition: 'new' }] });
  if (url.endsWith('/users/77')) return j({ nickname: 'LOJA_TCG', seller_reputation: { level_id: '5_green', transactions: { completed: 900 } } });
  return j({}, 404);
});
const L2 = await search({ id: 'mercadolivre' }, catalog);
assert.equal(L2[0].url, 'https://www.mercadolivre.com.br/p/MLB111?pdp_filters=item_id%3AMLB5551');

// sem autorização = bloqueado com instrução
fs.rmSync(path.join(dir, 'ml-auth.enc'));
await assert.rejects(search({ id: 'mercadolivre' }, catalog), /não autorizado/);
// filtro de nomes do catálogo do ML
const { mlReject } = await import('../src/adapters/mercadolivre.js');
const bad = [['Kit 3 Blister Quadruplo Pokémon Evoluções Prismáticas Copag', 'sv8_5-blister4'], ['Cx Lacrada C/ 24 Blister Unitarios Me03 Equilibrio Perfeito', 'me03-blister1'],
  ['Álbum Fichário Pokémon Cards Copag Rivais Predestinados 20 Folhas', 'sv10-colecao_fichario'], ['Booster Pokémon Escarlate E Violeta Com 36 Pacotinhos Copag', 'sv1-booster'],
  ['Pokémon Caos Ascendentes - Blister Triplo - Mega Evolução', 'me01-blister3'], ['Caixa 36 Pacotes De Figurinha Copag Pokémon Coroa Estelar', 'sv7-box36']];
for (const [n, id] of bad) assert.ok(mlReject(n, id, catalog), 'devia barrar: ' + n);
const good = [['Box Treinador Avançado Caos Ascendente Pokémon Tcg Copag', 'me04-etb'], ['Blister Triplo Pokémon TCG Amigos de Jornada com Scraggy – Escarlate e Violeta', 'sv9-blister3'],
  ['Pokémon Celebração de 30 anos – Box Coleção com Fichário', 'c30-colecao_fichario'], ['Treinador Avançado Pokémon Megaevolução Lucário ex', 'me01-etb']];
for (const [n, id] of good) assert.equal(mlReject(n, id, catalog), null, 'não devia barrar: ' + n);
console.log('OK — Mercado Livre');
