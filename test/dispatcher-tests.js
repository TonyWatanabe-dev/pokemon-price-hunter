// Dispatcher determinístico (#234): quem pode ser despachado, quantas, em que ordem e sem duplicar.
import assert from 'node:assert/strict';
import { planDispatch, parseTask, historyFromEvents, backoffMs, idempotencyKey, DEFAULTS } from '../src/agents/dispatcher.js';

let n = 0;
async function t(name, fn) { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } }
const OPS = ['tony'];
const NOW = new Date('2026-10-12T12:00:00Z');
const issue = (num, { order, deps = [], files = [], labels = ['tarefa:aprovada'], author = 'tony', state = 'open' } = {}) => ({
  number: num, title: `tarefa ${num}`, state, user: { login: author },
  labels: labels.map((name) => ({ name })),
  body: [order != null ? `Ordem: ${order}` : '', deps.length ? `Depende de: ${deps.map((d) => '#' + d).join(', ')}` : '', files.length ? `Arquivos: ${files.join(', ')}` : ''].join('\n'),
});
const approvedBy = (nums, who = 'tony') => new Map(nums.map((x) => [x, who]));
const plan = (o) => planDispatch({ operators: OPS, now: NOW, ...o });
const ids = (p) => p.dispatch.map((d) => d.n);

await t('1. ficha da tarefa: Ordem, Depende de e Arquivos lidos do corpo; ausentes ficam neutros', () => {
  const x = parseTask(issue(7, { order: 2, deps: [3, 4], files: ['src/agents/x.js', '`index.html`'] }));
  assert.deepEqual([x.order, x.deps, x.files, x.author, x.open], [2, [3, 4], ['src/agents/x.js', 'index.html'], 'tony', true]);
  const y = parseTask({ number: 8, state: 'open', user: { login: 'tony' }, labels: [], body: '' });
  assert.equal(y.order, Number.MAX_SAFE_INTEGER); assert.deepEqual([y.deps, y.files], [[], []]);
});

await t('2. tarefa aprovada por operador é despachada sem label manual por issue, na ordem do campo Ordem', () => {
  const p = plan({ issues: [issue(12, { order: 3 }), issue(10, { order: 1 }), issue(11, { order: 2 })], approvals: approvedBy([10, 11, 12]) });
  assert.deepEqual(ids(p), [10, 11, 12]);
  assert.deepEqual(p.dispatch[0], { n: 10, attempt: 1, key: idempotencyKey(10, 1) });
});

await t('3. não autorizada nunca vai: sem label, autor não operador, aprovação por terceiro, bloqueada, fechada', () => {
  const p = plan({
    issues: [issue(1, { labels: [] }), issue(2, { author: 'estranho' }), issue(3), issue(4, { labels: ['tarefa:aprovada', 'rotina:bloqueada'] }), issue(5, { state: 'closed' }), issue(6)],
    approvals: new Map([[1, 'tony'], [2, 'tony'], [3, 'estranho'], [4, 'tony'], [5, 'tony']]),
  });
  assert.deepEqual(ids(p), []);
  const why = Object.fromEntries(p.skipped.map((s) => [s.n, s.reason]));
  assert.match(why[1], /sem o label/); assert.match(why[2], /aberta por operador/); assert.match(why[3], /aplicada por operador/);
  assert.match(why[4], /bloqueada/); assert.match(why[5], /fechada/); assert.match(why[6], /aplicada por operador/, 'sem evento de aprovação = não aprovado');
});

await t('4. dependências: só despacha quando todas estão fechadas', () => {
  const issues = [issue(20, { order: 1, deps: [19] })];
  assert.deepEqual(ids(plan({ issues, approvals: approvedBy([20]) })), []);
  assert.match(plan({ issues, approvals: approvedBy([20]) }).skipped[0].reason, /dependências abertas: #19/);
  assert.deepEqual(ids(plan({ issues, approvals: approvedBy([20]), closedIssues: new Set([19]) })), [20]);
});

await t('5. reexecução não duplica: PR aberta, tarefa em curso ou tentativa já despachada ficam de fora', () => {
  const approvals = approvedBy([30, 31, 32]);
  const base = [issue(30, { order: 1 }), issue(31, { order: 2 }), issue(32, { order: 3 })];
  const first = plan({ issues: base, approvals });
  assert.deepEqual(ids(first), [30, 31, 32]);
  // depois do despacho: 30 está na fila do worker, 31 já abriu PR, 32 já tem o despacho registrado nos eventos
  const after = [issue(30, { order: 1, labels: ['tarefa:aprovada', 'executor:github'] }), issue(31, { order: 2 }), issue(32, { order: 3 })];
  const hist = new Map([[32, historyFromEvents(32, [{ event: 'labeled', label: { name: 'executor:github' }, created_at: '2026-10-12T11:59:00Z' }])]]);
  const again = plan({ issues: after, approvals, openPrIssues: new Set([31]), history: hist });
  assert.deepEqual(ids(again), [], 'segundo ciclo com o mesmo estado não despacha nada de novo');
  const why = Object.fromEntries(again.skipped.map((s) => [s.n, s.reason]));
  assert.match(why[31], /PR aberta/); assert.match(why[32], /idempotência/);
});

await t('6. vagas: respeita o limite, conta as que já estão no worker e mantém o resto na fila', () => {
  const approvals = approvedBy([40, 41, 42, 43, 44]);
  const issues = [issue(40, { order: 1, labels: ['tarefa:aprovada', 'executor:running'] }), issue(41, { order: 2, labels: ['tarefa:aprovada', 'executor:github'] }),
    issue(42, { order: 3 }), issue(43, { order: 4 }), issue(44, { order: 5 })];
  const p = plan({ issues, approvals, maxSlots: 3 });
  assert.deepEqual(ids(p), [42]); assert.deepEqual(p.waiting, [43, 44]); assert.equal(p.freeSlots, 0);
  assert.equal(plan({ issues: [], maxSlots: 50 }).freeSlots, 10, 'nunca passa de 10 vagas');
  assert.equal(plan({ issues: [], maxSlots: DEFAULTS.maxSlots }).freeSlots, 3);
});

await t('7. arquivo crítico em disputa serializa; arquivo comum não', () => {
  const approvals = approvedBy([50, 51, 52, 53]);
  const issues = [issue(50, { order: 1, labels: ['tarefa:aprovada', 'executor:running'], files: ['index.html'] }),
    issue(51, { order: 2, files: ['index.html'] }), issue(52, { order: 3, files: ['docs/x.md'] }),
    issue(53, { order: 4, files: ['.github/workflows/tarefas.yml'] }), issue(54, { order: 5, files: ['.github/workflows/tarefas.yml'] })];
  approvals.set(54, 'tony');
  const p = plan({ issues, approvals, maxSlots: 10 });
  assert.deepEqual(ids(p), [52, 53], '51 espera o 50 (index.html); 54 espera o 53 (mesmo workflow)');
  assert.deepEqual(p.waiting, [51, 54]);
});

await t('8. falha: backoff exponencial entre tentativas, retomada depois do prazo e quarentena no limite', () => {
  assert.deepEqual([0, 1, 2, 3, 10].map((f) => backoffMs(f)), [0, 30 * 60_000, 60 * 60_000, 120 * 60_000, DEFAULTS.backoffMaxMs]);
  const approvals = approvedBy([60]); const issues = [issue(60, { order: 1 })];
  const ev = (name, at) => ({ event: 'labeled', label: { name }, created_at: at });
  const oneFail = historyFromEvents(60, [ev('executor:github', '2026-10-12T11:00:00Z'), ev('executor:running', '2026-10-12T11:01:00Z'), ev('executor:failed', '2026-10-12T11:40:00Z')]);
  assert.deepEqual([oneFail.failures, oneFail.dispatches], [1, 1]);
  let p = plan({ issues, approvals, history: new Map([[60, oneFail]]) });
  assert.deepEqual(ids(p), [], 'dentro do backoff de 30 min'); assert.match(p.skipped[0].reason, /backoff até 2026-10-12T12:10:00/);
  p = plan({ issues, approvals, history: new Map([[60, oneFail]]), now: new Date('2026-10-12T12:11:00Z') });
  assert.deepEqual(p.dispatch, [{ n: 60, attempt: 2, key: idempotencyKey(60, 2) }], 'retoma com a tentativa 2');
  const three = historyFromEvents(60, ['10', '11', '12'].flatMap((h) => [ev('executor:github', `2026-10-12T${h}:00:00Z`), ev('executor:failed', `2026-10-12T${h}:30:00Z`)]));
  p = plan({ issues, approvals, history: new Map([[60, three]]), now: new Date('2026-10-13T12:00:00Z') });
  assert.deepEqual([ids(p), p.quarantine], [[], [60]]); assert.match(p.skipped[0].reason, /quarentena: 3 falhas/);
  assert.match(plan({ issues: [issue(61, { labels: ['tarefa:aprovada', 'tarefa:quarentena'] })], approvals: approvedBy([61]) }).skipped[0].reason, /quarentena/);
});

await t('9. sucesso zera o histórico; cancelamento (falha) seguido de nova aprovação retoma sem duplicar', () => {
  const ev = (name, at) => ({ event: 'labeled', label: { name }, created_at: at });
  const h = historyFromEvents(70, [ev('executor:github', '2026-10-12T09:00:00Z'), ev('executor:failed', '2026-10-12T09:10:00Z'),
    ev('executor:github', '2026-10-12T10:00:00Z'), ev('executor:done', '2026-10-12T10:30:00Z')]);
  assert.deepEqual([h.failures, h.dispatches, h.dispatchedKeys.size], [0, 0, 0]);
  const cancelled = historyFromEvents(71, [ev('executor:github', '2026-10-12T09:00:00Z'), ev('executor:failed', '2026-10-12T09:01:00Z'), ev('executor:github', '2026-10-12T10:00:00Z')]);
  assert.deepEqual([...cancelled.dispatchedKeys], [idempotencyKey(71, 1), idempotencyKey(71, 2)], 'a 2ª tentativa já saiu');
  assert.deepEqual(ids(plan({ issues: [issue(71)], approvals: approvedBy([71]), history: new Map([[71, cancelled]]) })), []);
});

await t('10. determinístico: mesma entrada, mesmo plano (dois ciclos concorrentes não divergem)', () => {
  const args = { issues: [issue(80, { order: 2 }), issue(81, { order: 1, files: ['src/agents/a.js'] }), issue(82, { order: 1, files: ['src/agents/a.js'] })], approvals: approvedBy([80, 81, 82]), maxSlots: 2 };
  const a = plan(args); const b = plan(args);
  assert.deepEqual(a, b); assert.deepEqual(ids(a), [81, 80]); assert.deepEqual(a.waiting, [82]);
});

console.log(`✓ Dispatcher: ${n} grupos de testes passaram`);
