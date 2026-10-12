// Telemetria do worker.
//   node tools/telemetria.mjs registrar  → lê o execution_file e o contexto do run (env), imprime o corpo do
//                                          comentário em stdout e grava o resumo no GITHUB_STEP_SUMMARY.
//                                          Não usa rede nem token: quem posta é o passo "Resultado na issue".
//   node tools/telemetria.mjs resumo [--desde AAAA-MM-DD] [--json] → somente leitura (gh): agrega os registros
//                                          dos comentários do bot do workflow e o custo por PR integrada.
// Env de `registrar`: EXECUTION_FILE, PERFIL, ISSUE, CHAVE, RUN_ID, RUN_ATTEMPT, STATUS, PR_URL, GITHUB_REPOSITORY.
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { buildRecord, formatComment, parseRecords, summarize } from '../src/agents/telemetria.js';

const REPO = process.env.GITHUB_REPOSITORY || 'TonyWatanabe-dev/pokemon-price-hunter';
if (!/^[\w.-]+\/[\w.-]+$/.test(REPO)) { console.error('repositório inválido'); process.exit(2); }
const [mode, ...rest] = process.argv.slice(2);

function lerExecucao(file) {
  if (!file) return null;
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > 200 * 1024 * 1024) return null;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(data) ? data : null;
  } catch { return null; }
}

if (mode === 'registrar') {
  const e = process.env;
  const rec = buildRecord({ messages: lerExecucao(e.EXECUTION_FILE), issue: e.ISSUE, chave: e.CHAVE, perfil: e.PERFIL,
    runId: e.RUN_ID, runAttempt: e.RUN_ATTEMPT, status: e.STATUS, prUrl: e.PR_URL, repo: REPO });
  if (rec.issue === null) { console.error('issue inválida'); process.exit(2); }
  const body = formatComment(rec);
  if (e.GITHUB_STEP_SUMMARY) fs.appendFileSync(e.GITHUB_STEP_SUMMARY, `\n${body.replace(/\n<!-- [\s\S]*$/, '')}\n`);
  process.stdout.write(body);
} else if (mode === 'resumo') {
  const i = rest.indexOf('--desde'); const desde = i >= 0 ? rest[i + 1] : null;
  if (desde !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(desde))) { console.error('use --desde AAAA-MM-DD'); process.exit(2); }
  const gh = (args) => new Promise((resolve, reject) => execFile('gh', args, { maxBuffer: 100 * 1024 * 1024, timeout: 120_000 },
    (err, out, errOut) => (err ? reject(new Error(String(errOut || err.message).slice(0, 300))) : resolve(out))));
  const q = `per_page=100${desde ? `&since=${desde}T00:00:00Z` : ''}`;
  const raw = JSON.parse((await gh(['api', '--paginate', '--slurp', `repos/${REPO}/issues/comments?${q}`])) || '[]').flat();
  const recs = parseRecords(raw.filter((c) => c.body?.includes('telemetria:execucao')).map((c) => ({ author: c.user?.login, body: c.body })));
  const prs = [...new Set(recs.map((r) => r.resultado?.pr).filter(Boolean))];
  const merged = [];
  for (const n of prs) { const p = JSON.parse(await gh(['api', `repos/${REPO}/pulls/${n}`])); if (p.merged_at) merged.push(n); }
  const s = summarize(recs, { prsIntegradas: merged });
  if (rest.includes('--json')) { console.log(JSON.stringify(s, null, 2)); process.exit(0); }
  const usd = (v) => (v === null ? 'n/d' : `US$ ${v.toFixed(2)}`);
  console.log(`Telemetria do worker${desde ? ` desde ${desde}` : ''}: ${s.execucoes} execução(ões), ${s.sucesso} com PR, ${s.falhas} sem entrega, ${s.escaladas} escalada(s).`);
  console.log(`Custo reportado: ${usd(s.custoUsdReportado.soma)} (${s.custoUsdReportado.execucoesSemCusto} sem dado) · por PR integrada: ${usd(s.custoPorPrIntegrada)} (${s.prsIntegradas} PR).`);
  console.log(`Tokens: entrada ${s.tokens.entrada}, saída ${s.tokens.saida}, cache leitura ${s.tokens.cacheLeitura}, cache criação ${s.tokens.cacheCriacao} · ${s.semExecutionFile} execução(ões) sem execution_file.`);
  for (const x of s.porIssue) console.log(`  #${x.issue}: ${x.execucoes} exec., ${x.escaladas} escalada(s), ${usd(x.semCusto === x.execucoes ? null : x.custoUsdReportado)}, PR ${x.prs.map((p) => `#${p}`).join(', ') || '—'}${x.prIntegrada ? ' (integrada)' : ''}`);
} else {
  console.error('uso: telemetria.mjs registrar | resumo [--desde AAAA-MM-DD] [--json]'); process.exit(2);
}
