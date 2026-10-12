// Perfil de sessão (modelo/esforço/turnos) para uma issue, a partir de dados reais do GitHub (somente leitura).
// Uso: node tools/esforco.mjs <issue>      → imprime classe, motivos e perfil; com GITHUB_OUTPUT grava `args`
//                                            (multilinha) e `classe`, para o worker usar em claude_args.
// Falhas anteriores = rótulos executor:failed desde o último executor:done (mesma regra do Dispatcher).
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { classifyTask, profileFor, claudeArgs } from '../src/agents/esforco.js';

const REPO = process.env.GITHUB_REPOSITORY || 'TonyWatanabe-dev/pokemon-price-hunter';
const n = process.argv[2];
if (!/^[\w.-]+\/[\w.-]+$/.test(REPO) || !/^\d{1,7}$/.test(String(n ?? ''))) { console.error('uso: esforco.mjs <issue>'); process.exit(2); }
const gh = (args) => new Promise((resolve, reject) => execFile('gh', args, { maxBuffer: 50 * 1024 * 1024, timeout: 60_000 },
  (err, out, errOut) => (err ? reject(new Error(String(errOut || err.message).slice(0, 300))) : resolve(out))));

const issue = JSON.parse(await gh(['api', `repos/${REPO}/issues/${n}`]));
const events = JSON.parse((await gh(['api', '--paginate', '--slurp', `repos/${REPO}/issues/${n}/events?per_page=100`])) || '[]').flat();
let failures = 0;
for (const e of events.filter((x) => x.event === 'labeled').sort((a, b) => a.created_at.localeCompare(b.created_at))) {
  if (e.label?.name === 'executor:failed') failures++;
  else if (e.label?.name === 'executor:done') failures = 0;
}
const c = classifyTask({ labels: (issue.labels || []).map((l) => l.name), title: issue.title, body: issue.body || '', failures });
const p = profileFor(c.classe, failures);
const args = claudeArgs(p);
console.log(`#${n} · classe ${c.classe} · falhas ${failures} · ${p.model}/${p.effort}/${p.maxTurns} turnos${p.escalada ? ' (escalado)' : ''}`);
for (const m of c.motivos) console.log(`  - ${m}`);
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `classe=${c.classe}\nargs<<EOF_ESFORCO\n${args}\nEOF_ESFORCO\n`);
