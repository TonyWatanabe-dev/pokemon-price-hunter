// tools/merge-audit.mjs: auditoria pós-merge dos 4 checks obrigatórios (só leitura, sem rede no teste).
// Casos baseados em PRs reais de 24/10/2026 (#903, #904, #905), com timestamps copiados da API de check-runs.
import assert from 'node:assert/strict';
import { auditMerge, latestByName, main, REQUIRED } from '../tools/merge-audit.mjs';

const run = (name, started, completed, conclusion = 'success', id = 1) => ({ id, name, status: completed ? 'completed' : 'in_progress', conclusion: completed ? conclusion : null, started_at: started, completed_at: completed });

assert.deepEqual([...REQUIRED], ['test', 'regression', 'golden', 'qa-review']);

// Merge depois de todos os checks verdes: ok
const verdes = [run('test', '2026-10-24T21:05:00Z', '2026-10-24T21:10:35Z'), run('regression', '2026-10-24T21:05:00Z', '2026-10-24T21:07:03Z'),
  run('golden', '2026-10-24T21:05:00Z', '2026-10-24T21:05:26Z'), run('qa-review', '2026-10-24T21:05:00Z', '2026-10-24T21:06:11Z'), run('conclude-linked-tasks', '2026-10-24T21:10:50Z', null)];
assert.deepEqual(auditMerge({ mergedAt: '2026-10-24T21:10:47Z', checkRuns: verdes }), { ok: true, missing: [], failed: [], late: [] });

// #905: merge 20:41:05 com regression (20:41:47) e test (20:45:15) ainda rodando → late, mesmo que tenham ficado verdes depois
const pr905 = [run('qa-review', '2026-10-24T20:39:59Z', '2026-10-24T20:40:30Z'), run('regression', '2026-10-24T20:39:59Z', '2026-10-24T20:41:47Z'),
  run('test', '2026-10-24T20:39:59Z', '2026-10-24T20:45:15Z'), run('golden', '2026-10-24T20:39:58Z', '2026-10-24T20:40:08Z')];
const a905 = auditMerge({ mergedAt: '2026-10-24T20:41:05Z', checkRuns: pr905 });
assert.equal(a905.ok, false); assert.deepEqual(a905.late, ['test', 'regression']); assert.deepEqual(a905.failed, []);

// Check ainda em andamento (sem completed_at) também é late; check ausente é missing; conclusão != success é failed
const parcial = [run('test', '2026-10-24T20:00:00Z', null), run('regression', '2026-10-24T20:00:00Z', '2026-10-24T20:01:00Z', 'failure'), run('golden', '2026-10-24T20:00:00Z', '2026-10-24T20:00:10Z')];
const ap = auditMerge({ mergedAt: '2026-10-24T20:05:00Z', checkRuns: parcial });
assert.deepEqual(ap, { ok: false, missing: ['qa-review'], failed: ['regression=failure'], late: ['test'] });

// Re-run: vale a execução mais recente do mesmo nome (a falha antiga não conta; a nova precisa ter terminado antes do merge)
const rerun = [...verdes.slice(1), run('test', '2026-10-24T20:00:00Z', '2026-10-24T20:04:00Z', 'failure', 1), run('test', '2026-10-24T20:05:00Z', '2026-10-24T20:09:00Z', 'success', 2)];
assert.equal(latestByName(rerun).get('test').id, 2);
assert.equal(auditMerge({ mergedAt: '2026-10-24T21:10:47Z', checkRuns: rerun }).ok, true);
assert.deepEqual(auditMerge({ mergedAt: '2026-10-24T20:08:00Z', checkRuns: rerun }).late.includes('test'), true);

// PR não integrada: nada a auditar (ok null, nunca "ok")
assert.equal(auditMerge({ mergedAt: null, checkRuns: verdes }).ok, null);
assert.equal(auditMerge({ mergedAt: 'lixo', checkRuns: verdes }).ok, null);
// Entrada malformada não lança
assert.deepEqual(auditMerge({ mergedAt: '2026-10-24T21:00:00Z', checkRuns: null }).missing, [...REQUIRED]);

// CLI com API falsa: só GETs em repos/<repo>/..., saída 1 quando há violação, 0 quando tudo ok
const PRS = { 905: { merged_at: '2026-10-24T20:41:05Z', merged_by: { login: 'dono' }, head: { sha: 'a'.repeat(40) } },
  906: { merged_at: '2026-10-24T21:10:47Z', merged_by: { login: 'dono' }, head: { sha: 'b'.repeat(40) } } };
const chamadas = [];
const api = async (args) => {
  chamadas.push(args);
  assert.equal(args[0], 'api'); assert.equal(args.length, 2, 'só GET simples, sem -X/-f/--input');
  const p = args[1];
  let m = p.match(/^repos\/o\/r\/pulls\/(\d+)$/); if (m) return PRS[m[1]];
  m = p.match(/^repos\/o\/r\/commits\/([ab])+\/check-runs\?per_page=100$/); if (m) return { check_runs: p.includes('aaaa') ? pr905 : verdes };
  if (p.startsWith('repos/o/r/pulls?state=closed')) return [{ number: 906, merged_at: PRS[906].merged_at }, { number: 900, merged_at: null }, { number: 905, merged_at: PRS[905].merged_at }];
  throw new Error('rota inesperada ' + p);
};
const linhas = [];
assert.equal(await main(['--repo', 'o/r', '--prs', '905,906'], { api, log: (s) => linhas.push(s) }), 1);
assert.ok(linhas.some((l) => l.startsWith('#905 VIOLAÇÃO') && l.includes('concluído depois do merge: test,regression')));
assert.ok(linhas.some((l) => l.startsWith('#906 ok')));
assert.equal(await main(['--repo', 'o/r', '--prs', '906'], { api, log: () => {} }), 0);
// --ultimas: só PRs integradas, mais recentes primeiro
const j = []; assert.equal(await main(['--repo', 'o/r', '--ultimas', '5', '--json'], { api, log: (s) => j.push(s) }), 1);
assert.deepEqual(JSON.parse(j[0]).map((r) => r.pr), [906, 905]);
// Entradas inválidas: código 2, sem chamada à API
const antes = chamadas.length;
assert.equal(await main(['--repo', 'o/r; rm -rf /', '--prs', '1'], { api, log: () => {} }), 2);
assert.equal(await main(['--repo', 'o/r', '--prs', '1,x'], { api, log: () => {} }), 2);
assert.equal(chamadas.length, antes);

console.log('merge-audit-tests ok');
