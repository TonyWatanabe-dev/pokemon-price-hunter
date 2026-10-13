import assert from 'node:assert/strict';
import { storeFromHost } from '../src/tips.js';

const casos = [
  ['https://www.amazon.com.br/dp/B0', 'Amazon'],
  ['https://smile.amazon.com.br/x', 'Amazon'],
  ['https://amzn.to/abc', 'Amazon'],
  ['https://produto.mercadolivre.com.br/MLB-1', 'Mercado Livre'],
  ['https://meli.la/xyz', 'Mercado Livre'],
  ['https://shopee.com.br/p', 'Shopee'],
  ['https://www.magazineluiza.com.br/p', 'Magalu'],
  ['https://notamazon.com.br/x', 'notamazon.com.br'],
  ['https://amazon.com.br.evil.com/x', 'amazon.com.br.evil.com'],
  ['https://lojaqualquer.com.br/x', 'lojaqualquer.com.br'],
];
for (const [url, esperado] of casos) assert.equal(storeFromHost(url), esperado, url);
assert.equal(storeFromHost('não é url'), null);
console.log('tips-store-host-tests ok');
