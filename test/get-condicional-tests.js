// GET condicional nas páginas JSON-LD: 304 reaproveita o anúncio anterior; 200 sem validador lê normal e limpa o cache.
import assert from 'node:assert/strict';
import fs from 'node:fs';
process.env.HUNTER_DOMAIN_DELAY_MS = '0';
const http = await import('../src/http.js');
const jsonld = await import('../src/adapters/jsonld.js');

const pagina = (preco) => `<html><head><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', name: 'Pokémon TCG Blister Triplo Caos Ascendente', sku: 'B3',
  offers: { '@type': 'Offer', price: preco, priceCurrency: 'BRL', availability: 'https://schema.org/InStock' } })}</script></head><body><h1>Pokémon TCG Blister Triplo Caos Ascendente</h1><p>R$ ${preco.replace('.', ',')}</p></body></html>`;
let modo = 'ok'; const vistos = [];
http.setFetch(async (url, init) => {
  const u = new URL(url);
  if (u.pathname === '/robots.txt') return new Response('', { status: 404 });
  vistos.push({ url, h: init?.headers || {} });
  if (modo === 'ok') return new Response(pagina('49.90'), { status: 200, headers: { 'content-type': 'text/html', etag: '"v1"', 'last-modified': 'Fri, 16 Oct 2026 10:00:00 GMT' } });
  if (modo === '304') return new Response(null, { status: 304 });
  return new Response(pagina('39.90'), { status: 200, headers: { 'content-type': 'text/html' } });
});
const U = 'https://cond.test/produtos/blister-triplo-pokemon';
const store = { id: 'cond', url: 'https://cond.test', plannedUrls: [U], cond: {} };

let r = await jsonld.search(store);
assert.equal(r.length, 1); assert.equal(store.cond[U].etag, '"v1"'); assert.ok(store.cond[U].listing, 'guarda o anúncio com o validador');
assert.equal(vistos[0].h['if-none-match'], undefined, '1ª leitura sem condicional');
modo = '304'; r = await jsonld.search(store);
assert.equal(vistos.at(-1).h['if-none-match'], '"v1"'); assert.equal(vistos.at(-1).h['if-modified-since'], 'Fri, 16 Oct 2026 10:00:00 GMT');
assert.equal(r.length, 1, '304: anúncio anterior'); assert.equal(r.notModified, 1); assert.deepEqual(r[0].price, store.cond[U].listing.price);
modo = 'sem-validador'; r = await jsonld.search(store);
assert.equal(r[0].price.base, 39.9, 'mudou: lê de novo'); assert.equal(store.cond[U], undefined, 'sem validador: sai do cache');
const s2 = { id: 'x', url: 'https://cond.test', plannedUrls: [U] }; modo = 'ok'; r = await jsonld.search(s2); assert.equal(r.length, 1, 'sem store.cond: leitura normal');
const run = fs.readFileSync(new URL('../src/run.js', import.meta.url), 'utf8');
assert.match(run, /store = \{ \.\.\.store, plannedUrls: planned, cond: cache\.cond[,}]/);
console.log('get-condicional-tests: ok');
