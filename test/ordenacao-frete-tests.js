// Ordenação com frete desconhecido no cliente (index.html, achado D2 de docs/politica-ofertas.md).
// Regra do projeto (issue #84, api/_lib/offer-rank.mjs): sem frete informado, o "total" da oferta é só o preço e não se compara
// com um total que já inclui o frete. Então, entre ofertas do mesmo produto:
//  • frete conhecido (grátis inclui) vem antes, pelo menor total;
//  • "preço + frete desconhecido" nunca vence nem empata com total confirmado, por mais barato que pareça;
//  • se todas têm frete desconhecido, vence o menor preço (o card mostra "Preço antes do frete");
//  • nenhuma oferta some: a regra só ordena.
// `byTot` (grade de /colecao e /tipo, `bestLive` dos alertas, `bestOfferFor`) tem de seguir a mesma regra de
// OFFER_SORTS.price (página do produto) e de byComparableTotal (servidor/SSR). Sem rede: só lê index.html.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path'; import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { byComparableTotal, setTiePreference } from '../api/_lib/offer-rank.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { e.message = `${name}: ${e.message}`; throw e; } };

const line = (re, name) => { const m = html.match(re); assert.ok(m, `index.html: ${name} não encontrado`); return m[0]; };
const decl = (name) => line(new RegExp(`^(?:const|let) ${name}\\s*=.*$`, 'm'), name);
const ctx = { String, Object, URL, OFF: [] }; vm.createContext(ctx);
vm.runInContext([decl('AFIL'), decl('mlItem'), decl('afPref'), decl('live'), decl('shipOk'), decl('shipCmp'), decl('byTot'), decl('bestLive'),
  line(/^function bestOfferFor\(pid\)\{.*$/m, 'bestOfferFor'), decl('OFFER_SORTS'),
  ';globalThis.__t={byTot,bestLive,bestOfferFor,OFFER_SORTS,afPref,setAf(a){AFIL.anuncios=a}};'].join('\n'), ctx);
const { byTot, bestLive, bestOfferFor, OFFER_SORTS } = ctx.__t;

const off = (id, price, shipping = null, extra = {}) => ({ id, productId: 'p1', storeId: id, storeName: id, url: `https://${id}.test/p`, price,
  shipping, shippingKnown: shipping != null, total: shipping != null ? price + shipping : price, stock: 'IN_STOCK', stale: false, anomalous: false, ...extra });
const ids = (l) => l.map((o) => o.id);
const sorted = (l, cmp) => [...l].sort(cmp);

t('frete desconhecido não vence total confirmado, mesmo com preço bem menor', () => {
  const semFrete = off('a-semfrete', 50); const comFrete = off('b-comfrete', 95, 25);
  assert.deepEqual(ids(sorted([semFrete, comFrete], byTot)), ['b-comfrete', 'a-semfrete']);
  assert.deepEqual(ids(sorted([comFrete, semFrete], byTot)), ['b-comfrete', 'a-semfrete']);
  assert.ok(byTot(semFrete, comFrete) > 0 && byTot(comFrete, semFrete) < 0);
});

t('preço sem frete igual ao total confirmado não empata: o confirmado fica antes', () => {
  const semFrete = off('a-semfrete', 100); const comFrete = off('z-comfrete', 90, 10);
  assert.equal(semFrete.total, comFrete.total);
  assert.ok(byTot(semFrete, comFrete) > 0, 'não pode dar 0 nem negativo (nem o desempate por id decide)');
});

t('frete grátis conta como conhecido', () => {
  const gratis = off('b-gratis', 101, 0); const semFrete = off('a-semfrete', 99);
  assert.deepEqual(ids(sorted([semFrete, gratis], byTot)), ['b-gratis', 'a-semfrete']);
});

t('entre conhecidos, menor total; entre desconhecidos, menor preço', () => {
  const l = [off('k-120', 100, 20), off('u-80', 80), off('k-110', 105, 5), off('u-70', 70), off('k-gratis-115', 115, 0)];
  assert.deepEqual(ids(sorted(l, byTot)), ['k-110', 'k-gratis-115', 'k-120', 'u-70', 'u-80']);
  const todosSem = [off('u-90', 90), off('u-60', 60), off('u-75', 75)];
  assert.deepEqual(ids(sorted(todosSem, byTot)), ['u-60', 'u-75', 'u-90'], 'todas sem frete: menor preço vence');
});

t('nenhuma oferta some e shippingKnown ausente/false conta como desconhecido', () => {
  const l = [off('a', 10, null, { shippingKnown: undefined }), off('b', 20, null, { shippingKnown: false, shipping: 0, total: 20 }), off('c', 30, 5)];
  const r = sorted(l, byTot);
  assert.equal(r.length, l.length);
  assert.deepEqual(ids(r), ['c', 'a', 'b'], 'frete 0 com shippingKnown:false não é frete grátis');
});

t('desempate do afiliado só dentro da mesma situação de frete e do mesmo total', () => {
  ctx.__t.setAf({ MLB7000000001: 'https://meli.la/aaa' });
  const af = (id, price, shipping) => off(id, price, shipping, { url: 'https://www.mercadolivre.com.br/p/MLB27711554?pdp_filters=item_id%3AMLB7000000001' });
  const afSem = af('z-af-sem', 100, null);
  assert.equal(ctx.__t.afPref(afSem), 1, 'anúncio do mapa reconhecido');
  assert.deepEqual(ids(sorted([off('a-sem', 100), afSem], byTot)), ['z-af-sem', 'a-sem'], 'mesmo preço, ambos sem frete: afiliado antes');
  assert.deepEqual(ids(sorted([afSem, off('b-com', 95, 5)], byTot)), ['b-com', 'z-af-sem'], 'afiliado sem frete não passa total confirmado igual');
  assert.deepEqual(ids(sorted([off('a-com', 100, 0), af('z-af-com', 101, 0)], byTot)), ['a-com', 'z-af-com'], 'afiliado não passa oferta mais barata');
  assert.deepEqual(ids(sorted([off('a-com', 100, 0), af('z-af-com', 100, 0)], byTot)), ['z-af-com', 'a-com'], 'mesmo total confirmado: afiliado antes');
  ctx.__t.setAf({});
});

t('byTot concorda com OFFER_SORTS.price (produto) e byComparableTotal (servidor) em listas sorteadas', () => {
  setTiePreference(null);
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let k = 0; k < 300; k++) {
    const l = Array.from({ length: 2 + Math.floor(rnd() * 6) }, (_, i) => {
      const price = 50 + Math.floor(rnd() * 8) * 5; const ship = rnd() < 0.5 ? null : Math.floor(rnd() * 4) * 5;
      return off(`o${i}-${k}`, price, ship);
    });
    const a = ids(sorted(l, byTot));
    assert.deepEqual(a, ids(sorted(l, byComparableTotal)), `servidor, lista ${k}`);
    // OFFER_SORTS.price não desempata por id: compara só a ordem de (situação do frete, total)
    const key = (o) => `${o.shippingKnown ? 0 : 1}:${o.total}`;
    assert.deepEqual(sorted(l, byTot).map(key), sorted(l, OFFER_SORTS.price).map(key), `página do produto, lista ${k}`);
  }
});

t('alertas (bestLive) e bestOfferFor escolhem a oferta com frete conhecido', () => {
  ctx.OFF = [off('a-semfrete', 50), off('b-comfrete', 95, 25), off('c-esgotada', 10, 0, { stock: 'OUT_OF_STOCK' })];
  vm.runInContext('OFF=globalThis.OFF', ctx);
  assert.equal(bestLive('p1').id, 'b-comfrete');
  assert.equal(bestOfferFor('p1').id, 'b-comfrete');
  ctx.OFF = [off('a-semfrete', 50), off('d-semfrete', 40)]; vm.runInContext('OFF=globalThis.OFF', ctx);
  assert.equal(bestLive('p1').id, 'd-semfrete', 'todas sem frete: menor preço, sem esconder a oferta');
});

t('grade de /colecao e /tipo, alertas e bestOfferFor usam byTot; o card marca "Preço antes do frete"', () => {
  assert.match(html, /function renderGroup[\s\S]{0,900}byTot\(o,best\[o\.productId\]\)/, 'grade de /colecao e /tipo usa byTot');
  assert.match(html, /const bestLive=\(pid\)=>OFF\.filter\([^\n]*\.sort\(byTot\)/, 'alertas (bestLive) usam byTot');
  assert.match(html, /function bestOfferFor\(pid\)\{[^\n]*byTot\(a,b\)/, 'bestOfferFor usa byTot');
  assert.match(html, /"Preço antes do frete"/, 'oferta sem frete continua marcada no card');
});

console.log(`✓ ordenacao-frete: ${n} testes ok`);
