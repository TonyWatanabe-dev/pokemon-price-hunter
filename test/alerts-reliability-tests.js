// Confiabilidade dos alertas (issue #45): retry após falha de envio, cooldown/repetição, sem histórico e conteúdo da mensagem.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
process.env.HUNTER_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-cfg-')); process.env.HUNTER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-data-'));
const { evaluate, dedupe, dispatch, compose } = await import('../src/alerts.js');
let n = 0; const t = async (name, fn) => { await fn(); n++; };

const NOW = Date.parse('2026-10-09T12:00:00Z');
const offer = (o = {}) => ({ id: 'o1', productId: 'p1', stock: 'IN_STOCK', matchConfidence: 0.95, anomalous: false, stale: false, confirmed: true, price: 39.9, total: 39.9,
  discount: 0.2, perBooster: null, storeName: 'Loja X', priceKindLabel: 'Pix', shipping: 5, url: 'https://loja/o1', source_timestamp: '2026-10-09T11:55:00Z', ...o });
const prod = { p1: { id: 'p1', type: 'blister_4', collection: 'me04', collectionName: 'Caos Ascendente', typeLabel: 'Blister Quádruplo', copagConfirmed: true, msrp: 55.99 } };
const rules = [{ id: 'r', filter: { productId: 'p1' }, maxPrice: 50 }];
const hitsFor = (o, events = []) => evaluate(rules, [o], events, prod);

await t('mensagem leva produto, loja, preço, horário da leitura e link', () => {
  const m = compose(hitsFor(offer())[0]);
  assert.match(m.text, /CAOS ASCENDENTE/); assert.match(m.text, /Loja: Loja X/); assert.match(m.text, /39,90/);
  assert.match(m.text, /Lido em: 2026-10-09 11:55 UTC/); assert.equal(m.url, 'https://loja/o1');
  assert.doesNotMatch(compose(hitsFor(offer({ source_timestamp: undefined }))[0]).text, /Lido em/, 'sem horário: a linha não aparece');
  assert.doesNotMatch(compose(hitsFor(offer({ source_timestamp: 'lixo' }))[0]).text, /Lido em/);
});
await t('queda sem evento (sem histórico confiável) e oferta stale/anômala/sem estoque não alertam queda', () => {
  const drop = (o) => evaluate([{ id: 'x', filter: { productId: 'p1' } }], [o], o.id === 'o1' ? [{ offerId: 'o1', event: 'drop', from: 60 }] : [], prod).filter((h) => h.kind === 'drop');
  assert.equal(drop(offer()).length, 1);
  assert.equal(evaluate([{ id: 'x', filter: { productId: 'p1' } }], [offer()], [], prod).filter((h) => h.kind === 'drop').length, 0, 'sem evento de queda não há alerta');
  for (const bad of [{ stale: true }, { anomalous: true }, { stock: 'OUT_OF_STOCK' }, { stock: 'UNKNOWN' }, { total: 0 }, { total: null }]) assert.equal(drop(offer(bad)).length, 0, JSON.stringify(bad));
});
await t('restock só com evento; leitura pendente (UNKNOWN) não repõe', () => {
  const r = [{ id: 'rs', filter: { productId: 'p1' }, restock: true }];
  assert.equal(evaluate(r, [offer()], [{ offerId: 'o1', event: 'restock' }], prod).length, 1);
  assert.equal(evaluate(r, [offer()], [], prod).length, 0);
  assert.equal(evaluate(r, [offer({ stock: 'UNKNOWN' })], [{ offerId: 'o1', event: 'restock' }], prod).length, 0);
});
await t('repetição: mesmo preço dentro do cooldown não repete; depois do cooldown só repete se a oferta sumiu; queda real ≥1% repete', () => {
  const [h] = hitsFor(offer()); const sent = { [h.key]: { at: new Date(NOW - 3600e3).toISOString(), total: 39.9, discount: 0.2, offerId: 'o1' } };
  assert.equal(dedupe([h], sent, {}, NOW, { o1: offer() }).length, 0, 'repetição');
  assert.equal(dedupe([h], sent, {}, NOW + 24 * 3600e3, { o1: offer() }).length, 0, 'cooldown vencido mas oferta continua em estoque');
  assert.equal(dedupe([h], sent, {}, NOW + 24 * 3600e3, { o1: offer({ stock: 'OUT_OF_STOCK' }) }).length, 1, 'voltou depois de sumir');
  const [h2] = hitsFor(offer({ total: 39.7, price: 39.7 })); assert.equal(dedupe([h2], sent, {}, NOW, {}).length, 0, 'oscilação de 0,5% é ruído');
  const [h3] = hitsFor(offer({ total: 35, price: 35 })); assert.equal(dedupe([h3], sent, {}, NOW, {}).length, 1, 'queda real');
});
await t('retry: canal falhou, nada é gravado como enviado e a próxima rodada reenvia; recuperação grava uma vez', async () => {
  const hits = hitsFor(offer()); const sent = {}; const sentMsgs = [];
  const down = { telegram: async () => false, ntfy: async () => { throw new Error('rede'); } };
  assert.deepEqual(await dispatch(hits, sent, { send: down, now: new Date(NOW) }), []);
  assert.deepEqual(sent, {}, 'falha total não marca como enviado');
  assert.equal(dedupe(hits, sent, {}, NOW + 60e3, { o1: offer() }).length, 1, 'continua pendente');
  const up = { telegram: async (m) => { sentMsgs.push(m); return true; }, ntfy: async () => false };
  const d = await dispatch(hits, sent, { send: up, now: new Date(NOW + 60e3) });
  assert.equal(d.length, 1); assert.deepEqual(d[0].channels, ['telegram']); assert.ok(sent[hits[0].key]);
  assert.equal(dedupe(hits, sent, {}, NOW + 120e3, { o1: offer() }).length, 0, 'recuperado: não repete');
  assert.equal(sentMsgs.length, 1);
});
await t('canal não configurado (null) segue como "só painel": grava e não fica reenviando', async () => {
  const hits = hitsFor(offer()); const sent = {};
  const d = await dispatch(hits, sent, { send: { telegram: async () => null, ntfy: async () => undefined }, now: new Date(NOW) });
  assert.equal(d.length, 1); assert.deepEqual(d[0].channels, []); assert.ok(sent[hits[0].key]);
});

console.log(`✓ Confiabilidade dos alertas (#45): ${n} grupos passaram`);
