// Lote 3 — alertas: contabilidade de entrega (canal não configurado / entregue / falhou), prazo dos envios,
// fila de reenvio e queda de preço só como novo melhor preço do produto. Puro (fetch simulado, sem rede).
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
process.env.HUNTER_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'al3-cfg-')); process.env.HUNTER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'al3-data-'));
const A = await import('../src/alerts.js');
const { evaluate, dedupe, dispatch, dispatchTips, tipHits, transports, bestByProduct, prevBestOf, retryHits, pruneRetry, failedLine, compose } = A;
let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };

const NOW = new Date('2026-10-09T15:30:00Z');
const offer = (o = {}) => ({ id: 'o1', productId: 'p1', stock: 'IN_STOCK', matchConfidence: 0.95, anomalous: false, stale: false, confirmed: true, price: 599.99, total: 599.99,
  discount: null, perBooster: null, storeName: 'Loja', priceKindLabel: 'Pix', shipping: 0, url: 'https://loja/o1', ...o });
const prod = { p1: { id: 'p1', type: 'combo', collection: 'me04', collectionName: 'Caos Ascendente', typeLabel: 'Combo de Booster', copagConfirmed: false, msrp: null } };
const alvo = { id: 'alvo', label: 'Combo até 700', mode: 'target', filter: { productId: 'p1' }, maxPrice: 700 };
const hitAlvo = () => evaluate([alvo], [offer()], [], prod);
const ch = (r) => async () => (typeof r === 'function' ? r() : r);

// ------------------------------------------------------------------ 1. contabilidade de entrega
await t('1a. todos os canais falham: não marca enviado, não entra na lista, vai para failed; na rodada seguinte tenta de novo', async () => {
  const sent = {}; const failed = [];
  const d = await dispatch(dedupe(hitAlvo(), sent, {}, NOW.getTime()), sent, { send: { telegram: ch(false), ntfy: ch(() => { throw new Error('ECONNRESET'); }) }, now: NOW, failed });
  assert.deepEqual(d, []); assert.deepEqual(sent, {}, 'sent intacto');
  assert.deepEqual(failed.map((f) => [f.kind, f.productId, f.channels]), [['target', 'p1', ['telegram', 'ntfy']]]);
  // próxima rodada: mesma condição, dedupe deixa passar (nada marcado) e agora um canal entrega
  const again = dedupe(hitAlvo(), sent, {}, NOW.getTime() + 15 * 60e3);
  assert.equal(again.length, 1, 'retentado na rodada seguinte');
  const d2 = await dispatch(again, sent, { send: { telegram: ch(true), ntfy: ch(false) }, now: NOW });
  assert.deepEqual(d2[0].channels, ['telegram']); assert.ok(sent['alvo|p1']);
});
await t('1b. um canal falha e o outro entrega = enviado (só o que entregou aparece em channels)', async () => {
  const sent = {}; const failed = [];
  const d = await dispatch(hitAlvo(), sent, { send: { telegram: ch(false), ntfy: ch(true) }, now: NOW, failed });
  assert.equal(d.length, 1); assert.deepEqual(d[0].channels, ['ntfy']); assert.equal(sent['alvo|p1'].total, 599.99); assert.equal(failed.length, 0);
});
await t('1c. nenhum canal configurado: marca como hoje (só painel, channels [])', async () => {
  const sent = {}; const failed = [];
  const d = await dispatch(hitAlvo(), sent, { send: { telegram: ch(null), ntfy: ch(undefined) }, now: NOW, failed });
  assert.equal(d.length, 1); assert.deepEqual(d[0].channels, []); assert.ok(sent['alvo|p1']); assert.equal(failed.length, 0);
  // transportes reais sem variáveis: null (não configurado), sem chamar a rede
  let called = 0; const f = async () => { called++; return new Response('{}'); };
  assert.equal(await transports.telegram({ text: 'x', url: 'u' }, { env: {}, fetchImpl: f }), null);
  assert.equal(await transports.telegram({ text: 'x', url: 'u' }, { env: { TELEGRAM_BOT_TOKEN: '1:a' }, fetchImpl: f }), null, 'sem chat = não configurado');
  assert.equal(await transports.ntfy({ text: 'x', url: 'u' }, { env: {}, fetchImpl: f }), null); assert.equal(called, 0);
  const d2 = await dispatch(hitAlvo(), {}, { send: transports, now: NOW, failed, timeoutMs: 50 });
  if (!process.env.TELEGRAM_BOT_TOKEN && !process.env.NTFY_TOPIC) { assert.deepEqual(d2[0].channels, []); assert.equal(failed.length, 0); }
});
await t('1d. pistas: mesma regra (falhou tudo → não marca e fica na fila; volta na rodada seguinte mesmo sem ser nova)', async () => {
  const tip = { id: 'k1', isNew: true, productId: 'p1', msrp: 300, price: 200, discount: 0.33, collectionName: 'Caos Ascendente', label: 'Combo', source: 'Pelando', url: 'https://pelando/k1' };
  const sent = {}; const retry = {}; const failed = [];
  assert.deepEqual(await dispatchTips(tipHits([tip], sent), sent, { send: { telegram: ch(false) }, now: NOW, failed, retry }), []);
  assert.equal(sent['tip|k1'], undefined); assert.equal(retry['tip|k1'].kind, 'tip'); assert.equal(failed[0].kind, 'tip');
  const old = { ...tip, isNew: false };
  assert.equal(tipHits([old], sent).length, 0, 'sem fila: pista velha não volta');
  assert.equal(tipHits([old], sent, { retry }).length, 1, 'com fila: volta');
  const d = await dispatchTips(tipHits([old], sent, { retry }), sent, { send: { telegram: ch(true) }, now: NOW, retry });
  assert.equal(d.length, 1); assert.ok(sent['tip|k1']); assert.equal(retry['tip|k1'], undefined, 'entregue sai da fila');
});
await t('1e. log da falha: sem token, chat ou URL', () => {
  const line = failedLine([{ kind: 'drop', productId: 'p1', total: 549.9, channels: ['telegram', 'ntfy'] }]);
  assert.equal(line, '[alertas] envio falhou em todos os canais: drop p1 549.9 (telegram/ntfy) · tenta de novo na próxima rodada');
});

// ------------------------------------------------------------------ 2. prazo
await t('2a. envio travado cai no prazo (AbortSignal.timeout) e conta como falha', async () => {
  // servidor que nunca responde (o timer mantém o processo vivo, como uma conexão aberta faria)
  const hang = (url, opt) => new Promise((_, rej) => { const keep = setTimeout(() => rej(new Error('prazo não aplicado')), 5000); opt.signal.addEventListener('abort', () => { clearTimeout(keep); rej(opt.signal.reason); }); });
  const env = { TELEGRAM_BOT_TOKEN: '123:SEGREDO', TELEGRAM_CHAT_ID: '42', NTFY_TOPIC: 'topico-secreto' };
  let t0 = Date.now();
  await assert.rejects(transports.telegram({ text: 'x', url: 'u' }, { env, fetchImpl: hang, timeoutMs: 80 }), (e) => e.name === 'TimeoutError');
  assert.ok(Date.now() - t0 < 1500);
  const send = { telegram: (m, c) => transports.telegram(m, { ...c, env, fetchImpl: hang }), ntfy: (m, c) => transports.ntfy(m, { ...c, env, fetchImpl: hang }) };
  const sent = {}; const failed = []; t0 = Date.now();
  const d = await dispatch(hitAlvo(), sent, { send, now: NOW, failed, timeoutMs: 80 });
  assert.ok(Date.now() - t0 < 1500, 'respeita o prazo passado'); assert.deepEqual(d, []); assert.deepEqual(sent, {});
  assert.ok(!JSON.stringify(failed).includes('SEGREDO') && !JSON.stringify(failed).includes('topico-secreto'));
  // sinal presente com o prazo padrão de 10 s
  let sig = null; await transports.ntfy({ text: 'a\nb\nc', url: 'u' }, { env, fetchImpl: async (u, o) => { sig = o.signal; return new Response('ok'); } });
  assert.ok(sig instanceof AbortSignal); assert.equal(A.ALERT_TIMEOUT_MS, 10000);
});
await t('2b. canal que falhou 2× na rodada fica fora do resto dela (sem esperar o prazo de novo)', async () => {
  let calls = 0; const send = { telegram: async () => { calls++; return false; }, ntfy: async () => true };
  const offers = ['a', 'b', 'c', 'd'].map((id, i) => offer({ id, productId: 'p' + i, total: 100 }));
  const P = Object.fromEntries(offers.map((o) => [o.productId, { ...prod.p1, id: o.productId }]));
  const hits = evaluate([{ id: 'r', filter: {}, maxPrice: 200 }], offers, [], P);
  const down = {}; const d = await dispatch(hits, {}, { send, now: NOW, down });
  assert.equal(d.length, 4, 'ntfy entrega todos'); assert.equal(calls, 2, 'telegram chamado só 2×');
});
await t('2c. auditoria: toda chamada externa do robô fora de src/http.js tem prazo', () => {
  const rd = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
  for (const f of ['src/alerts.js', 'src/inbox.js', 'src/mlauth.js']) {
    const src = rd(f); const calls = src.split(/\bfetch\)?\(/).length - 1;
    assert.ok(calls >= 1, f); assert.equal((src.match(/AbortSignal\.timeout\(/g) || []).length, calls, `${f}: ${calls} chamadas, todas com AbortSignal.timeout`);
  }
  assert.match(rd('src/http.js'), /setTimeout\(\(\) => ctrl\.abort\(\), timeout\)/, 'http.js mantém o prazo próprio');
});

// ------------------------------------------------------------------ 3. queda = novo melhor preço do produto
const W = [{ id: 'vigia', filter: { productId: 'p1' }, maxPrice: 1 }];   // vigia o produto (não dispara por preço)
const drop = (id, from) => ({ offerId: id, event: 'drop', from });
await t('3a. caso de produção: queda para R$ 599,99 com outra oferta a R$ 549,90 → nenhum alerta', () => {
  const O = [offer({ id: 'x', total: 599.99 }), offer({ id: 'y', total: 549.9 })];
  assert.equal(evaluate(W, O, [drop('x', 649.99)], prod, { prevBest: new Map([['p1', 549.9]]) }).length, 0);
  assert.equal(evaluate(W, O, [drop('x', 649.99)], prod).length, 0, 'mesmo sem melhor anterior: não é o menor agora');
});
await t('3b. novo melhor preço abaixo do melhor anterior → alerta com chave por produto e "de" = melhor anterior', () => {
  const O = [offer({ id: 'x', total: 529.9 }), offer({ id: 'y', total: 549.9 })];
  const h = evaluate(W, O, [drop('x', 599.99)], prod, { prevBest: new Map([['p1', 549.9]]) });
  assert.equal(h.length, 1); assert.equal(h[0].key, 'drop|p1'); assert.equal(h[0].kind, 'drop'); assert.equal(h[0].from, 549.9); assert.equal(h[0].offer.id, 'x');
  assert.match(compose(h[0]).text, /R\$\s549,90 → R\$\s529,90/);
});
await t('3c. igual ao melhor anterior → nenhum alerta; oferta não elegível ou não confirmada não conta', () => {
  const O = [offer({ id: 'x', total: 549.9 }), offer({ id: 'y', total: 560 })];
  assert.equal(evaluate(W, O, [drop('x', 599.99)], prod, { prevBest: new Map([['p1', 549.9]]) }).length, 0);
  // a mais barata está fora do estoque / anômala / pouco confiável: não conta como "melhor"; a da queda passa a ser o menor
  for (const bad of [{ stock: 'OUT_OF_STOCK' }, { anomalous: true }, { matchConfidence: 0.5 }, { stale: true }, { confirmed: false }]) {
    const h = evaluate(W, [offer({ id: 'x', total: 530 }), offer({ id: 'z', total: 400, ...bad })], [drop('x', 599.99)], prod, { prevBest: new Map([['p1', 549.9]]) });
    assert.equal(h.length, 1, JSON.stringify(bad)); assert.equal(h[0].offer.id, 'x');
  }
  // a própria oferta com queda inelegível: nada
  assert.equal(evaluate(W, [offer({ id: 'x', total: 500, anomalous: true })], [drop('x', 599.99)], prod).length, 0);
});
await t('3d. primeira vez do produto (sem melhor anterior): vale se for o menor agora e abaixo do "de" da queda', () => {
  const h = evaluate(W, [offer({ id: 'x', total: 500 }), offer({ id: 'y', total: 520 })], [drop('x', 560)], prod);
  assert.deepEqual(h.map((x) => [x.key, x.from]), [['drop|p1', 560]]);
  assert.equal(evaluate(W, [offer({ id: 'x', total: 500 })], [drop('x', 500)], prod).length, 0, 'não abaixo do "de"');
});
await t('3e. melhor anterior pela mesma regra de elegibilidade (rodada anterior)', () => {
  const prev = [offer({ id: 'a', total: 300 }), offer({ id: 'b', total: 100, anomalous: true }), offer({ id: 'c', total: 150, confirmed: false }), offer({ id: 'd', total: 120, stock: 'UNKNOWN', stale: true }),
    offer({ id: 'e', productId: 'p2', total: 50 })];
  assert.deepEqual([...bestByProduct(prev)], [['p1', 300], ['p2', 50]]);
});
await t('3f. chave por produto: dedupe pede nova queda de ≥ 1% (ou fim da espera) para avisar de novo', () => {
  const O = [offer({ id: 'x', total: 529.9 })];
  const h = evaluate(W, O, [drop('x', 549.9)], prod, { prevBest: new Map([['p1', 549.9]]) });
  const sent = { 'drop|p1': { at: new Date(NOW - 60e3).toISOString(), total: 530, discount: null, offerId: 'w' } };
  assert.equal(dedupe(h, sent, {}, NOW.getTime(), { w: { stock: 'IN_STOCK' } }).length, 0, 'R$ 0,10 abaixo não é ≥ 1%');
  const h2 = evaluate(W, [offer({ id: 'x', total: 520 })], [drop('x', 529.9)], prod, { prevBest: new Map([['p1', 529.9]]) });
  assert.equal(dedupe(h2, sent, {}, NOW.getTime(), {}).length, 1);
});
await t('3g. produto vigiado só por regra antiga (minDealScore) continua recebendo a queda', () => {
  const h = evaluate([{ id: 'velha', filter: { productId: 'p1' }, minDealScore: 70 }], [offer({ id: 'x', total: 500 })], [drop('x', 560)], prod, { prevBest: new Map([['p1', 540]]) });
  assert.deepEqual(h.map((x) => [x.kind, x.key]), [['drop', 'drop|p1']]);
  assert.equal(evaluate([], [offer({ id: 'x', total: 500 })], [drop('x', 560)], prod).length, 0, 'produto não vigiado: nada');
});
await t('3h. queda que não chegou a nenhum canal: fica na fila e volta enquanto o preço valer (até 3 h)', async () => {
  const O = [offer({ id: 'x', total: 529.9 })];
  const h = evaluate(W, O, [drop('x', 549.9)], prod, { prevBest: new Map([['p1', 549.9]]) });
  const sent = {}; const retry = {};
  await dispatch(h, sent, { send: { telegram: ch(false) }, now: NOW, retry });
  assert.deepEqual(Object.keys(retry), ['drop|p1']); assert.equal(retry['drop|p1'].from, 549.9);
  // rodada seguinte: sem evento de queda (preço igual), mas a fila refaz o alerta
  assert.equal(evaluate(W, O, [], prod, { prevBest: new Map([['p1', 529.9]]) }).length, 0);
  const again = retryHits(retry, O, prod, W);
  assert.deepEqual(again.map((x) => [x.key, x.offer.id, x.from]), [['drop|p1', 'x', 549.9]]);
  assert.equal(retryHits(retry, [offer({ id: 'x', total: 560 })], prod, W).length, 0, 'preço subiu: não refaz');
  const d = await dispatch(dedupe(again, sent, {}, NOW.getTime()), sent, { send: { telegram: ch(true) }, now: NOW, retry });
  assert.equal(d.length, 1); assert.deepEqual(retry, {}); assert.ok(sent['drop|p1']);
  // validade da fila
  const r2 = { k: { at: new Date(NOW - 3.5 * 3600e3).toISOString(), kind: 'drop' }, j: { at: new Date(NOW - 3600e3).toISOString(), kind: 'drop' }, z: { at: 'lixo' } };
  assert.deepEqual(Object.keys(pruneRetry(r2, NOW.getTime())), ['j']);
  // reposição também volta pela fila
  const rs = { 'rep|p1': { at: NOW.toISOString(), kind: 'restock', ruleId: 'rep', ruleLabel: 'Voltou', offerId: 'x', productId: 'p1', total: 529.9 } };
  assert.deepEqual(retryHits(rs, O, prod, [{ id: 'rep', label: 'Voltou', restock: true, filter: {} }]).map((x) => [x.kind, x.rule.label]), [['restock', 'Voltou']]);
  assert.equal(retryHits(rs, [offer({ id: 'x', stock: 'OUT_OF_STOCK' })], prod).length, 0);
});

await t('3x. oferta que falhou na rodada anterior (stale) conta pela última leitura válida: voltar ao mesmo preço não é queda', () => {
  const prev = [offer({ id: 'x', total: 600, stale: true, stock: 'UNKNOWN', lastValid: { stock: 'IN_STOCK', total: 500, price: 500 } }), offer({ id: 'y', total: 650 })];
  const pb = prevBestOf(prev);
  assert.equal(pb.get('p1'), 500, 'usa o lastValid da oferta que falhou');
  assert.equal(bestByProduct(prev).get('p1'), 650, 'sem o ajuste a base seria a outra oferta (650)');
  assert.equal(prevBestOf([offer({ id: 'x', stale: true, stock: 'UNKNOWN' })]).get('p1'), undefined, 'stale sem lastValid: sem base');
  const O = [offer({ id: 'x', total: 500 }), offer({ id: 'y', total: 650 })];
  assert.equal(evaluate(W, O, [drop('x', 600)], prod, { prevBest: pb }).length, 0, 'mesmo preço da última leitura válida: sem queda');
  assert.equal(evaluate(W, O, [drop('x', 600)], prod, { prevBest: bestByProduct(prev) }).length, 1, 'controle: com a base antiga sairia alerta falso');
  assert.equal(evaluate(W, [offer({ id: 'x', total: 480 }), offer({ id: 'y', total: 650 })], [drop('x', 600)], prod, { prevBest: pb }).length, 1, 'abaixo da última leitura válida: queda real');
});

console.log(`✓ Alertas (Lote 3: entrega, prazo e queda): ${n} grupos passaram`);
