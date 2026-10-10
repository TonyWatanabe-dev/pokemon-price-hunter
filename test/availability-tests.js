// Pré-venda e disponibilidade futura: não vira restock nem estoque imediato; data só quando a loja informa.
import assert from 'node:assert/strict';
import { isRestock, isLaunch, releaseDateOf, availableFromOf } from '../src/availability.js';
import { parseProductPage } from '../src/adapters/jsonld.js';
import { stockOf } from '../src/core/mappers.js';

let n = 0;
function t(name, fn) { try { fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } }

t('esgotado -> estoque é restock', () => { assert.equal(isRestock('OUT_OF_STOCK', 'IN_STOCK'), true); });
t('pré-venda -> estoque não é restock, é lançamento', () => { assert.equal(isRestock('PRE_ORDER', 'IN_STOCK'), false); assert.equal(isLaunch('PRE_ORDER', 'IN_STOCK'), true); });
t('estoque -> pré-venda e estoque -> estoque não são restock', () => { assert.equal(isRestock('IN_STOCK', 'PRE_ORDER'), false); assert.equal(isRestock('IN_STOCK', 'IN_STOCK'), false); });
t('oferta nova (sem leitura anterior) não é restock', () => { assert.equal(isRestock(undefined, 'IN_STOCK'), false); });
t('pré-venda -> esgotado não é restock', () => { assert.equal(isRestock('PRE_ORDER', 'OUT_OF_STOCK'), false); });

t('data prevista: só data completa e válida', () => {
  assert.equal(releaseDateOf('2026-11-20'), '2026-11-20');
  assert.equal(releaseDateOf('2026-11-20T00:00:00-03:00'), '2026-11-20');
  for (const bad of [undefined, null, '', 'novembro', '2026-11', '2026-02-30', '2026-13-01', 'em breve']) assert.equal(releaseDateOf(bad), null);
});
t('data ausente em pré-venda fica nula (nunca inferida)', () => { assert.equal(availableFromOf('PRE_ORDER', undefined), null); });
t('payload contraditório: data com estoque/esgotado é descartada', () => {
  assert.equal(availableFromOf('IN_STOCK', '2026-11-20'), null);
  assert.equal(availableFromOf('OUT_OF_STOCK', '2026-11-20'), null);
});

const page = (avail, extra = '') => `<html><head><title>Box Pokémon Teste</title></head><body><script type="application/ld+json">${JSON.stringify({
  '@type': 'Product', name: 'Box Pokémon Teste', url: 'https://loja.com.br/box-pokemon-teste',
  offers: { '@type': 'Offer', price: '299.90', priceCurrency: 'BRL', availability: 'https://schema.org/' + avail, ...(extra ? JSON.parse(extra) : {}) },
})}</script><p>R$ 299,90</p></body></html>`;
const parse = (avail, extra) => parseProductPage(page(avail, extra), 'https://loja.com.br/box-pokemon-teste');

t('JSON-LD PreOrder com availabilityStarts preserva a data', () => {
  const r = parse('PreOrder', '{"availabilityStarts":"2026-11-20"}');
  assert.equal(r.stock, 'PRE_ORDER'); assert.equal(r.availableFrom, '2026-11-20');
});
t('JSON-LD PreOrder sem data: pré-venda com data nula', () => {
  const r = parse('PreOrder'); assert.equal(r.stock, 'PRE_ORDER'); assert.equal(r.availableFrom, null);
});
t('JSON-LD InStock com availabilityStarts: data descartada', () => {
  const r = parse('InStock', '{"availabilityStarts":"2026-11-20"}'); assert.equal(r.stock, 'IN_STOCK'); assert.equal(r.availableFrom, null);
});
t('JSON-LD Discontinued é indisponível, não pré-venda nem estoque', () => { assert.equal(parse('Discontinued').stock, 'UNAVAILABLE'); });

t('esquema atual: pré-venda tem valor próprio; indisponível cai em unknown', () => {
  assert.equal(stockOf('PRE_ORDER'), 'preorder'); assert.equal(stockOf('UNAVAILABLE'), 'unknown'); assert.equal(stockOf(undefined), 'unknown');
});

console.log(`availability-tests: ${n} ok`);
