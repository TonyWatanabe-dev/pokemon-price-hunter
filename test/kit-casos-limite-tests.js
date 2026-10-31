// Monte seu kit — casos-limite que faltavam na cobertura (24/10/2026, auditoria da funcionalidade, fixtures sintéticas):
// catálogo/ofertas vazios, oferta removida (stale) e esgotada fora da cesta, mudança de quantidade e troca de item com
// valores coerentes, e estados de erro/vazio/carregamento e viewport móvel na página. Nenhum dado real, nenhuma rede.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { recomendar, compararLojas } from '../api/_lib/kit.mjs';
const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const O = (productId, storeId, price, extra = {}) => ({ productId, storeId, storeName: storeId, price, total: price, stock: 'IN_STOCK', url: `https://${storeId}.test/${productId}`, shippingKnown: false, shipping: null, ...extra });
const r2 = (v) => Math.round(v * 100) / 100;

// 1. catálogo e ofertas vazios: nada de item inventado, total nulo, sem exceção
{
  const r = recomendar({ objetivo: 'colecionar', orcamento: 200, idioma: 'pt' }, [], []);
  assert.deepEqual(r.itens, []); assert.ok(!r.total, 'sem total inventado'); assert.ok(Array.isArray(r.limitacoes));
  const c = compararLojas([{ productId: 'p1', quantidade: 1 }], []);
  assert.deepEqual(c.faltam, ['p1']); assert.equal(c.umaLoja.length, 0); assert.equal(c.comparacao, null);
  const v = compararLojas([], [O('p1', 'a', 10)]);
  assert.deepEqual(v.itens, []); assert.equal(v.comparacao, null);
}
// 2. oferta removida (stale, ex.: produto que sumiu da loja — #897) e esgotada nunca entram na cesta
{
  const of = [O('p1', 'sumiu', 5, { stale: true }), O('p1', 'esgotou', 6, { stock: 'OUT_OF_STOCK' }), O('p1', 'ok', 9)];
  const c = compararLojas([{ productId: 'p1', quantidade: 1 }], of);
  assert.equal(c.dividir.itens[0].oferta.storeId, 'ok', 'só a oferta com estoque confirmado e não stale');
  const so = compararLojas([{ productId: 'p1', quantidade: 1 }], [O('p1', 'sumiu', 5, { stale: true })]);
  assert.deepEqual(so.faltam, ['p1'], 'só oferta stale: item fica de fora, com aviso');
}
// 3. mudança de quantidade: subtotal acompanha a quantidade; frete desconhecido continua nulo (nunca zero)
{
  const of = [O('p1', 'a', 19.9), O('p2', 'a', 7.5)];
  const um = compararLojas([{ productId: 'p1', quantidade: 1 }, { productId: 'p2', quantidade: 1 }], of);
  const tres = compararLojas([{ productId: 'p1', quantidade: 3 }, { productId: 'p2', quantidade: 1 }], of);
  assert.equal(um.umaLoja[0].subtotal, 27.4); assert.equal(tres.umaLoja[0].subtotal, r2(3 * 19.9 + 7.5));
  assert.equal(tres.umaLoja[0].total, null, 'frete desconhecido: total nulo');
  assert.equal(tres.dividir.subtotal, tres.umaLoja[0].subtotal, 'mesma loja: dividir e uma loja somam igual');
}
// 4. troca de item (remover um, pôr alternativa): valores recalculados, item removido some
{
  const of = [O('p1', 'a', 10), O('p2', 'b', 20), O('p3', 'b', 15)];
  const antes = compararLojas([{ productId: 'p1', quantidade: 1 }, { productId: 'p2', quantidade: 1 }], of);
  const depois = compararLojas([{ productId: 'p1', quantidade: 1 }, { productId: 'p3', quantidade: 1 }], of);
  assert.equal(antes.dividir.subtotal, 30); assert.equal(depois.dividir.subtotal, 25);
  assert.ok(!depois.dividir.itens.some((i) => i.productId === 'p2'));
  // valores exibidos = calculados: soma dos itens bate com o subtotal do pedido
  const soma = r2(depois.dividir.itens.reduce((s, i) => s + i.oferta.price * i.quantidade, 0));
  assert.equal(soma, depois.dividir.subtotal);
}
// 5. página: estados de erro, vazio e carregamento; viewport móvel; frete desconhecido escrito, nunca R$ 0,00
{
  const js = read('assets/web/kit-v3.js'); const html = read('kit.html');
  assert.match(js, /Não deu para montar o kit agora/, 'erro da API tem mensagem e botão de recomeçar');
  assert.match(js, /renderCesta\(null\)/, 'falha na cesta cai num estado próprio');
  assert.match(js, /Sua cesta está vazia/, 'estado vazio');
  assert.match(js, /Frete: a calcular na loja/, 'frete desconhecido escrito por extenso');
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1/, 'viewport móvel');
}
console.log('✓ kit-casos-limite: vazio, stale/esgotado fora, quantidade, troca de item, estados da página');
