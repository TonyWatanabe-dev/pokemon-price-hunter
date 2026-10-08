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
  ] });
  if (url.endsWith('/users/77')) return j({ nickname: 'LOJA_TCG' });
  return j({}, 404);
});
const L = await search({ id: 'mercadolivre' }, catalog);
assert.ok(L.length >= 1, 'achou oferta pelo catálogo');
const o = L.find((x) => x.sku === 'MLB5551');
assert.equal(o.url, 'https://produto.mercadolivre.com.br/MLB-5551-_JM');
assert.equal(o.price.base, 299.9); assert.equal(o.shipping, 0); assert.equal(o.seller, 'LOJA_TCG');
assert.ok(!L.some((x) => x.sku === 'MLB5552'), 'usado fica de fora');
assert.ok(!seen.some((u) => u.includes('MLB222')), 'produto fora do catálogo não é consultado');
assert.ok(fs.existsSync(path.join(dir, 'ml-catalog.json')));

// sem autorização = bloqueado com instrução
fs.rmSync(path.join(dir, 'ml-auth.enc'));
await assert.rejects(search({ id: 'mercadolivre' }, catalog), /não autorizado/);
console.log('OK — Mercado Livre');
