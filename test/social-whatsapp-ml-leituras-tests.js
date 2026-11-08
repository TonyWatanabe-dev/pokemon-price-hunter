// Planilha do Mercado Livre do dono na fila do WhatsApp (06/11/2026): anúncio fora do catálogo, que o robô não enxerga,
// entra com o preço lido e o link meli.la, pela mesma regra das leituras de Shopee e Amazon.
process.env.SITE_SO_PARCEIROS = '0';   // site só com parceiros (07/11/2026): este teste cobre o comportamento com todas as lojas (modo desligado); o modo ligado é test/so-parceiros-ui-tests.js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ofertasExternas, candidatoExterno, lerLeituras } from '../src/agents/social/externas.js';
import { candidatosWhatsApp, lerArgs } from '../tools/social-whatsapp.mjs';
import { legendaWhatsApp } from '../src/agents/social/whatsapp.js';

const NOW = Date.parse('2026-11-06T15:00:00Z');
const iso = (h) => new Date(NOW - h * 3600e3).toISOString();
const products = [{ id: 'me05-blister3', name: 'Blister Triplo ME05', msrp: 42.99, image: 'https://img/b3.jpg' }, { id: 'me05-blister4', name: 'Blister Quádruplo ME05', msrp: 55.99 }];
const ml = (item, productId, price, h = 2, url = `https://meli.la/${item.slice(3)}`) => ({ item, productId, title: `ML ${item}`, url, price, capturedAt: iso(h) });

let n = 0; const t = (nome, fn) => { try { fn(); n++; } catch (e) { e.message = `[${nome}] ${e.message}`; throw e; } };

t('lerLeituras: só item MLB com link meli.la', () => {
  const l = lerLeituras(null, null, { ofertas: [ml('MLB1', 'me05-blister3', 30), ml('MLB2', 'me05-blister3', 30, 2, 'https://produto.mercadolivre.com.br/MLB-2'), ml('X3', 'me05-blister3', 30)] });
  assert.deepEqual(l.ml.map((x) => x.item), ['MLB1']);
});

t('mesma regra das externas: recente, promoção, um por produto', () => {
  const r = ofertasExternas({ now: NOW, products, offers: [], ml: [ml('MLB1', 'me05-blister3', 29.9), ml('MLB2', 'me05-blister3', 39), ml('MLB3', 'me05-blister4', 60), ml('MLB4', 'me05-blister4', 40, 30)] });
  assert.deepEqual(r.map((x) => x.ofertaId), ['mercadolivre:MLB1'], 'mais barato do produto; acima do msrp e leitura de 30 h saem');
  const c = candidatoExterno(r[0]); const w = legendaWhatsApp(c.item.texto);
  assert.equal(c.loja, 'mercadolivre'); assert.equal(c.itemMl, 'MLB1'); assert.equal(c.afiliado, true);
  assert.match(w, /Mercado Livre\nhttps:\/\/meli\.la\/1/); assert.match(w, /🕒 Preço lido em 06\/11 às 10:00/);
});

t('fila: entra com "De X por Y"; anúncio que o robô já posta não repete', () => {
  const agora = new Date(NOW).toISOString();
  const robo = { id: 'me05-blister4', productId: 'me05-blister4', storeId: 'mercadolivre', storeName: 'Mercado Livre', url: 'https://produto.mercadolivre.com.br/MLB-2222222222-x',
    image: 'https://i/x.jpg', title: 'Robô', price: 45, total: 45, shippingKnown: true, shipping: 0, stock: 'IN_STOCK', confirmed: true, stale: false, anomalous: false, firstSeen: iso(100), source_timestamp: agora, discount: 0.2 };
  const state = { generatedAt: agora, products, offers: [robo] };
  const afiliados = { anuncios: { MLB2222222222: 'https://meli.la/robo' } };
  const leituras = { shopee: [], amazon: [], ml: [ml('MLB1111111111', 'me05-blister3', 29.9), ml('MLB2222222222', 'me05-blister4', 44)] };
  const l = candidatosWhatsApp(state, { now: NOW, env: {}, afiliados, leituras });
  const ids = l.map((c) => c.item.ofertaId);
  assert.ok(ids.includes('mercadolivre:MLB1111111111'), ids.join());
  assert.ok(!ids.includes('mercadolivre:MLB2222222222'), 'o robô já tem esse anúncio');
  const c = l.find((x) => x.item.ofertaId === 'mercadolivre:MLB1111111111');
  assert.match(c.item.texto, /De <b>R\$ 42,99<\/b> \(sugerido Copag\) ❌/);
  assert.equal(candidatosWhatsApp(state, { now: NOW, env: { SOCIAL_EXTERNAS: '0' }, afiliados, leituras }).some((x) => x.loja === 'mercadolivre' && x.itemMl), false, 'SOCIAL_EXTERNAS=0 desliga');
});

t('--ml no CLI e no workflow; arquivo real carrega', () => {
  assert.equal(lerArgs(['enviar', '--sessao', 's', '--state', 'st', '--diario', 'd', '--titulo', 'g', '--ml', 'x.json']).ml, 'x.json');
  const y = fs.readFileSync(new URL('../.github/workflows/social-whatsapp-auto.yml', import.meta.url), 'utf8');
  assert.match(y, /--ml config\/afiliados\/ml-leituras\.json/);
  const real = JSON.parse(fs.readFileSync(new URL('../config/afiliados/ml-leituras.json', import.meta.url), 'utf8'));
  const l = lerLeituras(null, null, real);
  assert.ok(l.ml.length > 0 && l.ml.length === real.ofertas.length, 'todas as linhas do arquivo são válidas');
  assert.equal(new Set(l.ml.map((x) => x.item)).size, l.ml.length, 'item repetido');
  assert.ok(l.ml.every((x) => typeof x.price === 'number' && x.price > 0 && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(x.capturedAt) && Date.parse(x.capturedAt) <= Date.now()));
});

console.log(`✓ social-whatsapp-ml-leituras: ${n} grupos passaram`);
