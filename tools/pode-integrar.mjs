#!/usr/bin/env node
// Conferência PRÉ-merge (só leitura): responde PODE / NÃO PODE para integrar uma PR na main, com os motivos.
// Complementa tools/merge-audit.mjs (#916), que audita DEPOIS do merge. Nunca faz merge, não comenta, não grava:
// só `gh api` GET. Quando PODE, imprime o comando de merge com `sha=<head>` fixado, para quem tiver autorização.
// Confere, nesta ordem, e falha fechado (dado ausente ou ilegível = NÃO PODE):
//   1. PR aberta, `merged == false`, não rascunho, base = main;
//   2. head SHA atual (e igual a --sha, se informado) e inalterado entre a 1ª e a última leitura;
//   3. os checks obrigatórios (test, regression, golden, qa-review + os da proteção) no head ATUAL, lidos com
//      `filter=all` (o padrão `latest` esconde rodadas antigas/canceladas): vale a rodada mais recente de cada nome
//      (uma cancelada/falha mais nova invalida uma verde antiga) e precisa estar completed/success;
//      nenhuma rodada desses nomes pode estar em andamento; só conta o app exigido pela proteção;
//   4. branch não atrás da main (strict) — depois de "Update branch" o SHA muda e é preciso nova rodada completa;
//   5. `mergeable == true` e `mergeable_state` clean (ou has_hooks).
// Uso: node tools/pode-integrar.mjs <pr> [--repo dono/repo] [--sha <head esperado>] [--json]
// Saída: 0 = PODE; 1 = NÃO PODE; 2 = uso inválido ou falha de leitura da API (também NÃO PODE).
import { execFileSync } from 'node:child_process';
import { comRetry } from './gh-retry.mjs';

export const REQUIRED = Object.freeze(['test', 'regression', 'golden', 'qa-review']);
export const BASE = 'main';
const ESTADOS_OK = new Set(['clean', 'has_hooks']);
const MAX_PAGINAS = 10;

const ts = (s) => { const t = Date.parse(s || ''); return Number.isFinite(t) ? t : 0; };
const nome = (s) => String(s || '').trim().toLowerCase();

/**
 * Rodada mais recente por nome, entre TODAS as rodadas do SHA (filter=all). Ordem: id do check-run (monotônico no
 * GitHub; re-run e rodada nova recebem id maior), desempate por started_at. Devolve também as rodadas em andamento.
 */
export function rodadasPorNome(checkRuns, { appId = null } = {}) {
  const ultimo = new Map(); const andamento = new Map(); const outroApp = new Map();
  const ordem = (r) => [Number(r.id) || 0, ts(r.started_at)];
  for (const r of Array.isArray(checkRuns) ? checkRuns : []) {
    if (!r || typeof r.name !== 'string') continue;
    const k = nome(r.name);
    if (appId != null && Number(r.app?.id) !== Number(appId)) { outroApp.set(k, (outroApp.get(k) || 0) + 1); continue; }
    if (r.status !== 'completed') andamento.set(k, [...(andamento.get(k) || []), r]);
    const prev = ultimo.get(k);
    if (!prev) { ultimo.set(k, r); continue; }
    const [a, b] = [ordem(r), ordem(prev)];
    if (a[0] > b[0] || (a[0] === b[0] && a[1] > b[1])) ultimo.set(k, r);
  }
  return { ultimo, andamento, outroApp };
}

/** Lista exigida = os 4 fixos + contextos da proteção (nunca menos que os 4). appIds por nome, se a proteção disser. */
export function exigidos(protecao) {
  const nomes = [...REQUIRED]; const apps = new Map();
  for (const c of Array.isArray(protecao?.checks) ? protecao.checks : []) {
    if (!c?.context) continue;
    if (!nomes.some((n) => nome(n) === nome(c.context))) nomes.push(c.context);
    if (c.app_id != null && c.app_id !== -1) apps.set(nome(c.context), c.app_id);
  }
  for (const c of Array.isArray(protecao?.contexts) ? protecao.contexts : []) if (!nomes.some((n) => nome(n) === nome(c))) nomes.push(c);
  return { nomes, apps };
}

/**
 * Decisão pura. pr / prFinal: GET pulls/{n} no início e no fim. checkRuns: rodadas do head (filter=all).
 * compare: GET compare/main...{head}. protecao: GET branches/main/protection/required_status_checks (ou null).
 */
export function avaliar({ pr, prFinal, checkRuns, compare, protecao, shaEsperado = null, repo = '' }) {
  const motivos = []; const avisos = []; const checks = [];
  const n = pr?.number;
  const head = pr?.head?.sha || null;
  if (!pr || typeof pr !== 'object') return { pode: false, head: null, motivos: ['PR não lida'], avisos, checks, comando: null };
  if (pr.state !== 'open') motivos.push(`PR não está aberta (state=${pr.state ?? '?'})`);
  if (pr.merged !== false) motivos.push(pr.merged === true ? 'PR já integrada (merged=true)' : 'campo merged ausente: não dá para confirmar que não foi integrada');
  // Fechada ou já integrada: não há o que conferir (evita motivos derivados que só poluem a saída).
  if (motivos.length) return { pode: false, head, motivos, avisos, checks, comando: null };
  if (pr.draft) motivos.push('PR em rascunho (draft)');
  if (pr.base?.ref !== BASE) motivos.push(`base é "${pr.base?.ref ?? '?'}", não "${BASE}"`);
  if (!/^[0-9a-f]{40}$/.test(head || '')) motivos.push('head SHA ausente ou inválido');
  if (shaEsperado && head !== shaEsperado) motivos.push(`head atual ${String(head).slice(0, 10)} ≠ SHA esperado ${shaEsperado.slice(0, 10)} (houve push/update-branch; valide de novo)`);
  if (prFinal) {
    if (prFinal.head?.sha !== head) motivos.push(`head mudou durante a conferência (${String(head).slice(0, 10)} → ${String(prFinal.head?.sha).slice(0, 10)})`);
    if (prFinal.state !== 'open' || prFinal.merged !== false) motivos.push('PR deixou de estar aberta/não integrada durante a conferência');
  } else motivos.push('releitura final da PR ausente');

  if (!protecao) avisos.push('proteção da main não lida: usando os 4 checks fixos e exigindo branch atualizada');
  else if (protecao.strict !== true) avisos.push('proteção da main está com strict=false; esta conferência exige branch atualizada mesmo assim');
  const { nomes, apps } = exigidos(protecao);
  for (const req of nomes) {
    const appId = apps.get(nome(req)) ?? null;
    const { ultimo, andamento, outroApp } = rodadasPorNome(checkRuns, { appId });
    const k = nome(req); const r = ultimo.get(k); const vivos = andamento.get(k) || [];
    const linha = { nome: req, id: r?.id ?? null, status: r?.status ?? null, conclusion: r?.conclusion ?? null, head_sha: r?.head_sha ?? null, rodadas: (checkRuns || []).filter((x) => nome(x?.name) === k).length };
    checks.push(linha);
    if (outroApp.get(k)) avisos.push(`${req}: ${outroApp.get(k)} rodada(s) de outro app ignorada(s) (a proteção exige app ${appId})`);
    if (!r) { motivos.push(`${req}: nenhuma rodada no head ${String(head).slice(0, 10)}`); continue; }
    if (r.head_sha && head && r.head_sha !== head) motivos.push(`${req}: rodada ${r.id} é de outro SHA (${r.head_sha.slice(0, 10)})`);
    if (vivos.length) motivos.push(`${req}: rodada em andamento (${vivos.map((x) => `${x.id} ${x.status}`).join(', ')}); espere concluir`);
    else if (r.status !== 'completed') motivos.push(`${req}: rodada mais recente ${r.id} não concluída (${r.status})`);
    else if (r.conclusion !== 'success') {
      const verdeAntiga = (checkRuns || []).some((x) => nome(x?.name) === k && x !== r && x.status === 'completed' && x.conclusion === 'success');
      motivos.push(`${req}: rodada mais recente ${r.id} terminou ${r.conclusion || 'sem conclusão'}${verdeAntiga ? ' (há verde mais antiga, que não vale)' : ''}`);
    }
  }
  for (const r of Array.isArray(checkRuns) ? checkRuns : []) {
    if (!r?.name || nomes.some((x) => nome(x) === nome(r.name))) continue;
    if (r.status !== 'completed') avisos.push(`check não obrigatório em andamento: ${r.name}`);
    else if (!['success', 'skipped', 'neutral'].includes(r.conclusion)) avisos.push(`check não obrigatório ${r.name}=${r.conclusion}`);
  }

  if (!compare || !Number.isInteger(compare.behind_by)) motivos.push('comparação com a main não lida: não dá para confirmar que a branch está atualizada');
  else if (compare.behind_by > 0) motivos.push(`branch ${compare.behind_by} commit(s) atrás da main (strict): atualize e espere nova rodada completa dos checks no novo SHA`);

  const st = (prFinal || pr).mergeable_state; const mg = (prFinal || pr).mergeable;
  if (mg !== true) motivos.push(mg === false ? 'mergeable=false (conflito)' : 'mergeable ainda não calculado pelo GitHub (null): tente de novo em instantes');
  if (!ESTADOS_OK.has(st)) motivos.push(`mergeable_state=${st ?? '?'} (precisa ser clean)`);

  const pode = motivos.length === 0;
  const comando = pode ? `gh api -X PUT repos/${repo}/pulls/${n}/merge -f sha=${head} -f merge_method=squash` : null;
  return { pode, head, motivos, avisos, checks, comando };
}

// ---------------------------------------------------------------- CLI (gh autenticado; só GET)
const gh = (args) => comRetry((a) => JSON.parse(execFileSync('gh', a, { encoding: 'utf8', maxBuffer: 32 << 20, stdio: ['ignore', 'pipe', 'pipe'] })), args);

async function todasRodadas(api, repo, sha) {
  const out = [];
  for (let p = 1; p <= MAX_PAGINAS; p++) {
    const r = await api(['api', `repos/${repo}/commits/${sha}/check-runs?filter=all&per_page=100&page=${p}`]);
    const lote = Array.isArray(r?.check_runs) ? r.check_runs : null;
    if (!lote) throw new Error('resposta de check-runs sem check_runs');
    out.push(...lote);
    if (lote.length < 100) return out;
  }
  throw new Error(`check-runs excedeu ${MAX_PAGINAS} páginas`);
}

export async function main(argv = process.argv.slice(2), { api = gh, log = console.log } = {}) {
  const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : null; };
  const repo = opt('repo') || process.env.GITHUB_REPOSITORY || 'TonyWatanabe-dev/pokemon-price-hunter';
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--repo' || argv[i] === '--sha') { i++; continue; }
    if (!argv[i].startsWith('--')) pos.push(argv[i]);
  }
  const n = Number(String(pos[0] ?? '').replace(/^#/, ''));
  const sha = opt('sha');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) { log('NÃO PODE — repositório inválido'); return 2; }
  if (!Number.isInteger(n) || n <= 0 || pos.length !== 1) { log('uso: node tools/pode-integrar.mjs <pr> [--repo dono/repo] [--sha <head>] [--json]'); return 2; }
  if (sha != null && !/^[0-9a-f]{40}$/.test(sha)) { log('NÃO PODE — --sha precisa ser o SHA completo (40 hex)'); return 2; }

  let res;
  try {
    const pr = await api(['api', `repos/${repo}/pulls/${n}`]);
    let protecao = null;
    try { protecao = await api(['api', `repos/${repo}/branches/${BASE}/protection/required_status_checks`]); } catch { protecao = null; }
    const head = pr?.head?.sha;
    const vivo = pr?.state === 'open' && /^[0-9a-f]{40}$/.test(head || '');
    const checkRuns = vivo ? await todasRodadas(api, repo, head) : [];
    const compare = vivo ? await api(['api', `repos/${repo}/compare/${BASE}...${head}`]) : null;
    const prFinal = await api(['api', `repos/${repo}/pulls/${n}`]);
    res = avaliar({ pr, prFinal, checkRuns, compare, protecao, shaEsperado: sha, repo });
  } catch (e) {
    log(`NÃO PODE — falha ao ler a API (fail-closed): ${String(e?.message || e).split('\n')[0].slice(0, 200)}`);
    return 2;
  }

  if (argv.includes('--json')) log(JSON.stringify({ pr: n, repo, ...res }, null, 2));
  else {
    log(`PR #${n} · head ${res.head ? res.head.slice(0, 10) : '?'} → ${res.pode ? 'PODE integrar' : 'NÃO PODE integrar'}`);
    for (const c of res.checks) log(`  ${c.nome.padEnd(11)} ${c.status === 'completed' ? c.conclusion : c.status || 'ausente'}${c.id ? ` (rodada ${c.id}; ${c.rodadas} no SHA)` : ''}`);
    for (const m of res.motivos) log(`  ✗ ${m}`);
    for (const a of res.avisos) log(`  ! ${a}`);
    if (res.pode) {
      log('\nComando (só para quem tiver autorização de merge; o sha fixado faz o GitHub recusar se o head mudar):');
      log(`  ${res.comando}`);
      log('Esta ferramenta não integra nada. Depois do merge, audite com: node tools/merge-audit.mjs --prs ' + n);
    }
  }
  return res.pode ? 0 : 1;
}

if (process.argv[1]?.endsWith('pode-integrar.mjs')) process.exitCode = await main();
