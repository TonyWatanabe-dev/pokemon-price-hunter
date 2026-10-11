// Release Governor — avaliador determinístico de risco e evidências.
// Esta primeira versão decide política; NÃO chama GitHub, Git, Vercel nem executa ações.
// A integração que efetivamente realiza merge/deploy deve buscar evidências confiáveis,
// reavaliar o SHA imediatamente antes da ação e registrar o resultado em auditoria.

export const RISK = Object.freeze({ R0: 'R0', R1: 'R1', R2: 'R2', R3: 'R3' });
export const RELEASE_ACTION = Object.freeze({ MERGE: 'pr.merge', DEPLOY: 'deploy' });
export const POLICY_VERSION = '1.0.0';

const shaPattern = /^[a-f0-9]{40}$/i;

const CRITICAL_PATHS = [
  /^\.github\/workflows\//i,
  /^db\//i,
  /^firebase\//i,
  /^config\//i,
  /^data\//i,
  /^src\/db(?:\/|\.|$)/i,
  /^src\/(?:run|score|copag-policy)(?:\/|\.|$)/i,
  /^src\/core\/review(?:\/|\.|$)/i,
  /^src\/core\/(?:price-engine|opportunity-engine|price-stats|references|reference-import|mappers|taxonomy)(?:\/|\.|$)/i,
  /^src\/(?:copag-check|discover)(?:\/|\.|$)/i,
  /^src\/agents\/(?:governance|release-governor|orchestrator|stores|cycle|notify)(?:\/|\.|$)/i,
  /^api\/_lib\/(?:catalog|copag-policy|db|offer-rank|read-db|read-state|references|ssl|shipping-calc)(?:\/|\.|$)/i,
  /^(?:account\.js|tools\/account\.src\.js|package\.json|package-lock\.json|vercel\.json|\.vercelignore)$/i,
  /^tools\/(?:data-restore|data-backup|db-|push-data|push-config|ml-token|review)(?:\/|\.|$)/i,
  /(^|\/)(?:auth|authorization|secret|secrets)(\/|\.|$)/i,
  /^(?:CLAUDE\.md|AGENTS\.md|CODEOWNERS)$/i,
];

const DOCUMENTATION_ONLY = (p) =>
  p.startsWith('docs/') || /(?:^|\/)[^/]+\.(?:md|txt)$/i.test(p);

const TEST_FILE = (p) => p.startsWith('test/') || p.startsWith('tests/');

const UI_ONLY = (p) => /\.(?:css|svg|png|jpe?g|webp|woff2?)$/i.test(p);

const RECOGNIZED_RUNTIME = (p) =>
  p.startsWith('api/') || p.startsWith('src/') || p.startsWith('tools/') ||
  p.startsWith('public/') || p.startsWith('assets/') || p.startsWith('images/') ||
  p.startsWith('logos/') || p === 'index.html' || p === 'account.js' ||
  TEST_FILE(p);

function normalizePath(input) {
  if (typeof input !== 'string' || !input.trim()) return null;
  let p = input.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (p.startsWith('/') || /^[a-z]:\//i.test(p) || p.split('/').some((part) => part === '..')) return null;
  p = p.replace(/\/+/g, '/');
  return p || null;
}

/**
 * Classifica os arquivos alterados. Nunca confia em um riskLevel declarado pelo agente.
 * Um arquivo crítico/unclassificável eleva a mudança a R3; vale sempre o maior risco.
 */
export function classifyReleaseRisk(changedPaths) {
  if (!Array.isArray(changedPaths) || changedPaths.length === 0) {
    return { risk: RISK.R3, reasons: ['escopo ausente: lista de arquivos alterados vazia ou inválida'], paths: [] };
  }

  const paths = changedPaths.map(normalizePath);
  if (paths.some((p) => !p)) {
    return { risk: RISK.R3, reasons: ['há caminho inválido, absoluto ou com traversal; classificação recusada'], paths: [] };
  }

  const critical = paths.filter((p) => CRITICAL_PATHS.some((pattern) => pattern.test(p)));
  if (critical.length) {
    return {
      risk: RISK.R3,
      reasons: ['arquivos com impacto crítico exigem avaliação humana: ' + critical.join(', ')],
      paths,
    };
  }

  if (paths.every(DOCUMENTATION_ONLY)) {
    return { risk: RISK.R0, reasons: ['alteração limitada a documentação e/ou testes'], paths };
  }

  if (paths.every((p) => UI_ONLY(p) || DOCUMENTATION_ONLY(p))) {
    return { risk: RISK.R1, reasons: ['alteração visual isolada, sem arquivos críticos ou de domínio'], paths };
  }

  if (paths.some(RECOGNIZED_RUNTIME) && paths.every((p) => RECOGNIZED_RUNTIME(p) || DOCUMENTATION_ONLY(p))) {
    return { risk: RISK.R2, reasons: ['alteração funcional ou de runtime; exige gates de regressão, rollout e rollback'], paths };
  }

  const unknown = paths.filter((p) => !RECOGNIZED_RUNTIME(p) && !DOCUMENTATION_ONLY(p));
  return {
    risk: RISK.R3,
    reasons: ['caminho fora da taxonomia conhecida; evidência insuficiente: ' + unknown.join(', ')],
    paths,
  };
}

function checkMap(checks, headSha, missing) {
  if (!Array.isArray(checks)) {
    missing.push('checks: lista de verificações ausente');
    return new Map();
  }
  const map = new Map();
  for (const check of checks) {
    if (!check || typeof check.name !== 'string' || !check.name.trim()) continue;
    const name = check.name.trim().toLowerCase();
    if (map.has(name)) {
      map.set(name, { duplicate: true });
      continue;
    }
    map.set(name, check);
  }
  return map;
}

function requireCheck(map, name, headSha, missing, aliases = []) {
  // Compatibilidade com o CI atual do repositório: o job "test" executa npm test completo.
  // Check explícito com o nome principal sempre prevalece; alias só é usado se o principal não existe.
  const selectedName = map.has(name) ? name : aliases.find((alias) => map.has(alias)) ?? name;
  const check = map.get(selectedName);
  if (!check) {
    missing.push(`check "${name}"${aliases.length ? ` (ou ${aliases.join(', ')})` : ''} ausente`);
    return false;
  }
  if (check.duplicate) {
    missing.push(`check "${selectedName}" duplicado/ambíguo`);
    return false;
  }
  if (check.status !== 'success') {
    missing.push(`check "${selectedName}" não está success (status=${String(check.status ?? 'ausente')})`);
    return false;
  }
  if (typeof check.sha !== 'string' || check.sha.toLowerCase() !== headSha.toLowerCase()) {
    missing.push(`check "${selectedName}" não comprova o HEAD atual`);
    return false;
  }
  return true;
}
function evidenceGaps(risk, evidence = {}) {
  const missing = [];
  const headSha = typeof evidence.headSha === 'string' ? evidence.headSha : '';
  if (!shaPattern.test(headSha)) missing.push('headSha válido (40 caracteres hexadecimais) ausente');
  if (evidence.baseRef !== 'main') missing.push('baseRef deve ser main');
  if (typeof evidence.headRef !== 'string' || !evidence.headRef.trim() || evidence.headRef === 'main') {
    missing.push('headRef isolada e diferente de main ausente');
  }
  if (evidence.conflictFree !== true) missing.push('ausência de conflitos não comprovada');

  const map = checkMap(evidence.checks, headSha, missing);
  requireCheck(map, 'ci', headSha, missing, ['test']);
  requireCheck(map, 'tests', headSha, missing, ['test']);

  if (risk === RISK.R1) {
    requireCheck(map, 'preview', headSha, missing);
    requireCheck(map, 'accessibility', headSha, missing);
  }

  if (risk === RISK.R2) {
    requireCheck(map, 'regression', headSha, missing, ['test']);
    requireCheck(map, 'golden', headSha, missing, ['test']);
    if (evidence.rollback?.documented !== true) missing.push('plano de rollback documentado ausente');
    if (evidence.rollback?.tested !== true) missing.push('rollback testado/reproduzível ausente');
    if (evidence.rollout?.metricsDefined !== true) missing.push('métricas de rollout ausentes');
    if (evidence.rollout?.rollbackTriggersDefined !== true) missing.push('gatilhos explícitos de rollback ausentes');

    const flag = evidence.featureFlag;
    if (!flag || typeof flag.applicable !== 'boolean') {
      missing.push('aplicabilidade de feature flag não declarada');
    } else if (flag.applicable && (flag.present !== true || flag.defaultOff !== true)) {
      missing.push('feature flag deve existir e ficar desligada por padrão para rollout R2');
    } else if (!flag.applicable && (typeof flag.reason !== 'string' || !flag.reason.trim())) {
      missing.push('justificativa da ausência de feature flag ausente');
    }
  }

  return missing;
}

function requiresDeploy(paths) {
  return paths.some((p) =>
    p.startsWith('api/') || p.startsWith('src/') || p.startsWith('tools/') ||
    p.startsWith('public/') || p.startsWith('assets/') || p.startsWith('images/') ||
    p.startsWith('logos/') || p === 'index.html' || p === 'account.js' ||
    p === 'vercel.json' || p === '.vercelignore' ||
    p === 'package.json' || p === 'package-lock.json'
  );
}

/**
 * Avalia uma release sem executar efeitos colaterais.
 * Evidências devem vir de fontes confiáveis e apontar exatamente para evidence.headSha.
 * R3 nunca é autorizado pelo governor; é escalonado para pessoa responsável.
 */
export function evaluateRelease({ changedPaths, evidence = {} } = {}) {
  const classified = classifyReleaseRisk(changedPaths);
  const deploymentRequired = requiresDeploy(classified.paths);
  const base = {
    policyVersion: POLICY_VERSION,
    risk: classified.risk,
    classificationReasons: classified.reasons,
    headSha: typeof evidence.headSha === 'string' && shaPattern.test(evidence.headSha) ? evidence.headSha : null,
    deploymentRequired,
    allowedActions: [],
    missingEvidence: [],
    requiresHuman: classified.risk === RISK.R3,
    decision: classified.risk === RISK.R3 ? 'human_required' : 'blocked',
  };

  if (classified.risk === RISK.R3) {
    return { ...base, missingEvidence: ['classificação crítica ou incerta; Release Governor não pode autoautorizar R3'] };
  }

  const missing = evidenceGaps(classified.risk, evidence);
  if (missing.length) return { ...base, missingEvidence: missing };

  const allowedActions = [RELEASE_ACTION.MERGE];
  if (deploymentRequired) allowedActions.push(RELEASE_ACTION.DEPLOY);
  return {
    ...base,
    allowedActions,
    missingEvidence: [],
    requiresHuman: false,
    decision: 'autonomous',
    classificationReasons: [
      ...classified.reasons,
      `gates exigidos para ${classified.risk} comprovados no HEAD ${evidence.headSha}`,
    ],
  };
}
