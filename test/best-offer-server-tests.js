// Issue #84 (continuação da #178) — servidor: a "melhor oferta" de cada produto na Home, nas listas da API do site e
// nas páginas de SEO segue a mesma regra da página do produto: frete desconhecido não disputa o "menor total" com
// quem já tem frete conhecido; se todas forem desconhecidas, vence o menor preço. Estoque não muda de classe.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { byComparableTotal, bestComparable, shipKnown } from '../api/_lib/offer-rank.mjs';
import { slimHome } from '../api/_lib/home.mjs';
import { siteProducts, siteOffers, entries, DEFAULT_F } from '../api/_lib/site.mjs';
import { bestBy } from '../api/_seo.mjs';

let n = 0; const fails = [];
const t = (name, fn) => { try { fn(); n++; } catch (e) { fails.push(`✗ ${name}\n  ${e.message}`); } };
const T = '2026-10-01T12:00:00.000Z';
const off = (id, productId, price, ship, extra = {}) => ({ id, productId, storeId: 's-' + id, storeName: 'Loja ' + id, url: 'https://x/' + id, price, priceKind: 'base',
  shipping: ship, shippingKnown: ship != null, total: ship != null ? price + ship : price, stock: 'IN_STOCK', firstSeen: T, source_timestamp: T,
  confirmed: true, anomalous: false, stale: false, discount: null, ...extra });
const prod = (id) => ({ id, collection: 'c1', collectionName: 'Coleção', type: 'etb', typeLabel: 'ETB', group: 'ETB', copagConfirmed: true, msrp: 200, offerCount: 2 });
// p1 = exemplo da issue: A R$ 100 com frete desconhecido × B R$ 105 com frete grátis conhecido
const A = off('a', 'p1', 100, null); const B = off('b', 'p1', 105, 0);
// p2 = todas com frete desconhecido: vence o menor preço (D)
const C = off('c', 'p2', 90, null); const D = off('d', 'p2', 80, null);
// p3 = frete conhecido com custo: total (preço + frete) decide entre as conhecidas; a desconhecida mais barata não entra
const E = off('e', 'p3', 100, 30); const F = off('f', 'p3', 110, 10); const G = off('g', 'p3', 60, null);
// p4 = estoque desconhecido continua desconhecido (não vira "com estoque" nem "sem estoque")
const H = off('h', 'p4', 50, 0, { stock: 'UNKNOWN' }); const I = off('i', 'p4', 70, 5);
const st = { generatedAt: T, products: ['p1', 'p2', 'p3', 'p4'].map(prod), offers: [A, B, C, D, E, F, G, H, I], collections: [{ id: 'c1', name: 'Coleção' }], types: [{ id: 'etb', label: 'ETB', group: 'ETB' }] };

t('comparador único: frete conhecido antes, total, id', () => {
  assert.equal([A, B].sort(byComparableTotal)[0].id, 'b', 'A (R$ 100, frete desconhecido) não vence B (R$ 105, frete grátis)');
  assert.equal([B, A].sort(byComparableTotal)[0].id, 'b', 'independe da ordem de entrada');
  assert.equal(bestComparable([C, D]).id, 'd', 'só frete desconhecido: menor preço');
  assert.equal(bestComparable([E, F, G]).id, 'f', 'entre conhecidas, o total (110+10 < 100+30)');
  assert.equal(bestComparable([]), null);
  assert.equal(shipKnown({ shippingKnown: true, shipping: 0 }), true, 'frete grátis é conhecido');
  assert.equal(shipKnown({ shipping: 0 }), false, 'sem shippingKnown, o frete é desconhecido (mesma regra do site)');
});

t('Home (slimHome): só a oferta comparável vai como melhor; a de frete desconhecido não substitui a conhecida', () => {
  const h = slimHome(st, { now: Date.parse(T) });
  const ids = new Set(h.offers.map((o) => o.id));
  assert.ok(ids.has('b'), 'B vai para a Home');
  assert.ok(!ids.has('a'), 'A (frete desconhecido) não é a melhor de nenhum recorte da Home');
  assert.ok(ids.has('d') && !ids.has('c'), 'só desconhecidas: a de menor preço');
  assert.ok(ids.has('f') && !ids.has('g') && !ids.has('e'), 'conhecidas pelo total; a desconhecida mais barata fica de fora');
  // o site escolhe entre as ofertas que a Home envia com o byTot da página: com o envio corrigido ele mostra B
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const line = html.slice(html.indexOf('const byTot='), html.indexOf('\n', html.indexOf('const byTot=')));
  const ctx = vm.createContext({ String }); vm.runInContext(line + ';globalThis.byTot=byTot;', ctx);
  const liveP1 = h.offers.filter((o) => o.productId === 'p1' && o.stock === 'IN_STOCK').sort(ctx.byTot);
  assert.equal(liveP1[0].id, 'b', 'a Home mostra B, igual à página do produto');
  // estoque desconhecido não é contado como "com estoque" nem some
  const p4 = h.products.find((p) => p.id === 'p4'); assert.equal(p4.liveCount, 1, 'só I conta como com estoque');
  const hh = h.offers.find((o) => o.id === 'h'); assert.ok(hh, 'H (estoque desconhecido) continua candidata do recorte sem filtro de estoque');
  assert.equal(hh.stock, 'UNKNOWN', 'estoque desconhecido continua desconhecido');
});

t('API do site (/produtos): o cartão de cada produto traz a melhor oferta comparável', () => {
  const r = siteProducts(st, {}, { limit: 50 });
  const by = Object.fromEntries(r.items.map((e) => [e.p.id, e.o.id]));
  assert.equal(by.p1, 'b'); assert.equal(by.p2, 'd'); assert.equal(by.p3, 'f'); assert.equal(by.p4, 'i', 'com filtro de estoque, H (estoque desconhecido) não entra');
  const off2 = Object.fromEntries(entries(st, { ...DEFAULT_F, stock: false }).map((e) => [e.p.id, e.o.id]));
  assert.equal(off2.p1, 'b', 'sem filtro de estoque, a regra do frete continua');
  assert.equal(off2.p4, 'h', 'sem filtro de estoque, H entra com o estoque que tem (desconhecido), sem virar disponível');
  // modo "Para abrir" (preço por booster): mesma regra
  const pb = (o) => ({ ...o, perBooster: o.total / 10 });
  const st2 = { ...st, offers: st.offers.map(pb) };
  const ab = Object.fromEntries(entries(st2, { ...DEFAULT_F, mode: 'abrir' }).map((e) => [e.p.id, e.o.id]));
  assert.equal(ab.p1, 'b', 'por booster, a de frete desconhecido também não vence a conhecida');
});

t('API do site (coleção/tipo/busca): as candidatas enviadas não incluem a de frete desconhecido quando há conhecida', () => {
  const r = siteOffers(st, { ids: ['p1', 'p2', 'p3'] });
  const ids = new Set(r.offers.map((o) => o.id));
  assert.ok(ids.has('b') && !ids.has('a'));
  assert.ok(ids.has('d') && !ids.has('c'));
  assert.ok(ids.has('f') && !ids.has('g'));
  // produto sem nenhuma oferta com estoque: o cartão "sem estoque" continua tendo candidata (e a de frete conhecido vence)
  const J = off('j', 'p5', 40, null, { stock: 'OUT_OF_STOCK' }); const K = off('k', 'p5', 50, 0, { stock: 'OUT_OF_STOCK' });
  const r5 = siteOffers({ ...st, products: [...st.products, prod('p5')], offers: [...st.offers, J, K] }, { ids: ['p5'] });
  assert.deepEqual(r5.offers.map((o) => o.id), ['k']);
});

t('SEO (bestBy): melhor oferta com estoque pela mesma regra; contagem de lojas inalterada', () => {
  const { by, n: cnt } = bestBy(st);
  assert.equal(by.p1.id, 'b'); assert.equal(by.p2.id, 'd'); assert.equal(by.p3.id, 'f'); assert.equal(by.p4.id, 'i');
  assert.deepEqual(cnt, { p1: 2, p2: 2, p3: 3, p4: 1 }, 'H (estoque desconhecido) não conta como com estoque');
});

if (fails.length) { console.error(fails.join('\n')); throw new Error(`melhor oferta no servidor (issue #84): ${fails.length} grupo(s) falharam`); }
console.log(`OK — melhor oferta no servidor com frete comparável (issue #84): ${n} grupos`);
