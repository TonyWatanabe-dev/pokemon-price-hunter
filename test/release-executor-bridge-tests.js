// Release Executor Bridge: Governor ligado ao merge/deploy reais, com revalidação de SHA, lock, idempotência,
// auditoria fail-closed e verificação no provedor. Provedores simulados; PostgreSQL só com TEST_DATABASE_URL.
import assert from 'node:assert/strict';
import { runMerge, runDeploy, memoryOutcomeStore, memoryLock, pgOutcomeStore, pgAdvisoryLock, ProviderError,
  normalizeCheckRuns, evidenceDrift, readPullRequestEvidence, smokeTest, idempotencyKey, redact } from '../src/agents/release-executor-bridge.js';
import { githubAdapter, ghApi, vercelAdapter } from '../src/agents/release-adapters.js';
import { RELEASE_ACTION } from '../src/agents/release-governor.js';

const HEAD = 'a'.repeat(40); const OTHER = 'b'.repeat(40); const MERGE = 'c'.repeat(40); const MAIN0 = 'd'.repeat(40);
let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };
const run = (name, conclusion = 'success', sha = HEAD, id = 1) => ({ id, name, status: 'completed', conclusion, head_sha: sha, started_at: '2026-10-11T10:00:00Z' });

// GitHub simulado: estado mutável por teste
function fakeGithub(over = {}) {
  const s = {
    pr: { state: 'open', draft: false, merged: false, mergeable: true, mergeable_state: 'clean', base: { ref: 'main' }, head: { ref: 'docs/x', sha: HEAD }, merge_commit_sha: null },
    files: ['docs/release-notes.md'], runs: [run('test')], main: MAIN0, tree: { [MERGE]: 'T', [HEAD]: 'T' },
    calls: { merge: 0, getPull: 0 }, mergeImpl: null, ...over,
  };
  const gh = {
    s,
    async getPull() { s.calls.getPull++; if (s.getPullError) throw s.getPullError; return structuredClone(s.pr); },
    async listFiles() { return [...s.files]; },
    async listCheckRuns(sha) { return s.runs.filter((r) => r.head_sha === sha); },
    async merge(nr, sha) {
      s.calls.merge++;
      if (s.mergeImpl) return s.mergeImpl(sha);
      if (sha !== s.pr.head.sha) throw new ProviderError('Head branch was modified', { provider: 'github', kind: 'conflict', status: 409 });
      Object.assign(s.pr, { merged: true, state: 'closed', merge_commit_sha: MERGE }); s.main = MERGE; return { merged: true, sha: MERGE };
    },
    async getRefSha() { return s.main; },
    async isAncestor(a, b) { return a === b; },
    async getTree(sha) { return s.tree[sha] || null; },
  };
  return gh;
}
function deps(gh, extra = {}) {
  const audit = []; const outcomes = memoryOutcomeStore();
  return { audit, outcomes, args: { prNumber: 7, repo: 'o/r', github: gh, auditSink: async (e) => { audit.push(e); }, outcomes, lock: memoryLock(), now: () => new Date('2026-10-11T12:00:00Z'), ...extra } };
}

await t('PR R0 com checks verdes no SHA certo: merge com SHA fixado, auditoria antes e resultado depois', async () => {
  const gh = fakeGithub(); const d = deps(gh);
  const r = await runMerge(d.args);
  assert.equal(r.status, 'succeeded'); assert.equal(r.mergeCommitSha, MERGE); assert.equal(gh.s.calls.merge, 1);
  assert.equal(d.audit.length, 2, 'decisão inicial + decisão de revalidação (autorização)');
  assert.ok(d.audit.every((e) => e.decision === 'autonomous' && e.headSha === HEAD));
  assert.deepEqual(d.outcomes.events.map((e) => e.status), ['started', 'succeeded']);
  assert.equal(d.outcomes.events[0].authorizationEventId, d.audit[1].eventId, 'execução aponta para a autorização');
});

await t('check verde de SHA antigo não vale', async () => {
  const gh = fakeGithub({ runs: [run('test', 'success', OTHER)] }); const d = deps(gh);
  const r = await runMerge(d.args); assert.equal(r.status, 'blocked'); assert.match(r.reason, /check "ci".*ausente|não comprova/); assert.equal(gh.s.calls.merge, 0);
});

await t('PR com conflito ou mergeable ainda não calculado bloqueia', async () => {
  for (const pr of [{ mergeable: false, mergeable_state: 'dirty' }, { mergeable: null, mergeable_state: 'unknown' }]) {
    const gh = fakeGithub(); Object.assign(gh.s.pr, pr); const d = deps(gh);
    const r = await runMerge(d.args); assert.equal(r.status, 'blocked'); assert.match(r.reason, /conflitos/); assert.equal(gh.s.calls.merge, 0);
  }
});

await t('branch base diferente de main bloqueia; draft e PR fechado também', async () => {
  let gh = fakeGithub(); gh.s.pr.base.ref = 'develop'; assert.equal((await runMerge(deps(gh).args)).status, 'blocked');
  gh = fakeGithub(); gh.s.pr.draft = true; assert.match((await runMerge(deps(gh).args)).reason, /draft/);
  gh = fakeGithub(); gh.s.pr.state = 'closed'; assert.match((await runMerge(deps(gh).args)).reason, /não está aberto/);
});

await t('SHA muda entre avaliação e execução: bloqueia sem merge e registra o motivo', async () => {
  const gh = fakeGithub(); const d = deps(gh);
  let reads = 0; const orig = gh.getPull; gh.getPull = async () => { const p = await orig(); if (++reads >= 2) p.head.sha = OTHER; return p; };
  const r = await runMerge(d.args);
  assert.equal(r.status, 'blocked'); assert.match(r.reason, /evidência mudou.*headSha/); assert.equal(gh.s.calls.merge, 0);
  assert.equal(d.outcomes.events.at(-1).status, 'blocked');
});

await t('falha de autenticação ou API fora do ar no GitHub: bloqueia sem efeito', async () => {
  for (const kind of ['auth', 'unavailable', 'timeout']) {
    const gh = fakeGithub({ getPullError: new ProviderError('nope', { provider: 'github', kind }) });
    const r = await runMerge(deps(gh).args); assert.equal(r.status, 'blocked'); assert.match(r.reason, new RegExp(kind)); assert.equal(gh.s.calls.merge, 0);
  }
});

await t('auditoria indisponível: a ação protegida não começa (fail-closed)', async () => {
  const gh = fakeGithub(); const d = deps(gh, { auditSink: async () => { throw new Error('db fora'); } });
  await assert.rejects(runMerge(d.args), /db fora/); assert.equal(gh.s.calls.merge, 0);
  const d2 = deps(gh, {}); d2.args.outcomes = { latest: async () => null, record: async () => { throw new Error('outcome fora'); } };
  await assert.rejects(runMerge(d2.args), /outcome fora/); assert.equal(gh.s.calls.merge, 0, 'sem registro de "iniciada" não há merge');
});

await t('merge recusado pelo GitHub: failed, nada é marcado como concluído', async () => {
  const gh = fakeGithub({ mergeImpl: () => { throw new ProviderError('Required status check missing', { provider: 'github', kind: 'conflict', status: 405 }); } });
  const d = deps(gh); const r = await runMerge(d.args);
  assert.equal(r.status, 'failed'); assert.ok(!d.outcomes.events.some((e) => e.status === 'succeeded'));
});

await t('timeout no merge: verifica no GitHub; merge confirmado vira succeeded, não confirmado vira unknown', async () => {
  let gh = fakeGithub({ mergeImpl: () => { Object.assign(gh.s.pr, { merged: true, merge_commit_sha: MERGE }); gh.s.main = MERGE; throw new ProviderError('timeout', { provider: 'github', kind: 'timeout' }); } });
  let r = await runMerge(deps(gh).args); assert.equal(r.status, 'succeeded', 'confirmado no provedor apesar do timeout');
  gh = fakeGithub({ mergeImpl: () => { throw new ProviderError('timeout', { provider: 'github', kind: 'timeout' }); } });
  const d = deps(gh); r = await runMerge(d.args); assert.equal(r.status, 'unknown');
  // a mesma chave não é executada de novo às cegas
  const again = await runMerge(d.args); assert.equal(again.status, 'unknown'); assert.equal(gh.s.calls.merge, 1, 'sem segundo merge depois de resultado incerto');
});

await t('PR merged mas commit fora da main: unknown (não diz que concluiu)', async () => {
  const gh = fakeGithub({ mergeImpl: () => { Object.assign(gh.s.pr, { merged: true, merge_commit_sha: MERGE }); return { merged: true }; } });
  const r = await runMerge(deps(gh).args); assert.equal(r.status, 'unknown');
});

await t('retry idempotente: segunda execução não repete merge nem duplica eventos', async () => {
  const gh = fakeGithub(); const d = deps(gh);
  await runMerge(d.args); const ev = d.outcomes.events.length;
  // PR fechado: a segunda chamada já para no estado; com o PR "reaberto" no mesmo SHA, a chave idempotente impede repetir
  Object.assign(gh.s.pr, { state: 'open', merged: false });
  const r2 = await runMerge(d.args); assert.equal(r2.status, 'succeeded'); assert.equal(r2.idempotent, true);
  assert.equal(gh.s.calls.merge, 1); assert.equal(d.outcomes.events.length, ev);
});

await t('repetição depois do merge real (PR já fechado): succeeded idempotente pela auditoria; merge alheio bloqueia', async () => {
  const gh = fakeGithub(); const d = deps(gh);
  assert.equal((await runMerge(d.args)).status, 'succeeded'); const ev = d.outcomes.events.length;
  const r2 = await runMerge(d.args);
  assert.deepEqual([r2.status, r2.idempotent, r2.mergeCommitSha], ['succeeded', true, MERGE]);
  assert.equal(gh.s.calls.merge, 1); assert.equal(d.outcomes.events.length, ev, 'sem eventos novos');
  const gh2 = fakeGithub(); Object.assign(gh2.s.pr, { merged: true, state: 'closed', merge_commit_sha: MERGE });
  const r3 = await runMerge(deps(gh2).args); assert.equal(r3.status, 'blocked'); assert.match(r3.reason, /fora desta ponte/); assert.equal(gh2.s.calls.merge, 0);
});

await t('dois workers concorrentes: só um executa', async () => {
  const gh = fakeGithub(); const d = deps(gh);
  let release; const gate = new Promise((r) => { release = r; });
  gh.s.mergeImpl = async (sha) => { await gate; Object.assign(gh.s.pr, { merged: true, merge_commit_sha: MERGE }); gh.s.main = MERGE; return { merged: true, sha }; };
  const a = runMerge(d.args); await new Promise((r) => setTimeout(r, 10)); const b = await runMerge(d.args);
  release(); const ra = await a;
  assert.equal(b.status, 'busy'); assert.equal(ra.status, 'succeeded'); assert.equal(gh.s.calls.merge, 1);
});

await t('ação não autorizada: código (R2) e R3 nunca são autônomos', async () => {
  let gh = fakeGithub({ files: ['api/v1.mjs'] }); let r = await runMerge(deps(gh).args);
  assert.equal(r.status, 'blocked'); assert.match(r.reason, /regression|golden|rollback/); assert.equal(gh.s.calls.merge, 0);
  for (const f of ['src/agents/release-executor-bridge.js', '.github/workflows/ci.yml', 'db/migrations/012_x.sql', 'docs/ROADMAP-OPERACIONAL.md']) {
    gh = fakeGithub({ files: [f], runs: ['test', 'regression', 'golden', 'preview', 'accessibility'].map((x, i) => run(x, 'success', HEAD, i)) });
    r = await runMerge(deps(gh).args); assert.equal(r.status, 'human_required', f); assert.equal(gh.s.calls.merge, 0);
  }
});

await t('check runs: vale a execução mais recente de cada nome; em andamento não é success', () => {
  const c = normalizeCheckRuns([run('test', 'failure', HEAD, 1), { ...run('test', 'success', HEAD, 2), started_at: '2026-10-11T11:00:00Z' }, { id: 3, name: 'golden', status: 'in_progress', head_sha: HEAD }], HEAD);
  assert.deepEqual(c.map((x) => [x.name, x.status]).sort(), [['golden', 'in_progress'], ['test', 'success']]);
  assert.deepEqual(evidenceDrift({ evidence: { headSha: HEAD, checks: c }, changedPaths: ['a'] }, { evidence: { headSha: HEAD, checks: c }, changedPaths: ['a'] }), []);
});

await t('redação de credenciais nos registros de execução', async () => {
  const gh = fakeGithub({ mergeImpl: () => { throw new ProviderError('falhou com token ghp_' + 'x'.repeat(30) + ' e postgres://u:p@h/db', { provider: 'github', kind: 'conflict' }); } });
  const d = deps(gh); await runMerge(d.args);
  const all = JSON.stringify(d.outcomes.events) + JSON.stringify(d.audit);
  assert.doesNotMatch(all, /ghp_x{10}|postgres:\/\/u:p/); assert.match(all, /redigido/);
  assert.equal(redact('Bearer abc.def'), '[redigido]');
});

// ------------------------------------------------------------------ deploy
function fakeVercel(over = {}) {
  const s = { created: [], state: 'READY', sha: null, ...over };
  return { s,
    async createDeployment({ sha, target }) { if (s.createError) throw s.createError; const id = `dpl_${s.created.length}`; s.created.push({ id, sha, target }); return { id, state: 'BUILDING' }; },
    async getDeployment(id) { const d = s.created.find((x) => x.id === id); return { id, state: s.stateFor?.(d) ?? s.state, sha: s.shaFor?.(d) ?? s.sha ?? d.sha, url: `https://${id}.vercel.app`, target: d.target }; } };
}
const ROLLOUT = { rollback: { documented: true, tested: true }, rollout: { metricsDefined: true, rollbackTriggersDefined: true }, featureFlag: { applicable: false, reason: 'publicação de commit integrado' } };
function mergedGithub(files = ['index.html', 'test/x-tests.js']) {
  const gh = fakeGithub({ files, runs: ['test', 'regression', 'golden', 'accessibility'].map((x, i) => run(x, 'success', HEAD, i)), main: MERGE });
  Object.assign(gh.s.pr, { merged: true, state: 'closed', merge_commit_sha: MERGE }); return gh;
}
const okSmoke = async () => ({ ok: true, results: [{ path: '/', status: 200, ok: true }] });
const deployArgs = (gh, vercel, extra = {}) => { const d = deps(gh); return { d, args: { ...d.args, vercel, smoke: okSmoke, rollout: ROLLOUT, pollMs: 1, maxPolls: 3, ...extra } }; };

await t('deploy: Preview READY + smoke, Governor autoriza, produção READY no SHA exato, smoke de produção, auditado', async () => {
  const gh = mergedGithub(); const v = fakeVercel(); const { d, args } = deployArgs(gh, v);
  const r = await runDeploy(args);
  assert.equal(r.status, 'succeeded', r.reason); assert.deepEqual(v.s.created.map((x) => [x.target, x.sha]), [['preview', MERGE], ['production', MERGE]]);
  assert.deepEqual(d.audit.map((e) => [e.action, e.decision]), [[RELEASE_ACTION.DEPLOY, 'autonomous'], [RELEASE_ACTION.VERIFY_DEPLOY, 'autonomous']]);
  assert.deepEqual(d.outcomes.events.map((e) => e.status), ['started', 'succeeded']);
});

await t('deploy: falha de autenticação na Vercel bloqueia antes de produção', async () => {
  const v = fakeVercel({ createError: new ProviderError('Not authorized to access scope', { provider: 'vercel', kind: 'auth', status: 403 }) });
  const r = await runDeploy(deployArgs(mergedGithub(), v).args); assert.equal(r.status, 'blocked'); assert.match(r.reason, /Not authorized/);
});

await t('deploy: Preview que não chega a READY ou READY em outro SHA bloqueia', async () => {
  let r = await runDeploy(deployArgs(mergedGithub(), fakeVercel({ state: 'BUILDING' })).args); assert.equal(r.status, 'blocked');
  r = await runDeploy(deployArgs(mergedGithub(), fakeVercel({ sha: OTHER })).args); assert.equal(r.status, 'blocked'); assert.match(r.reason, /SHA/);
});

await t('deploy: produção READY em SHA diferente = failed; produção que não termina = unknown', async () => {
  let v = fakeVercel({ shaFor: (d) => (d.target === 'production' ? OTHER : d.sha) });
  let r = await runDeploy(deployArgs(mergedGithub(), v).args); assert.equal(r.status, 'failed'); assert.match(r.reason, /SHA diferente/);
  v = fakeVercel({ stateFor: (d) => (d.target === 'production' ? 'BUILDING' : 'READY') });
  r = await runDeploy(deployArgs(mergedGithub(), v).args); assert.equal(r.status, 'unknown');
});

await t('deploy: smoke da Preview falhando bloqueia; smoke de produção falhando = failed com rollback indicado', async () => {
  let r = await runDeploy(deployArgs(mergedGithub(), fakeVercel(), { smoke: async () => ({ ok: false, results: [] }) }).args);
  assert.equal(r.status, 'blocked'); assert.match(r.reason, /preview-smoke/);
  let calls = 0; const smoke = async () => ({ ok: ++calls === 1, results: [] });
  r = await runDeploy(deployArgs(mergedGithub(), fakeVercel(), { smoke }).args); assert.equal(r.status, 'failed'); assert.match(r.reason, /smoke de produção/);
});

await t('deploy: main avançou depois do merge, ou árvore diferente da testada: sem evidência, bloqueia', async () => {
  let gh = mergedGithub(); gh.s.main = OTHER; assert.equal((await runDeploy(deployArgs(gh, fakeVercel()).args)).status, 'blocked');
  gh = mergedGithub(); gh.s.tree[MERGE] = 'T2'; const r = await runDeploy(deployArgs(gh, fakeVercel()).args);
  assert.equal(r.status, 'blocked', 'checks do head não valem para árvore diferente');
});

await t('deploy: só documentação não exige deploy; R3 nunca é publicado sozinho', async () => {
  let v = fakeVercel(); let { d, args } = deployArgs(mergedGithub(['docs/x.md']), v);
  let r = await runDeploy(args); assert.equal(r.status, 'not_required'); assert.match(r.reason, /não inclui artefatos/);
  assert.equal(v.s.created.length, 0, 'não cria Preview'); assert.equal(d.audit.length, 1, 'decisão auditada');
  v = fakeVercel(); r = await runDeploy(deployArgs(mergedGithub(['vercel.json']), v).args); assert.equal(r.status, 'human_required'); assert.equal(v.s.created.length, 0);
  // sem token: o CLI passa um adaptador que só falha se for chamado; aqui nem é chamado
  const noToken = { createDeployment: async () => { throw new ProviderError('sem token', { provider: 'vercel', kind: 'auth' }); }, getDeployment: async () => { throw new Error('x'); } };
  r = await runDeploy(deployArgs(mergedGithub(['docs/x.md']), noToken).args); assert.equal(r.status, 'not_required');
  r = await runDeploy(deployArgs(mergedGithub(), noToken).args); assert.equal(r.status, 'blocked'); assert.match(r.reason, /sem token/);
});

await t('deploy R2 sem evidência de rollout/rollback: Governor bloqueia e produção não é tocada', async () => {
  const v = fakeVercel(); const { d, args } = deployArgs(mergedGithub(), v, { rollout: {} });
  const r = await runDeploy(args);
  assert.equal(r.status, 'blocked'); assert.match(r.reason, /rollback/);
  assert.deepEqual(v.s.created.map((x) => x.target), ['preview'], 'nenhum deploy de produção');
  assert.deepEqual(d.outcomes.events.map((e) => e.status), ['blocked']);
});

await t('CLI e workflows: sem rollout autodeclarado; worker de tarefas não alcança a ponte', async () => {
  const { default: fs } = await import('node:fs'); const { default: path } = await import('node:path'); const { fileURLToPath } = await import('node:url');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const cli = fs.readFileSync(path.join(root, 'tools/release-run.mjs'), 'utf8');
  assert.doesNotMatch(cli, /tested:\s*true|documented:\s*true|metricsDefined:\s*true|rollbackTriggersDefined:\s*true/, 'evidência R2 não pode ser constante no executor');
  const dir = path.join(root, '.github/workflows');
  for (const f of fs.readdirSync(dir)) {
    const y = fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
    assert.doesNotMatch(y, /release-run|release-executor-bridge|release-adapters/, `${f} não pode invocar a ponte`);
  }
  const tarefas = fs.readFileSync(path.join(dir, 'tarefas.yml'), 'utf8');
  const tools = (tarefas.match(/--allowedTools\s+"([^"]*)"/) || [])[1];
  assert.ok(tools, 'allowedTools explícito no worker');
  assert.doesNotMatch(tools, /node tools|Bash\(node\s*\*|Bash\(node:\*|gh pr merge|gh api|vercel/i, 'worker sem ferramentas de merge/deploy');
});

// ------------------------------------------------------------------ adaptadores (sem rede)
await t('adaptador GitHub: status HTTP vira classe de erro; merge envia o SHA', async () => {
  const fakeRun = (status, body) => (cmd, args, o, cb) => cb(status >= 400 ? Object.assign(new Error('x'), { code: 1 }) : null, `HTTP/2.0 ${status} OK\r\nX: y\r\n\r\n${body}`, '');
  await assert.rejects(ghApi({ run: fakeRun(401, '{"message":"Bad credentials"}') })('repos/o/r/pulls/1'), (e) => e.kind === 'auth');
  await assert.rejects(ghApi({ run: fakeRun(409, '{}') })('x'), (e) => e.kind === 'conflict');
  await assert.rejects(ghApi({ run: fakeRun(502, '{}') })('x'), (e) => e.kind === 'unavailable');
  await assert.rejects(ghApi({ run: (c, a, o, cb) => cb(Object.assign(new Error('t'), { killed: true }), '', '') })('x'), (e) => e.kind === 'timeout');
  const seen = []; const gh = githubAdapter({ repo: 'o/r', api: async (p, o = {}) => { seen.push([p, o]); return { merged: true }; } });
  await gh.merge(5, HEAD); assert.deepEqual(seen[0], ['repos/o/r/pulls/5/merge', { method: 'PUT', fields: { sha: HEAD, merge_method: 'merge' } }]);
  assert.throws(() => githubAdapter({ repo: 'o/r; rm -rf' }), /repo inválido/);
});

await t('adaptador Vercel: sem token não inicia; 403 vira auth; deploy pede o SHA exato do Git', async () => {
  assert.throws(() => vercelAdapter({ token: '' }), (e) => e.kind === 'auth');
  const v403 = vercelAdapter({ token: 'tok', teamId: 'team_x', project: 'p', org: 'o', repo: 'r', fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ error: { message: 'Not authorized to access scope' } }) }) });
  await assert.rejects(v403.createDeployment({ sha: HEAD, target: 'production' }), (e) => e.kind === 'auth' && e.status === 403);
  let sent; const v = vercelAdapter({ token: 'tok', teamId: 'team_x', project: 'p', org: 'o', repo: 'r', fetchImpl: async (url, init) => { sent = { url, body: JSON.parse(init.body) }; return { ok: true, status: 200, json: async () => ({ id: 'dpl_1', readyState: 'QUEUED', meta: { githubCommitSha: HEAD }, url: 'p-x.vercel.app' }) }; } });
  const d = await v.createDeployment({ sha: HEAD, target: 'production' });
  assert.match(sent.url, /\/v13\/deployments\?teamId=team_x$/); assert.deepEqual(sent.body.gitSource, { type: 'github', org: 'o', repo: 'r', ref: 'main', sha: HEAD }); assert.equal(sent.body.target, 'production');
  assert.deepEqual(d, { id: 'dpl_1', state: 'QUEUED', sha: HEAD, url: 'https://p-x.vercel.app', target: 'preview' });
});

await t('smoke HTTP: 200 com marcador passa; redirecionamento, erro e timeout reprovam', async () => {
  const f = async (url) => (url.endsWith('/ok') ? { status: 200, text: async () => 'TCG Price Hunter' } : url.endsWith('/redir') ? { status: 308, text: async () => '' } : (() => { throw new Error('ECONNREFUSED'); })());
  assert.equal((await smokeTest('https://x.app', [{ path: '/ok', contains: 'TCG Price Hunter' }], { fetchImpl: f })).ok, true);
  assert.equal((await smokeTest('https://x.app', ['/ok', '/redir'], { fetchImpl: f })).ok, false);
  assert.equal((await smokeTest('https://x.app', ['/erro'], { fetchImpl: f })).ok, false);
  assert.equal((await smokeTest('https://x.app', [], { fetchImpl: f })).ok, false, 'sem rotas não é aprovação');
});

// ------------------------------------------------------------------ PostgreSQL real (lock entre conexões, idempotência, auditoria)
if (!process.env.TEST_DATABASE_URL) {
  console.log('— testes de banco da Release Executor Bridge pulados (sem TEST_DATABASE_URL)');
} else {
  const saved = process.env.DATABASE_URL; process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const { pool, close } = await import('../src/db/pg.js');
  const { createPostgresReleaseAuditSink } = await import('../src/agents/release-governor-audit.js');
  const { execFileSync } = await import('node:child_process');
  const db = await pool();
  await db.query('DROP SCHEMA IF EXISTS hunter CASCADE');
  execFileSync('node', ['tools/db-migrate.mjs'], { env: process.env, stdio: 'pipe' });
  try {
    await t('PostgreSQL: lock distribuído entre duas conexões, idempotência e auditoria persistida', async () => {
      const lock = pgAdvisoryLock(db); const key = idempotencyKey('pr.merge', 'o/r', 7, HEAD);
      let inner; const outer = await lock(key, async () => { inner = await pgAdvisoryLock(db)(key, async () => 'não deveria'); return 'ok'; });
      assert.deepEqual(outer, { locked: true, value: 'ok' }); assert.deepEqual(inner, { locked: false }, 'outra conexão não pega o mesmo lock');
      assert.deepEqual(await lock(key, async () => 1), { locked: true, value: 1 }, 'lock solto ao sair');
      const gh = fakeGithub(); const outcomes = pgOutcomeStore(db);
      const args = { prNumber: 7, repo: 'o/r', github: gh, auditSink: createPostgresReleaseAuditSink(db), outcomes, lock, now: () => new Date('2026-10-11T12:00:00Z') };
      assert.equal((await runMerge(args)).status, 'succeeded');
      Object.assign(gh.s.pr, { state: 'open', merged: false });
      assert.equal((await runMerge(args)).idempotent, true); assert.equal(gh.s.calls.merge, 1);
      const rows = (await db.query(`SELECT type, payload->>'status' AS st FROM hunter.system_event WHERE type IN ('RELEASE_GOVERNOR_DECISION','RELEASE_EXECUTION') ORDER BY id`)).rows;
      assert.deepEqual(rows.filter((r) => r.type === 'RELEASE_EXECUTION').map((r) => r.st), ['started', 'succeeded'], 'sem evento duplicado no retry');
      assert.ok(rows.filter((r) => r.type === 'RELEASE_GOVERNOR_DECISION').length >= 2);
    });
  } finally { await close(); process.env.DATABASE_URL = saved; }
}

console.log(`✓ Release Executor Bridge: ${n} grupos de testes passaram`);
