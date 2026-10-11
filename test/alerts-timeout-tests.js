// Prazo por envio dos alertas (extraído da PR #15 sobre o desenho atual): cada chamada a um canal tem prazo
// (AbortSignal.timeout + limite próprio); prazo estourado = falha do canal, que segue a fila pending de
// alerts-sent.json (#119/#133); canal com 2 falhas seguidas fica fora do resto da chamada; os demais canais seguem.
// Puro: canais e fetch simulados, sem rede.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
process.env.HUNTER_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tmo-cfg-')); process.env.HUNTER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tmo-data-'));
const A = await import('../src/alerts.js');
const { evaluate, dedupe, dispatch, dispatchTips, tipHits, transports, ALERT_TIMEOUT_MS, CHANNEL_DOWN_AFTER } = A;
let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };

const NOW = Date.parse('2026-10-09T12:00:00Z');
const offer = (o = {}) => ({ id: 'o1', productId: 'p1', stock: 'IN_STOCK', matchConfidence: 0.95, anomalous: false, stale: false, confirmed: true, price: 39.9, total: 39.9,
  discount: 0.2, perBooster: null, storeName: 'Loja X', priceKindLabel: 'Pix', shipping: 5, url: 'https://loja/o1', ...o });
const prod = { p1: { id: 'p1', type: 'blister_4', collection: 'me04', collectionName: 'Caos Ascendente', typeLabel: 'Blister Quádruplo', copagConfirmed: true, msrp: 55.99 } };
const alvo = [{ id: 'r', filter: { productId: 'p1' }, maxPrice: 50 }];
const watch = [{ id: 'w', filter: { productId: 'p1' }, maxPrice: 30 }];   // só a queda dispara
const MS = 80;   // prazo curto nos testes
const persist = (s) => JSON.parse(JSON.stringify(s));
// canal que nunca responde e ignora o signal (o pior caso: só o limite do próprio envio o derruba)
const hang = () => new Promise(() => {});
const counter = () => { const calls = []; return { calls, fn: async (m) => { calls.push(m); return true; } } };
const ENV = { TELEGRAM_BOT_TOKEN: '123:SEGREDO-DE-TESTE', TELEGRAM_CHAT_ID: '42', NTFY_TOPIC: 'topico-secreto-de-teste' };
// fetch que só termina quando o signal aborta (como uma conexão aberta sem resposta)
const hangingFetch = (url, opt) => new Promise((_, rej) => {
  const keep = setTimeout(() => rej(new Error('prazo não aplicado')), 5000);
  opt.signal.addEventListener('abort', () => { clearTimeout(keep); rej(opt.signal.reason); });
});

await t('1. transportes reais: fetch travado cai no prazo (AbortSignal.timeout) e rejeita com TimeoutError; prazo padrão 10 s', async () => {
  assert.equal(ALERT_TIMEOUT_MS, 10000); assert.equal(CHANNEL_DOWN_AFTER, 2);
  for (const name of ['telegram', 'ntfy']) {
    const t0 = Date.now();
    await assert.rejects(transports[name]({ text: 'a\nb\nc', url: 'u' }, { env: ENV, fetchImpl: hangingFetch, timeoutMs: MS }), (e) => e.name === 'TimeoutError', name);
    assert.ok(Date.now() - t0 < 1500, `${name}: respeita o prazo`);
  }
  // sem prazo informado: o signal existe (padrão de 10 s)
  let sig = null; await transports.ntfy({ text: 'a\nb\nc', url: 'u' }, { env: ENV, fetchImpl: async (u, o) => { sig = o.signal; return new Response('ok'); } });
  assert.ok(sig instanceof AbortSignal); assert.equal(sig.aborted, false);
  // não configurado continua null, sem chamar a rede
  let called = 0; const f = async () => { called++; return new Response('{}'); };
  assert.equal(await transports.telegram({ text: 'x', url: 'u' }, { env: {}, fetchImpl: f }), null);
  assert.equal(await transports.telegram({ text: 'x', url: 'u' }, { env: { TELEGRAM_BOT_TOKEN: '1:a' }, fetchImpl: f }), null, 'sem chat = não configurado');
  assert.equal(await transports.ntfy({ text: 'x', url: 'u' }, { env: {}, fetchImpl: f }), null); assert.equal(called, 0);
});

await t('2. um canal estoura o prazo e o outro entrega: alerta entregue pelo outro, sem travar a rodada', async () => {
  const sent = {}; const c = counter(); const t0 = Date.now();
  const d = await dispatch(evaluate(alvo, [offer()], [], prod), sent, { send: { telegram: hang, ntfy: c.fn }, now: new Date(NOW), timeoutMs: MS });
  assert.ok(Date.now() - t0 < 1500, 'a rodada segue');
  assert.equal(d.length, 1); assert.deepEqual(d[0].channels, ['ntfy']); assert.ok(!d[0].failed); assert.equal(c.calls.length, 1);
  assert.ok(sent['r|p1'] && !sent['r|p1'].pending, 'entregue: nada pendente');
});

await t('3. todos estouram o prazo: preço-alvo não é gravado (refaz pela condição); queda vai para a fila pending e é reenviada depois', async () => {
  const allHang = { telegram: hang, ntfy: hang };
  // preço-alvo: RETRY_BY_CONDITION, nada gravado e nada no painel
  const s1 = {};
  assert.deepEqual(await dispatch(evaluate(alvo, [offer()], [], prod), s1, { send: allHang, now: new Date(NOW), timeoutMs: MS }), []);
  assert.deepEqual(s1, {}, 'falha (prazo) não marca como enviado');
  // queda: fica no painel como falha e na fila pending de alerts-sent.json (desenho da main)
  let sent = {};
  const h = dedupe(evaluate(watch, [offer()], [{ offerId: 'o1', event: 'drop', from: 60 }], prod), sent, {}, NOW, {});
  const d1 = await dispatch(h, sent, { send: allHang, now: new Date(NOW), timeoutMs: MS });
  assert.equal(d1.length, 1); assert.equal(d1[0].failed, true); assert.deepEqual(d1[0].channels, []);
  assert.ok(sent['drop|o1'].pending, 'prazo estourado segue a fila pending');
  assert.ok(!JSON.stringify(sent).includes('SEGREDO') && !JSON.stringify(d1).includes('SEGREDO'));
  sent = persist(sent);
  // rodada seguinte: ainda travado → segue pendente, sem repetir no painel
  assert.equal((await dispatch([], sent, { send: allHang, now: new Date(NOW + 900e3), timeoutMs: MS })).length, 0);
  assert.ok(sent['drop|o1'].pending);
  // canal voltou → reenviado uma vez, sai da fila
  const c = counter();
  const d3 = await dispatch([], sent, { send: { telegram: c.fn, ntfy: async () => null }, now: new Date(NOW + 1800e3), timeoutMs: MS });
  assert.equal(d3.length, 1); assert.equal(d3[0].retried, true); assert.deepEqual(d3[0].channels, ['telegram']);
  assert.equal(c.calls.length, 1); assert.equal(c.calls[0].text, d1[0].text); assert.ok(!sent['drop|o1'].pending);
});

await t(`4. canal com 2 falhas seguidas (prazo) fica fora do resto da chamada; os demais seguem; não espera o prazo a cada alerta`, async () => {
  let calls = 0; const slow = () => { calls++; return hang(); };
  const offers = ['a', 'b', 'c', 'd', 'e'].map((id, i) => offer({ id, productId: 'p' + i, total: 30 }));
  const P = Object.fromEntries(offers.map((o) => [o.productId, { ...prod.p1, id: o.productId }]));
  const hits = evaluate([{ id: 'r', filter: {}, maxPrice: 50 }], offers, [], P);
  assert.equal(hits.length, 5);
  const c = counter(); const down = {}; const t0 = Date.now();
  const d = await dispatch(hits, {}, { send: { telegram: slow, ntfy: c.fn }, now: new Date(NOW), timeoutMs: MS, down });
  const took = Date.now() - t0;
  assert.equal(d.length, 5, 'ntfy entrega todos'); assert.ok(d.every((x) => x.channels.join() === 'ntfy'));
  assert.equal(calls, 2, 'canal travado chamado só 2×'); assert.equal(down.telegram, 2);
  assert.ok(took < 5 * MS + 1000, `não esperou o prazo nos 5 alertas (${took} ms)`);
  // sucesso zera a contagem: falha isolada não tira o canal da rodada
  let k = 0; const flaky = async () => (++k % 2 === 0);   // falha, entrega, falha, entrega...
  const c2 = counter();
  await dispatch(hits, {}, { send: { telegram: flaky, ntfy: c2.fn }, now: new Date(NOW), timeoutMs: MS });
  assert.equal(k, 5, 'falhas não seguidas: o canal continua sendo tentado');
});

await t('5. canal fora + o outro sem configuração: alerta de evento vai para pending (não some); pistas seguem a mesma regra', async () => {
  // todos os alertas de queda caem no prazo; só os 2 primeiros esperam
  const sent = {}; let calls = 0; const slow = () => { calls++; return hang(); };
  const offers = ['a', 'b', 'c'].map((id, i) => offer({ id, productId: 'p' + i, total: 25 }));
  const P = Object.fromEntries(offers.map((o) => [o.productId, { ...prod.p1, id: o.productId }]));
  const rules = offers.map((o) => ({ id: 'w' + o.productId, filter: { productId: o.productId }, maxPrice: 1 }));
  const h = evaluate(rules, offers, offers.map((o) => ({ offerId: o.id, event: 'drop', from: 40 })), P).filter((x) => x.kind === 'drop');
  assert.equal(h.length, 3);
  const d = await dispatch(h, sent, { send: { telegram: slow, ntfy: async () => null }, now: new Date(NOW), timeoutMs: MS });
  assert.equal(calls, 2); assert.equal(d.length, 3); assert.ok(d.every((x) => x.failed === true));
  assert.ok(['drop|a', 'drop|b', 'drop|c'].every((k) => sent[k]?.pending), 'os 3 ficam pendentes');
  // pistas
  const tip = { id: 't1', isNew: true, productId: 'p1', msrp: 55.99, price: 40, discount: 0.29, collectionName: 'Caos', label: 'Blister', source: 'Pelando', url: 'https://x' };
  const ts = {}; const t0 = Date.now();
  const dt = await dispatchTips(tipHits([tip], ts), ts, { send: { telegram: hang }, now: new Date(NOW), timeoutMs: MS });
  assert.ok(Date.now() - t0 < 1500); assert.equal(dt.length, 1); assert.equal(dt[0].failed, true); assert.ok(ts['tip|t1'].pending);
});

await t('6. o prazo chega ao transporte: dispatch repassa timeoutMs ao canal', async () => {
  let seen = null; const spy = async (m, ctx) => { seen = ctx; return true; };
  await dispatch(evaluate(alvo, [offer()], [], prod), {}, { send: { telegram: spy }, now: new Date(NOW), timeoutMs: 1234 });
  assert.equal(seen.timeoutMs, 1234);
  await dispatch(evaluate(alvo, [offer()], [], prod), {}, { send: { telegram: spy }, now: new Date(NOW) });
  assert.equal(seen.timeoutMs, ALERT_TIMEOUT_MS, 'sem opção: prazo padrão');
  // transporte real ligado ao dispatch: prazo estourado no fetch = falha do canal (sem token no resultado)
  const real = { telegram: (m, ctx) => transports.telegram(m, { ...ctx, env: ENV, fetchImpl: hangingFetch }), ntfy: (m, ctx) => transports.ntfy(m, { ...ctx, env: ENV, fetchImpl: hangingFetch }) };
  const sent = {}; const t0 = Date.now();
  assert.deepEqual(await dispatch(evaluate(alvo, [offer()], [], prod), sent, { send: real, now: new Date(NOW), timeoutMs: MS }), []);
  assert.ok(Date.now() - t0 < 1500); assert.deepEqual(sent, {});
});

await t('7. auditoria: toda chamada fetch de alerts.js, inbox.js e mlauth.js tem AbortSignal.timeout', async () => {
  const rd = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
  for (const f of ['src/alerts.js', 'src/inbox.js', 'src/mlauth.js']) {
    const src = rd(f); const calls = src.split(/\bfetch\)?\(/).length - 1;
    assert.ok(calls >= 1, f); assert.equal((src.match(/AbortSignal\.timeout\(/g) || []).length, calls, `${f}: ${calls} chamadas, todas com AbortSignal.timeout`);
  }
  const { API_TIMEOUT_MS } = await import('../src/inbox.js'); assert.equal(API_TIMEOUT_MS, 10000);
  // mlauth: o signal chega ao fetch (fetch simulado que recusa; nada é gravado e nada sai para a rede)
  const { OAUTH_TIMEOUT_MS, exchange } = await import('../src/mlauth.js'); assert.equal(OAUTH_TIMEOUT_MS, 15000);
  const hadSecret = 'ML_CLIENT_SECRET' in process.env; if (!hadSecret) process.env.ML_CLIENT_SECRET = 'segredo-falso-de-teste';
  const realFetch = globalThis.fetch; let sig = null;
  globalThis.fetch = async (u, o) => { sig = o.signal; return new Response('{}', { status: 400 }); };
  try { await assert.rejects(exchange('codigo-falso'), /OAuth do Mercado Livre recusou/); }
  finally { globalThis.fetch = realFetch; if (!hadSecret) delete process.env.ML_CLIENT_SECRET; }
  assert.ok(sig instanceof AbortSignal, 'OAuth com prazo');
});

console.log(`✓ Prazo por envio dos alertas: ${n} grupos passaram`);
// Queda só como novo melhor preço comparável (residual da #15; registrado aqui para não mexer no script test do package.json)
await import('./alerts-drop-best-tests.js');
