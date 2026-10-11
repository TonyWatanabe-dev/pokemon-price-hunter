// Release Governor: avaliação determinística de risco, evidências por SHA e escalonamento fechado.
import assert from 'node:assert/strict';
import { classifyReleaseRisk, evaluateRelease, RISK, RELEASE_ACTION } from '../src/agents/release-governor.js';

const SHA = 'a'.repeat(40);
const check = (name, status = 'success', sha = SHA) => ({ name, status, sha });
const evidence = (overrides = {}) => ({
  baseRef: 'main',
  headRef: 'feat/isolated-change',
  headSha: SHA,
  conflictFree: true,
  checks: [
    check('ci'), check('tests'), check('preview'), check('accessibility'),
    check('regression'), check('golden'),
  ],
  rollback: { documented: true, tested: true },
  rollout: { metricsDefined: true, rollbackTriggersDefined: true },
  featureFlag: { applicable: false, reason: 'mudança sem novo comportamento gradualizável' },
  ...overrides,
});

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; } catch (error) { console.error(`✗ ${name}`); throw error; }
};

test('documentação é R0; alterações de testes exigem R2', () => {
  assert.equal(classifyReleaseRisk(['docs/agentes.md', 'README.md']).risk, RISK.R0);
  assert.equal(classifyReleaseRisk(['test/agents-release-governor-tests.js']).risk, RISK.R2);
});

test('UI isolada é R1; código funcional é R2', () => {
  assert.equal(classifyReleaseRisk(['assets/home.css', 'docs/ux.md']).risk, RISK.R1);
  assert.equal(classifyReleaseRisk(['index.html']).risk, RISK.R2, 'HTML da Home inclui scripts e lógica');
  assert.equal(classifyReleaseRisk(['api/v1.mjs', 'test/api-tests.js']).risk, RISK.R2);
});

test('config, migrations, workflows, ranking e o próprio governor são R3', () => {
  for (const p of [
    'config/catalog.json', 'db/migrations/099_critical.sql', '.github/workflows/ci.yml',
    'package.json', 'package-lock.json', 'vercel.json', '.vercelignore',
    'src/agents/orchestrator.js', 'src/agents/cycle.js',
    'api/_lib/offer-rank.mjs', 'api/_lib/references.mjs', 'src/core/price-engine.js',
    'src/core/opportunity-engine.js', 'src/copag-check.js', 'tools/data-restore.mjs',
    'src/agents/release-governor.js', 'src/agents/governance.js',
  ]) assert.equal(classifyReleaseRisk([p]).risk, RISK.R3, p);
});

test('escopo vazio, path traversal e arquivos desconhecidos ficam em R3', () => {
  assert.equal(classifyReleaseRisk([]).risk, RISK.R3);
  assert.equal(classifyReleaseRisk(['../.env']).risk, RISK.R3);
  assert.equal(classifyReleaseRisk(['something-unclassified.bin']).risk, RISK.R3);
});

test('R0 libera merge somente com CI, testes e branch isolada no SHA atual', () => {
  const r = evaluateRelease({ changedPaths: ['docs/release.md'], evidence: evidence() });
  assert.equal(r.decision, 'autonomous');
  assert.deepEqual(r.allowedActions, [RELEASE_ACTION.MERGE]);
  assert.equal(r.deploymentRequired, false);
});

test('check "test" do CI atual pode comprovar CI e suíte npm test no mesmo SHA', () => {
  const r = evaluateRelease({ changedPaths: ['docs/release.md'], evidence: evidence({ checks: [check('test')] }) });
  assert.equal(r.decision, 'autonomous');
  assert.deepEqual(r.allowedActions, [RELEASE_ACTION.MERGE]);
});

test('R1 precisa de preview e acessibilidade no mesmo SHA', () => {
  const good = evaluateRelease({ changedPaths: ['assets/home.css'], evidence: evidence() });
  assert.equal(good.decision, 'autonomous');
  assert.deepEqual(good.allowedActions, [RELEASE_ACTION.MERGE, RELEASE_ACTION.DEPLOY]);
  const noA11y = evaluateRelease({
    changedPaths: ['assets/home.css'],
    evidence: evidence({ checks: [check('ci'), check('tests'), check('preview')] }),
  });
  assert.equal(noA11y.decision, 'blocked');
  assert.ok(noA11y.missingEvidence.some((x) => x.includes('accessibility')));
});

test('R2 precisa de regressão, golden tests, rollback, rollout e feature flag justificada', () => {
  const good = evaluateRelease({ changedPaths: ['api/v1.mjs'], evidence: evidence() });
  assert.equal(good.decision, 'autonomous');
  assert.deepEqual(good.allowedActions, [RELEASE_ACTION.MERGE, RELEASE_ACTION.DEPLOY]);

  const noRollback = evaluateRelease({
    changedPaths: ['api/v1.mjs'],
    evidence: evidence({ rollback: { documented: true, tested: false } }),
  });
  assert.equal(noRollback.decision, 'blocked');
  assert.ok(noRollback.missingEvidence.some((x) => x.includes('rollback')));

  const noFlag = evaluateRelease({
    changedPaths: ['api/v1.mjs'],
    evidence: evidence({ featureFlag: { applicable: true, present: true, defaultOff: false } }),
  });
  assert.equal(noFlag.decision, 'blocked');
  assert.ok(noFlag.missingEvidence.some((x) => x.includes('feature flag')));
});

test('falha de CI e SHA de check antigo bloqueiam autonomia', () => {
  const failed = evaluateRelease({
    changedPaths: ['docs/release.md'],
    evidence: evidence({ checks: [check('ci', 'failure'), check('tests')] }),
  });
  assert.equal(failed.decision, 'blocked');

  const stale = evaluateRelease({
    changedPaths: ['docs/release.md'],
    evidence: evidence({ checks: [check('ci', 'success', 'b'.repeat(40)), check('tests')] }),
  });
  assert.equal(stale.decision, 'blocked');
  assert.ok(stale.missingEvidence.some((x) => x.includes('HEAD atual')));
});

test('conflito, base incorreta ou alteração na main bloqueiam', () => {
  for (const patch of [
    { conflictFree: false },
    { baseRef: 'production' },
    { headRef: 'main' },
  ]) {
    const r = evaluateRelease({ changedPaths: ['docs/release.md'], evidence: evidence(patch) });
    assert.equal(r.decision, 'blocked');
    assert.deepEqual(r.allowedActions, []);
  }
});

test('R3 nunca fica autônomo, mesmo com todas as evidências verdes', () => {
  const r = evaluateRelease({ changedPaths: ['db/migrations/099_critical.sql'], evidence: evidence() });
  assert.equal(r.risk, RISK.R3);
  assert.equal(r.decision, 'human_required');
  assert.equal(r.requiresHuman, true);
  assert.deepEqual(r.allowedActions, []);
});

test('um único arquivo de maior risco domina a classificação e ações desconhecidas não são propostas', () => {
  const r = evaluateRelease({ changedPaths: ['docs/readme.md', 'src/agents/governance.js'], evidence: evidence() });
  assert.equal(r.risk, RISK.R3);
  assert.deepEqual(r.allowedActions, []);
});

console.log(`✓ Release Governor (política determinística): ${passed} grupos de testes passaram`);
