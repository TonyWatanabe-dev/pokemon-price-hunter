// Social Media MVP — detector de volta ao estoque (issue #653). Reposição pela regra do robô (isRestock), produto sem
// nenhuma oferta em estoque antes, estoque desconhecido/pré-venda não contam, histórico inválido ou futuro falha fechado,
// e a oferta do post precisa estar atual e confirmada agora (nunca estoque inferido de dado stale). Sem rede e sem banco.
import assert from 'node:assert/strict';
import { voltasAoEstoque, detectarReposicoes, MOTIVOS, PADROES, SOCIAL_ENABLED_DEFAULT } from '../src/agents/social/reposicao.js';

let n = 0;
const test = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const T0 = Date.parse('2026-10-13T12:00:00Z');
const h = (horas) => new Date(T0 - horas * 3600e3).toISOString();
const min = (m) => new Date(T0 - m * 6e4).toISOString();

const linha = (t, offerId, stock, o = {}) => ({ t, offerId, productId: 'me02-etb', storeId: 'loja-a', total: 320, stock, ...o });
const oferta = (o = {}) => ({ id: 'o1', productId: 'me02-etb', storeId: 'loja-a', stock: 'IN_STOCK', stale: false, anomalous: false,
  confirmed: true, price: 300, shippingKnown: true, total: 320, url: 'https://loja-a.com.br/etb', source_timestamp: min(5), ...o });
const detectar = (linhas, ofertas = [oferta()], extra = {}) => detectarReposicoes({ linhas, ofertas, now: T0, ...extra });
// Esgotou há 30 h e voltou há 2 h.
const basico = [linha(h(40), 'o1', 'IN_STOCK'), linha(h(30), 'o1', 'OUT_OF_STOCK'), linha(h(2), 'o1', 'IN_STOCK')];

test('desativado por padrão e padrões explícitos', () => {
  assert.equal(SOCIAL_ENABLED_DEFAULT, false);
  assert.deepEqual({ ...PADROES }, { janelaHoras: 24, minHorasSemEstoque: 0 });
});

test('esgotado → em estoque com oferta atual vira reposição', () => {
  const r = detectar(basico);
  assert.equal(r.reposicoes.length, 1);
  assert.deepEqual(r.recusadas, []);
  const x = r.reposicoes[0];
  assert.equal(x.productId, 'me02-etb');
  assert.equal(x.voltouEm, h(2));
  assert.equal(x.semEstoqueDesde, h(30));
  assert.equal(x.horasSemEstoque, 28);
  assert.equal(x.offerIdReposta, 'o1');
  assert.equal(x.oferta.id, 'o1');
});

test('indisponível/removido → em estoque também é reposição (mesma regra do robô)', () => {
  const r = detectar([linha(h(30), 'o1', 'UNAVAILABLE', { event: 'removed' }), linha(h(1), 'o1', 'IN_STOCK')]);
  assert.equal(r.reposicoes.length, 1);
});

test('pré-venda → estoque é lançamento, desconhecido → estoque não prova nada, oferta nova não é volta', () => {
  assert.equal(detectar([linha(h(30), 'o1', 'PRE_ORDER'), linha(h(1), 'o1', 'IN_STOCK')]).reposicoes.length, 0);
  assert.equal(detectar([linha(h(30), 'o1', 'UNKNOWN'), linha(h(1), 'o1', 'IN_STOCK')]).reposicoes.length, 0);
  assert.equal(detectar([linha(h(30), 'o1', 'esgotado'), linha(h(1), 'o1', 'IN_STOCK')]).reposicoes.length, 0);   // fora do contrato = desconhecido
  assert.equal(detectar([linha(h(1), 'o1', 'IN_STOCK')]).reposicoes.length, 0);
  assert.equal(detectar([linha(h(30), 'o2', 'OUT_OF_STOCK'), linha(h(1), 'o1', 'IN_STOCK')]).reposicoes.length, 0);
});

test('produto que tinha outra oferta em estoque não "voltou"', () => {
  const linhas = [linha(h(40), 'o2', 'IN_STOCK', { storeId: 'loja-b' }), ...basico];
  assert.equal(detectar(linhas).reposicoes.length, 0);
  // Outra oferta com estoque desconhecido: sem prova de que o produto estava sem estoque.
  assert.equal(detectar([linha(h(40), 'o2', 'UNKNOWN', { storeId: 'loja-b' }), ...basico]).reposicoes.length, 0);
  // Outra oferta esgotada ou em pré-venda: o produto estava sem estoque de fato.
  assert.equal(detectar([linha(h(40), 'o2', 'OUT_OF_STOCK', { storeId: 'loja-b' }), ...basico]).reposicoes.length, 1);
  assert.equal(detectar([linha(h(40), 'o2', 'PRE_ORDER', { storeId: 'loja-b' }), ...basico]).reposicoes.length, 1);
});

test('período sem estoque do produto conta desde que a última oferta em estoque saiu', () => {
  const linhas = [linha(h(50), 'o1', 'OUT_OF_STOCK'), linha(h(48), 'o2', 'IN_STOCK', { storeId: 'loja-b' }),
    linha(h(10), 'o2', 'OUT_OF_STOCK', { storeId: 'loja-b' }), linha(h(1), 'o1', 'IN_STOCK')];
  const [x] = detectar(linhas).reposicoes;
  assert.equal(x.semEstoqueDesde, h(10));
  assert.equal(x.horasSemEstoque, 9);
});

test('volta fora da janela não entra; janela configurável', () => {
  const linhas = [linha(h(60), 'o1', 'OUT_OF_STOCK'), linha(h(30), 'o1', 'IN_STOCK')];
  assert.deepEqual(detectar(linhas), { reposicoes: [], recusadas: [] });
  assert.equal(detectar(linhas, [oferta()], { janelaHoras: 48 }).reposicoes.length, 1);
});

test('mínimo de horas sem estoque', () => {
  const r = detectar(basico, [oferta()], { minHorasSemEstoque: 48 });
  assert.deepEqual(r, { reposicoes: [], recusadas: [{ productId: 'me02-etb', motivo: MOTIVOS.PERIODO_CURTO }] });
  assert.equal(detectar(basico, [oferta()], { minHorasSemEstoque: 28 }).reposicoes.length, 1);
});

test('voltou e esgotou de novo: recusada', () => {
  const r = detectar([...basico, linha(h(1), 'o1', 'OUT_OF_STOCK')]);
  assert.deepEqual(r, { reposicoes: [], recusadas: [{ productId: 'me02-etb', motivo: MOTIVOS.SAIU_DE_NOVO }] });
});

test('nunca infere estoque de dado stale: a oferta precisa estar atual e confirmada agora', () => {
  const sem = { reposicoes: [], recusadas: [{ productId: 'me02-etb', motivo: MOTIVOS.SEM_OFERTA_ATUAL }] };
  assert.deepEqual(detectar(basico, []), sem);
  assert.deepEqual(detectar(basico, [oferta({ stale: true })]), sem);
  assert.deepEqual(detectar(basico, [oferta({ stock: 'UNKNOWN' })]), sem);
  assert.deepEqual(detectar(basico, [oferta({ stock: 'OUT_OF_STOCK' })]), sem);
  assert.deepEqual(detectar(basico, [oferta({ confirmed: false })]), sem);
  assert.deepEqual(detectar(basico, [oferta({ anomalous: true })]), sem);
  assert.deepEqual(detectar(basico, [oferta({ source_timestamp: h(48) })]), sem);
  assert.deepEqual(detectar(basico, [oferta({ productId: 'outro' })]), sem);
});

test('escolhe a oferta atual de menor total do produto, inclusive no formato da API', () => {
  const api = { id: 'a1', product: { id: 'me02-etb' }, store: { id: 'loja-b' }, stock: 'in_stock', status: 'active', confirmed: true,
    anomalous: false, price: 280, total_price: 290, shipping: { status: 'known', price: 10 }, url: 'https://loja-b.com.br/etb', last_seen_at: min(10) };
  const [x] = detectar(basico, [oferta(), api, oferta({ id: 'o3', stale: true, total: 100, price: 90 })]).reposicoes;
  assert.equal(x.oferta.id, 'a1');
  assert.equal(x.offerIdReposta, 'o1');
});

test('histórico com horário inválido ou futuro invalida o produto (falha fechado)', () => {
  assert.deepEqual(detectar([...basico, linha('ontem', 'o2', 'IN_STOCK')]),
    { reposicoes: [], recusadas: [{ productId: 'me02-etb', motivo: MOTIVOS.DADO_INVALIDO }] });
  assert.deepEqual(detectar([...basico, linha(h(-1), 'o2', 'IN_STOCK')]),
    { reposicoes: [], recusadas: [{ productId: 'me02-etb', motivo: MOTIVOS.FUTURO }] });
  // Linha não atribuível a produto/oferta é ignorada; lixo não derruba.
  assert.equal(detectar([...basico, null, 'x', [], { t: h(1), stock: 'IN_STOCK' }]).reposicoes.length, 1);
  assert.deepEqual(detectarReposicoes({ linhas: 'x', ofertas: null, now: T0 }), { reposicoes: [], recusadas: [] });
});

test('ordem estável entre linhas do mesmo instante e entre produtos', () => {
  // Mesmo horário: vale a ordem do arquivo (a última leitura ganha).
  assert.equal(detectar([linha(h(30), 'o1', 'OUT_OF_STOCK'), linha(h(2), 'o1', 'IN_STOCK'), linha(h(2), 'o1', 'OUT_OF_STOCK')]).reposicoes.length, 0);
  const lin = (p, o, t, s) => linha(t, o, s, { productId: p });
  const linhas = [lin('b', 'ob', h(30), 'OUT_OF_STOCK'), lin('b', 'ob', h(3), 'IN_STOCK'),
    lin('a', 'oa', h(30), 'OUT_OF_STOCK'), lin('a', 'oa', h(1), 'IN_STOCK'),
    lin('c', 'oc', h(30), 'OUT_OF_STOCK'), lin('c', 'oc', h(1), 'IN_STOCK')];
  const ofs = ['a', 'b', 'c'].map((p) => oferta({ id: 'o' + p, productId: p, url: `https://loja-a.com.br/${p}` }));
  const r = detectarReposicoes({ linhas: [...linhas].reverse(), ofertas: ofs, now: T0 });
  assert.deepEqual(r.reposicoes.map((x) => x.productId), ['a', 'c', 'b']);
  assert.deepEqual(detectarReposicoes({ linhas, ofertas: ofs, now: T0, limite: 1 }).reposicoes.map((x) => x.productId), ['a']);
});

test('oferta reclassificada sai do produto antigo', () => {
  const linhas = [linha(h(40), 'o2', 'IN_STOCK', { productId: 'antigo' }), linha(h(35), 'o2', 'IN_STOCK'),
    linha(h(30), 'o1', 'OUT_OF_STOCK', { productId: 'antigo' }), linha(h(1), 'o1', 'IN_STOCK', { productId: 'antigo' })];
  const { produtos } = voltasAoEstoque(linhas, { now: T0 });
  assert.equal(produtos.get('antigo').voltas.length, 1);
  assert.equal(produtos.get('me02-etb').emEstoque, true);
});

test('entrada inválida lança erro explícito; não muta a entrada', () => {
  assert.throws(() => detectarReposicoes({ linhas: basico, ofertas: [], now: NaN }), /relógio inválido/);
  assert.throws(() => voltasAoEstoque(basico, { now: 'x' }), /relógio inválido/);
  assert.throws(() => detectar(basico, [], { limite: -1 }), /limite/);
  assert.throws(() => detectar(basico, [], { janelaHoras: -1 }), /janelaHoras/);
  assert.throws(() => detectar(basico, [], { minHorasSemEstoque: NaN }), /minHorasSemEstoque/);
  const copia = JSON.stringify(basico); const ofs = [oferta()]; const c2 = JSON.stringify(ofs);
  detectar(basico, ofs);
  assert.equal(JSON.stringify(basico), copia);
  assert.equal(JSON.stringify(ofs), c2);
});

console.log(`social-reposicao: ${n} testes ok`);
