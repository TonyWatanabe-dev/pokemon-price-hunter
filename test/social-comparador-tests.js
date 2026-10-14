// Social Media MVP — comparativo de lojas para o mesmo produto (issue #654): N melhores elegíveis, uma por loja, na
// ordem da API (menor total comparável), total só com frete conhecido, frete desconhecido explícito, afiliado fora da
// ordem, outros produtos e recusas auditáveis. Módulo puro: sem rede, sem banco, sem secrets.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compararLojas, socialEnabled, SOCIAL_ENABLED_DEFAULT, N_PADRAO, N_MAX, FRETE, MOTIVOS, DISCLOSURE,
} from '../src/agents/social/comparador.js';
import { selecionarElegiveis, MOTIVOS as MOTIVOS_ELEGIVEIS } from '../src/agents/social/elegiveis.js';
import { parseAffiliates } from '../api/_lib/affiliates.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0;
function t(name, fn) { try { fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } }
const T0 = Date.parse('2026-10-13T12:00:00Z');
const min = (m) => new Date(T0 - m * 6e4).toISOString();
const SEM_CFG = parseAffiliates(null);
const CFG = parseAffiliates({ mercadolivre: { anuncios: { MLB1234567890: 'https://meli.la/abc' } } });
const P = 'me02-etb';
// Formatos das elegíveis: API v1 (read-db/read-state) e state.json.
const api = (o = {}) => ({ id: 'a1', product: { id: P }, store: { id: 'loja-a', name: 'Loja A' }, stock: 'in_stock', status: 'active',
  confirmed: true, anomalous: false, price: 300, total_price: 320, shipping: { status: 'known', price: 20 },
  url: 'https://loja-a.com.br/etb', last_seen_at: min(5), ...o });
const st = (o = {}) => ({ id: 's1', productId: P, storeId: 'loja-b', storeName: 'Loja B', stock: 'IN_STOCK', stale: false, anomalous: false,
  price: 310, shippingKnown: true, total: 310, url: 'https://loja-b.com.br/etb', source_timestamp: min(10), ...o });
const comparar = (ofertas, opts) => compararLojas(ofertas, { productId: P, now: T0, afiliados: SEM_CFG, ...opts });
const nbsp = (s) => s.replace(/[  ]/g, ' ');
const ids = (r) => r.ofertas.map((of) => of.id);

t('desligado por padrão: só SOCIAL_ENABLED=1 liga', () => {
  assert.equal(SOCIAL_ENABLED_DEFAULT, false);
  for (const env of [undefined, {}, { SOCIAL_ENABLED: '' }, { SOCIAL_ENABLED: '0' }, { SOCIAL_ENABLED: 'true' }]) assert.equal(!!socialEnabled(env), false);
  assert.equal(socialEnabled({ SOCIAL_ENABLED: '1' }), true);
});

t('comparação básica nos dois formatos: total com frete, frete grátis e linhas', () => {
  const r = comparar([st(), api()]);
  assert.equal(r.productId, P);
  assert.deepEqual(ids(r), ['s1', 'a1']);   // 310 (grátis) < 320
  const [b, a] = r.ofertas;
  assert.deepEqual({ ...b, visto: undefined }, { posicao: 1, id: 's1', lojaId: 'loja-b', loja: 'Loja B', preco: 310, frete: FRETE.GRATIS,
    freteValor: 0, total: 310, diferencaParaMelhor: 0, visto: undefined, afiliado: false });
  assert.equal(a.frete, FRETE.CONHECIDO);
  assert.equal(a.freteValor, 20);
  assert.equal(a.total, 320);
  assert.equal(a.diferencaParaMelhor, 10);
  assert.match(b.visto, /^13\/10\/2026,? 08:50$/);
  assert.deepEqual(r.linhas.map(nbsp), [
    '1. Loja B: R$ 310,00 + frete grátis = total R$ 310,00',
    '2. Loja A: R$ 300,00 + frete R$ 20,00 = total R$ 320,00',
  ]);
  assert.equal(r.freteDesconhecido, false);
  assert.equal(r.afiliado, false);
  assert.equal(r.disclosure, null);
  assert.deepEqual(r.recusadas, []);
  assert.deepEqual(r.avisos, []);
});

t('mesma ordem de selecionarElegiveis (= API), sem reordenar', () => {
  const ofertas = [
    api({ id: 'x1', store: { id: 'l1', name: 'L1' }, price: 290, total_price: 340 }),
    api({ id: 'x2', store: { id: 'l2', name: 'L2' }, price: 280, total_price: null, shipping: { status: 'unknown' } }),
    st({ id: 'x3', storeId: 'l3', storeName: 'L3', price: 315, total: 315 }),
    api({ id: 'x4', store: { id: 'l4', name: 'L4' }, price: 300, total_price: 325 }),
  ];
  const ordemApi = selecionarElegiveis(ofertas, { now: T0 }).elegiveis.map((o) => o.id);
  assert.deepEqual(ordemApi, ['x3', 'x4', 'x1', 'x2']);
  assert.deepEqual(ids(comparar(ofertas, { n: 4 })), ordemApi);
  assert.deepEqual(ids(comparar([...ofertas].reverse(), { n: 4 })), ordemApi);
});

t('frete desconhecido é explícito: sem total, sem diferença, nunca vence frete conhecido', () => {
  const r = comparar([
    api({ id: 'u1', store: { id: 'l1', name: 'Barata' }, price: 100, total_price: 100, shipping: { status: 'unknown' } }),
    st({ id: 'k1', storeId: 'l2', storeName: 'Cara', price: 400, total: 430 }),
  ]);
  assert.deepEqual(ids(r), ['k1', 'u1']);
  const u = r.ofertas[1];
  assert.equal(u.frete, FRETE.DESCONHECIDO);
  assert.equal(u.freteValor, null);
  assert.equal(u.total, null);
  assert.equal(u.diferencaParaMelhor, null);
  assert.equal(nbsp(r.linhas[1]), '2. Barata: R$ 100,00 + frete desconhecido (total a calcular)');
  assert.equal(r.freteDesconhecido, true);
  // state.json sem shippingKnown também é desconhecido, mesmo com "total" preenchido.
  const s = comparar([st({ shippingKnown: false, total: 310 })]);
  assert.equal(s.ofertas[0].frete, FRETE.DESCONHECIDO);
  assert.equal(s.ofertas[0].total, null);
  assert.ok(s.avisos.includes('frete desconhecido na melhor oferta: comparação por preço antes do frete'));
  assert.ok(s.avisos.includes('só uma loja elegível: não há comparação'));
});

t('total incoerente (ausente ou menor que o preço) vira frete desconhecido com aviso', () => {
  const r = comparar([api({ total_price: 250 }), st({ id: 's2', total: null, storeId: 'l9' })]);
  for (const of of r.ofertas) { assert.equal(of.frete, FRETE.DESCONHECIDO); assert.equal(of.total, null); }
  assert.ok(r.avisos.includes('oferta a1: total inválido ignorado, frete tratado como desconhecido'));
  assert.ok(r.avisos.includes('oferta s2: total inválido ignorado, frete tratado como desconhecido'));
});

t('N melhores: padrão 3, uma oferta por loja (fica a melhor) e o resto auditado', () => {
  assert.equal(N_PADRAO, 3);
  const ofertas = [1, 2, 3, 4, 5].map((i) => api({ id: `o${i}`, store: { id: `l${i}`, name: `L${i}` }, price: 300 + i, total_price: 320 + i }));
  ofertas.push(api({ id: 'o1b', store: { id: 'l1', name: 'L1' }, price: 305, total_price: 321.5 }));
  const r = comparar(ofertas);
  assert.deepEqual(ids(r), ['o1', 'o2', 'o3']);
  assert.deepEqual(r.recusadas, [
    { id: 'o1b', motivo: MOTIVOS.MESMA_LOJA },
    { id: 'o4', motivo: MOTIVOS.FORA_DO_LIMITE },
    { id: 'o5', motivo: MOTIVOS.FORA_DO_LIMITE },
  ]);
  assert.deepEqual(ids(comparar(ofertas, { n: 1 })), ['o1']);
  assert.equal(comparar(ofertas, { n: N_MAX }).ofertas.length, 5);
});

t('só o produto pedido; inelegíveis e duplicadas ficam nas recusas com o motivo de elegiveis.js', () => {
  const r = comparar([
    api(),
    api({ id: 'outro', product: { id: 'sv-bb' }, store: { id: 'lx', name: 'LX' } }),
    st({ id: 'sem-estoque', stock: 'OUT_OF_STOCK' }),
    st({ id: 'velha', storeId: 'l7', source_timestamp: min(60 * 24 * 30) }),
    api({ id: 'dup' }),
    null,
  ]);
  assert.deepEqual(ids(r), ['a1']);
  const motivos = Object.fromEntries(r.recusadas.map((x) => [x.id, x.motivo]));
  assert.equal(motivos.outro, MOTIVOS.OUTRO_PRODUTO);
  assert.equal(motivos['sem-estoque'], MOTIVOS_ELEGIVEIS.ESTOQUE);
  assert.equal(motivos.velha, MOTIVOS_ELEGIVEIS.FRESCOR);
  assert.equal(motivos.dup, MOTIVOS_ELEGIVEIS.DUPLICADA);
  assert.equal(motivos.null, MOTIVOS_ELEGIVEIS.INVALIDA);
  const vazio = comparar([api({ stock: 'out_of_stock' })]);
  assert.deepEqual(vazio.ofertas, []);
  assert.deepEqual(vazio.linhas, []);
});

t('afiliado só marca o aviso: não muda ordem, preço nem seleção', () => {
  const af = 'https://produto.mercadolivre.com.br/MLB-1234567890-etb-_JM';
  const ofertas = [
    api({ id: 'cara', store: { id: 'mercadolivre', name: 'Mercado Livre' }, price: 350, total_price: 370, url: af }),
    st({ id: 'barata', storeId: 'l2', storeName: 'Loja B', price: 300, total: 300 }),
  ];
  const com = comparar(ofertas, { afiliados: CFG });
  const sem = comparar(ofertas);
  assert.deepEqual(ids(com), ['barata', 'cara']);
  assert.deepEqual(ids(sem), ids(com));
  assert.deepEqual(com.linhas, sem.linhas);
  assert.deepEqual(com.ofertas.map((of) => [of.preco, of.total]), sem.ofertas.map((of) => [of.preco, of.total]));
  assert.equal(com.ofertas[1].afiliado, true);
  assert.equal(com.afiliado, true);
  assert.equal(com.disclosure, DISCLOSURE);
  assert.equal(sem.afiliado, false);
  assert.equal(sem.disclosure, null);
  assert.equal(comparar([api({ disclosure: true })]).disclosure, DISCLOSURE);
});

t('texto da loja limpo (sem link/marcação) e truncado; sem nome usa o id', () => {
  const r = comparar([
    api({ store: { id: 'l1', name: '<b>Loja</b> @fake https://golpe.com' } }),
    st({ storeName: 'X'.repeat(200) }),
    st({ id: 's3', storeId: 'loja-c', storeName: '   ', price: 330, total: 330 }),
  ]);
  const lojas = Object.fromEntries(r.ofertas.map((of) => [of.id, of.loja]));
  assert.equal(lojas.a1, 'Loja fake');
  assert.ok(lojas.s1.length <= 80 && lojas.s1.endsWith('…'));
  assert.equal(lojas.s3, 'loja-c');
  for (const l of r.linhas) assert.ok(!/https?:\/\/|www\.|<|@/.test(l), l);
  assert.ok(r.avisos.includes('oferta a1: texto da loja limpo (marcação, link ou menção removidos)'));
  assert.ok(r.avisos.includes('oferta s1: nome da loja truncado'));
  assert.ok(r.avisos.includes('oferta s3: loja sem nome, usado o id da loja'));
});

t('entrada inválida falha explícita', () => {
  const casos = [
    [() => compararLojas([api()]), /productId obrigatório/],
    [() => compararLojas([api()], { productId: '  ' }), /productId obrigatório/],
    [() => comparar('x'), /ofertas deve ser uma lista/],
    [() => comparar([api()], { n: 0 }), /n deve ser inteiro/],
    [() => comparar([api()], { n: N_MAX + 1 }), /n deve ser inteiro/],
    [() => comparar([api()], { n: 2.5 }), /n deve ser inteiro/],
    [() => comparar([api()], { now: NaN }), /relógio inválido/],
    [() => comparar([api()], { now: 'ontem' }), /relógio inválido/],
  ];
  for (const [fn, re] of casos) assert.throws(fn, (e) => e.code === 'COMPARADOR_INVALIDO' && re.test(e.message));
});

t('determinístico e não altera a entrada', () => {
  const ofertas = [api(), st()];
  const copia = JSON.parse(JSON.stringify(ofertas));
  assert.deepEqual(comparar(ofertas), comparar(ofertas));
  assert.deepEqual(ofertas, copia);
});

t('módulo puro: sem rede, env, banco ou publicação', () => {
  const src = fs.readFileSync(path.join(root, 'src/agents/social/comparador.js'), 'utf8');
  assert.ok(!/\bfetch\s*\(|process\.env|require\(|import\(/.test(src));
  assert.ok(!/api\.telegram\.org|graph\.facebook\.com|graph\.instagram\.com|pg\b|DATABASE_URL/.test(src));
});

console.log(`social-comparador: ${n} testes ok`);
