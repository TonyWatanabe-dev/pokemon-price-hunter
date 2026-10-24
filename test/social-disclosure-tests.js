// Posts dos grupos (Telegram e WhatsApp) sem a frase de afiliado (decisão do proprietário, 24/10/2026): o resto do
// post (título, preço, loja, link, cupom) segue igual. Offline: sem rede, banco ou secrets.
import assert from 'node:assert/strict';
import { montarLegenda, linkDeAfiliado, LEGENDA_MAX } from '../src/agents/social/legenda.js';
import { legendaWhatsApp } from '../src/agents/social/whatsapp.js';
import { candidatos } from '../tools/social-telegram-piloto.mjs';

const DIVULGACAO = 'Link de afiliado';   // frase removida dos grupos em 24/10/2026: não pode voltar
let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };

t('1. detecta link de afiliado só pelo próprio link', () => {
  for (const u of ['https://meli.la/1BzQ4PU', 'https://amzn.to/abc', 'https://link.amazon/B0bVBmGRD',
    'https://www.amazon.com.br/dp/B0HFNSM2T3?tag=tcgpricehunter-20', 'https://MELI.LA/x']) assert.equal(linkDeAfiliado(u), true, u);
  for (const u of ['https://www.amazon.com.br/dp/B0HFNSM2T3', 'https://produto.mercadolivre.com.br/MLB-1234567890-x',
    'https://loja.test/p?tag=x', 'https://meli.la.evil.test/x', 'nada', null, undefined]) assert.equal(linkDeAfiliado(u), false, String(u));
});

const base = { titulo: 'Box ME04', atual: 900, loja: 'Loja' };
t('2. legenda: nenhuma frase de afiliado, com ou sem flag/link de afiliado', () => {
  for (const extra of [{ link: 'https://loja.test/p' }, { link: 'https://loja.test/p', afiliado: true }, { link: 'https://meli.la/abc' },
    { link: 'https://www.amazon.com.br/dp/B0X?tag=a-20' }]) assert.ok(!montarLegenda({ ...base, ...extra }).texto.includes(DIVULGACAO), JSON.stringify(extra));
});

t('3. título no limite: termina no link', () => {
  const { texto } = montarLegenda({ ...base, titulo: 'Box & '.repeat(400), link: 'https://meli.la/abc' });
  assert.ok(texto.length <= LEGENDA_MAX); assert.ok(texto.endsWith('https://meli.la/abc'));
});

// Candidatos reais (mesma função dos bots): ML com link do anúncio configurado, ML com URL já de afiliado, loja comum.
const NOW = Date.now(); const iso = (min) => new Date(NOW - min * 60000).toISOString();
const ofertas = [
  ['o1', 'mercadolivre', 'Mercado Livre', 'https://produto.mercadolivre.com.br/MLB-1234567890-box-_JM'],
  ['o2', 'mercadolivre', 'Mercado Livre', 'https://meli.la/ja-afiliado'],
  ['o3', 'loja1', 'Loja 1', 'https://loja1.test/p'],
];
const st = { generatedAt: iso(0), products: [{ id: 'me04-box36', collection: 'me04', collectionName: 'ME04', type: 'booster_box', boosters: 36, name: 'Box ME04' }],
  offers: ofertas.map(([id, storeId, storeName, url], i) => ({ id, productId: 'me04-box36', storeId, storeName, seller: 'X', url, image: `https://l${i}.test/i.jpg`,
    title: 'Box ME04', price: 900 + i, total: 900 + i, shippingKnown: true, shipping: 0, stock: 'IN_STOCK', confirmed: true, stale: false, anomalous: false,
    firstSeen: iso(5000), source_timestamp: iso(5) })) };
const afiliados = { anuncios: { MLB1234567890: 'https://meli.la/do-anuncio' } };
const cupons = [{ escopo: 'ml', tipo: 'pct', valor: 10, minimo: 0, limite: null, validoAte: '2099-12-31' }];

t('4. auditoria: nenhum post dos grupos traz frase de afiliado (Telegram e WhatsApp, com cupom)', () => {
  const lista = candidatos(st, { now: NOW, env: {}, afiliados, cupons });
  assert.equal(lista.length, 3, 'as três ofertas elegíveis');
  for (const c of lista) {
    for (const [canal, txt] of [['telegram', c.item.texto], ['whatsapp', legendaWhatsApp(c.item.texto)]]) {
      assert.ok(!txt.includes(DIVULGACAO), `${c.item.ofertaId} (${canal})`);
    }
  }
  const por = Object.fromEntries(lista.map((c) => [c.item.ofertaId, c]));
  assert.ok(por.o1.item.texto.includes('https://meli.la/do-anuncio') && por.o1.afiliado, 'o1: link do anúncio configurado');
  assert.ok(por.o2.item.texto.includes('https://meli.la/ja-afiliado'), 'o2: link de afiliado da própria oferta mantido');
  assert.ok(por.o3.item.texto.includes('https://loja1.test/p'), 'o3: URL da loja mantida');
  for (const c of lista) assert.match(c.item.texto, /Por <b>R\$ [\d.,]+<\/b> ✅\n\n[^\n]+\nhttps:\/\//, `${c.item.ofertaId}: preço, loja e link seguem no post`);
  assert.match(por.o1.item.texto, /🎟️/, 'cupom presente no ML');
});

console.log(`✓ Posts dos grupos sem frase de afiliado: ${n} grupos passaram`);
