// Custo reportado por PR integrada e por issue no relatório da telemetria: soma todas as execuções da issue
// (inclui tentativas falhas) e vira "n/d" quando qualquer execução veio sem custo; nada é estimado.
import assert from 'node:assert/strict';
import { buildRecord, summarize, formatResumo } from '../src/agents/telemetria.js';

let n = 0;
async function t(name, fn) { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } }

const REPO = 'TonyWatanabe-dev/pokemon-price-hunter';
const PERFIL = JSON.stringify({ classe: 'comum', model: 'sonnet', effort: 'medium', maxTurns: 60, falhas: 0, escalada: false });
const result = (custo) => [{ type: 'result', subtype: 'success', is_error: false, num_turns: 3, duration_ms: 1000, total_cost_usd: custo, usage: {} }];
let run = 1;
const exec = ({ issue, tentativa = 1, custo, pr = null, status = pr ? 'success' : 'failure', messages = result(custo) }) => buildRecord({
  issue, chave: `dispatch:${issue}:${tentativa}`, perfil: PERFIL, runId: String(run++), runAttempt: '1', status, repo: REPO,
  prUrl: pr ? `https://github.com/${REPO}/pull/${pr}` : '', messages, now: Date.parse('2026-10-14T09:00:00Z') + run * 60e3,
});

const recs = [
  exec({ issue: 500, tentativa: 1, custo: 0.4 }), // falhou
  exec({ issue: 500, tentativa: 2, custo: 0.6 }), // falhou
  exec({ issue: 500, tentativa: 3, custo: 1.25, pr: 501 }), // entregou, integrada
  exec({ issue: 510, tentativa: 1, messages: null }), // falhou sem execution_file
  exec({ issue: 510, tentativa: 2, custo: 0.75, pr: 511 }), // entregou, integrada, custo incompleto
  exec({ issue: 520, custo: 0.3, pr: 521 }), // entregou, não integrada
  exec({ issue: 530, messages: null }), // nenhum custo informado
];

await t('1. por PR integrada: soma todas as execuções da issue, inclui as tentativas falhas', () => {
  const s = summarize(recs, { prsIntegradas: [501, 511] });
  assert.deepEqual(s.porPrIntegrada, [
    { issue: 500, prs: [501], execucoes: 3, tentativasFalhas: 2, custoTotalUsd: 2.25, custoUsdReportado: 2.25, execucoesSemCusto: 0 },
    { issue: 510, prs: [511], execucoes: 2, tentativasFalhas: 1, custoTotalUsd: null, custoUsdReportado: 0.75, execucoesSemCusto: 1 },
  ]);
  assert.equal(s.custoPorPrIntegrada, null, 'média continua null com custo incompleto');
  assert.equal(summarize(recs, { prsIntegradas: [501] }).custoPorPrIntegrada, 2.25);
  assert.deepEqual(summarize(recs).porPrIntegrada, [], 'sem PR integrada, lista vazia');
});

await t('2. por issue: tentativas falhas contadas; custo total null quando falta dado (nunca parcial nem zero)', () => {
  const por = Object.fromEntries(summarize(recs, { prsIntegradas: [501, 511] }).porIssue.map((i) => [i.issue, i]));
  assert.deepEqual([por[500].falhas, por[500].sucesso, por[500].custoTotalUsd], [2, 1, 2.25]);
  assert.deepEqual([por[510].falhas, por[510].custoTotalUsd, por[510].custoUsdReportado, por[510].semCusto], [1, null, 0.75, 1]);
  assert.deepEqual([por[520].falhas, por[520].custoTotalUsd, por[520].prIntegrada], [0, 0.3, false]);
  assert.deepEqual([por[530].falhas, por[530].custoTotalUsd], [1, null]);
});

await t('3. relatório: custo por PR integrada e por issue, com "n/d" quando falta dado', () => {
  const txt = formatResumo(summarize(recs, { prsIntegradas: [501, 511] }), { desde: '2026-10-14' });
  assert.match(txt, /^Telemetria do worker desde 2026-10-14: 7 execução\(ões\), 3 com PR, 4 sem entrega/);
  assert.match(txt, /por PR integrada: n\/d \(2 PR\)/);
  assert.match(txt, /Custo por PR integrada \(todas as execuções da issue, inclui tentativas falhas\):/);
  assert.match(txt, /\n {2}PR #501 \(issue #500\): US\$ 2\.25 · 3 exec\., 2 tentativa\(s\) falha\(s\)/);
  assert.match(txt, /\n {2}PR #511 \(issue #510\): n\/d \(parcial US\$ 0\.75; 1 sem dado\) · 2 exec\., 1 tentativa\(s\) falha\(s\)/);
  assert.match(txt, /Custo por issue \(inclui tentativas falhas\):/);
  assert.match(txt, /\n {2}#500: 3 exec\., 2 tentativa\(s\) falha\(s\), 0 escalada\(s\), US\$ 2\.25, PR #501 \(integrada\)/);
  assert.match(txt, /\n {2}#520: 1 exec\., 0 tentativa\(s\) falha\(s\), 0 escalada\(s\), US\$ 0\.30, PR #521$/m);
  assert.match(txt, /\n {2}#530: 1 exec\., 1 tentativa\(s\) falha\(s\), 0 escalada\(s\), n\/d, PR —$/m);
  assert.doesNotMatch(txt, /US\$ 0\.00/, 'sem dado nunca vira zero');
});

await t('4. relatório vazio e sem PR integrada: sem seções vazias, custos n/d', () => {
  const vazio = formatResumo(summarize([]));
  assert.match(vazio, /Custo reportado: n\/d \(0 sem dado\) · por PR integrada: n\/d \(0 PR\)/);
  assert.doesNotMatch(vazio, /Custo por (PR integrada \(|issue)/);
  const semMerge = formatResumo(summarize(recs));
  assert.doesNotMatch(semMerge, /Custo por PR integrada \(/);
  assert.doesNotMatch(semMerge, /\(integrada\)/);
});

console.log(`✓ Telemetria — custo por PR integrada e por issue: ${n} grupos de testes passaram`);
