// Social Media — detector de queda de preço relevante (issue #652): limiar configurável, só leitura válida e atual,
// bounce/queda implausível/frete que mudou de base descartados (offer-change), valor atual coerente com o histórico,
// anúncio novo não é queda, ordem pela maior queda sem comissão e dedupe. Módulo puro: sem rede, sem banco.
import assert from 'node:assert/strict';
import { quedaRelevante, detectarQuedas, PADROES, MOTIVOS } from '../src/agents/social/quedas.js';
import { MOTIVOS as MOTIVOS_ELEGIVEIS } from '../src/agents/social/elegiveis.js';
import { WINDOW_HOURS } from '../src/core/offer-change.js';

let n = 0;
const test = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const T0 = Date.parse('2026-10-13T12:00:00Z');
const H = (h) => new Date(T0 - h * 3600e3).toISOString();
const min = (m) => new Date(T0 - m * 6e4).toISOString();

// Oferta no formato da API v1 e no do state.json; leitura de price_history (total só com frete conhecido).
const api = (o = {}) => ({ id: 'a1', product: { id: 'me02-etb' }, store: { id: 'loja-a' }, stock: 'in_stock', status: 'active', confirmed: true,
  anomalous: false, price: 330, total_price: 350, shipping: { status: 'known', price: 20 }, url: 'https://loja-a.com.br/etb',
  last_seen_at: min(5), first_seen_at: H(24 * 10), ...o });
const st = (o = {}) => ({ id: 's1', productId: 'me02-etb', storeId: 'loja-b', stock: 'IN_STOCK', stale: false, anomalous: false,
  price: 270, shippingKnown: false, total: 270, url: 'https://loja-b.com.br/etb', source_timestamp: min(5), ...o });
const pt = (h, price, total = null, stock = 'in_stock') => ({ observed_at: H(h), price, total_price: total, stock_status: stock });
// Total caiu de 400 para 350 (12,5%) há 2 h; a leitura atual (5 min) repete o valor novo.
const HIST = [pt(30, 380, 400), pt(2, 330, 350), pt(5 / 60, 330, 350)];
const Q = (o, hist = HIST, opts = {}) => quedaRelevante(o, hist, { now: T0, ...opts });

test('padrões e reuso dos motivos de elegibilidade', () => {
  assert.deepEqual({ ...PADROES }, { minPct: 0.05, minReais: 5, janelaHoras: WINDOW_HOURS });
  assert.ok(Object.isFrozen(PADROES) && Object.isFrozen(MOTIVOS));
  for (const [k, v] of Object.entries(MOTIVOS_ELEGIVEIS)) assert.equal(MOTIVOS[k], v);
});

test('queda relevante com frete conhecido: total contra total', () => {
  assert.deepEqual(Q(api()), { ok: true, motivo: '', queda: { de: 400, para: 350, valor: 50, pct: 0.125, base: 'total', em: H(2) } });
  assert.deepEqual(Q(api()), Q(api()), 'determinístico');
  assert.equal(quedaRelevante(api(), HIST, { now: new Date(T0) }).ok, true);
});

test('frete desconhecido: preço contra preço (state.json e history.jsonl)', () => {
  const r = Q(st(), [pt(30, 300), pt(3, 270)]);
  assert.deepEqual(r.queda, { de: 300, para: 270, valor: 30, pct: 0.1, base: 'price', em: H(3) });
  // Linhas de data/history.jsonl: sem shippingKnown, o total nunca é comparado.
  const log = [{ t: H(30), price: 300, total: 320, stock: 'IN_STOCK' }, { t: H(3), price: 270, total: 290, stock: 'IN_STOCK' }];
  assert.equal(Q(st(), log).queda.base, 'price');
  assert.equal(Q(st({ shippingKnown: true, total: 290 }), log).queda.para, 270);
});

test('limiar configurável: percentual e reais', () => {
  assert.deepEqual(Q(api(), HIST, { minPct: 0.2 }), { ok: false, motivo: MOTIVOS.ABAIXO_LIMIAR, pct: 0.125, valor: 50 });
  assert.equal(Q(api(), HIST, { minPct: 0.125 }).ok, true, 'no limite ainda vale');
  assert.equal(Q(api(), HIST, { minReais: 51 }).motivo, MOTIVOS.ABAIXO_LIMIAR);
  assert.equal(Q(api(), HIST, { minReais: 50 }).ok, true);
  // Queda pequena (R$ 4, 1%) fica fora do padrão, mas entra com limiar zero.
  const pequena = [pt(30, 380, 400), pt(2, 376, 396)];
  assert.equal(Q(api({ price: 376, total_price: 396 }), pequena).motivo, MOTIVOS.ABAIXO_LIMIAR);
  assert.equal(Q(api({ price: 376, total_price: 396 }), pequena, { minPct: 0, minReais: 0 }).ok, true);
  for (const bad of [{ minPct: -0.1 }, { minPct: 1 }, { minPct: '0.1' }, { minPct: NaN }, { minReais: -1 }, { minReais: null }, { janelaHoras: 0 }, { janelaHoras: Infinity }])
    assert.throws(() => Q(api(), HIST, bad), TypeError, JSON.stringify(bad));
});

test('só leitura válida e atual: contrato de ofertaElegivel', () => {
  const casos = [
    [api({ last_seen_at: min(24 * 60) }), MOTIVOS.FRESCOR], [api({ status: 'pending' }), MOTIVOS.PENDENTE],
    [st({ stale: true }), MOTIVOS.PENDENTE], [api({ anomalous: true }), MOTIVOS.ANOMALA], [api({ confirmed: false }), MOTIVOS.NAO_CONFIRMADA],
    [api({ stock: 'unknown' }), MOTIVOS.ESTOQUE], [api({ stock: 'out_of_stock' }), MOTIVOS.ESTOQUE], [api({ price: 0 }), MOTIVOS.PRECO],
    [api({ url: 'http://loja-a.com.br/etb' }), MOTIVOS.URL], [api({ last_seen_at: null }), MOTIVOS.SEM_HORARIO], [null, MOTIVOS.INVALIDA],
  ];
  for (const [o, motivo] of casos) assert.equal(Q(o).motivo, motivo, JSON.stringify(o));
  assert.equal(quedaRelevante(api(), HIST, { now: 'ontem' }).motivo, MOTIVOS.RELOGIO);
});

test('sem queda: offer-change decide (bounce, implausível, base diferente, estoque, janela, anúncio novo)', () => {
  const semQueda = (o, hist, opts) => { const r = Q(o, hist, opts); assert.equal(r.motivo, MOTIVOS.SEM_QUEDA, JSON.stringify(hist)); return r; };
  // Preço que vai e volta: 350 já apareceu nas últimas 48 h.
  semQueda(api(), [pt(40, 330, 350), pt(30, 380, 400), pt(2, 330, 350)]);
  // Queda implausível (mais de 45% abaixo da leitura anterior).
  semQueda(api({ price: 180, total_price: 200 }), [pt(30, 480, 500), pt(2, 180, 200)]);
  // Frete passou de conhecido para desconhecido: valores não comparáveis.
  semQueda(api({ total_price: null, shipping: { status: 'unknown' } }), [pt(30, 380, 400), pt(2, 330)]);
  // Leitura sem estoque confirmado não é base de comparação.
  semQueda(api(), [pt(30, 380, 400, 'unknown'), pt(2, 330, 350)]);
  // Preço subiu ou não mudou.
  semQueda(api({ price: 380, total_price: 400 }), [pt(30, 330, 350), pt(2, 380, 400)]);
  semQueda(api(), [pt(30, 330, 350), pt(2, 330, 350)]);
  // Queda fora da janela (padrão de 48 h ou janela configurada).
  semQueda(api(), [pt(80, 380, 400), pt(60, 330, 350)]);
  assert.equal(Q(api(), [pt(80, 380, 400), pt(60, 330, 350)], { janelaHoras: 72 }).ok, true);
  semQueda(api(), HIST, { janelaHoras: 1 });
  // Anúncio visto pela primeira vez na janela é lançamento, não queda.
  assert.match(semQueda(api({ first_seen_at: H(10) })).detalhe, /primeira vez/);
  // Sem histórico.
  semQueda(api(), []); semQueda(api(), null); semQueda(api(), [null, 'x']);
});

test('valor atual da oferta precisa ser o da queda', () => {
  assert.equal(Q(api({ total_price: 345 })).motivo, MOTIVOS.DIVERGENTE, 'histórico atrasado em relação à oferta');
  assert.equal(Q(api({ total_price: null, shipping: { status: 'unknown' } })).motivo, MOTIVOS.DIVERGENTE, 'oferta sem frete, histórico com total');
  assert.equal(Q(st({ price: 265 }), [pt(30, 300), pt(3, 270)]).motivo, MOTIVOS.DIVERGENTE);
  assert.equal(Q(api({ total_price: 349.999 })).ok, true, 'centavos arredondados');
});

test('detectarQuedas: ordem pela maior queda, recusas, dedupe e limite', () => {
  const itens = [
    { oferta: api({ id: 'p10', store: { id: 'l1' }, price: 270, total_price: 270, shipping: { status: 'free' } }), historico: [pt(30, 300, 300), pt(2, 270, 270)] },
    { oferta: api({ id: 'p125' }), historico: HIST },
    { oferta: api({ id: 'velha', store: { id: 'l2' }, last_seen_at: min(24 * 60) }), historico: HIST },
    { oferta: api({ id: 'bounce', store: { id: 'l3' } }), historico: [pt(40, 330, 350), pt(30, 380, 400), pt(2, 330, 350)] },
    { oferta: api({ id: 'p10b', store: { id: 'l4' }, price: 450, total_price: 450, shipping: { status: 'free' } }), historico: [pt(30, 500, 500), pt(2, 450, 450)] },
    { oferta: api({ id: 'dup', url: 'https://loja-a.com.br/outra' }), historico: HIST },
    null,
  ];
  const { quedas, recusadas } = detectarQuedas(itens, { now: T0 });
  // Mesma porcentagem (10%): vence a maior queda em reais.
  assert.deepEqual(quedas.map((q) => q.oferta.id), ['p125', 'p10b', 'p10']);
  assert.deepEqual(quedas[0], { oferta: itens[1].oferta, produtoId: 'me02-etb', lojaId: 'loja-a', de: 400, para: 350, valor: 50, pct: 0.125, base: 'total', em: H(2) });
  assert.deepEqual(recusadas, [
    { id: 'velha', motivo: MOTIVOS.FRESCOR }, { id: 'bounce', motivo: MOTIVOS.SEM_QUEDA }, { id: null, motivo: MOTIVOS.INVALIDA },
    { id: 'dup', motivo: MOTIVOS.DUPLICADA },
  ]);
  assert.deepEqual(detectarQuedas(itens, { now: T0, limite: 1 }).quedas.map((q) => q.oferta.id), ['p125']);
  assert.deepEqual(detectarQuedas(itens, { now: T0, minPct: 0.11 }).quedas.map((q) => q.oferta.id), ['p125']);
  assert.deepEqual(detectarQuedas(null, { now: T0 }), { quedas: [], recusadas: [] });
  assert.throws(() => detectarQuedas(itens, { now: T0, limite: -1 }), TypeError);
  assert.throws(() => detectarQuedas([], { now: T0, minPct: 2 }), TypeError, 'config inválida falha mesmo sem itens');
});

test('ordem independe da entrada, de comissão e de afiliado; não altera a entrada', () => {
  const a = { oferta: api({ id: 'a', store: { id: 'l1' } }), historico: HIST };
  const b = { oferta: api({ id: 'b', store: { id: 'l2' }, price: 270, total_price: 270, shipping: { status: 'free' } }), historico: [pt(30, 300, 300), pt(2, 270, 270)] };
  const ids = (l) => detectarQuedas(l, { now: T0 }).quedas.map((q) => q.oferta.id);
  assert.deepEqual(ids([a, b]), ['a', 'b']);
  assert.deepEqual(ids([b, a]), ['a', 'b']);
  const enfeitar = (it, c) => ({ ...it, oferta: { ...it.oferta, commission: c, affiliate: c > 0, dealScore: c } });
  assert.deepEqual(ids([enfeitar(a, 0), enfeitar(b, 100)]), ['a', 'b']);
  const copia = JSON.stringify([a, b]); detectarQuedas([a, b], { now: T0 }); assert.equal(JSON.stringify([a, b]), copia);
});

console.log(`social-quedas: ${n} testes ok`);
