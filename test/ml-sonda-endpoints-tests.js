// Sonda de endpoints do ML: só códigos HTTP, sem rede (fetch mockado).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.HUNTER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-sonda-ep-'));
process.env.ML_CLIENT_ID = '123';
process.env.ML_CLIENT_SECRET = 'segredo-de-teste';
process.env.HUNTER_DOMAIN_DELAY_MS = '0';
const { probe, endpointsLine } = await import('../src/mlauth.js');
const http = await import('../src/http.js');
const json = (status, body) => new Response(JSON.stringify(body), { status });
const policy = { message: 'At least one policy returned UNAUTHORIZED.', status: 403, blocked_by: 'PolicyAgent' };

// tudo 200, com buy box
http.setFetch(async (url) => {
  if (url.includes('/users/me')) return json(200, { id: 9 });
  if (url.includes('/products/search')) return json(200, { results: [{ id: 'MLB123' }] });
  if (/\/products\/MLB123\/items/.test(url)) return json(200, { results: [] });
  if (/\/products\/MLB123/.test(url)) return json(200, { id: 'MLB123', buy_box_winner: { price: 99.9 } });
  if (url.includes('/items?ids=')) return json(200, [{ code: 200, body: {} }]);
  return json(200, {});
});
let p = await probe('AT', { mlb: 'MLB555' });
assert.equal(p.ok, true); assert.equal(p.reason, null);
assert.deepEqual(p.endpoints.produto, { status: 200, policy: false, buyBox: true });
assert.equal(p.endpoints.produtoItems.status, 200);
assert.equal(p.endpoints.item.status, 200);
assert.equal(p.endpoints.itemsMulti.code, 200);
assert.equal(p.endpoints.siteSearch.status, 200);
let line = endpointsLine(p.endpoints);
assert.match(line, /^Sonda de endpoints: produto=200 \(buyBox sim\) · produto\/items=200/);
assert.ok(!line.includes('99') && !line.includes('AT'.repeat(3)), 'sem preço nem token');
assert.ok(!JSON.stringify(p).includes('99.9'), 'preço nunca sai da sonda');

// produto/items e item barrados por PolicyAgent; multiget 200 com code 403 por item
http.setFetch(async (url) => {
  if (url.includes('/users/me')) return json(200, { id: 9 });
  if (url.includes('/products/search')) return json(200, { results: [{ id: 'MLB123' }] });
  if (/\/products\/MLB123\/items/.test(url)) return json(403, policy);
  if (/\/products\/MLB123/.test(url)) return json(200, { id: 'MLB123' });
  if (url.includes('/items?ids=')) return json(200, [{ code: 403, body: policy }]);
  if (/\/items\/MLB/.test(url)) return json(403, policy);
  return json(200, {});
});
p = await probe('AT', { mlb: 'MLB555' });
assert.equal(p.ok, true, 'ok mantém o significado');
assert.deepEqual(p.endpoints.produto, { status: 200, policy: false, buyBox: false });
assert.deepEqual(p.endpoints.produtoItems, { status: 403, policy: true });
assert.deepEqual(p.endpoints.item, { status: 403, policy: true });
assert.equal(p.endpoints.itemsMulti.status, 200); assert.equal(p.endpoints.itemsMulti.code, 403);
line = endpointsLine(p.endpoints);
assert.match(line, /produto\/items=403 PolicyAgent/); assert.match(line, /item=403 PolicyAgent/);

// busca sem resultados: produto e produto/items ficam null; as demais seguem
http.setFetch(async (url) => (url.includes('/users/me') ? json(200, { id: 9 }) : url.includes('/products/search') ? json(200, { results: [] }) : json(200, {})));
p = await probe('AT', { mlb: 'MLB555' });
assert.equal(p.ok, true);
assert.equal(p.endpoints.produto, null); assert.equal(p.endpoints.produtoItems, null);
assert.equal(p.endpoints.siteSearch.status, 200);
assert.match(endpointsLine(p.endpoints), /produto=n\/d · produto\/items=n\/d/);

// conta recusada: sem endpoints
http.setFetch(async () => json(403, policy));
p = await probe('AT', { mlb: 'MLB555' });
assert.equal(p.ok, false); assert.equal(p.endpoints, undefined); assert.equal(endpointsLine(p.endpoints), null);
console.log('ml-sonda-endpoints: ok');
