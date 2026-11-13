// Grupo (pedido do dono em 13/11/2026): todo post leva o melhor cupom vigente da loja e o preço que sai com ele; sem
// cupom que sirva, nenhuma linha. Blister unitário e booster avulso entram no foco, e Black Friday de blister/unitário
// vem antes de qualquer outro produto.
import assert from 'node:assert/strict';
import { melhorCupom, linhaCupomComPreco, cupomPara } from '../src/agents/social/cupons.js';
import { focoEconomia, ordenarPorEconomia, TIPOS_FOCO } from '../src/agents/social/economia.js';
import { comCupom } from '../tools/social-whatsapp.mjs';

let n = 0; const t = (name, fn) => { fn(); n++; };
const NOW = Date.parse('2026-11-13T15:00:00Z');
const C = [
  { loja: 'shopee', escopo: 'loja', tipo: 'reais', valor: 10, minimo: 59, validoAte: '2026-11-15', codigo: 'F1MD011D011' },
  { loja: 'shopee', escopo: 'loja', tipo: 'pct', valor: 10, limite: 10, minimo: 0, validoAte: '2026-11-15' },
  { loja: 'shopee', escopo: 'loja', tipo: 'reais', valor: 100, minimo: 240, validoAte: '2026-11-12', codigo: 'VENCIDO' },
  { loja: 'amazon', escopo: 'loja', tipo: 'pct', valor: 15, minimo: 0, validoAte: '2026-11-30', codigo: 'BRINQU3DOS15' },
  { escopo: 'ml', tipo: 'reais', valor: 110, minimo: 1100, limite: 5500, validoAte: '2026-11-14' },
];

t('escolhe o cupom que dá mais desconto e respeita mínimo, teto e validade', () => {
  assert.equal(melhorCupom({ loja: 'shopee', preco: 52.46 }, C, NOW).cupom.valor, 10);        // só o de 10% (até R$ 10) alcança
  const r = melhorCupom({ loja: 'shopee', preco: 120 }, C, NOW);
  assert.equal(r.desconto, 10); assert.equal(r.final, 110);
  assert.equal(melhorCupom({ loja: 'shopee', preco: 300 }, C, NOW).cupom.codigo !== 'VENCIDO', true);
  assert.equal(melhorCupom({ loja: 'amazon', preco: 100 }, C, NOW).final, 85);
  assert.equal(melhorCupom({ loja: 'mercadolivre', preco: 50 }, C, NOW), null);               // mínimo de R$ 1.100
});

t('linha traz código, desconto e preço final; sem cupom, null', () => {
  const l = linhaCupomComPreco({ loja: 'amazon', preco: 100 }, C, NOW);
  assert.match(l, /Cupom <b>BRINQU3DOS15<\/b>: 15% OFF/); assert.match(l, /Com o cupom sai por <b>R\$ 85,00<\/b>/);
  assert.equal(linhaCupomComPreco({ loja: 'mercadolivre', preco: 50 }, C, NOW), null);
  assert.equal(linhaCupomComPreco({ loja: 'magalu', preco: 50 }, C, NOW), null);
});

t('cupom de outra loja nunca vira dica do Mercado Livre (formato antigo continua só ML)', () => {
  assert.equal(cupomPara({ storeId: 'mercadolivre', price: 1200 }, C, NOW).valor, 110);
  assert.equal(cupomPara({ storeId: 'mercadolivre', price: 80 }, C.filter((c) => c.loja), NOW), null);
});

t('comCupom: troca a dica antiga pela linha com preço, logo depois do preço/economia; sem cupom, nenhuma 🎟️', () => {
  const texto = '🇧🇷 <b>Blister</b>\n\nDe <b>R$ 59,96</b> ❌\nPor <b>R$ 52,46</b> ✅\n💰 Economia de <b>R$ 7,50</b> (13%)\n🎟️ dica antiga\n\nShopee\nhttps://s.shopee.com.br/x';
  const c = comCupom({ loja: 'shopee', preco: 52.46, item: { texto }, oferta: { productId: 'me01-blister4' } }, C, NOW);
  assert.match(c.item.texto, /💰 Economia[^\n]*\n🎟️ Cupom \(resgate em "Cupons" na Shopee\): 10% OFF \(até R\$ 10\)\n➡️ Com o cupom sai por <b>R\$ 47,21<\/b>/);
  assert.doesNotMatch(c.item.texto, /dica antiga/); assert.equal(c.cupom, true);
  const sem = comCupom({ loja: 'mercadolivre', preco: 52.46, item: { texto }, oferta: {} }, C, NOW);
  assert.doesNotMatch(sem.item.texto, /🎟️|➡️/); assert.equal(sem.cupom, false);
});

t('foco: blister unitário e booster avulso entram como os blisters', () => {
  for (const id of ['me05-blister1', 'me05-booster', 'me05-blister2', 'me05-blister3', 'me05-blister4']) assert.ok(TIPOS_FOCO.test(id), id);
  for (const id of ['me05-etb', 'me05-box36', 'avulsos-deck-melmetal']) assert.ok(!TIPOS_FOCO.test(id), id);
  const produtos = new Map([['me05-blister1', { msrp: 19.9 }]]);
  const c = focoEconomia({ preco: 13.28, oferta: { productId: 'me05-blister1' }, item: { texto: 'x\nPor <b>R$ 13,28</b> ✅' } }, { produtos });
  assert.ok(c && c.economia > 0.3);
});

t('ordem: Black Friday de blister/unitário primeiro, depois Black Friday de outros, depois o resto (blister antes)', () => {
  const c = (id, bf, eco) => ({ oferta: { productId: id, storeId: 'shopee' }, loja: 'shopee', blackFriday: bf, economia: eco, economiaReais: eco });
  const ordem = ordenarPorEconomia([c('me05-etb', true, 0.5), c('me05-blister1', true, 0.1), c('me04-box36', false, 0.6), c('me04-blister3', false, 0.06)])
    .map((x) => x.oferta.productId);
  assert.deepEqual(ordem, ['me05-blister1', 'me05-etb', 'me04-blister3', 'me04-box36']);
});

console.log(`✓ Cupom com preço final e foco em blister/unitário no grupo: ${n} grupos de testes passaram`);
