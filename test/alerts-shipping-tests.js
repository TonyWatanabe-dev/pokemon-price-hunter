// Alertas e frete comparável (issue #84, regra da PR #182 em api/_lib/offer-rank.mjs): frete conhecido (ou grátis)
// compara por total; frete desconhecido nunca vence nem substitui uma oferta com frete conhecido; todas desconhecidas
// comparam pelo preço e a mensagem diz "frete a calcular"; nunca se inventa frete. Queda só na mesma base.
// Só canais simulados: nenhuma notificação real é enviada, sem rede.
import assert from 'node:assert/strict';
const alerts = await import('../src/alerts.js');
const { evaluate, dedupe, dispatch, compose, comparableDrop } = alerts;
let n = 0; const fails = [];
const t = async (name, fn) => { try { await fn(); n++; } catch (e) { fails.push(`✗ ${name}\n  ${e.message.split('\n')[0]}`); } };

const NOW = Date.parse('2026-10-09T12:00:00Z'); const H = 3600e3;
const offer = (o = {}) => ({ id: 'o', productId: 'p1', stock: 'IN_STOCK', matchConfidence: 0.95, anomalous: false, stale: false, confirmed: true,
  discount: null, perBooster: null, storeName: 'Loja', priceKindLabel: 'Pix', url: 'https://loja/o', ...o });
// A: R$ 100, frete desconhecido (total = preço, sem frete). B: R$ 105, frete grátis conhecido.
const A = offer({ id: 'A', price: 100, total: 100, shipping: null, shippingKnown: false, url: 'https://loja-a/p' });
const B = offer({ id: 'B', price: 105, total: 105, shipping: 0, shippingKnown: true, url: 'https://loja-b/p' });
const C = offer({ id: 'C', price: 98, total: 98, shipping: null, shippingKnown: false, url: 'https://loja-c/p' });
const prod = { p1: { id: 'p1', type: 'etb', collection: 'c1', collectionName: 'Coleção', typeLabel: 'ETB', copagConfirmed: false, msrp: null } };
const mockSend = () => { const calls = []; return { calls, send: { telegram: async (m) => { calls.push(m); return true; } } }; };

await t('melhor oferta: A R$ 100 (frete desconhecido) × B R$ 105 (frete grátis) → o alerta usa B, em qualquer ordem', async () => {
  for (const list of [[A, B], [B, A]]) {
    for (const r of [{ id: 'deal', filter: {}, maxPrice: 200 }, { id: 'alvo', mode: 'target', filter: { productId: 'p1' }, maxPrice: 200 }]) {
      const hits = evaluate([r], list, [], prod);
      assert.equal(hits.length, 1); assert.equal(hits[0].offer.id, 'B', `regra ${r.id}: frete desconhecido não vence o conhecido`);
    }
  }
  const { calls, send } = mockSend(); const sent = {};
  await dispatch(evaluate([{ id: 'deal', filter: {}, maxPrice: 200 }], [A, B], [], prod), sent, { send, now: new Date(NOW) });
  assert.equal(calls.length, 1); assert.equal(calls[0].url, 'https://loja-b/p');
  assert.match(calls[0].text, /R\$\s105,00 \(Pix\)/); assert.match(calls[0].text, /Frete: grátis/);
  assert.doesNotMatch(calls[0].text, /a calcular|\+ frete/);
});

await t('alvo R$ 102 só com A (frete desconhecido): compara pelo preço, dispara e diz "+ frete" sem inventar total', () => {
  const r = { id: 'alvo', mode: 'target', filter: { productId: 'p1' }, maxPrice: 102 };
  const hits = evaluate([r], [A], [], prod);
  assert.equal(hits.length, 1); assert.equal(hits[0].kind, 'target'); assert.equal(hits[0].offer.total, 100, 'nenhum frete somado');
  const m = compose(hits[0]).text;
  assert.match(m, /R\$\s100,00 \+ frete \(Pix\)/); assert.match(m, /Frete: a calcular/);
  assert.doesNotMatch(m, /Frete: grátis|Frete: R\$/, 'frete nunca inventado');
  // Com frete conhecido, o alvo vale pelo total (preço + frete): R$ 95 + R$ 10 = R$ 105 não atinge R$ 102.
  const K = offer({ id: 'K', price: 95, total: 105, shipping: 10, shippingKnown: true });
  assert.equal(evaluate([r], [K], [], prod).length, 0, 'total com frete conhecido acima do alvo: não dispara');
  const hk = evaluate([{ ...r, maxPrice: 105 }], [K], [], prod);
  assert.equal(hk.length, 1); assert.match(compose(hk[0]).text, /R\$\s105,00 \(Pix\)/); assert.match(compose(hk[0]).text, /Frete: R\$\s10,00/);
});

await t('todas com frete desconhecido: vence o menor preço e a mensagem diz "frete a calcular"', () => {
  const hits = evaluate([{ id: 'deal', filter: {}, maxPrice: 200 }], [A, C], [], prod);
  assert.equal(hits.length, 1); assert.equal(hits[0].offer.id, 'C');
  const m = compose(hits[0]).text; assert.match(m, /R\$\s98,00 \+ frete/); assert.match(m, /Frete: a calcular/);
});

await t('queda: total com frete conhecido → preço com frete desconhecido não é queda (mesma regra de offer-change)', () => {
  assert.equal(typeof comparableDrop, 'function', 'regra de queda exportada para o robô');
  const known = { total: 105, shippingKnown: true, stock: 'IN_STOCK' }; const unk = { total: 100, shippingKnown: false, stock: 'IN_STOCK' };
  assert.equal(comparableDrop(known, unk), null, 'conhecido → desconhecido: não compara');
  assert.equal(comparableDrop(unk, { total: 110, price: 95, shippingKnown: true, stock: 'IN_STOCK' }), null, 'desconhecido → conhecido: não compara');
  assert.deepEqual(comparableDrop(known, { total: 99, shippingKnown: true, stock: 'IN_STOCK' }), { from: 105, shippingKnown: true }, 'total contra total');
  assert.deepEqual(comparableDrop(unk, { total: 90, shippingKnown: false, stock: 'IN_STOCK' }), { from: 100, shippingKnown: false }, 'preço contra preço');
  assert.equal(comparableDrop(known, { total: 99, shippingKnown: true, stock: 'UNKNOWN' }), null, 'estoque desconhecido não vira evento');
  // Evento de queda vindo de base diferente (ex.: fila antiga) não vira alerta.
  const rules = [{ id: 'w', filter: { productId: 'p1' }, maxPrice: 1 }];
  assert.equal(evaluate(rules, [A], [{ offerId: 'A', event: 'drop', from: 105, fromShippingKnown: true }], prod).filter((h) => h.kind === 'drop').length, 0);
  const ok = evaluate(rules, [A], [{ offerId: 'A', event: 'drop', from: 120, fromShippingKnown: false }], prod).filter((h) => h.kind === 'drop');
  assert.equal(ok.length, 1); assert.match(compose(ok[0]).text, /R\$\s120,00 → R\$\s100,00 \+ frete/);
});

await t('reaviso: total com frete conhecido já enviado não é "superado" por preço com frete desconhecido', async () => {
  const r = [{ id: 'deal', filter: {}, maxPrice: 200 }]; const sent = {}; const { send } = mockSend();
  await dispatch(evaluate(r, [B], [], prod), sent, { send, now: new Date(NOW) });
  assert.equal(sent['deal|p1'].shippingKnown, true, 'registro guarda a base do total');
  // B continua em estoque, mas some da lista elegível (ex.: leitura não confirmada); A (R$ 100, frete desconhecido) aparece.
  assert.equal(dedupe(evaluate(r, [A], [], prod), sent, {}, NOW + H, { B, A }).length, 0, 'R$ 100 + frete não é "mais barato" que R$ 105 com frete');
  const cheaperKnown = offer({ id: 'B2', price: 90, total: 90, shipping: 0, shippingKnown: true });
  assert.equal(dedupe(evaluate(r, [cheaperKnown], [], prod), sent, {}, NOW + H, { B, B2: cheaperKnown }).length, 1, 'total conhecido menor: reavisa');
});

if (fails.length) { console.error(fails.join('\n')); throw new Error(`Alertas com frete comparável (#84): ${fails.length} grupo(s) falharam`); }
console.log(`✓ Alertas com frete comparável (#84): ${n} grupos passaram (somente mocks)`);
