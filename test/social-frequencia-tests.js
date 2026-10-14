// Social MVP — frequência por produto (issue #661). Mesmo produto no máximo 1 vez por canal na janela (72 h), qualquer
// loja ou preço, salvo queda nova acima do limiar (o mesmo de quedas.js). Histórico inválido ou futuro falha fechado.
// Puro: sem rede, banco, secrets nem process.env; entradas não são mutadas e a ordem do chamador é preservada.
import assert from 'node:assert/strict';
import { podePostar, filtrarPorFrequencia, MOTIVOS, PADROES, SOCIAL_ENABLED_DEFAULT } from '../src/agents/social/frequencia.js';
import { PADROES as PADROES_QUEDA } from '../src/agents/social/quedas.js';

let n = 0;
const test = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const T0 = Date.parse('2026-10-14T12:00:00Z');
const h = (horas) => new Date(T0 - horas * 3600e3).toISOString();
const post = (o = {}) => ({ canal: 'telegram', productId: 'me02-etb', em: h(10), preco: 300, ...o });
const cand = (o = {}) => ({ canal: 'telegram', productId: 'me02-etb', preco: 300, ...o });
const pode = (c, hist, extra = {}) => podePostar(c, hist, { now: T0, ...extra });

test('desativado por padrão; janela de 72 h e limiar igual ao de quedas.js', () => {
  assert.equal(SOCIAL_ENABLED_DEFAULT, false);
  assert.deepEqual({ ...PADROES }, { janelaHoras: 72, minPct: PADROES_QUEDA.minPct, minReais: PADROES_QUEDA.minReais });
});

test('sem histórico do produto no canal: liberado', () => {
  assert.deepEqual(pode(cand(), []), { ok: true, motivo: '', anterior: null });
  assert.deepEqual(pode(cand(), undefined), { ok: true, motivo: '', anterior: null });
});

test('mesmo produto no mesmo canal dentro de 72 h: bloqueado (qualquer loja ou preço igual/maior)', () => {
  const r = pode(cand(), [post()]);
  assert.equal(r.ok, false);
  assert.equal(r.motivo, MOTIVOS.REPETIDO);
  assert.deepEqual(r.anterior, { em: h(10), precoReferencia: 300 });
  assert.equal(pode(cand({ preco: 320, storeId: 'outra-loja' }), [post()]).motivo, MOTIVOS.REPETIDO);
  assert.equal(pode(cand(), [post({ em: h(71.99) })]).ok, false);
});

test('fronteira da janela: exatamente 72 h depois já libera; janela configurável', () => {
  assert.equal(pode(cand(), [post({ em: h(72) })]).ok, true);
  assert.equal(pode(cand(), [post({ em: h(100) })]).ok, true);
  assert.equal(pode(cand(), [post({ em: h(30) })], { janelaHoras: 24 }).ok, true);
  assert.equal(pode(cand(), [post({ em: h(30) })], { janelaHoras: 48 }).ok, false);
});

test('outro canal ou outro produto não conta', () => {
  assert.equal(pode(cand(), [post({ canal: 'instagram' })]).ok, true);
  assert.equal(pode(cand(), [post({ productId: 'sv09-booster' })]).ok, true);
});

test('queda nova acima do limiar (pct E R$) libera a repetição', () => {
  const r = pode(cand({ preco: 270 }), [post()]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.queda, { de: 300, para: 270, valor: 30, pct: 0.1 });
  assert.deepEqual(r.anterior, { em: h(10), precoReferencia: 300 });
  // Exatamente no limiar (5% e R$ 15) também libera.
  assert.equal(pode(cand({ preco: 285 }), [post()]).ok, true);
});

test('queda abaixo do limiar continua bloqueada', () => {
  const pct = pode(cand({ preco: 290 }), [post()]);   // R$ 10 mas só 3,33%
  assert.equal(pct.ok, false);
  assert.equal(pct.motivo, MOTIVOS.QUEDA_PEQUENA);
  assert.deepEqual(pct.queda, { de: 300, para: 290, valor: 10, pct: 0.0333 });
  const reais = pode(cand({ preco: 57 }), [post({ preco: 60 })]);   // 5% mas só R$ 3
  assert.equal(reais.ok, false);
  assert.equal(reais.motivo, MOTIVOS.QUEDA_PEQUENA);
  assert.equal(pode(cand({ preco: 290 }), [post()], { minPct: 0.03 }).ok, true);
  assert.equal(pode(cand({ preco: 57 }), [post({ preco: 60 })], { minReais: 3 }).ok, true);
});

test('queda "nova" é contra o MENOR preço já postado na janela, não só o último', () => {
  const hist = [post({ em: h(40), preco: 250 }), post({ em: h(5), preco: 300 })];
  const r = pode(cand({ preco: 270 }), hist);
  assert.equal(r.ok, false);
  assert.equal(r.motivo, MOTIVOS.REPETIDO);
  assert.deepEqual(r.anterior, { em: h(5), precoReferencia: 250 });
  assert.equal(pode(cand({ preco: 230 }), hist).ok, true);
  // Post antigo fora da janela não é referência.
  assert.equal(pode(cand({ preco: 270 }), [post({ em: h(80), preco: 200 }), post({ em: h(5), preco: 300 })]).ok, true);
});

test('aceita product_id/product.id e price no candidato e no histórico', () => {
  assert.equal(pode({ canal: 'telegram', product_id: 'me02-etb', price: 300 }, [post()]).ok, false);
  assert.equal(pode({ canal: 'telegram', product: { id: 'me02-etb' }, price: 300 }, [{ canal: 'telegram', product_id: 'me02-etb', em: h(1), price: 300 }]).ok, false);
});

test('candidato inválido é recusado, nunca liberado', () => {
  for (const c of [null, [], 'x', cand({ canal: 'Tele Gram' }), cand({ canal: undefined }), cand({ productId: '' }), cand({ preco: 0 }), cand({ preco: -1 }), cand({ preco: NaN }), cand({ preco: '300' })]) {
    assert.deepEqual(pode(c, []), { ok: false, motivo: MOTIVOS.INVALIDO, anterior: null }, JSON.stringify(c));
  }
});

test('histórico inválido ou no futuro falha fechado (lança)', () => {
  assert.throws(() => pode(cand(), {}), /histórico não é lista/);
  assert.throws(() => pode(cand(), [null]), /não é objeto/);
  assert.throws(() => pode(cand(), [post({ canal: '' })]), /canal inválido/);
  assert.throws(() => pode(cand(), [post({ productId: '' })]), /produto ausente/);
  assert.throws(() => pode(cand(), [post({ em: 'ontem' })]), /horário inválido/);
  assert.throws(() => pode(cand(), [post({ em: h(-1) })]), /horário no futuro/);
  assert.throws(() => pode(cand(), [post({ preco: 0 })]), /preço inválido/);
});

test('relógio e configuração inválidos lançam', () => {
  assert.throws(() => podePostar(cand(), [], {}), /now inválido/);
  assert.throws(() => podePostar(cand(), [], { now: 'x' }), /now inválido/);
  assert.equal(podePostar(cand(), [], { now: new Date(T0) }).ok, true);
  assert.equal(podePostar(cand(), [], { now: new Date(T0).toISOString() }).ok, true);
  assert.throws(() => pode(cand(), [], { janelaHoras: 0 }), /janelaHoras/);
  assert.throws(() => pode(cand(), [], { minPct: 1 }), /minPct/);
  assert.throws(() => pode(cand(), [], { minReais: -1 }), /minReais/);
});

test('lote: preserva a ordem, mesmo produto não sai duas vezes, canal padrão aplicado', () => {
  const cands = [
    { productId: 'a', preco: 100 }, { productId: 'b', preco: 50 }, { productId: 'a', preco: 99 },
    { productId: 'a', preco: 80 }, { productId: 'c', preco: 10, canal: 'instagram' }, { productId: 'c', preco: 10 },
  ];
  const r = filtrarPorFrequencia(cands, [post({ productId: 'b', preco: 50 })], { now: T0, canal: 'telegram' });
  assert.deepEqual(r.liberados.map((x) => x.indice), [0, 3, 4, 5]);
  assert.equal(r.liberados[0].candidato, cands[0]);
  assert.deepEqual(r.liberados[1].queda, { de: 100, para: 80, valor: 20, pct: 0.2 });
  assert.deepEqual(r.liberados[1].anterior, { em: new Date(T0).toISOString(), precoReferencia: 100 });
  assert.equal('queda' in r.liberados[0], false);
  assert.deepEqual(r.bloqueados.map((x) => [x.indice, x.productId, x.canal, x.motivo]), [
    [1, 'b', 'telegram', MOTIVOS.REPETIDO], [2, 'a', 'telegram', MOTIVOS.QUEDA_PEQUENA],
  ]);
});

test('lote: candidato inválido vai para bloqueados; canal padrão inválido lança', () => {
  const r = filtrarPorFrequencia([null, { productId: 'x' }, cand()], [], { now: T0 });
  assert.deepEqual(r.liberados.map((x) => x.indice), [2]);
  assert.deepEqual(r.bloqueados, [
    { indice: 0, productId: null, canal: null, motivo: MOTIVOS.INVALIDO, anterior: null },
    { indice: 1, productId: 'x', canal: null, motivo: MOTIVOS.INVALIDO, anterior: null },
  ]);
  assert.deepEqual(filtrarPorFrequencia(undefined, [], { now: T0 }), { liberados: [], bloqueados: [] });
  assert.throws(() => filtrarPorFrequencia([], [], { now: T0, canal: 'X Y' }), /canal inválido/);
  assert.throws(() => filtrarPorFrequencia([cand()], [post({ em: h(-2) })], { now: T0 }), /futuro/);
});

test('determinístico e sem mutar entradas', () => {
  const hist = [post(), post({ productId: 'b', em: h(2) })];
  const cands = [cand({ preco: 250 }), cand({ productId: 'b' }), cand({ productId: 'z' })];
  const ch = JSON.stringify(hist); const cc = JSON.stringify(cands);
  const a = filtrarPorFrequencia(cands, hist, { now: T0 });
  const b = filtrarPorFrequencia(cands, hist, { now: T0 });
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(hist), ch);
  assert.equal(JSON.stringify(cands), cc);
  assert.equal(hist.length, 2);
});

console.log(`social-frequencia: ${n} testes ok`);
