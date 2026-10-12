// Plano do Dispatcher (#234) com dados reais do GitHub, SOMENTE LEITURA: não aplica label, não dispara workflow.
// Uso: node tools/dispatcher-plan.mjs [--repo dono/nome] [--json]
// Operadores: TAREFAS_OPERADORES (vírgulas) ou o dono do repositório. Vagas: TAREFAS_MAX (padrão 3).
// O disparo real fica para o workflow do dispatcher (workflow_dispatch autenticado do tarefas.yml).
import { execFileSync } from 'node:child_process';
import { planDispatch, historyFromEvents, parseTask, APPROVAL_LABEL } from '../src/agents/dispatcher.js';

const args = process.argv.slice(2);
const repo = (args.includes('--repo') ? args[args.indexOf('--repo') + 1] : process.env.GITHUB_REPOSITORY) || 'TonyWatanabe-dev/pokemon-price-hunter';
if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) { console.error('repo inválido'); process.exit(2); }
const gh = (path) => JSON.parse(execFileSync('gh', ['api', '-H', 'Accept: application/vnd.github+json', path], { encoding: 'utf8', maxBuffer: 20 << 20 }) || 'null');
const R = `repos/${repo}`;

const operators = (process.env.TAREFAS_OPERADORES || repo.split('/')[0]).split(',').map((s) => s.trim()).filter(Boolean);
const maxSlots = Number.parseInt(process.env.TAREFAS_MAX || '3', 10) || 3;

// candidatas: aprovadas + as que ocupam vaga no worker
const byNum = new Map();
for (const label of [APPROVAL_LABEL, 'executor:github', 'executor:running'])
  for (const i of gh(`${R}/issues?state=open&per_page=100&labels=${encodeURIComponent(label)}`)) if (!i.pull_request) byNum.set(i.number, i);
const issues = [...byNum.values()];

const approvals = new Map(); const history = new Map();
for (const i of issues) {
  const ev = gh(`${R}/issues/${i.number}/events?per_page=100`);
  const ap = ev.filter((e) => e.event === 'labeled' && e.label?.name === APPROVAL_LABEL).at(-1);
  if (ap) approvals.set(i.number, ap.actor?.login);
  history.set(i.number, historyFromEvents(i.number, ev));
}
const closedIssues = new Set();
for (const d of new Set(issues.flatMap((i) => parseTask(i).deps))) { try { if (gh(`${R}/issues/${d}`).state === 'closed') closedIssues.add(d); } catch {} }
const openPrIssues = new Set();
for (const p of gh(`${R}/pulls?state=open&per_page=100`)) {
  for (const m of String(p.body || '').matchAll(/(?:closes|fixes|resolves|refs)\s+#(\d+)/gi)) openPrIssues.add(Number(m[1]));
  const b = String(p.head?.ref || '').match(/issue-(\d+)/); if (b) openPrIssues.add(Number(b[1]));
}

const plan = planDispatch({ issues, approvals, closedIssues, openPrIssues, history, operators, maxSlots, now: new Date() });
if (args.includes('--json')) console.log(JSON.stringify(plan, null, 2));
else {
  console.log(`Dispatcher (somente leitura) · ${repo} · operadores: ${operators.join(', ')} · vagas: ${maxSlots}`);
  console.log(`candidatas: ${issues.length} · despachar: ${plan.dispatch.map((d) => '#' + d.n).join(', ') || '—'} · na fila: ${plan.waiting.map((x) => '#' + x).join(', ') || '—'} · vagas livres: ${plan.freeSlots}`);
  for (const s of plan.skipped) console.log(`  #${s.n}: ${s.reason}`);
}
