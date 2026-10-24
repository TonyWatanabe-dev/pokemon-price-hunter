// Monte seu kit: comissão nunca muda a recomendação. Com a preferência de desempate do site registrada (afiliado primeiro
// só em EMPATE exato, docs/afiliados.md), a oferta mais barata sem afiliado continua vencendo no kit e na cesta.
import assert from 'node:assert/strict';
import { setTiePreference } from '../api/_lib/offer-rank.mjs';
import { recomendar, compararLojas } from '../api/_lib/kit.mjs';
const O = (productId, storeId, price, extra = {}) => ({ productId, storeId, storeName: storeId, price, total: price, stock: 'IN_STOCK', url: `https://${storeId}.test/${productId}`, shippingKnown: false, ...extra });
setTiePreference((o) => o.storeId === 'afiliado');
try {
  const produtos = [{ id: 'p-blister3', type: 'blister_3', name: 'P - Blister Triplo' }, { id: 'p-booster', type: 'booster_pack', name: 'P - Booster' }];
  const of = [O('p-blister3', 'afiliado', 30.01), O('p-blister3', 'barata', 30), O('p-booster', 'afiliado', 10), O('p-booster', 'outra', 10)];
  const r = recomendar({ objetivo: 'colecionar', orcamento: 100, idioma: 'pt' }, produtos, of);
  assert.equal(r.itens[0].oferta.storeId, 'barata', 'R$ 0,01 mais barata vence o afiliado');
  const c = compararLojas([{ productId: 'p-blister3', quantidade: 1 }, { productId: 'p-booster', quantidade: 1 }], of);
  assert.equal(c.dividir.itens.find((i) => i.productId === 'p-blister3').oferta.storeId, 'barata');
  assert.equal(c.dividir.itens.find((i) => i.productId === 'p-booster').oferta.storeId, 'afiliado', 'empate exato: desempate do site (política do dono)');
} finally { setTiePreference(null); }
console.log('✓ kit-afiliado: comissão só desempata preço igual; nunca passa oferta mais barata');
