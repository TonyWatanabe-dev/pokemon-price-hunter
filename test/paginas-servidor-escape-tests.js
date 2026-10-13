// api/pagina.mjs: substituição literal (storeName/seller com $&, $`, $', $$) e slug malformado (404 + noindex). Sem rede.
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOW = Date.parse('2026-10-12T18:00:00.000Z');
const T = new Date(NOW - 5 * 6e4).toISOString();
const NOMES = ["$& $` $' $$ Loja", "$&", "$$"];
const offers = NOMES.map((nm, i) => ({ id: 'o' + i, productId: 'p1', storeId: 's' + i, storeName: nm, seller: nm, title: 'x', url: 'https://x.com.br/' + i,
  price: 100 + i, priceKind: 'base', shipping: 0, shippingKnown: true, total: 100 + i, stock: 'IN_STOCK', confirmed: true, anomalous: false, stale: false,
  discount: 0.1, matchConfidence: 0.95, firstSeen: T, source_timestamp: T }));
const state = { generatedAt: T, coverage: { found: 3 }, totals: { offers: 3 },
  products: [{ id: 'p1', collection: 'c1', collectionName: 'Alfa', type: 'etb', typeLabel: 'ETB', group: 'ETB', boosters: null, copagConfirmed: true, msrp: 400, offerCount: 3 },
    { id: 'p2', collection: 'c1', collectionName: 'Alfa', type: 'etb', typeLabel: 'ETB', group: 'ETB', boosters: null, copagConfirmed: false, msrp: null, offerCount: 0, name: 'Pokémon Ação' }],
  offers, collections: [{ id: 'c1', name: 'Alfa', series: 'S', aliases: [], products: 2 }], types: [{ id: 'etb', label: 'ETB', group: 'ETB', products: 2 }],
  sources: [], activity: [], tips: [], bestDeals: [] };

const queries = ['t=produto&slug=p1', 't=produto&slug=%25', 't=produto&slug=100%25', 't=oportunidades', 't=home'];
const script = `import { setFreshnessClock } from ${JSON.stringify(pathToFileURL(path.join(root, 'api/_lib/freshness.mjs')).href)};
  setFreshnessClock(() => ${NOW}); const st = JSON.parse(process.argv[1]);
  globalThis.fetch = async () => new Response(JSON.stringify(st), { status: 200 });
  const { default: h } = await import(${JSON.stringify(pathToFileURL(path.join(root, 'api/pagina.mjs')).href)});
  const out = {};
  for (const q of JSON.parse(process.argv[2])) {
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
    await h({ url: '/api/pagina?' + q, headers: { host: 'x' } }, res);
    out[q] = { status: res.statusCode, body: res.body };
  }
  console.log(JSON.stringify(out));`;
const r = spawnSync(process.execPath, ['--input-type=module', '-e', script, JSON.stringify(state), JSON.stringify(queries)],
  { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, API_DATABASE_URL: '' } });
if (r.status !== 0) throw new Error('falha ao renderizar: ' + r.stderr);
const out = JSON.parse(r.stdout.trim().split('\n').pop());

const count = (s, re) => (s.match(re) || []).length;
for (const q of ['t=produto&slug=p1', 't=oportunidades', 't=home']) {
  const b = out[q].body;
  assert.equal(count(b, /<!doctype/gi), 1, q + ': um só doctype');
  assert.equal(count(b, /<div id="view">/g), 1, q + ': um só #view');
  assert.equal(out[q].status, 200);
}
assert.ok(out['t=produto&slug=p1'].body.includes('$&amp;') || out['t=produto&slug=p1'].body.includes('$&'), 'nome literal presente');
for (const q of ['t=produto&slug=%25', 't=produto&slug=100%25']) {
  assert.equal(out[q].status, 404, q);
  assert.match(out[q].body, /<meta name="robots" content="noindex">/);
}
console.log('✓ páginas do servidor: substituição literal e slug malformado');
