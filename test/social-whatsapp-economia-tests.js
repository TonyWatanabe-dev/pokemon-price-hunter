// WhatsApp com foco em economia (pedido do dono em 03/11/2026): só blister 2/3/4, barato, com "De X por Y" honesto.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { focoEconomia, referencia, ordenarPorEconomia } from '../src/agents/social/economia.js';
import { candidatosWhatsApp } from '../tools/social-whatsapp.mjs';
import { legendaWhatsApp } from '../src/agents/social/whatsapp.js';
import { montarLegenda } from '../src/agents/social/legenda.js';

let n = 0; const t = (nome, fn) => { try { fn(); n++; } catch (e) { e.message = `[${nome}] ${e.message}`; throw e; } };
const produtos = new Map([
  ['me04-blister4', { id: 'me04-blister4', msrp: 55.99 }],
  ['me05-blister3', { id: 'me05-blister3', marketAverage: 45 }],
  ['me04-box36', { id: 'me04-box36', msrp: 449.99 }],
  ['me04-blister4-en', { id: 'me04-blister4-en', msrp: 55.99 }],
  ['sv1-blister2', { id: 'sv1-blister2' }],
  ['me04-etb', { id: 'me04-etb', msrp: 249.99 }],
]);
const cand = (productId, preco) => ({ item: { ofertaId: productId, texto: montarLegenda({ titulo: `T ${productId}`, atual: preco, loja: 'Mercado Livre', link: 'https://meli.la/x' }).texto }, oferta: { productId, price: preco } });

t('referência: sugerido Copag; sem ele, média do mercado; sem nenhum, nada', () => {
  assert.deepEqual(referencia(produtos.get('me04-blister4')), { ref: 55.99, rotulo: 'sugerido Copag' });
  assert.deepEqual(referencia(produtos.get('me05-blister3')), { ref: 45, rotulo: 'média do mercado' });
  assert.equal(referencia(produtos.get('sv1-blister2')), null);
});

t('só blister 2/3/4 em português, até o teto de preço e com economia mínima', () => {
  const ok = (pid, preco, o = {}) => focoEconomia(cand(pid, preco), { produtos, ...o });
  assert.ok(ok('me04-blister4', 39.9));
  assert.equal(ok('me04-box36', 300), null, 'caixa fica de fora');
  assert.equal(ok('me04-blister4-en', 39.9), null, 'importado fica de fora');
  assert.equal(ok('sv1-blister2', 30), null, 'sem referência não há "De X por Y"');
  assert.equal(ok('me04-blister4', 54.99), null, 'menos de 5% de economia');
  assert.equal(ok('me04-blister4', 39.9, { precoMax: 30 }), null, 'acima do teto');
  assert.equal(Math.round(ok('me05-blister3', 39).economia * 100), 13);
});

t('outro produto só com desconto forte (20%+) e até R$ 250; caixa cara não volta', () => {
  const ok = (pid, preco, o = {}) => focoEconomia(cand(pid, preco), { produtos, ...o });
  assert.ok(ok('me04-etb', 189.9), '24% abaixo do sugerido: entra');
  assert.equal(ok('me04-etb', 210), null, '16%: não é desconto forte');
  assert.equal(ok('me04-box36', 300), null, '33% mas acima de R$ 250');
  assert.ok(ok('me04-box36', 300, { precoMaxForte: 400 }), 'teto ajustável');
  assert.equal(ok('me04-etb', 189.9, { descontoForte: 0.3 }), null, 'desconto forte ajustável');
});

t('legenda: "De X (rótulo) ❌", "Por" e a economia em reais e %', () => {
  const w = legendaWhatsApp(focoEconomia(cand('me04-blister4', 39.9), { produtos }).item.texto);
  assert.match(w, /De \*R\$ 55,99\* \(sugerido Copag\) ❌\nPor \*R\$ 39,90\* ✅\n💰 Economia de \*R\$ 16,09\* \(29%\)/);
  const m = legendaWhatsApp(focoEconomia(cand('me05-blister3', 39), { produtos }).item.texto);
  assert.match(m, /De \*R\$ 45,00\* \(média do mercado\) ❌/);
});

t('revisão: "De" do vendedor e 💰 de outra base são trocados pela referência do foco; sem "Por" sai da fila', () => {
  const comDe = { item: { ofertaId: 'x', texto: montarLegenda({ titulo: 'T', atual: 39.9, anterior: 99.9, loja: 'Mercado Livre', link: 'https://meli.la/x' }).texto }, oferta: { productId: 'me04-blister4', price: 39.9 } };
  const w = legendaWhatsApp(focoEconomia(comDe, { produtos }).item.texto);
  assert.doesNotMatch(w, /99,90/); assert.equal((w.match(/^De /gm) || []).length, 1);
  assert.match(w, /De \*R\$ 55,99\* \(sugerido Copag\) ❌\nPor \*R\$ 39,90\* ✅\n💰 Economia de \*R\$ 16,09\* \(29%\)/);
  const camp = { item: { ofertaId: 'y', texto: `${montarLegenda({ titulo: 'T', atual: 39.9, loja: 'Mercado Livre', link: 'https://meli.la/x' }).texto}\n\n💰 Abaixo do menor preço das outras lojas (R$ 45,00)\n🕒 Preço lido em 03/11` }, preco: 39.9, oferta: { productId: 'me04-blister4' } };
  const wc = legendaWhatsApp(focoEconomia(camp, { produtos }).item.texto);
  assert.equal((wc.match(/💰/g) || []).length, 1); assert.match(wc, /💰 Economia de \*R\$ 16,09\* \(29%\)/); assert.match(wc, /🕒 Preço lido em 03\/11/);
  assert.equal(focoEconomia({ item: { texto: 'sem preço' }, oferta: { productId: 'me04-blister4', price: 39.9 } }, { produtos }), null);
});

t('fila: aplica o foco por padrão; SOCIAL_FOCO=0 volta à fila completa; teto e economia ajustáveis', () => {
  const agora = Date.parse('2026-11-03T15:00:00Z'); const iso = new Date(agora).toISOString();
  const of = (id, pid, price, discount, url) => ({ id, productId: pid, storeId: 'mercadolivre', storeName: 'Mercado Livre', url, image: 'https://i/x.jpg', title: `ML ${pid}`, price, total: price,
    shippingKnown: true, shipping: 0, stock: 'IN_STOCK', confirmed: true, stale: false, anomalous: false, firstSeen: iso, source_timestamp: iso, discount });
  const state = { generatedAt: iso, products: [...produtos.values()].map((p) => ({ ...p, name: p.id })), offers: [
    of('a', 'me04-blister4', 39.9, 0.29, 'https://produto.mercadolivre.com.br/MLB-1111111111-a'),
    of('b', 'me04-box36', 300, 0.33, 'https://produto.mercadolivre.com.br/MLB-2222222222-b'),
  ] };
  const afiliados = { anuncios: { MLB1111111111: 'https://meli.la/a', MLB2222222222: 'https://meli.la/b' } };
  const ids = (env) => candidatosWhatsApp(state, { now: agora, env, afiliados, campanha: null }).map((c) => c.oferta.productId);
  assert.deepEqual(ids({}), ['me04-blister4']);
  assert.deepEqual(ids({ SOCIAL_FOCO: '0' }).sort(), ['me04-blister4', 'me04-box36']);
  assert.deepEqual(ids({ SOCIAL_PRECO_MAX: '30' }), []);
  assert.deepEqual(ids({ SOCIAL_ECONOMIA_MIN: '0.5' }), []);
  const y = fs.readFileSync(new URL('../.github/workflows/social-whatsapp-auto.yml', import.meta.url), 'utf8');
  for (const v of ['SOCIAL_FOCO', 'SOCIAL_PRECO_MAX', 'SOCIAL_ECONOMIA_MIN', 'SOCIAL_DESCONTO_FORTE', 'SOCIAL_PRECO_MAX_FORTE']) assert.match(y, new RegExp(`${v}: \\$\\{\\{ vars\\.${v} \\}\\}`));
});

t('ordem: Black Friday primeiro, maior desconto e economia em reais; outra loja só fura a fila com desconto próximo', () => {
  const c = (id, loja, economia, economiaReais = 10, blackFriday = false) => ({ id, loja, economia, economiaReais, blackFriday });
  const ids = (l) => ordenarPorEconomia(l).map((x) => x.id);
  assert.deepEqual(ids([c('a', 'ml', 0.30), c('bf', 'ml', 0.10, 10, true), c('b', 'ml', 0.30, 20)]), ['bf', 'b', 'a'], 'BF na frente; empate de % decide pelos reais');
  assert.deepEqual(ids([c('m1', 'mercadolivre', 0.30), c('m2', 'mercadolivre', 0.29), c('s1', 'shopee', 0.27), c('s2', 'shopee', 0.06)]), ['m1', 's1', 'm2', 's2'], 'revezamento só entre descontos próximos');
  assert.deepEqual(ids([c('m1', 'mercadolivre', 0.30), c('m2', 'mercadolivre', 0.29), c('s1', 'shopee', 0.10)]), ['m1', 'm2', 's1'], 'desconto fraco não passa na frente');
});

console.log(`✓ WhatsApp foco em economia: ${n} grupos passaram`);
