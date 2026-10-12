// Dispatcher determinístico da fábrica de tarefas (issue #234; docs/PLANO-ENTREGA-TURBO.md §3.2).
// Escolhe as próximas issues aprovadas para o worker `tarefas.yml`. Não implementa código, não faz merge/deploy
// e não autoriza release: só ordena a fila e decide quem pode ser despachado agora.
// Regras fixas (padrão fechado: na dúvida, não despacha):
// - Só issues abertas, criadas por operador e com o label de fila aplicado por operador (evento de label conferido).
// - Respeita `Depende de: #N` (dependência precisa estar fechada), PR já existente, tarefa em curso, lease ativo,
//   conflito de áreas críticas com tarefa em curso e o limite de vagas (1..10, padrão 3).
// - Idempotência por issue + tentativa: a mesma chave nunca é despachada duas vezes.
// - Falha repetida vai para quarentena (sem nova tentativa); entre tentativas há backoff exponencial.
// - Rate limit/quota: com `pauseUntil` no futuro, nada é despachado e a fila fica intacta.

export const QUEUE_LABEL = 'tarefa:aprovada';
export const LABELS = Object.freeze({
  QUEUED: 'executor:github', RUNNING: 'executor:running', DONE: 'executor:done', FAILED: 'executor:failed',
  QUARANTINE: 'executor:quarentena',
});
export const DEFAULTS = Object.freeze({ maxSlots: 3, maxAttempts: 2, leaseMinutes: 70, backoffMinutes: 30 });
const MARKER_RE = /<!--\s*dispatcher:despacho\s+chave=(dispatch:(\d+):(\d+))\s+em=(\S+)\s*-->/g;

const lower = (s) => String(s ?? '').trim().toLowerCase();
const operatorSet = (ops) => new Set((Array.isArray(ops) ? ops : String(ops ?? '').split(',')).map(lower).filter(Boolean));
const labelNames = (issue) => new Set((issue?.labels || []).map((l) => lower(typeof l === 'string' ? l : l?.name)));
const ms = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? t : null; };

/** Vagas efetivas: inteiro 1..10; valor ausente ou inválido usa o padrão (como o `tarefas.yml`). */
export function clampSlots(v, fallback = DEFAULTS.maxSlots) {
  const n = /^\d+$/.test(String(v ?? '').trim()) ? Number(v) : fallback;
  return Math.min(10, Math.max(1, n));
}

/** `Ordem: N` do corpo da issue (sem ordem = fim da fila). */
export function parseOrder(body) {
  const m = String(body ?? '').match(/^\s*Ordem:\s*(\d+)\s*$/im);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

/** Dependências declaradas em linhas `Depende de: #12, #34`. */
export function parseDependencies(body) {
  const deps = new Set();
  for (const line of String(body ?? '').split(/\r?\n/)) {
    const m = line.match(/^\s*Depende de:\s*(.*)$/i);
    if (m) for (const d of m[1].matchAll(/#(\d+)/g)) deps.add(Number(d[1]));
  }
  return [...deps].sort((a, b) => a - b);
}

/** Áreas declaradas (caminhos entre crases nas linhas `Áreas:` ou `Risco previsto:`), normalizadas sem `/` final. */
export function parseAreas(body) {
  const areas = new Set();
  for (const line of String(body ?? '').split(/\r?\n/)) {
    if (!/^\s*(?:Áreas|Areas)\s*:/i.test(line) && !/Risco previsto\s*:/i.test(line)) continue;
    for (const a of line.matchAll(/`([^`\s]+)`/g)) {
      const p = a[1].replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
      if (p && !p.includes('..')) areas.add(p);
    }
  }
  return [...areas].sort();
}

const overlaps = (a, b) => a === b || a.startsWith(b + '/') || b.startsWith(a + '/');
export const areasConflict = (x, y) => x.some((a) => y.some((b) => overlaps(a, b)));

/** Marcadores de despacho deixados pelo dispatcher nos comentários (só os do autor confiável). */
export function parseDispatchMarkers(comments, { trustedAuthors } = {}) {
  const trusted = trustedAuthors ? operatorSet(trustedAuthors) : null;
  const out = [];
  for (const c of comments || []) {
    if (trusted && !trusted.has(lower(c?.author))) continue;
    for (const m of String(c?.body ?? '').matchAll(MARKER_RE)) {
      const at = ms(m[4]);
      if (at !== null) out.push({ key: m[1], issue: Number(m[2]), attempt: Number(m[3]), at, commentId: c?.id ?? null });
    }
  }
  return out.sort((a, b) => a.attempt - b.attempt || a.at - b.at);
}

export const dispatchKey = (issue, attempt) => `dispatch:${issue}:${attempt}`;
export const dispatchMarker = (issue, attempt, now) =>
  `<!-- dispatcher:despacho chave=${dispatchKey(issue, attempt)} em=${new Date(now).toISOString()} -->`;

/** Momento (ms) do último evento `labeled` de algum dos labels, ou null se não há eventos desses labels. */
function lastLabeledAt(issue, names, { event = 'labeled', actors = null } = {}) {
  const want = new Set(names.map(lower));
  const evs = (issue.labelEvents || []).filter((e) => e?.event === event && want.has(lower(e?.label)) && (!actors || actors.has(lower(e?.actor))));
  const ts = evs.map((e) => ms(e.createdAt)).filter((t) => t !== null);
  return ts.length ? Math.max(...ts) : null;
}

/**
 * A última tentativa despachada já terminou? Com eventos de label: houve executor:failed/done DEPOIS do marcador.
 * Sem eventos (snapshot antigo): cai no estado atual dos labels.
 */
function attemptConcluded(i) {
  if (!i.last) return false;
  const resultAt = lastLabeledAt(i, [LABELS.FAILED, LABELS.DONE]);
  if (resultAt !== null) return resultAt >= i.last.at;
  return i.labels.has(LABELS.FAILED) || i.labels.has(LABELS.DONE);
}

/** O label da fila foi aplicado (por último) por um operador e continua presente? */
function queueLabelByOperator(issue, ops) {
  const evs = (issue.labelEvents || []).filter((e) => lower(e?.label) === QUEUE_LABEL);
  if (!evs.length) return false;
  const last = [...evs].sort((a, b) => (ms(a.createdAt) ?? 0) - (ms(b.createdAt) ?? 0)).at(-1);
  return last.event !== 'unlabeled' && ops.has(lower(last.actor));
}

/** PR aberto que já trata a issue (branch `tarefa/issue-N-…` ou corpo com Closes/Fixes/Resolves #N). */
export function hasOpenPull(issueNumber, pulls) {
  const ref = new RegExp(`(^|/)issue-${issueNumber}(?!\\d)`);
  const closes = new RegExp(`\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\s+#${issueNumber}(?!\\d)`, 'i');
  return (pulls || []).some((p) => ref.test(String(p?.headRef ?? '')) || closes.test(String(p?.body ?? '')));
}

/**
 * Plano de despacho, puro e determinístico.
 * @param {object} s snapshot: { now, operators, maxSlots, maxAttempts, leaseMinutes, backoffMinutes, pauseUntil,
 *   dispatcherActor, issues: [{ number, title, body, state, author, labels, labelEvents, comments }],
 *   pulls: [{ number, headRef, body }], issueStates: { [n]: 'open'|'closed' } }
 * @returns {{ slots, active, paused, dispatch: [], quarantine: [], skipped: [] }}
 */
export function planDispatch(s = {}) {
  const now = ms(s.now) ?? (typeof s.now === 'number' ? s.now : null);
  if (now === null) throw new Error('now obrigatório (ISO) para um plano determinístico');
  const ops = operatorSet(s.operators);
  if (!ops.size) throw new Error('lista de operadores vazia: nada é despachado sem operador definido');
  const maxSlots = clampSlots(s.maxSlots);
  const maxAttempts = Number.isInteger(s.maxAttempts) && s.maxAttempts > 0 ? s.maxAttempts : DEFAULTS.maxAttempts;
  const leaseMs = (s.leaseMinutes ?? DEFAULTS.leaseMinutes) * 60_000;
  const backoffMs = (s.backoffMinutes ?? DEFAULTS.backoffMinutes) * 60_000;
  const trusted = s.dispatcherActor ? [...ops, lower(s.dispatcherActor)] : null;
  const states = s.issueStates || {};

  const issues = [...(s.issues || [])].filter((i) => Number.isInteger(i?.number))
    .map((i) => {
      const labels = labelNames(i); const markers = parseDispatchMarkers(i.comments, { trustedAuthors: trusted });
      const last = markers.at(-1) || null;
      return { ...i, labels, markers, last, order: parseOrder(i.body), deps: parseDependencies(i.body), areas: parseAreas(i.body) };
    })
    .sort((a, b) => a.order - b.order || a.number - b.number);

  // Em curso: rodando no worker ou despachado há menos que o lease e ainda SEM resultado DESTA tentativa.
  // O resultado é o evento executor:failed/done posterior ao último despacho (o label de uma tentativa anterior
  // continua na issue até o worker marcar "em execução"; usá-lo fazia o ciclo seguinte ver a tentativa em curso
  // como concluída e aplicar quarentena indevida — incidente da #247, 12/10 09:07 UTC).
  const leased = (i) => i.last && now - i.last.at < leaseMs && !attemptConcluded(i);
  const active = issues.filter((i) => i.state === 'open' && (i.labels.has(LABELS.RUNNING) || i.labels.has(LABELS.QUEUED) || leased(i)));
  const plan = { slots: maxSlots, active: active.map((i) => i.number), paused: false, dispatch: [], quarantine: [], skipped: [] };
  const skip = (i, reason) => plan.skipped.push({ issue: i.number, reason });

  const pauseUntil = ms(s.pauseUntil);
  if (pauseUntil !== null && now < pauseUntil) {
    plan.paused = true;
    for (const i of issues) skip(i, `pausado por rate limit/quota até ${new Date(pauseUntil).toISOString()}`);
    return plan;
  }

  let free = maxSlots - active.length;
  const busyAreas = active.map((i) => i.areas);
  for (const i of issues) {
    if (i.state !== 'open') { skip(i, 'issue fechada'); continue; }
    if (!i.labels.has(QUEUE_LABEL)) { skip(i, `sem o label ${QUEUE_LABEL}`); continue; }
    if (!ops.has(lower(i.author))) { skip(i, 'autor não é operador'); continue; }
    if (!queueLabelByOperator(i, ops)) { skip(i, 'label da fila não foi aplicado por operador (ou evento ausente)'); continue; }
    if (i.labels.has(LABELS.QUARANTINE)) { skip(i, 'em quarentena'); continue; }
    if (i.labels.has(LABELS.DONE)) { skip(i, 'já concluída pelo worker (aguarda revisão/merge)'); continue; }
    if (active.includes(i)) { skip(i, i.labels.has(LABELS.RUNNING) ? 'em execução' : 'despachada (lease ativo)'); continue; }
    if (hasOpenPull(i.number, s.pulls)) { skip(i, 'já existe PR aberto para a issue'); continue; }
    const pending = i.deps.filter((d) => states[d] !== 'closed');
    if (pending.length) { skip(i, `dependência aberta ou desconhecida: ${pending.map((d) => '#' + d).join(', ')}`); continue; }

    // Numeração global (a chave nunca se repete); orçamento de tentativas conta só os despachos depois da última
    // vez que um OPERADOR tirou a quarentena — é assim que o operador concede novas tentativas.
    const attempts = i.markers.length ? Math.max(...i.markers.map((m) => m.attempt)) : 0;
    const resetAt = lastLabeledAt(i, [LABELS.QUARANTINE], { event: 'unlabeled', actors: ops });
    const budgetUsed = i.markers.filter((m) => resetAt === null || m.at > resetAt).length;
    if (budgetUsed >= maxAttempts) {
      plan.quarantine.push({ issue: i.number, attempts: budgetUsed, reason: `${budgetUsed} tentativa(s) sem sucesso; limite ${maxAttempts}` });
      continue;
    }
    if (i.last && budgetUsed > 0) {
      const wait = backoffMs * 2 ** (budgetUsed - 1);
      if (now - i.last.at < wait) { skip(i, `backoff até ${new Date(i.last.at + wait).toISOString()}`); continue; }
    }
    if (i.areas.length && busyAreas.some((a) => areasConflict(i.areas, a))) { skip(i, `área crítica em uso por outra tarefa: ${i.areas.join(', ')}`); continue; }
    if (free <= 0) { skip(i, 'sem vaga livre'); continue; }

    const attempt = attempts + 1;
    plan.dispatch.push({ issue: i.number, title: String(i.title ?? '').slice(0, 120), attempt, key: dispatchKey(i.number, attempt), areas: i.areas });
    busyAreas.push(i.areas); free--;
  }
  return plan;
}

/** Diagnóstico seguro para comentário público: sem tokens, URLs com credencial, quebras ou texto longo. */
export function sanitize(text, max = 400) {
  return String(text ?? '')
    .replace(/(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|postgres(?:ql)?:\/\/\S+|Bearer\s+\S+)/gi, '[redigido]')
    .replace(/[\r\n\t]+/g, ' ').slice(0, max);
}

/**
 * Aplica um plano com adaptadores injetados. Antes de cada despacho relê a issue (`reload`) e não age se a chave
 * já foi registrada ou se a issue deixou de ser elegível — duas execuções concorrentes não despacham a mesma chave.
 * O marcador é gravado ANTES do disparo; se o disparo falhar, a tentativa conta (sem repetição imediata).
 * Corrida entre dois dispatchers: depois de gravar, relê; só dispara quem tem o comentário de menor id com a chave.
 * adapters: { reload(n) → issue, comment(n, body) → { id }, addLabel(n, label), dispatch(n, key) }
 */
export async function applyPlan(plan, snapshot, adapters, { now = () => new Date() } = {}) {
  const trusted = [...operatorSet(snapshot.operators), ...(snapshot.dispatcherActor ? [lower(snapshot.dispatcherActor)] : [])];
  const results = [];
  for (const q of plan.quarantine) {
    await adapters.addLabel(q.issue, LABELS.QUARANTINE);
    await adapters.comment(q.issue, `Dispatcher: tarefa em quarentena — ${sanitize(q.reason)}. Não haverá nova tentativa automática; um operador decide se remove o label \`${LABELS.QUARANTINE}\`.`);
    results.push({ issue: q.issue, status: 'quarantined' });
  }
  for (const d of plan.dispatch) {
    const fresh = await adapters.reload(d.issue);
    const recheck = planDispatch({ ...snapshot, now: now().toISOString(), issues: [fresh], maxSlots: 10 });
    const still = recheck.dispatch.find((x) => x.issue === d.issue);
    if (!still || still.key !== d.key) {
      results.push({ issue: d.issue, status: 'skipped', reason: recheck.skipped[0]?.reason || 'chave já usada' });
      continue;
    }
    const posted = await adapters.comment(d.issue, `Dispatcher: despachando a tentativa ${d.attempt}.\n${dispatchMarker(d.issue, d.attempt, now())}`);
    const after = await adapters.reload(d.issue);
    const ids = parseDispatchMarkers(after?.comments, { trustedAuthors: trusted }).filter((m) => m.key === d.key).map((m) => m.commentId);
    if (posted?.id == null || !ids.includes(posted.id) || ids.some((id) => id == null || id < posted.id)) {
      results.push({ issue: d.issue, status: 'skipped', reason: 'outro dispatcher registrou a mesma chave primeiro (ou registro não confirmado)' });
      continue;
    }
    try { await adapters.dispatch(d.issue, d.key); results.push({ issue: d.issue, status: 'dispatched', key: d.key }); }
    catch (e) { results.push({ issue: d.issue, status: 'dispatch_failed', key: d.key, reason: sanitize(e?.message) }); }
  }
  return results;
}

/**
 * Revalidação no worker (defesa em profundidade): um `workflow_dispatch` do tarefas.yml só executa se a issue
 * ainda estiver elegível e o despacho tiver sido registrado pelo dispatcher com a MESMA chave, e se essa for a
 * última tentativa registrada (despacho antigo/reenviado não roda). Pura; quem chama busca issue/eventos/comentários.
 * @returns {{ ok: boolean, reason: string }}
 */
export function validateDispatchRequest({ issueNumber, key, issue, operators, dispatcherActor } = {}) {
  const no = (reason) => ({ ok: false, reason });
  const n = Number(issueNumber);
  if (!Number.isInteger(n) || n <= 0 || String(issueNumber).trim() !== String(n)) return no('número de issue inválido');
  const km = String(key ?? '').match(/^dispatch:(\d+):(\d+)$/);
  if (!km || Number(km[1]) !== n) return no('chave de despacho inválida ou de outra issue');
  if (!issue || issue.number !== n) return no('issue não encontrada');
  const ops = operatorSet(operators);
  if (!ops.size) return no('lista de operadores vazia');
  const labels = labelNames(issue);
  if (issue.state !== 'open') return no('issue fechada');
  if (!ops.has(lower(issue.author))) return no('autor não é operador');
  if (!labels.has(QUEUE_LABEL) || !queueLabelByOperator(issue, ops)) return no(`label ${QUEUE_LABEL} ausente ou não aplicado por operador`);
  if (labels.has(LABELS.QUARANTINE)) return no('em quarentena');
  if (labels.has(LABELS.DONE)) return no('já concluída');
  const trusted = [...ops, ...(dispatcherActor ? [lower(dispatcherActor)] : [])];
  const markers = parseDispatchMarkers(issue.comments, { trustedAuthors: trusted });
  if (!markers.some((m) => m.key === key)) return no('despacho não registrado pelo dispatcher com esta chave');
  const latest = Math.max(...markers.map((m) => m.attempt));
  if (Number(km[2]) !== latest) return no(`tentativa ${km[2]} não é a última registrada (${latest})`);
  return { ok: true, reason: 'despacho válido' };
}
