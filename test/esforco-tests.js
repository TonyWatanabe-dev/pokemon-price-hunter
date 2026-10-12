// Esforço adaptativo (#235): classe por regras, menor perfil adequado, escalada por falha, piso em crítica,
// argumentos só de listas fechadas, telemetria real (sem invenção) e orçamento.
import assert from 'node:assert/strict';
import { classifyTask, profileFor, claudeArgs, telemetryFromExecution, budgetGate, CLASSES, EFFORTS } from '../src/agents/esforco.js';

let n = 0;
async function t(name, fn) { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } }
const C = (o) => classifyTask(o).classe;

await t('1. classes coerentes: docs → mecânica, comum por padrão, depuração/arquitetura → complexa, R3 → crítica', () => {
  assert.equal(C({ title: 'docs: corrigir link do README', body: 'Áreas: `docs/executor.md`' }), CLASSES.MECANICA);
  assert.equal(C({ labels: ['documentation'], title: 'Explicar fila' }), CLASSES.MECANICA);
  assert.equal(C({ title: 'Filtro de loja na página de busca', body: 'Áreas: `index.html`, `api/v1.mjs`' }), CLASSES.COMUM);
  assert.equal(C({ labels: ['bug'], title: 'Falha intermitente no coletor', body: 'investigar race na gravação' }), CLASSES.COMPLEXA);
  assert.equal(C({ title: 'Refatorar arquitetura do coletor' }), CLASSES.COMPLEXA);
  assert.equal(C({ title: 'Refatorar o parser de ofertas' }), CLASSES.COMPLEXA, 'refatorar sem a palavra arquitetura');
  assert.equal(C({ title: 'Integração com Vercel' }), CLASSES.COMPLEXA, 'integração com sem outra palavra de arquitetura');
  for (const body of ['Áreas: `.github/workflows/tarefas.yml`', 'Áreas: `src/agents/x.js`', 'Áreas: `db/011.sql`', 'Risco previsto: R3 (`package.json`)'])
    assert.equal(C({ title: 'x', body }), CLASSES.CRITICA, body);
  assert.equal(C({ title: 'Rotacionar secret do ML' }), CLASSES.CRITICA, 'assunto de credencial é crítico mesmo sem área');
  for (const title of ['Rotacionar credenciais', 'Atualizar migrations', 'Revisar permissões', 'Renovar tokens', 'Update secrets', 'Change credentials'])
    assert.equal(C({ title }), CLASSES.CRITICA, `assunto crítico com flexão: ${title}`);
  assert.equal(C({ labels: ['security'], title: 'x' }), CLASSES.CRITICA);
  assert.equal(C({ title: 'Ponte', body: 'Fase: 0 · Risco previsto: R3 (merge humano)' }), CLASSES.CRITICA, 'R3 declarado basta');
  assert.equal(C({ title: 'x', body: 'Risco previsto: R0 (docs)' }), CLASSES.COMUM);
  assert.equal(C({}), CLASSES.COMUM, 'sem dado: comum (nem barato demais nem caro demais)');
});

await t('2. menor perfil adequado por classe; crítica nunca abaixo de high; max nunca automático', () => {
  assert.deepEqual(profileFor('mecanica'), { model: 'sonnet', effort: 'low', maxTurns: 30, escalada: false });
  assert.deepEqual(profileFor('comum'), { model: 'sonnet', effort: 'medium', maxTurns: 60, escalada: false });
  assert.deepEqual(profileFor('complexa'), { model: 'opus', effort: 'high', maxTurns: 80, escalada: false });
  assert.deepEqual(profileFor('critica'), { model: 'opus', effort: 'high', maxTurns: 80, escalada: false });
  for (const c of Object.values(CLASSES)) for (let f = 0; f < 10; f++) assert.notEqual(profileFor(c, f).effort, 'max');
  for (let f = 0; f < 5; f++) assert.ok(EFFORTS.indexOf(profileFor('critica', f).effort) >= EFFORTS.indexOf('high'));
});

await t('3. escalada só com falha comprovada: +1 nível de esforço por falha, sonnet→opus a partir da 1ª, teto xhigh', () => {
  assert.deepEqual([0, 1, 2, 3, 6].map((f) => profileFor('mecanica', f).effort), ['low', 'medium', 'high', 'xhigh', 'xhigh']);
  assert.deepEqual([0, 1].map((f) => profileFor('comum', f).model), ['sonnet', 'opus']);
  assert.deepEqual([0, 1, 2, 5].map((f) => profileFor('comum', f).maxTurns), [60, 70, 80, 80], 'turnos crescem pouco e param');
  assert.equal(profileFor('comum', 1).escalada, true);
  // falha também muda a classe: duas falhas tornam uma tarefa comum "complexa"
  assert.equal(C({ title: 'Filtro de loja', failures: 2 }), CLASSES.COMPLEXA);
  assert.equal(C({ title: 'docs: x', body: 'Áreas: `docs/a.md`', failures: 1 }), CLASSES.COMUM, 'docs que já falhou deixa de ser mecânica');
});

await t('4. claude_args só com valores de listas fechadas (nada vindo da issue chega à linha de comando)', () => {
  assert.equal(claudeArgs(profileFor('mecanica')), '--model sonnet\n--effort low\n--max-turns 30');
  assert.throws(() => claudeArgs({ model: 'sonnet; rm -rf /', effort: 'low', maxTurns: 30 }), /modelo/);
  assert.throws(() => claudeArgs({ model: 'opus', effort: 'max', maxTurns: 30 }), /esforço/, 'max exige decisão explícita fora do automático');
  assert.throws(() => claudeArgs({ model: 'opus', effort: 'high', maxTurns: 999 }), /max-turns/);
});

await t('5. telemetria real do execution_file; ausente vira null (nunca estimada)', () => {
  const msgs = [{ type: 'system', subtype: 'init' }, { type: 'assistant', message: {} },
    { type: 'result', subtype: 'success', is_error: false, num_turns: 12, duration_ms: 95000, total_cost_usd: 0.4312,
      usage: { input_tokens: 1200, output_tokens: 3400, cache_read_input_tokens: 50000, cache_creation_input_tokens: 8000 }, modelUsage: { 'claude-sonnet-5-5': {} } }];
  assert.deepEqual(telemetryFromExecution(msgs), { sucesso: true, subtipo: 'success', turnos: 12, duracaoMs: 95000, custoUsd: 0.4312,
    tokens: { entrada: 1200, saida: 3400, cacheLeitura: 50000, cacheCriacao: 8000 }, modelos: ['claude-sonnet-5-5'] });
  assert.equal(telemetryFromExecution([]), null); assert.equal(telemetryFromExecution(null), null);
  const semCusto = telemetryFromExecution([{ type: 'result', subtype: 'error_max_turns', is_error: true }]);
  assert.deepEqual([semCusto.sucesso, semCusto.custoUsd, semCusto.tokens.entrada, semCusto.turnos], [false, null, null, null]);
});

await t('6. orçamento: pausa só com custo real acima do limite; sem telemetria não inventa', () => {
  assert.equal(budgetGate({}).permitir, true);
  assert.match(budgetGate({ limiteUsd: 10 }).motivo, /sem telemetria/);
  assert.equal(budgetGate({ gastoUsd: 9.99, limiteUsd: 10 }).permitir, true);
  assert.equal(budgetGate({ gastoUsd: 10, limiteUsd: 10 }).permitir, false);
});

await t('7. regressão #266: risco baixo declarado + áreas não críticas → palavras do corpo não escalam; o resto continua', () => {
  const corpo = (risco, area) => `Ordem: 1\nFase: 0 · Risco previsto: ${risco} (documentação)\nÁreas: \`${area}\`\n\n## Tarefa\n1. **Aprovar:** formato (\`Ordem:\`, \`Fase:\`, \`Risco previsto:\`, \`Áreas:\`).\nNão alterar código, workflows, \`package.json\`, secrets, tokens ou produção.`;
  const r = classifyTask({ title: 'F0 · Runbook de operação dos agentes', body: corpo('R0', 'docs/runbook-agentes.md') });
  assert.equal(r.classe, CLASSES.MECANICA); assert.deepEqual(r.areas, ['docs/runbook-agentes.md'], 'menções no meio do texto não viram área');
  assert.equal(C({ title: 'Rotacionar token do ML', body: corpo('R0', 'docs/x.md') }), CLASSES.CRITICA, 'título crítico continua crítico');
  assert.equal(C({ title: 'x', body: corpo('R0', '.github/workflows/ci.yml') }), CLASSES.CRITICA, 'área crítica continua crítica');
  assert.equal(C({ title: 'x', body: corpo('R3', 'docs/x.md') }), CLASSES.CRITICA, 'R3 declarado continua crítico');
  assert.equal(C({ title: 'x', labels: ['security'], body: corpo('R0', 'docs/x.md') }), CLASSES.CRITICA, 'label security continua crítico');
  assert.equal(C({ title: 'x', body: 'Risco previsto: R0\nAjustar o fluxo de secrets' }), CLASSES.CRITICA, 'sem áreas declaradas, o corpo todo conta');
  assert.equal(C({ title: 'x', body: 'Ajustar secrets\nÁreas: `docs/a.md`' }), CLASSES.CRITICA, 'sem risco declarado, o corpo todo conta');
});

console.log(`✓ Esforço adaptativo: ${n} grupos de testes passaram`);
