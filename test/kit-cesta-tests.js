// Monte seu kit (K4): cesta e comparação "tudo numa loja" × "dividir entre lojas" — golden com fixtures sintéticas.
import assert from 'node:assert/strict';
import { compararLojas } from '../src/kit/recomendar.js';
const O = (productId, storeId, price, extra = {}) => ({ productId, storeId, storeName: storeId, price, total: price, stock: 'IN_STOCK', url: `https://${storeId}.test/${productId}`, shippingKnown: false, shipping: null, ...extra });

// 1. frete conhecido em tudo: compara totais; loja A tem os dois itens; dividir usa o mais barato de cada
{
  const of = [O('p1', 'a', 100, { shippingKnown: true, shipping: 0 }), O('p2', 'a', 50, { shippingKnown: true, shipping: 0 }), O('p1', 'b', 90, { shippingKnown: true, shipping: 20 }), O('p2', 'c', 40, { shippingKnown: true, shipping: 0 })];
  const r = compararLojas([{ productId: 'p1', quantidade: 1 }, { productId: 'p2', quantidade: 1 }], of);
  assert.equal(r.umaLoja.length, 1); assert.equal(r.umaLoja[0].itens[0].oferta.storeId, 'a');
  // a: frete de 2 itens com frete 0 informado em ambos → 0; total 150
  assert.equal(r.umaLoja[0].total, 150);
  // dividir: melhor comparável por produto = frete conhecido primeiro, menor total → p1 na A (100, frete 0 → total 100) vs B (total 90 sem frete somado? total=price 90) — bestComparable usa total
  assert.equal(r.dividir.pedidos, 2); assert.equal(r.comparacao.base, 'total');
  assert.equal(r.comparacao.economia, r2(r.umaLoja[0].total - r.dividir.total));
}
// 2. frete desconhecido: compara só produtos e avisa
{
  const of = [O('p1', 'a', 100), O('p2', 'a', 50), O('p1', 'b', 80), O('p2', 'c', 45)];
  const r = compararLojas([{ productId: 'p1', quantidade: 1 }, { productId: 'p2', quantidade: 2 }], of);
  assert.equal(r.comparacao.base, 'produtos'); assert.equal(r.comparacao.umaLoja, 200); assert.equal(r.comparacao.dividir, 170); assert.equal(r.comparacao.economia, 30);
  assert.equal(r.dividir.total, null, 'frete desconhecido nunca vira zero'); assert.ok(r.limitacoes.some((l) => /só os produtos/.test(l)));
}
// 3. nenhuma loja com todos: só dividir; item sem estoque fica de fora com aviso
{
  const of = [O('p1', 'a', 10), O('p2', 'b', 20), O('p3', 'c', 30, { stock: 'OUT_OF_STOCK' }), O('p2', 'd', 5, { anomalous: true })];
  const r = compararLojas([{ productId: 'p1', quantidade: 1 }, { productId: 'p2', quantidade: 1 }, { productId: 'p3', quantidade: 1 }], of);
  assert.deepEqual(r.faltam, ['p3']); assert.equal(r.umaLoja.length, 0); assert.equal(r.comparacao, null);
  assert.equal(r.dividir.itens.find((i) => i.productId === 'p2').oferta.storeId, 'b', 'preço anômalo fora');
  assert.ok(r.limitacoes.some((l) => /Nenhuma loja tem todos/.test(l)));
}
// 4. regra pública de frete grátis por loja vale sobre o subtotal da loja
{
  const of = [O('p1', 'z', 150), O('p2', 'z', 60)];
  const r = compararLojas([{ productId: 'p1', quantidade: 1 }, { productId: 'p2', quantidade: 1 }], of, { fg: { z: { min: 199.99 } } });
  assert.equal(r.umaLoja[0].total, 210); assert.match(r.umaLoja[0].fretes[0].como, /regra da loja/);
}
// 5. entrada inválida/limites
{ const r = compararLojas([{ productId: 'p1', quantidade: 0 }, { productId: 'p2', quantidade: 99 }], [O('p2', 'a', 1)]); assert.deepEqual(r.itens, [{ productId: 'p2', quantidade: 20 }]); }
// 6. caso real de 24/10: frete informado não pode tornar "dividir" mais caro que "uma loja"
{
  const of = [O('b3', 'vila', 49.9, { total: 59.43, shipping: 9.53, shippingKnown: true }), O('b3', 'rihappy', 37.89), O('bo', 'rihappy', 10.9), O('b3', 'gorupa', 37.91), O('bo', 'gorupa', 11.39)];
  const r = compararLojas([{ productId: 'b3', quantidade: 3 }, { productId: 'bo', quantidade: 1 }], of);
  assert.equal(r.dividir.itens[0].oferta.storeId, 'rihappy'); assert.ok(r.dividir.subtotal <= r.umaLoja[0].subtotal, 'dividir nunca mais caro nos produtos');
  assert.equal(r.umaLoja[0].subtotal, 124.57);
}
function r2(v) { return Math.round(v * 100) / 100; }
console.log('✓ kit-cesta: uma loja × dividir, frete por loja, frete desconhecido, sem estoque/anomalia');
