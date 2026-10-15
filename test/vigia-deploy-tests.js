// Vigia / SRE (Fase 7, item 5): deploy de produção degradado. O último deployment "Production" (API do GitHub,
// criado pela integração da Vercel) em failure/error ou preso em pending deixa o estado degradado; sem dado, nada muda.
// Só leitura: o workflow ganha `deployments: read` e nenhuma permissão de escrita.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { evaluate, decide, deployIssues, RULES, CODE_LABEL } from '../src/ops-watch.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };
const NOW = '2026-10-15T12:00:00.000Z';
const iso = (m) => new Date(Date.parse(NOW) + m * 6e4).toISOString();
const SHA = '4fb454f286856fa8b446d9455b1f4d465263a07b';
const dep = (statuses, createdMin = -20) => ({ deployment: { sha: SHA, created_at: iso(createdMin), environment: 'Production' }, statuses });
const st = (state, m) => ({ state, created_at: iso(m) });
const runs = Array.from({ length: 3 }, (_, i) => ({ status: 'completed', conclusion: 'success', createdAt: iso(-15 * i - 7), updatedAt: iso(-15 * i) }));
const ops = { last: { generatedAt: iso(-5) }, runs: [] };
const base = { now: NOW, stateGeneratedAt: iso(-5), meta: { ops }, runs };

await t('deployIssues: failure/error → deploy_falhou; vale o status mais recente, em qualquer ordem', () => {
  assert.equal(RULES.DEPLOY_STUCK_MIN, 30);
  for (const s of ['failure', 'error', 'FAILURE']) {
    const r = deployIssues(dep([st('pending', -19), st(s, -15)]), NOW);
    assert.deepEqual(r.map((x) => x.code), ['deploy_falhou'], s);
    assert.match(r[0].text, /4fb454f/); assert.doesNotMatch(r[0].text, /4fb454f2/, 'SHA curto');
  }
  assert.deepEqual(deployIssues(dep([st('failure', -15), st('success', -10)]), NOW), [], 'novo sucesso depois da falha');
  assert.deepEqual(deployIssues(dep([st('success', -10), st('failure', -15)]), NOW), [], 'ordem da API não importa');
});

await t('deployIssues: pendente além de DEPLOY_STUCK_MIN → deploy_preso; dentro do prazo, nada', () => {
  assert.deepEqual(deployIssues(dep([st('pending', -40)], -40), NOW).map((x) => x.code), ['deploy_preso']);
  assert.deepEqual(deployIssues(dep([st('in_progress', -35)], -45), NOW).map((x) => x.code), ['deploy_preso']);
  assert.deepEqual(deployIssues(dep([], -45), NOW).map((x) => x.code), ['deploy_preso'], 'sem status nenhum há 45 min');
  assert.deepEqual(deployIssues(dep([st('pending', -10)], -10), NOW), []);
  assert.deepEqual(deployIssues(dep([], -10), NOW), []);
});

await t('deployIssues: sem dado, dado inválido, success ou inactive não avisam', () => {
  for (const d of [null, undefined, {}, { deployment: null }, 'x', dep([st('success', -5)]), dep([st('inactive', -5)]),
    { deployment: { sha: 'zzz', created_at: 'ontem' }, statuses: [{ state: 'failure', created_at: 'ontem' }] }]) assert.deepEqual(deployIssues(d, NOW), [], JSON.stringify(d));
  assert.match(deployIssues({ deployment: { sha: 'não-sha', created_at: iso(-20) }, statuses: [st('error', -10)] }, NOW)[0].text, /\(\?,/, 'SHA inválido não vai para o texto');
});

await t('evaluate: deploy falho deixa degradado com o motivo; sem deploy, saudável como antes', () => {
  assert.equal(evaluate(base).status, 'saudavel');
  assert.equal(evaluate({ ...base, deploy: null }).status, 'saudavel');
  const ev = evaluate({ ...base, deploy: dep([st('failure', -15)]) });
  assert.equal(ev.status, 'degradado'); assert.deepEqual(ev.reasons.map((r) => r.code), ['deploy_falhou']);
  const d = decide(ev, null, NOW);
  assert.equal(d.notify.kind, 'falha'); assert.match(d.notify.text, /deploy de produção/);
  assert.ok(CODE_LABEL.deploy_falhou && CODE_LABEL.deploy_preso);
  // dados parados continuam vencendo (o deploy não mascara o robô parado)
  assert.equal(evaluate({ ...base, stateGeneratedAt: iso(-90), deploy: dep([st('failure', -15)]) }).status, 'parado');
});

await t('watchdog.mjs: --deploy lido do arquivo; arquivo ausente ou ilegível não derruba o Vigia', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-deploy-'));
  const w = (f, o) => fs.writeFileSync(path.join(tmp, f), typeof o === 'string' ? o : JSON.stringify(o));
  w('state.json', { generatedAt: iso(-5) }); w('meta.json', { ops }); w('runs.json', runs);
  let k = 0;
  const run = async (deployArg) => {
    const saved = process.argv;
    process.argv = [saved[0], saved[1], '--state', path.join(tmp, 'state.json'), '--meta', path.join(tmp, 'meta.json'), '--runs', path.join(tmp, 'runs.json'), '--now', NOW, '--dry-run', ...deployArg];
    try { const m = await import(pathToFileURL(path.join(root, 'tools/watchdog.mjs')).href + '?deploy=' + (++k)); return await m.main({ env: {}, fetchImpl: async () => ({ ok: true }), log: () => {} }); }
    finally { process.argv = saved; }
  };
  w('deploy.json', dep([st('error', -12)]));
  const r = await run(['--deploy', path.join(tmp, 'deploy.json')]);
  assert.equal(r.status, 'degradado'); assert.deepEqual(r.reasons, ['deploy_falhou']);
  w('ruim.json', '{"deployment": [trunc');
  assert.equal((await run(['--deploy', path.join(tmp, 'ruim.json')])).status, 'saudavel');
  assert.equal((await run(['--deploy', path.join(tmp, 'nao-existe.json')])).status, 'saudavel');
  assert.equal((await run([])).status, 'saudavel');
});

await t('watchdog.yml: deployments só leitura, sem escrita nova; leitura tolerante; passa --deploy', () => {
  const y = fs.readFileSync(path.join(root, '.github/workflows/watchdog.yml'), 'utf8');
  assert.match(y, /permissions:\s*\n\s*contents: read\s*\n\s*actions: read\s*\n\s*deployments: read\s*\n/);
  // job da checagem (e permissões do topo) sem escrita; outro job, se existir, declara as próprias permissões
  const check = y.split('\n  check:\n')[1].split(/\n  [\w-]+:\n/)[0];
  const topo = y.split('\njobs:\n')[0];
  assert.doesNotMatch(check, /:\s*write\b/, 'job check sem escrita'); assert.doesNotMatch(topo, /:\s*write\b/, 'permissões do topo sem escrita');
  assert.match(y, /deployments\?environment=Production&per_page=1/);
  assert.match(y, /\|\| rm -f wd\/deploy\.json/);
  assert.match(y, /--ledger wd\/ledger\.json --deploy wd\/deploy\.json/);
  assert.doesNotMatch(y, /gh api[^\n]*(-X|--method)\s*(POST|PATCH|PUT|DELETE)/i, 'só GET');
});

console.log(`vigia-deploy: ${n} testes ok`);
