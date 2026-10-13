// JSON-LD: só BRL (ou sem moeda) vira preço; inventoryLevel inválido mantém o anúncio com quantity null.
import assert from 'node:assert/strict';
import { parseProductPage } from '../src/adapters/jsonld.js';

const NAME = 'Pokémon Booster Box Caos Ascendente 36 boosters Copag';
const page = (offer) => `<html><head><title>${NAME}</title><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', name: NAME, offers: { '@type': 'Offer', price: 359.9, availability: 'https://schema.org/InStock', ...offer } })}</script></head><body><h1>${NAME}</h1><p>R$ 359,90</p>${'x'.repeat(2000)}</body></html>`;
const parse = (offer) => parseProductPage(page(offer), 'https://ld.test/produto');

assert.equal(parse({ priceCurrency: 'USD' }), null, 'USD não publica');
assert.equal(parse({ priceCurrency: 'BRL' })?.price.base, 359.9, 'BRL publica');
assert.equal(parse({})?.price.base, 359.9, 'sem moeda segue igual');
assert.equal(parse({ priceCurrency: 'BRL', inventoryLevel: { value: 'abc' } })?.quantity, null, 'abc -> null');
const neg = parse({ priceCurrency: 'BRL', inventoryLevel: { value: -1 } });
assert.ok(neg && neg.quantity === null, '-1 mantém anúncio com quantity null');
assert.equal(parse({ priceCurrency: 'BRL', inventoryLevel: { value: 5 } })?.quantity, 5);
console.log('jsonld-moeda-quantidade-tests ok');
