// Burn-in da fábrica 24/7: avalia ontem e hoje (Brasília) com dados reais e publica um comentário por dia na issue
// aberta pelo operador com o label `burnin:diario` (atualiza o de hoje; finaliza o de ontem; dia final não muda).
// Uso: node tools/burnin.mjs [--publicar] [--meta caminho/meta.json] [--now ISO]
//   sem --publicar: só imprime (somente leitura). Requer `gh` autenticado (GH_TOKEN).
// Fontes: API do Actions (hunter.yml, watchdog.yml, dispatcher.yml, tarefas.yml), data/meta.json (ops.runs) e a
// telemetria do worker. Erro de leitura: o dia não é publicado (nunca um veredito com dado faltando silencioso).
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { avaliarDia, formatarDia, parseDias, planoPublicacao, sequenciaVerde, janelaDia, diaSP, DIA_MS } from '../src/agents/burnin.js';
import { parseRecords, summarize } from '../src/agents/telemetria.js';

const REPO = process.env.GITHUB_REPOSITORY || 'TonyWatanabe-dev/pokemon-price-hunter';
if (!/^[\w.-]+\/[\w.-]+$/.test(REPO)) { console.error('repo inválido'); process.exit(2); }
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : undefined; };
const PUBLICAR = args.includes('--publicar');
const now = opt('now') ? Date.parse(opt('now')) : Date.now();
if (!Number.isFinite(now)) { console.error('--now inválido'); process.exit(2); }
const OPERADOR = String(process.env.TAREFAS_OPERADORES || REPO.split('/')[0]).split(',')[0].trim();
const ATOR = 'github-actions[bot]';

const gh = (a, input) => new Promise((resolve, reject) => {
  const p = execFile('gh', a, { maxBuffer: 50 * 1024 * 1024, timeout: 60_000 }, (err, out, errOut) => (err ? reject(new Error(String(errOut || err.message).slice(0, 300))) : resolve(out)));
  if (input !== undefined) { p.stdin.end(input); }
});
const api = async (path) => JSON.parse((await gh(['api', path])) || 'null');
/** Paginação explícita (o proxy de algumas sessões recusa os links de paginação), limitada. */
async function pages(path, pick = (x) => x, max = 20) {
  const out = [];
  for (let page = 1; page <= max; page++) {
    const batch = pick(await api(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`)) || [];
    out.push(...batch); if (batch.length < 100) return out;
  }
  throw new Error(`paginação excedeu ${max} páginas: ${path.split('?')[0]}`);
}

const ontem = diaSP(now - DIA_MS); const hoje = diaSP(now);
const [desde] = janelaDia(ontem);
const desdeIso = new Date(desde).toISOString();
const runs = async (wf) => pages(`repos/${REPO}/actions/workflows/${wf}/runs?created=>=${desdeIso}`, (r) => r?.workflow_runs)
  .then((rs) => rs.map((r) => ({ created_at: r.created_at, status: r.status, conclusion: r.conclusion, event: r.event })));

async function meta() {
  const f = opt('meta');
  if (f) return JSON.parse(fs.readFileSync(f, 'utf8'));
  return JSON.parse(await gh(['api', '-H', 'Accept: application/vnd.github.raw', `repos/${REPO}/contents/data/meta.json?ref=data`]));
}

const [hunter, vigia, dispatcher, tarefas, m, coments] = await Promise.all([
  runs('hunter.yml'), runs('watchdog.yml'), runs('dispatcher.yml'), runs('tarefas.yml'), meta(),
  pages(`repos/${REPO}/issues/comments?since=${desdeIso}`),
]);
const opsRuns = Array.isArray(m?.ops?.runs) ? m.ops.runs : [];
const tele = parseRecords(coments.filter((c) => String(c.body || '').includes('telemetria:execucao')).map((c) => ({ author: c.user?.login, body: c.body })));
const teleDia = (dia) => { const [a, b] = janelaDia(dia); return summarize(tele.filter((r) => { const t = Date.parse(r.em); return t >= a && t < b; })); };
const av = Object.fromEntries([ontem, hoje].map((dia) => [dia, avaliarDia({ dia, now, hunter, vigia, dispatcher, tarefas, opsRuns, telemetria: teleDia(dia) })]));

// issue de acompanhamento: aberta pelo operador, label burnin:diario
const issues = (await api(`repos/${REPO}/issues?state=open&labels=burnin:diario&creator=${encodeURIComponent(OPERADOR)}&per_page=10`) || []).filter((i) => !i.pull_request);
const issue = issues.sort((a, b) => a.number - b.number)[0] || null;
const existentes = issue ? parseDias((await pages(`repos/${REPO}/issues/${issue.number}/comments`)).map((c) => ({ id: c.id, author: c.user?.login, body: c.body })), { trustedAuthor: ATOR }) : new Map();
const todos = new Map([...existentes].map(([d, e]) => [d, e.avaliacao]));
for (const [d, a] of Object.entries(av)) if (!todos.get(d)?.final) todos.set(d, a);
const seq = sequenciaVerde([...todos.values()]);

const linhas = [`## Burn-in 24/7 — sequência verde: ${seq}/7`, ''];
for (const p of planoPublicacao(existentes, now)) {
  const body = formatarDia(av[p.dia], { sequencia: seq });
  linhas.push(body.replace(/\n<!-- [\s\S]*$/, ''), '');
  if (!PUBLICAR || p.acao === 'manter') continue;
  if (!issue) continue;
  if (p.acao === 'criar') await gh(['api', `repos/${REPO}/issues/${issue.number}/comments`, '-f', `body=${body}`]);
  else await gh(['api', '-X', 'PATCH', `repos/${REPO}/issues/comments/${p.commentId}`, '-f', `body=${body}`]);
}
if (!issue) linhas.push(`_Sem issue aberta pelo operador com o label \`burnin:diario\`: nada publicado._`);
const text = linhas.join('\n');
console.log(text);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + '\n');
