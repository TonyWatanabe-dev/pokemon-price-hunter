// Governança de agentes: o que cada ação pode fazer, quem aprova e o que fica registrado.
// Só descreve e verifica políticas; não concede acesso nem executa nada. Os agentes reais
// continuam sendo os do Orchestrator (docs/agentes.md) e o executor local (docs/executor.md).
// Aprovação humana de revisão (REVIEW_OPERATORS / review.decide) segue em src/core/review.js.

export const CLASSES = Object.freeze({
  READ: 'read',                   // leitura: sempre permitida, inclusive em modo read-only
  BRANCH_PR: 'branch_pr',         // alteração em branch/PR: bloqueada em read-only
  NEEDS_APPROVAL: 'needs_approval', // exige aprovação humana explícita, válida só para aquela ação
  FORBIDDEN: 'forbidden',         // nunca, sem aprovação humana específica
});

// Ações conhecidas. Ação desconhecida é negada (padrão fechado).
export const ACTIONS = Object.freeze({
  'repo.read': CLASSES.READ,
  'db.read': CLASSES.READ,
  'branch.write': CLASSES.BRANCH_PR,
  'pr.open': CLASSES.BRANCH_PR,
  'review.propose': CLASSES.BRANCH_PR,
  'pr.merge': CLASSES.NEEDS_APPROVAL,
  'deploy': CLASSES.NEEDS_APPROVAL,
  'db.migrate.production': CLASSES.NEEDS_APPROVAL,
  'secrets.access': CLASSES.NEEDS_APPROVAL,
  'notify.real': CLASSES.NEEDS_APPROVAL,
  'main.push': CLASSES.FORBIDDEN,
  'git.force': CLASSES.FORBIDDEN,
  'db.write.production': CLASSES.FORBIDDEN,
});

/**
 * Decide se uma ação pode seguir. Não executa nada.
 * @param {string} action
 * @param {{ readOnly?: boolean, grants?: string[], approval?: { action: string, by: string } | null }} ctx
 *   grants: ações que o agente realmente recebeu (ausente = nenhuma permissão).
 *   approval: aprovação humana, vale só para a ação nomeada.
 */
export function authorize(action, { readOnly = false, grants = [], approval = null } = {}) {
  const cls = ACTIONS[action];
  if (!cls) return deny(action, 'unknown_action');
  if (cls === CLASSES.FORBIDDEN) return deny(action, 'forbidden');
  if (readOnly && cls !== CLASSES.READ) return deny(action, 'read_only');
  if (!grants.includes(action)) return deny(action, 'missing_permission');
  if (cls === CLASSES.NEEDS_APPROVAL) {
    if (!approval || approval.action !== action || !approval.by) return deny(action, 'approval_required');
  }
  return { allowed: true, action, class: cls, reason: 'ok' };
}

const deny = (action, reason) => ({ allowed: false, action, class: ACTIONS[action] ?? null, reason });

// Remove segredos óbvios antes de registrar: valores de chaves sensíveis e tokens conhecidos.
const SENSITIVE_KEY = /(token|secret|senha|password|passwd|api[-_]?key|authorization|cookie|credential|database_url|private)/i;
const TOKEN_LIKE = /(gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|postgres(?:ql)?:\/\/\S+|Bearer\s+\S+)/g;

export function redact(value, depth = 0) {
  if (depth > 4) return '[…]';
  if (typeof value === 'string') return value.replace(TOKEN_LIKE, '[redigido]').slice(0, 300);
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = SENSITIVE_KEY.test(k) ? '[redigido]' : redact(v, depth + 1);
    return out;
  }
  return value;
}

/**
 * Registro de auditoria: ferramenta, objetivo, resultado e falha, sem segredos.
 * `sink(entry)` é quem grava (ex.: system_event); aqui só se monta a entrada.
 */
export function createAuditLog({ sink, now = () => new Date() } = {}) {
  if (typeof sink !== 'function') throw new Error('sink obrigatório');
  return async function record({ tool, goal, result, error = null, detail = null }) {
    if (!tool || !goal) throw new Error('tool e goal obrigatórios');
    const entry = {
      at: now().toISOString(),
      tool: String(tool).slice(0, 80),
      goal: redact(String(goal)),
      result: result === 'ok' ? 'ok' : result === 'denied' ? 'denied' : 'failed',
      error: error ? redact(String(error?.message ?? error)) : null,
      detail: detail ? redact(detail) : null,
    };
    await sink(entry);
    return entry;
  };
}

/** Executa `fn` só se autorizado; registra sempre (negado, ok ou falha). */
export async function guarded(action, ctx, audit, goal, fn) {
  const decision = authorize(action, ctx);
  if (!decision.allowed) {
    await audit({ tool: action, goal, result: 'denied', detail: { reason: decision.reason } });
    return { ok: false, denied: true, reason: decision.reason };
  }
  try {
    const value = await fn();
    await audit({ tool: action, goal, result: 'ok' });
    return { ok: true, value };
  } catch (e) {
    await audit({ tool: action, goal, result: 'failed', error: e });
    return { ok: false, denied: false, reason: 'failed' };
  }
}
