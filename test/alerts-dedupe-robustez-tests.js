// Robustez de dedupe e dispatchTips (issue #343): sent com "at" inválido, pista pendente expirada e HTTP 429/5xx.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
process.env.HUNTER_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rob-cfg-')); process.env.HUNTER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rob-data-'));
const { evaluate, dedupe, dispatch, tipHits, dispatchTips, transports } = await import('../src/alerts.js');
let n = 0; const t = async (name, fn) => { await fn(); n++; };

const NOW = Date.parse('2026-10-09T12:00:00Z');
const offer = (o = {}) => ({ id: 'o1', productId: 'p1', stock: 'IN_STOCK', matchConfidence: 0.95, anomalous: false, stale: false, confirmed: true, price: 39.9, total: 39.9,
  discount: 0.2, perBooster: null, storeName: 'Loja X', priceKindLabel: 'Pix', shipping: 5, url: 'https://loja/o1', source_timestamp: '2026-10-09T11:55:00Z', ...o });
const prod = { p1: { id: 'p1', type: 'blister_4', collection: 'me04', collectionName: 'Caos Ascendente', typeLabel: 'Blister Quádruplo', copagConfirmed: true, msrp: 55.99 } };
const rules = [{ id: 'r', filter: { productId: 'p1' }, maxPrice: 50 }];
const hitsFor = (o) => evaluate(rules, [o], [], prod);
const tip = { id: 't1', isNew: true, productId: 'p1', msrp: 55.99, price: 40, discount: 0.29, collectionName: 'Caos', label: 'Blister', source: 'Pelando', url: 'https://x' };
const persist = (s) => JSON.parse(JSON.stringify(s));

await t('dedupe: "at" inválido/ausente em sent não lança e nunca vence o cooldown (comportamento atual)', () => {
  const [h] = hitsFor(offer()); const gone = { o1: offer({ stock: 'OUT_OF_STOCK' }) };
  for (const at of ['lixo', '', null, undefined, 12345678901234567890]) {
    const sent = { [h.key]: { at, total: 39.9, discount: 0.2, offerId: 'o1' } };
    assert.equal(dedupe([h], sent, {}, NOW + 365 * 24 * 3600e3, gone).length, 0, `at=${String(at)}: NaN não vence cooldown`);
  }
});
await t('dedupe: "at" inválido ainda deixa passar queda real e desconto maior', () => {
  const sent = (h) => ({ [h.key]: { at: 'lixo', total: 39.9, discount: 0.2, offerId: 'o1' } });
  const [cheap] = hitsFor(offer({ total: 35, price: 35 })); assert.equal(dedupe([cheap], sent(cheap), {}, NOW, {}).length, 1);
  const [disc] = hitsFor(offer({ discount: 0.25 })); assert.equal(dedupe([disc], sent(disc), {}, NOW, {}).length, 1);
});
await t('dedupe: sent corrompido (entrada nula) e preferências inválidas não lançam', () => {
  const [h] = hitsFor(offer());
  assert.equal(dedupe([h], { [h.key]: null }, {}, NOW, {}).length, 1, 'entrada nula = sem histórico');
  assert.equal(dedupe([h], {}, { cooldownHours: 'x', minDropPct: -1 }, NOW, {}).length, 1);
});

await t('pista pendente expirada (>24 h) sai da fila sem enviar e continua registrada: não é reenviada nem vira nova', async () => {
  const sent = {}; const down = { telegram: async () => false, ntfy: async () => false };
  const d1 = await dispatchTips(tipHits([tip], sent), sent, { send: down, now: new Date(NOW) });
  assert.equal(d1.length, 1); assert.equal(d1[0].failed, true); assert.ok(sent['tip|t1'].pending);
  const calls = []; const up = { telegram: async (m) => { calls.push(m); return true; }, ntfy: async () => null };
  const d2 = await dispatchTips(tipHits([tip], sent), sent, { send: up, now: new Date(NOW + 25 * 3600e3) });
  assert.deepEqual(d2, [], 'nada enviado'); assert.equal(calls.length, 0);
  assert.equal(sent['tip|t1'].pending, undefined, 'pendente removido');
  assert.ok(sent['tip|t1'], 'registro fica');
  assert.equal(tipHits([tip], sent).length, 0, 'pista não volta mesmo com isNew');
});
await t('pista pendente dentro de 24 h é reenviada uma vez', async () => {
  const sent = {}; const down = { telegram: async () => false, ntfy: async () => false };
  await dispatchTips([tip], sent, { send: down, now: new Date(NOW) });
  const calls = []; const up = { telegram: async (m) => { calls.push(m); return true; }, ntfy: async () => null };
  const d2 = await dispatchTips([], persist(sent), { send: up, now: new Date(NOW + 23 * 3600e3) });
  assert.equal(d2.length, 1); assert.equal(d2[0].retried, true); assert.equal(calls.length, 1);
});
await t('pendente com "since" inválido não lança (NaN não expira e é reenviado)', async () => {
  const sent = { 'tip|t9': { at: 'x', total: 1, pending: { since: 'lixo', msg: { title: 'a', text: 'a\n\nb', url: 'https://x' }, alert: { kind: 'tip' } } } };
  const calls = []; const up = { telegram: async (m) => { calls.push(m); return true; }, ntfy: async () => null };
  const d = await dispatchTips([], sent, { send: up, now: new Date(NOW) });
  assert.equal(d.length, 1); assert.equal(calls.length, 1); assert.equal(sent['tip|t9'].pending, undefined);
});

const http = (status) => async () => ({ ok: status >= 200 && status < 300, status });
const env = { TELEGRAM_BOT_TOKEN: 'tok', TELEGRAM_CHAT_ID: '1', NTFY_TOPIC: 'tp' };
const msg = { title: 'T', text: 'a\n\nb', url: 'https://x' };
await t('transportes: HTTP 429/500/503 = falha (false); 200 = true; sem configuração = null', async () => {
  for (const st of [429, 500, 502, 503]) {
    assert.equal(await transports.telegram(msg, { env, fetchImpl: http(st) }), false, 'telegram ' + st);
    assert.equal(await transports.ntfy(msg, { env, fetchImpl: http(st) }), false, 'ntfy ' + st);
  }
  assert.equal(await transports.telegram(msg, { env, fetchImpl: http(200) }), true);
  assert.equal(await transports.ntfy(msg, { env, fetchImpl: http(200) }), true);
  assert.equal(await transports.telegram(msg, { env: {}, fetchImpl: http(500) }), null);
  assert.equal(await transports.ntfy(msg, { env: {}, fetchImpl: http(500) }), null);
});
for (const st of [429, 503]) {
  const mk = (status) => ({ telegram: (m, c) => transports.telegram(m, { ...c, env, fetchImpl: http(status) }), ntfy: (m, c) => transports.ntfy(m, { ...c, env: {}, fetchImpl: http(status) }) });
  await t(`dispatchTips com HTTP ${st} no canal único configurado: vira pendente e recupera depois`, async () => {
    const sent = {};
    const d = await dispatchTips([tip], sent, { send: mk(st), now: new Date(NOW) });
    assert.equal(d[0].failed, true); assert.ok(sent['tip|t1'].pending);
    const r = await dispatchTips([], sent, { send: mk(200), now: new Date(NOW + 3600e3) });
    assert.equal(r.length, 1); assert.deepEqual(r[0].channels, ['telegram']); assert.equal(sent['tip|t1'].pending, undefined);
  });
  await t(`dispatch com HTTP ${st}: alerta de condição não é gravado e dedupe deixa repetir`, async () => {
    const hits = hitsFor(offer()); const sent = {};
    assert.deepEqual(await dispatch(hits, sent, { send: mk(st), now: new Date(NOW) }), []);
    assert.deepEqual(sent, {}); assert.equal(dedupe(hits, sent, {}, NOW + 60e3, { o1: offer() }).length, 1);
  });
}
await t('um canal com HTTP 429 e outro entregue: conta como entregue, sem pendente', async () => {
  const send = { telegram: (m, c) => transports.telegram(m, { ...c, env, fetchImpl: http(429) }), ntfy: (m, c) => transports.ntfy(m, { ...c, env, fetchImpl: http(200) }) };
  const sent = {}; const d = await dispatchTips([tip], sent, { send, now: new Date(NOW) });
  assert.deepEqual(d[0].channels, ['ntfy']); assert.equal(d[0].failed, undefined); assert.equal(sent['tip|t1'].pending, undefined);
});

console.log(`alerts-dedupe-robustez-tests: ${n} ok`);
