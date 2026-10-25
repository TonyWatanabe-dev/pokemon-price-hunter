// tools/pode-integrar.mjs: conferência PRÉ-merge (só leitura). Respostas da API simuladas, sem rede.
// Cenários baseados nos casos reais de 24/10/2026 (#870, #903, #904, #905) e na forma real das respostas (#922).
import assert from 'node:assert/strict';
import { avaliar, rodadasPorNome, exigidos, main, REQUIRED } from '../tools/pode-integrar.mjs';

const H = 'f005c18a77fc4a425bb67f95f48980873f5892a7';
const H2 = 'e7ba3c7d7e0000000000000000000000000000aa';
const R = 'o/r';
const APP = 15368;
const pr = (o = {}) => ({ number: 922, state: 'open', merged: false, draft: false, mergeable: true, mergeable_state: 'clean', base: { ref: 'main' }, head: { sha: H }, ...o });
let seq = 1000;
const run = (name, status = 'completed', conclusion = 'success', o = {}) => ({ id: ++seq, name, status, conclusion: status === 'completed' ? conclusion : null, head_sha: H, app: { id: APP }, started_at: '2026-10-25T02:18:04Z', ...o });
const verdes = () => REQUIRED.map((n) => run(n));
const protecao = { strict: true, contexts: [...REQUIRED], checks: REQUIRED.map((c) => ({ context: c, app_id: APP })) };
const base = (o = {}) => ({ pr: pr(), prFinal: pr(), checkRuns: verdes(), compare: { status: 'ahead', ahead_by: 1, behind_by: 0 }, protecao, repo: R, ...o });
const tem = (res, re) => res.motivos.some((m) => re.test(m));

assert.deepEqual([...REQUIRED], ['test', 'regression', 'golden', 'qa-review']);

// 1. Tudo certo: PODE, com comando de merge com sha fixado e sem nenhum motivo
{
  const r = avaliar(base());
  assert.equal(r.pode, true, r.motivos.join('; '));
  assert.equal(r.comando, `gh api -X PUT repos/${R}/pulls/922/merge -f sha=${H} -f merge_method=squash`);
  assert.equal(r.checks.length, 4);
}

// 2. PR fechada/integrada: NÃO PODE; merged ausente também bloqueia (fail-closed)
assert.ok(tem(avaliar(base({ pr: pr({ state: 'closed', merged: true }) })), /já integrada/));
assert.ok(tem(avaliar(base({ pr: pr({ merged: undefined }) })), /merged ausente/));
assert.ok(tem(avaliar(base({ pr: pr({ draft: true }) })), /rascunho/));
assert.ok(tem(avaliar(base({ pr: pr({ base: { ref: 'data' } }) })), /base é "data"/));
assert.equal(avaliar(base({ pr: null })).pode, false);

// 3. #905/#870: checks ainda rodando no head → NÃO PODE, com o nome de cada um
{
  const runs = [run('qa-review'), run('golden'), run('regression', 'in_progress'), run('test', 'queued')];
  const r = avaliar(base({ checkRuns: runs }));
  assert.equal(r.pode, false);
  assert.ok(tem(r, /^test: rodada em andamento/)); assert.ok(tem(r, /^regression: rodada em andamento/));
  assert.equal(r.comando, null);
}

// 4. filter=all: rodada cancelada/falha MAIS NOVA invalida verde antiga (caso #904: test cancelado)
{
  const verdeAntiga = run('test');
  const cancelada = run('test', 'completed', 'cancelled');
  const r = avaliar(base({ checkRuns: [verdeAntiga, cancelada, ...verdes().slice(1)] }));
  assert.equal(r.pode, false);
  assert.ok(tem(r, /^test: rodada mais recente \d+ terminou cancelled \(há verde mais antiga, que não vale\)/));
  // e o contrário: falha antiga + re-run verde mais novo → PODE
  const r2 = avaliar(base({ checkRuns: [run('test', 'completed', 'failure'), ...verdes()] }));
  assert.equal(r2.pode, true, r2.motivos.join('; '));
}

// 5. Ordem por id, não pela posição na lista nem por started_at ausente (queued sem started_at ainda invalida)
{
  const novo = { ...run('test', 'queued'), started_at: null };
  const antigo = run('test', 'completed', 'success', { id: 1 });
  const { ultimo, andamento } = rodadasPorNome([novo, antigo]);
  assert.equal(ultimo.get('test').id, novo.id);
  assert.equal(andamento.get('test').length, 1);
  assert.equal(avaliar(base({ checkRuns: [novo, antigo, ...verdes().slice(1)] })).pode, false);
}

// 6. Check ausente, de outro SHA, ou de outro app (homônimo forjado) não conta
{
  assert.ok(tem(avaliar(base({ checkRuns: verdes().filter((x) => x.name !== 'golden') })), /^golden: nenhuma rodada/));
  const outroSha = verdes().map((x) => (x.name === 'qa-review' ? { ...x, head_sha: H2 } : x));
  assert.ok(tem(avaliar(base({ checkRuns: outroSha })), /^qa-review: rodada \d+ é de outro SHA/));
  const forjado = verdes().map((x) => (x.name === 'test' ? { ...x, app: { id: 999 } } : x));
  const r = avaliar(base({ checkRuns: forjado }));
  assert.ok(tem(r, /^test: nenhuma rodada/)); assert.ok(r.avisos.some((a) => /outro app ignorada/.test(a)));
}

// 7. Branch atrás da main (strict) — caso das 15 PRs integradas atrás da main e do update-branch da #904
assert.ok(tem(avaliar(base({ compare: { behind_by: 2 } })), /2 commit\(s\) atrás da main/));
assert.ok(tem(avaliar(base({ compare: null })), /comparação com a main não lida/));
// strict desligado na proteção: só avisa, mas continua exigindo branch atualizada
{
  const r = avaliar(base({ protecao: { ...protecao, strict: false }, compare: { behind_by: 1 } }));
  assert.equal(r.pode, false); assert.ok(r.avisos.some((a) => /strict=false/.test(a)));
}

// 8. mergeable/mergeable_state: só clean (ou has_hooks); null = ainda calculando; behind/blocked/dirty/unstable bloqueiam
for (const st of ['behind', 'blocked', 'dirty', 'unstable', 'unknown', 'draft', undefined]) assert.equal(avaliar(base({ prFinal: pr({ mergeable_state: st }) })).pode, false, String(st));
assert.equal(avaliar(base({ prFinal: pr({ mergeable_state: 'has_hooks' }) })).pode, true);
assert.ok(tem(avaliar(base({ prFinal: pr({ mergeable: null }) })), /ainda não calculado/));
assert.ok(tem(avaliar(base({ prFinal: pr({ mergeable: false }) })), /conflito/));

// 9. head mudou durante a conferência (push/update-branch entre leituras) ou difere do --sha validado
assert.ok(tem(avaliar(base({ prFinal: pr({ head: { sha: H2 } }) })), /head mudou durante a conferência/));
assert.ok(tem(avaliar(base({ prFinal: pr({ merged: true, state: 'closed' }) })), /deixou de estar aberta/));
assert.ok(tem(avaliar(base({ prFinal: null })), /releitura final/));
assert.ok(tem(avaliar(base({ shaEsperado: H2 })), /≠ SHA esperado/));
assert.equal(avaliar(base({ shaEsperado: H })).pode, true);

// 10. Proteção: sem leitura → usa os 4 e avisa; contexto extra exigido pela proteção também é conferido
{
  const r = avaliar(base({ protecao: null }));
  assert.equal(r.pode, true); assert.ok(r.avisos.some((a) => /proteção da main não lida/.test(a)));
  const extra = { ...protecao, contexts: [...REQUIRED, 'lint'], checks: [...protecao.checks, { context: 'lint', app_id: APP }] };
  assert.deepEqual(exigidos(extra).nomes, [...REQUIRED, 'lint']);
  assert.ok(tem(avaliar(base({ protecao: extra })), /^lint: nenhuma rodada/));
  // proteção nunca reduz os 4 fixos
  assert.deepEqual(exigidos({ contexts: ['test'] }).nomes, [...REQUIRED]);
}

// 11. Check não obrigatório pendente/falho só gera aviso
{
  const r = avaliar(base({ checkRuns: [...verdes(), run('conclude-linked-tasks', 'in_progress'), run('Vercel', 'completed', 'failure')] }));
  assert.equal(r.pode, true); assert.equal(r.avisos.length, 2);
}

// ---------------------------------------------------------------- CLI com API falsa: só GET, filter=all, paginação
function apiFalsa({ prs, runs, compare = { behind_by: 0 }, protecaoFalha = false, mudaHead = false }) {
  const chamadas = []; const lidas = {};
  const api = async (args) => {
    chamadas.push(args);
    assert.equal(args[0], 'api'); assert.equal(args.length, 2, 'só GET simples, sem -X/-f/--input');
    const p = args[1];
    let m = p.match(/^repos\/o\/r\/pulls\/(\d+)$/);
    if (m) { lidas[m[1]] = (lidas[m[1]] || 0) + 1; const x = prs[m[1]]; if (!x) throw new Error('HTTP 404'); return mudaHead && lidas[m[1]] > 1 ? { ...x, head: { sha: H2 } } : x; }
    if (p === 'repos/o/r/branches/main/protection/required_status_checks') { if (protecaoFalha) throw new Error('HTTP 403'); return protecao; }
    m = p.match(/^repos\/o\/r\/commits\/([0-9a-f]{40})\/check-runs\?filter=all&per_page=100&page=(\d+)$/);
    if (m) { const pg = Number(m[2]); return { check_runs: runs.slice((pg - 1) * 100, pg * 100) }; }
    m = p.match(/^repos\/o\/r\/compare\/main\.\.\.([0-9a-f]{40})$/); if (m) return compare;
    throw new Error('rota inesperada ' + p);
  };
  return { api, chamadas };
}
const silencioso = () => {};
{
  const { api, chamadas } = apiFalsa({ prs: { 922: pr() }, runs: verdes() });
  const linhas = [];
  assert.equal(await main(['922', '--repo', R], { api, log: (s) => linhas.push(s) }), 0);
  assert.ok(linhas[0].includes('PODE integrar') && !linhas[0].includes('NÃO'));
  assert.ok(linhas.some((l) => l.includes(`-f sha=${H}`)));
  assert.ok(chamadas.some((c) => c[1].includes('check-runs?filter=all')), 'precisa usar filter=all');
  assert.ok(!chamadas.some((c) => /\/merge\b/.test(c[1])), 'nunca chama a rota de merge');
  assert.equal(chamadas.filter((c) => /pulls\/922$/.test(c[1])).length, 2, 'relê a PR no fim');
}
// paginação: 150 rodadas, a cancelada mais nova do test está na 2ª página
{
  const muitas = [...verdes(), ...Array.from({ length: 145 }, (_, i) => run(`outro-${i}`)), run('test', 'completed', 'cancelled')];
  const { api, chamadas } = apiFalsa({ prs: { 922: pr() }, runs: muitas });
  assert.equal(await main(['922', '--repo', R, '--json'], { api, log: silencioso }), 1);
  assert.ok(chamadas.some((c) => c[1].endsWith('&page=2')));
}
// head muda entre leituras; --sha divergente; proteção ilegível (aviso, segue); behind
{
  assert.equal(await main(['922', '--repo', R], { api: apiFalsa({ prs: { 922: pr() }, runs: verdes(), mudaHead: true }).api, log: silencioso }), 1);
  assert.equal(await main(['922', '--repo', R, '--sha', H2], { api: apiFalsa({ prs: { 922: pr() }, runs: verdes() }).api, log: silencioso }), 1);
  const j = [];
  assert.equal(await main(['#922', '--repo', R, '--json'], { api: apiFalsa({ prs: { 922: pr() }, runs: verdes(), protecaoFalha: true }).api, log: (s) => j.push(s) }), 0);
  assert.ok(JSON.parse(j[0]).avisos.some((a) => /proteção da main não lida/.test(a)));
  assert.equal(await main(['922', '--repo', R], { api: apiFalsa({ prs: { 922: pr() }, runs: verdes(), compare: { behind_by: 3 } }).api, log: silencioso }), 1);
}
// PR integrada: não lê check-runs nem compare; NÃO PODE
{
  const { api, chamadas } = apiFalsa({ prs: { 904: pr({ number: 904, state: 'closed', merged: true }) }, runs: verdes() });
  assert.equal(await main(['904', '--repo', R], { api, log: silencioso }), 1);
  assert.ok(!chamadas.some((c) => /check-runs|compare/.test(c[1])));
}
// falha de leitura da API: código 2 e NÃO PODE (fail-closed)
{
  const linhas = [];
  assert.equal(await main(['999', '--repo', R], { api: apiFalsa({ prs: {}, runs: [] }).api, log: (s) => linhas.push(s) }), 2);
  assert.ok(linhas[0].startsWith('NÃO PODE — falha ao ler a API'));
}
// entradas inválidas: código 2, sem chamada à API
{
  const { api, chamadas } = apiFalsa({ prs: {}, runs: [] });
  for (const a of [[], ['x'], ['0'], ['1', '2'], ['1', '--repo', 'o/r; rm -rf /'], ['1', '--sha', 'abc']]) assert.equal(await main(a, { api, log: silencioso }), 2, a.join(' '));
  assert.equal(chamadas.length, 0);
}

console.log('pode-integrar-tests ok');
