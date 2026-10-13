// Social Media MVP — contrato e seleção de ofertas elegíveis (issue #633). Cada motivo de recusa, oferta sem horário
// ou com horário no futuro, dedupe, ordem estável (menor total, sem comissão) e aviso de afiliado. Sem rede e sem banco.
import assert from 'node:assert/strict';
import {
  ofertaElegivel, chaveDedupe, selecionarElegiveis, exigeDisclosure, socialHabilitado,
  DISCLOSURE_AFILIADO, MOTIVOS, SOCIAL_ENABLED_DEFAULT,
} from '../src/agents/social/elegiveis.js';
import { parseAffiliates } from '../api/_lib/affiliates.mjs';
import { LIMITS } from '../api/_lib/freshness.mjs';

let n = 0;
const test = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const T0 = Date.parse('2026-10-13T12:00:00Z');
const min = (m) => new Date(T0 - m * 6e4).toISOString();

// Formato do state.json e formato da API v1 (read-db/read-state).
const st = (o = {}) => ({ id: 'o1', productId: 'me02-etb', storeId: 'loja-a', stock: 'IN_STOCK', stale: false, anomalous: false,
  price: 300, shippingKnown: true, total: 320, url: 'https://loja-a.com.br/etb', source_timestamp: min(5), ...o });
const api = (o = {}) => ({ id: 'a1', product: { id: 'me02-etb' }, store: { id: 'loja-b' }, stock: 'in_stock', status: 'active', confirmed: true,
  anomalous: false, price: 310, total_price: 330, shipping: { status: 'known', price: 20 }, url: 'https://loja-b.com.br/etb', last_seen_at: min(10), ...o });
const ok = (o) => ofertaElegivel(o, { now: T0 });

test('desativado por padrão', () => {
  assert.equal(SOCIAL_ENABLED_DEFAULT, false);
  assert.equal(socialHabilitado({}), false);
  assert.equal(socialHabilitado({ SOCIAL_ENABLED: 'true' }), false);
  assert.equal(socialHabilitado({ SOCIAL_ENABLED: '0' }), false);
  assert.equal(socialHabilitado({ SOCIAL_ENABLED: '1' }), true);
});

test('oferta válida nos dois formatos', () => {
  assert.deepEqual(ok(st()), { ok: true, motivo: '' });
  assert.deepEqual(ok(api()), { ok: true, motivo: '' });
  assert.deepEqual(ofertaElegivel(st(), { now: new Date(T0) }), { ok: true, motivo: '' });
});

test('cada motivo de recusa', () => {
  const casos = [
    [null, MOTIVOS.INVALIDA], [[st()], MOTIVOS.INVALIDA], ['x', MOTIVOS.INVALIDA],
    [st({ productId: undefined }), MOTIVOS.SEM_PRODUTO], [api({ product: null }), MOTIVOS.SEM_PRODUTO],
    [st({ storeId: '  ' }), MOTIVOS.SEM_LOJA], [api({ store: {} }), MOTIVOS.SEM_LOJA],
    [st({ stock: 'UNKNOWN' }), MOTIVOS.ESTOQUE], [st({ stock: 'OUT_OF_STOCK' }), MOTIVOS.ESTOQUE], [api({ stock: 'preorder' }), MOTIVOS.ESTOQUE],
    [st({ stock: undefined }), MOTIVOS.ESTOQUE], [api({ stock: 'unknown' }), MOTIVOS.ESTOQUE],
    [st({ stale: true }), MOTIVOS.PENDENTE], [api({ status: 'pending' }), MOTIVOS.PENDENTE], [api({ status: 'removed' }), MOTIVOS.PENDENTE],
    [st({ anomalous: true }), MOTIVOS.ANOMALA], [api({ anomalous: null }), MOTIVOS.ANOMALA],
    [st({ confirmed: false }), MOTIVOS.NAO_CONFIRMADA], [api({ confirmed: false }), MOTIVOS.NAO_CONFIRMADA],
    [st({ price: 0 }), MOTIVOS.PRECO], [st({ price: -1 }), MOTIVOS.PRECO], [st({ price: null }), MOTIVOS.PRECO],
    [st({ price: '300' }), MOTIVOS.PRECO], [st({ price: NaN }), MOTIVOS.PRECO],
    [st({ url: 'http://loja-a.com.br/etb' }), MOTIVOS.URL], [st({ url: '' }), MOTIVOS.URL], [st({ url: 'não é url' }), MOTIVOS.URL],
    [st({ url: 'https://user:pw@loja-a.com.br/' }), MOTIVOS.URL], [st({ url: ' https://loja-a.com.br/etb' }), MOTIVOS.URL],
    [st({ url: 'javascript:alert(1)' }), MOTIVOS.URL], [st({ url: undefined }), MOTIVOS.URL],
  ];
  for (const [o, motivo] of casos) {
    const r = ok(o);
    assert.equal(r.ok, false, `${JSON.stringify(o)} deveria ser recusada`);
    assert.equal(r.motivo, motivo, JSON.stringify(o));
  }
  assert.equal(ofertaElegivel(st(), { now: 'ontem' }).motivo, MOTIVOS.RELOGIO);
  assert.equal(ofertaElegivel(st(), { now: NaN }).motivo, MOTIVOS.RELOGIO);
});

test('frescor da própria oferta: sem horário, no futuro, atrasado', () => {
  for (const o of [st({ source_timestamp: undefined }), st({ source_timestamp: null }), st({ source_timestamp: '' }), api({ last_seen_at: null })])
    assert.equal(ok(o).motivo, MOTIVOS.SEM_HORARIO);
  const futuro = ok(st({ source_timestamp: new Date(T0 + 10 * 6e4).toISOString() }));
  assert.deepEqual(futuro, { ok: false, motivo: MOTIVOS.FRESCOR, frescor: 'indisponivel' });
  assert.equal(ok(st({ source_timestamp: 'lixo' })).frescor, 'indisponivel');
  assert.equal(ok(st({ source_timestamp: min(LIMITS.ATUAL_MIN) })).ok, true, 'no limite de "atual" ainda serve');
  assert.deepEqual(ok(st({ source_timestamp: min(LIMITS.ATUAL_MIN + 1) })), { ok: false, motivo: MOTIVOS.FRESCOR, frescor: 'atrasado' });
  assert.equal(ok(api({ last_seen_at: min(LIMITS.ATRASADO_MIN + 1) })).frescor, 'desatualizado');
  assert.equal(ok(api({ last_seen_at: min(LIMITS.EXPIRA_MIN + 1) })).frescor, 'indisponivel');
});

test('chave de dedupe determinística', () => {
  assert.equal(chaveDedupe(st()), 'me02-etb|loja-a|30000');
  assert.equal(chaveDedupe(st({ id: 'outro', source_timestamp: min(1), url: 'https://loja-a.com.br/x' })), chaveDedupe(st()), 'estável entre rodadas');
  assert.equal(chaveDedupe(st({ price: 299.995 })), 'me02-etb|loja-a|30000');
  assert.equal(chaveDedupe(st({ price: 19.9 })), 'me02-etb|loja-a|1990');
  assert.equal(chaveDedupe(api()), 'me02-etb|loja-b|31000');
  assert.notEqual(chaveDedupe(st({ price: 301 })), chaveDedupe(st()));
  assert.notEqual(chaveDedupe(st({ storeId: 'loja-b' })), chaveDedupe(st()));
  assert.notEqual(chaveDedupe(st({ productId: 'me03-etb' })), chaveDedupe(st()));
  for (const o of [null, st({ productId: null }), st({ storeId: '' }), st({ price: 0 }), st({ price: undefined })]) assert.equal(chaveDedupe(o), null);
});

test('disclosure de afiliado só via affiliates.mjs', () => {
  assert.equal(typeof DISCLOSURE_AFILIADO, 'string');
  assert.ok(DISCLOSURE_AFILIADO.length > 0 && DISCLOSURE_AFILIADO.length <= 100, 'texto curto');
  assert.match(DISCLOSURE_AFILIADO, /afiliado/i);
  const cfg = parseAffiliates({ mercadolivre: { anuncios: { MLB1234567890: 'https://meli.la/abc' }, geral: { url: 'https://meli.la/geral', ativo: true, destinoConfirmado: true } } });
  const anuncio = 'https://produto.mercadolivre.com.br/MLB-1234567890-etb-_JM';
  assert.equal(exigeDisclosure(anuncio, cfg), true);
  assert.equal(exigeDisclosure('https://produto.mercadolivre.com.br/MLB-9999999999-x-_JM', cfg), false, 'anúncio sem link próprio');
  assert.equal(exigeDisclosure('https://loja-a.com.br/etb', cfg), false);
  assert.equal(exigeDisclosure('https://meli.la/abc', cfg), true, 'URL já é o link configurado');
  assert.equal(exigeDisclosure('https://meli.la/geral', cfg), true);
  assert.equal(exigeDisclosure(anuncio, parseAffiliates(null)), false, 'sem configuração, sem afiliado');
  assert.equal(exigeDisclosure('', cfg), false);
  assert.equal(exigeDisclosure(null, cfg), false);
});

test('seleção: filtra, ordena pelo menor total comparável e remove duplicatas', () => {
  const ofertas = [
    st({ id: 'caro', total: 400, price: 380 }),
    st({ id: 'sem-frete', storeId: 'loja-c', shippingKnown: false, total: 250, price: 250 }),   // frete desconhecido não vence
    st({ id: 'barato', storeId: 'loja-d', total: 310, price: 300 }),
    api({ id: 'api', store: { id: 'loja-e' }, total_price: 305, price: 290 }),
    st({ id: 'velha', storeId: 'loja-f', total: 100, price: 90, source_timestamp: min(120) }),
    st({ id: 'stale', storeId: 'loja-g', total: 100, price: 90, stale: true }),
    st({ id: 'dup', storeId: 'loja-d', total: 330, price: 300, url: 'https://loja-d.com.br/x' }),  // mesma chave de "barato", total maior
    null,
  ];
  const { elegiveis, recusadas } = selecionarElegiveis(ofertas, { now: T0 });
  assert.deepEqual(elegiveis.map((o) => o.id), ['api', 'barato', 'caro', 'sem-frete']);
  assert.deepEqual(recusadas, [
    { id: 'velha', motivo: MOTIVOS.FRESCOR }, { id: 'stale', motivo: MOTIVOS.PENDENTE }, { id: null, motivo: MOTIVOS.INVALIDA },
    { id: 'dup', motivo: MOTIVOS.DUPLICADA },
  ]);
  assert.deepEqual(selecionarElegiveis(ofertas, { now: T0, limite: 2 }).elegiveis.map((o) => o.id), ['api', 'barato']);
  assert.deepEqual(selecionarElegiveis(ofertas, { now: T0, limite: 0 }).elegiveis, []);
  assert.throws(() => selecionarElegiveis(ofertas, { now: T0, limite: -1 }), TypeError);
  assert.throws(() => selecionarElegiveis(ofertas, { now: T0, limite: 1.5 }), TypeError);
  assert.deepEqual(selecionarElegiveis(null, { now: T0 }), { elegiveis: [], recusadas: [] });
});

test('ordem estável e sem comissão', () => {
  const base = [st({ id: 'b', storeId: 'l1' }), st({ id: 'a', storeId: 'l2' }), st({ id: 'c', storeId: 'l3', total: 310 })];
  const ids = (l) => selecionarElegiveis(l, { now: T0 }).elegiveis.map((o) => o.id);
  assert.deepEqual(ids(base), ['c', 'a', 'b'], 'empate no total: id');
  assert.deepEqual(ids([...base].reverse()), ['c', 'a', 'b'], 'independe da ordem de entrada');
  // Comissão, afiliado e notas não mudam a ordem.
  const enfeitada = base.map((o, i) => ({ ...o, commission: 100 - i * 40, affiliate: i === 2, dealScore: i * 10, opp: i }));
  assert.deepEqual(ids(enfeitada), ['c', 'a', 'b']);
  // Mesmo id: fica a ordem de entrada.
  const gemeas = [st({ id: 'x', storeId: 'l1', url: 'https://l1.com.br/1' }), st({ id: 'x', storeId: 'l2', url: 'https://l2.com.br/2' })];
  assert.deepEqual(selecionarElegiveis(gemeas, { now: T0 }).elegiveis.map((o) => o.storeId), ['l1', 'l2']);
  // Não altera a lista recebida.
  const copia = JSON.stringify(base); selecionarElegiveis(base, { now: T0 }); assert.equal(JSON.stringify(base), copia);
});

console.log(`social-elegiveis: ${n} testes ok`);
