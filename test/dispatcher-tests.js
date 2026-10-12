// Dispatcher (puro + adaptadores simulados): fila aprovada, autorização, dependências, PR existente, vagas,
// lease, idempotência, concorrência, retry com backoff, quarentena, pausa por quota e workflow só leitura.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planDispatch, applyPlan, parseDependencies, parseAreas, parseOrder, parseDispatchMarkers, dispatchMarker,
  clampSlots, hasOpenPull, sanitize, validateDispatchRequest, QUEUE_LABEL, LABELS } from '../src/agents/dispatcher.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
import { workerAcceptsDispatchYaml } from '../tools/dispatcher-workflow-check.mjs';
let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };

const NOW = '2026-10-12T03:00:00Z';
const OP = 'dono';
const BOT = 'github-actions[bot]';
const min = (m) => new Date(Date.parse(NOW) + m * 60_000).toISOString();
function issue(number, over = {}) {
  return {
    number, title: `Tarefa ${number}`, state: 'open', author: OP, body: `Ordem: ${number}\nFase: 0`,
    labels: [QUEUE_LABEL], labelEvents: [{ event: 'labeled', label: QUEUE_LABEL, actor: OP, createdAt: min(-120) }], comments: [], ...over,
  };
}
const snap = (issues, over = {}) => ({ now: NOW, operators: [OP], dispatcherActor: BOT, issues, pulls: [], issueStates: {}, ...over });
const marker = (nr, attempt, at, author = BOT) => ({ author, body: `Dispatcher: despachando.\n${dispatchMarker(nr, attempt, at)}` });

await t('parsers: ordem, dependências, áreas, vagas', () => {
  assert.equal(parseOrder('Ordem: 3\n'), 3); assert.equal(parseOrder('sem ordem'), Number.MAX_SAFE_INTEGER);
  assert.deepEqual(parseDependencies('Depende de: #234, #12\nOutro #99'), [12, 234]);
  assert.deepEqual(parseAreas('Fase: 0 · Risco previsto: R3 (`.github/workflows`, `src/agents/`)\nCorpo `x/y`'), ['.github/workflows', 'src/agents']);
  assert.deepEqual(parseAreas('Áreas: `api/v1.mjs` `../fora`'), ['api/v1.mjs']);
  assert.deepEqual([clampSlots(undefined), clampSlots('10'), clampSlots('50'), clampSlots('0'), clampSlots('x')], [3, 10, 10, 1, 3]);
});

await t('tarefa elegível é despachada sem label manual por issue; ordem por "Ordem:" e número', () => {
  const p = planDispatch(snap([issue(5, { body: 'Ordem: 2' }), issue(3, { body: 'Ordem: 9' }), issue(4, { body: 'Ordem: 2' })]));
  assert.deepEqual(p.dispatch.map((d) => [d.issue, d.attempt, d.key]), [[4, 1, 'dispatch:4:1'], [5, 1, 'dispatch:5:1'], [3, 1, 'dispatch:3:1']]);
});

await t('tarefa não autorizada é ignorada: autor, label aplicado por terceiro, label removido, sem label, fechada', () => {
  const p = planDispatch(snap([
    issue(1, { author: 'estranho' }),
    issue(2, { labelEvents: [{ event: 'labeled', label: QUEUE_LABEL, actor: 'estranho', createdAt: min(-5) }] }),
    issue(3, { labelEvents: [{ event: 'labeled', label: QUEUE_LABEL, actor: OP, createdAt: min(-9) }, { event: 'labeled', label: QUEUE_LABEL, actor: 'estranho', createdAt: min(-1) }] }),
    issue(4, { labelEvents: [] }),
    issue(5, { labels: [] }),
    issue(6, { state: 'closed' }),
    issue(7, { labelEvents: [{ event: 'labeled', label: QUEUE_LABEL, actor: OP, createdAt: min(-9) }, { event: 'unlabeled', label: QUEUE_LABEL, actor: OP, createdAt: min(-1) }] }),
  ]));
  assert.deepEqual(p.dispatch, []);
  const why = Object.fromEntries(p.skipped.map((s) => [s.issue, s.reason]));
  assert.match(why[1], /autor não é operador/); assert.match(why[2], /operador/); assert.match(why[3], /operador/);
  assert.match(why[4], /evento ausente/); assert.match(why[5], /sem o label/); assert.match(why[6], /fechada/); assert.match(why[7], /operador/);
  assert.throws(() => planDispatch(snap([issue(1)], { operators: '' })), /operadores vazia/);
  assert.throws(() => planDispatch(snap([issue(1)], { now: 'ontem' })), /now obrigatório/);
});

await t('dependência aberta ou desconhecida bloqueia; fechada libera', () => {
  const dep = issue(235, { body: 'Ordem: 3\nDepende de: #234' });
  assert.match(planDispatch(snap([dep])).skipped[0].reason, /#234/);
  assert.match(planDispatch(snap([dep], { issueStates: { 234: 'open' } })).skipped[0].reason, /#234/);
  assert.equal(planDispatch(snap([dep], { issueStates: { 234: 'closed' } })).dispatch[0].issue, 235);
});

await t('PR já existente (branch tarefa/issue-N ou Closes #N) não gera outra execução', () => {
  assert.equal(hasOpenPull(23, [{ headRef: 'tarefa/issue-23-20261012-0100' }]), true);
  assert.equal(hasOpenPull(23, [{ headRef: 'tarefa/issue-234-x' }, { body: 'Closes #234' }]), false);
  assert.equal(hasOpenPull(23, [{ body: 'Fixes #23.' }]), true);
  const p = planDispatch(snap([issue(23)], { pulls: [{ number: 9, headRef: 'x', body: 'Resolves #23' }] }));
  assert.match(p.skipped[0].reason, /PR aberto/);
});

await t('limite de vagas: em execução e lease contam; excedentes esperam na fila', () => {
  const issues = [
    issue(1, { labels: [QUEUE_LABEL, LABELS.RUNNING] }),
    issue(2, { comments: [marker(2, 1, min(-10))] }),
    issue(3), issue(4), issue(5),
  ];
  const p = planDispatch(snap(issues, { maxSlots: 3 }));
  assert.deepEqual(p.active, [1, 2]); assert.deepEqual(p.dispatch.map((d) => d.issue), [3]);
  assert.deepEqual(p.skipped.filter((s) => /sem vaga/.test(s.reason)).map((s) => s.issue), [4, 5]);
  assert.deepEqual(planDispatch(snap(issues, { maxSlots: '10' })).dispatch.map((d) => d.issue), [3, 4, 5]);
});

await t('marcador de autor não confiável é ignorado (não cria lease nem conta tentativa)', () => {
  const fake = marker(8, 5, min(-1), 'estranho');
  assert.deepEqual(parseDispatchMarkers([fake], { trustedAuthors: [OP, BOT] }), []);
  assert.deepEqual(planDispatch(snap([issue(8, { comments: [fake] })])).dispatch.map((d) => d.key), ['dispatch:8:1']);
});

await t('retry: falha libera nova tentativa só depois do backoff exponencial; cancelamento conta como falha', () => {
  const failed = (at, attempts = 1) => issue(9, { labels: [QUEUE_LABEL, LABELS.FAILED], comments: Array.from({ length: attempts }, (_, k) => marker(9, k + 1, at)) });
  let p = planDispatch(snap([failed(min(-10))], { maxAttempts: 3 }));
  assert.match(p.skipped[0].reason, /backoff até/);
  p = planDispatch(snap([failed(min(-31))], { maxAttempts: 3 }));
  assert.deepEqual(p.dispatch.map((d) => d.key), ['dispatch:9:2'], 'retomada com nova chave');
  p = planDispatch(snap([failed(min(-50), 2)], { maxAttempts: 3 }));
  assert.match(p.skipped[0].reason, /backoff/, 'segunda espera é 60 min');
  // lease expirado sem resultado (job cancelado/perdido): tratado como tentativa encerrada
  p = planDispatch(snap([issue(9, { comments: [marker(9, 1, min(-200))] })], { maxAttempts: 3 }));
  assert.deepEqual(p.dispatch.map((d) => d.key), ['dispatch:9:2']);
});

await t('falhas repetidas vão para quarentena; quarentena não volta para a fila', () => {
  const i = issue(10, { labels: [QUEUE_LABEL, LABELS.FAILED], comments: [marker(10, 1, min(-300)), marker(10, 2, min(-200))] });
  const p = planDispatch(snap([i]));
  assert.deepEqual(p.quarantine.map((q) => [q.issue, q.attempts]), [[10, 2]]); assert.deepEqual(p.dispatch, []);
  const q = planDispatch(snap([{ ...i, labels: [QUEUE_LABEL, LABELS.QUARANTINE] }]));
  assert.deepEqual([q.dispatch, q.quarantine], [[], []]); assert.match(q.skipped[0].reason, /quarentena/);
});

await t('área crítica em uso bloqueia tarefa concorrente; áreas disjuntas seguem', () => {
  const run = issue(20, { labels: [QUEUE_LABEL, LABELS.RUNNING], body: 'Risco previsto: R3 (`src/agents`)' });
  const p = planDispatch(snap([run, issue(21, { body: 'Áreas: `src/agents/dispatcher.js`' }), issue(22, { body: 'Áreas: `api/`' }), issue(23, { body: 'Áreas: `src/agents-extra`' })]));
  assert.deepEqual(p.dispatch.map((d) => d.issue), [22, 23]); assert.match(p.skipped.find((s) => s.issue === 21).reason, /área crítica/);
  const two = planDispatch(snap([issue(30, { body: 'Áreas: `package.json`' }), issue(31, { body: 'Áreas: `package.json`' })]));
  assert.deepEqual(two.dispatch.map((d) => d.issue), [30], 'duas novas na mesma área: só uma por rodada');
});

await t('rate limit/quota: com pausa ativa nada é despachado e a fila é preservada', () => {
  const p = planDispatch(snap([issue(1), issue(2)], { pauseUntil: min(30) }));
  assert.equal(p.paused, true); assert.deepEqual(p.dispatch, []); assert.equal(p.skipped.length, 2);
  assert.equal(planDispatch(snap([issue(1)], { pauseUntil: min(-1) })).dispatch.length, 1);
});

// ------------------------------------------------------------------ aplicação com adaptadores simulados
function fakeRepo(issues) {
  const byN = new Map(issues.map((i) => [i.number, structuredClone(i)]));
  const calls = { dispatch: [], comment: [], label: [] }; let seq = 1000;
  return {
    calls, byN,
    adapters: {
      async reload(nr) { return structuredClone(byN.get(nr)); },
      async comment(nr, body) { calls.comment.push(nr); const id = ++seq; byN.get(nr).comments.push({ id, author: BOT, body }); return { id }; },
      async addLabel(nr, l) { calls.label.push([nr, l]); byN.get(nr).labels.push(l); },
      async dispatch(nr, key) { calls.dispatch.push(key); },
    },
  };
}

await t('reexecução não gera dois despachos para a mesma chave (idempotência)', async () => {
  const r = fakeRepo([issue(40)]); const s = snap([...r.byN.values()]);
  const plan = planDispatch(s);
  const now = () => new Date(NOW);
  assert.deepEqual((await applyPlan(plan, s, r.adapters, { now })).map((x) => x.status), ['dispatched']);
  assert.deepEqual((await applyPlan(plan, s, r.adapters, { now })).map((x) => x.status), ['skipped'], 'mesmo plano reaplicado');
  const again = planDispatch(snap([...r.byN.values()]));
  assert.deepEqual(again.dispatch, []); assert.deepEqual(again.active, [40], 'lease ativo após o despacho');
  assert.deepEqual(r.calls.dispatch, ['dispatch:40:1']);
});

await t('dois dispatchers concorrentes com o mesmo plano: só um dispara', async () => {
  const r = fakeRepo([issue(41), issue(42)]); const s = snap([...r.byN.values()]);
  const plan = planDispatch(s); const now = () => new Date(NOW);
  const [a, b] = await Promise.all([applyPlan(plan, s, r.adapters, { now }), applyPlan(plan, s, r.adapters, { now })]);
  assert.deepEqual(r.calls.dispatch.sort(), ['dispatch:41:1', 'dispatch:42:1']);
  assert.equal([...a, ...b].filter((x) => x.status === 'dispatched').length, 2);
});

await t('falha ao disparar conta a tentativa (marcador antes do efeito) e respeita backoff', async () => {
  const r = fakeRepo([issue(43)]); r.adapters.dispatch = async () => { throw new Error('HTTP 403 token ghp_' + 'x'.repeat(30)); };
  const s = snap([...r.byN.values()]);
  const [res] = await applyPlan(planDispatch(s), s, r.adapters, { now: () => new Date(NOW) });
  assert.equal(res.status, 'dispatch_failed'); assert.doesNotMatch(res.reason, /ghp_x/);
  const later = planDispatch(snap([...r.byN.values()], { now: min(80) }));
  assert.deepEqual(later.dispatch.map((d) => d.key), ['dispatch:43:2']);
});

await t('quarentena aplica label e comentário sanitizado, sem disparo', async () => {
  const r = fakeRepo([issue(44, { labels: [QUEUE_LABEL, LABELS.FAILED], comments: [marker(44, 1, min(-300)), marker(44, 2, min(-200))] })]);
  const s = snap([...r.byN.values()]);
  const res = await applyPlan(planDispatch(s), s, r.adapters, { now: () => new Date(NOW) });
  assert.deepEqual(res.map((x) => x.status), ['quarantined']); assert.deepEqual(r.calls.label, [[44, LABELS.QUARANTINE]]); assert.deepEqual(r.calls.dispatch, []);
  assert.equal(sanitize('a\nb postgres://u:p@h/db Bearer abc'), 'a b [redigido] [redigido]');
});

await t('contrato workflow_dispatch do worker: YAML real aceito; sem inputs/issue falha fechado', () => {
  const worker = fs.readFileSync(path.join(root, '.github/workflows/tarefas.yml'), 'utf8');
  assert.equal(workerAcceptsDispatchYaml(worker), true, 'tarefas.yml real precisa declarar issue');
  assert.equal(workerAcceptsDispatchYaml('on:\\n  workflow_dispatch:\\n  issues:\\n    types: [labeled]\\n'), false, 'sem inputs deve recusar');
  assert.equal(workerAcceptsDispatchYaml('on:\\n  workflow_dispatch:\\n    inputs:\\n      chave:\\n        required: true\\n'), false, 'sem issue deve recusar');
  assert.equal(workerAcceptsDispatchYaml('on:\\n  workflow_dispatch:\\n    inputs:\\n      issue:\\n        required: true\\n'), true, 'contrato mínimo válido deve aceitar');
});

// ------------------------------------------------------------------ workflow e CLI
await t('dispatcher.yml: agendado; planeja só leitura; escreve só no job de despacho ligado por DISPATCHER_ATIVO', () => {
  const y = fs.readFileSync(path.join(root, '.github/workflows/dispatcher.yml'), 'utf8');
  const code = y.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
  assert.match(code, /schedule:/); assert.match(code, /workflow_dispatch:/);
  const [plano, despacho] = code.split(/\n  despacho:\n/);
  assert.match(plano, /permissions:\s*\n\s+contents: read\s*\n\s+issues: read\s*\n\s+pull-requests: read/);
  assert.doesNotMatch(plano, /: write|--executar/i, 'job de plano continua só leitura');
  assert.match(despacho, /if: vars\.DISPATCHER_ATIVO == 'true'/);
  assert.deepEqual([...despacho.matchAll(/(\w[\w-]*): write/g)].map((m) => m[1]).sort(), ['actions', 'issues'], 'escrita só em issues (marcador) e actions (disparo)');
  assert.doesNotMatch(code, /secrets\.|pull_request_target|gh pr merge|vercel|DATABASE_URL|contents: write/i);
  assert.match(code, /concurrency:\s*\n\s+group: dispatcher/);
  for (const m of code.matchAll(/uses:\s*(\S+)/g)) assert.match(m[1], /@[0-9a-f]{40}$/, `${m[1]} fixado por SHA`);
  const cli = fs.readFileSync(path.join(root, 'tools/dispatcher.mjs'), 'utf8');
  assert.match(cli, /--executar/); assert.doesNotMatch(cli, /pulls\/\$\{?[^}]*\}?\/merge|gh pr merge|deployments/);
  const tarefas = fs.readFileSync(path.join(root, '.github/workflows/tarefas.yml'), 'utf8');
  assert.doesNotMatch(tarefas, /gh pr merge|Bash\(git push/, 'worker continua sem merge/push livre');
});

await t('worker revalida o despacho: só a chave registrada pelo dispatcher, última tentativa, issue ainda elegível', () => {
  const v = (over = {}, key = 'dispatch:7:1', nr = '7') => validateDispatchRequest({ issueNumber: nr, key, operators: [OP], dispatcherActor: BOT,
    issue: issue(7, { comments: [{ id: 10, ...marker(7, 1, min(-5)) }], ...over }) });
  assert.deepEqual(v(), { ok: true, reason: 'despacho válido' });
  const no = (r) => { assert.equal(r.ok, false); return r.reason; };
  assert.match(no(v({}, 'dispatch:7:1', '7a')), /número de issue inválido/);
  assert.match(no(v({}, 'dispatch:8:1')), /chave de despacho inválida ou de outra issue/);
  assert.match(no(v({}, 'qualquer')), /chave de despacho inválida/);
  assert.match(no(v({ state: 'closed' })), /fechada/);
  assert.match(no(v({ author: 'estranho' })), /autor não é operador/);
  assert.match(no(v({ labelEvents: [{ event: 'labeled', label: QUEUE_LABEL, actor: 'estranho', createdAt: min(-60) }] })), /não aplicado por operador/);
  assert.match(no(v({ labels: [] })), /ausente/);
  assert.match(no(v({ labels: [QUEUE_LABEL, LABELS.QUARANTINE] })), /quarentena/);
  assert.match(no(v({ labels: [QUEUE_LABEL, LABELS.DONE] })), /concluída/);
  // marcador ausente, de autor não confiável, ou de outra chave: recusa
  assert.match(no(v({ comments: [] })), /não registrado/);
  assert.match(no(v({ comments: [{ id: 11, ...marker(7, 1, min(-5), 'estranho') }] })), /não registrado/);
  // reenvio de um despacho antigo: a chave existe, mas já houve tentativa posterior
  const two = { comments: [{ id: 10, ...marker(7, 1, min(-90)) }, { id: 12, ...marker(7, 2, min(-5)) }] };
  assert.match(no(v(two, 'dispatch:7:1')), /não é a última registrada/);
  assert.equal(v(two, 'dispatch:7:2').ok, true);
  assert.equal(validateDispatchRequest({ issueNumber: '7', key: 'dispatch:7:1', operators: [], issue: issue(7) }).ok, false, 'sem operadores, fecha');
});

console.log(`✓ Dispatcher: ${n} grupos de testes passaram`);
