// Revalida, dentro do worker (tarefas.yml), um despacho recebido por workflow_dispatch (#234).
// Uso: node tools/validar-despacho.mjs <issue> <chave>   (GH_TOKEN só leitura de issues, no passo que chama)
// Saída: com despacho válido, grava branch=tarefa/issue-N-tA em $GITHUB_OUTPUT e sai 0; senão sai 1 (fail-closed).
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { validateDispatchRequest, sanitize } from '../src/agents/dispatcher.js';

const REPO = process.env.GITHUB_REPOSITORY || 'TonyWatanabe-dev/pokemon-price-hunter';
const [issueArg, key] = process.argv.slice(2);
const fail = (reason) => {
  const msg = `Despacho recusado: ${sanitize(reason)}`;
  console.error(msg);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, msg + '\n');
  process.exit(1);
};
if (!/^[\w.-]+\/[\w.-]+$/.test(REPO)) fail('repo inválido');
if (!/^\d{1,7}$/.test(String(issueArg ?? ''))) fail('número de issue inválido');

const gh = (args) => new Promise((resolve, reject) => execFile('gh', args, { maxBuffer: 50 * 1024 * 1024, timeout: 60_000 },
  (err, stdout, stderr) => (err ? reject(new Error(String(stderr || err.message).slice(0, 300))) : resolve(stdout))));
const pages = async (path) => JSON.parse((await gh(['api', '--paginate', '--slurp', path])) || '[]').flat();

let issue;
try {
  const i = JSON.parse(await gh(['api', `repos/${REPO}/issues/${issueArg}`]));
  if (i.pull_request) fail('o número informado é uma PR');
  const [events, comments] = await Promise.all([pages(`repos/${REPO}/issues/${i.number}/events?per_page=100`), pages(`repos/${REPO}/issues/${i.number}/comments?per_page=100`)]);
  issue = {
    number: i.number, title: i.title, body: i.body || '', state: i.state, author: i.user?.login,
    labels: (i.labels || []).map((l) => l.name),
    labelEvents: events.filter((e) => e.event === 'labeled' || e.event === 'unlabeled').map((e) => ({ event: e.event, label: e.label?.name, actor: e.actor?.login, createdAt: e.created_at })),
    comments: comments.map((c) => ({ id: c.id, author: c.user?.login, body: c.body })),
  };
} catch (e) { fail(`GitHub indisponível: ${e.message}`); }

const v = validateDispatchRequest({ issueNumber: issueArg, key, issue, operators: process.env.TAREFAS_OPERADORES || REPO.split('/')[0], dispatcherActor: process.env.DISPATCHER_ATOR || 'github-actions[bot]' });
if (!v.ok) fail(v.reason);
const attempt = key.split(':')[2];
const branch = `tarefa/issue-${issue.number}-t${attempt}`;
console.log(`Despacho válido: #${issue.number}, tentativa ${attempt}, branch ${branch}`);
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `branch=${branch}\n`);
