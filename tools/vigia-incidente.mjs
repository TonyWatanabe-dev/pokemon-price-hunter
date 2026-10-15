// Issue de incidente do Vigia (src/ops-incident.js). Lê o resumo da checagem (VIGIA_JSON, saída do job `check`
// do watchdog.yml) e as issues abertas do bot; aplica UMA ação idempotente: criar, comentar, fechar ou nada.
// Uso: VIGIA_JSON='{…}' node tools/vigia-incidente.mjs [--dry-run]
// Requisitos: `gh` autenticado (GH_TOKEN com issues: write). Não lê secrets, dados de produção nem altera nada além
// da issue do incidente. A busca é pelo autor (bot) + marcador no corpo, não pelo label (que pode não ser aplicado).
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { planIncident, findIncident, parseResumo, TRUSTED_AUTHOR } from '../src/ops-incident.js';

const REPO = process.env.GITHUB_REPOSITORY || 'TonyWatanabe-dev/pokemon-price-hunter';
if (!/^[\w.-]+\/[\w.-]+$/.test(REPO)) { console.error('repo inválido'); process.exit(2); }
const DRY = process.argv.includes('--dry-run');

const gh = (args) => new Promise((resolve, reject) => execFile('gh', args, { maxBuffer: 20 * 1024 * 1024, timeout: 60_000 },
  (err, stdout, stderr) => (err ? reject(new Error(String(stderr || err.message).replace(/[\r\n]+/g, ' ').slice(0, 200))) : resolve(stdout))));
const pages = async (path) => JSON.parse((await gh(['api', '--paginate', '--slurp', path])) || '[]').flat();

export async function main({ env = process.env, log = console.log, ghImpl = null } = {}) {
  const call = ghImpl || gh;
  const list = ghImpl ? async (p) => JSON.parse((await call(['api', '--paginate', '--slurp', p])) || '[]').flat() : pages;
  const resumo = parseResumo(env.VIGIA_JSON || '');
  if (!resumo) { log('Vigia/incidente: resumo ausente ou inválido — nada a fazer.'); return { type: 'none', reason: 'resumo inválido' }; }
  const runUrl = env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL || 'https://github.com'}/${REPO}/actions/runs/${env.GITHUB_RUN_ID}` : null;

  const open = (await list(`repos/${REPO}/issues?state=open&creator=${encodeURIComponent(TRUSTED_AUTHOR)}&per_page=100`))
    .map((i) => ({ number: i.number, state: i.state, author: i.user?.login, body: i.body || '', pull_request: i.pull_request }));
  const found = findIncident(open);
  const comments = found ? (await list(`repos/${REPO}/issues/${found.number}/comments?per_page=100`)).map((c) => ({ author: c.user?.login, body: c.body || '' })) : [];
  const plan = planIncident({ resumo, openIssues: open, comments, runUrl });
  log(`Vigia/incidente: ${plan.type}${plan.issue ? ` #${plan.issue}` : ''}${plan.reason ? ` — ${plan.reason}` : ''}`);
  if (DRY || plan.type === 'none') return plan;

  if (plan.type === 'create') {
    const out = JSON.parse(await call(['api', `repos/${REPO}/issues`, '-f', `title=${plan.title}`, '-f', `body=${plan.body}`, ...plan.labels.flatMap((l) => ['-f', `labels[]=${l}`])]));
    log(`Vigia/incidente: issue #${out.number} criada.`); return { ...plan, issue: out.number };
  }
  await call(['api', `repos/${REPO}/issues/${plan.issue}/comments`, '-f', `body=${plan.body}`]);
  if (plan.type === 'close') await call(['api', '-X', 'PATCH', `repos/${REPO}/issues/${plan.issue}`, '-f', 'state=closed', '-f', 'state_reason=completed']);
  return plan;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) {
  main().then((p) => { if (process.env.GITHUB_STEP_SUMMARY) { try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Vigia — incidente: ${p.type}${p.issue ? ` #${p.issue}` : ''}\n`); } catch { /* opcional */ } } })
    .catch((e) => { console.error('Vigia/incidente falhou:', String(e?.message || e).slice(0, 200)); process.exitCode = 2; });
}
