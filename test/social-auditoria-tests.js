// Auditoria dos posts dos grupos (25/10/2026), offline: sem rede, banco, secrets ou envio.
//   1. Teto do WhatsApp (70 em 24 h, pedido do dono em 24/10) vale numa janela móvel de 48 h simulada, no pior caso
//      (oferta nova em toda rodada, rodada a cada 10 min) e com os posts Top 3/Top 10 entrando no mesmo diário.
//   2. Madrugada (0h–7h em Brasília): só oferta nova sai.
//   3. Preço do Pix sai como "no Pix" (avulsos, Top 3 e Top 10); preço base não ganha o rótulo.
//   4. Frete desconhecido nunca vira "grátis": avulsos não falam de frete; no Top, "FRETE GRÁTIS" só com shipping=free.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planejar, registrar, REGRAS_WHATSAPP } from '../src/agents/social/auto.js';
import { montarLegenda } from '../src/agents/social/legenda.js';
import { legendaWhatsApp } from '../src/agents/social/whatsapp.js';
import { itensDaApi, legenda, arteHtml, slotAgora } from '../src/agents/social/top.js';
import { vez } from '../tools/social-top.mjs';
import { candidatos } from '../tools/social-telegram-piloto.mjs';

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const H = 3600e3;
const horaBrt = (ms) => Number(new Date(ms).toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hourCycle: 'h23' }));

t('1-2. WhatsApp: 48 h simuladas, intervalo de 30 min, teto de 70 e madrugada só com novidade', () => {
  const INICIO = Date.parse('2026-10-25T03:00:00Z');   // 0h em Brasília
  let diario = []; const envios = []; let seq = 0;
  for (let now = INICIO; now < INICIO + 48 * H; now += 10 * 60e3) {
    // Top 3/Top 10 no horário (mesma regra do tools/social-top.mjs: chave do horário + teto do diário)
    const s = slotAgora(now);
    if (s) {
      const id = `${s.tipo}:${s.chave}`; const v = vez(diario, id, now);
      if (v.pode) { diario = registrar(diario, [{ ofertaId: id, afiliado: false, at: new Date(now).toISOString() }], { now, regras: REGRAS_WHATSAPP }); envios.push({ now, id, nova: false, top: true }); }
    }
    // rodada automática: pior caso, uma oferta nova a cada rodada, mais um estoque de ofertas antigas (metade afiliada)
    const novas = [{ item: { ofertaId: `n${seq++}` }, oferta: { firstSeen: new Date(now - 5 * 60e3).toISOString() }, afiliado: false }];
    const antigas = Array.from({ length: 40 }, (_, i) => ({ item: { ofertaId: `a${i}` }, oferta: { firstSeen: '2026-10-01T00:00:00Z' }, afiliado: i % 2 === 0 }));
    const plano = planejar([...novas, ...antigas], diario, { now, regras: REGRAS_WHATSAPP });
    assert.ok(plano.enviar.length <= 1, 'no máximo 1 mensagem por rodada no WhatsApp');
    for (const c of plano.enviar) {
      const nova = c.item.ofertaId.startsWith('n');
      diario = registrar(diario, [{ ofertaId: c.item.ofertaId, afiliado: c.afiliado, at: new Date(now).toISOString() }], { now, regras: REGRAS_WHATSAPP });
      envios.push({ now, id: c.item.ofertaId, nova, top: false });
    }
  }
  for (const e of envios) {
    const janela = envios.filter((x) => x.now > e.now - 24 * H && x.now <= e.now).length;
    assert.ok(janela <= 70, `${janela} mensagens nas 24 h até ${new Date(e.now).toISOString()}`);
    const h = horaBrt(e.now);
    if (h >= 0 && h < 7 && !e.top) assert.ok(e.nova, `madrugada (${h}h): ${e.id} não é novidade`);
  }
  assert.ok(envios.some((e) => e.top), 'Top entrou no diário (conta no teto)');
  assert.ok(envios.filter((e) => e.now < INICIO + 24 * H).length >= 30, 'o canal mantém cadência diária mesmo com intervalo de 30 min');
});

// Candidatos reais (mesma função dos dois bots), Pix e base, frete desconhecido.
const NOW = Date.now(); const iso = (min) => new Date(NOW - min * 60000).toISOString();
const st = { generatedAt: iso(0), products: [{ id: 'me05-blister1', collection: 'me05', collectionName: 'ME05', type: 'blister_1', boosters: 1, name: 'Blister ME05' }],
  offers: [['pix1', 'pix', null, false], ['base1', 'base', null, false], ['frete0', 'base', 0, true]].map(([id, priceKind, shipping, shippingKnown], i) => ({
    id, productId: 'me05-blister1', storeId: `loja${i}`, storeName: `Loja ${i}`, seller: null, url: `https://loja${i}.test/p`, image: `https://loja${i}.test/i.jpg`,
    title: 'Blister ME05', price: 14.9 + i, listPrice: null, priceKind, prices: priceKind === 'pix' ? { pix: 14.9 + i, base: 15.68 + i } : { base: 14.9 + i },
    total: 14.9 + i, shippingKnown, shipping, stock: 'IN_STOCK', confirmed: true, stale: false, anomalous: false, firstSeen: iso(5000), source_timestamp: iso(5) })) };

t('3. avulsos: preço do Pix diz "no Pix" (Telegram e WhatsApp); preço base não', () => {
  const por = Object.fromEntries(candidatos(st, { now: NOW, env: {}, afiliados: {}, cupons: [] }).map((c) => [c.item.ofertaId, c]));
  assert.match(por.pix1.item.texto, /Por <b>R\$ 14,90<\/b> no Pix ✅/);
  assert.match(legendaWhatsApp(por.pix1.item.texto), /Por \*R\$ 14,90\* no Pix ✅/);
  for (const id of ['base1', 'frete0']) assert.ok(!/pix/i.test(por[id].item.texto), `${id}: sem rótulo de Pix`);
  assert.match(montarLegenda({ titulo: 'X', atual: 10, loja: 'L', link: 'https://l.test/p', pix: true }).texto, /Por <b>R\$ 10,00<\/b> no Pix ✅/);
  assert.ok(!montarLegenda({ titulo: 'X', atual: 10, loja: 'L', link: 'https://l.test/p', pix: 'sim' }).texto.includes('Pix'), 'só pix === true');
});

t('4. avulsos: frete nunca aparece no post (nem "grátis" com frete desconhecido ou zero)', () => {
  for (const c of candidatos(st, { now: NOW, env: {}, afiliados: {}, cupons: [] })) {
    assert.ok(!/fr[eê]te|gr[áa]tis/i.test(c.item.texto), `${c.item.ofertaId}: ${c.item.texto}`);
  }
});

const API = JSON.parse(fs.readFileSync(path.join(raiz, 'test/fixtures/oportunidades-top.json'), 'utf8'));
const AGORA = Date.parse('2026-10-24T20:10:00Z');
const a = { fonte: 'file:///f.woff2', logo: 'file:///l.webp', foto: () => 'file:///x.webp' };

t('3b. Top 10: rótulo PIX na arte de cada item com preço do Pix; legenda marca o Pix no menor/maior preço', () => {
  const d = itensDaApi(API, 'top10', AGORA);
  const pix = d.itens.filter((i) => i.pix).length;
  assert.ok(pix > 0 && pix < 10, 'fixture com Pix e base');
  assert.equal((arteHtml('top10', d, a).match(/>PIX<\/span>/g) || []).length, pix);
  const mudado = { ...d, itens: d.itens.map((i) => (i.preco === Math.min(...d.itens.map((x) => x.preco)) ? { ...i, pix: true } : i)) };
  assert.match(legenda('top10', mudado), /a R\$ 11,90 no Pix a /, 'menor preço do Pix marcado');
  assert.ok(!/no Pix/.test(legenda('top10', { ...d, itens: d.itens.map((i) => ({ ...i, pix: false })) })), 'sem Pix, sem rótulo');
});

t('4b. Top: "FRETE GRÁTIS" só com shipping=free; frete desconhecido nunca vira grátis', () => {
  const desconhecido = { ...API, data: API.data.map((x) => ({ ...x, shipping: 'unknown', offer: { ...x.offer, price_kind: 'base' } })) };
  for (const tipo of ['top3', 'top10']) {
    const d = itensDaApi(desconhecido, tipo, AGORA);
    assert.ok(d.itens.every((i) => i.freteGratis === false));
    assert.ok(!/FRETE GR[ÁA]TIS|frete gr[áa]tis/i.test(arteHtml(tipo, d, a) + legenda(tipo, d)), `${tipo}: sem frete grátis`);
  }
  const gratis = { ...API, data: API.data.map((x, i) => ({ ...x, shipping: i === 0 ? 'free' : 'unknown', offer: { ...x.offer, price_kind: 'base' } })) };
  assert.equal((arteHtml('top3', itensDaApi(gratis, 'top3', AGORA), a).match(/FRETE GRÁTIS/g) || []).length, 1, 'só o item com frete grátis confirmado');
});

console.log(`✓ Auditoria dos posts dos grupos: ${n} grupos passaram`);
