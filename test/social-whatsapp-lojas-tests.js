// WhatsApp revezando ML → Shopee → Amazon, só afiliado e só promoção (pedido do dono em 02/11/2026).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ofertasExternas, candidatoExterno, intercalar, melhoresDoSite, lerLeituras } from '../src/agents/social/externas.js';
import { candidatosWhatsApp } from '../tools/social-whatsapp.mjs';
import { legendaWhatsApp } from '../src/agents/social/whatsapp.js';
import { REGRAS_WHATSAPP } from '../src/agents/social/auto.js';

const NOW = Date.parse('2026-11-02T15:00:00Z');
const iso = (h) => new Date(NOW - h * 3600e3).toISOString();
const products = [{ id: 'p1', name: 'P1', msrp: 100, image: 'https://img/p1.jpg' }, { id: 'p2', name: 'P2', msrp: 50 }, { id: 'p3', name: 'P3' }];
const offers = [{ productId: 'p3', price: 30, stock: 'IN_STOCK' }, { productId: 'p3', price: 10, stock: 'OUT_OF_STOCK' }];
const sh = (item, productId, price, priceCupom, h = 2) => ({ item, productId, title: `Shopee ${item}`, url: `https://s.shopee.com.br/${item}`, price, priceCupom, capturedAt: iso(h) });
const am = (asin, productId, price, stockNote = 'Em estoque', h = 2) => ({ asin, productId, title: `Amazon ${asin}`, url: `https://www.amazon.com.br/dp/${asin}?tag=x`, shortUrl: `https://link.amazon/${asin}`, price, stockNote, capturedAt: iso(h) });

let n = 0; const t = (nome, fn) => { try { fn(); n++; } catch (e) { e.message = `[${nome}] ${e.message}`; throw e; } };

t('melhor preço do site só conta estoque', () => assert.equal(melhoresDoSite(offers).get('p3'), 30));

t('só promoção, leitura recente, disponível, um por produto e loja', () => {
  const r = ofertasExternas({ now: NOW, products, offers, shopee: [
    sh('1', 'p1', 110, 95),        // com cupom abaixo do msrp: entra (efetivo 95)
    sh('2', 'p1', 99, null),       // mais caro que o 95 da mesma loja/produto: sai
    sh('3', 'p2', 60, null),       // acima do msrp: sai
    sh('4', 'p3', 29, null),       // sem msrp, abaixo do melhor do site: entra
    sh('5', 'p1', 80, null, 30),   // leitura de 30 h: sai
  ], amazon: [am('A1', 'p1', 90), am('A2', 'p1', 70, 'Não disponível'), am('A3', 'p9', 1), am('A4', 'p2', null)] });
  assert.deepEqual(r.map((x) => x.ofertaId), ['amazon:A1', 'shopee:1', 'shopee:4'], 'maior desconto primeiro');
  assert.equal(r.find((x) => x.ofertaId === 'shopee:1').efetivo, 95);
  assert.equal(r[0].link, 'https://link.amazon/A1');
});

t('legenda: preço sem cupom no "Por", linha do cupom da Shopee e hora da leitura', () => {
  const [o] = ofertasExternas({ now: NOW, products, offers, shopee: [sh('1', 'p1', 110, 95)] });
  const c = candidatoExterno(o); const w = legendaWhatsApp(c.item.texto);
  assert.equal(c.afiliado, true); assert.equal(c.foto, 'https://img/p1.jpg');
  assert.match(w, /Por \*R\$ 110,00\* ✅\n\nShopee\nhttps:\/\/s\.shopee\.com\.br\/1/);
  assert.match(w, /🎟️ Com cupom da Shopee: \*R\$ 95,00\* \(o cupom aparece na página\)/);
  assert.match(w, /🕒 Preço lido em 02\/11 às 10:00; pode ter mudado/);
  const [a] = ofertasExternas({ now: NOW, products, offers, amazon: [am('A1', 'p1', 90)] });
  assert.doesNotMatch(legendaWhatsApp(candidatoExterno(a).item.texto), /cupom/i);
});

t('lerLeituras: só links curtos de afiliado do dono; arquivos reais carregam', () => {
  const l = lerLeituras({ ofertas: [sh('1', 'p1', 1), { ...sh('2', 'p1', 1), url: 'https://shopee.com.br/x' }] }, { links: { a: am('B000000001', 'p1', 1), b: { ...am('B000000002', 'p1', 1), shortUrl: null } } });
  assert.deepEqual([l.shopee.length, l.amazon.length], [1, 1]);
  assert.deepEqual(lerLeituras(null, null), { shopee: [], amazon: [] });
  const ler = (f) => JSON.parse(fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'));
  const real = lerLeituras(ler('config/afiliados/shopee-ofertas.json'), ler('config/afiliados/amazon.json'));
  assert.ok(real.shopee.length > 0 && real.amazon.length > 0);
});

t('intercalar reveza e pula lista vazia', () => {
  assert.deepEqual(intercalar([1, 2, 3], ['a'], ['x', 'y']), [1, 'a', 'x', 2, 'y', 3]);
});

t('fila do WhatsApp: só ML com afiliado e desconto, revezando com Shopee e Amazon; SOCIAL_EXTERNAS=0 desliga', () => {
  const agora = new Date(NOW).toISOString();
  const of = (id, url, discount, price) => ({ id, productId: id, storeId: 'mercadolivre', storeName: 'Mercado Livre', url, image: 'https://i/x.jpg', title: `ML ${id}`, price, total: price,
    shippingKnown: true, shipping: 0, stock: 'IN_STOCK', confirmed: true, stale: false, anomalous: false, firstSeen: iso(100), source_timestamp: agora, discount });
  const state = { generatedAt: agora, products: [...products, { id: 'm1', name: 'M1' }, { id: 'm2', name: 'M2' }, { id: 'm3', name: 'M3' }, { id: 'm4', name: 'M4' }, { id: 'm5', name: 'M5' }],
    offers: [of('m1', 'https://produto.mercadolivre.com.br/MLB-1111111111-a', 0.2, 50), of('m2', 'https://produto.mercadolivre.com.br/MLB-2222222222-b', 0.3, 60),
      of('m3', 'https://produto.mercadolivre.com.br/MLB-3333333333-c', 0.5, 70),
      { ...of('m4', 'https://produto.mercadolivre.com.br/MLB-4444444444-d', null, 80), vsMarket: 0.25 }, of('m5', 'https://produto.mercadolivre.com.br/MLB-5555555555-e', -0.1, 90), ...offers] };
  const afiliados = { anuncios: { MLB1111111111: 'https://meli.la/a', MLB2222222222: 'https://meli.la/b', MLB4444444444: 'https://meli.la/d', MLB5555555555: 'https://meli.la/e' } };   // m3 sem afiliado; m5 acima do preço
  const leituras = { shopee: [sh('1', 'p1', 110, 95)], amazon: [am('A1', 'p1', 90), am('A9', 'p3', 25)] };
  const l = candidatosWhatsApp(state, { now: NOW, env: { SOCIAL_FOCO: '0' }, afiliados, leituras });
  assert.deepEqual(l.map((c) => c.item.ofertaId), ['m2', 'shopee:1', 'amazon:A1', 'm4', 'amazon:A9', 'm1']);
  assert.ok(l.every((c) => c.afiliado === true));
  assert.deepEqual(candidatosWhatsApp(state, { now: NOW, env: { SOCIAL_EXTERNAS: '0', SOCIAL_FOCO: '0' }, afiliados, leituras }).map((c) => c.item.ofertaId), ['m2', 'm4', 'm1']);
});

t('ritmo: 15 min, afiliada volta em 6 h, teto de 70; workflow a cada 15 min com o kill switch das externas', () => {
  assert.equal(REGRAS_WHATSAPP.intervaloMin, 15); assert.equal(REGRAS_WHATSAPP.repetirHorasAfiliado, 6); assert.equal(REGRAS_WHATSAPP.maxDia, 70);
  const y = fs.readFileSync(new URL('../.github/workflows/social-whatsapp-auto.yml', import.meta.url), 'utf8');
  assert.match(y, /cron: '\*\/15 \* \* \* \*'/); assert.match(y, /--shopee config\/afiliados\/shopee-ofertas\.json --amazon config\/afiliados\/amazon\.json/); assert.match(y, /SOCIAL_EXTERNAS: \$\{\{ vars\.SOCIAL_EXTERNAS \}\}/);
});

console.log(`✓ WhatsApp 3 lojas: ${n} grupos passaram`);
