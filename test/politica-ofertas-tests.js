// Política de ofertas e afiliados (docs/politica-ofertas.md) — testes de CARACTERIZAÇÃO: travam o comportamento ATUAL
// das regras que ainda não tinham teste, sem mudar código. Vários casos registram DIVERGÊNCIAS entre superfícies (site,
// API v1, Monte seu kit, grupos); se uma divergência for corrigida por decisão do dono, atualize o caso junto com a
// correção e o documento. Offline: sem rede, banco, Firebase ou secrets.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { byComparableTotal, setTiePreference } from '../api/_lib/offer-rank.mjs';
import { afiliadoPreferido, parseAffiliates } from '../api/_lib/affiliates.mjs';
import { stateProductOffers } from '../api/_lib/read-state.mjs';
import { live as siteLive } from '../api/_lib/site.mjs';
import { melhoresOfertas, compararLojas } from '../api/_lib/kit.mjs';
import { ofertaElegivel, MOTIVOS } from '../src/agents/social/elegiveis.js';
import { planejar } from '../src/agents/social/auto.js';
import { oppOrder } from '../src/core/opportunity-engine.js';
import { candidatos } from '../tools/social-telegram-piloto.mjs';

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } finally { setTiePreference(null); } };
const src = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const ids = (l) => l.map((o) => o.id);
const ML = (item) => `https://www.mercadolivre.com.br/p/MLB27711554?pdp_filters=item_id%3A${item}`;
const CFG = parseAffiliates({ mercadolivre: { anuncios: { MLB7000000001: 'https://meli.la/aaa' } } });

// ---------------------------------------------------------------- Grupos: afiliado na frente (exceção vigente, dono 18/10)
const NOW = Date.now(); const iso = (min) => new Date(NOW - min * 60000).toISOString();
const produto = { id: 'me04-box36', collection: 'me04', collectionName: 'ME04', type: 'booster_box', typeLabel: 'Booster Box', boosters: 36, name: 'Box ME04' };
const ofSt = (id, storeId, url, price) => ({ id, productId: produto.id, storeId, storeName: storeId, seller: 'X', url, image: `https://${storeId}.test/i.jpg`,
  title: 'Box ME04', price, total: price, shippingKnown: true, shipping: 0, stock: 'IN_STOCK', confirmed: true, stale: false, anomalous: false,
  firstSeen: iso(5000), source_timestamp: iso(5) });

t('grupos: candidatos() põe a oferta com link de afiliado antes de ofertas mais baratas; as demais seguem por menor total', () => {
  const st = { generatedAt: iso(0), products: [produto], offers: [
    ofSt('o-af', 'mercadolivre', 'https://produto.mercadolivre.com.br/MLB-7000000001-box-_JM', 950),
    ofSt('o-barata', 'loja1', 'https://loja1.test/p', 900),
    ofSt('o-media', 'loja2', 'https://loja2.test/p', 905),
  ] };
  const lista = candidatos(st, { now: NOW, env: {}, afiliados: { anuncios: { MLB7000000001: 'https://meli.la/aaa' } }, cupons: [] });
  assert.deepEqual(lista.map((c) => [c.item.ofertaId, c.afiliado]), [['o-af', true], ['o-barata', false], ['o-media', false]]);
  const sem = candidatos(st, { now: NOW, env: {}, afiliados: {}, cupons: [] });
  assert.deepEqual(sem.map((c) => c.item.ofertaId), ['o-barata', 'o-media', 'o-af'], 'sem mapa de afiliado: ordem do menor total');
});

t('grupos: planejar() escolhe a afiliada mesmo atrás na fila (fura a ordem), fora do espaçamento entre afiliadas', () => {
  const T = Date.parse('2026-10-14T15:00:00Z');   // 12h em Brasília (fora da madrugada)
  const c = (id, afiliado = false) => ({ item: { ofertaId: id }, oferta: { firstSeen: new Date(T - 5000 * 60e3).toISOString() }, afiliado });
  const p = planejar([c('barata'), c('outra'), c('af', true)], [], { now: T });
  assert.equal(p.enviar[0].item.ofertaId, 'af'); assert.match(p.motivo, /afiliado/);
});

// ---------------------------------------------------------------- Site (cliente): byTot ignora a situação do frete
const html = src('index.html');
const line = (name) => { const m = html.match(new RegExp(`^(?:const|let) ${name}\\s*=.*$`, 'm')); assert.ok(m, `index.html: ${name} não encontrado`); return m[0]; };
const ctx = { String, Object, URL }; vm.createContext(ctx);
vm.runInContext([line('AFIL'), line('mlItem'), line('afPref'), line('live'), line('shipOk'), line('shipCmp'), line('byTot'), line('OFFER_SORTS'),
  ';globalThis.__t={byTot,OFFER_SORTS};'].join('\n'), ctx);
const off = (id, price, shipping = null, extra = {}) => ({ id, productId: produto.id, storeId: id, storeName: id, url: `https://${id}.test/p`, price,
  shipping, shippingKnown: shipping != null, total: shipping != null ? price + shipping : price, stock: 'IN_STOCK', stale: false, anomalous: false, ...extra });

t('site: byTot da página (grade de coleção/formato, alertas) segue a #84 como produto e servidor (D2 resolvida)', () => {
  const semFrete = off('a-semfrete', 90); const comFrete = off('b-comfrete', 95, 5);
  // D2 resolvida (#978): antes o byTot só olhava o total e o preço sem frete vencia.
  assert.deepEqual(ids([comFrete, semFrete].sort(ctx.__t.byTot)), ['b-comfrete', 'a-semfrete'], 'byTot: frete conhecido antes (#84)');
  assert.deepEqual(ids([semFrete, comFrete].sort(ctx.__t.OFFER_SORTS.price)), ['b-comfrete', 'a-semfrete'], 'página do produto: frete conhecido antes (#84)');
  assert.deepEqual(ids([semFrete, comFrete].sort(byComparableTotal)), ['b-comfrete', 'a-semfrete'], 'servidor: frete conhecido antes (#84)');
  assert.match(html, /function renderGroup[\s\S]{0,900}byTot\(o,best\[o\.productId\]\)/, 'grade de /colecao e /tipo usa byTot');
  assert.match(html, /const bestLive=\(pid\)=>OFF\.filter\([^\n]*\.sort\(byTot\)/, 'alertas (bestLive) usam byTot');
});

// ---------------------------------------------------------------- API v1: ofertas do produto por preço, não por total
const stPrd = (offers) => ({ generatedAt: iso(0), products: [produto], collections: [{ id: 'me04', name: 'ME04' }], offers });

t('API v1 (fallback state.json): /produtos/:id/ofertas ordena ativa > em estoque > menor preço > id; frete e afiliado não entram', () => {
  setTiePreference(afiliadoPreferido(CFG));   // registrado como em api/v1.mjs
  const st = stPrd([
    off('b-gratis', 101, 0, { source_timestamp: iso(5) }),
    off('z-af', 100, null, { url: ML('MLB7000000001'), source_timestamp: iso(5) }),
    off('a-pix', 100, null, { prices: { pix: 100, base: 105 }, priceKind: 'pix', source_timestamp: iso(5) }),
    off('c-esgotada', 50, 0, { stock: 'OUT_OF_STOCK', source_timestamp: iso(5) }),
    off('d-stale', 10, 0, { stale: true, source_timestamp: iso(500) }),
  ]);
  const r = stateProductOffers(st, produto.id, { page: 1, limit: 10 });
  assert.deepEqual(ids(r.items), ['a-pix', 'z-af', 'b-gratis', 'c-esgotada', 'd-stale']);
  const vivas = st.offers.filter(siteLive).sort(byComparableTotal);
  assert.deepEqual(ids(vivas), ['b-gratis', 'z-af', 'a-pix'], 'DIVERGÊNCIA: o site põe frete conhecido antes e desempata a favor do afiliado');
  const a = r.items[0];
  assert.deepEqual([a.price, a.price_kind, a.pix_price, a.shipping.status, a.total_price], [100, 'pix', 100, 'unknown', null], 'Pix marcado; total nulo sem frete');
  const b = r.items[2]; assert.deepEqual([b.shipping, b.total_price], [{ status: 'free', price: 0 }, 101]);
  assert.equal(r.items[4].status, 'pending');
});

t('API v1 (banco): mesma ordem no SQL de productOffers', () => {
  assert.match(src('api/_lib/read-db.mjs'), /ORDER BY \(o\.status = 'active'\) DESC, \(o\.stock_status = 'in_stock'\) DESC, o\.price ASC NULLS LAST, o\.legacy_id/);
});

// ---------------------------------------------------------------- Opportunity: view do banco × motor JS no desempate
t('Opportunity: view product_opportunity desempata por preço; o motor (oppOrder) por frete conhecido e custo total', () => {
  const tie = 'ORDER BY o.product_id, o.opportunity_score DESC, o.confidence DESC, o.price ASC, o.offer_id';
  assert.ok(src('db/migrations/008_opportunity_reference_comparison.sql').includes(tie), 'view atual (migration 008)');
  assert.ok(src('api/_lib/read-db.mjs').includes('ORDER BY ox.product_id, ox.opportunity_score DESC, ox.confidence DESC, ox.price ASC, ox.offer_id'), 'listOpportunities com loja/max');
  const semFrete = { offer_id: 1, opportunity_score: 80, confidence: 0.9, price: 90, total_cost: 90, cost_basis: 'price_only' };
  const comFrete = { offer_id: 2, opportunity_score: 80, confidence: 0.9, price: 95, total_cost: 100, cost_basis: 'total' };
  assert.deepEqual([semFrete, comFrete].sort(oppOrder).map((x) => x.offer_id), [2, 1], 'motor: frete conhecido antes (a view escolheria a 1, preço menor)');
});

// ---------------------------------------------------------------- Monte seu kit: recomendação × cesta
t('kit: recomendar (melhoresOfertas) usa o critério do site; a cesta (compararLojas) usa o menor preço', () => {
  const semFrete = off('a-semfrete', 90, null, { url: 'https://a.test/p' }); const comFrete = off('b-comfrete', 95, 5, { url: 'https://b.test/p' });
  assert.equal(melhoresOfertas([semFrete, comFrete]).get(produto.id).id, 'b-comfrete', 'frete conhecido antes, mesmo R$ 5 mais caro');
  const c = compararLojas([{ productId: produto.id, quantidade: 1 }], [semFrete, comFrete]);
  assert.equal(c.dividir.itens[0].oferta.id, 'a-semfrete', 'cesta: menor preço (correção de 24/10)');
  assert.equal(c.dividir.total, null, 'frete desconhecido nunca vira zero');
});

// ---------------------------------------------------------------- Disponibilidade: o que cada superfície aceita
t('disponibilidade: site e kit aceitam leitura não confirmada e antiga; grupos exigem confirmada e frescor "atual"; pré-venda fora de todos', () => {
  const T = Date.now(); const velha = new Date(T - 180 * 60e3).toISOString();
  const naoConf = off('nc', 100, 0, { url: 'https://nc.test/p', confirmed: false, source_timestamp: new Date(T - 5 * 60e3).toISOString() });
  const antiga = off('old', 100, 0, { url: 'https://old.test/p', confirmed: true, source_timestamp: velha });
  const pre = off('pre', 100, 0, { url: 'https://pre.test/p', stock: 'PRE_ORDER', confirmed: true, source_timestamp: new Date(T).toISOString() });
  assert.equal(siteLive(naoConf), true, 'site: confirmed=false continua viva');
  assert.equal(siteLive(antiga), true, 'site: idade da leitura não entra em live (só stale)');
  assert.equal(melhoresOfertas([naoConf]).size, 1, 'kit: confirmed=false entra');
  assert.equal(melhoresOfertas([antiga]).size, 1, 'kit: idade da leitura não entra (só stale)');
  assert.equal(ofertaElegivel(naoConf, { now: T }).motivo, MOTIVOS.NAO_CONFIRMADA);
  assert.equal(ofertaElegivel(antiga, { now: T }).motivo, MOTIVOS.FRESCOR);
  assert.equal(siteLive(pre), false); assert.equal(melhoresOfertas([pre]).size, 0); assert.equal(ofertaElegivel(pre, { now: T }).motivo, MOTIVOS.ESTOQUE);
  assert.equal(stateProductOffers(stPrd([pre]), produto.id, { page: 1, limit: 5 }).items[0].stock, 'preorder', 'API v1 lista a pré-venda marcada');
});

console.log(`✓ Política de ofertas (caracterização): ${n} grupos passaram`);
