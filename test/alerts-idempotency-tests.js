// Notificações idempotentes: deduplicação por regra/produto, cooldown, mudança real, retry sem spam e
// preferências ausentes. Só mocks de canal: nenhuma notificação real é enviada.
import assert from 'node:assert/strict';
const { evaluate, dedupe, dispatch, dispatchTips, tipHits } = await import('../src/alerts.js');
let n = 0; const t = async (name, fn) => { await fn(); n++; };

const NOW = Date.parse('2026-10-09T12:00:00Z'); const H = 3600e3;
const offer = (o = {}) => ({ id: 'o1', productId: 'p1', stock: 'IN_STOCK', matchConfidence: 0.95, anomalous: false, stale: false, price: 40, total: 40,
  discount: 0.2, perBooster: null, storeName: 'Loja', priceKindLabel: 'Pix', shipping: null, url: 'https://loja/o1', ...o });
const prod = { p1: { id: 'p1', type: 'etb', collection: 'c1', collectionName: 'Coleção', typeLabel: 'ETB', copagConfirmed: true, msrp: 50 } };
const rules = [{ id: 'r', filter: {}, maxPrice: 100 }];
const hitsFor = (o, rs = rules, ev = []) => evaluate(rs, [o], ev, prod);
const rec = (o, ago, extra = {}) => ({ at: new Date(NOW - ago).toISOString(), total: o.total, discount: o.discount, offerId: o.id, ...extra });
const mockSend = () => { const calls = []; return { calls, send: { telegram: async (m) => { calls.push(m); return true; }, ntfy: async () => false } }; };

await t('mesma regra e produto com várias ofertas: um único aviso (a mais barata)', () => {
  const a = offer({ id: 'a', total: 50 }); const b = offer({ id: 'b', total: 40 });
  const hits = evaluate(rules, [a, b], [], prod);
  assert.equal(hits.length, 1); assert.equal(hits[0].offer.id, 'b');
  const hs = evaluate([...rules, { id: 'r2', filter: {}, maxPrice: 100 }], [a], [], prod);
  assert.deepEqual(hs.map((h) => h.key).sort(), ['r|p1', 'r2|p1'], 'chave por regra e produto');
});

await t('retry da mesma rodada não gera spam: segunda passada com o registro gravado não reenvia', async () => {
  const o = offer(); const sent = {}; const { calls, send } = mockSend();
  const first = dedupe(hitsFor(o), sent, {}, NOW, { o1: o });
  const d1 = await dispatch(first, sent, { send, now: new Date(NOW) });
  assert.equal(d1.length, 1); assert.equal(calls.length, 1); assert.deepEqual(d1[0].channels, ['telegram']);
  for (let i = 1; i <= 3; i++) assert.equal(dedupe(hitsFor(o), sent, {}, NOW + i * 60e3, { o1: o }).length, 0, `retry ${i}`);
  assert.equal(calls.length, 1, 'canal chamado uma única vez');
});

await t('canal que lança erro não derruba o envio nem os outros canais', async () => {
  const o = offer(); const sent = {}; const ok = [];
  const send = { telegram: async () => { throw new Error('fora do ar'); }, ntfy: async (m) => { ok.push(m); return true; } };
  const d = await dispatch(hitsFor(o), sent, { send, now: new Date(NOW) });
  assert.deepEqual(d[0].channels, ['ntfy']); assert.equal(ok.length, 1);
});

await t('cooldown: mesmo preço dentro e fora do cooldown não reenvia se a oferta segue em estoque', () => {
  const o = offer();
  for (const ago of [1 * H, 5 * H, 7 * H, 48 * H]) {
    const sent = { 'r|p1': rec(o, ago) };
    assert.equal(dedupe(hitsFor(o), sent, { cooldownHours: 6 }, NOW, { o1: o }).length, 0, `${ago / H}h`);
  }
});

await t('mudança real: queda ≥ minDropPct reenvia; abaixo disso não; desconto +2 p.p. reenvia', () => {
  const o = offer(); const sent = { 'r|p1': rec(o, 1 * H) };
  const cheaper = offer({ total: 39.5 }); // -1,25%
  assert.equal(dedupe(hitsFor(cheaper), sent, {}, NOW, { o1: cheaper }).length, 1);
  const tiny = offer({ total: 39.9 }); // -0,25%
  assert.equal(dedupe(hitsFor(tiny), sent, {}, NOW, { o1: tiny }).length, 0);
  const moreDisc = offer({ discount: 0.23 });
  assert.equal(dedupe(hitsFor(moreDisc), sent, {}, NOW, { o1: moreDisc }).length, 1);
  const lessDisc = offer({ discount: 0.21 });
  assert.equal(dedupe(hitsFor(lessDisc), sent, {}, NOW, { o1: lessDisc }).length, 0);
  assert.equal(dedupe(hitsFor(cheaper), sent, { minDropPct: 0.05 }, NOW, { o1: cheaper }).length, 0, 'preferência de queda mínima respeitada');
});

await t('reposição: só reenvia depois do cooldown; antes dele, não', () => {
  const o = offer(); const rs = [{ id: 'rep', filter: {}, restock: true }]; const ev = [{ offerId: 'o1', event: 'restock' }];
  const sent = (ago) => ({ 'rep|p1': rec(o, ago) });
  assert.equal(dedupe(hitsFor(o, rs, ev), sent(2 * H), { cooldownHours: 6 }, NOW, { o1: o }).length, 0, 'dentro do cooldown');
  assert.equal(dedupe(hitsFor(o, rs, ev), sent(7 * H), { cooldownHours: 6 }, NOW, { o1: o }).length, 1, 'fora do cooldown');
  assert.equal(dedupe(hitsFor(o, rs, ev), sent(7 * H), { cooldownHours: 12 }, NOW, { o1: o }).length, 0, 'cooldown configurado maior');
});

await t('oferta anterior saiu de estoque: só reenvia após o cooldown', () => {
  const o = offer({ id: 'o2' }); const prev = offer({ id: 'o1', stock: 'OUT_OF_STOCK' });
  const by = { o1: prev, o2: o };
  assert.equal(dedupe(hitsFor(o), { 'r|p1': rec(prev, 2 * H) }, {}, NOW, by).length, 0);
  assert.equal(dedupe(hitsFor(o), { 'r|p1': rec(prev, 8 * H) }, {}, NOW, by).length, 1);
});

await t('preferências ausentes ou inválidas: padrão seguro, sem lançar', () => {
  const o = offer(); const sent = { 'r|p1': rec(o, 7 * H) }; const prevGone = { o1: { ...o, stock: 'OUT_OF_STOCK' } };
  for (const s of [undefined, null, {}, { cooldownHours: 'x', minDropPct: NaN }, { cooldownHours: -1 }]) {
    assert.equal(dedupe(hitsFor(o), {}, s, NOW, {}).length, 1, 'sem registro: avisa');
    assert.equal(dedupe(hitsFor(o), sent, s, NOW, { o1: o }).length, 0, 'registro recente e oferta em estoque: não reavisa');
    assert.equal(dedupe(hitsFor(o), sent, s, NOW, prevGone).length, 1, 'padrão de 6 h aplicado');
  }
  assert.deepEqual(evaluate([], [offer()], [], prod), [], 'sem regras (opt-out): nada a enviar');
  assert.deepEqual(evaluate(undefined ?? [], [offer({ stock: 'OUT_OF_STOCK' })], [], prod), [], 'sem estoque confirmado não avisa');
});

await t('pistas: aviso único por id e filtro de desconto mínimo', async () => {
  const tip = (id, d) => ({ id, isNew: true, productId: 'p1', msrp: 50, price: 40, discount: d, collectionName: 'Coleção', label: 'ETB', source: 'Pelando', url: 'https://x' });
  const sent = {}; const { calls, send } = mockSend();
  const hs = tipHits([tip('a', 0.2), tip('b', 0.05)], sent);
  assert.deepEqual(hs.map((x) => x.id), ['a']);
  await dispatchTips(hs, sent, { send, now: new Date(NOW) });
  assert.equal(tipHits([tip('a', 0.2)], sent).length, 0, 'retry não reenvia'); assert.equal(calls.length, 1);
});

console.log(`✓ Notificações idempotentes: ${n} grupos passaram (somente mocks)`);
