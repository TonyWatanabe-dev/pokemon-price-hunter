// Mercado Livre: 429 "local_rate_limited" (limite de rajada) não derruba a loja na primeira recusa (sem rede, sem relógio).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml429-'));
process.env.HUNTER_DATA_DIR = dir;
process.env.ML_CLIENT_ID = '123';
process.env.ML_CLIENT_SECRET = 'segredo-de-teste';
delete process.env.ML_ACCESS_TOKEN;
process.env.HUNTER_DOMAIN_DELAY_MS ??= '0'; // antes de carregar o cliente HTTP

const http = await import('../src/http.js');
http.setSleep(async () => {});
const ml = await import('../src/mlauth.js');
const { search, _setSleep, ML_RETRY_429_MS, ML_GAP_MS } = await import('../src/adapters/mercadolivre.js');
const catalog = JSON.parse(fs.readFileSync(new URL('../config/catalog.json', import.meta.url)));

globalThis.fetch = async () => new Response(JSON.stringify({ access_token: 'AT-1', refresh_token: 'RT-1', expires_in: 21600, user_id: 9 }), { status: 200 });
await ml.exchange('TG-1');

const sleeps = []; _setSleep(async (ms) => { sleeps.push(ms); });
const coll = catalog.collections[0].name;
const j = (o, s = 200, h = {}) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', ...h } });
const limited = (h) => j({ message: 'local_rate_limited', status: 429 }, 429, h);

/** API simulada: /products/MLB111/items responde 429 `fails` vezes (com cabeçalho `h`) antes do 200. */
function api(fails, h = {}) {
  let n = 0; const calls = [];
  http.setFetch(async (url) => {
    calls.push(url);
    if (url.includes('/sites/MLB/search')) return j({ message: 'forbidden' }, 403);
    if (url.includes('/products/search') && url.includes(encodeURIComponent('pokemon ' + coll))) return j({ results: [{ id: 'MLB111', name: `Pokémon TCG ${coll} Treinador Avançado Copag` }] });
    if (url.includes('/products/search')) return j({ results: [] });
    if (url.endsWith('/products/MLB111/items')) {
      if (n++ < fails) return limited(h);
      return j({ results: [{ item_id: 'MLB5551', price: 299.9, seller_id: 77, condition: 'new', official_store_id: 1, official_store_name: 'Loja Oficial' }] });
    }
    if (url.includes('/items?ids=')) return j([{ code: 403, body: { message: 'forbidden', error: 'access_denied', status: 403 } }]);
    return j({}, 404);
  });
  return calls;
}
const itemsCalls = (calls) => calls.filter((u) => u.endsWith('/products/MLB111/items')).length;
const reset = () => { sleeps.length = 0; fs.rmSync(path.join(dir, 'ml-catalog.json'), { force: true }); };

// 1) Uma recusa e depois responde: a loja publica normalmente, com uma espera curta registrada no diagnóstico.
reset();
let calls = api(1);
let out = await search({ id: 'mercadolivre' }, catalog);
assert.equal(out.length, 1, 'publica a oferta depois da nova tentativa');
assert.equal(itemsCalls(calls), 2, 'tentou de novo o mesmo produto');
assert.ok(sleeps.includes(ML_RETRY_429_MS[0]), 'esperou a primeira pausa curta');
let dbg = JSON.parse(fs.readFileSync(path.join(dir, 'ml-debug.json'), 'utf8'));
assert.deepEqual(dbg.rateLimit, { retries: 1, recovered: 1 }, 'diagnóstico conta a nova tentativa e a recuperação');

// 2) Limite persistente: depois de 3 novas tentativas o 429 sobe como antes (loja BLOCKED, ofertas não removidas).
reset();
calls = api(99);
await assert.rejects(search({ id: 'mercadolivre' }, catalog), (e) => e.blocked && e.status === 429, 'sobe o 429 original');
assert.equal(itemsCalls(calls), ML_RETRY_429_MS.length + 1, 'no máximo 1 + 3 tentativas');
assert.deepEqual(sleeps.filter((ms) => ms > ML_GAP_MS), ML_RETRY_429_MS, 'pausas de 2 s, 6 s e 15 s, nessa ordem');

// 3) Retry-After longo (> 30 s): não espera dentro da rodada; o backoff da loja (run.js) cuida.
reset();
calls = api(99, { 'retry-after': '120' });
await assert.rejects(search({ id: 'mercadolivre' }, catalog), (e) => e.status === 429 && e.retryAfter === 120);
assert.equal(itemsCalls(calls), 1, 'sem nova tentativa com Retry-After de 2 min');

// 4) Retry-After curto é respeitado no lugar da curva.
reset();
calls = api(1, { 'retry-after': '4' });
out = await search({ id: 'mercadolivre' }, catalog);
assert.equal(out.length, 1);
assert.ok(sleeps.includes(4000) && !sleeps.includes(ML_RETRY_429_MS[0]), 'espera o Retry-After (4 s), não a curva');

// 5) Outros erros não ganham nova tentativa (403 da busca segue indo para o catálogo; 401 sobe na hora).
reset();
http.setFetch(async (url) => (url.includes('/sites/MLB/search') ? j({ message: 'forbidden' }, 403) : j({ message: 'invalid_token' }, 401)));
await assert.rejects(search({ id: 'mercadolivre' }, catalog), (e) => e.blocked && e.status === 401);
assert.equal(sleeps.filter((ms) => ms > ML_GAP_MS).length, 0, 'nenhuma pausa de 429 para 401/403');

// 6) Sem 429 não há pausa nenhuma (ritmo de sempre); depois do primeiro 429, as chamadas seguintes ficam espaçadas.
reset();
api(0);
await search({ id: 'mercadolivre' }, catalog);
assert.equal(sleeps.length, 0, 'rodada sem 429 não espera');
assert.ok(ML_GAP_MS > 0 && ML_GAP_MS <= 1000, 'intervalo pós-429 configurado e curto');

console.log('✓ ML: 429 de rajada com nova tentativa curta, limite persistente ainda bloqueia');
