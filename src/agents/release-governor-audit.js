// Build structured, minimal audit events for Release Governor decisions.
// Persistence is injected by the caller. If persistence fails, evaluation does not return success.
import { createHash } from 'node:crypto';
import { classifyReleaseRisk, evaluateRelease, POLICY_VERSION, RELEASE_ACTION } from './release-governor.js';

const SHA_RE = /^[a-f0-9]{40}$/i;
const ACTIONS = new Set(Object.values(RELEASE_ACTION));
const TOKEN_LIKE = /(gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|postgres(?:ql)?:\/\/\S+|Bearer\s+\S+)/gi;
const SAFE_CHECK_STATES = new Set([
  'success', 'failure', 'cancelled', 'queued', 'in_progress', 'neutral',
  'skipped', 'action_required', 'timed_out', 'stale', 'blocked', 'missing',
]);

function text(value, max = 160, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const clean = value.replace(/[\r\n\t]/g, ' ').replace(TOKEN_LIKE, '[redigido]').trim();
  return clean ? clean.slice(0, max) : fallback;
}

function listOfText(value, maxItems = 50, maxLength = 240) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxItems).map((v) => text(v, maxLength)).filter(Boolean);
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeDeep(child);
  }
  return value;
}

function normalizedChecks(checks) {
  if (!Array.isArray(checks)) return [];
  return checks.slice(0, 100).map((row) => {
    const rawStatus = text(row?.status, 40, 'missing').toLowerCase();
    return {
      name: text(row?.name, 100, 'unnamed-check'),
      status: SAFE_CHECK_STATES.has(rawStatus) ? rawStatus : 'unknown',
      sha: typeof row?.sha === 'string' && SHA_RE.test(row.sha) ? row.sha.toLowerCase() : null,
    };
  });
}

/**
 * Create a deterministic, bounded audit event from a Governor decision.
 * Raw evidence objects, deployment URLs, logs, and arbitrary agent prose are never copied.
 */
export function buildReleaseAuditEvent({
  decision, changedPaths, evidence = {}, actor = 'release-governor',
  source = 'unspecified', now = new Date(),
} = {}) {
  if (!decision || typeof decision !== 'object') throw new Error('decisão do Release Governor ausente');
  if (!ACTIONS.has(decision.action)) throw new Error('ação de release inválida no evento de auditoria');
  if (!['autonomous', 'blocked', 'human_required'].includes(decision.decision)) {
    throw new Error('resultado do Release Governor inválido');
  }
  const classified = classifyReleaseRisk(changedPaths);
  if (decision.risk !== classified.risk) throw new Error('risco da decisão diverge da reclassificação dos arquivos');
  if (!Array.isArray(decision.allowedActions) ||
      decision.allowedActions.some((action) => !ACTIONS.has(action))) {
    throw new Error('lista de ações autorizadas ausente ou inválida');
  }
  const expectedAuthorized = decision.decision === 'autonomous' &&
    decision.allowedActions.length === 1 && decision.allowedActions[0] === decision.action;
  if ((decision.decision === 'autonomous' && !expectedAuthorized) ||
      (decision.decision !== 'autonomous' && decision.allowedActions.length !== 0)) {
    throw new Error('ações autorizadas divergem da decisão do Release Governor');
  }
  const evidenceSha = typeof evidence.headSha === 'string' && SHA_RE.test(evidence.headSha)
    ? evidence.headSha.toLowerCase() : null;
  const decisionSha = typeof decision.headSha === 'string' && SHA_RE.test(decision.headSha)
    ? decision.headSha.toLowerCase() : null;
  if (decisionSha !== evidenceSha) throw new Error('SHA da decisão diverge da evidência');
  const occurredAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  const base = {
    schemaVersion: 1,
    occurredAt,
    component: 'release-governor',
    policyVersion: text(decision.policyVersion, 40, POLICY_VERSION),
    actor: text(actor, 100, 'unknown'),
    source: text(source, 100, 'unspecified'),
    action: decision.action,
    risk: classified.risk,
    decision: decision.decision,
    authorized: expectedAuthorized,
    allowedActions: [...decision.allowedActions],
    headSha: evidenceSha,
    changedPaths: classified.paths.slice(0, 100).map((p) => text(p, 300)),
    checks: normalizedChecks(evidence.checks),
    classificationReasons: listOfText(decision.classificationReasons, 20, 300),
    missingEvidence: listOfText(decision.missingEvidence, 50, 300),
  };
  base.eventId = createHash('sha256').update(JSON.stringify(base)).digest('hex');
  return freezeDeep(base);
}

/**
 * Evaluate one explicit action, persist the decision event, then return the decision.
 * A throwing/rejected sink aborts the function so callers cannot mistake an unaudited
 * decision for an executable authorization.
 */
export async function evaluateAndRecordRelease({
  changedPaths, evidence = {}, action = RELEASE_ACTION.MERGE,
  actor = 'release-governor', source = 'unspecified',
  now = new Date(), auditSink,
} = {}) {
  if (typeof auditSink !== 'function') throw new Error('auditSink obrigatório; sem auditoria não há decisão utilizável');
  const decision = evaluateRelease({ changedPaths, evidence, action });
  const event = buildReleaseAuditEvent({ decision, changedPaths, evidence, actor, source, now });
  await auditSink(event);
  return { decision, audit: event };
}
