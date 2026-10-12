// Sink de auditoria GitHub da Release Executor Bridge (opção C, #231 item 3 / #237). Sem rede: API simulada.
// Prova: um comentário por evento com marcador parseável (ida e volta), fail-closed em qualquer falha (a ponte
// não faz merge), redação de segredos, nenhum `-->` dentro do marcador, config ausente falha e default inalterado.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMerge, memoryOutcomeStore, memoryLock } from '../src/agents/release-executor-bridge.js';
import { githubIssueAuditSink, formatAuditComment, parseAuditMarkers, auditEventsFromComments, parseAuditSinkConfig, ghApi } from '../src/agents/release-adapters.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HEAD = 'a'.repeat(40); const MERGE = 'c'.repeat(40);
const ACTOR = 'pph-release-bot';
let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };

// GitHub simulado só para comentários de issue
function fakeIssueApi({ actor = ACTOR, issue = 99, fail = null, mutate = null } = {}) {
  const s = { comments: [], calls: [] };
  const api = async (p, { method = 'GET', fields = {} } = {}) => {
    s.calls.push({ p, method });
    if (fail) { const r = fail(p, method); if (r) throw r; }
    let m = p.match(/^repos\/([^/]+\/[^/]+)\/issues\/(\d+)\/comments$/);
    if (m && method === 'POST') {
      const c = { id: 1000 + s.comments.length, body: fields.body, user: { login: actor }, issue_url: `https://api.github.com/repos/${m[1]}/issues/${m[2]}` };
      s.comments.push(c);
      return mutate ? mutate('post', structuredClone(c)) : structuredClone(c);
    }
    m = p.match(/^repos\/[^/]+\/[^/]+\/issues\/comments\/(\d+)$/);
    if (m && method === 'GET') {
      const c = s.comments.find((x) => x.id === Number(m[1]));
      if (!c) throw Object.assign(new Error('GitHub 404'), { kind: 'not_found', status: 404 });
      return mutate ? mutate('get', structuredClone(c)) : structuredClone(c);
    }
    throw new Error(`rota inesperada: ${method} ${p}`);
  };
  return { s, api, issue };
}

const run = (name, sha = HEAD, id = 1) => ({ id, name, status: 'completed', conclusion: 'success', head_sha: sha, started_at: '2026-10-11T10:00:00Z' });
function fakeGithub() {
  const s = { pr: { state: 'open', draft: false, merged: false, mergeable: true, mergeable_state: 'clean', base: { ref: 'main' }, head: { ref: 'docs/x', sha: HEAD }, merge_commit_sha: null }, main: 'd'.repeat(40), merges: 0 };
  return { s,
    async getPull() { return structuredClone(s.pr); },
    async listFiles() { return ['docs/release-notes.md']; },
    async listCheckRuns(sha) { return [run('test', sha), run('qa-review', sha, 2)]; },
    async merge() { s.merges++; Object.assign(s.pr, { merged: true, state: 'closed', merge_commit_sha: MERGE }); s.main = MERGE; return { merged: true, sha: MERGE }; },
    async getRefSha() { return s.main; }, async isAncestor(a, b) { return a === b; }, async getTree() { return 'T'; } };
}
const mergeArgs = (gh, auditSink) => ({ prNumber: 7, repo: 'o/r', github: gh, auditSink, outcomes: memoryOutcomeStore(), lock: memoryLock(), now: () => new Date('2026-10-11T12:00:00Z') });
const sampleEvent = (extra = {}) => ({ schemaVersion: 1, component: 'release-governor', action: 'pr.merge', decision: 'autonomous', risk: 'R0', headSha: HEAD, eventId: 'e'.repeat(64), ...extra });

await t('caminho feliz: ponte faz merge com cada decisão auditada em UM comentário da issue, marcador parseável (ida e volta)', async () => {
  const f = fakeIssueApi(); const gh = fakeGithub();
  const audited = [];
  const sink = githubIssueAuditSink({ repo: 'o/r', issueNumber: 99, expectedActor: ACTOR, api: f.api });
  const r = await runMerge(mergeArgs(gh, async (e) => { audited.push(e); return sink(e); }));
  assert.equal(r.status, 'succeeded'); assert.equal(gh.s.merges, 1);
  assert.equal(f.s.comments.length, audited.length); assert.equal(audited.length, 2, 'decisão inicial + autorização');
  const back = auditEventsFromComments(f.s.comments, ACTOR);
  assert.deepEqual(back.map((e) => e.eventId), audited.map((e) => e.eventId));
  assert.deepEqual(back[0], JSON.parse(JSON.stringify(audited[0])), 'evento sem segredos volta idêntico');
  for (const c of f.s.comments) {
    assert.match(c.body, /^Auditoria da Ponte · release-governor · pr\.merge · autonomous · R0 · sha aaaaaaaaaaaa · evento [a-f0-9]{12}\n/);
    assert.equal((c.body.match(/<!-- ponte:auditoria v=1 /g) || []).length, 1, 'um marcador por comentário');
  }
  assert.ok(f.s.calls.filter((c) => c.method === 'GET').length === 2, 'cada comentário é relido pelo id');
});

await t('falha da API do GitHub: ponte bloqueia (lança) e não faz merge', async () => {
  const cases = [
    () => Object.assign(new Error('GitHub 403 em comments'), { kind: 'auth', status: 403 }),
    () => Object.assign(new Error('GitHub 502'), { kind: 'unavailable', status: 502 }),
  ];
  for (const err of cases) {
    const f = fakeIssueApi({ fail: (p, m) => (m === 'POST' ? err() : null) }); const gh = fakeGithub();
    const sink = githubIssueAuditSink({ repo: 'o/r', issueNumber: 99, expectedActor: ACTOR, api: f.api });
    await assert.rejects(runMerge(mergeArgs(gh, sink)), /GitHub/); assert.equal(gh.s.merges, 0);
  }
  // falha HTTP real pelo ghApi (non-2xx vira erro)
  const fakeRun = (cmd, args, o, cb) => cb(Object.assign(new Error('x'), { code: 1 }), 'HTTP/2.0 500 Internal\r\n\r\n{"message":"boom"}', '');
  const sink = githubIssueAuditSink({ repo: 'o/r', issueNumber: 99, expectedActor: ACTOR, api: ghApi({ run: fakeRun }) });
  const gh = fakeGithub(); await assert.rejects(runMerge(mergeArgs(gh, sink)), /GitHub 500/); assert.equal(gh.s.merges, 0);
});

await t('resposta sem id, leitura de volta divergente ou autor inesperado: fail-closed sem merge', async () => {
  const variants = [
    (k, c) => (k === 'post' ? { ...c, id: undefined } : c),                          // sem id
    (k, c) => (k === 'get' ? { ...c, body: 'editado' } : c),                         // marcador sumiu
    (k, c) => (k === 'get' ? { ...c, user: { login: 'intruso' } } : c),               // outro autor
    (k, c) => (k === 'get' ? { ...c, issue_url: 'https://api.github.com/repos/o/r/issues/1' } : c),  // outra issue
    (k, c) => (k === 'get' ? { ...c, body: c.body.replace(/"eventId":"[a-f0-9]+"/, '"eventId":"' + '0'.repeat(64) + '"') } : c),
  ];
  for (const mutate of variants) {
    const f = fakeIssueApi({ mutate }); const gh = fakeGithub();
    const sink = githubIssueAuditSink({ repo: 'o/r', issueNumber: 99, expectedActor: ACTOR, api: f.api });
    await assert.rejects(runMerge(mergeArgs(gh, sink)), /auditoria GitHub/); assert.equal(gh.s.merges, 0);
  }
});

await t('sanitização: tokens e credenciais em URL redigidos; JSON sem < > e sem "-->"', async () => {
  const secret = 'ghp_' + 'A'.repeat(36);
  const ev = sampleEvent({ missingEvidence: [`token ${secret}`, 'veja https://user:senha@exemplo.com/x', 'postgres://u:p@h/db', 'fim --> <script>alert(1)</script>'], actor: 'Bearer abc.def' });
  const body = formatAuditComment(ev);
  assert.doesNotMatch(body, new RegExp(secret)); assert.doesNotMatch(body, /senha|u:p@|Bearer abc/);
  const marker = body.slice(body.indexOf('<!--'));
  assert.equal(marker.indexOf('-->'), marker.length - 3, 'único "-->" é o que fecha o marcador');
  const json = marker.match(/^<!-- ponte:auditoria v=1 (.*) -->$/)[1];
  assert.doesNotMatch(json, /[<>]/);
  const [parsed] = parseAuditMarkers(body);
  assert.equal(parsed.eventId, ev.eventId); assert.match(parsed.missingEvidence[3], /fim --> <script>/, 'conteúdo inofensivo preservado após o parse');
  assert.match(parsed.missingEvidence[0], /\[redigido\]/); assert.match(parsed.missingEvidence[1], /https:\/\/\[redigido\]@exemplo\.com/);
  // linha humana não carrega @menções nem markdown do evento
  assert.doesNotMatch(formatAuditComment(sampleEvent({ component: '@dono [x](http://a)' })).split('\n')[0], /@|\[|\(/);
  assert.throws(() => formatAuditComment({ eventId: 'curto' }), /eventId/);
  assert.throws(() => formatAuditComment(sampleEvent({ blob: Array.from({ length: 100 }, () => 'x'.repeat(1900)) })), /grande demais/);
});

await t('leitura: só marcadores do ator esperado contam', async () => {
  const good = { user: { login: ACTOR }, body: formatAuditComment(sampleEvent()) };
  const forged = { user: { login: 'outro' }, body: formatAuditComment(sampleEvent({ eventId: 'f'.repeat(64), decision: 'autonomous' })) };
  assert.deepEqual(auditEventsFromComments([good, forged], ACTOR).map((e) => e.eventId), ['e'.repeat(64)]);
  assert.throws(() => auditEventsFromComments([good], ''), /ator esperado/);
  assert.deepEqual(parseAuditMarkers('<!-- ponte:auditoria v=1 {quebrado} -->'), []);
});

await t('configuração ausente ou inválida falha fechado; default continua PostgreSQL', async () => {
  for (const bad of [{ repo: 'x' }, { issueNumber: 0 }, { issueNumber: 1.5 }, { issueNumber: '9' }, { expectedActor: '' }, { expectedActor: 'a b' }, { api: null }]) {
    assert.throws(() => githubIssueAuditSink({ repo: 'o/r', issueNumber: 9, expectedActor: ACTOR, api: async () => ({}), ...bad }), /auditoria GitHub/);
  }
  assert.deepEqual(parseAuditSinkConfig({}), { kind: 'postgres' });
  assert.deepEqual(parseAuditSinkConfig({ RELEASE_AUDIT_SINK: '' }), { kind: 'postgres' });
  assert.deepEqual(parseAuditSinkConfig({ RELEASE_AUDIT_ISSUE: '5', RELEASE_AUDIT_ACTOR: ACTOR }), { kind: 'postgres' }, 'só a issue não ativa o sink');
  assert.deepEqual(parseAuditSinkConfig({ RELEASE_AUDIT_SINK: 'github', RELEASE_AUDIT_ISSUE: '42', RELEASE_AUDIT_ACTOR: ACTOR }), { kind: 'github', issueNumber: 42, expectedActor: ACTOR });
  for (const env of [{ RELEASE_AUDIT_SINK: 'github', RELEASE_AUDIT_ACTOR: ACTOR }, { RELEASE_AUDIT_SINK: 'github', RELEASE_AUDIT_ISSUE: 'abc', RELEASE_AUDIT_ACTOR: ACTOR },
    { RELEASE_AUDIT_SINK: 'github', RELEASE_AUDIT_ISSUE: '-3', RELEASE_AUDIT_ACTOR: ACTOR }, { RELEASE_AUDIT_SINK: 'github', RELEASE_AUDIT_ISSUE: '0', RELEASE_AUDIT_ACTOR: ACTOR },
    { RELEASE_AUDIT_SINK: 'github', RELEASE_AUDIT_ISSUE: '42' }, { RELEASE_AUDIT_SINK: 'arquivo' }]) {
    assert.throws(() => parseAuditSinkConfig(env), /RELEASE_AUDIT/);
  }
});

await t('CLI: default inalterado (PostgreSQL) e sink=github inválido sai antes de tocar em DB ou GitHub', async () => {
  const cli = fs.readFileSync(path.join(root, 'tools/release-run.mjs'), 'utf8');
  assert.match(cli, /auditConfig\.kind === 'github'\s*\?\s*githubIssueAuditSink\([^)]*\)\s*:\s*createPostgresReleaseAuditSink\(db\)/, 'sem config, o sink continua o PostgreSQL');
  assert.ok(cli.indexOf('parseAuditSinkConfig(process.env)') < cli.indexOf("import('../src/db/pg.js')"), 'config validada antes de abrir o banco');
  // PATH sem `gh` e DATABASE_URL inalcançável: se o script passasse da validação, ainda assim não haveria efeito
  const env = { PATH: path.dirname(process.execPath), DATABASE_URL: 'postgres://ninguem@127.0.0.1:1/nada', RELEASE_AUDIT_SINK: 'github', RELEASE_AUDIT_ISSUE: 'abc', RELEASE_REPO: 'o/r' };
  let code = 0; let err = '';
  try { execFileSync(process.execPath, [path.join(root, 'tools/release-run.mjs'), 'merge', '--pr', '1'], { env, stdio: 'pipe', timeout: 15_000 }); }
  catch (e) { code = e.status; err = String(e.stderr); }
  assert.equal(code, 3); assert.match(err, /auditoria mal configurada: RELEASE_AUDIT_SINK=github exige RELEASE_AUDIT_ISSUE/);
});

console.log(`✓ Sink de auditoria GitHub da Ponte: ${n} grupos de testes passaram`);
