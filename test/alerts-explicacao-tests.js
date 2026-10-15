// Fase 4 — cada alerta explica produto, loja, mudança, horário da leitura, motivo e base de comparação (frete).
// Puro: canais simulados, sem rede e sem banco. A mensagem conferida é a que o canal recebe (dispatch → compose).
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
process.env.HUNTER_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'expl-cfg-')); process.env.HUNTER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'expl-data-'));
const { evaluate, dispatch, compose, alertReason, comparisonBasis } = await import('../src/alerts.js');
let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { e.message = `${name}: ${e.message}`; throw e; } };

const NOW = new Date('2026-10-15T12:00:00Z');
const offer = (o = {}) => ({ id: 'o1', productId: 'p1', stock: 'IN_STOCK', matchConfidence: 0.95, anomalous: false, stale: false, confirmed: true,
  price: 300, total: 300, shipping: 0, shippingKnown: true, discount: 0.3, perBooster: 8.33, storeName: 'Loja X', seller: null, priceKindLabel: 'Pix',
  url: 'https://loja-x/p1', source_timestamp: '2026-10-15T11:50:00Z', ...o });
const prod = { p1: { id: 'p1', type: 'booster_box', collection: 'me04', collectionName: 'Caos Ascendente', typeLabel: 'Booster Box', boosters: 36, copagConfirmed: true, msrp: 429.9 } };
const sendOk = () => { const calls = []; return { calls, send: { telegram: async (m) => { calls.push(m); return true; } } }; };

// Um hit de cada tipo, montado pelo caminho real (evaluate).
const cases = {
  target: () => evaluate([{ id: 'alvo', label: 'Caos abaixo de R$350', mode: 'target', filter: { productId: 'p1' }, maxPrice: 350 }], [offer()], [], prod),
  deal: () => evaluate([{ id: 'copag-25', label: 'Qualquer produto 25% abaixo da Copag', filter: {}, minDiscount: 0.25, maxPerBooster: 10 }], [offer()], [], prod),
  restock: () => evaluate([{ id: 'rs', label: 'Caos voltou', filter: { productId: 'p1' }, restock: true }], [offer()], [{ offerId: 'o1', event: 'restock' }], prod),
  drop: () => evaluate([{ id: 'w', filter: { productId: 'p1' }, maxPrice: 1 }], [offer()], [{ offerId: 'o1', event: 'drop', from: 400, fromShippingKnown: true }], prod).filter((h) => h.kind === 'drop'),
};

for (const [kind, mk] of Object.entries(cases)) {
  await t(`${kind}: mensagem enviada tem produto, loja, mudança, horário, motivo e base de comparação`, async () => {
    const hits = mk(); assert.equal(hits.length, 1); assert.equal(hits[0].kind, kind);
    const { calls, send } = sendOk();
    await dispatch(hits, {}, { send, now: NOW });
    assert.equal(calls.length, 1); const m = calls[0].text;
    assert.match(m, /CAOS ASCENDENTE/); assert.match(m, /Booster Box com 36 boosters/, 'produto');
    assert.match(m, /Loja: Loja X/, 'loja');
    assert.match(m, kind === 'drop' ? /R\$\s400,00 → R\$\s300,00/ : /R\$\s300,00 \(Pix\)/, 'mudança/valor');
    assert.match(m, /Lido em: 2026-10-15 11:50 UTC/, 'horário da leitura');
    assert.match(m, /^Motivo: .+/m, 'motivo');
    assert.match(m, /^Comparação: total com frete, só contra totais com frete conhecido$/m, 'base de comparação');
    assert.equal(calls[0].url, 'https://loja-x/p1');
  });
}

await t('motivo de cada tipo diz a condição que disparou, sem inventar dado', () => {
  assert.equal(alertReason(cases.target()[0]), 'Motivo: preço-alvo atingido · "Caos abaixo de R$350" (até R$ 350,00)');
  assert.equal(alertReason(cases.deal()[0]), 'Motivo: regra atendida · "Qualquer produto 25% abaixo da Copag" (até R$ 10,00 por booster, 25% ou mais abaixo da Copag)');
  assert.equal(alertReason(cases.restock()[0]), 'Motivo: voltou ao estoque (regra "Caos voltou")');
  assert.equal(alertReason(cases.drop()[0]), 'Motivo: novo menor preço do produto (queda de 25,0% sobre R$ 400,00)');
  // regra sem label usa o id; regra pela nota oficial mostra o mínimo exigido
  const h = { kind: 'deal', rule: { id: 'nota-80', minOpportunityScore: 80 }, offer: offer() };
  assert.equal(alertReason(h), 'Motivo: regra atendida · "nota-80" (nota oficial 80 ou mais)');
});

await t('frete desconhecido: a base de comparação diz que só o preço foi comparado, sem total inventado', async () => {
  const o = offer({ shipping: null, shippingKnown: false });
  assert.equal(comparisonBasis(o), 'Comparação: só o preço (frete a calcular), só contra preços sem frete conhecido');
  const drop = evaluate([{ id: 'w', filter: { productId: 'p1' } }], [o], [{ offerId: 'o1', event: 'drop', from: 400, fromShippingKnown: false }], prod).filter((h) => h.kind === 'drop');
  assert.equal(drop.length, 1);
  const m = compose(drop[0]).text;
  assert.match(m, /R\$\s400,00 → R\$\s300,00 \+ frete/); assert.match(m, /Frete: a calcular/);
  assert.match(m, /^Comparação: só o preço \(frete a calcular\)/m);
  assert.doesNotMatch(m, /total com frete/);
});

await t('reenvio de pendente leva a mesma explicação da rodada original', async () => {
  const sent = {}; const down = { telegram: async () => false };
  await dispatch(cases.drop(), sent, { send: down, now: NOW });
  assert.ok(sent['drop|o1'].pending);
  const { calls, send } = sendOk();
  const d = await dispatch([], sent, { send, now: new Date(NOW.getTime() + 600e3) });
  assert.equal(d.length, 1); assert.equal(d[0].retried, true);
  assert.match(calls[0].text, /^Motivo: novo menor preço/m); assert.match(calls[0].text, /^Comparação: /m);
});

console.log(`✓ Explicação dos alertas (Fase 4): ${n} grupos passaram (somente mocks)`);
