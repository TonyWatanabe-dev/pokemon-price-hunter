// Deduplicação de ofertas e canonicalização de URLs. Testes puros.
import assert from 'node:assert/strict';
import { canonicalizeUrl, offerDedupeKey, groupDuplicateOffers } from '../src/core/offer-key.js';

let n = 0; const t = (name, fn) => { fn(); n++; };

t('tracking removido, original preservado', () => {
  const u = 'https://www.Loja.com.br/p/caixa/?utm_source=x&gclid=1&fbclid=2#topo';
  const c = canonicalizeUrl(u);
  assert.equal(c.original, u); assert.equal(c.canonical, 'https://loja.com.br/p/caixa'); assert.deepEqual(c.removed, ['utm_source', 'gclid', 'fbclid']);
});

t('query relevante mantida e ordenada', () => {
  assert.equal(canonicalizeUrl('https://loja.com.br/p?variant=22&color=azul').canonical, 'https://loja.com.br/p?color=azul&variant=22');
  assert.notEqual(canonicalizeUrl('https://loja.com.br/p?variant=22').canonical, canonicalizeUrl('https://loja.com.br/p?variant=23').canonical);
  assert.equal(canonicalizeUrl('https://loja.com.br/p?skuId=9&utm_medium=a').canonical, 'https://loja.com.br/p?skuId=9');
});

t('barras, porta padrão e caixa do host', () => {
  assert.equal(canonicalizeUrl('HTTP://Loja.com.br:80//p//x///').canonical, 'https://loja.com.br/p/x');
  assert.equal(canonicalizeUrl('https://loja.com.br:8443/p').canonical, 'https://loja.com.br:8443/p');
});

t('URLs inválidas', () => {
  for (const bad of ['', null, undefined, 'não é url', '/p/caixa', 'javascript:alert(1)', 'ftp://x.com/a']) {
    const c = canonicalizeUrl(bad); assert.equal(c.valid, false); assert.equal(c.canonical, null);
  }
  assert.equal(canonicalizeUrl('não é url').original, 'não é url');
});

t('chave: mesma oferta com tracking diferente colapsa', () => {
  const a = offerDedupeKey({ storeId: 'a', url: 'https://a.com/p?utm_source=1' });
  const b = offerDedupeKey({ storeId: 'a', url: 'https://www.a.com/p/?gclid=2' });
  assert.equal(a.key, b.key); assert.equal(a.basis, 'url'); assert.ok(a.reason);
});

t('chave: variantes, lojas e vendedores distintos não colapsam', () => {
  const k = (o) => offerDedupeKey(o).key;
  assert.notEqual(k({ storeId: 'a', url: 'https://a.com/p?variant=1' }), k({ storeId: 'a', url: 'https://a.com/p?variant=2' }));
  assert.notEqual(k({ storeId: 'a', url: 'https://a.com/p', sku: 'X1' }), k({ storeId: 'a', url: 'https://a.com/p', sku: 'X2' }));
  assert.notEqual(k({ storeId: 'a', url: 'https://a.com/p' }), k({ storeId: 'b', url: 'https://a.com/p' }));
  assert.notEqual(k({ storeId: 'ml', sellerId: '1', url: 'https://ml.com/p' }), k({ storeId: 'ml', sellerId: '2', url: 'https://ml.com/p' }));
});

t('chave: SKU iguais colapsam mesmo com URLs diferentes; URL inválida sem SKU não agrupa', () => {
  assert.equal(offerDedupeKey({ storeId: 'a', sku: ' ABC ', url: 'https://a.com/x' }).key, offerDedupeKey({ storeId: 'a', sku: 'abc', url: 'https://a.com/y' }).key);
  const bad = offerDedupeKey({ storeId: 'a', url: 'lixo' }); assert.equal(bad.key, null); assert.equal(bad.basis, 'none');
  assert.equal(offerDedupeKey({ url: 'https://a.com/p' }).key, null);
  assert.equal(offerDedupeKey(null).key, null);
});

t('agrupamento', () => {
  const offers = [
    { id: 1, storeId: 'a', url: 'https://a.com/p?utm_source=x' }, { id: 2, storeId: 'a', url: 'https://a.com/p' },
    { id: 3, storeId: 'a', url: 'https://a.com/p?variant=2' }, { id: 4, storeId: 'a', url: 'lixo' }, { id: 5, storeId: 'a', url: 'lixo' },
  ];
  const g = groupDuplicateOffers(offers);
  assert.equal(g.groups.length, 2); assert.equal(g.duplicates.length, 1); assert.deepEqual(g.duplicates[0].offers.map((o) => o.id), [1, 2]);
  assert.deepEqual(g.ungrouped.map((o) => o.id), [4, 5]);
});

console.log(`✓ Chave de deduplicação e URL canônica: ${n} grupos de testes passaram`);
