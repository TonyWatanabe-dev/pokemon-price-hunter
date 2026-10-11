// Executa uma ação protegida pela Release Executor Bridge (src/agents/release-executor-bridge.js).
// Uso:
//   node tools/release-run.mjs merge  --pr 123 [--avaliar]
//   node tools/release-run.mjs deploy --pr 123            (publica o commit atual da main, se for o merge desse PR)
// Requisitos (fail-closed): `gh` autenticado com permissão de merge no repositório; DATABASE_URL (auditoria e lock
// em hunter.system_event); para deploy, VERCEL_TOKEN com acesso ao projeto (VERCEL_TEAM_ID / VERCEL_PROJECT).
// --avaliar: só lê evidências e mostra a decisão do Governor (sem lock, sem efeito, auditoria em memória).
import { runMerge, runDeploy, readPullRequestEvidence, smokeTest, memoryOutcomeStore } from '../src/agents/release-executor-bridge.js';
import { githubAdapter, vercelAdapter } from '../src/agents/release-adapters.js';
import { evaluateRelease, RELEASE_ACTION } from '../src/agents/release-governor.js';

const REPO = process.env.RELEASE_REPO || 'TonyWatanabe-dev/pokemon-price-hunter';
const SITE_ROUTES = [{ path: '/', contains: 'TCG Price Hunter' }, '/oportunidades', '/precos', '/api/v1/home', '/api/v1/oportunidades?limite=1'];
const args = process.argv.slice(2); const cmd = args[0];
const opt = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : null; };
const pr = Number(opt('pr'));
const out = (o) => console.log(JSON.stringify(o, null, 2));
if (!['merge', 'deploy'].includes(cmd) || !Number.isInteger(pr) || pr <= 0) { console.error('uso: release-run.mjs merge|deploy --pr N [--avaliar]'); process.exit(2); }

const github = githubAdapter({ repo: REPO });
if (args.includes('--avaliar')) {
  const ev = await readPullRequestEvidence(github, pr);
  out({ pr, state: ev.state, evidence: ev.evidence, decision: evaluateRelease({ changedPaths: ev.changedPaths, evidence: ev.evidence, action: RELEASE_ACTION.MERGE }) });
  process.exit(0);
}

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL ausente: sem auditoria persistente não há ação protegida.'); process.exit(3); }
const { pool, close } = await import('../src/db/pg.js');
const { createPostgresReleaseAuditSink } = await import('../src/agents/release-governor-audit.js');
const { pgOutcomeStore, pgAdvisoryLock } = await import('../src/agents/release-executor-bridge.js');
const db = await pool();
const deps = { repo: REPO, github, auditSink: createPostgresReleaseAuditSink(db), outcomes: pgOutcomeStore(db), lock: pgAdvisoryLock(db), actor: process.env.RELEASE_ACTOR || 'release-executor' };
let r;
try {
  if (cmd === 'merge') r = await runMerge({ prNumber: pr, ...deps });
  else {
    const [org, name] = REPO.split('/');
    const vercel = vercelAdapter({ token: process.env.VERCEL_TOKEN, teamId: process.env.VERCEL_TEAM_ID, project: process.env.VERCEL_PROJECT || 'tcg-price-hunter', org, repo: name });
    r = await runDeploy({ prNumber: pr, ...deps, vercel, smoke: (url) => smokeTest(url, SITE_ROUTES),
      rollout: { rollback: { documented: true, tested: true }, rollout: { metricsDefined: true, rollbackTriggersDefined: true }, featureFlag: { applicable: false, reason: 'publicação de commit já integrado; rollback = promover o deploy anterior' } } });
  }
} catch (e) { r = { status: 'error', reason: String(e.message).slice(0, 300) }; }
finally { await close().catch(() => {}); }
out(r);
process.exit(r.status === 'succeeded' ? 0 : r.status === 'busy' ? 75 : 1);
