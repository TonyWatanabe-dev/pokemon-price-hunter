// Dispatcher determinístico das tarefas paralelas (docs/PLANO-ENTREGA-TURBO.md §3.2, issue #234).
// Decide QUAIS issues aprovadas podem ir para o worker agora; não executa nada, não chama modelo e não
// concede permissão. O disparo em si (workflow_dispatch autenticado do tarefas.yml) fica num passo separado.
//
// Regras fixas (padrão fechado: sem evidência, não despacha):
// - Só issue aberta, criada por operador e com o label de aprovação aplicado por operador.
// - Nunca despacha issue com tarefa em curso, na fila do worker, com PR aberta ou em quarentena.
// - Dependências ("Depende de: #n") precisam estar fechadas.
// - Duas tarefas que declaram o mesmo caminho crítico ("Arquivos:") não rodam ao mesmo tempo.
// - Respeita o número de vagas livres; o resto espera (fila), sem descartar.
// - Falha repetida: backoff exponencial entre tentativas e quarentena depois do limite.
// - A chave de idempotência (issue + tentativa) impede despachar duas vezes a mesma tentativa.

export const APPROVAL_LABEL = 'tarefa:aprovada';
export const QUARANTINE_LABEL = 'tarefa:quarentena';
export const BLOCKED_LABEL = 'rotina:bloqueada';
const IN_FLIGHT_LABELS = new Set(['executor:github', 'executor:running']);

export const DEFAULTS = Object.freeze({
  maxSlots: 3,               // TAREFAS_MAX padrão do workflow
  maxAttempts: 3,            // depois disso, quarentena
  backoffBaseMs: 30 * 60_000, // 30 min, 60 min, 120 min...
  backoffMaxMs: 6 * 3_600_000,
});

// Caminhos que nunca podem ser alterados por duas tarefas ao mesmo tempo (mesma lista do Governor, resumida
// aos diretórios/arquivos de alto conflito). Caminho declarado fora desta lista não serializa.
const CRITICAL = [/^\.github\/workflows\//, /^src\/agents\//, /^src\/db\//, /^db\//, /^api\/_lib\//, /^src\/core\//,
  /^index\.html$/, /^api\/v1\.mjs$/, /^package(-lock)?\.json$/, /^vercel\.json$/, /^CLAUDE\.md$/, /^docs\/ROADMAP-OPERACIONAL\.md$/];
const isCritical = (p) => CRITICAL.some((re) => re.test(p));

/** Lê a ficha da tarefa no corpo da issue: Ordem, Depende de, Arquivos. Campos ausentes ficam vazios. */
export function parseTask(issue) {
  const body = String(issue?.body || '');
  const line = (k) => (body.match(new RegExp(`^\\s*${k}\\s*:\\s*(.+)$`, 'im')) || [])[1] || '';
  const order = Number.parseInt(line('Ordem'), 10);
  const deps = [...line('Depende de').matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
  const files = line('Arquivos').split(/[,\s]+/).map((s) => s.replace(/^`|`$/g, '').trim()).filter(Boolean);
  return {
    n: issue.number, title: issue.title, author: issue.user?.login || issue.author || null,
    labels: (issue.labels || []).map((l) => (typeof l === 'string' ? l : l.name)),
    order: Number.isFinite(order) ? order : Number.MAX_SAFE_INTEGER, deps, files, open: issue.state === 'open',
  };
}

/** Atraso exigido antes da próxima tentativa, a partir do número de falhas já registradas. */
export function backoffMs(failures, cfg = DEFAULTS) {
  if (failures <= 0) return 0;
  return Math.min(cfg.backoffMaxMs, cfg.backoffBaseMs * 2 ** (failures - 1));
}

export const idempotencyKey = (n, attempt) => `dispatch:issue-${n}:attempt-${attempt}`;

/**
 * Planeja um ciclo. Entrada só com dados lidos do GitHub (nada é inferido):
 *  issues: issues abertas candidatas (com body, labels, user)
 *  approvals: Map<issue, login que aplicou o label de aprovação> (eventos "labeled")
 *  closedIssues: Set<number> das dependências já fechadas
 *  openPrIssues: Set<number> das issues que já têm PR aberta (Closes/Refs #n ou branch da tarefa)
 *  history: Map<issue, { failures, lastFailureAt, dispatchedKeys:Set }>
 *  operators: logins autorizados; maxSlots: vagas totais; now: Date
 * Saída: { dispatch:[{n,attempt,key}], skipped:[{n,reason}], waiting:[n], quarantine:[n], freeSlots }
 */
export function planDispatch({ issues = [], approvals = new Map(), closedIssues = new Set(), openPrIssues = new Set(),
  history = new Map(), operators = [], maxSlots = DEFAULTS.maxSlots, now = new Date(), cfg = DEFAULTS } = {}) {
  const ops = new Set(operators.map((o) => String(o).toLowerCase()));
  const tasks = issues.map(parseTask);
  const out = { dispatch: [], skipped: [], waiting: [], quarantine: [], freeSlots: 0 };
  const skip = (n, reason) => out.skipped.push({ n, reason });

  // Vagas: tarefas já na fila/execução do worker ocupam vaga; arquivos críticos delas ficam reservados.
  const inFlight = tasks.filter((t) => t.labels.some((l) => IN_FLIGHT_LABELS.has(l)));
  const reserved = new Set(inFlight.flatMap((t) => t.files.filter(isCritical)));
  let free = Math.max(0, Math.min(10, maxSlots) - inFlight.length);

  const candidates = tasks.filter((t) => !inFlight.includes(t)).sort((a, b) => a.order - b.order || a.n - b.n);
  for (const t of candidates) {
    if (!t.open) { skip(t.n, 'issue fechada'); continue; }
    if (!t.labels.includes(APPROVAL_LABEL)) { skip(t.n, `sem o label ${APPROVAL_LABEL}`); continue; }
    if (!t.author || !ops.has(t.author.toLowerCase())) { skip(t.n, 'issue não foi aberta por operador'); continue; }
    const approver = approvals.get(t.n);
    if (!approver || !ops.has(String(approver).toLowerCase())) { skip(t.n, 'aprovação não foi aplicada por operador'); continue; }
    if (t.labels.includes(BLOCKED_LABEL)) { skip(t.n, 'bloqueada'); continue; }
    if (t.labels.includes(QUARANTINE_LABEL)) { skip(t.n, 'em quarentena'); continue; }
    if (openPrIssues.has(t.n)) { skip(t.n, 'já tem PR aberta'); continue; }
    const pend = t.deps.filter((d) => !closedIssues.has(d));
    if (pend.length) { skip(t.n, `dependências abertas: ${pend.map((d) => '#' + d).join(', ')}`); continue; }

    const h = history.get(t.n) || { failures: 0, lastFailureAt: null, dispatchedKeys: new Set() };
    if (h.failures >= cfg.maxAttempts) { out.quarantine.push(t.n); skip(t.n, `quarentena: ${h.failures} falhas`); continue; }
    if (h.failures > 0 && h.lastFailureAt) {
      const ready = new Date(h.lastFailureAt).getTime() + backoffMs(h.failures, cfg);
      if (now.getTime() < ready) { skip(t.n, `backoff até ${new Date(ready).toISOString()}`); continue; }
    }
    const attempt = h.failures + 1; const key = idempotencyKey(t.n, attempt);
    if (h.dispatchedKeys?.has(key)) { skip(t.n, 'tentativa já despachada (idempotência)'); continue; }

    const crit = t.files.filter(isCritical);
    const clash = crit.filter((f) => reserved.has(f));
    if (clash.length) { out.waiting.push(t.n); skip(t.n, `arquivo crítico em uso: ${clash.join(', ')}`); continue; }
    if (free <= 0) { out.waiting.push(t.n); skip(t.n, 'sem vaga livre'); continue; }

    out.dispatch.push({ n: t.n, attempt, key });
    crit.forEach((f) => reserved.add(f)); free--;
  }
  out.freeSlots = free;
  return out;
}

/**
 * Histórico de tentativas de UMA issue a partir dos eventos de label (o worker marca executor:running →
 * executor:done | executor:failed). Conta falhas desde o último sucesso; cada executor:github é um despacho.
 * Se houve mais despachos do que falhas desde o último sucesso, a tentativa atual já foi despachada.
 */
export function historyFromEvents(n, events = []) {
  let failures = 0; let lastFailureAt = null; let dispatches = 0;
  for (const e of [...events].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))) {
    if (e.event !== 'labeled') continue;
    const name = e.label?.name;
    if (name === 'executor:github') dispatches++;
    else if (name === 'executor:failed') { failures++; lastFailureAt = e.created_at; }
    else if (name === 'executor:done') { failures = 0; lastFailureAt = null; dispatches = 0; }
  }
  const dispatchedKeys = new Set();
  for (let a = 1; a <= Math.min(dispatches, failures + 1); a++) dispatchedKeys.add(idempotencyKey(n, a));
  return { failures, lastFailureAt, dispatches, dispatchedKeys };
}
