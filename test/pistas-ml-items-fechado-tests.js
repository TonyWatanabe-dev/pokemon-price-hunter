// /items fechado para anúncios de terceiros (403 access_denied por anúncio): a pista é conferida pela lista oficial de
// vendedores do catálogo (/products/{id}/items), pela página /p/ do link ou pelas páginas do mesmo produto em ml-catalog.json.
import assert from 'node:assert/strict';
import { verificarPista, verificarPistas } from '../src/pistas-ofertas.js';

const now = new Date('2026-11-25T12:00:00Z');
const API = 'https://api.mercadolibre.com';
const catalog = { products: [], copag: {} };
const match = (l) => (/Megaevolução/.test(l.title) ? { productId: 'me06-box36', product: { id: 'me06-box36' }, confidence: 0.9 } : { productId: null });
const resp = (status, body, headers = {}) => ({ status, ok: status >= 200 && status < 300, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, json: async () => body, url: '' });
const LISTA = [
  { item_id: 'MLB4111111111', price: 500, condition: 'new', seller_id: 7, official_store_id: null, shipping: { free_shipping: true } },
  { item_id: 'MLB4222222222', price: 480, condition: 'new', seller_id: 8, official_store_id: 3, shipping: {} },
];
const catalogoML = { MLB19000000: { name: 'Pokémon TCG Megaevolução Caixa 36 Boosters Copag', productId: 'me06-box36', image: 'http://img/x.jpg' }, MLB19000001: { name: 'Outro', productId: 'outro' } };

function fake({ link = 'https://produto.mercadolivre.com.br/MLB-4111111111-box', lista = LISTA } = {}) {
  const calls = [];
  const f = async (url) => { calls.push(url);
    if (url.startsWith('https://meli.la/')) return resp(301, null, { location: link });
    if (url === link) return resp(200, '<html>');
    if (url.startsWith(`${API}/items/`)) return resp(403, { message: 'Access to the requested resource is forbidden', error: 'access_denied', status: 403 });
    if (url === `${API}/products/MLB19000000/items` || url === `${API}/products/MLB17770000/items`) return resp(200, { results: lista });
    if (url === `${API}/products/MLB17770000`) return resp(200, { name: 'Pokémon TCG Megaevolução Caixa 36 Boosters', buy_box_winner: { item_id: 'MLB4222222222' } });
    if (url.startsWith(`${API}/users/`)) return resp(200, { nickname: 'LOJA', seller_reputation: { level_id: '5_green', transactions: { completed: 5000 } } });
    return resp(404, null); };
  f.calls = calls; return f;
}
const tip = { id: 't1', productId: 'me06-box36', price: 520, url: 'https://meli.la/abc' };

// Link de anúncio comum: acha o MLB na página de catálogo do mesmo produto (ml-catalog.json).
let f = fake();
let r = await verificarPista(tip, { fetch: f, token: 'T', catalog, matchProduct: match, now, catalogoML });
assert.equal(r.ok, true, r.motivo);
assert.equal(r.mlb, 'MLB4111111111');
assert.equal(r.oferta.price.base, 500);
assert.equal(r.oferta.shipping, 0);
assert.equal(r.oferta.stock, 'IN_STOCK');
assert.equal(r.oferta.stockSource, 'ml-catalog-listed');
assert.match(r.oferta.url, /\/p\/MLB19000000\?pdp_filters=item_id%3AMLB4111111111$/);
assert.equal(r.oferta.image, 'https://img/x.jpg');
assert.ok(!f.calls.includes(`${API}/products/MLB19000001/items`), 'só páginas do mesmo produto');

// Link para a página /p/ do catálogo: usa essa página, e o nome vem de /products/{id}.
f = fake({ link: 'https://www.mercadolivre.com.br/p/MLB17770000' });
r = await verificarPista(tip, { fetch: f, token: 'T', catalog, matchProduct: match, now });
assert.equal(r.ok, true, r.motivo);
assert.equal(r.mlb, 'MLB4222222222');
assert.equal(r.oferta.sellerKind, 'official_store');

// MLB fora das listas do catálogo: continua como antes (recusa não definitiva, volta a ser conferida).
r = await verificarPista(tip, { fetch: fake({ lista: [] }), token: 'T', catalog, matchProduct: match, now, catalogoML });
assert.equal(r.ok, false); assert.equal(r.motivo, 'API do ML recusou (403)');

// Sem cache do catálogo e link sem /p/: nada a consultar.
r = await verificarPista(tip, { fetch: fake(), token: 'T', catalog, matchProduct: match, now });
assert.equal(r.motivo, 'API do ML recusou (403)');

// Preço da lista do catálogo acima da tolerância: a promoção acabou.
r = await verificarPista({ ...tip, price: 300 }, { fetch: fake(), token: 'T', catalog, matchProduct: match, now, catalogoML });
assert.match(r.motivo, /^preço subiu/);

// verificarPistas repassa o cache do catálogo.
const store = { t1: { ...tip, discount: 10 } };
const ok = await verificarPistas(store, { fetch: fake(), token: 'T', catalog, matchProduct: match, now, catalogoML });
assert.equal(ok.length, 1); assert.equal(store.t1.verificada.ok, true);

console.log('pistas-ml-items-fechado-tests: ok');
