// Confiabilidade dos alertas (issue #45): retry após falha de envio, cooldown/repetição, sem histórico e conteúdo da mensagem.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
process.env.HUNTER_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-cfg-')); process.env.HUNTER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-data-'));
const { evaluate, dedupe, dispatch, compose, tipHits, dispatchTips } = await import('../src/alerts.js');
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

// Queda/reposição/pista só existem na rodada da transição (run.js gera o evento uma vez; pista só com isNew).
// Se todos os canais falham, o alerta não pode sumir: fica visível no painel como falha e vai para a fila de
// pendentes (persistida em alerts-sent.json), reenviada nas rodadas seguintes mesmo sem o evento.
const counter = () => { const calls = []; return { calls, ok: { telegram: async (m) => { calls.push(m); return true; }, ntfy: async () => null } }; };
const down = { telegram: async () => false, ntfy: async () => { throw new Error('rede'); } };
const persist = (s) => JSON.parse(JSON.stringify(s)); // run.js grava e relê alerts-sent.json entre rodadas
const watch = [{ id: 'w', filter: { productId: 'p1' }, maxPrice: 30 }];  // só a queda dispara
const restockRule = [{ id: 'rs', filter: { productId: 'p1' }, restock: true }];
const tip = { id: 't1', isNew: true, productId: 'p1', msrp: 55.99, price: 40, discount: 0.29, collectionName: 'Caos', label: 'Blister', source: 'Pelando', url: 'https://x' };

for (const [nome, rs, ev] of [['queda', watch, { offerId: 'o1', event: 'drop', from: 60 }], ['reposição', restockRule, { offerId: 'o1', event: 'restock' }]]) {
  await t(`${nome}: falha total fica no painel como falha e é reenviada na rodada seguinte sem o evento, uma vez só`, async () => {
    let sent = {};
    const h1 = dedupe(evaluate(rs, [offer()], [ev], prod), sent, {}, NOW, { o1: offer() });
    assert.equal(h1.length, 1);
    const d1 = await dispatch(h1, sent, { send: down, now: new Date(NOW) });
    assert.equal(d1.length, 1, 'não some do painel/alerts.jsonl'); assert.deepEqual(d1[0].channels, []); assert.equal(d1[0].failed, true);
    sent = persist(sent);
    const c = counter();
    const h2 = dedupe(evaluate(rs, [offer()], [], prod), sent, {}, NOW + 900e3, { o1: offer() });
    assert.equal(h2.length, 0, 'rodada seguinte não tem evento');
    const d2 = await dispatch(h2, sent, { send: c.ok, now: new Date(NOW + 900e3) });
    assert.equal(d2.length, 1, 'pendente reenviado'); assert.deepEqual(d2[0].channels, ['telegram']); assert.equal(d2[0].kind, h1[0].kind);
    assert.equal(c.calls.length, 1); assert.equal(c.calls[0].text, d1[0].text, 'mesma mensagem da rodada original');
    sent = persist(sent);
    assert.equal((await dispatch([], sent, { send: c.ok, now: new Date(NOW + 1800e3) })).length, 0, 'entregue: não reenvia');
    assert.equal(c.calls.length, 1);
  });
}
await t('pista: falha total fica no painel e é reenviada mesmo sem isNew, uma vez só', async () => {
  let sent = {};
  const d1 = await dispatchTips(tipHits([tip], sent), sent, { send: down, now: new Date(NOW) });
  assert.equal(d1.length, 1); assert.deepEqual(d1[0].channels, []); assert.equal(d1[0].failed, true);
  sent = persist(sent);
  const c = counter();
  const h2 = tipHits([{ ...tip, isNew: false }], sent); assert.equal(h2.length, 0);
  const d2 = await dispatchTips(h2, sent, { send: c.ok, now: new Date(NOW + 900e3) });
  assert.equal(d2.length, 1); assert.deepEqual(d2[0].channels, ['telegram']); assert.equal(c.calls.length, 1);
  assert.equal((await dispatchTips([], persist(sent), { send: c.ok, now: new Date(NOW + 1800e3) })).length, 0);
  assert.equal(c.calls.length, 1);
  assert.equal((await dispatch([], sent, { send: c.ok, now: new Date(NOW + 900e3) })).length, 0, 'dispatch não mexe na fila de pistas');
});
await t('fila: pendente ainda falhando continua pendente; nova queda da mesma oferta substitui o pendente (sem envio duplo); pendente velho expira', async () => {
  const sent = {};
  await dispatch(dedupe(evaluate(watch, [offer()], [{ offerId: 'o1', event: 'drop', from: 60 }], prod), sent, {}, NOW, {}), sent, { send: down, now: new Date(NOW) });
  assert.equal((await dispatch([], sent, { send: down, now: new Date(NOW + 900e3) })).length, 0, 'segue falhando: não repete no painel');
  const c = counter();
  const o2 = offer({ total: 35, price: 35 }); // acima do maxPrice: só a queda dispara
  const h = dedupe(evaluate(watch, [o2], [{ offerId: 'o1', event: 'drop', from: 39.9 }], prod), sent, {}, NOW + 1800e3, {});
  assert.equal(h.length, 1);
  const d = await dispatch(h, sent, { send: c.ok, now: new Date(NOW + 1800e3) });
  assert.equal(d.length, 1); assert.equal(c.calls.length, 1, 'só a queda nova, não a antiga também'); assert.match(c.calls[0].text, /35,00/);
  assert.equal((await dispatch([], sent, { send: c.ok, now: new Date(NOW + 2700e3) })).length, 0); assert.equal(c.calls.length, 1);
  const old = {};
  await dispatch(dedupe(evaluate(watch, [offer()], [{ offerId: 'o1', event: 'drop', from: 60 }], prod), old, {}, NOW, {}), old, { send: down, now: new Date(NOW) });
  assert.equal((await dispatch([], old, { send: c.ok, now: new Date(NOW + 25 * 3600e3) })).length, 0, 'pendente com mais de 24h não é enviado (informação velha)');
  assert.equal(c.calls.length, 1); assert.ok(old['drop|o1'] && !old['drop|o1'].pending, 'sai da fila mas segue registrado');
});
await t('canal parcialmente ok: entrega e não reenvia a ninguém na rodada seguinte', async () => {
  const sent = {}; const c = counter();
  const part = { telegram: c.ok.telegram, ntfy: async () => false };
  const d = await dispatch(dedupe(evaluate(watch, [offer()], [{ offerId: 'o1', event: 'drop', from: 60 }], prod), sent, {}, NOW, {}), sent, { send: part, now: new Date(NOW) });
  assert.equal(d.length, 1); assert.deepEqual(d[0].channels, ['telegram']); assert.ok(!d[0].failed); assert.ok(!sent['drop|o1'].pending);
  assert.equal((await dispatch([], sent, { send: part, now: new Date(NOW + 900e3) })).length, 0); assert.equal(c.calls.length, 1);
});

console.log(`✓ Confiabilidade dos alertas (#45): ${n} grupos passaram`);
// #82: acessibilidade do fluxo de compra (registrado aqui para não mexer no script test do package.json)
await import('./a11y-purchase-tests.js');
