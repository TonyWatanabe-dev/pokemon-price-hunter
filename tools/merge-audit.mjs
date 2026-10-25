#!/usr/bin/env node
// Auditoria pós-merge dos checks obrigatórios (só leitura). Para cada PR integrada, confere se os checks exigidos
// pela proteção da main (test, regression, golden, qa-review) estavam CONCLUÍDOS e verdes no SHA da cabeça da PR
// ANTES do merge. Check que terminou depois do merge (ou nunca terminou) indica merge com bypass administrativo
// (a proteção tem enforce_admins desligado): o resultado verde que aparece depois não era evidência no momento do merge.
// Não faz merge, não comenta, não grava nada. Uso:
//   node tools/merge-audit.mjs --prs 903,904,905      (PRs específicas)
//   node tools/merge-audit.mjs --ultimas 30           (últimas N PRs integradas)
//   [--repo dono/repo] [--json]
// Sai com 1 se alguma PR auditada tiver check ausente, falho ou concluído depois do merge; 0 se todas passaram.
import { execFileSync } from 'node:child_process';
import { comRetry } from './gh-retry.mjs';

export const REQUIRED = Object.freeze(['test', 'regression', 'golden', 'qa-review']);

const ts = (s) => { const t = Date.parse(s || ''); return Number.isFinite(t) ? t : null; };

/** Execução mais recente de cada nome (re-run substitui a anterior, como no GitHub e na Release Executor Bridge). */
export function latestByName(checkRuns) {
  const latest = new Map();
  const order = (x) => [ts(x.started_at) ?? ts(x.completed_at) ?? 0, Number(x.id) || 0];
  for (const r of Array.isArray(checkRuns) ? checkRuns : []) {
    if (!r || typeof r.name !== 'string') continue;
    const k = r.name.trim().toLowerCase(); const prev = latest.get(k);
    if (!prev) { latest.set(k, r); continue; }
    const [a, b] = [order(r), order(prev)];
    if (a[0] > b[0] || (a[0] === b[0] && a[1] > b[1])) latest.set(k, r);
  }
  return latest;
}

/**
 * Audita um merge. `checkRuns` são os check runs do SHA da cabeça da PR (API commits/{sha}/check-runs).
 * Retorna { ok, missing, failed, late } — late = concluído depois do merge ou ainda sem conclusão.
 * Sem mergedAt válido (PR não integrada) não há o que auditar: ok=null.
 */
export function auditMerge({ mergedAt, checkRuns, required = REQUIRED }) {
  const m = ts(mergedAt);
  if (m == null) return { ok: null, missing: [], failed: [], late: [], reason: 'PR sem merged_at válido' };
  const latest = latestByName(checkRuns);
  const missing = []; const failed = []; const late = [];
  for (const name of required) {
    const r = latest.get(name.toLowerCase());
    if (!r) { missing.push(name); continue; }
    const done = r.status === 'completed' ? ts(r.completed_at) : null;
    if (done == null || done > m) late.push(name);
    if (r.status === 'completed' && r.conclusion !== 'success') failed.push(`${name}=${r.conclusion || 'sem conclusão'}`);
  }
  return { ok: !missing.length && !failed.length && !late.length, missing, failed, late };
}

// ---------------------------------------------------------------- CLI (gh autenticado; só GET)
const gh = (args) => comRetry((a) => JSON.parse(execFileSync('gh', a, { encoding: 'utf8', maxBuffer: 32 << 20 })), args);

export async function main(argv = process.argv.slice(2), { api = gh, log = console.log } = {}) {
  const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : null; };
  const repo = opt('repo') || process.env.GITHUB_REPOSITORY || 'TonyWatanabe-dev/pokemon-price-hunter';
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) { log('repositório inválido'); return 2; }
  let prs;
  if (opt('prs')) {
    prs = opt('prs').split(',').map((x) => Number(x.trim()));
    if (!prs.length || prs.some((n) => !Number.isInteger(n) || n <= 0)) { log('uso: --prs 1,2,3 (números de PR)'); return 2; }
  } else {
    const n = Math.min(100, Math.max(1, Number(opt('ultimas')) || 30));
    const closed = await api(['api', `repos/${repo}/pulls?state=closed&base=main&sort=updated&direction=desc&per_page=100`]);
    prs = closed.filter((p) => p.merged_at).sort((a, b) => ts(b.merged_at) - ts(a.merged_at)).slice(0, n).map((p) => p.number);
  }
  const rows = [];
  for (const n of prs) {
    const pr = await api(['api', `repos/${repo}/pulls/${n}`]);
    const runs = pr.merged_at ? (await api(['api', `repos/${repo}/commits/${pr.head.sha}/check-runs?per_page=100`])).check_runs : [];
    rows.push({ pr: n, mergedAt: pr.merged_at || null, mergedBy: pr.merged_by?.login || null, sha: pr.head?.sha?.slice(0, 10) || null,
      ...auditMerge({ mergedAt: pr.merged_at, checkRuns: runs }) });
  }
  if (argv.includes('--json')) log(JSON.stringify(rows, null, 2));
  else {
    for (const r of rows) {
      const st = r.ok === null ? 'não integrada' : r.ok ? 'ok' : 'VIOLAÇÃO';
      const det = [r.missing.length && `ausente: ${r.missing.join(',')}`, r.failed.length && `falhou: ${r.failed.join(',')}`,
        r.late.length && `concluído depois do merge: ${r.late.join(',')}`].filter(Boolean).join('; ');
      log(`#${r.pr} ${st}${r.mergedAt ? ` (merge ${r.mergedAt} por ${r.mergedBy || '?'}, head ${r.sha})` : ''}${det ? ` — ${det}` : ''}`);
    }
    const bad = rows.filter((r) => r.ok === false).length;
    log(`\n${rows.length} PR(s) auditadas; ${bad} com check obrigatório ausente, falho ou concluído depois do merge.`);
  }
  return rows.some((r) => r.ok === false) ? 1 : 0;
}

if (process.argv[1]?.endsWith('merge-audit.mjs')) process.exitCode = await main();
