// Dispatcher determinístico da fábrica de tarefas (issue #234; docs/PLANO-ENTREGA-TURBO.md §3.2).
// Escolhe as próximas issues aprovadas para o worker `tarefas.yml`. Não implementa código, não faz merge/deploy
// e não autoriza release: só ordena a fila e decide quem pode ser despachado agora.
// Regras fixas (padrão fechado: na dúvida, não despacha):
// - Só issues abertas, criadas por operador e com o label de fila aplicado por operador (evento de label conferido).
// - Respeita `Depende de: #N` (dependência precisa estar fechada), PR já existente, tarefa em curso, lease ativo,
//   conflito de áreas críticas com tarefa em curso e o limite de vagas (1..50, padrão 3).
// - Idempotência por issue + tentativa: a mesma chave nunca é despachada duas vezes.
// - Falha repetida vai para quarentena (sem nova tentativa); entre tentativas há backoff exponencial.
// - Rate limit/quota: com `pauseUntil` no futuro, nada é despachado e a fila fica intacta.

export const QUEUE_LABEL = 'tarefa:aprovada';
export const LABELS = Object.freeze({
  QUEUED: 'executor:github', RUNNING: 'executor:running', DONE: 'executor:done', FAILED: 'executor:failed',
  QUARANTINE: 'executor:quarentena',
});
export const DEFAULTS = Object.freeze({ maxSlots: 3, maxAttempts: 2, leaseMinutes: 70, backoffMinutes: 30, maxPerCycle: 4 });
const MARKER_RE = /<!--\s*dispatcher:despacho\s+chave=(dispatch:(\d+):(\d+))\s+em=(\S+)\s*-->/g;

const lower = (s) => String(s ?? '').trim().toLowerCase();
const operatorSet = (ops) => new Set((Array.isArray(ops) ? ops : String(ops ?? '').split(',')).map(lower).filter(Boolean));
const labelNames = (issue) => new Set((issue?.labels || []).map((l) => lower(typeof l === 'string' ? l : l?.name)));
const ms = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? t : null; };

/** Vagas efetivas: inteiro 1..50 (autorizado pelo proprietário em 14/10/2026); valor ausente ou inválido usa o padrão (como o `tarefas.yml`). */
export const MAX_SLOTS = 50;
export function clampSlots(v, fallback = DEFAULTS.maxSlots) {
  const n = /^\d+$/.test(String(v ?? '').trim()) ? Number(v) : fallback;
  return Math.min(MAX_SLOTS, Math.max(1, n));
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
    // só as linhas de declaração (início da linha), não menções no meio do texto (#266)
    if (!/^\s*(?:Áreas|Areas)\s*:/i.test(line) && !/^\s*(?:Fase\s*:[^\n]*?)?Risco previsto\s*:/i.test(line)) continue;
    for (const a of line.matchAll(/`([^`\s]+)`/g)) {
      const p = a[1].replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
      if (p && !p.includes('..') && !p.endsWith(':')) areas.add(p);
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

/**
 * Configuração do orçamento: DISPATCHER_ORCAMENTO_USD (limite de custo reportado na janela; vazio = sem limite)
 * e DISPATCHER_ORCAMENTO_JANELA_H (1..168 h, padrão 24). Limite preenchido mas inválido vira `erro` (fail-closed).
 */
export function budgetConfig(env = {}) {
  const raw = String(env.DISPATCHER_ORCAMENTO_USD ?? '').trim();
  const h = Number(String(env.DISPATCHER_ORCAMENTO_JANELA_H ?? '').trim() || 24);
  const janelaMs = (Number.isInteger(h) && h >= 1 && h <= 168 ? h : 24) * 3600e3;
  if (!raw) return { limiteUsd: null, janelaMs, erro: null };
  const v = /^\d{1,6}(\.\d{1,4})?$/.test(raw) ? Number(raw) : NaN;
  return Number.isFinite(v) && v > 0 ? { limiteUsd: v, janelaMs, erro: null } : { limiteUsd: null, janelaMs, erro: 'DISPATCHER_ORCAMENTO_USD inválido' };
}

/**
 * Teto de despachos na janela (independe da telemetria de custo): DISPATCHER_MAX_DESPACHOS_JANELA (1..500;
 * vazio = DEFAULT_MAX_DESPACHOS_JANELA) conta os marcadores `dispatcher:despacho` gravados pelo próprio Dispatcher
 * na mesma janela do orçamento (DISPATCHER_ORCAMENTO_JANELA_H). Pega o que o teto em USD não vê: execução que
 * morreu sem reportar custo, telemetria ausente e rajadas. Valor preenchido mas inválido vira `erro` (fail-closed).
 */
export const DEFAULT_MAX_DESPACHOS_JANELA = 60;
export function dispatchCapConfig(env = {}) {
  const raw = String(env.DISPATCHER_MAX_DESPACHOS_JANELA ?? '').trim();
  if (!raw) return { limite: DEFAULT_MAX_DESPACHOS_JANELA, erro: null };
  const v = /^\d{1,3}$/.test(raw) ? Number(raw) : NaN;
  return v >= 1 && v <= 500 ? { limite: v, erro: null } : { limite: null, erro: 'DISPATCHER_MAX_DESPACHOS_JANELA inválido' };
}

/** Despachos registrados pelo Dispatcher (autor confiável) a partir de `desde` (ms). Chave repetida conta uma vez. */
export function countDispatchesInWindow(comments, { desde, dispatcherActor = 'github-actions[bot]' } = {}) {
  if (!Number.isFinite(desde)) throw new Error('desde obrigatório (ms) para contar despachos na janela');
  const keys = new Set(parseDispatchMarkers(comments, { trustedAuthors: [dispatcherActor] }).filter((m) => m.at >= desde).map((m) => m.key));
  return keys.size;
}

/**
 * Pausa por rate limit a partir da resposta de `GET /rate_limit` (fail-closed): resposta ausente, erro, sem
 * `resources.core.remaining` numérico ou cota baixa com `reset` inválido/passado pausa por RATE_LIMIT_FAIL_PAUSE_MIN;
 * cota abaixo de RATE_LIMIT_MIN_REMAINING pausa até o `reset`; senão, sem pausa (`pauseUntil: null`).
 * @returns {{ pauseUntil: string|null, motivo: string }}
 */
export const RATE_LIMIT_MIN_REMAINING = 200;
export const RATE_LIMIT_FAIL_PAUSE_MIN = 15;
export function rateLimitPause(rl, { now } = {}) {
  const t = ms(now) ?? (typeof now === 'number' ? now : null);
  if (t === null) throw new Error('now obrigatório (ISO) para decidir a pausa por rate limit');
  const falha = (motivo) => ({ pauseUntil: new Date(t + RATE_LIMIT_FAIL_PAUSE_MIN * 60_000).toISOString(), motivo: `${motivo}: despacho pausado (fail-closed)` });
  if (rl == null) return falha('leitura de rate_limit sem resposta');
  if (rl instanceof Error) return falha(`leitura de rate_limit falhou (${sanitize(rl.message, 120)})`);
  const core = rl?.resources?.core;
  if (!Number.isFinite(core?.remaining)) return falha('resposta de rate_limit sem cota core');
  if (core.remaining >= RATE_LIMIT_MIN_REMAINING) return { pauseUntil: null, motivo: `cota da API: ${core.remaining} restante(s)` };
  const reset = Number.isFinite(core.reset) ? core.reset * 1000 : NaN;
  if (!(reset > t)) return falha(`cota da API baixa (${core.remaining}) com reset inválido`);
  return { pauseUntil: new Date(reset).toISOString(), motivo: `cota da API baixa (${core.remaining} < ${RATE_LIMIT_MIN_REMAINING})` };
}

// Falha "sem capacidade": a sessão do Claude foi recusada antes de trabalhar (1 turno ou menos, zero tokens, sem PR)
// — limite de uso/concorrência da conta, não defeito da tarefa. Lida da telemetria do worker (marcador
// telemetria:execucao do bot do workflow). Não conta como tentativa e pausa o despacho por CAPACITY_PAUSE_MIN.
const TELE_RE = /<!--\s*telemetria:execucao v=1 (\{[^<>]*\})\s*-->/g;
export const CAPACITY_PAUSE_MIN = 30;
export function capacityFailures(comments, { trustedAuthor = 'github-actions[bot]' } = {}) {
  const out = [];
  for (const c of comments || []) {
    if (lower(c?.author) !== trustedAuthor) continue;
    for (const m of String(c?.body ?? '').matchAll(TELE_RE)) {
      let r; try { r = JSON.parse(m[1]); } catch { continue; }
      const se = r?.sessao; const tok = se?.tokens || {};
      const semTokens = ['entrada', 'saida', 'cacheLeitura', 'cacheCriacao'].every((k) => !tok[k]);
      if (se && se.sucesso === false && (se.turnos ?? 0) <= 1 && semTokens && !r?.resultado?.pr && typeof r.chave === 'string') {
        const at = ms(r.em); if (at !== null) out.push({ key: r.chave, at });
      }
    }
  }
  return out;
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
      const capFails = capacityFailures(i.comments);
      return { ...i, labels, markers, last, capFails, order: parseOrder(i.body), deps: parseDependencies(i.body), areas: parseAreas(i.body) };
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
  // Sem capacidade do Claude (recusa imediata, sem tokens) recente: pausa tudo até a janela passar; despachar de
  // novo só gastaria tentativas e levaria tarefas sãs à quarentena (incidente da leva 3, 12/10 14:52 UTC).
  const lastCap = Math.max(-Infinity, ...issues.flatMap((i) => i.capFails.map((f) => f.at)));
  if (Number.isFinite(lastCap) && now - lastCap < CAPACITY_PAUSE_MIN * 60_000) {
    plan.paused = true;
    const ate = new Date(lastCap + CAPACITY_PAUSE_MIN * 60_000).toISOString();
    for (const i of issues) skip(i, `pausado: Claude sem capacidade (sessão recusada sem tokens) até ${ate}`);
    return plan;
  }
  // Orçamento (budgetGate calculado por quem monta o snapshot, a partir da telemetria real): estourado, nada
  // é despachado nem posto em quarentena até a janela andar; a fila fica intacta.
  if (s.budget) plan.budget = { permitir: s.budget.permitir !== false, motivo: String(s.budget.motivo ?? '') };
  if (s.budget && s.budget.permitir === false) {
    plan.paused = true;
    for (const i of issues) skip(i, `pausado por orçamento: ${plan.budget.motivo}`);
    return plan;
  }

  // Teto de despachos na janela (s.dispatchCap = { limite, usados, janelaH } ou { erro }): leitura falhando ou
  // configuração inválida pausa (fail-closed); teto atingido pausa sem quarentena; perto do teto, só o que resta.
  let capRestante = Infinity;
  if (s.dispatchCap) {
    const c = s.dispatchCap;
    const ok = !c.erro && Number.isInteger(c.limite) && c.limite > 0 && Number.isInteger(c.usados) && c.usados >= 0;
    const janela = Number.isFinite(c.janelaH) ? `${c.janelaH} h` : 'janela';
    plan.dispatchCap = ok ? { limite: c.limite, usados: c.usados, motivo: `${c.usados}/${c.limite} despacho(s) em ${janela}` }
      : { limite: null, usados: null, motivo: `teto de despachos indisponível (${sanitize(c.erro || 'dados inválidos', 160)})` };
    if (!ok || c.usados >= c.limite) {
      plan.paused = true;
      for (const i of issues) skip(i, `pausado por teto de despachos na janela: ${plan.dispatchCap.motivo}`);
      return plan;
    }
    capRestante = c.limite - c.usados;
  }

  let free = maxSlots - active.length;
  const perCycle = Math.min(capRestante, Number.isInteger(s.maxPerCycle) && s.maxPerCycle > 0 ? s.maxPerCycle : DEFAULTS.maxPerCycle);
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
    const semCap = new Set(i.capFails.map((f) => f.key));   // recusa por capacidade não gasta tentativa
    const budgetUsed = i.markers.filter((m) => (resetAt === null || m.at > resetAt) && !semCap.has(m.key)).length;
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
    if (plan.dispatch.length >= capRestante) { skip(i, `teto de despachos na janela: ${plan.dispatchCap.motivo}, resta(m) ${capRestante}`); continue; }
    if (plan.dispatch.length >= perCycle) { skip(i, `limite de ${perCycle} despachos por ciclo (evita rajada de sessões)`); continue; }

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
 * Erro de API isolado por item (o laço segue): antes do marcador vira `error`; depois dele, `dispatch_failed`
 * (a chave já conta como tentativa e, sem confirmação do registro, não dispara).
 * adapters: { reload(n) → issue, comment(n, body) → { id }, addLabel(n, label), dispatch(n, key) }
 */
export async function applyPlan(plan, snapshot, adapters, { now = () => new Date() } = {}) {
  const trusted = [...operatorSet(snapshot.operators), ...(snapshot.dispatcherActor ? [lower(snapshot.dispatcherActor)] : [])];
  const results = [];
  for (const q of plan.quarantine) {
    try {
      await adapters.addLabel(q.issue, LABELS.QUARANTINE);
      await adapters.comment(q.issue, `Dispatcher: tarefa em quarentena — ${sanitize(q.reason)}. Não haverá nova tentativa automática; um operador decide se remove o label \`${LABELS.QUARANTINE}\`.`);
      results.push({ issue: q.issue, status: 'quarantined' });
    } catch (e) { results.push({ issue: q.issue, status: 'error', reason: sanitize(e?.message) }); }
  }
  for (const d of plan.dispatch) {
    let marked = false;
    try {
      const fresh = await adapters.reload(d.issue);
      const recheck = planDispatch({ ...snapshot, now: now().toISOString(), issues: [fresh], maxSlots: 10 });
      const still = recheck.dispatch.find((x) => x.issue === d.issue);
      if (!still || still.key !== d.key) {
        results.push({ issue: d.issue, status: 'skipped', reason: recheck.skipped[0]?.reason || 'chave já usada' });
        continue;
      }
      const posted = await adapters.comment(d.issue, `Dispatcher: despachando a tentativa ${d.attempt}.\n${dispatchMarker(d.issue, d.attempt, now())}`);
      marked = true;
      const after = await adapters.reload(d.issue);
      const ids = parseDispatchMarkers(after?.comments, { trustedAuthors: trusted }).filter((m) => m.key === d.key).map((m) => m.commentId);
      if (posted?.id == null || !ids.includes(posted.id) || ids.some((id) => id == null || id < posted.id)) {
        results.push({ issue: d.issue, status: 'skipped', reason: 'outro dispatcher registrou a mesma chave primeiro (ou registro não confirmado)' });
        continue;
      }
      await adapters.dispatch(d.issue, d.key); results.push({ issue: d.issue, status: 'dispatched', key: d.key });
    } catch (e) { results.push({ issue: d.issue, status: marked ? 'dispatch_failed' : 'error', key: d.key, reason: sanitize(e?.message) }); }
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
