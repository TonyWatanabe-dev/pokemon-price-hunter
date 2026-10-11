// Release Governor: avaliação determinística de risco, evidências por SHA e escalonamento fechado.
import assert from 'node:assert/strict';
import { buildReleaseAuditEvent, evaluateAndRecordRelease } from '../src/agents/release-governor-audit.js';
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
const testAsync = async (name, fn) => {
  try { await fn(); passed++; } catch (error) { console.error(`✗ ${name}`); throw error; }
};

test('documentação comum é R0; testes exigem R2 e políticas de agentes são R3', () => {
  assert.equal(classifyReleaseRisk(['docs/release-notes.md', 'README.md']).risk, RISK.R0);
  assert.equal(classifyReleaseRisk(['test/agents-release-governor-tests.js']).risk, RISK.R2);
  assert.equal(classifyReleaseRisk(['docs/agentes.md']).risk, RISK.R3);
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
    'src/agents/release-governor.js', 'src/agents/governance.js', 'src/agents/matching-review.js',
    'tools/deploy-agent.mjs', 'tools/release-governor-check.mjs', 'executor.sh',
    'docs/agentes.md', 'docs/release-governor.md', 'docs/MAPA-DE-AGENTES.md',
    'docs/ROADMAP-OPERACIONAL.md', 'docs/protecao-main.md',
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
  assert.deepEqual(good.allowedActions, [RELEASE_ACTION.MERGE]);
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
  assert.deepEqual(good.allowedActions, [RELEASE_ACTION.MERGE]);

  const noRegression = evaluateRelease({
    changedPaths: ['api/v1.mjs'],
    evidence: evidence({ checks: evidence().checks.filter((x) => x.name !== 'regression') }),
  });
  assert.equal(noRegression.decision, 'blocked');
  assert.ok(noRegression.missingEvidence.some((x) => x.includes('check "regression" ausente')));

  const noGolden = evaluateRelease({
    changedPaths: ['api/v1.mjs'],
    evidence: evidence({ checks: evidence().checks.filter((x) => x.name !== 'golden') }),
  });
  assert.equal(noGolden.decision, 'blocked');
  assert.ok(noGolden.missingEvidence.some((x) => x.includes('check "golden" ausente')));

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

const predeployEvidence = (overrides = {}) => ({
  merged: true,
  baseRef: 'main',
  headRef: 'main',
  targetRef: 'main',
  headSha: SHA,
  mainSha: SHA,
  deployment: {
    provider: 'vercel',
    target: 'preview',
    status: 'ready',
    sha: SHA,
    url: 'https://tcg-price-hunter.vercel.app',
  },
  checks: [
    check('test'), check('preview-smoke'), check('accessibility'),
    check('regression'), check('golden'),
  ],
  rollback: { documented: true, tested: true },
  rollout: { metricsDefined: true, rollbackTriggersDefined: true },
  featureFlag: { applicable: false, reason: 'nenhuma flag nova nesta alteração' },
  ...overrides,
});

const productionEvidence = (overrides = {}) => ({
  ...predeployEvidence(),
  deployment: {
    provider: 'vercel',
    target: 'production',
    status: 'ready',
    sha: SHA,
    url: 'https://tcg-price-hunter.vercel.app',
  },
  checks: [check('test'), check('smoke'), check('accessibility'), check('regression'), check('golden')],
  ...overrides,
});

test('merge não autoriza deploy implicitamente', () => {
  const r = evaluateRelease({ changedPaths: ['assets/home.css'], evidence: evidence() });
  assert.equal(r.decision, 'autonomous');
  assert.deepEqual(r.allowedActions, [RELEASE_ACTION.MERGE]);
  assert.equal(r.deploymentRequired, true);
});

test('deploy R1 exige main integrada, Preview READY, preview-smoke e a11y no SHA exato', () => {
  const good = evaluateRelease({
    changedPaths: ['assets/home.css'],
    evidence: predeployEvidence(),
    action: RELEASE_ACTION.DEPLOY,
  });
  assert.equal(good.decision, 'autonomous');
  assert.deepEqual(good.allowedActions, [RELEASE_ACTION.DEPLOY]);

  const notMerged = evaluateRelease({
    changedPaths: ['assets/home.css'],
    evidence: predeployEvidence({ merged: false }),
    action: RELEASE_ACTION.DEPLOY,
  });
  assert.equal(notMerged.decision, 'blocked');
  assert.ok(notMerged.missingEvidence.some((x) => x.includes('merge confirmado')));

  const staleMain = evaluateRelease({
    changedPaths: ['assets/home.css'],
    evidence: predeployEvidence({ mainSha: 'b'.repeat(40) }),
    action: RELEASE_ACTION.DEPLOY,
  });
  assert.equal(staleMain.decision, 'blocked');
  assert.ok(staleMain.missingEvidence.some((x) => x.includes('SHA atual verificado')));

  const building = evaluateRelease({
    changedPaths: ['assets/home.css'],
    evidence: predeployEvidence({ deployment: { ...predeployEvidence().deployment, status: 'building' } }),
    action: RELEASE_ACTION.DEPLOY,
  });
  assert.equal(building.decision, 'blocked');
  assert.ok(building.missingEvidence.some((x) => x.includes('READY')));

  const staleSmoke = evaluateRelease({
    changedPaths: ['assets/home.css'],
    evidence: predeployEvidence({ checks: [check('test'), check('preview-smoke', 'success', 'b'.repeat(40)), check('accessibility')] }),
    action: RELEASE_ACTION.DEPLOY,
  });
  assert.equal(staleSmoke.decision, 'blocked');
  assert.ok(staleSmoke.missingEvidence.some((x) => x.includes('preview-smoke') && x.includes('HEAD atual')));
});

test('autorização de deploy R2 exige regressão, golden, rollback testado e rollout seguro', () => {
  const good = evaluateRelease({
    changedPaths: ['api/v1.mjs'],
    evidence: predeployEvidence(),
    action: RELEASE_ACTION.DEPLOY,
  });
  assert.equal(good.decision, 'autonomous');
  assert.deepEqual(good.allowedActions, [RELEASE_ACTION.DEPLOY]);

  const noRollback = evaluateRelease({
    changedPaths: ['api/v1.mjs'],
    evidence: predeployEvidence({ rollback: { documented: true, tested: false } }),
    action: RELEASE_ACTION.DEPLOY,
  });
  assert.equal(noRollback.decision, 'blocked');
  assert.ok(noRollback.missingEvidence.some((x) => x.includes('rollback')));

  const unsafeFlag = evaluateRelease({
    changedPaths: ['api/v1.mjs'],
    evidence: predeployEvidence({ featureFlag: { applicable: true, present: true, defaultOff: false } }),
    action: RELEASE_ACTION.DEPLOY,
  });
  assert.equal(unsafeFlag.decision, 'blocked');
  assert.ok(unsafeFlag.missingEvidence.some((x) => x.includes('feature flag')));
});

test('verificação pós-deploy só autoriza deploy.verify com produção READY e smoke no SHA exato', () => {
  const good = evaluateRelease({
    changedPaths: ['assets/home.css'],
    evidence: productionEvidence(),
    action: RELEASE_ACTION.VERIFY_DEPLOY,
  });
  assert.equal(good.decision, 'autonomous');
  assert.deepEqual(good.allowedActions, [RELEASE_ACTION.VERIFY_DEPLOY]);

  const wrongTarget = evaluateRelease({
    changedPaths: ['assets/home.css'],
    evidence: predeployEvidence(),
    action: RELEASE_ACTION.VERIFY_DEPLOY,
  });
  assert.equal(wrongTarget.decision, 'blocked');
  assert.ok(wrongTarget.missingEvidence.some((x) => x.includes('production READY')));

  const badSmoke = evaluateRelease({
    changedPaths: ['assets/home.css'],
    evidence: productionEvidence({ checks: [check('test'), check('smoke', 'failure'), check('accessibility')] }),
    action: RELEASE_ACTION.VERIFY_DEPLOY,
  });
  assert.equal(badSmoke.decision, 'blocked');
  assert.ok(badSmoke.missingEvidence.some((x) => x.includes('smoke')));
});

test('docs-only não pode iniciar deploy e ação desconhecida é recusada', () => {
  const docs = evaluateRelease({
    changedPaths: ['docs/release.md'],
    evidence: predeployEvidence(),
    action: RELEASE_ACTION.DEPLOY,
  });
  assert.equal(docs.decision, 'blocked');
  assert.ok(docs.missingEvidence.some((x) => x.includes('não inclui artefatos')));

  const unknown = evaluateRelease({
    changedPaths: ['docs/release.md'],
    evidence: evidence(),
    action: 'pr.production',
  });
  assert.equal(unknown.decision, 'blocked');
  assert.equal(unknown.requiresHuman, true);
  assert.deepEqual(unknown.allowedActions, []);
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


await testAsync('decisão autônoma é registrada antes de ser devolvida, com action e SHA explícitos', async () => {
  const rows = [];
  const result = await evaluateAndRecordRelease({
    changedPaths: ['docs/release.md'], evidence: evidence(), action: RELEASE_ACTION.MERGE,
    actor: 'executor', source: 'local-cli', now: new Date('2026-10-11T12:00:00Z'),
    auditSink: async (event) => { rows.push(event); },
  });
  assert.equal(result.decision.decision, 'autonomous');
  assert.equal(rows.length, 1);
  assert.equal(result.audit.eventId, rows[0].eventId);
  assert.equal(result.audit.authorized, true);
  assert.equal(result.audit.action, RELEASE_ACTION.MERGE);
  assert.equal(result.audit.headSha, SHA);
  assert.equal(result.audit.occurredAt, '2026-10-11T12:00:00.000Z');
  assert.equal(result.audit.policyVersion, '1.0.0');
  assert.equal(Object.isFrozen(result.audit), true);
  assert.equal(Object.isFrozen(result.audit.checks), true);
});

await testAsync('auditoria persiste a decisão bloqueada sem convertê-la em autorização', async () => {
  const rows = [];
  const result = await evaluateAndRecordRelease({
    changedPaths: ['docs/release.md'], evidence: evidence({ checks: [check('ci', 'failure'), check('tests')] }),
    action: RELEASE_ACTION.MERGE, auditSink: async (event) => rows.push(event),
  });
  assert.equal(result.decision.decision, 'blocked');
  assert.equal(result.audit.decision, 'blocked');
  assert.equal(result.audit.authorized, false);
  assert.deepEqual(result.audit.allowedActions, []);
  assert.equal(rows.length, 1);
});

await testAsync('eventos de merge e deploy têm permissões separadas', async () => {
  const merge = buildReleaseAuditEvent({
    decision: evaluateRelease({ changedPaths: ['assets/home.css'], evidence: evidence(), action: RELEASE_ACTION.MERGE }),
    changedPaths: ['assets/home.css'], evidence: evidence(),
  });
  const deployEvidence = predeployEvidence();
  const deploy = buildReleaseAuditEvent({
    decision: evaluateRelease({ changedPaths: ['assets/home.css'], evidence: deployEvidence, action: RELEASE_ACTION.DEPLOY }),
    changedPaths: ['assets/home.css'], evidence: deployEvidence,
  });
  assert.deepEqual(merge.allowedActions, [RELEASE_ACTION.MERGE]);
  assert.deepEqual(deploy.allowedActions, [RELEASE_ACTION.DEPLOY]);
  assert.equal(merge.authorized, true);
  assert.equal(deploy.authorized, true);
  assert.notEqual(merge.eventId, deploy.eventId);
});

test('auditoria rejeita decisão adulterada que autoriza ações extras', () => {
  const changedPaths = ['docs/release.md'];
  const evidenceInput = evidence();
  const valid = evaluateRelease({ changedPaths, evidence: evidenceInput, action: RELEASE_ACTION.MERGE });
  assert.throws(() => buildReleaseAuditEvent({
    decision: { ...valid, allowedActions: [RELEASE_ACTION.MERGE, RELEASE_ACTION.DEPLOY] },
    changedPaths, evidence: evidenceInput,
  }), /ações autorizadas divergem/);
  assert.throws(() => buildReleaseAuditEvent({
    decision: { ...valid, allowedActions: ['unknown.action'] },
    changedPaths, evidence: evidenceInput,
  }), /lista de ações autorizadas ausente ou inválida/);
  assert.throws(() => buildReleaseAuditEvent({
    decision: { ...valid, decision: 'blocked', allowedActions: [RELEASE_ACTION.MERGE] },
    changedPaths, evidence: evidenceInput,
  }), /ações autorizadas divergem/);
});

test('auditoria rejeita risco ou SHA incompatível com evidência', () => {
  const validDecision = evaluateRelease({ changedPaths: ['docs/release.md'], evidence: evidence() });
  assert.throws(() => buildReleaseAuditEvent({
    decision: { ...validDecision, risk: RISK.R3 },
    changedPaths: ['docs/release.md'], evidence: evidence(),
  }), /risco da decisão diverge/);
  assert.throws(() => buildReleaseAuditEvent({
    decision: validDecision, changedPaths: ['docs/release.md'], evidence: evidence({ headSha: 'b'.repeat(40) }),
  }), /SHA da decisão diverge/);
});

await testAsync('sem sink de auditoria ou com sink falhando, nenhuma decisão é devolvida como utilizável', async () => {
  await assert.rejects(evaluateAndRecordRelease({
    changedPaths: ['docs/release.md'], evidence: evidence(),
  }), /auditSink obrigatório/);
  await assert.rejects(evaluateAndRecordRelease({
    changedPaths: ['docs/release.md'], evidence: evidence(),
    auditSink: async () => { throw new Error('disk unavailable'); },
  }), /disk unavailable/);
});

test('evento não copia evidência bruta nem divulga tokens', () => {
  const secret = 'ghp_' + 'a'.repeat(32);
  const ev = evidence({ accessToken: secret, debug: { authorization: 'Bearer very-secret-value' } });
  const decision = evaluateRelease({ changedPaths: ['docs/readme.md'], evidence: ev });
  const event = buildReleaseAuditEvent({
    decision, changedPaths: ['docs/readme.md'], evidence: ev,
    actor: secret, source: 'test',
  });
  const serialized = JSON.stringify(event);
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes('very-secret-value'), false);
  assert.equal(event.checks.length, ev.checks.length);
  assert.equal(event.headSha, SHA);
});

test('event ID é determinístico para a mesma decisão e timestamp', () => {
  const d = evaluateRelease({ changedPaths: ['docs/release.md'], evidence: evidence() });
  const args = {
    decision: d, changedPaths: ['docs/release.md'], evidence: evidence(),
    actor: 'executor', source: 'test', now: new Date('2026-10-11T12:00:00Z'),
  };
  assert.equal(buildReleaseAuditEvent(args).eventId, buildReleaseAuditEvent(args).eventId);
});


console.log(`✓ Release Governor (política determinística): ${passed} grupos de testes passaram`);
