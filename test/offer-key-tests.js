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

t('chave: mesmo SKU não junta URLs canônicas nem produtos diferentes', () => {
  const k = (o) => offerDedupeKey(o).key;
  // mesmo SKU, URLs canônicas diferentes: não agrupa (SKU só separa variantes na mesma URL)
  assert.notEqual(k({ storeId: 'a', sku: ' ABC ', url: 'https://a.com/x' }), k({ storeId: 'a', sku: 'abc', url: 'https://a.com/y' }));
  // mesmo SKU e mesma URL, produtos diferentes: não agrupa
  assert.notEqual(k({ storeId: 'a', productId: 'p1', sku: 'ABC', url: 'https://a.com/x' }), k({ storeId: 'a', productId: 'p2', sku: 'ABC', url: 'https://a.com/x' }));
  // mesmo SKU sem URL válida, produtos diferentes: não agrupa
  assert.notEqual(k({ storeId: 'a', productId: 'p1', sku: 'ABC', url: 'lixo' }), k({ storeId: 'a', productId: 'p2', sku: 'ABC', url: 'lixo' }));
});

t('chave: mesmo produto, mesmo SKU e mesma URL canônica agrupa (inclusive só com tracking diferente)', () => {
  const a = offerDedupeKey({ storeId: 'a', productId: 'p1', sku: ' ABC ', url: 'https://www.a.com/x/?utm_source=1#topo' });
  const b = offerDedupeKey({ storeId: 'a', productId: 'P1', sku: 'abc', url: 'https://a.com/x?gclid=2' });
  assert.equal(a.key, b.key); assert.ok(a.reason);
  const c = offerDedupeKey({ storeId: 'a', productId: 'p1', url: 'https://a.com/p?utm_source=1&fbclid=3' });
  const d = offerDedupeKey({ storeId: 'a', productId: 'p1', url: 'https://www.a.com/p/?gclid=2' });
  assert.equal(c.key, d.key); assert.equal(c.basis, 'url');
});

t('chave: casos reais da ludostation (origin/data, data/offers.json) não juntam produtos diferentes', () => {
  // mesmo SKU reaproveitado pela loja em anúncios de produtos diferentes
  const real = [
    { id: '1873d050ef24', productId: 'me03-blister3', storeId: 'ludostation', sellerId: null, sku: 'PKM146', url: 'https://ludostation.com.br/produtos/blister-triplo-equilibrio-perfeito-mega-evolucao-pokemon-tcg-pre-venda-qnk9t/' },
    { id: '64991dbbe6f0', productId: 'me03-blister4', storeId: 'ludostation', sellerId: null, sku: 'PKM146', url: 'https://ludostation.com.br/produtos/blister-quadruplo-equilibrio-perfeito-mega-evolucao-pokemon-tcg-pre-venda-1wfb9/' },
    { id: '85b4e6d1b118', productId: 'me01-combo', storeId: 'ludostation', sellerId: null, sku: '028D102700000BX', url: 'https://ludostation.com.br/produtos/combo-de-booster-pokemon-tcg-mega-evolucao-1/' },
    { id: 'a584f35df9ce', productId: 'me04-combo', storeId: 'ludostation', sellerId: null, sku: '028D102700000BX', url: 'https://ludostation.com.br/produtos/combo-de-booster-caos-ascendente-mega-evolucao-pokemon-tcg-gd8ea/' },
  ];
  assert.notEqual(offerDedupeKey(real[0]).key, offerDedupeKey(real[1]).key);
  assert.notEqual(offerDedupeKey(real[2]).key, offerDedupeKey(real[3]).key);
  const g = groupDuplicateOffers(real);
  assert.equal(g.duplicates.length, 0); assert.equal(g.groups.length, 4);
  for (const grp of g.groups) assert.equal(new Set(grp.offers.map((o) => o.productId)).size, 1);
});

t('chave: URL inválida sem SKU não agrupa', () => {
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
