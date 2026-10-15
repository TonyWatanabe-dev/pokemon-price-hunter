// Dispatcher da fila de tarefas (src/agents/dispatcher.js). Lê issues/PRs pela API do GitHub e mostra o plano.
// Uso: node tools/dispatcher.mjs [--executar] [--json plano.json]
//   padrão: só planeja (nenhuma escrita). --executar: grava marcador, aplica quarentena e dispara o worker.
// Requisitos: `gh` autenticado (GH_TOKEN). Variáveis: TAREFAS_OPERADORES (padrão: dono do repo), TAREFAS_MAX
// (1..50, padrão 3), DISPATCHER_ATOR (autor dos marcadores, padrão github-actions[bot]), DISPATCHER_PAUSA_ATE (ISO),
// DISPATCHER_MAX_DESPACHOS_JANELA (teto de despachos na janela do orçamento; 1..500, padrão 60; inválido pausa).
// --executar falha fechado se o tarefas.yml não declarar `workflow_dispatch` com a entrada `issue`.
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { planDispatch, applyPlan, parseDependencies, sanitize, budgetConfig, dispatchCapConfig, countDispatchesInWindow, rateLimitPause, QUEUE_LABEL, LABELS } from '../src/agents/dispatcher.js';
import { budgetGate } from '../src/agents/esforco.js';
import { parseRecords, gastoNaJanela } from '../src/agents/telemetria.js';
import { workerAcceptsDispatchYaml } from './dispatcher-workflow-check.mjs';

const REPO = process.env.GITHUB_REPOSITORY || process.env.RELEASE_REPO || 'TonyWatanabe-dev/pokemon-price-hunter';
if (!/^[\w.-]+\/[\w.-]+$/.test(REPO)) { console.error('repo inválido'); process.exit(2); }
const args = process.argv.slice(2);
const EXECUTAR = args.includes('--executar');
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;

const gh = (ghArgs) => new Promise((resolve, reject) => execFile('gh', ghArgs, { maxBuffer: 50 * 1024 * 1024, timeout: 60_000 },
  (err, stdout, stderr) => (err ? reject(new Error(String(stderr || err.message).slice(0, 300))) : resolve(stdout))));
const api = async (path) => JSON.parse((await gh(['api', path])) || 'null');
const pages = async (path) => JSON.parse((await gh(['api', '--paginate', '--slurp', path])) || '[]').flat();

async function snapshot() {
  const now = new Date().toISOString();
  const operators = process.env.TAREFAS_OPERADORES || REPO.split('/')[0];
  // pausa por rate limit: com pouca cota de API ou leitura falhando (fail-closed), não despacha (a fila fica intacta)
  const rateLimit = rateLimitPause(await api('rate_limit').catch((e) => e), { now });
  const pauseUntil = rateLimit.pauseUntil || process.env.DISPATCHER_PAUSA_ATE || null;

  const byN = new Map();
  for (const label of [QUEUE_LABEL, LABELS.RUNNING, LABELS.QUEUED]) {
    for (const i of await pages(`repos/${REPO}/issues?state=open&per_page=100&labels=${encodeURIComponent(label)}`)) if (!i.pull_request) byN.set(i.number, i);
  }
  const issues = [];
  for (const i of byN.values()) {
    const events = await pages(`repos/${REPO}/issues/${i.number}/events?per_page=100`);
    const comments = await pages(`repos/${REPO}/issues/${i.number}/comments?per_page=100`);
    issues.push({
      number: i.number, title: i.title, body: i.body || '', state: i.state, author: i.user?.login,
      labels: (i.labels || []).map((l) => l.name),
      labelEvents: events.filter((e) => e.event === 'labeled' || e.event === 'unlabeled').map((e) => ({ event: e.event, label: e.label?.name, actor: e.actor?.login, createdAt: e.created_at })),
      comments: comments.map((c) => ({ id: c.id, author: c.user?.login, body: c.body })),
    });
  }
  const issueStates = {};
  for (const d of new Set(issues.flatMap((i) => parseDependencies(i.body)))) {
    issueStates[d] = byN.get(d)?.state || (await api(`repos/${REPO}/issues/${d}`).catch(() => null))?.state || 'unknown';
  }
  const pulls = (await pages(`repos/${REPO}/pulls?state=open&per_page=100`)).map((p) => ({ number: p.number, headRef: p.head?.ref, body: p.body || '' }));
  const porCiclo = Number(process.env.DISPATCHER_POR_CICLO);
  const dispatcherActor = process.env.DISPATCHER_ATOR || 'github-actions[bot]';
  const janela = janelaComments(now);
  return { now, operators, maxSlots: process.env.TAREFAS_MAX, maxPerCycle: Number.isInteger(porCiclo) && porCiclo > 0 && porCiclo <= 50 ? porCiclo : undefined, pauseUntil, rateLimit: rateLimit.motivo, budget: await budget(now, janela), dispatchCap: await dispatchCap(now, janela, dispatcherActor), dispatcherActor, issues, pulls, issueStates };
}

// Comentários da janela (orçamento e teto de despachos), lidos uma vez só. Promessa: quem usa trata a falha.
function janelaComments(now) {
  const { janelaMs } = budgetConfig(process.env);
  const desde = new Date(Date.parse(now) - janelaMs).toISOString();
  const p = (async () => {
    // paginação explícita (page=N), limitada; mais que isso na janela é anomalia → erro (fail-closed com limite)
    const raw = [];
    for (let page = 1; ; page++) {
      if (page > 30) throw new Error('comentários demais na janela');
      const batch = await api(`repos/${REPO}/issues/comments?since=${desde}&per_page=100&page=${page}`);
      raw.push(...(batch || []));
      if (!batch || batch.length < 100) break;
    }
    return raw;
  })();
  p.catch(() => {});
  return p;
}

// Teto de despachos na janela pelos marcadores do próprio Dispatcher (independe do custo reportado).
// Leitura falhando ou variável inválida: { erro } → o plano pausa (fail-closed).
async function dispatchCap(now, janela, dispatcherActor) {
  const { limite, erro } = dispatchCapConfig(process.env);
  const { janelaMs } = budgetConfig(process.env);
  if (erro) return { erro: `${erro}: despacho pausado até corrigir a variável` };
  try {
    const raw = await janela;
    const usados = countDispatchesInWindow(raw.filter((c) => String(c.body || '').includes('dispatcher:despacho')).map((c) => ({ id: c.id, author: c.user?.login, body: c.body })),
      { desde: Date.parse(now) - janelaMs, dispatcherActor });
    return { limite, usados, janelaH: janelaMs / 3600e3 };
  } catch (e) { return { erro: `leitura dos despachos da janela falhou (${sanitize(e.message, 120)})` }; }
}

// Orçamento pela telemetria real (comentários `telemetria:execucao` do bot do workflow na janela).
// Sem limite configurado: só informa. Com limite e leitura falhando: pausa (fail-closed).
async function budget(now, janela) {
  const { limiteUsd, janelaMs, erro } = budgetConfig(process.env);
  if (erro) return { permitir: false, motivo: `${erro}: despacho pausado até corrigir a variável` };
  try {
    const raw = await janela;
    const recs = parseRecords(raw.filter((c) => String(c.body || '').includes('telemetria:execucao')).map((c) => ({ author: c.user?.login, body: c.body })));
    const gastoUsd = gastoNaJanela(recs, { now: Date.parse(now), janelaMs });
    const g = budgetGate({ gastoUsd, limiteUsd });
    const h = janelaMs / 3600e3;
    return { ...g, motivo: `${g.motivo} · gasto reportado em ${h} h: ${gastoUsd === null ? 'n/d' : `US$ ${gastoUsd.toFixed(2)}`} (${recs.length} registro(s))` };
  } catch (e) {
    return limiteUsd === null ? { permitir: true, motivo: 'telemetria indisponível; sem limite configurado' }
      : { permitir: false, motivo: `telemetria indisponível com limite configurado (${sanitize(e.message, 120)})` };
  }
}

function workerAcceptsDispatch() {
  const y = fs.readFileSync(new URL('../.github/workflows/tarefas.yml', import.meta.url), 'utf8');
  return workerAcceptsDispatchYaml(y);
}

const s = await snapshot();
const plan = planDispatch(s);
const lines = [`## Dispatcher — ${EXECUTAR ? 'execução' : 'plano (sem escrita)'}`, '', `Vagas: ${plan.slots} · em curso: ${plan.active.map((x) => '#' + x).join(', ') || 'nenhuma'}${plan.paused ? ` · **pausado (${plan.budget && !plan.budget.permitir ? 'orçamento' : plan.dispatchCap && (plan.dispatchCap.limite === null || plan.dispatchCap.usados >= plan.dispatchCap.limite) ? 'teto de despachos' : 'rate limit/quota'})**` : ''}`,
  `Rate limit: ${s.rateLimit}`, ...(plan.budget ? [`Orçamento: ${plan.budget.motivo}`] : []), ...(plan.dispatchCap ? [`Teto de despachos: ${plan.dispatchCap.motivo}`] : []), '',
  ...plan.dispatch.map((d) => `- despachar #${d.issue} (tentativa ${d.attempt}, chave \`${d.key}\`)`),
  ...plan.quarantine.map((q) => `- quarentena #${q.issue}: ${q.reason}`),
  ...plan.skipped.map((x) => `- aguardando #${x.issue}: ${x.reason}`)];
let results = null;
if (EXECUTAR) {
  if (!workerAcceptsDispatch()) { console.error('tarefas.yml não aceita workflow_dispatch com a entrada "issue": nada foi despachado.'); process.exit(3); }
  results = await applyPlan(plan, s, {
    async reload(nr) {
      const [i, comments] = await Promise.all([api(`repos/${REPO}/issues/${nr}`), pages(`repos/${REPO}/issues/${nr}/comments?per_page=100`)]);
      const events = await pages(`repos/${REPO}/issues/${nr}/events?per_page=100`);
      return { number: i.number, title: i.title, body: i.body || '', state: i.state, author: i.user?.login, labels: (i.labels || []).map((l) => l.name),
        labelEvents: events.filter((e) => e.event === 'labeled' || e.event === 'unlabeled').map((e) => ({ event: e.event, label: e.label?.name, actor: e.actor?.login, createdAt: e.created_at })),
        comments: comments.map((c) => ({ id: c.id, author: c.user?.login, body: c.body })) };
    },
    async comment(nr, body) { const c = JSON.parse(await gh(['api', `repos/${REPO}/issues/${nr}/comments`, '-f', `body=${body}`])); return { id: c.id }; },
    async addLabel(nr, label) { await gh(['api', `repos/${REPO}/issues/${nr}/labels`, '-f', `labels[]=${label}`]); },
    async dispatch(nr, key) { await gh(['workflow', 'run', 'tarefas.yml', '--repo', REPO, '-f', `issue=${nr}`, '-f', `chave=${key}`]); },
  });
  lines.push('', '### Resultado', ...results.map((r) => `- #${r.issue}: ${r.status}${r.reason ? ` — ${r.reason}` : ''}`));
}
const text = lines.join('\n');
console.log(text);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + '\n');
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ plan, results }, null, 2) + '\n');
