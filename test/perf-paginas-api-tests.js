// Lote F (último trecho): /precos, /pistas, /pre-vendas e /lojas sem baixar o state.json no navegador.
// 1) contrato de GET /api/v1/site/pagina/{copag,pistas,prevenda,lojas} (fonte state.json, sem banco);
// 2) o código real do index.html (apiPageReady → loadPage → apiGet → API real) monta as quatro páginas sem fetchState,
//    e o HTML sai idêntico ao do estado completo; 3) API fora do ar: cai no state.json (ensureFull), como antes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { setLegacyLoader } from '../api/_lib/legacy.mjs';
import { slimHome } from '../api/_lib/home.mjs';
import { normalizeLojas } from '../api/_lib/lojas.mjs';

const now = Date.now(); const T = (h) => new Date(now - h * 3600e3).toISOString();
const fx = () => ({
  generatedAt: T(0), dataAt: T(0), coverage: { stores: 4 }, totals: { offers: 7 },
  collections: [{ id: 'me05', name: 'Escuridão Absoluta', series: 'Megaevolução', aliases: [] }, { id: 'sv9', name: 'Amigos de Jornada', series: 'Escarlate e Violeta', aliases: [] }, { id: 'old', name: 'Coleção Antiga', series: 'Antigas', aliases: [] }],
  types: [{ id: 'etb', label: 'Treinador Avançado (ETB)', group: 'ETB' }, { id: 'blister_3', label: 'Blister Triplo', group: 'Blisters' }, { id: 'lata', label: 'Lata', group: 'Latas' }],
  products: [
    { id: 'me05-etb', collection: 'me05', collectionName: 'Escuridão Absoluta', type: 'etb', typeLabel: 'Treinador Avançado (ETB)', group: 'ETB', boosters: 9, image: 'https://img/etb.png', firstSeen: T(48),
      copagConfirmed: true, msrp: 400, copag: { source_url: 'https://www.copagloja.com.br/etb/p', confidence: 'OFICIAL', source_timestamp: T(10), interno: 'x' }, offerCount: 3 },
    { id: 'me05-b3a', collection: 'me05', collectionName: 'Escuridão Absoluta', type: 'blister_3', typeLabel: 'Blister Triplo', group: 'Blisters', boosters: 3, variant: 'Zorua', image: 'https://img/b3a.png',
      copagConfirmed: true, msrp: 70, copag: { source_url: 'https://www.copagloja.com.br/b3/p', manual: false, msrp_updated_at: T(20) }, offerCount: 0 },              // sem oferta: só na tabela Copag
    { id: 'me05-b3b', collection: 'me05', collectionName: 'Escuridão Absoluta', type: 'blister_3', typeLabel: 'Blister Triplo', group: 'Blisters', boosters: 3, variant: 'Abra', image: 'https://img/b3b.png',
      copagConfirmed: true, msrp: 70, copag: { source_url: 'https://www.copagloja.com.br/b3/p', manual: false, msrp_updated_at: T(20) }, offerCount: 0 },              // mesmo rótulo: a ordem do estado decide
    { id: 'sv9-lata2', collection: 'sv9', collectionName: 'Amigos de Jornada', type: 'lata', typeLabel: 'Lata', group: 'Latas', boosters: 4, variant: 'Eevee', copagConfirmed: false, msrp: null, copagReference: 89.9, offerCount: 0 },   // sem oferta, antes de uma com oferta e mesmo rótulo
    { id: 'sv9-lata', collection: 'sv9', collectionName: 'Amigos de Jornada', type: 'lata', typeLabel: 'Lata', group: 'Latas', boosters: 4, image: 'https://img/lata.png', firstSeen: T(48),
      copagConfirmed: false, msrp: null, copagReference: 99.9, copagReferenceUrl: 'https://ref/lata', offerCount: 2 },
    { id: 'old-lata', collection: 'old', collectionName: 'Coleção Antiga', type: 'lata', typeLabel: 'Lata', group: 'Latas', boosters: 4, image: 'https://img/old.png', copagConfirmed: false, msrp: null, offerCount: 0 },
  ],
  offers: [
    { id: 'oa', productId: 'me05-etb', storeId: 'a', storeName: 'Loja A', url: 'https://a.com.br/products/etb', image: 'https://a/i.png', price: 380, total: 380, stock: 'IN_STOCK', source_timestamp: T(1), discount: 0.05, opp: { score: 80, band: 'boa' } },
    { id: 'ob', productId: 'me05-etb', storeId: 'b', storeName: 'Loja B', url: 'https://b.com.br/etb/p', price: 360, shipping: 20, shippingKnown: true, total: 380, stock: 'IN_STOCK', source_timestamp: T(2) },
    { id: 'oc', productId: 'me05-etb', storeId: 'mercadolivre', storeName: 'Mercado Livre', url: 'https://ml/p/1', price: 300, total: 300, stock: 'OUT_OF_STOCK', source_timestamp: T(1) },
    { id: 'pz', productId: 'sv9-lata', storeId: 'a', storeName: 'Loja A', url: 'https://a.com.br/products/lata', price: 95, total: 95, stock: 'PRE_ORDER', releaseDate: '2026-11-20', source_timestamp: T(1) },
    { id: 'pb', productId: 'sv9-lata', storeId: 'b', storeName: 'Loja B', url: 'https://b.com.br/lata/p', price: 95, total: 95, stock: 'PRE_ORDER', source_timestamp: T(1) },       // empate: fica a primeira (pz), não a de menor id
    { id: 'pc', productId: 'me05-etb', storeId: 'b', storeName: 'Loja B', url: 'https://b.com.br/etb2/p', price: 410, total: 410, stock: 'PRE_ORDER', source_timestamp: T(1) },
  ],
  activity: [],
  tips: [
    { key: 'tg:1', id: 't1', source: 'Telegram x', title: 'ETB barata', text: 'texto bruto do canal', postUrl: 'https://t.me/x/1', why: ['a'], productId: 'me05-etb', collectionName: 'Escuridão Absoluta', label: 'ETB', store: 'Mercado Livre', price: 330, discount: 0.175, postedAt: T(3), firstSeen: T(3), url: 'https://meli.la/1', expired: false, anomalous: false },
    { key: 'tg:2', id: 't2', source: 'Telegram y', title: 'Blister', text: 'bruto', productId: 'me05-b3a', collectionName: 'Escuridão Absoluta', label: 'Blister Triplo', store: 'loja.com.br', price: 50, discount: 0.28, postedAt: T(5), url: 'https://loja.com.br/b3' },   // produto sem oferta
    { key: 'tg:3', id: 't3', source: 'Telegram x', title: 'Coisa qualquer', text: 'bruto', price: 10, postedAt: T(6), url: 'https://x.com/1' },                       // não identificada
    { key: 'tg:4', id: 't4', source: 'Telegram x', title: 'Lata', productId: 'sv9-lata', price: 80, postedAt: T(9), url: 'https://x.com/2', expired: true },           // encerrada
  ],
  sources: [{ id: 'a', name: 'Loja A', url: 'https://a.com.br', status: 'ACTIVE', score: { evidence: ['CNPJ'] } }, { id: 'b', name: 'Loja B', url: 'https://b.com.br', status: 'ACTIVE' },
    { id: 'mercadolivre', name: 'Mercado Livre', url: 'https://api.mercadolibre.com', status: 'ACTIVE', platform: 'mercadolivre' }, { id: 'c', name: 'Loja C', url: 'https://c.com.br', status: 'BLOCKED', httpStatus: 403 },
    { id: 'd', name: 'Loja D', url: 'https://lojad.com.br', status: 'PAUSED' }, { id: 'shopee', name: 'Shopee', url: 'https://shopee.com.br', status: 'UNAVAILABLE' }],
  reputation: { consultadoEm: '2026-10-01', lojas: { a: { status: 'BOM' }, b: { status: 'BOM' }, z: { status: 'RUIM' } } },
  distrust: null,
});
const t = async (name, fn) => { try { await fn(); } catch (e) { e.message = `${name}: ${e.message}`; throw e; } };

setLegacyLoader(async () => fx());
delete process.env.API_DATABASE_URL;
const { default: api, _cache } = await import('../api/v1.mjs');
let apiDown = false; const hits = [];
async function call(url) {
  hits.push(url);
  if (apiDown) return { statusCode: 500, body: '{"error":"x"}', headers: {} };
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  await api({ url, method: 'GET', headers: {} }, res, {}); return res;
}
const get = async (k) => { const r = await call('/api/v1/site/pagina/' + k); return { ...r, json: JSON.parse(r.body) }; };

// ------------------------------------------------------------------ 1) contrato
await t('copag: todos os produtos (inclusive sem oferta), na ordem do estado, só campos da tabela', async () => {
  const r = await get('copag'); assert.equal(r.statusCode, 200); assert.equal(r.json.v, 1); assert.equal(r.json.source, 'state');
  assert.deepEqual(Object.keys(r.json).sort(), ['freshness', 'products', 'source', 'v']);
  assert.deepEqual(r.json.products.map((p) => p.id), fx().products.map((p) => p.id));
  const etb = r.json.products[0];
  assert.deepEqual(etb.copag, { source_url: 'https://www.copagloja.com.br/etb/p', source_timestamp: fx().products[0].copag.source_timestamp }, 'só a fonte, sem campos internos');
  assert.equal(etb.offerCount, 3); assert.equal('collectionName' in etb, false, 'nome da coleção vem da lista (hydP)'); assert.equal('image' in etb, false);
  const lata = r.json.products.find((p) => p.id === 'sv9-lata');
  assert.equal(lata.copagReference, 99.9); assert.equal(lata.copagReferenceUrl, 'https://ref/lata'); assert.equal('copag' in lata, false); assert.equal('copagConfirmed' in lata, false);
  assert.match(r.headers['Cache-Control'], /s-maxage=60/);
});
await t('pistas: todas as pistas sem o texto bruto, e os produtos citados', async () => {
  const r = await get('pistas');
  assert.deepEqual(r.json.tips.map((x) => x.id), ['t1', 't2', 't3', 't4']);
  for (const x of r.json.tips) for (const k of ['text', 'key', 'postUrl', 'why']) assert.equal(k in x, false, `campo ${k}`);
  assert.equal(r.json.tips[0].discount, 0.175); assert.equal('expired' in r.json.tips[0], false); assert.equal(r.json.tips[3].expired, true);
  assert.deepEqual(r.json.products.map((p) => p.id), ['me05-etb', 'me05-b3a', 'sv9-lata']);
  assert.equal(r.json.products[1].image, 'https://img/b3a.png', 'foto do cartão');
});
await t('prevenda: menor total por produto (empate: a primeira do estado), com lojas e reputação só delas', async () => {
  const r = await get('prevenda');
  assert.deepEqual(r.json.offers.map((o) => o.id), ['pz', 'pc']);
  assert.deepEqual(r.json.products.map((p) => p.id), ['sv9-lata', 'me05-etb']);
  assert.deepEqual(r.json.sources.map((s) => s.id).sort(), ['a', 'b']); assert.deepEqual(Object.keys(r.json.reputation.lojas).sort(), ['a', 'b']);
});
await t('lojas: lista normalizada (mesma regra do site), só os campos da página, sem preço', async () => {
  const r = await get('lojas'); const st = fx();
  const ref = normalizeLojas({ sources: st.sources, stores: [], offers: st.offers, now });
  assert.deepEqual(r.json.lojas.map((l) => l.id), ref.map((l) => l.id));
  for (const l of r.json.lojas) for (const k of Object.keys(l)) assert.ok(['id', 'name', 'platform', 'status', 'offersLive', 'lastReadAt', 'reason', 'searchUrl', 'searchKind'].includes(k), k);
  assert.ok(!/"(price|total)"/.test(r.body));
  assert.equal(r.json.lojas.find((l) => l.id === 'a').offersLive, 1);
});
await t('página desconhecida: 404', async () => {
  for (const k of ['xyz', '__proto__', 'constructor']) assert.equal((await call('/api/v1/site/pagina/' + k)).statusCode, 404, k);
  assert.equal((await call('/api/v1/site/pagina')).statusCode, 404);
});

// ------------------------------------------------------------------ 2) site: as quatro páginas pela API, iguais ao estado completo
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const cut = (a, b) => { const i = html.indexOf(a); const j = html.indexOf(b, i + a.length); assert.ok(i > 0 && j > i, `trecho ${a}`); return html.slice(i, j); };
const cutFn = (a) => { const i = html.indexOf(a); assert.ok(i > 0, a); const j = html.indexOf('\n}\n', i); return html.slice(i, j + 3); };
const line = (p) => { const l = html.split('\n').find((x) => x.startsWith(p)); assert.ok(l, p); return l; };
const m = html.match(/const API_VIEWS=new Set\((\[[^\]]*\])\)/);
for (const v of ['copag', 'pistas', 'prevenda', 'lojas']) assert.ok(JSON.parse(m[1]).includes(v), `${v} em API_VIEWS`);
const code = [
  ...['const esc=', 'const money=', 'const pct=', 'const ago=', 'const ic=', 'const safeUrl=', 'const norm=', 'const live=', 'const label=', 'const refOf=', 'const REFNOTE=', 'const MK=',
    'const mkDomain=', 'const mkName=', 'const chan=', 'const slugify=', 'function buildSlugs'].map(line),
  cutFn('function tipCard'), cutFn('function renderCopag'), cut('const LOJAS_CFG=', 'function renderLegal'), cut('const tipVs=', '/* Por que esta nota? Explicação'), cutFn('function renderPre'),
  cut('function hydrateHome', 'async function fetchHome'), cut('const API_VIEWS=', '/* histórico do produto'), cut('let fullP=null;', 'let refreshing=false;'),
].join('\n');

function sandbox(st, { slim }) {
  const view0 = { innerHTML: '' }; const n = { state: 0, render: 0, init: 0 };
  const ctx = {
    console, Date, Math, JSON, Number, String, Object, Array, Set, Map, Promise, URL, encodeURIComponent, Intl, AbortController, setTimeout, clearTimeout,
    S: null, P: {}, OFF: [], SLUG: {}, BYSLUG: {}, HIST: {}, F: { q: '' }, view: 'deals', curPid: null, curGroup: '',
    $: (s) => (s === '#view' ? view0 : null), photo: (p, o, cls) => `<i class="${cls}" data-src="${o?.image || p?.image || ''}"></i>`,
    dealCard: (e, opt) => `<article data-p="${e.p.id}" data-o="${e.o.id}" data-n="${e.n}" data-h="${opt.h}">${e.p.collectionName} ${ctx.__label(e.p)} ${e.o.total} ${e.o.releaseDate || ''} ${JSON.stringify(ctx.S.reputation?.lojas?.[e.o.storeId] || null)}</article>`,
    loading() {}, render() { n.render++; }, init(s2) { n.init++; ctx.S = s2; }, parseLoc: () => ({}),
    fetchState: async () => { n.state++; return fx(); },
    fetch: async (url) => { const r = await call(url); return { status: r.statusCode, ok: r.statusCode >= 200 && r.statusCode < 300, json: async () => JSON.parse(r.body) }; },
  };
  vm.createContext(ctx);
  vm.runInContext(code + '\n;globalThis.__label=label;globalThis.__={apiPageReady,renderCopag,renderTips,renderPre,renderLojas,buildSlugs,hydrateHome,get pageP(){return pageP},get PG(){return PG},get PAGE_DONE(){return PAGE_DONE},get SLUG(){return SLUG}};', ctx);
  const S = slim ? ctx.__.hydrateHome(st) : st;
  vm.runInContext('(s)=>{S=s;P=Object.fromEntries(S.products.map((p)=>[p.id,p]));OFF=S.offers;buildSlugs()}', ctx)(S);
  return { ctx, n, out: () => view0.innerHTML };
}
const RENDER = { copag: 'renderCopag', pistas: 'renderTips', prevenda: 'renderPre', lojas: 'renderLojas' };
const full = (v) => { const s = sandbox(fx(), { slim: false }); s.ctx.view = v; s.ctx.__[RENDER[v]](); return { html: s.out(), slug: { ...s.ctx.__.SLUG } }; };

for (const v of Object.keys(RENDER)) {
  await t(`${v}: pela API, sem fetchState, HTML igual ao do estado completo`, async () => {
    _cache.clear(); hits.length = 0; apiDown = false;
    const s = sandbox(JSON.parse(JSON.stringify(slimHome(fx(), { source: 'state', now }))), { slim: true });
    s.ctx.view = v;
    assert.equal(s.ctx.__.apiPageReady(), false, 'busca os dados da página');
    await s.ctx.__.pageP;
    assert.equal(s.n.state, 0, 'state.json não é baixado'); assert.equal(s.n.render, 1, 'redesenha quando chega');
    assert.deepEqual(hits, ['/api/v1/site/pagina/' + v]); assert.ok(s.ctx.__.PAGE_DONE.has('pg:' + v)); assert.equal(s.ctx.__.apiPageReady(), true, 'segunda vez: já pronta');
    s.ctx.__[RENDER[v]]();
    const f = full(v);
    assert.equal(s.out(), f.html);
    assert.ok(s.out().length > 200, 'renderizou de verdade');
    if (v === 'copag') assert.deepEqual({ ...s.ctx.__.SLUG }, f.slug, 'endereços dos produtos iguais aos do estado completo');
  });
}
await t('API fora do ar: cai no state.json (ensureFull), como antes', async () => {
  _cache.clear(); apiDown = true;
  const s = sandbox(JSON.parse(JSON.stringify(slimHome(fx(), { source: 'state', now }))), { slim: true });
  s.ctx.view = 'lojas'; assert.equal(s.ctx.__.apiPageReady(), false); await s.ctx.__.pageP; await new Promise((r) => setTimeout(r, 0));
  assert.equal(s.n.state, 1); assert.equal(s.n.init, 1); assert.equal(s.ctx.__.PAGE_DONE.has('pg:lojas'), false);
  apiDown = false;
});
console.log('perf-paginas-api-tests ok');
