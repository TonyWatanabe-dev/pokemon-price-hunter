// Lote 3 (PR #15) — queda de preço só como NOVO MELHOR PREÇO do produto, medido na mesma base de frete (shipKnown /
// byComparableTotal, api/_lib/offer-rank.mjs; mesma regra de comparableDrop). Puro: sem rede, sem banco.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
process.env.HUNTER_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'al3-cfg-')); process.env.HUNTER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'al3-data-'));
const { evaluate, dedupe, compose, bestByBasis, prevBestOf } = await import('../src/alerts.js');
let n = 0; const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };

const NOW = new Date('2026-10-09T15:30:00Z');
const offer = (o = {}) => ({ id: 'o1', productId: 'p1', stock: 'IN_STOCK', matchConfidence: 0.95, anomalous: false, stale: false, confirmed: true, price: 599.99, total: 599.99,
  shipping: 0, shippingKnown: true, discount: null, perBooster: null, storeName: 'Loja', priceKindLabel: 'Pix', url: 'https://loja/o1', ...o });
const semFrete = (o = {}) => offer({ shipping: null, shippingKnown: false, ...o });
const prod = { p1: { id: 'p1', type: 'combo', collection: 'me04', collectionName: 'Caos Ascendente', typeLabel: 'Combo de Booster', copagConfirmed: false, msrp: null } };
const W = [{ id: 'vigia', filter: { productId: 'p1' }, maxPrice: 1 }];   // vigia o produto (não dispara por preço)
const drop = (id, from, fromShippingKnown = true) => ({ offerId: id, event: 'drop', from, fromShippingKnown });
const pb = (...prev) => prevBestOf(prev);

t('1. caso de produção: queda para R$ 599,99 com outra oferta a R$ 549,90 → nenhum alerta', () => {
  const O = [offer({ id: 'x', total: 599.99 }), offer({ id: 'y', total: 549.9 })];
  assert.equal(evaluate(W, O, [drop('x', 649.99)], prod, { prevBest: pb(offer({ id: 'y', total: 549.9 })) }).length, 0);
  assert.equal(evaluate(W, O, [drop('x', 649.99)], prod).length, 0, 'mesmo sem melhor anterior: não é o menor agora');
});
t('2. novo melhor preço abaixo do melhor anterior → alerta (chave da oferta) e "de" = melhor anterior', () => {
  const O = [offer({ id: 'x', total: 529.9 }), offer({ id: 'y', total: 549.9 })];
  const h = evaluate(W, O, [drop('x', 599.99)], prod, { prevBest: pb(offer({ id: 'x', total: 599.99 }), offer({ id: 'y', total: 549.9 })) });
  assert.equal(h.length, 1); assert.equal(h[0].key, 'drop|x'); assert.equal(h[0].kind, 'drop'); assert.equal(h[0].from, 549.9); assert.equal(h[0].offer.id, 'x');
  assert.match(compose(h[0]).text, /R\$\s549,90 → R\$\s529,90/);
});
t('3. igual ao melhor anterior → nenhum alerta; oferta não elegível ou não confirmada não conta como melhor', () => {
  const O = [offer({ id: 'x', total: 549.9 }), offer({ id: 'y', total: 560 })];
  assert.equal(evaluate(W, O, [drop('x', 599.99)], prod, { prevBest: pb(offer({ id: 'y', total: 549.9 })) }).length, 0);
  for (const bad of [{ stock: 'OUT_OF_STOCK' }, { anomalous: true }, { matchConfidence: 0.5 }, { stale: true }, { confirmed: false }]) {
    const h = evaluate(W, [offer({ id: 'x', total: 530 }), offer({ id: 'z', total: 400, ...bad })], [drop('x', 599.99)], prod, { prevBest: pb(offer({ id: 'y', total: 549.9 })) });
    assert.equal(h.length, 1, JSON.stringify(bad)); assert.equal(h[0].offer.id, 'x');
  }
  assert.equal(evaluate(W, [offer({ id: 'x', total: 500, anomalous: true })], [drop('x', 599.99)], prod).length, 0, 'a própria oferta inelegível: nada');
});
t('4. sem melhor anterior na base: vale se for a melhor agora e abaixo do "de" da queda; empate no total vale', () => {
  const h = evaluate(W, [offer({ id: 'x', total: 500 }), offer({ id: 'y', total: 520 })], [drop('x', 560)], prod);
  assert.deepEqual(h.map((x) => [x.key, x.from]), [['drop|x', 560]]);
  assert.equal(evaluate(W, [offer({ id: 'x', total: 500 })], [drop('x', 500)], prod).length, 0, 'não abaixo do "de"');
  assert.equal(evaluate(W, [offer({ id: 'z', total: 500 }), offer({ id: 'x', total: 500 })], [drop('x', 560)], prod).length, 1, 'empate no menor total');
});
t('5. bases de frete não se misturam: preço sem frete nunca é comparado com total com frete', () => {
  // x (frete conhecido) cai e é a melhor da base com frete; y (sem frete) mais barata no preço não a impede
  const O = [offer({ id: 'x', total: 520 }), semFrete({ id: 'y', total: 480 })];
  const prev = pb(offer({ id: 'x', total: 560 }), offer({ id: 'w', total: 540 }), semFrete({ id: 'y', total: 480 }));
  assert.deepEqual(evaluate(W, O, [drop('x', 560)], prod, { prevBest: prev }).map((h) => [h.key, h.offer.id, h.from]), [['drop|x', 'x', 540]]);
  // queda de oferta sem frete: compara só com as sem frete (anterior 480 → agora 470), chave da oferta
  const O2 = [offer({ id: 'x', total: 520 }), semFrete({ id: 'y', total: 470 })];
  assert.deepEqual(evaluate(W, O2, [drop('y', 480, false)], prod, { prevBest: prev }).map((h) => [h.key, h.from]), [['drop|y', 480]]);
  // uma oferta com frete mais barata que o preço sem frete não "esconde" nem dispara a queda da outra base
  assert.equal(evaluate(W, [offer({ id: 'x', total: 300 }), semFrete({ id: 'y', total: 470 })], [drop('y', 480, false)], prod, { prevBest: prev }).length, 1);
  const best = bestByBasis(O); assert.equal(best.get('p1|frete').id, 'x'); assert.equal(best.get('p1|sem-frete').id, 'y');
});
t('6. evento de queda em outra base de frete (frete passou a ser conhecido/desconhecido) segue sem alerta', () => {
  assert.equal(evaluate(W, [offer({ id: 'x', total: 500 })], [drop('x', 560, false)], prod).length, 0);
});
t('7. melhor anterior pela mesma regra de elegibilidade', () => {
  const prev = [offer({ id: 'a', total: 300 }), offer({ id: 'b', total: 100, anomalous: true }), offer({ id: 'c', total: 150, confirmed: false }),
    offer({ id: 'd', total: 120, stock: 'UNKNOWN', stale: true }), offer({ id: 'e', productId: 'p2', total: 50 })];
  assert.deepEqual([...bestByBasis(prev)].map(([k, o]) => [k, o.id]), [['p1|frete', 'a'], ['p2|frete', 'e']]);
});
t('8. chave da oferta (como na main): dedupe pede nova queda de ≥ 1% (ou fim da espera) para avisar de novo', () => {
  const h = evaluate(W, [offer({ id: 'x', total: 529.9 })], [drop('x', 549.9)], prod, { prevBest: pb(offer({ id: 'x', total: 549.9 })) });
  const sent = { 'drop|x': { at: new Date(NOW - 60e3).toISOString(), total: 530, shippingKnown: true, discount: null, offerId: 'w' } };
  assert.equal(dedupe(h, sent, {}, NOW.getTime(), { w: { stock: 'IN_STOCK' } }).length, 0, 'R$ 0,10 abaixo não é ≥ 1%');
  const h2 = evaluate(W, [offer({ id: 'x', total: 520 })], [drop('x', 529.9)], prod, { prevBest: pb(offer({ id: 'x', total: 529.9 })) });
  assert.equal(dedupe(h2, sent, {}, NOW.getTime(), {}).length, 1);
});
t('9. produto vigiado só por regra antiga (minDealScore) continua recebendo a queda; não vigiado, nada', () => {
  const h = evaluate([{ id: 'velha', filter: { productId: 'p1' }, minDealScore: 70 }], [offer({ id: 'x', total: 500 })], [drop('x', 560)], prod, { prevBest: pb(offer({ id: 'x', total: 540 })) });
  assert.deepEqual(h.map((x) => [x.kind, x.key]), [['drop', 'drop|x']]);
  assert.equal(evaluate([], [offer({ id: 'x', total: 500 })], [drop('x', 560)], prod).length, 0);
});
t('10. oferta que falhou na rodada anterior (stale) conta pela última leitura válida: voltar ao mesmo preço não é queda', () => {
  const prev = [offer({ id: 'x', total: 600, stale: true, stock: 'UNKNOWN', lastValid: { stock: 'IN_STOCK', total: 500, price: 500, shipping: 0, shippingKnown: true } }), offer({ id: 'y', total: 650 })];
  const best = prevBestOf(prev);
  assert.equal(best.get('p1|frete').total, 500, 'usa o lastValid da oferta que falhou');
  assert.equal(bestByBasis(prev).get('p1|frete').total, 650, 'sem o ajuste a base seria a outra oferta (650)');
  assert.equal(prevBestOf([offer({ id: 'x', stale: true, stock: 'UNKNOWN' })]).size, 0, 'stale sem lastValid: sem base');
  const O = [offer({ id: 'x', total: 500 }), offer({ id: 'y', total: 650 })];
  assert.equal(evaluate(W, O, [drop('x', 600)], prod, { prevBest: best }).length, 0, 'mesmo preço da última leitura válida: sem queda');
  assert.equal(evaluate(W, [offer({ id: 'x', total: 480 }), offer({ id: 'y', total: 650 })], [drop('x', 600)], prod, { prevBest: best }).length, 1, 'abaixo: queda real');
});

console.log(`✓ Alertas (queda como novo melhor preço, por base de frete): ${n} grupos passaram`);
