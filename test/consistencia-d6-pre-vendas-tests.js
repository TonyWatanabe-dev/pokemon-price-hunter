// E6-E / D6 (auditoria T4-E): o SSR de /pre-vendas (api/pagina.mjs) lista UMA pré-venda por produto — a mesma que o app
// mostra (/api/v1/site/pagina/prevenda → api/_lib/site.mjs sitePre: menor total; empate, a primeira do estado).
// Antes, o SSR listava cada anúncio: o mesmo produto aparecia duas vezes (ex.: "Amigos de Jornada · Blister Quádruplo"
// repetido) enquanto o app mostrava um cartão. Handler real com fetch falso do state.json; sem rede e sem banco.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
delete process.env.DATABASE_URL; delete process.env.API_DATABASE_URL;
let n = 0; const t = (nome, fn) => { try { fn(); n++; } catch (e) { e.message = `${nome}: ${e.message}`; throw e; } };
const T0 = '2026-10-25T12:00:00.000Z';
const prod = (id, typeLabel) => ({ id, collection: 'alfa', collectionName: 'Alfa', type: id, typeLabel, group: typeLabel, copagConfirmed: false, msrp: null, offerCount: 1 });
const pre = (id, productId, price, storeName) => ({ id, productId, storeId: storeName, storeName, url: 'https://loja.example/' + id, price, priceKind: 'pix', shipping: null, shippingKnown: false,
  total: price, stock: 'PRE_ORDER', stale: false, anomalous: false, confirmed: true, source_timestamp: T0 });
const st = { dataAt: T0, generatedAt: T0, collections: [{ id: 'alfa', name: 'Alfa' }], types: [], products: [prod('alfa-b4', 'Blister Quádruplo'), prod('alfa-etb', 'ETB'), prod('alfa-bb', 'Booster Box')],
  offers: [pre('x1', 'alfa-b4', 47.53, 'madlabrpg.com'), pre('x2', 'alfa-b4', 47.53, 'madlabrpg.com'), pre('x3', 'alfa-b4', 49.9, 'outra.com'), pre('y1', 'alfa-etb', 399.9, 'loja.com'),
    { ...pre('z1', 'alfa-bb', 900, 'loja.com'), stock: 'IN_STOCK' }] };
const FR = await import(pathToFileURL(path.join(root, 'api/_lib/freshness.mjs')).href);
FR.setFreshnessClock(() => Date.parse(T0) + 5 * 60e3);
globalThis.fetch = async (u) => { if (/state\.json/.test(String(u))) return new Response(JSON.stringify(st), { status: 200 }); throw new Error('rede bloqueada: ' + u); };
const { default: pagina } = await import(pathToFileURL(path.join(root, 'api/pagina.mjs')).href);
const { sitePre } = await import(pathToFileURL(path.join(root, 'api/_lib/site.mjs')).href);
const res = { statusCode: 200, h: {}, setHeader(k, v) { this.h[k] = v; }, getHeader(k) { return this.h[k]; }, end(b) { this.body = String(b ?? ''); } };
await pagina({ url: '/api/pagina?t=pre-vendas', headers: { host: 'tcgpricehunter.com.br' } }, res);
const ssr = (res.body.split('<div class="ssr">')[1] || '').split('</main>')[0];
const linhas = [...ssr.matchAll(/<li><a href="\/produto\/([^"]+)">[\s\S]*?<\/li>/g)].map((m) => ({ slug: m[1], txt: m[0].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ') }));
t('SSR montado com a lista', () => { assert.equal(res.statusCode, 200); assert.ok(linhas.length > 0, 'lista vazia'); });
t('uma linha por produto em pré-venda', () => {
  assert.equal(linhas.length, new Set(linhas.map((l) => l.slug)).size, linhas.map((l) => l.slug).join(','));
  assert.equal(linhas.length, 2);
});
t('mesma oferta (preço e loja) que o app recebe de sitePre', () => {
  const app = sitePre(st).offers;
  assert.equal(app.length, linhas.length);
  for (const o of app) {
    const brl = 'R$ ' + o.total.toFixed(2).replace('.', ',');
    assert.ok(linhas.some((l) => l.txt.includes(brl) && l.txt.includes(o.storeName)), `${o.productId}: ${brl} em ${o.storeName} fora do SSR`);
  }
});
FR.setFreshnessClock(null);
console.log(`consistencia-d6-pre-vendas: ${n} verificações ok`);
