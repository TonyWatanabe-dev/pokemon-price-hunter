// Pista do ML que leva à página de catálogo (/p/MLB…) é conferida pelo anúncio vencedor (buy box) da API oficial;
// pista sem produto identificado no post é identificada pelo título oficial do anúncio.
import assert from 'node:assert/strict';
import { verificarPista, catalogoDeUrl, resolverLink, VERSAO } from '../src/pistas-ofertas.js';

const now = new Date('2026-10-16T12:00:00Z');
const PERMA = 'https://produto.mercadolivre.com.br/MLB-4012345678-etb';
const ITEM = { id: 'MLB4012345678', title: 'Pokémon TCG Caos Ascendente Treinador Avançado ETB Copag', price: 300, status: 'active', condition: 'new', available_quantity: 3, permalink: PERMA, seller_id: 1, official_store_id: 9, pictures: [] };
const catalog = { products: [], copag: {} };
const match = (l) => (/Caos Ascendente/.test(l.title) ? { productId: 'me04-etb', product: { id: 'me04-etb' }, confidence: 0.9 } : { productId: null });
const resp = (status, body, headers = {}) => ({ status, ok: status >= 200 && status < 300, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, json: async () => body, url: '' });
function fake({ buyBox = 'MLB4012345678', items = null, cat = 'https://www.mercadolivre.com.br/p/MLB19887654' } = {}) {
  const calls = [];
  const f = async (url) => { calls.push(url);
    if (url.startsWith('https://meli.la/')) return resp(301, null, { location: cat });
    if (url === cat) return resp(200, '<html>');
    if (url === 'https://api.mercadolibre.com/products/MLB19887654') return resp(200, buyBox ? { buy_box_winner: { item_id: buyBox } } : {});
    if (url.startsWith('https://api.mercadolibre.com/products/MLB19887654/items')) return resp(200, { results: items || [] });
    if (url.startsWith('https://api.mercadolibre.com/items/')) return resp(200, ITEM);
    if (url.startsWith('https://api.mercadolibre.com/users/')) return resp(200, { nickname: 'OFICIAL' });
    return resp(404, null); };
  f.calls = calls; return f;
}
const tip = { id: 't', productId: 'me04-etb', price: 310, url: 'https://meli.la/abc' };

assert.equal(catalogoDeUrl('https://www.mercadolivre.com.br/p/MLB-19887654?x=1'), 'MLB19887654');
assert.equal(catalogoDeUrl('https://produto.mercadolivre.com.br/MLB-1'), null);
assert.equal((await resolverLink('https://meli.la/abc', { fetch: fake() })).catalogo, 'MLB19887654');

let f = fake(); let r = await verificarPista(tip, { fetch: f, token: 'T', catalog, matchProduct: match, now });
assert.equal(r.ok, true, r.motivo); assert.equal(r.mlb, 'MLB4012345678'); assert.ok(f.calls.includes('https://api.mercadolibre.com/products/MLB19887654'));

f = fake({ buyBox: null, items: [{ item_id: 'MLB4012345678' }] }); r = await verificarPista(tip, { fetch: f, token: 'T', catalog, matchProduct: match, now });
assert.equal(r.ok, true, 'sem buy box: 1º anúncio do catálogo');

f = fake({ buyBox: null, items: [] }); r = await verificarPista(tip, { fetch: f, token: 'T', catalog, matchProduct: match, now });
assert.equal(r.motivo, 'link sem MLB');

r = await verificarPista({ ...tip, productId: null }, { fetch: fake(), token: 'T', catalog, matchProduct: match, now });
assert.equal(r.ok, true, 'sem produto no post: título oficial identifica'); assert.equal(r.productId, 'me04-etb');

r = await verificarPista({ ...tip, productId: null }, { fetch: fake(), token: 'T', catalog, matchProduct: () => ({ productId: null }), now });
assert.equal(r.motivo, 'produto não identificado');
assert.equal(VERSAO, 2);
console.log('pistas-ml-catalogo-tests: ok');
