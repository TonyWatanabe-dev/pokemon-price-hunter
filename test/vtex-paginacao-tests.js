// VTEX: paginação além de 50 itens, com fetch simulado (nenhuma requisição real).
import assert from 'node:assert/strict';
process.env.HUNTER_DOMAIN_DELAY_MS = '0';
const http = await import('../src/http.js');
const vtex = await import('../src/adapters/vtex.js');

const prod = (i) => ({ productName: `Carta ${i}`, linkText: `carta-${i}`, items: [{ itemId: String(i), name: 'x', sellers: [{ sellerId: '1', sellerName: 'Loja', sellerDefault: true, commertialOffer: { Price: 10, AvailableQuantity: 3 } }] }] });
const serve = (total) => async (url) => {
  const u = new URL(url);
  if (u.pathname === '/robots.txt') return new Response('', { status: 404 });
  const from = Number(u.searchParams.get('_from')), to = Number(u.searchParams.get('_to'));
  const arr = []; for (let i = from; i <= to && i < total; i++) arr.push(prod(i));
  return new Response(JSON.stringify(arr), { status: 200, headers: { 'content-type': 'application/json' } });
};
const catalog = { collections: [] };

http.setFetch(serve(120));
const r = await vtex.search({ id: 'v1', url: 'https://pag120.example/' }, catalog);
assert.equal(r.length, 120);
assert.equal(r.partial, undefined);

http.setFetch(serve(100000));
const p = await vtex.search({ id: 'v2', url: 'https://pagteto.example/' }, catalog);
assert.equal(p.length, 500);
assert.match(p.partial, /teto de 10 páginas/);
console.log('vtex-paginacao-tests ok');
