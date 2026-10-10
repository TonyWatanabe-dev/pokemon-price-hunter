// Issue #84 — núcleo do cálculo de frete por CEP: validação, fidelidade à cotação, isolamento de chaves, totais,
// abuso (rate limit por cliente e por chave), cooldown por loja após 429, destino só do servidor e ordenação pela regra
// única de api/_lib/offer-rank.mjs. Sem rede: a loja é falsa (setFetch) ou o fetchQuote é injetado.
import assert from 'node:assert/strict';
import {
  normalizeCep, parseEstimate, parseVtexSimulation, totalWithShipping, applyQuote, rankByComparableTotal, createQuoteService,
  createShippingCalcHandler, vtexFetchQuote, quoteKey, quoteView, STATUS, QUOTE_TTL_MS, ENABLE_FLAG,
} from '../src/shipping-calc.js';
import * as calc from '../src/shipping-calc.js';
import { byComparableTotal } from '../api/_lib/offer-rank.mjs';
import { setFetch, setSleep } from '../src/http.js';

let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error(`FALHOU: ${name}`); throw e; } };
const sim = (...slas) => ({ logisticsInfo: [{ slas }] });
const TARGET = { base: 'https://loja.test', itemId: '10', sellerId: '1' };
const REQ = { quantity: 1, cep: '01310-100' };
setSleep(async () => {}); // fila por host do http.js sem espera real

// Loja falsa no nível do fetch: registra cada chamada; robots.txt liberado.
function fakeStore(handler) {
  const calls = [];
  setFetch(async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/robots.txt')) return res(200, 'User-agent: *\nAllow: /');
    return handler(String(url), init);
  });
  return calls;
}
function res(status, body, headers = {}) {
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { status, ok: status >= 200 && status < 300, url: '', headers: { get: (k) => h[k.toLowerCase()] ?? null }, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
}
const storeCalls = (calls) => calls.filter((c) => !c.url.endsWith('/robots.txt'));

await t('CEP válido, normalização e inválidos/reservados', () => {
  assert.equal(normalizeCep('01310-100'), '01310100'); assert.equal(normalizeCep(' 01310100 '), '01310100'); assert.equal(normalizeCep('69900-000'), '69900000');
  for (const bad of ['', '1234567', '123456789', 'abcdefgh', '00000000', '00999-999', '11111-111', '99999999', null, undefined, {}, '01310-10a', '01310--100', '01310 100', '0131O100'])
    assert.equal(normalizeCep(bad), null, String(bad));
});

await t('preço e prazo seguem a resposta da loja (centavos -> reais, modalidade preservada)', () => {
  const q = parseVtexSimulation(sim({ id: 'pac', name: 'PAC', price: 1990, shippingEstimate: '5bd' }, { id: 'sedex', name: 'Sedex', price: 3250, shippingEstimate: '2bd' }));
  assert.equal(q.status, STATUS.OK);
  assert.deepEqual(q.options.map((o) => [o.method, o.price, o.free]), [['PAC', 19.9, false], ['Sedex', 32.5, false]]);
  assert.deepEqual(q.options[0].estimate, { value: 5, unit: 'business_days' });
  assert.equal(parseEstimate('xyz'), null);
});

await t('frete grátis confirmado (preço 0 devolvido pela loja) difere de desconhecido', () => {
  const free = parseVtexSimulation(sim({ id: 'a', name: 'Grátis', price: 0, shippingEstimate: '3bd' }));
  assert.equal(free.options[0].free, true); assert.equal(totalWithShipping(100, free), 100);
  for (const unknown of [parseVtexSimulation({}), parseVtexSimulation(sim()), parseVtexSimulation(sim({ id: 'x', name: 'X', price: 'abc' })), parseVtexSimulation(sim({ id: 'x', name: 'X', price: -5 }))]) {
    assert.equal(unknown.status, STATUS.UNAVAILABLE); assert.deepEqual(unknown.options, []); assert.equal(totalWithShipping(100, unknown), null);
  }
});

await t('total considera quantidade e modalidade escolhida; só existe com frete confirmado', () => {
  const q = parseVtexSimulation(sim({ id: 'a', name: 'PAC', price: 1000 }, { id: 'b', name: 'Sedex', price: 2500 }));
  assert.equal(totalWithShipping(50, q, 3), 160); assert.equal(totalWithShipping(50, q, 3, 'Sedex'), 175);
  assert.equal(totalWithShipping(50, q, 1, 'Retira'), null, 'modalidade que a loja não devolveu não vira outra');
  assert.equal(totalWithShipping(50, q, 0), null); assert.equal(totalWithShipping(null, q), null);
  assert.equal(totalWithShipping(50, { status: STATUS.ERROR, options: [] }), null);
});

await t('sortByTotal não existe mais; ordenação = byComparableTotal de offer-rank (A R$100 desconhecido × B R$105 grátis → B)', async () => {
  assert.equal(calc.sortByTotal, undefined, 'regra paralela de "menor total" removida');
  const svc = createQuoteService({ fetchQuote: async (tg) => { if (tg.itemId === 'A') throw Object.assign(new Error('Timeout em loja-a.test'), { code: 'TIMEOUT' }); return sim({ id: 'g', name: 'Grátis', price: 0 }); } });
  const qa = await svc.quote({ ...TARGET, base: 'https://loja-a.test', itemId: 'A' }, REQ); const qb = await svc.quote({ ...TARGET, base: 'https://loja-b.test', itemId: 'B' }, REQ);
  assert.equal(qa.shippingKnown, false); assert.equal(qa.total, null); assert.deepEqual(qa.options, []);
  const A = applyQuote({ id: 'A', price: 100, total: 100 }, qa); const B = applyQuote({ id: 'B', price: 105, total: 105 }, qb);
  assert.equal(A.shippingKnown, false); assert.equal(A.shipping, null, 'frete desconhecido não vira 0'); assert.equal(B.shippingKnown, true); assert.equal(B.shipping, 0); assert.equal(B.total, 105);
  const rows = [A, B, { id: 'C', price: 90, total: 90, shippingKnown: false }, { id: 'D', price: 100, shipping: 20, shippingKnown: true, total: 120 }];
  const mine = rankByComparableTotal(rows).map((r) => r.id);
  assert.deepEqual(mine, [...rows].sort(byComparableTotal).map((r) => r.id), 'idêntica à regra única do servidor');
  assert.deepEqual(mine, ['B', 'D', 'C', 'A']);
});

await t('serviço: entrada inválida não chama a loja; origem e horário registrados; auditoria sem CEP completo', async () => {
  let calls = 0; const audits = []; let clock = 1_000_000;
  const svc = createQuoteService({ fetchQuote: async () => { calls++; return sim({ id: 'a', name: 'PAC', price: 1500, shippingEstimate: '4bd' }); }, now: () => clock, onAudit: (a) => audits.push(a) });
  for (const cep of ['123', '00000-000', '11111111']) assert.equal((await svc.quote(TARGET, { ...REQ, cep })).status, STATUS.INVALID_CEP);
  assert.equal((await svc.quote(TARGET, { ...REQ, quantity: 0 })).status, STATUS.ERROR); assert.equal(calls, 0);
  const r = await svc.quote(TARGET, REQ);
  assert.equal(r.status, STATUS.OK); assert.equal(r.shippingKnown, true); assert.equal(r.source, 'vtex_simulation'); assert.equal(r.quotedAt, new Date(clock).toISOString());
  assert.equal(audits.length, 1); assert.equal(audits[0].cepPrefix, '013'); assert.ok(!JSON.stringify(audits).includes('01310100'));
});

await t('cache: hit dentro do TTL (sem chamar a loja) e expirado depois do TTL (consulta de novo, novo horário)', async () => {
  let calls = 0; let clock = 5_000_000;
  const svc = createQuoteService({ fetchQuote: async () => { calls++; return sim({ id: 'a', name: 'PAC', price: 1500 }); }, now: () => clock });
  assert.equal((await svc.quote(TARGET, REQ)).cached, false);
  clock += QUOTE_TTL_MS - 1; const hit = await svc.quote(TARGET, { ...REQ, cep: '01310100' }); assert.equal(hit.cached, true, 'mesma chave com CEP normalizado'); assert.equal(calls, 1);
  clock += 1; const again = await svc.quote(TARGET, REQ); assert.equal(again.cached, false); assert.equal(calls, 2); assert.equal(again.quotedAt, new Date(clock).toISOString());
  assert.equal(quoteView(hit, clock).state, 'expired');
});

await t('dois CEPs, variantes, quantidades, vendedores e lojas não compartilham cotação', async () => {
  const seen = []; const svc = createQuoteService({ fetchQuote: async (r) => { seen.push(quoteKey(r)); return sim({ id: 'a', name: 'PAC', price: 100 * Number(r.cep.slice(-1)) + 100 * r.quantity }); } });
  const rs = [];
  for (const [tg, rq] of [[TARGET, REQ], [TARGET, { ...REQ, cep: '01310-101' }], [{ ...TARGET, itemId: '11' }, REQ], [TARGET, { ...REQ, quantity: 2 }], [{ ...TARGET, sellerId: '2' }, REQ], [{ ...TARGET, base: 'https://outra.test' }, REQ]]) rs.push(await svc.quote(tg, rq));
  assert.equal(new Set(seen).size, 6); assert.ok(rs.every((r) => !r.cached));
  assert.notEqual(rs[0].options[0].price, rs[1].options[0].price); assert.notEqual(rs[0].options[0].price, rs[3].options[0].price);
});

await t('timeout e 5xx (pelo request() real) viram frete desconhecido, não zero, e não são cacheados', async () => {
  let mode = 'timeout';
  const calls = fakeStore(async (url, init) => {
    if (mode === 'timeout') return new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    if (mode === '5xx') return res(503, 'erro');
    return res(200, sim({ id: 'a', name: 'PAC', price: 900 }));
  });
  const svc = createQuoteService({ fetchQuote: (tg) => vtexFetchQuote(tg, { timeout: 20 }) });
  const a = await svc.quote(TARGET, REQ); assert.equal(a.status, STATUS.TIMEOUT); assert.equal(a.shippingKnown, false); assert.equal(a.total, null); assert.deepEqual(a.options, []);
  assert.equal(applyQuote({ id: 'x', price: 80, total: 80 }, a).shipping, null); assert.equal(totalWithShipping(80, a), null);
  mode = '5xx'; const b = await svc.quote(TARGET, REQ); assert.equal(b.status, STATUS.ERROR); assert.equal(b.shippingKnown, false); assert.equal(b.total, null);
  mode = 'ok'; const ok = await svc.quote(TARGET, REQ); assert.equal(ok.status, STATUS.OK); assert.equal(ok.options[0].price, 9);
  assert.equal(storeCalls(calls).length, 3, 'falhas não foram cacheadas e request() não repetiu (POST sem retry)');
  const sent = storeCalls(calls)[2];
  assert.equal(sent.url, 'https://loja.test/api/checkout/pub/orderForms/simulation?sc=1'); assert.equal(sent.init.method, 'POST');
  assert.deepEqual(JSON.parse(sent.init.body), { items: [{ id: '10', quantity: 1, seller: '1' }], postalCode: '01310100', country: 'BRA' });
});

await t('429 com Retry-After → cooldown da loja; nenhuma chamada até vencer; outra loja segue normal', async () => {
  let clock = 10_000_000; let mode = '429';
  const calls = fakeStore(async (url) => (mode === '429' && url.includes('loja.test') ? res(429, 'devagar', { 'Retry-After': '7200' }) : res(200, sim({ id: 'a', name: 'PAC', price: 1200 }))));
  const svc = createQuoteService({ fetchQuote: (tg) => vtexFetchQuote(tg), now: () => clock });
  const first = await svc.quote(TARGET, REQ);
  assert.equal(first.status, STATUS.COOLDOWN); assert.equal(first.shippingKnown, false); assert.equal(first.total, null);
  assert.equal(first.retryAt, new Date(clock + 7200e3).toISOString(), 'Retry-After de 2 h respeitado');
  mode = 'ok'; const before = storeCalls(calls).length;
  for (const [dt, rq] of [[1000, REQ], [60e3, { ...REQ, cep: '20040-020' }], [7200e3 - 1, { ...REQ, quantity: 2 }]]) {
    clock = 10_000_000 + dt; const r = await svc.quote(TARGET, rq); assert.equal(r.status, STATUS.COOLDOWN, `${dt} ms`);
  }
  assert.equal(storeCalls(calls).filter((c) => c.url.includes('loja.test')).length, before, 'nenhuma chamada à loja durante o cooldown');
  assert.equal((await svc.quote({ ...TARGET, base: 'https://outra.test' }, REQ)).status, STATUS.OK, 'cooldown é por loja');
  clock = 10_000_000 + 7200e3; const after = await svc.quote(TARGET, REQ); assert.equal(after.status, STATUS.OK, 'vencido o cooldown, consulta de novo');
});

await t('429 sem Retry-After (ou pequeno) → piso de 30 min; Retry-After enorme → teto de 6 h', async () => {
  let clock = 0; let ra = null;
  fakeStore(async () => res(429, 'x', ra == null ? {} : { 'Retry-After': ra }));
  const svc = createQuoteService({ fetchQuote: (tg) => vtexFetchQuote(tg), now: () => clock });
  assert.equal((await svc.quote(TARGET, REQ)).retryAt, new Date(30 * 60e3).toISOString());
  ra = '5'; clock = 0; const s2 = createQuoteService({ fetchQuote: (tg) => vtexFetchQuote(tg), now: () => clock });
  assert.equal((await s2.quote({ ...TARGET, base: 'https://b.test' }, REQ)).retryAt, new Date(30 * 60e3).toISOString());
  ra = '999999'; const s3 = createQuoteService({ fetchQuote: (tg) => vtexFetchQuote(tg), now: () => clock });
  assert.equal((await s3.quote({ ...TARGET, base: 'https://c.test' }, REQ)).retryAt, new Date(6 * 3600e3).toISOString());
});

await t('rate limit por cliente (IP) e por chave; cotação em cache não consome limite', async () => {
  let calls = 0; let fail = false;
  const svc = createQuoteService({ fetchQuote: async () => { calls++; if (fail) throw new Error('HTTP 500'); return sim({ id: 'a', name: 'PAC', price: 100 }); }, rate: { max: 3, windowMs: 60_000 }, keyRate: { max: 2, windowMs: 60_000 } });
  for (let i = 0; i < 3; i++) assert.equal((await svc.quote(TARGET, { ...REQ, quantity: i + 1 }, { client: 'ip1' })).status, STATUS.OK);
  assert.equal((await svc.quote(TARGET, { ...REQ, quantity: 1 }, { client: 'ip1' })).cached, true);
  assert.equal((await svc.quote(TARGET, { ...REQ, quantity: 9 }, { client: 'ip1' })).status, STATUS.RATE_LIMITED);
  assert.equal((await svc.quote(TARGET, { ...REQ, quantity: 9 }, { client: 'ip2' })).status, STATUS.OK); assert.equal(calls, 4);
  // por chave: a mesma consulta que falha não é repetida além do limite, mesmo vinda de IPs diferentes
  fail = true; const k = { ...REQ, quantity: 7 };
  assert.equal((await svc.quote(TARGET, k, { client: 'ip3' })).status, STATUS.ERROR);
  assert.equal((await svc.quote(TARGET, k, { client: 'ip4' })).status, STATUS.ERROR);
  assert.equal((await svc.quote(TARGET, k, { client: 'ip5' })).status, STATUS.RATE_LIMITED); assert.equal(calls, 6);
});

await t('assertSafeUrl recusa destino inseguro: nenhuma conexão', async () => {
  const calls = fakeStore(async () => res(200, sim({ id: 'a', name: 'PAC', price: 100 })));
  const svc = createQuoteService({ fetchQuote: (tg) => vtexFetchQuote(tg) });
  for (const base of ['http://127.0.0.1', 'http://169.254.169.254', 'http://localhost:3000', 'http://10.0.0.5', 'file:///etc/passwd', 'https://user:pw@loja.test', 'http://[::1]']) {
    const r = await svc.quote({ ...TARGET, base }, REQ);
    assert.notEqual(r.status, STATUS.OK, base); assert.equal(r.shippingKnown, false, base); assert.equal(r.total, null, base);
  }
  await assert.rejects(vtexFetchQuote({ ...TARGET, base: 'http://192.168.0.1', quantity: 1, cep: '01310100' }), (e) => e.unsafe === true);
  assert.equal(calls.length, 0, 'nem robots.txt nem simulação foram buscados');
});

await t('endpoint: desligado por padrão; parâmetros do cliente não escolhem o destino', async () => {
  const prev = process.env[ENABLE_FLAG]; delete process.env[ENABLE_FLAG];
  const seen = []; const service = createQuoteService({ fetchQuote: async (tg) => { seen.push(tg); return sim({ id: 'a', name: 'PAC', price: 1000 }); } });
  const resolveOffer = async (id) => (id === 'o1' ? { base: 'https://loja.test', itemId: '10', sellerId: '1' } : null);
  const off = createShippingCalcHandler({ resolveOffer, service });
  const r0 = await off({ offerId: 'o1', cep: '01310-100' }); assert.equal(r0.status, 404); assert.equal(seen.length, 0, 'desligado não consulta nada');
  if (prev !== undefined) process.env[ENABLE_FLAG] = prev;
  const on = createShippingCalcHandler({ resolveOffer, service, enabled: true });
  const evil = { offerId: 'o1', cep: '01310-100', base: 'http://169.254.169.254', itemId: '999', sellerId: 'x', url: 'http://127.0.0.1/' };
  const r1 = await on(evil, { ip: '1.2.3.4' });
  assert.equal(r1.status, 200); assert.equal(r1.body.status, STATUS.OK);
  assert.deepEqual(seen, [{ base: 'https://loja.test', itemId: '10', sellerId: '1', quantity: 1, cep: '01310100' }], 'destino veio do servidor');
  const r2 = await on({ offerId: 'desconhecida', cep: '01310-100', base: 'https://loja.test', itemId: '10' }); assert.equal(r2.body.status, STATUS.UNAVAILABLE); assert.equal(r2.body.shippingKnown, false);
  assert.equal(seen.length, 1, 'oferta sem destino no servidor não consulta, mesmo com base no pedido');
  assert.equal((await on({ offerId: 'o1', cep: '1234' })).status, 400); assert.equal((await on({ cep: '01310-100' })).status, 400);
});

await t('estado de exibição: pago, grátis confirmado, expirada, indisponível e cooldown', () => {
  const ok = { status: STATUS.OK, options: [{ price: 10, free: false }], expiresAt: new Date(2000).toISOString() };
  assert.equal(quoteView(ok, 1000).state, 'paid'); assert.equal(quoteView(ok, 3000).state, 'expired');
  assert.equal(quoteView({ ...ok, options: [{ price: 0, free: true }] }, 1000).state, 'free_confirmed');
  assert.equal(quoteView({ status: STATUS.UNAVAILABLE, options: [] }).state, 'unavailable'); assert.equal(quoteView(null).state, 'idle');
  assert.equal(quoteView({ status: STATUS.COOLDOWN, options: [] }).state, 'store_cooldown');
});

console.log(`shipping-calc-tests: ${n} ok`);
