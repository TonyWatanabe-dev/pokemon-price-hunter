// Price Intelligence Agent (Fase 7, item 8): explica variações com incerteza; nunca define preço oficial, referência,
// score nem alerta. Dados SINTÉTICOS (séries de data/hist/<id>.json escritas à mão), sem rede/banco.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { priceIntelReport, priceIntelMarkdown, explainProduct, bestSeries, comparability, PRICE_INTEL_VERSION } from '../src/agents/price-intel.js';

let n = 0; const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };
const AS_OF = '2026-10-15T12:00:00.000Z';
const D = (k) => new Date(Date.parse('2026-10-15T00:00:00Z') - k * 864e5).toISOString().slice(0, 10);   // D(0) = hoje
const series = (vals) => vals.map((v, i) => [D(vals.length - 1 - i), v]).filter(([, v]) => v != null);   // último valor = hoje
const H = (stores) => ({ productId: 'x', stores: Object.fromEntries(Object.entries(stores).map(([sid, vals]) => [sid, { name: sid, pts: series(vals) }])) });
const ex = (stores, o = {}) => explainProduct({ productId: 'x', hist: H(stores), asOf: AS_OF, ...o });

t('queda real numa loja, persistente', () => {
  const r = ex({ a: [100, 100, 100, 100, 100, 80, 80, 80], b: [120, 120, 120, 120, 120, 120, 120, 120] });
  assert.equal(r.abstain, null); assert.equal(r.direction, 'queda'); assert.equal(r.cause, 'mudanca_de_preco_na_loja');
  assert.equal(r.persistence, 'persistente'); assert.equal(r.streakDays, 3); assert.equal(r.observed.lastStore, 'a');
  assert.equal(r.observed.baselineMedian, 100); assert.equal(r.observed.change, -0.2);
  assert.ok(r.evidence.some((e) => e.code === 'CAUSA_PROVAVEL' && e.basis === 'inferido'));
  assert.ok(r.evidence.some((e) => e.code === 'MENOR_PRECO_DO_DIA' && e.basis === 'observado'));
});

t('loja nova mais barata no último dia: composição, pontual, incerteza maior', () => {
  const r = ex({ a: [100, 100, 100, 100, 100, 100], b: [null, null, null, null, null, 85] });
  assert.equal(r.cause, 'loja_nova_no_menor_preco'); assert.equal(r.persistence, 'pontual');
  assert.notEqual(r.uncertainty.level, 'baixa'); assert.ok(r.uncertainty.reasons.includes('o menor preço mudou de loja'));
});

t('saída da loja mais barata: alta explicada por composição, não por aumento', () => {
  const r = ex({ a: [80, 80, 80, 80, 80, null], b: [100, 100, 100, 100, 100, 100] });
  assert.equal(r.direction, 'alta'); assert.equal(r.cause, 'saida_da_loja_mais_barata');
});

t('a loja mais barata subiu e outra assumiu', () => {
  const r = ex({ a: [80, 80, 80, 80, 80, 110], b: [100, 100, 100, 100, 100, 100] });
  assert.equal(r.direction, 'alta'); assert.equal(r.cause, 'mudanca_de_preco_na_loja'); assert.match(r.evidence.find((e) => e.code === 'CAUSA_PROVAVEL').detail, /a subiu de 80 para 110/);
});

t('outra loja baixou e passou a líder; e mesma loja estável com base mista = composição', () => {
  const r = ex({ a: [100, 100, 100, 100, 100, 100], b: [120, 120, 120, 120, 120, 90] });
  assert.equal(r.cause, 'mudanca_de_preco_na_loja'); assert.match(r.evidence.find((e) => e.code === 'CAUSA_PROVAVEL').detail, /b baixou de 120 para 90 e passou a/);
  const s = ex({ a: [null, null, 70, 70], b: [100, 100, null, null] });   // a lidera 2 dias, b 2 dias: base mista
  assert.equal(s.direction, 'queda'); assert.equal(s.cause, 'mudanca_de_composicao');
});

t('estável: sem causa, sem persistência', () => {
  const r = ex({ a: [100, 101, 99, 100, 102, 100, 101] });
  assert.equal(r.direction, 'estavel'); assert.equal(r.cause, 'sem_mudanca_relevante'); assert.equal(r.persistence, null); assert.equal(r.anomaly.suspect, false);
});

t('abstenção: amostra curta, histórico defasado, sem base na janela', () => {
  assert.equal(ex({ a: [100, 90] }).abstain, 'amostra_insuficiente');
  const old = explainProduct({ productId: 'x', hist: { stores: { a: { pts: [[D(20), 100], [D(19), 100], [D(18), 100]] } } }, asOf: AS_OF });
  assert.equal(old.abstain, 'historico_defasado');
  const gap = explainProduct({ productId: 'x', hist: { stores: { a: { pts: [[D(30), 100], [D(29), 100], [D(0), 100]] } } }, asOf: AS_OF });
  assert.equal(gap.abstain, 'sem_base_na_janela');
  for (const r of [old, gap]) { assert.equal(r.uncertainty.level, 'alta'); assert.equal(r.observed, undefined); }
});

t('anomalia: salto fora do padrão do próprio histórico (MAD) e desvio relativo sem dispersão', () => {
  const r = ex({ a: [100, 101, 99, 100, 102, 98, 100, 101, 99, 40] });
  assert.equal(r.anomaly.suspect, true); assert.equal(r.anomaly.method, 'mad'); assert.ok(r.anomaly.z < -3.5);
  assert.equal(r.uncertainty.level, 'alta');
  const flat = ex({ a: [100, 100, 100, 100, 160] });
  assert.equal(flat.anomaly.method, 'desvio_relativo'); assert.equal(flat.anomaly.suspect, true);
});

t('janela de desconfiança, ponto inválido e ponto futuro ficam fora', () => {
  const hist = { stores: { a: { pts: [...series([100, 100, 100, 100]), ['2026-10-16', 1], ['xx', 5], [D(1), -3]] }, b: { pts: series([50, 50, 50, 100]) } } };
  const distrust = { stores: ['b'], until: D(1) };   // b não vale até ontem (inclusive)
  const s = bestSeries(hist, distrust, D(0));
  assert.equal(s.dropped.untrusted, 3); assert.equal(s.dropped.future, 1); assert.equal(s.dropped.invalid, 2);
  const r = explainProduct({ productId: 'x', hist, distrust, asOf: AS_OF });
  assert.equal(r.observed.baselineMedian, 100, 'pontos de b sob desconfiança não entram na base');
});

t('comparabilidade: Pix e frete desconhecido no menor preço aumentam a incerteza', () => {
  const offers = [{ id: 1, productId: 'x', storeId: 'a', total: 80, stock: 'IN_STOCK', priceKind: 'pix', shippingKnown: false },
    { id: 2, productId: 'x', storeId: 'b', total: 90, stock: 'IN_STOCK', priceKind: 'base', shippingKnown: true },
    { id: 3, productId: 'x', storeId: 'c', total: 10, stock: 'IN_STOCK', anomalous: true }, { id: 4, storeId: 'd', total: 95, stock: 'UNKNOWN' }];
  const c = comparability(offers);
  assert.deepEqual(c.flags.sort(), ['estoque_nao_confirmado_em_parte', 'frete_desconhecido_no_menor_preco', 'menor_preco_e_pix', 'mistura_com_e_sem_frete', 'mistura_pix_e_preco_normal', 'oferta_anomala_excluida'].sort());
  assert.equal(c.best.store, 'a', 'oferta anômala nunca é o menor preço');
  const r = ex({ a: [100, 100, 100, 100, 100, 100], b: [120, 120, 120, 120, 120, 120] }, { offers });
  assert.equal(r.uncertainty.level, 'media'); assert.ok(r.uncertainty.reasons.includes('menor_preco_e_pix'));
});

const report = (o = {}) => priceIntelReport({ asOf: AS_OF, distrust: null, hist: {
  queda: H({ a: [100, 100, 100, 100, 100, 80, 80, 80] }), estavel: H({ a: [50, 50, 50, 50] }), curto: H({ a: [10, 10] }), pico: H({ a: [100, 101, 99, 100, 102, 98, 100, 101, 99, 40] }),
}, state: { generatedAt: AS_OF, products: [{ id: 'queda', name: 'Produto Queda' }], offers: [{ id: 1, productId: 'queda', storeId: 'a', total: 80, stock: 'IN_STOCK', priceKind: 'pix', shippingKnown: true }] }, ...o });

t('relatório: envelope de explicação, nada gravado, nenhum campo de preço oficial/referência/score', () => {
  const r = report();
  assert.equal(r.agent, 'price-intel'); assert.equal(r.version, PRICE_INTEL_VERSION); assert.equal(r.mode, 'explicacao');
  assert.equal(r.writes, false); assert.equal(r.autoApply, false); assert.deepEqual(r.notDefined, ['preco_oficial', 'referencia', 'score', 'oportunidade', 'alerta']);
  const keys = []; const walk = (v) => { if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { keys.push(k); walk(x); } };
  walk(r.items); walk(r.summary);
  const bad = keys.filter((k) => /score|refer[eê]nc|reference|oportunid|opportunit|official|oficial|msrp|alert|deal|discount/i.test(k));
  assert.deepEqual(bad, [], `campos proibidos na saída: ${bad.join(', ')}`);
  assert.equal(r.items[0].product, 'pico', 'anomalia primeiro'); assert.equal(r.items.at(-1).abstain, 'amostra_insuficiente');
  assert.equal(r.items.find((x) => x.product === 'queda').name, 'Produto Queda');
  assert.deepEqual(r.summary.abstained, { amostra_insuficiente: 1 }); assert.equal(r.summary.anomalies, 1);
});

t('pré-requisitos medidos: histórico curto = parcial; comparabilidade não atendida; golden temporal conta', () => {
  const st = (r, id) => r.prerequisites.find((p) => p.id === id).status;
  const r = report();
  assert.equal(st(r, 'historico_suficiente'), 'parcial'); assert.equal(st(r, 'comparabilidade'), 'nao_atendido'); assert.equal(st(r, 'golden_temporais'), 'nao_atendido');
  assert.match(r.prerequisites.find((p) => p.id === 'comparabilidade').detail, /1\/1 oferta\(s\) em estoque em Pix/);
  assert.equal(st(report({ temporalGoldenCases: 3 }), 'golden_temporais'), 'atendido');
  const long = Object.fromEntries(['p1', 'p2', 'p3'].map((id) => [id, H({ a: Array.from({ length: 31 }, () => 100) })]));
  assert.equal(st(report({ hist: long }), 'historico_suficiente'), 'atendido');
  assert.equal(st(report({ hist: { a: H({ a: [1] }) } }), 'historico_suficiente'), 'nao_atendido');
});

t('filtro por produto, determinismo, entrada intacta e asOf obrigatório', () => {
  assert.deepEqual(report({ only: ['queda'] }).items.map((x) => x.product), ['queda']);
  const h = { q: H({ a: [100, 100, 100, 80] }) }; const before = JSON.stringify(h);
  assert.deepEqual(priceIntelReport({ hist: h, asOf: AS_OF }), priceIntelReport({ hist: h, asOf: AS_OF }));
  assert.equal(JSON.stringify(h), before);
  assert.throws(() => priceIntelReport({ hist: h }), /asOf ausente/);
});

t('Markdown: deixa claro que não define preço/score e mostra causa, persistência e incerteza', () => {
  const md = priceIntelMarkdown(report());
  for (const re of [/somente explicação/, /não define preco_oficial, referencia, score/, /## Pré-requisitos/, /mudanca_de_preco_na_loja/, /persistente/, /sim \(mad/]) assert.match(md, re);
});

t('módulo e CLI sem rede, banco ou escrita nos dados', () => {
  const src = fs.readFileSync(new URL('../src/agents/price-intel.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /from 'node:(fs|http|https|net|child_process)'|pg\.js|fetch\(|writeFile|recordDay|opportunity-engine'/);
  const cli = fs.readFileSync(new URL('../tools/agente-preco.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(cli, /DATABASE_URL|pg\.js|fetch\(/);
  assert.equal((cli.match(/writeFileSync/g) || []).length, 1, 'só o --out');
});

// Workflow opcional: manual, só leitura, sem secrets e desligado por variável.
{
  const y = fs.readFileSync(new URL('../.github/workflows/agente-preco.yml', import.meta.url), 'utf8');
  const code = y.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
  assert.match(code, /^on:\n  workflow_dispatch:\n(?!\s+\w)/m, 'só workflow_dispatch');
  assert.doesNotMatch(code, /schedule:|push:|pull_request|workflow_run|issues:/);
  assert.match(code, /^permissions:\n  contents: read\nconcurrency:/m, 'permissão mínima');
  assert.doesNotMatch(code, /secrets\.|DATABASE_URL|write|GH_TOKEN|github\.token/);
  assert.match(code, /if: vars\.AGENTE_INTELIGENCIA_PRECO == 'true'/);
  assert.match(code, /node tools\/agente-preco\.mjs rel >> "\$GITHUB_STEP_SUMMARY"/);
  n++;
}

console.log(`OK — price intelligence agent: ${n} testes`);
