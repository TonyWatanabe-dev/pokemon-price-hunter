// Janela da Black Friday no foco do grupo (25/11/2026, pedido do dono: "afrouxar o filtro de economia só na Black
// Friday"): dentro da janela o teto sobe e o desconto forte cai; fora dela volta ao padrão de 03/11 sem ninguém mexer.
process.env.SITE_SO_PARCEIROS = '0';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { padroesFoco, focoEconomia, PADRAO, PADRAO_BF, JANELA_BF } from '../src/agents/social/economia.js';
import { candidatosWhatsApp } from '../tools/social-whatsapp.mjs';

const DENTRO = Date.parse('2026-11-27T15:00:00Z');   // 27/11, Black Friday
const FORA = Date.parse('2026-12-05T15:00:00Z');     // depois da janela
let n = 0; const t = (nome, fn) => { try { fn(); n++; } catch (e) { e.message = `[${nome}] ${e.message}`; throw e; } };

t('padroesFoco: folgado na janela, padrão fora dela, nas duas pontas', () => {
  assert.deepEqual(padroesFoco(DENTRO), { ...PADRAO_BF, blackFriday: true });
  assert.deepEqual(padroesFoco(FORA), { ...PADRAO, blackFriday: false });
  assert.equal(padroesFoco(Date.parse(JANELA_BF.de)).blackFriday, true, 'primeiro instante entra');
  assert.equal(padroesFoco(Date.parse(JANELA_BF.ate)).blackFriday, true, 'último instante entra');
  assert.equal(padroesFoco(Date.parse(JANELA_BF.de) - 1).blackFriday, false);
  assert.equal(padroesFoco(Date.parse(JANELA_BF.ate) + 1).blackFriday, false);
  assert.ok(PADRAO_BF.economiaMin === PADRAO.economiaMin, 'a economia mínima do blister não foi afrouxada');
  assert.ok(PADRAO_BF.precoMax > PADRAO.precoMax && PADRAO_BF.precoMaxForte > PADRAO.precoMaxForte && PADRAO_BF.descontoForte < PADRAO.descontoForte);
});

// ETB de R$ 320 com 15% abaixo do sugerido: barrado no padrão (precisa de 20% e teto R$ 250), passa na Black Friday.
const produtos = new Map([['me05-etb', { id: 'me05-etb', name: 'ETB', msrp: 399.99 }],
  ['me05-blister3', { id: 'me05-blister3', name: 'Blister Triplo', msrp: 42.99 }]]);
const cand = (pid, preco) => ({ loja: 'mercadolivre', preco, oferta: { productId: pid, price: preco }, item: { texto: `Oferta\nPor <b>R$ ${preco}</b>` } });

t('ETB caro com desconto médio: fora no padrão, dentro na Black Friday', () => {
  const c = cand('me05-etb', 339.99);
  assert.equal(focoEconomia(c, { produtos, ...PADRAO }), null, 'padrão barra: acima de R$ 250 e menos de 20%');
  const bf = focoEconomia(c, { produtos, ...PADRAO_BF });
  assert.ok(bf, 'Black Friday aceita');
  assert.match(bf.item.texto, /De <b>R\$ 399,99<\/b> \(sugerido Copag\) ❌/);
  assert.match(bf.item.texto, /💰 Economia de <b>R\$ 60,00<\/b> \(15%\)/);
});

t('o que é ruim continua fora nas duas configurações', () => {
  assert.equal(focoEconomia(cand('me05-etb', 395), { produtos, ...PADRAO_BF }), null, '1% de desconto não entra nem na Black Friday');
  assert.equal(focoEconomia(cand('me05-etb', 420), { produtos, ...PADRAO_BF }), null, 'acima do sugerido não entra');
  assert.equal(focoEconomia(cand('me05-blister3', 42), { produtos, ...PADRAO_BF }), null, 'blister com 2% fica fora: economiaMin igual ao padrão');
  assert.equal(focoEconomia(cand('me05-etb', 450), { produtos, ...PADRAO_BF }), null, 'acima do teto da Black Friday não entra');
});

t('candidatosWhatsApp usa a janela pelo now e SOCIAL_FOCO_BF=0 desliga; SOCIAL_* ainda mandam mais', () => {
  const agora = new Date(DENTRO).toISOString();
  const oferta = { id: 'me05-etb', productId: 'me05-etb', storeId: 'mercadolivre', storeName: 'Mercado Livre',
    url: 'https://produto.mercadolivre.com.br/MLB-2222222222-etb', image: 'https://i/x.jpg', title: 'ETB ME05', price: 339.99,
    total: 339.99, shippingKnown: true, shipping: 0, stock: 'IN_STOCK', confirmed: true, stale: false, anomalous: false,
    firstSeen: agora, source_timestamp: agora, discount: 0.15 };
  const state = { generatedAt: agora, products: [...produtos.values()], offers: [oferta] };
  const base = { afiliados: { anuncios: { MLB2222222222: 'https://meli.la/etb' } }, leituras: { shopee: [], amazon: [], ml: [] }, cupons: { cupons: [] } };
  const dentro = candidatosWhatsApp(state, { ...base, now: DENTRO, env: {} });
  assert.equal(dentro.length, 1, 'na Black Friday o ETB entra');
  assert.equal(candidatosWhatsApp(state, { ...base, now: FORA, env: {} }).length, 0, 'fora da janela o padrão barra');
  assert.equal(candidatosWhatsApp(state, { ...base, now: DENTRO, env: { SOCIAL_FOCO_BF: '0' } }).length, 0, 'SOCIAL_FOCO_BF=0 volta ao padrão');
  assert.equal(candidatosWhatsApp(state, { ...base, now: DENTRO, env: { SOCIAL_PRECO_MAX_FORTE: '300' } }).length, 0, 'variável do dono manda mais que a janela');
});

t('a janela está documentada onde o dono procura', () => {
  const doc = fs.readFileSync(new URL('../tools/social-whatsapp.mjs', import.meta.url), 'utf8');
  assert.match(doc, /SOCIAL_FOCO_BF=0/, 'o jeito de desligar aparece no cabeçalho da fila');
  const eco = fs.readFileSync(new URL('../src/agents/social/economia.js', import.meta.url), 'utf8');
  assert.match(eco, /JANELA_BF/);
});

console.log(`✓ social-foco-black-friday: ${n} grupos passaram`);
