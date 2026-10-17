// Adaptador WooCommerce (Store API pública): preço em unidades mínimas, estoque, contrato do anúncio e registro.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { preco, toListing, detect, search, TERMS } from '../src/adapters/woocommerce.js';
import { adapters } from '../src/adapters/index.js';
import { validateListing } from '../src/adapters/contract.js';

const P = { id: 9, name: 'Pokémon TCG &#8211; Treinador Avançado Caos Ascendente', permalink: 'https://loja.exemplo.com.br/produto/etb-caos/', sku: 'ETB-ME04',
  prices: { price: '34990', regular_price: '39990', currency_code: 'BRL', currency_minor_unit: 2 }, is_in_stock: true, images: [{ src: 'https://loja.exemplo.com.br/etb.jpg' }] };
assert.equal(preco(P), 349.9); assert.equal(preco(P, 'regular_price'), 399.9);
assert.equal(preco({ prices: { price: '' } }), null); assert.equal(preco({ prices: { price: '12,90' } }), null); assert.equal(preco({ prices: { price: '0' } }), null);
assert.equal(preco({ prices: { price: '1290', currency_minor_unit: 0 } }), 1290);
const l = toListing(P);
assert.equal(l.title, 'Pokémon TCG - Treinador Avançado Caos Ascendente'); assert.equal(l.price.base, 349.9); assert.equal(l.listPrice, 399.9);
assert.equal(l.stock, 'IN_STOCK'); assert.equal(l.sourceType, 'store_api'); assert.equal(l.image, 'https://loja.exemplo.com.br/etb.jpg');
assert.equal(toListing({ ...P, is_in_stock: false }).stock, 'OUT_OF_STOCK');
assert.equal(toListing({ ...P, permalink: 'javascript:alert(1)' }), null); assert.equal(toListing({ ...P, name: '' }), null);
assert.equal(toListing({ ...P, prices: { ...P.prices, currency_code: 'USD' } }), null);
assert.equal(toListing({ ...P, prices: { ...P.prices, regular_price: '34990' } }).listPrice, null);
const store = { id: 'lojaexemplo', name: 'Loja', url: 'https://loja.exemplo.com.br', platform: 'woocommerce' };
assert.ok(validateListing(l, store, { now: new Date() }).ok, 'cumpre o contrato do anúncio');
assert.equal(typeof adapters.woocommerce.search, 'function'); assert.equal(typeof detect, 'function'); assert.equal(typeof search, 'function');
assert.deepEqual([...TERMS], ['pokemon', 'copag']);
const idx = fs.readFileSync(new URL('../src/adapters/index.js', import.meta.url), 'utf8');
assert.ok(idx.indexOf("'vtex'") < idx.indexOf("'woocommerce'") && idx.indexOf("'woocommerce'") < idx.indexOf("'jsonld'"), 'detecção: Woo antes do JSON-LD genérico');
const src = fs.readFileSync(new URL('../src/adapters/woocommerce.js', import.meta.url), 'utf8');
assert.match(src, /await guard\(url\)/, 'respeita robots.txt');
console.log('adaptador-woocommerce-tests: ok');
