// Issue #84 — frete por CEP ligado de ponta a ponta, atrás da flag SHIPPING_CALC_ENABLED (desligada por padrão):
// rota GET /api/v1/frete (+ /frete/estado), resolveVtexOffer (destino só do servidor, a partir do state.json),
// cliente HTTP da cotação na API (api/_lib/shipping-fetch.mjs) e a interface da página do produto (index.html) num
// sandbox vm, como os outros testes de página. Sem rede: loja falsa (setShippingFetch) ou fetchQuote injetado.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import api, { _setFrete, SHIPPING_FLAG } from '../api/v1.mjs';
import { setLegacyLoader } from '../api/_lib/legacy.mjs';
import { createQuoteService, resolveVtexOffer, calcSources, STATUS, ENABLE_FLAG } from '../src/shipping-calc.js';
import { apiVtexFetchQuote, setShippingFetch, UA } from '../api/_lib/shipping-fetch.mjs';
import { byComparableTotal as serverRank } from '../api/_lib/offer-rank.mjs';

let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error(`FALHOU: ${name}`); throw e; } };
const sim = (...slas) => ({ logisticsInfo: [{ slas }] });
const NOW = new Date().toISOString();

// state.json mínimo: uma loja VTEX ativa, uma Shopify e ofertas de cada tipo
const ST = {
  generatedAt: NOW, products: [{ id: 'p1' }],
  sources: [
    { id: 'copagloja', platform: 'vtex', status: 'ACTIVE', url: 'https://www.copagloja.com.br' },
    { id: 'pausada', platform: 'vtex', status: 'PAUSED', url: 'https://pausada.com.br' },
    { id: 'shopi', platform: 'shopify', status: 'ACTIVE', url: 'https://shopi.com.br' },
  ],
  offers: [
    { id: 'v1', productId: 'p1', storeId: 'copagloja', sku: '2540', sellerId: '1', url: 'https://www.copagloja.com.br/x/p', stock: 'IN_STOCK', stale: false, price: 100, total: 100 },
    { id: 'v-esg', productId: 'p1', storeId: 'copagloja', sku: '2541', sellerId: '1', url: 'https://www.copagloja.com.br/y/p', stock: 'OUT_OF_STOCK', price: 90, total: 90 },
    { id: 'v-old', productId: 'p1', storeId: 'copagloja', sku: '2542', sellerId: '1', url: 'https://www.copagloja.com.br/z/p', stock: 'IN_STOCK', stale: true, price: 90, total: 90 },
    { id: 'v-host', productId: 'p1', storeId: 'copagloja', sku: '2543', sellerId: '1', url: 'https://outro-host.com.br/z/p', stock: 'IN_STOCK', price: 90, total: 90 },
    { id: 'v-sku', productId: 'p1', storeId: 'copagloja', sku: '../../x', sellerId: '1', url: 'https://www.copagloja.com.br/w/p', stock: 'IN_STOCK', price: 90, total: 90 },
    { id: 'v-pause', productId: 'p1', storeId: 'pausada', sku: '1', sellerId: '1', url: 'https://pausada.com.br/a/p', stock: 'IN_STOCK', price: 90, total: 90 },
    { id: 's1', productId: 'p1', storeId: 'shopi', sku: '9', sellerId: null, url: 'https://shopi.com.br/products/a', stock: 'IN_STOCK', price: 80, total: 80 },
  ],
};
let loads = 0; setLegacyLoader(async () => { loads++; return ST; });
const call = async (url, headers = {}) => {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  await api({ url, method: 'GET', headers }, res);
  return { status: res.statusCode, headers: res.headers, json: JSON.parse(res.body) };
};
const withFlag = async (v, fn) => { const prev = process.env[SHIPPING_FLAG]; if (v == null) delete process.env[SHIPPING_FLAG]; else process.env[SHIPPING_FLAG] = v; try { await fn(); } finally { if (prev === undefined) delete process.env[SHIPPING_FLAG]; else process.env[SHIPPING_FLAG] = prev; } };

// ------------------------------------------------------------------ 1. rota
await t('rota desligada (padrão): /frete e /frete/estado → 404, sem ler o state.json nem chamar loja', async () => {
  assert.equal(SHIPPING_FLAG, ENABLE_FLAG);
  let calls = 0; _setFrete({ service: createQuoteService({ fetchQuote: async () => { calls++; return sim({ name: 'PAC', price: 100 }); } }) });
  for (const v of [undefined, '0', 'true', '']) await withFlag(v, async () => {
    const before = loads;
    for (const u of ['/api/v1/frete?oferta=v1&cep=01310-100', '/api/v1/frete/estado', '/api/v1/frete']) {
      const r = await call(u); assert.equal(r.status, 404, `${u} com flag=${v}`); assert.equal(r.headers['Cache-Control'], 'no-store');
    }
    assert.equal(loads, before, 'desligada não lê dados');
  });
  assert.equal(calls, 0);
});

await t('rota ligada: estado informa só lojas VTEX ativas; cotação vem do resolveOffer do servidor', async () => {
  const seen = []; _setFrete({ service: createQuoteService({ fetchQuote: async (tg) => { seen.push(tg); return sim({ id: 'pac', name: 'PAC', price: 1990, shippingEstimate: '5bd' }, { id: 's', name: 'Sedex', price: 3500, shippingEstimate: '2bd' }); } }) });
  await withFlag('1', async () => {
    const e = await call('/api/v1/frete/estado');
    assert.equal(e.status, 200); assert.equal(e.json.enabled, true); assert.deepEqual(e.json.stores, ['copagloja']); assert.equal(e.headers['Cache-Control'], 'no-store');
    const r = await call('/api/v1/frete?oferta=v1&cep=01310-100&quantidade=2', { 'x-real-ip': '9.9.9.9' });
    assert.equal(r.status, 200); assert.equal(r.json.status, STATUS.OK); assert.equal(r.json.shippingKnown, true);
    assert.deepEqual(r.json.options.map((o) => [o.method, o.price]), [['PAC', 19.9], ['Sedex', 35]]);
    assert.deepEqual(seen, [{ base: 'https://www.copagloja.com.br', itemId: '2540', sellerId: '1', quantity: 2, cep: '01310100' }]);
    assert.equal(r.headers['Cache-Control'], 'no-store', 'cotação nunca vai para o CDN');
  });
});

await t('destino nunca vem do cliente: base/url/itemId/sellerId do pedido são ignorados; oferta não-VTEX não consulta', async () => {
  const seen = []; _setFrete({ service: createQuoteService({ fetchQuote: async (tg) => { seen.push(tg); return sim({ name: 'PAC', price: 100 }); } }) });
  await withFlag('1', async () => {
    const evil = '/api/v1/frete?oferta=v1&cep=20040-020&base=http://169.254.169.254&url=http://127.0.0.1/&itemId=999&sellerId=x&storeId=shopi';
    assert.equal((await call(evil)).json.status, STATUS.OK);
    assert.deepEqual(seen.map((x) => [x.base, x.itemId, x.sellerId]), [['https://www.copagloja.com.br', '2540', '1']]);
    for (const id of ['s1', 'v-esg', 'v-old', 'v-host', 'v-sku', 'v-pause', 'nao-existe']) {
      const r = await call(`/api/v1/frete?oferta=${id}&cep=20040-020&base=https://www.copagloja.com.br&itemId=2540`);
      assert.equal(r.status, 200, id); assert.equal(r.json.status, STATUS.UNAVAILABLE, id); assert.equal(r.json.shippingKnown, false, id); assert.equal(r.json.total, null, id);
    }
    assert.equal(seen.length, 1, 'nenhuma dessas ofertas chamou a loja');
    assert.equal((await call('/api/v1/frete?oferta=v1&cep=123')).status, 400);
    assert.equal((await call('/api/v1/frete?cep=01310-100')).status, 400);
    assert.equal((await call('/api/v1/frete/outra')).status, 404);
  });
});

await t('rota ligada: limite por IP vira 429 com Retry-After; frete desconhecido não vira zero', async () => {
  _setFrete({ service: createQuoteService({ rate: { max: 1, windowMs: 60_000 }, fetchQuote: async () => { throw Object.assign(new Error('Timeout'), { code: 'TIMEOUT' }); } }) });
  await withFlag('1', async () => {
    const a = await call('/api/v1/frete?oferta=v1&cep=01310-100', { 'x-forwarded-for': '1.1.1.1, 10.0.0.1' });
    assert.equal(a.json.status, STATUS.TIMEOUT); assert.equal(a.json.shippingKnown, false); assert.equal(a.json.total, null); assert.deepEqual(a.json.options, []);
    const b = await call('/api/v1/frete?oferta=v1&cep=01310-101', { 'x-forwarded-for': '1.1.1.1' });
    assert.equal(b.status, 429); assert.equal(b.json.status, STATUS.RATE_LIMITED); assert.equal(b.headers['Retry-After'], '60');
    assert.equal((await call('/api/v1/frete?oferta=v1&cep=01310-101', { 'x-forwarded-for': '2.2.2.2' })).json.status, STATUS.TIMEOUT, 'outro IP segue');
  });
  _setFrete(null);
});

// ------------------------------------------------------------------ 2. resolveVtexOffer
await t('resolveVtexOffer: item = sku da oferta, vendedor = sellerId, base = fonte VTEX ativa no mesmo host', () => {
  assert.deepEqual(resolveVtexOffer(ST, 'v1'), { base: 'https://www.copagloja.com.br', itemId: '2540', sellerId: '1' });
  for (const id of ['s1', 'v-esg', 'v-old', 'v-host', 'v-sku', 'v-pause', 'x', '', null, 42]) assert.equal(resolveVtexOffer(ST, id), null, String(id));
  const http = { ...ST, sources: [{ id: 'copagloja', platform: 'vtex', status: 'ACTIVE', url: 'http://www.copagloja.com.br' }] };
  assert.equal(resolveVtexOffer(http, 'v1'), null, 'base sem https');
  const noSeller = { ...ST, offers: [{ ...ST.offers[0], sellerId: null }] };
  assert.equal(resolveVtexOffer(noSeller, 'v1'), null, 'sem sellerId persistido não cota');
  assert.deepEqual(calcSources(ST).map((s) => s.id), ['copagloja']); assert.deepEqual(calcSources(null), []);
});

// ------------------------------------------------------------------ 3. cliente HTTP da cotação na API
function fakeStore(handler) {
  const calls = [];
  setShippingFetch(async (url, init = {}) => { calls.push({ url: String(url), init }); return handler(String(url), init); });
  return calls;
}
const res = (status, body, headers = {}) => { const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])); return { status, headers: { get: (k) => h[k.toLowerCase()] ?? null }, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) }; };
const TG = { base: 'https://loja.test', itemId: '10', sellerId: '1', quantity: 1, cep: '01310100' };

await t('apiVtexFetchQuote: robots.txt antes, POST com UA honesto, sem seguir redirecionamento', async () => {
  const calls = fakeStore(async (url) => (url.endsWith('/robots.txt') ? res(200, 'User-agent: *\nDisallow: /checkout\n') : res(200, sim({ name: 'PAC', price: 900 }))));
  const j = await apiVtexFetchQuote(TG);
  assert.equal(j.logisticsInfo[0].slas[0].price, 900);
  assert.deepEqual(calls.map((c) => c.url), ['https://loja.test/robots.txt', 'https://loja.test/api/checkout/pub/orderForms/simulation?sc=1']);
  const post = calls[1].init; assert.equal(post.method, 'POST'); assert.equal(post.redirect, 'manual'); assert.equal(post.headers['user-agent'], UA);
  assert.deepEqual(JSON.parse(post.body), { items: [{ id: '10', quantity: 1, seller: '1' }], postalCode: '01310100', country: 'BRA' });
  await apiVtexFetchQuote(TG); assert.equal(calls.filter((c) => c.url.endsWith('/robots.txt')).length, 1, 'robots.txt em cache');
  const redir = fakeStore(async (url) => (url.endsWith('/robots.txt') ? res(404, '') : res(302, '', { location: 'http://169.254.169.254/' })));
  await assert.rejects(apiVtexFetchQuote(TG), /redirecionamento não seguido/);
  assert.ok(!redir.some((c) => c.url.includes('169.254')), 'destino do redirecionamento não foi buscado');
});

await t('apiVtexFetchQuote + serviço: robots proíbe → indisponível; 429 → cooldown; robots fora do ar → erro; URL insegura → nenhuma conexão', async () => {
  let mode = 'deny';
  const calls = fakeStore(async (url) => {
    if (url.endsWith('/robots.txt')) return mode === 'deny' ? res(200, 'User-agent: *\nDisallow: /api/checkout\n') : mode === 'down' ? res(503, 'x') : res(404, '');
    return mode === '429' ? res(429, 'devagar', { 'Retry-After': '3600' }) : res(200, sim({ name: 'PAC', price: 100 }));
  });
  let clock = 1_000_000; const svc = createQuoteService({ fetchQuote: (tg) => apiVtexFetchQuote(tg, { now: () => clock }), now: () => clock });
  const deny = await svc.quote(TG, { cep: '01310-100' });
  assert.equal(deny.status, STATUS.UNAVAILABLE); assert.equal(deny.shippingKnown, false);
  assert.ok(!calls.some((c) => c.url.includes('/simulation')), 'robots proibiu: simulação não foi chamada');
  mode = '429'; setShippingFetch(null); fakeStore(async (url) => (url.endsWith('/robots.txt') ? res(404, '') : res(429, 'x', { 'Retry-After': '3600' })));
  const c = await svc.quote({ ...TG, base: 'https://b.test' }, { cep: '01310-100' });
  assert.equal(c.status, STATUS.COOLDOWN); assert.equal(c.retryAt, new Date(clock + 3600e3).toISOString());
  mode = 'down'; const downCalls = fakeStore(async (url) => (url.endsWith('/robots.txt') ? res(503, 'x') : res(200, sim({ name: 'PAC', price: 1 }))));
  const d = await svc.quote({ ...TG, base: 'https://c.test' }, { cep: '01310-100' });
  assert.equal(d.status, STATUS.ERROR); assert.ok(!downCalls.some((x) => x.url.includes('/simulation')), 'robots que não abre: não consulta');
  const none = fakeStore(async () => res(200, sim({ name: 'PAC', price: 1 })));
  for (const base of ['http://127.0.0.1', 'http://169.254.169.254', 'http://[::1]', 'file:///etc/passwd', 'https://u:p@loja.test']) {
    const r = await svc.quote({ ...TG, base }, { cep: '01310-100' }); assert.notEqual(r.status, STATUS.OK, base); assert.equal(r.total, null, base);
  }
  assert.equal(none.length, 0, 'nem robots.txt nem simulação');
  setShippingFetch(null);
});

// ------------------------------------------------------------------ 4. interface (index.html) em sandbox
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const cut = (a, b) => { const i = html.indexOf(a); const j = html.indexOf(b, i); assert.ok(i > 0 && j > i, `trecho ${a}`); return html.slice(i, j); };
const uiCode = cut('const live=(o)=>', '\n') + ';' + cut('/* Frete por CEP (issue #84).', '/* Conta: login');

function el(id) { return { id, attrs: {}, hidden: false, textContent: '', _html: '', focused: 0, value: '', dataset: {},
  setAttribute(k, v) { this.attrs[k] = String(v); }, removeAttribute(k) { delete this.attrs[k]; }, getAttribute(k) { return this.attrs[k] ?? null; }, focus() { this.focused++; } }; }
function page({ cfg, offers, fetchImpl }) {
  const input = el('fc-cep'); const err = el('fc-err'); const btn = el('btn'); const say = el('fc-say'); const head = el('fc-res');
  const out = el('fc-out'); let radios = [];
  Object.defineProperty(out, 'innerHTML', { get() { return this._html; }, set(v) { this._html = v;
    radios = [...v.matchAll(/<input type="radio" name="[^"]*" value="([^"]*)" data-fcm="([^"]*)"([^>]*)>/g)].map((m) => ({ ...el('r'), value: m[1], dataset: { fcm: m[2] }, checked: /checked/.test(m[3]) })); } });
  out.querySelectorAll = () => radios;
  const box = { innerHTML: '', querySelector: (s) => ({ '#fc-cep': input, '#fc-err': err, '#fc-form button': btn, '#fc-say': say, '#fc-out': out }[s] || null) };
  const fetched = []; const timers = [];
  const ctx = {
    console, OFF: offers, curPid: 'p1', view: 'produto',
    $: (s) => ({ '#pp-frete': box, '#fc-cep': input, '#fc-out': out, '#fc-res': /id="fc-res"/.test(out._html) ? head : null }[s] || null),
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    money: (v) => (v == null ? '-' : 'R$ ' + Number(v).toFixed(2).replace('.', ',')), ic: (k) => `<i data-ic="${k}"></i>`, track() {},
    setTimeout: (f, ms) => { timers.push(ms); return timers.length; }, clearTimeout() {},
    fetch: async (url) => { fetched.push(url); return fetchImpl(url); },
  };
  vm.createContext(ctx);
  vm.runInContext(uiCode + `\n;globalThis.__t={FC,fcBlock,fcSubmit,fcChoose,fcResultsHTML,fcSay,fcCep,byComparableTotal,loadShipCalc,setCfg:(c)=>{FCCFG=c}};`, ctx);
  if (cfg !== undefined) ctx.__t.setCfg(cfg);
  return { ...ctx.__t, input, err, btn, say, out, head, box, fetched, timers, radios: () => radios };
}
const offer = (id, store, price, x = {}) => ({ id, productId: 'p1', storeId: store, storeName: 'Loja ' + id, price, total: price, stock: 'IN_STOCK', stale: false, anomalous: false, url: 'https://x/' + id, ...x });
const OFFS = [offer('a', 'vt', 100), offer('b', 'vt', 105), offer('c', 'vt', 95), offer('d', 'vt', 90), offer('sh', 'shopify', 50), offer('esg', 'vt', 10, { stock: 'OUT_OF_STOCK' })];
const exp = (ms = 300_000) => new Date(Date.now() + ms).toISOString();
const ok = (opts, x = {}) => ({ status: 'ok', shippingKnown: true, total: null, options: opts, expiresAt: exp(), quotedAt: NOW, ...x });
const jres = (status, body) => ({ status, ok: status < 300, json: async () => body });
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const ON = { on: true, stores: new Set(['vt']) };

await t('interface: só aparece quando a API diz que está ligado (estado 200); 404 ou sem lojas → nada', async () => {
  assert.equal(page({ offers: OFFS }).fcBlock('p1'), '', 'antes de saber o estado');
  const off = page({ offers: OFFS, fetchImpl: async () => jres(404, { error: 'rota não encontrada' }) });
  await off.loadShipCalc(); assert.equal(off.fcBlock('p1'), ''); assert.deepEqual(off.fetched, ['/api/v1/frete/estado']);
  const on = page({ offers: OFFS, fetchImpl: async () => jres(200, { enabled: true, stores: ['vt'] }) });
  await on.loadShipCalc(); assert.match(on.fcBlock('p1'), /Calcular frete/);
  const other = page({ offers: OFFS, fetchImpl: async () => jres(200, { enabled: true, stores: ['outra'] }) });
  await other.loadShipCalc(); assert.equal(other.fcBlock('p1'), '', 'nenhuma oferta com estoque de loja com cálculo');
});

await t('interface acessível: label do CEP, botão "Calcular frete", dica ligada ao campo e aviso com aria-live', () => {
  const p = page({ cfg: ON, offers: OFFS }); const h = p.fcBlock('p1');
  assert.match(h, /<label for="fc-cep">CEP de entrega<\/label>/); assert.match(h, /<input id="fc-cep"[^>]*inputmode="numeric"[^>]*autocomplete="postal-code"/);
  assert.match(h, /<input id="fc-cep"[^>]*aria-describedby="fc-hint"/); assert.match(h, /<button class="btn" type="submit">Calcular frete<\/button>/);
  assert.match(h, /id="fc-say" class="fc-status" role="status" aria-live="polite"/); assert.match(h, /<section class="card fcalc" aria-labelledby="fc-h"><h2 id="fc-h">/);
  assert.match(text(h), /4 ofertas/, 'só ofertas com estoque das lojas com cálculo (sem Shopify, sem esgotada)');
});

await t('CEP inválido: mensagem ligada ao campo (aria-invalid + aria-describedby), foco no campo, nenhuma consulta', async () => {
  const p = page({ cfg: ON, offers: OFFS, fetchImpl: async () => { throw new Error('não devia chamar'); } });
  for (const bad of ['123', '00000-000', '11111111', 'abcde-fgh']) {
    p.input.value = bad; await p.fcSubmit({ dataset: { pid: 'p1' }, querySelector: () => p.input });
    assert.equal(p.input.attrs['aria-invalid'], 'true', bad); assert.equal(p.input.attrs['aria-describedby'], 'fc-hint fc-err');
    assert.equal(p.err.hidden, false); assert.match(p.err.textContent, /CEP inválido/);
  }
  assert.equal(p.input.focused, 4); assert.equal(p.fetched.length, 0);
  assert.match(p.fcBlock('p1'), /aria-invalid="true"/, 'redesenho mantém o erro');
});

await t('cotação: carregando → resultado ordenado por byComparableTotal; desconhecido mostra "a calcular", nunca R$ 0; foco no resultado', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const Q = { a: ok([{ method: 'PAC', price: 20, free: false, estimate: { value: 5, unit: 'business_days' } }, { method: 'Sedex', price: 35, free: false, estimate: { value: 2, unit: 'business_days' } }]),
    b: ok([{ method: 'Grátis', price: 0, free: true, estimate: null }]),
    c: { status: 'timeout', shippingKnown: false, total: null, options: [] },
    d: { status: 'store_cooldown', shippingKnown: false, total: null, options: [], retryAt: exp(3600e3) } };
  const p = page({ cfg: ON, offers: OFFS, fetchImpl: async (url) => { await gate; return jres(200, Q[new URL(url, 'http://x').searchParams.get('oferta')]); } });
  p.input.value = '01310-100'; const run = p.fcSubmit({ dataset: { pid: 'p1' }, querySelector: () => p.input });
  assert.equal(p.FC.phase, 'loading'); assert.match(p.say.textContent, /Calculando o frete em 4 lojas/); assert.equal(p.btn.attrs['aria-disabled'], 'true');
  await p.fcSubmit({ dataset: { pid: 'p1' }, querySelector: () => p.input }); assert.equal(p.fetched.length, 4, 'clique repetido durante o cálculo não consulta de novo');
  release(); await run;
  for (const u of p.fetched) { const q = new URL(u, 'http://x'); assert.deepEqual([...q.searchParams.keys()].sort(), ['cep', 'oferta', 'quantidade']); assert.equal(q.searchParams.get('cep'), '01310100'); }
  assert.equal(p.btn.attrs['aria-disabled'], undefined); assert.equal(p.head.focused, 1, 'foco no título do resultado');
  const h = p.out.innerHTML; const order = [...h.matchAll(/data-fc="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, ['b', 'a', 'd', 'c'], 'B R$105 grátis, A R$120; depois os desconhecidos por preço (D 90, C 95)');
  const row = (id) => text(h.split(`data-fc="${id}"`)[1].split('</li>')[0]);
  assert.match(row('b'), /R\$ 105,00 Produto R\$ 105,00 \+ frete grátis confirmado pela loja/);
  assert.match(row('a'), /R\$ 120,00 Produto R\$ 100,00 \+ frete R\$ 20,00 \(PAC\)/); assert.match(row('a'), /PAC · R\$ 20,00 · em até 5 dias úteis/);
  for (const id of ['c', 'd']) { assert.match(row(id), /frete a calcular/); assert.doesNotMatch(row(id), /R\$ 0,00|grátis/i, `${id}: desconhecido não vira zero`); }
  assert.match(row('c'), /A loja não respondeu/); assert.match(row('d'), /A loja pediu uma pausa nas consultas: tente de novo depois das \d\d:\d\d/);
  assert.match(p.say.textContent, /menor total R\$ 105,00 na Loja b/);
  assert.equal(p.timers.length, 1, 'expiração agendada');
  // a ordem é a mesma da regra do servidor (api/_lib/offer-rank.mjs)
  const rows = [{ id: 'x', total: 100, shippingKnown: true }, { id: 'y', total: 90 }, { id: 'z', total: 90, shippingKnown: false }, { id: 'w', total: 80, shippingKnown: true }, { id: 'v', total: null }];
  assert.deepEqual([...rows].sort(p.byComparableTotal).map((r) => r.id), [...rows].sort(serverRank).map((r) => r.id));
});

await t('escolha da modalidade: total e ordem recalculados, aviso no role=status, foco volta à opção escolhida', async () => {
  const Q = { a: ok([{ method: 'PAC', price: 20 }, { method: 'Sedex', price: 35 }]), b: ok([{ method: 'PAC', price: 18 }]), c: { status: 'unavailable', options: [], reason: 'a loja não oferece entrega para este CEP' }, d: { status: 'rate_limited', options: [] } };
  const p = page({ cfg: ON, offers: OFFS, fetchImpl: async (url) => jres(200, Q[new URL(url, 'http://x').searchParams.get('oferta')]) });
  p.input.value = '20040020'; await p.fcSubmit({ dataset: { pid: 'p1' }, querySelector: () => p.input });
  assert.deepEqual([...p.out.innerHTML.matchAll(/data-fc="(\w+)"/g)].map((m) => m[1]), ['a', 'b', 'd', 'c'], 'A 120 < B 123');
  p.fcChoose('a', 'Sedex');
  assert.deepEqual([...p.out.innerHTML.matchAll(/data-fc="(\w+)"/g)].map((m) => m[1]), ['b', 'a', 'd', 'c'], 'A com Sedex = 135 > B 123');
  assert.match(p.say.textContent, /Total na Loja a com Sedex: R\$ 135,00/);
  const r = p.radios().find((x) => x.dataset.fcm === 'a' && x.value === 'Sedex'); assert.ok(r.checked); assert.equal(r.focused, 1);
  assert.match(text(p.out.innerHTML), /a loja não oferece entrega para este CEP/); assert.match(text(p.out.innerHTML), /Muitas consultas seguidas/);
});

await t('cotação expirada: sem total nem modalidades, oferta vai para "a calcular" e o aviso pede para calcular de novo', async () => {
  const Q = { a: ok([{ method: 'PAC', price: 20 }]), b: ok([{ method: 'PAC', price: 5 }], { expiresAt: exp(1000) }), c: ok([{ method: 'PAC', price: 1 }]), d: ok([{ method: 'PAC', price: 1 }]) };
  const p = page({ cfg: ON, offers: OFFS, fetchImpl: async (url) => jres(200, Q[new URL(url, 'http://x').searchParams.get('oferta')]) });
  p.input.value = '01310-100'; await p.fcSubmit({ dataset: { pid: 'p1' }, querySelector: () => p.input });
  const later = Date.now() + 5000; const h = p.fcResultsHTML('p1', later);
  const b = text(h.split('data-fc="b"')[1].split('</li>')[0]);
  assert.match(b, /Cotação expirada: calcule de novo/); assert.match(b, /frete a calcular/); assert.doesNotMatch(b, /R\$ 5,00|R\$ 0,00/);
  assert.doesNotMatch(h.split('data-fc="b"')[1].split('</li>')[0], /type="radio"/);
  assert.equal([...h.matchAll(/data-fc="(\w+)"/g)].map((m) => m[1]).at(-1), 'b', 'expirada vai para o fim');
  assert.match(p.fcSay('p1', later), /A cotação expirou: calcule de novo/);
});

await t('API respondeu sem JSON de cotação (404 da flag desligada, 429 do CDN, rede): frete a calcular, nunca zero', async () => {
  const p = page({ cfg: ON, offers: OFFS.slice(0, 2), fetchImpl: async (url) => { const id = new URL(url, 'http://x').searchParams.get('oferta'); if (id === 'a') return jres(404, { error: 'rota não encontrada' }); return { status: 429, ok: false, json: async () => { throw new SyntaxError('x'); } }; } });
  p.input.value = '01310-100'; await p.fcSubmit({ dataset: { pid: 'p1' }, querySelector: () => p.input });
  const h = text(p.out.innerHTML); assert.match(h, /A loja não respondeu/); assert.match(h, /Muitas consultas seguidas/); assert.doesNotMatch(h, /R\$ 0,00/);
  assert.match(p.say.textContent, /Nenhuma loja informou o frete/);
});

await t('servidor recusou o CEP (400 invalid_cep): volta ao campo com erro', async () => {
  const p = page({ cfg: ON, offers: OFFS, fetchImpl: async () => jres(400, { status: 'invalid_cep', options: [] }) });
  p.input.value = '01310-100'; await p.fcSubmit({ dataset: { pid: 'p1' }, querySelector: () => p.input });
  assert.equal(p.input.attrs['aria-invalid'], 'true'); assert.equal(p.input.focused, 1); assert.equal(p.out.innerHTML, '');
});

await t('página: renderProduct reserva #pp-frete e o formulário é tratado pelo submit/change globais', () => {
  assert.match(cut('function renderProduct(pid){', '/* "Também na Amazon"'), /<div id="pp-frete">\$\{fcBlock\(pid\)\}<\/div>/);
  assert.match(html, /else if\(f\.id==="fc-form"\)\{e\.preventDefault\(\);fcSubmit\(f\)\}/);
  assert.match(html, /if\(t\.dataset\?\.fcm\)\{fcChoose\(t\.dataset\.fcm,t\.value\);return\}/);
});

console.log(`✓ Frete por CEP ligado atrás da flag (#84): ${n} grupos de testes passaram`);
