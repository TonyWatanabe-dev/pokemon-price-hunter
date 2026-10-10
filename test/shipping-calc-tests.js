// Issue #84 — núcleo do cálculo de frete por CEP: validação, fidelidade à cotação, isolamento de chaves, totais e abuso.
import assert from 'node:assert/strict';
import { normalizeCep, parseEstimate, parseVtexSimulation, totalWithShipping, sortByTotal, createQuoteService, quoteKey, quoteView, STATUS } from '../src/shipping-calc.js';

let n = 0; const t = async (name, fn) => { await fn(); n++; };
const sim = (...slas) => ({ logisticsInfo: [{ slas }] });
const REQ = { base: 'https://loja.test', itemId: '10', sellerId: '1', quantity: 1, cep: '01310-100' };

await t('CEP válido e inválido', () => {
  assert.equal(normalizeCep('01310-100'), '01310100'); assert.equal(normalizeCep(' 01310100 '), '01310100');
  for (const bad of ['', '1234567', '123456789', 'abcdefgh', '00000000', null, undefined, {}, '01310-10a', '01310--100']) assert.equal(normalizeCep(bad), null, String(bad));
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

await t('total considera quantidade e só existe com frete confirmado', () => {
  const q = parseVtexSimulation(sim({ id: 'a', name: 'PAC', price: 1000 }));
  assert.equal(totalWithShipping(50, q, 3), 160); assert.equal(totalWithShipping(50, q, 0), null); assert.equal(totalWithShipping(null, q), null);
  assert.equal(totalWithShipping(50, { status: STATUS.ERROR, options: [] }), null);
});

await t('ordenação por total nunca trata frete desconhecido como zero', () => {
  const out = sortByTotal([{ id: 'sem', total: null }, { id: 'caro', total: 200 }, { id: 'barato', total: 120 }]);
  assert.deepEqual(out.map((r) => r.id), ['barato', 'caro', 'sem']);
});

await t('serviço: entrada inválida não chama a loja; origem e horário registrados; auditoria sem CEP completo', async () => {
  let calls = 0; const audits = []; let clock = 1_000_000;
  const svc = createQuoteService({ fetchQuote: async () => { calls++; return sim({ id: 'a', name: 'PAC', price: 1500, shippingEstimate: '4bd' }); }, now: () => clock, onAudit: (a) => audits.push(a) });
  assert.equal((await svc.quote({ ...REQ, cep: '123' })).status, STATUS.INVALID_CEP); assert.equal(calls, 0);
  assert.equal((await svc.quote({ ...REQ, quantity: 0 })).status, STATUS.ERROR);
  const r = await svc.quote(REQ);
  assert.equal(r.status, STATUS.OK); assert.equal(r.source, 'vtex_simulation'); assert.equal(r.quotedAt, new Date(clock).toISOString());
  assert.equal(audits.length, 1); assert.equal(audits[0].cepPrefix, '013'); assert.ok(!JSON.stringify(audits).includes('01310100'));
  assert.equal((await svc.quote(REQ)).cached, true); assert.equal(calls, 1);
  clock += 6 * 60_000; // cotação expirada: consulta de novo, com novo horário
  const again = await svc.quote(REQ); assert.equal(again.cached, false); assert.equal(calls, 2); assert.equal(again.quotedAt, new Date(clock).toISOString());
});

await t('dois CEPs, variantes, quantidades e vendedores não compartilham cotação', async () => {
  const seen = []; const svc = createQuoteService({ fetchQuote: async (r) => { seen.push(quoteKey(r)); return sim({ id: 'a', name: 'PAC', price: 100 * Number(r.cep.slice(-1)) + 100 * r.quantity }); } });
  const rs = [];
  for (const v of [REQ, { ...REQ, cep: '01310-101' }, { ...REQ, itemId: '11' }, { ...REQ, quantity: 2 }, { ...REQ, sellerId: '2' }, { ...REQ, base: 'https://outra.test' }]) rs.push(await svc.quote(v));
  assert.equal(new Set(seen).size, 6); assert.ok(rs.every((r) => !r.cached));
  assert.notEqual(rs[0].options[0].price, rs[1].options[0].price); assert.notEqual(rs[0].options[0].price, rs[3].options[0].price);
});

await t('erro e timeout não viram frete zero e não são cacheados', async () => {
  let mode = 'timeout'; let calls = 0;
  const svc = createQuoteService({ fetchQuote: async () => { calls++; if (mode === 'timeout') { const e = new Error('x'); e.name = 'AbortError'; throw e; } if (mode === 'error') throw new Error('HTTP 500'); return sim({ id: 'a', name: 'PAC', price: 900 }); } });
  const a = await svc.quote(REQ); assert.equal(a.status, STATUS.TIMEOUT); assert.deepEqual(a.options, []); assert.equal(totalWithShipping(80, a), null);
  mode = 'error'; assert.equal((await svc.quote(REQ)).status, STATUS.ERROR);
  mode = 'ok'; const ok = await svc.quote(REQ); assert.equal(ok.status, STATUS.OK); assert.equal(calls, 3);
});

await t('rate limit por cliente; cotação em cache não consome limite', async () => {
  let calls = 0; const svc = createQuoteService({ fetchQuote: async () => { calls++; return sim({ id: 'a', name: 'PAC', price: 100 }); }, rate: { max: 3, windowMs: 60_000 } });
  for (let i = 0; i < 3; i++) assert.equal((await svc.quote({ ...REQ, quantity: i + 1 }, { client: 'c1' })).status, STATUS.OK);
  assert.equal((await svc.quote({ ...REQ, quantity: 1 }, { client: 'c1' })).cached, true);
  assert.equal((await svc.quote({ ...REQ, quantity: 9 }, { client: 'c1' })).status, STATUS.RATE_LIMITED);
  assert.equal((await svc.quote({ ...REQ, quantity: 9 }, { client: 'c2' })).status, STATUS.OK); assert.equal(calls, 4);
});

await t('loja sem integração: indisponível, sem preço', async () => {
  const svc = createQuoteService({ fetchQuote: async () => { throw new Error('não deveria chamar'); } });
  const r = await svc.quote({ ...REQ, base: null }); assert.equal(r.status, STATUS.UNAVAILABLE); assert.deepEqual(r.options, []);
});

await t('estado de exibição: pago, grátis confirmado, expirada e indisponível', () => {
  const ok = { status: STATUS.OK, options: [{ price: 10, free: false }], expiresAt: new Date(2000).toISOString() };
  assert.equal(quoteView(ok, 1000).state, 'paid'); assert.equal(quoteView(ok, 3000).state, 'expired');
  assert.equal(quoteView({ ...ok, options: [{ price: 0, free: true }] }, 1000).state, 'free_confirmed');
  assert.equal(quoteView({ status: STATUS.UNAVAILABLE, options: [] }).state, 'unavailable'); assert.equal(quoteView(null).state, 'idle');
});

console.log(`shipping-calc-tests: ${n} ok`);
