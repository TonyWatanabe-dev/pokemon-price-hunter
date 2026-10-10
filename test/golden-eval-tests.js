// Avaliação offline com casos dourados sintéticos: sem regressões, determinística, sem dados sensíveis.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runGolden, evalMatching, evalOpportunity } from '../src/agents/golden-eval.js';

const raw = fs.readFileSync(new URL('./golden/cases.json', import.meta.url), 'utf8');
const file = JSON.parse(raw);
let n = 0;
const test = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };

test('casos dourados: nenhuma regressão', () => {
  const r = runGolden(file);
  assert.deepEqual(r.failures, [], JSON.stringify(r.failures, null, 2));
  assert.equal(r.passed, r.total);
  assert.ok(r.total >= 30);
  for (const area of ['matching', 'preco', 'frete', 'estoque']) assert.ok(r.byArea[area] > 0, area);
});

test('execução determinística', () => {
  assert.deepEqual(runGolden(file), runGolden(file));
});

test('casos são marcados como sintéticos, sem dados pessoais ou segredos', () => {
  assert.equal(file.meta.synthetic, true); assert.equal(runGolden(file).synthetic, true);
  assert.ok(!raw.includes('@'), 'sem e-mails');
  for (const u of raw.match(/https?:\/\/[^"\s/]+/g) || []) assert.match(u, /\.invalid$/, u);
  assert.ok(!/(token|senha|password|secret|api[_-]?key|cpf)/i.test(raw));
  const ids = [...file.matching, ...file.opportunity].map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'ids únicos');
});

test('o avaliador detecta falso positivo, falso negativo, produto errado e revisão indevida', () => {
  const c = file.matching.find((x) => x.id === 'M01-box36-correto');
  const kinds = (x) => evalMatching(x, file.catalog).failures.map((f) => f.kind);
  assert.deepEqual(kinds({ ...c, expect: { productId: null, review: null } }), ['falso_positivo']);
  assert.deepEqual(kinds({ ...c, expect: { productId: 'beta-etb', review: null } }), ['produto_errado']);
  const rej = file.matching.find((x) => x.id === 'M04-acessorio-recusado');
  assert.deepEqual(kinds({ ...rej, expect: { productId: 'alfa-box36', review: null } }), ['falso_negativo']);
  assert.deepEqual(kinds({ ...c, expect: { productId: 'alfa-box36', review: 'tipo_desconhecido' } }), ['revisao']);
});

test('o avaliador detecta regressão de preço, frete e estoque', () => {
  const p = file.opportunity.find((x) => x.id === 'E02-sem-estoque');
  assert.deepEqual(evalOpportunity({ ...p, expect: { minScore: 90 } }).failures.map((f) => f.kind), ['score_abaixo_do_minimo']);
  assert.deepEqual(evalOpportunity({ ...p, expect: { caps: ['preorder'] } }).failures.map((f) => f.kind), ['trava_ausente']);
  const f = file.opportunity.find((x) => x.id === 'F02-frete-desconhecido-nunca-zero');
  assert.deepEqual(evalOpportunity({ ...f, expect: { freightSignal: [0, 0] } }).failures.map((x) => x.kind), ['sinal_de_frete']);
  assert.deepEqual(evalOpportunity({ ...f, expect: { review: true } }).failures.map((x) => x.kind), ['revisao']);
});

console.log(`✓ Avaliação offline (casos dourados sintéticos): ${n} grupos de testes passaram`);
