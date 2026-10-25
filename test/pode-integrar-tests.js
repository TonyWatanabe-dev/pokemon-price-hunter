// tools/pode-integrar.mjs: conferência PRÉ-merge (só leitura). Respostas da API simuladas, sem rede.
// Cenários baseados nos casos reais de 24/10/2026 (#870, #903, #904, #905) e na forma real das respostas (#922).
// Cobre os quatro estados (PODE / NÃO PODE / REVISÃO HUMANA / EVIDÊNCIA INSUFICIENTE) e seus códigos de saída.
import assert from 'node:assert/strict';
import {
  avaliar, rodadasPorNome, exigidos, main, REQUIRED, ESTADOS, CODIGOS, AVISO_COMANDO,
  dependenciasDeclaradas, marcadoresDeRisco, arquivosCriticos, normalizarProtecao,
} from '../tools/pode-integrar.mjs';

const H = 'f005c18a77fc4a425bb67f95f48980873f5892a7';
const H2 = 'e7ba3c7d7e0000000000000000000000000000aa';
const M = 'c0b6bf44de79deaffc7649afd5946d7be977376b';
const M2 = 'd1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1';
const R = 'o/r';
const APP = 15368;
const AGORA = '2026-10-25T10:00:00.000Z';
const pr = (o = {}) => ({ number: 922, state: 'open', merged: false, draft: false, mergeable: true, mergeable_state: 'clean', base: { ref: 'main' }, head: { sha: H }, body: 'corrige ME-06', labels: [], ...o });
let seq = 1000;
const run = (name, status = 'completed', conclusion = 'success', o = {}) => ({ id: ++seq, name, status, conclusion: status === 'completed' ? conclusion : null, head_sha: H, app: { id: APP }, started_at: '2026-10-25T02:18:04Z', ...o });
const verdes = () => REQUIRED.map((n) => run(n));
const rsc = { strict: true, contexts: [...REQUIRED], checks: REQUIRED.map((c) => ({ context: c, app_id: APP })) };
const protecao = { required_status_checks: rsc, enforce_admins: { enabled: true }, required_pull_request_reviews: { required_approving_review_count: 1 } };
const arquivosOk = [{ filename: 'test/x-tests.js' }, { filename: 'src/oferta.js' }];
const base = (o = {}) => ({ pr: pr(), prFinal: pr(), checkRuns: verdes(), compare: { status: 'ahead', ahead_by: 1, behind_by: 0, base_commit: { sha: M } }, protecao, arquivos: arquivosOk, mainSha: M, mainShaFinal: M, lidoEm: AGORA, repo: R, ...o });
const tem = (lista, re) => lista.some((m) => re.test(m));

assert.deepEqual([...REQUIRED], ['test', 'regression', 'golden', 'qa-review']);
// códigos de saída distintos e documentados
assert.deepEqual({ ...CODIGOS }, { PODE: 0, 'NÃO PODE': 1, USO: 2, 'EVIDÊNCIA INSUFICIENTE': 3, 'REVISÃO HUMANA NECESSÁRIA': 4 });
assert.equal(new Set(Object.values(CODIGOS)).size, 5);

// 1. PODE: sem motivo; comando NÃO vem por padrão; só com mostrarComando, com sha fixado; registra hora e main
{
  const r = avaliar(base());
  assert.equal(r.estado, ESTADOS.PODE, JSON.stringify(r));
  assert.equal(r.codigo, 0); assert.equal(r.pode, true);
  assert.equal(r.comando, null, 'nunca imprime comando por padrão');
  assert.equal(r.lidoEm, AGORA); assert.equal(r.mainSha, M);
  assert.equal(r.checks.length, 4);
  const c = avaliar(base({ mostrarComando: true }));
  assert.equal(c.comando, `gh api -X PUT repos/${R}/pulls/922/merge -f sha=${H} -f merge_method=squash`);
  assert.match(AVISO_COMANDO, /NÃO é autorização; exige autorização humana explícita; rode de novo imediatamente antes/);
}

// 2. NÃO PODE: fechada/integrada/draft/base; merged ausente = EVIDÊNCIA
{
  const r = avaliar(base({ pr: pr({ state: 'closed', merged: true }) }));
  assert.equal(r.estado, ESTADOS.NAO_PODE); assert.ok(tem(r.motivos, /já integrada/));
  assert.equal(avaliar(base({ pr: pr({ merged: undefined }) })).estado, ESTADOS.EVIDENCIA);
  assert.ok(tem(avaliar(base({ pr: pr({ draft: true }) })).motivos, /rascunho/));
  assert.ok(tem(avaliar(base({ pr: pr({ base: { ref: 'data' } }) })).motivos, /base é "data"/));
  assert.equal(avaliar(base({ pr: null })).estado, ESTADOS.EVIDENCIA);
  // comando nunca aparece fora de PODE, mesmo com mostrarComando
  assert.equal(avaliar(base({ pr: pr({ draft: true }), mostrarComando: true })).comando, null);
}

// 3. #905/#870: checks rodando → NÃO PODE
{
  const r = avaliar(base({ checkRuns: [run('qa-review'), run('golden'), run('regression', 'in_progress'), run('test', 'queued')] }));
  assert.equal(r.estado, ESTADOS.NAO_PODE);
  assert.ok(tem(r.motivos, /^test: rodada em andamento/)); assert.ok(tem(r.motivos, /^regression: rodada em andamento/));
}

// 4. #904: cancelada mais nova invalida verde antiga; e o inverso (falha antiga + re-run verde) → PODE
{
  const r = avaliar(base({ checkRuns: [run('test'), run('test', 'completed', 'cancelled'), ...verdes().slice(1)] }));
  assert.ok(tem(r.motivos, /^test: rodada mais recente \d+ terminou cancelled \(há verde mais antiga, que não vale\)/));
  assert.equal(avaliar(base({ checkRuns: [run('test', 'completed', 'failure'), ...verdes()] })).estado, ESTADOS.PODE);
}

// 5. Ordem por id (queued sem started_at ainda invalida)
{
  const novo = { ...run('test', 'queued'), started_at: null };
  const antigo = run('test', 'completed', 'success', { id: 1 });
  const { ultimo, andamento } = rodadasPorNome([novo, antigo]);
  assert.equal(ultimo.get('test').id, novo.id); assert.equal(andamento.get('test').length, 1);
  assert.equal(avaliar(base({ checkRuns: [novo, antigo, ...verdes().slice(1)] })).estado, ESTADOS.NAO_PODE);
}

// 6. Check ausente, de outro SHA ou de outro app não conta
{
  assert.ok(tem(avaliar(base({ checkRuns: verdes().filter((x) => x.name !== 'golden') })).motivos, /^golden: nenhuma rodada/));
  assert.ok(tem(avaliar(base({ checkRuns: verdes().map((x) => (x.name === 'qa-review' ? { ...x, head_sha: H2 } : x)) })).motivos, /^qa-review: rodada \d+ é de outro SHA/));
  const r = avaliar(base({ checkRuns: verdes().map((x) => (x.name === 'test' ? { ...x, app: { id: 999 } } : x)) }));
  assert.ok(tem(r.motivos, /^test: nenhuma rodada/)); assert.ok(tem(r.avisos, /outro app ignorada/));
}

// 7. Atrás da main → NÃO PODE; compare ilegível → EVIDÊNCIA; strict=false avisa e continua exigindo
{
  assert.ok(tem(avaliar(base({ compare: { behind_by: 2, base_commit: { sha: M } } })).motivos, /2 commit\(s\) atrás da main/));
  const e = avaliar(base({ compare: null }));
  assert.equal(e.estado, ESTADOS.EVIDENCIA); assert.ok(tem(e.evidencia, /comparação com a main não lida/));
  const r = avaliar(base({ protecao: { ...protecao, required_status_checks: { ...rsc, strict: false } }, compare: { behind_by: 1 } }));
  assert.equal(r.estado, ESTADOS.NAO_PODE); assert.ok(tem(r.avisos, /strict=false/));
}

// 8. mergeable/mergeable_state: null/unknown = EVIDÊNCIA; false/behind/blocked/dirty/unstable/draft = NÃO PODE
{
  for (const st of ['behind', 'blocked', 'dirty', 'unstable', 'draft']) assert.equal(avaliar(base({ prFinal: pr({ mergeable_state: st }) })).estado, ESTADOS.NAO_PODE, st);
  for (const st of ['unknown', undefined]) assert.equal(avaliar(base({ prFinal: pr({ mergeable_state: st }) })).estado, ESTADOS.EVIDENCIA, String(st));
  assert.equal(avaliar(base({ prFinal: pr({ mergeable_state: 'has_hooks' }) })).estado, ESTADOS.PODE);
  const n = avaliar(base({ prFinal: pr({ mergeable: null, mergeable_state: 'unknown' }) }));
  assert.equal(n.estado, ESTADOS.EVIDENCIA); assert.ok(tem(n.evidencia, /ainda não calculado/));
  assert.ok(tem(avaliar(base({ prFinal: pr({ mergeable: false, mergeable_state: 'dirty' }) })).motivos, /conflito/));
}

// 9. head mudou / --sha divergente → NÃO PODE; releitura ausente → EVIDÊNCIA
{
  assert.ok(tem(avaliar(base({ prFinal: pr({ head: { sha: H2 } }) })).motivos, /head mudou durante a conferência/));
  assert.ok(tem(avaliar(base({ prFinal: pr({ merged: true, state: 'closed' }) })).motivos, /deixou de estar aberta/));
  assert.equal(avaliar(base({ prFinal: null })).estado, ESTADOS.EVIDENCIA);
  assert.ok(tem(avaliar(base({ shaEsperado: H2 })).motivos, /≠ SHA esperado/));
  assert.equal(avaliar(base({ shaEsperado: H })).estado, ESTADOS.PODE);
}

// 10. main: não lida / andou durante a leitura / compare leu outra main → EVIDÊNCIA
{
  assert.ok(tem(avaliar(base({ mainSha: null })).evidencia, /SHA da main não lido/));
  const r = avaliar(base({ mainShaFinal: M2 }));
  assert.equal(r.estado, ESTADOS.EVIDENCIA); assert.ok(tem(r.evidencia, /main andou durante a conferência/));
  assert.ok(tem(avaliar(base({ compare: { behind_by: 0, base_commit: { sha: M2 } } })).evidencia, /compare leu outra main/));
}

// 11. Proteção: ilegível → EVIDÊNCIA; enforce_admins=false e 0 aprovações → avisos (estado segue PODE); contexto extra
{
  const e = avaliar(base({ protecao: null }));
  assert.equal(e.estado, ESTADOS.EVIDENCIA); assert.ok(tem(e.evidencia, /proteção da main não lida/));
  const real = { required_status_checks: rsc, enforce_admins: { enabled: false }, required_pull_request_reviews: { required_approving_review_count: 0 } };
  const r = avaliar(base({ protecao: real }));
  assert.equal(r.estado, ESTADOS.PODE);
  assert.ok(tem(r.avisos, /enforce_admins=false: o strict e os checks NÃO protegem merge de admin/));
  assert.ok(tem(r.avisos, /0 aprovações/));
  // sem required_pull_request_reviews = 0 aprovações
  assert.equal(normalizarProtecao({ required_status_checks: rsc, enforce_admins: { enabled: true } }).aprovacoes, 0);
  assert.equal(avaliar(base()).avisos.length, 0, 'proteção forte não gera aviso');
  const extra = { ...protecao, required_status_checks: { ...rsc, contexts: [...REQUIRED, 'lint'], checks: [...rsc.checks, { context: 'lint', app_id: APP }] } };
  assert.deepEqual(exigidos(extra).nomes, [...REQUIRED, 'lint']);
  assert.ok(tem(avaliar(base({ protecao: extra })).motivos, /^lint: nenhuma rodada/));
  assert.deepEqual(exigidos({ contexts: ['test'] }).nomes, [...REQUIRED]); // forma antiga (só required_status_checks)
}

// 12. Check não obrigatório pendente/falho só avisa
{
  const r = avaliar(base({ checkRuns: [...verdes(), run('conclude-linked-tasks', 'in_progress'), run('Vercel', 'completed', 'failure')] }));
  assert.equal(r.estado, ESTADOS.PODE); assert.equal(r.avisos.length, 2);
}

// 13. REVISÃO HUMANA: caminhos críticos (um por motivo), inclusive renomeação; testes/docs com palavra-chave não contam
{
  const criticos = ['src/run.js', 'src/adapters/kabum.js', 'src/match.js', 'src/discovery/x.js', 'src/ops-incident.js', '.github/workflows/watchdog.yml',
    'tools/vigia-resumo.mjs', 'src/dispatcher.js', 'tools/burnin.mjs', '.github/workflows/ci.yml', 'vercel.json', 'config/stores.json',
    'firebase/firestore.rules', 'account.js', 'tools/account.src.js', 'api/pagina.mjs', 'src/agents/release-executor-bridge.js', 'tools/pode-integrar.mjs', '.github/CODEOWNERS'];
  for (const f of criticos) {
    const r = avaliar(base({ arquivos: [{ filename: f }] }));
    assert.equal(r.estado, ESTADOS.REVISAO, f); assert.equal(r.codigo, 4);
    assert.equal(r.comando, null);
  }
  assert.equal(avaliar(base({ arquivos: [{ filename: 'src/novo.js', previous_filename: 'src/match.js' }], mostrarComando: true })).estado, ESTADOS.REVISAO);
  for (const f of ['test/vigia-sem-detalhe-tests.js', 'docs/burnin-1de7.md', 'test/dispatcher-tests.js', 'docs/ROADMAP-OPERACIONAL.md', 'index.html', 'tools/merge-audit.mjs', 'src/apiary.js'])
    assert.equal(arquivosCriticos([{ filename: f }]).length, 0, f);
  // arquivos não lidos ou incompletos → EVIDÊNCIA
  assert.equal(avaliar(base({ arquivos: null })).estado, ESTADOS.EVIDENCIA);
  assert.ok(tem(avaliar(base({ pr: pr({ changed_files: 5 }), prFinal: pr({ changed_files: 5 }) })).evidencia, /só 2 de 5 arquivos/));
}

// 14. REVISÃO HUMANA: marcadores no corpo e labels; falsos positivos reais (#916 "independe", #919 "bloqueado às", #932 "requires-recent-login")
{
  assert.equal(avaliar(base({ pr: pr({ body: 'Integrar só depois. Bloqueado até o fim do burn-in.' }) })).estado, ESTADOS.REVISAO);
  assert.equal(avaliar(base({ pr: pr({ body: 'Do NOT merge yet' }) })).estado, ESTADOS.REVISAO);
  assert.equal(avaliar(base({ pr: pr({ labels: [{ name: 'do-not-merge' }] }) })).estado, ESTADOS.REVISAO);
  assert.ok(marcadoresDeRisco({ labels: [{ name: 'bloqueado' }, { name: 'docs' }] }).length === 1);
  for (const body of ['os 4 checks e a revisão independe de humano', 'Mercado Livre bloqueado às 00:00 UTC', 'auth/requires-recent-login', 'Proposta que depende do dono', 'Nada em produção depende destes arquivos.'])
    assert.equal(avaliar(base({ pr: pr({ body }) })).estado, ESTADOS.PODE, body);
  // citação em código não conta (documentar o marcador não é usar o marcador)
  assert.equal(avaliar(base({ pr: pr({ body: 'Marcadores: `bloqueado até`, `depende de #918`.\n```\nDo not merge\n```' }) })).estado, ESTADOS.PODE);
}

// 15. Dependências declaradas
{
  assert.deepEqual(dependenciasDeclaradas('Depende de #918 e #920. Depends on #7, após #922; bloqueado por #5. Corrige #1. depende de #922', 922).map((d) => d.numero), [918, 920, 7, 5]);
  assert.deepEqual(dependenciasDeclaradas('após a #903 e depois de tudo; requer #84').map((d) => d.numero), [903, 84]);
  assert.deepEqual(dependenciasDeclaradas('fecha #271; ver #916').map((d) => d.numero), []);
  const comDep = (dep) => base({ pr: pr({ body: 'Depende de #918' }), dependencias: { 918: dep } });
  // PR dependência integrada → PODE
  const ok = avaliar(comDep({ tipo: 'pr', dado: { number: 918, state: 'closed', merged: true } }));
  assert.equal(ok.estado, ESTADOS.PODE); assert.equal(ok.dependencias[0].situacao, 'integrada');
  // PR dependência aberta → NÃO PODE (ordem errada)
  const ab = avaliar(comDep({ tipo: 'pr', dado: { number: 918, state: 'open', merged: false } }));
  assert.equal(ab.estado, ESTADOS.NAO_PODE); assert.ok(tem(ab.motivos, /depende da PR #918, ainda não integrada/));
  // PR fechada sem merge → REVISÃO HUMANA; issue aberta → REVISÃO; issue fechada → PODE com aviso
  assert.equal(avaliar(comDep({ tipo: 'pr', dado: { state: 'closed', merged: false } })).estado, ESTADOS.REVISAO);
  assert.equal(avaliar(comDep({ tipo: 'issue', dado: { state: 'open' } })).estado, ESTADOS.REVISAO);
  const fi = avaliar(comDep({ tipo: 'issue', dado: { state: 'closed', state_reason: 'completed' } }));
  assert.equal(fi.estado, ESTADOS.PODE); assert.ok(tem(fi.avisos, /issue fechada/));
  // ilegível → EVIDÊNCIA
  assert.equal(avaliar(comDep(null)).estado, ESTADOS.EVIDENCIA);
  assert.equal(avaliar(base({ pr: pr({ body: 'Depende de #918' }) })).estado, ESTADOS.EVIDENCIA);
}

// 16. Precedência: NÃO PODE > EVIDÊNCIA > REVISÃO > PODE
{
  const crit = [{ filename: 'src/run.js' }];
  assert.equal(avaliar(base({ arquivos: crit, compare: { behind_by: 1 } })).estado, ESTADOS.NAO_PODE);
  assert.equal(avaliar(base({ arquivos: crit, protecao: null })).estado, ESTADOS.EVIDENCIA);
  assert.equal(avaliar(base({ arquivos: crit })).estado, ESTADOS.REVISAO);
}

// ---------------------------------------------------------------- CLI com API falsa: só GET, filter=all, paginação, estados
function apiFalsa({ prs, runs = verdes(), compare = { behind_by: 0, base_commit: { sha: M } }, protecaoResp = protecao, protecaoFalha = false, mudaHead = false,
  arquivos = arquivosOk, arquivosFalha = false, issues = {}, mains = [M], refFalha = false } = {}) {
  const chamadas = []; const lidas = {}; let refs = 0;
  const api = async (args) => {
    chamadas.push(args);
    assert.equal(args[0], 'api'); assert.equal(args.length, 2, 'só GET simples, sem -X/-f/--input');
    const p = args[1];
    if (p === 'repos/o/r/git/ref/heads/main') { if (refFalha) throw new Error('HTTP 502'); return { object: { sha: mains[Math.min(refs++, mains.length - 1)] } }; }
    let m = p.match(/^repos\/o\/r\/pulls\/(\d+)$/);
    if (m) { lidas[m[1]] = (lidas[m[1]] || 0) + 1; const x = prs[m[1]]; if (!x) throw new Error('gh: Not Found (HTTP 404)'); return mudaHead && lidas[m[1]] > 1 ? { ...x, head: { sha: H2 } } : x; }
    m = p.match(/^repos\/o\/r\/issues\/(\d+)$/);
    if (m) { if (!issues[m[1]]) throw new Error('HTTP 404'); return issues[m[1]]; }
    if (p === 'repos/o/r/branches/main/protection') { if (protecaoFalha) throw new Error('HTTP 403'); return protecaoResp; }
    m = p.match(/^repos\/o\/r\/commits\/([0-9a-f]{40})\/check-runs\?filter=all&per_page=100&page=(\d+)$/);
    if (m) { const pg = Number(m[2]); return { check_runs: runs.slice((pg - 1) * 100, pg * 100) }; }
    m = p.match(/^repos\/o\/r\/pulls\/(\d+)\/files\?per_page=100&page=(\d+)$/);
    if (m) { if (arquivosFalha) throw new Error('HTTP 500'); const pg = Number(m[2]); return arquivos.slice((pg - 1) * 100, pg * 100); }
    m = p.match(/^repos\/o\/r\/compare\/main\.\.\.([0-9a-f]{40})$/); if (m) return compare;
    throw new Error('rota inesperada ' + p);
  };
  return { api, chamadas };
}
const silencioso = () => {};
const agora = () => new Date(AGORA);
const roda = async (argv, cfg) => { const linhas = []; const { api, chamadas } = apiFalsa(cfg); const cod = await main(argv, { api, log: (s) => linhas.push(s), agora }); return { cod, linhas, chamadas, txt: linhas.join('\n') }; };

// PODE pela CLI: código 0, hora UTC e SHA da main na saída, sem comando por padrão
{
  const { cod, linhas, chamadas, txt } = await roda(['922', '--repo', R], { prs: { 922: pr() } });
  assert.equal(cod, 0, txt);
  assert.ok(linhas[0].includes('→ PODE') && !linhas[0].includes('NÃO'));
  assert.ok(txt.includes(`lido em ${AGORA} (UTC) · main ${M}`));
  assert.ok(!txt.includes('/merge'), 'sem --mostrar-comando não imprime comando');
  assert.ok(txt.includes('Comando de merge omitido'));
  assert.ok(chamadas.some((c) => c[1].includes('check-runs?filter=all')));
  assert.ok(!chamadas.some((c) => /\/merge\b/.test(c[1])), 'nunca chama a rota de merge');
  assert.equal(chamadas.filter((c) => /pulls\/922$/.test(c[1])).length, 2, 'relê a PR no fim');
  assert.equal(chamadas.filter((c) => /git\/ref\/heads\/main$/.test(c[1])).length, 2, 'relê a main no fim');
}
// --mostrar-comando: aviso + comando com sha fixado; JSON também traz hora/main/aviso
{
  const { cod, txt } = await roda(['922', '--repo', R, '--mostrar-comando'], { prs: { 922: pr() } });
  assert.equal(cod, 0);
  assert.ok(txt.includes(AVISO_COMANDO));
  assert.ok(txt.includes(`-f sha=${H}`));
  assert.ok(txt.indexOf(AVISO_COMANDO) < txt.indexOf('-f sha='), 'aviso antes do comando');
  const j = await roda(['922', '--repo', R, '--json'], { prs: { 922: pr() } });
  const o = JSON.parse(j.linhas[0]);
  assert.equal(o.estado, 'PODE'); assert.equal(o.lidoEm, AGORA); assert.equal(o.mainSha, M); assert.equal(o.comando, null);
  const jc = JSON.parse((await roda(['922', '--repo', R, '--json', '--mostrar-comando'], { prs: { 922: pr() } })).linhas[0]);
  assert.ok(jc.comando.includes(`sha=${H}`)); assert.equal(jc.avisoComando, AVISO_COMANDO);
}
// NÃO PODE pela CLI (código 1): paginação com cancelada na pág. 2; behind; head muda; --sha divergente; dependência aberta
{
  const muitas = [...verdes(), ...Array.from({ length: 145 }, (_, i) => run(`outro-${i}`)), run('test', 'completed', 'cancelled')];
  const p = await roda(['922', '--repo', R, '--json'], { prs: { 922: pr() }, runs: muitas });
  assert.equal(p.cod, 1); assert.ok(p.chamadas.some((c) => c[1].includes('check-runs') && c[1].endsWith('&page=2')));
  assert.equal((await roda(['922', '--repo', R], { prs: { 922: pr() }, compare: { behind_by: 3, base_commit: { sha: M } } })).cod, 1);
  assert.equal((await roda(['922', '--repo', R], { prs: { 922: pr() }, mudaHead: true })).cod, 1);
  assert.equal((await roda(['922', '--repo', R, '--sha', H2], { prs: { 922: pr() } })).cod, 1);
  const d = await roda(['922', '--repo', R, '--mostrar-comando'], { prs: { 922: pr({ body: 'Depende de #918' }), 918: pr({ number: 918 }) } });
  assert.equal(d.cod, 1); assert.ok(d.txt.includes('dependência #918: aberta')); assert.ok(!d.txt.includes('/merge'));
  // PR integrada: não lê check-runs, compare nem arquivos
  const f = await roda(['904', '--repo', R], { prs: { 904: pr({ number: 904, state: 'closed', merged: true }) } });
  assert.equal(f.cod, 1); assert.ok(!f.chamadas.some((c) => /check-runs|compare|files/.test(c[1])));
}
// EVIDÊNCIA INSUFICIENTE pela CLI (código 3): PR 404, proteção 403, arquivos 500, main andou, ref ilegível, dependência ilegível
{
  const a = await roda(['999', '--repo', R], { prs: {} });
  assert.equal(a.cod, 3); assert.ok(a.linhas[0].includes('EVIDÊNCIA INSUFICIENTE'));
  assert.equal((await roda(['922', '--repo', R], { prs: { 922: pr() }, protecaoFalha: true })).cod, 3);
  assert.equal((await roda(['922', '--repo', R], { prs: { 922: pr() }, arquivosFalha: true })).cod, 3);
  assert.equal((await roda(['922', '--repo', R], { prs: { 922: pr() }, mains: [M, M2] })).cod, 3);
  assert.equal((await roda(['922', '--repo', R], { prs: { 922: pr() }, refFalha: true })).cod, 3);
  assert.equal((await roda(['922', '--repo', R], { prs: { 922: pr({ body: 'depende de #5' }) } })).cod, 3, 'nem PR nem issue #5');
  assert.equal((await roda(['922', '--repo', R], { prs: { 922: pr({ mergeable: null, mergeable_state: 'unknown' }) } })).cod, 3);
}
// REVISÃO HUMANA pela CLI (código 4): caminho crítico; issue aberta como dependência (404 em pulls → issues); sem comando mesmo com a flag
{
  const c = await roda(['922', '--repo', R, '--mostrar-comando'], { prs: { 922: pr() }, arquivos: [{ filename: 'src/match.js' }, { filename: 'test/match-tests.js' }] });
  assert.equal(c.cod, 4, c.txt); assert.ok(c.txt.includes('REVISÃO HUMANA NECESSÁRIA')); assert.ok(!c.txt.includes('/merge'));
  const i = await roda(['922', '--repo', R], { prs: { 922: pr({ body: 'Depende de #84 (frete)' }) }, issues: { 84: { number: 84, state: 'open' } } });
  assert.equal(i.cod, 4); assert.ok(i.chamadas.some((x) => x[1] === 'repos/o/r/issues/84'));
  // enforce_admins=false e 0 aprovações aparecem como aviso na CLI
  const w = await roda(['922', '--repo', R], { prs: { 922: pr() }, protecaoResp: { required_status_checks: rsc, enforce_admins: { enabled: false }, required_pull_request_reviews: { required_approving_review_count: 0 } } });
  assert.equal(w.cod, 0); assert.ok(w.txt.includes('enforce_admins=false')); assert.ok(w.txt.includes('0 aprovações'));
}
// uso inválido: código 2, sem chamada à API
{
  const { api, chamadas } = apiFalsa({ prs: {} });
  for (const a of [[], ['x'], ['0'], ['1', '2'], ['1', '--repo', 'o/r; rm -rf /'], ['1', '--sha', 'abc']]) assert.equal(await main(a, { api, log: silencioso, agora }), 2, a.join(' '));
  assert.equal(chamadas.length, 0);
}

console.log('pode-integrar-tests ok');
