// Release Executor Bridge: liga o Release Governor às ações REAIS (merge no GitHub, deploy na Vercel).
// Fluxo de uma ação protegida (docs/release-executor-bridge-design.md):
//   evidência do provedor → Governor + auditoria → lock distribuído → idempotência → evidência de novo →
//   comparação exata → nova decisão auditada (autorização) → registro "iniciada" → ação com SHA fixado →
//   verificação no provedor → registro do resultado.
// Regras fixas:
// - Evidência só vem dos adaptadores (APIs do GitHub/Vercel). Nada do texto do PR, de comentários ou do agente.
// - Sem evidência, com evidência diferente entre a avaliação e a execução, sem lock ou sem auditoria: bloqueia.
// - Merge e deploy são decisões separadas; uma nunca autoriza a outra. R3 nunca é autônomo (o Governor decide).
// - Resultado incerto (timeout, resposta ambígua) é verificado no provedor; se não der para confirmar, fica
//   "unknown" e a mesma chave não é executada de novo sem verificação.
// - Este módulo não lê secrets: os adaptadores recebem o que precisam de quem os cria.
import { createHash } from 'node:crypto';
import { evaluateAndRecordRelease } from './release-governor-audit.js';
import { RELEASE_ACTION } from './release-governor.js';

const SHA_RE = /^[a-f0-9]{40}$/i;
const TOKEN_LIKE = /(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|postgres(?:ql)?:\/\/\S+|Bearer\s+\S+|[A-Za-z0-9]{24}(?=\b.*vercel))/gi;
export const redact = (s, max = 300) => String(s ?? '').replace(TOKEN_LIKE, '[redigido]').replace(/[\r\n\t]+/g, ' ').slice(0, max);

/** Erro de provedor com classe: auth | not_found | conflict | unavailable | timeout | unknown. */
export class ProviderError extends Error {
  constructor(message, { provider = 'desconhecido', kind = 'unknown', status = null } = {}) {
    super(redact(message)); this.provider = provider; this.kind = kind; this.status = status;
  }
}

// ------------------------------------------------------------------ evidência do GitHub
// Check runs: vale a execução MAIS RECENTE de cada nome no SHA (re-run substitui a anterior, como no GitHub).
export function normalizeCheckRuns(runs, sha) {
  const latest = new Map();
  for (const r of Array.isArray(runs) ? runs : []) {
    if (!r || typeof r.name !== 'string') continue;
    const key = r.name.trim().toLowerCase(); const prev = latest.get(key);
    const order = (x) => [Date.parse(x.started_at || x.completed_at || 0) || 0, Number(x.id) || 0];
    if (!prev || order(r)[0] > order(prev)[0] || (order(r)[0] === order(prev)[0] && order(r)[1] > order(prev)[1])) latest.set(key, r);
  }
  return [...latest.values()].map((r) => ({
    name: r.name.trim(),
    status: r.status === 'completed' ? (r.conclusion || 'unknown') : (r.status || 'unknown'),
    sha: typeof r.head_sha === 'string' ? r.head_sha.toLowerCase() : null,
    expectedSha: sha,
  })).map(({ expectedSha, ...c }) => c);
}

/** Evidência de merge de um PR, só pelas APIs do GitHub. Lança ProviderError se algo não puder ser lido. */
export async function readPullRequestEvidence(github, prNumber) {
  if (!Number.isInteger(prNumber) || prNumber <= 0) throw new ProviderError('número de PR inválido', { provider: 'github', kind: 'not_found' });
  const pr = await github.getPull(prNumber);
  if (!pr || !pr.head || !pr.base) throw new ProviderError('PR sem dados de head/base', { provider: 'github', kind: 'unknown' });
  const headSha = String(pr.head.sha || '').toLowerCase();
  const files = await github.listFiles(prNumber);
  const runs = SHA_RE.test(headSha) ? await github.listCheckRuns(headSha) : [];
  const evidence = {
    headSha,
    baseRef: pr.base.ref,
    headRef: pr.head.ref,
    // mergeable null = GitHub ainda calculando → não comprovado (bloqueia; nova tentativa depois)
    conflictFree: pr.mergeable === true && !['dirty', 'unknown'].includes(pr.mergeable_state),
    checks: normalizeCheckRuns(runs, headSha),
  };
  const state = { open: pr.state === 'open', draft: pr.draft === true, merged: pr.merged === true, mergeableState: pr.mergeable_state ?? null };
  return { evidence, changedPaths: (files || []).map((f) => (typeof f === 'string' ? f : f?.filename)).filter(Boolean), state };
}

/** Diferenças relevantes entre duas leituras de evidência (vazio = mesma). */
export function evidenceDrift(a, b) {
  const diffs = [];
  for (const k of ['headSha', 'baseRef', 'headRef', 'conflictFree']) if (a?.evidence?.[k] !== b?.evidence?.[k]) diffs.push(`${k}: ${a?.evidence?.[k]} → ${b?.evidence?.[k]}`);
  const paths = (x) => [...(x?.changedPaths || [])].sort().join('\n');
  if (paths(a) !== paths(b)) diffs.push('arquivos alterados mudaram');
  const checks = (x) => JSON.stringify([...(x?.evidence?.checks || [])].map((c) => [c.name.toLowerCase(), c.status, c.sha]).sort());
  if (checks(a) !== checks(b)) diffs.push('checks mudaram');
  for (const k of ['open', 'draft', 'merged']) if (a?.state?.[k] !== b?.state?.[k]) diffs.push(`estado.${k}: ${a?.state?.[k]} → ${b?.state?.[k]}`);
  return diffs;
}

export const idempotencyKey = (action, repo, target, sha) =>
  'release:' + createHash('sha256').update([action, repo, String(target), String(sha).toLowerCase()].join('|')).digest('hex').slice(0, 40);

// ------------------------------------------------------------------ resultado da execução (auditoria + idempotência)
const OUTCOME_STATES = new Set(['started', 'succeeded', 'failed', 'blocked', 'unknown']);
function outcomeEvent({ key, action, target, sha, status, actor, reason = null, authorizationEventId = null, result = null, now }) {
  if (!OUTCOME_STATES.has(status)) throw new Error('status de execução inválido');
  const ev = {
    schemaVersion: 1, component: 'release-executor', occurredAt: now().toISOString(), idempotencyKey: key, action,
    target: redact(String(target), 120), sha: SHA_RE.test(String(sha)) ? String(sha).toLowerCase() : null, status,
    actor: redact(actor, 100), authorizationEventId, reason: reason ? redact(reason, 400) : null,
    result: result ? JSON.parse(redact(JSON.stringify(result), 2000)) : null,
  };
  ev.eventId = createHash('sha256').update(JSON.stringify(ev)).digest('hex');
  return ev;
}

/** Store em memória (testes). Mesma semântica do PostgreSQL. */
export function memoryOutcomeStore() {
  const events = [];
  return {
    events,
    async record(ev) { if (!events.some((e) => e.eventId === ev.eventId)) events.push(ev); return ev; },
    async latest(key) { return [...events].reverse().find((e) => e.idempotencyKey === key) || null; },
  };
}

/** Store PostgreSQL em hunter.system_event (RELEASE_EXECUTION). Falha de escrita propaga (fail-closed). */
export function pgOutcomeStore(db) {
  if (!db || typeof db.query !== 'function') throw new Error('db.query obrigatório');
  return {
    async record(ev) {
      const r = await db.query(
        `INSERT INTO system_event (type, entity_type, entity_id, payload)
         SELECT 'RELEASE_EXECUTION', 'release_execution', $1, $2::jsonb
          WHERE NOT EXISTS (SELECT 1 FROM system_event WHERE type = 'RELEASE_EXECUTION' AND payload->>'eventId' = $3)
         RETURNING id`, [ev.idempotencyKey, JSON.stringify(ev), ev.eventId]);
      return { ...ev, rowId: r.rows?.[0]?.id ?? null };
    },
    async latest(key) {
      const r = await db.query(`SELECT payload FROM system_event WHERE type = 'RELEASE_EXECUTION' AND entity_id = $1 ORDER BY id DESC LIMIT 1`, [key]);
      return r.rows?.[0]?.payload ?? null;
    },
  };
}

// ------------------------------------------------------------------ lock distribuído
/** Lock em memória (um processo; testes). */
export function memoryLock() {
  const held = new Set();
  return async (key, fn) => {
    if (held.has(key)) return { locked: false };
    held.add(key);
    try { return { locked: true, value: await fn() }; } finally { held.delete(key); }
  };
}

/** Lock entre workers: advisory lock de sessão do PostgreSQL numa conexão dedicada; solto em qualquer saída. */
export function pgAdvisoryLock(pool) {
  if (!pool || typeof pool.connect !== 'function') throw new Error('pool.connect obrigatório para lock distribuído');
  return async (key, fn) => {
    const client = await pool.connect();
    let got = false;
    try {
      got = (await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [key])).rows[0]?.ok === true;
      if (!got) return { locked: false };
      return { locked: true, value: await fn() };
    } finally {
      if (got) await client.query('SELECT pg_advisory_unlock(hashtext($1))', [key]).catch(() => {});
      client.release();
    }
  };
}

// ------------------------------------------------------------------ merge
/**
 * Executa o merge de UM PR se o Governor autorizar com evidência atual. Nunca lança por decisão de política:
 * devolve { status, reason, ... }. Lança só se a AUDITORIA falhar (aí nada protegido foi executado depois).
 */
export async function runMerge({ prNumber, repo, github, auditSink, outcomes, lock, actor = 'release-executor', now = () => new Date() }) {
  if (!github || typeof auditSink !== 'function' || !outcomes || typeof lock !== 'function') throw new Error('github, auditSink, outcomes e lock são obrigatórios');
  const action = RELEASE_ACTION.MERGE;
  let first;
  try { first = await readPullRequestEvidence(github, prNumber); }
  catch (e) { return { status: 'blocked', reason: `evidência do GitHub indisponível (${e.kind || 'erro'}): ${redact(e.message)}` }; }
  if (!first.state.open || first.state.merged) return { status: 'blocked', reason: 'PR não está aberto', evidence: first.evidence };
  if (first.state.draft) return { status: 'blocked', reason: 'PR em draft', evidence: first.evidence };

  const d1 = await evaluateAndRecordRelease({ changedPaths: first.changedPaths, evidence: first.evidence, action, actor, source: `github:${repo}#${prNumber}`, now: now(), auditSink });
  if (d1.decision.decision !== 'autonomous') return { status: d1.decision.decision === 'human_required' ? 'human_required' : 'blocked', reason: d1.decision.missingEvidence.join('; '), decision: d1.decision };

  const key = idempotencyKey(action, repo, prNumber, first.evidence.headSha);
  const rec = (status, extra = {}) => outcomes.record(outcomeEvent({ key, action, target: `${repo}#${prNumber}`, sha: first.evidence.headSha, status, actor, now, ...extra }));

  const run = await lock(key, async () => {
    const prev = await outcomes.latest(key);
    if (prev?.status === 'succeeded') return { status: 'succeeded', idempotent: true, mergeCommitSha: prev.result?.mergeCommitSha ?? null };
    if (prev?.status === 'started' || prev?.status === 'unknown') {
      // execução anterior sem resultado confirmado: verifica no provedor antes de qualquer coisa
      const pr = await github.getPull(prNumber).catch(() => null);
      if (pr?.merged === true && SHA_RE.test(String(pr.merge_commit_sha || ''))) {
        await rec('succeeded', { reason: 'confirmado no GitHub após execução anterior incerta', result: { mergeCommitSha: pr.merge_commit_sha } });
        return { status: 'succeeded', idempotent: true, mergeCommitSha: pr.merge_commit_sha };
      }
      if (prev.status === 'unknown') return { status: 'unknown', reason: 'execução anterior com resultado desconhecido e não confirmada; revisão humana' };
    }

    let second;
    try { second = await readPullRequestEvidence(github, prNumber); }
    catch (e) { await rec('blocked', { reason: `revalidação falhou: ${e.message}` }); return { status: 'blocked', reason: 'revalidação: evidência indisponível' }; }
    const drift = evidenceDrift(first, second);
    if (drift.length) { await rec('blocked', { reason: 'evidência mudou entre avaliação e execução: ' + drift.join('; ') }); return { status: 'blocked', reason: 'evidência mudou: ' + drift.join('; ') }; }

    const d2 = await evaluateAndRecordRelease({ changedPaths: second.changedPaths, evidence: second.evidence, action, actor, source: `github:${repo}#${prNumber}:revalidacao`, now: now(), auditSink });
    if (d2.decision.decision !== 'autonomous') { await rec('blocked', { reason: 'revalidação não autorizou' }); return { status: 'blocked', reason: d2.decision.missingEvidence.join('; ') }; }

    await rec('started', { authorizationEventId: d2.audit.eventId });   // decisão e intenção gravadas ANTES do efeito
    let res = null; let err = null;
    try { res = await github.merge(prNumber, second.evidence.headSha); } catch (e) { err = e; }

    // verificação no provedor (vale também para timeout/resposta ambígua)
    const pr = await github.getPull(prNumber).catch(() => null);
    const merged = pr?.merged === true && SHA_RE.test(String(pr.merge_commit_sha || ''));
    if (merged) {
      const mainSha = await github.getRefSha('main').catch(() => null);
      const onMain = mainSha && (mainSha.toLowerCase() === pr.merge_commit_sha.toLowerCase() || await github.isAncestor(pr.merge_commit_sha, mainSha).catch(() => false));
      if (!onMain) { await rec('unknown', { authorizationEventId: d2.audit.eventId, reason: 'PR marcado como merged, mas o commit não foi confirmado na main', result: { mergeCommitSha: pr.merge_commit_sha, mainSha } }); return { status: 'unknown', reason: 'merge não confirmado na main' }; }
      await rec('succeeded', { authorizationEventId: d2.audit.eventId, result: { mergeCommitSha: pr.merge_commit_sha, mainSha } });
      return { status: 'succeeded', mergeCommitSha: pr.merge_commit_sha, mainSha, authorizationEventId: d2.audit.eventId };
    }
    if (err && ['timeout', 'unavailable', 'unknown'].includes(err.kind) || (!err && !res?.merged) || !pr) {
      await rec('unknown', { authorizationEventId: d2.audit.eventId, reason: `resultado do merge não confirmado: ${err ? err.message : 'resposta sem merged'}` });
      return { status: 'unknown', reason: 'resultado do merge não confirmado no GitHub' };
    }
    await rec('failed', { authorizationEventId: d2.audit.eventId, reason: err ? `${err.kind}: ${err.message}` : 'merge recusado' });
    return { status: 'failed', reason: err ? `${err.kind}: ${redact(err.message)}` : 'merge recusado' };
  });
  if (!run.locked) return { status: 'busy', reason: 'outro worker está executando esta ação' };
  return run.value;
}

// ------------------------------------------------------------------ deploy (Vercel) e verificação pós-deploy
/**
 * Evidência de release da main: SHA atual da main, arquivos do commit, e checks. O CI roda no head do PR;
 * esses checks só valem para o commit da main quando a ÁRVORE é idêntica (merge sem mudança de conteúdo).
 */
export async function readMainReleaseEvidence(github, { prNumber }) {
  const mainSha = String(await github.getRefSha('main')).toLowerCase();
  const pr = await github.getPull(prNumber);
  if (!pr?.merged || !SHA_RE.test(String(pr.merge_commit_sha || ''))) throw new ProviderError('PR não está integrado', { provider: 'github', kind: 'conflict' });
  if (pr.merge_commit_sha.toLowerCase() !== mainSha) throw new ProviderError('a main avançou depois do merge; avalie o commit atual', { provider: 'github', kind: 'conflict' });
  const [mainTree, headTree] = await Promise.all([github.getTree(mainSha), github.getTree(pr.head.sha)]);
  const files = await github.listFiles(prNumber);
  const runs = mainTree && mainTree === headTree ? await github.listCheckRuns(pr.head.sha) : [];
  const checks = normalizeCheckRuns(runs, pr.head.sha).map((c) => ({ ...c, sha: mainSha }));   // mesma árvore ⇒ mesmo conteúdo testado
  return { mainSha, sameTree: mainTree === headTree, changedPaths: files.map((f) => (typeof f === 'string' ? f : f.filename)),
    base: { headSha: mainSha, mainSha, merged: true, baseRef: 'main', headRef: 'main', targetRef: 'main', checks } };
}

/** Smoke HTTP: cada rota deve responder 200 (e conter o marcador, se houver). */
export async function smokeTest(baseUrl, routes, { fetchImpl = fetch, timeoutMs = 10_000 } = {}) {
  const results = [];
  for (const r of routes) {
    const path = typeof r === 'string' ? r : r.path; const marker = typeof r === 'string' ? null : r.contains;
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetchImpl(new URL(path, baseUrl).toString(), { signal: ac.signal, redirect: 'manual' });
      const body = marker ? await res.text() : '';
      results.push({ path, status: res.status, ok: res.status === 200 && (!marker || body.includes(marker)) });
    } catch (e) { results.push({ path, status: null, ok: false, error: e.name === 'AbortError' ? 'timeout' : redact(e.message, 120) }); }
    finally { clearTimeout(t); }
  }
  return { ok: results.length > 0 && results.every((x) => x.ok), results };
}

/**
 * Publica na Vercel o commit atual da main, depois de: Preview READY no SHA + smoke da Preview aprovado + Governor
 * (ação deploy) autorizado e auditado. Depois do deploy: deployment READY no SHA exato + smoke de produção +
 * Governor (ação deploy.verify). Qualquer falha bloqueia o passo seguinte e fica registrada.
 */
export async function runDeploy({ prNumber, repo, github, vercel, auditSink, outcomes, lock, smoke, rollout, actor = 'release-executor', now = () => new Date(), pollMs = 5_000, maxPolls = 60 }) {
  if (!github || !vercel || typeof auditSink !== 'function' || !outcomes || typeof lock !== 'function' || typeof smoke !== 'function') throw new Error('dependências obrigatórias ausentes');
  let ev;
  try { ev = await readMainReleaseEvidence(github, { prNumber }); }
  catch (e) { return { status: 'blocked', reason: `evidência da main indisponível: ${redact(e.message)}` }; }
  const key = idempotencyKey(RELEASE_ACTION.DEPLOY, repo, 'production', ev.mainSha);
  const rec = (status, extra = {}) => outcomes.record(outcomeEvent({ key, action: RELEASE_ACTION.DEPLOY, target: 'vercel:production', sha: ev.mainSha, status, actor, now, ...extra }));
  const waitReady = async (id) => {
    for (let i = 0; i < maxPolls; i++) {
      const d = await vercel.getDeployment(id);
      if (d.state === 'READY' || ['ERROR', 'CANCELED'].includes(d.state)) return d;
      await new Promise((r) => setTimeout(r, pollMs));
    }
    return { state: 'TIMEOUT' };
  };

  const run = await lock(key, async () => {
    const prev = await outcomes.latest(key);
    if (prev?.status === 'succeeded') return { status: 'succeeded', idempotent: true, deploymentId: prev.result?.deploymentId ?? null };
    if (prev?.status === 'unknown' || prev?.status === 'started') return { status: 'unknown', reason: 'deploy anterior deste SHA sem resultado confirmado; verificar na Vercel antes de repetir' };

    // 1. Preview do SHA exato + smoke
    let preview;
    try { preview = await waitReady((await vercel.createDeployment({ sha: ev.mainSha, target: 'preview' })).id); }
    catch (e) { await rec('blocked', { reason: `Vercel indisponível para a Preview (${e.kind || 'erro'})` }); return { status: 'blocked', reason: `Vercel: ${redact(e.message)}` }; }
    if (preview.state !== 'READY' || String(preview.sha).toLowerCase() !== ev.mainSha) { await rec('blocked', { reason: `Preview não ficou READY no SHA (${preview.state})` }); return { status: 'blocked', reason: 'Preview não READY no SHA exato' }; }
    const ps = await smoke(preview.url);
    const checks = [...ev.base.checks, { name: 'preview-smoke', status: ps.ok ? 'success' : 'failure', sha: ev.mainSha }];
    const evidence = { ...ev.base, ...rollout, checks, deployment: { provider: 'vercel', target: 'preview', status: 'ready', sha: ev.mainSha, url: preview.url } };
    const d = await evaluateAndRecordRelease({ changedPaths: ev.changedPaths, evidence, action: RELEASE_ACTION.DEPLOY, actor, source: `vercel:${repo}#${prNumber}`, now: now(), auditSink });
    if (d.decision.decision !== 'autonomous') { await rec('blocked', { reason: 'Governor não autorizou o deploy' }); return { status: d.decision.decision === 'human_required' ? 'human_required' : 'blocked', reason: d.decision.missingEvidence.join('; '), decision: d.decision }; }

    // 2. revalidação imediata: a main ainda está no mesmo SHA?
    const mainNow = String(await github.getRefSha('main').catch(() => '')).toLowerCase();
    if (mainNow !== ev.mainSha) { await rec('blocked', { reason: 'main mudou antes do deploy' }); return { status: 'blocked', reason: 'a main mudou entre a avaliação e o deploy' }; }

    // 3. produção
    await rec('started', { authorizationEventId: d.audit.eventId });
    let prod;
    try { prod = await waitReady((await vercel.createDeployment({ sha: ev.mainSha, target: 'production' })).id); }
    catch (e) { await rec(e.kind === 'timeout' || e.kind === 'unknown' ? 'unknown' : 'failed', { authorizationEventId: d.audit.eventId, reason: `deploy: ${e.message}` }); return { status: 'failed', reason: `Vercel: ${redact(e.message)}` }; }
    if (prod.state !== 'READY') { await rec(prod.state === 'TIMEOUT' ? 'unknown' : 'failed', { authorizationEventId: d.audit.eventId, reason: `deploy terminou em ${prod.state}`, result: { deploymentId: prod.id ?? null } }); return { status: prod.state === 'TIMEOUT' ? 'unknown' : 'failed', reason: `deploy ${prod.state}` }; }
    if (String(prod.sha).toLowerCase() !== ev.mainSha) { await rec('failed', { authorizationEventId: d.audit.eventId, reason: 'deployment READY em SHA diferente do esperado', result: { deploymentId: prod.id, sha: prod.sha } }); return { status: 'failed', reason: 'deployment em SHA diferente' }; }

    // 4. verificação pós-deploy (decisão separada)
    const pz = await smoke(prod.url);
    const vEvidence = { ...ev.base, ...rollout, checks: [...ev.base.checks, { name: 'smoke', status: pz.ok ? 'success' : 'failure', sha: ev.mainSha }],
      deployment: { provider: 'vercel', target: 'production', status: 'ready', sha: ev.mainSha, url: prod.url } };
    const v = await evaluateAndRecordRelease({ changedPaths: ev.changedPaths, evidence: vEvidence, action: RELEASE_ACTION.VERIFY_DEPLOY, actor, source: `vercel:${repo}#${prNumber}:verificacao`, now: now(), auditSink });
    const ok = v.decision.decision === 'autonomous' && pz.ok;
    await rec(ok ? 'succeeded' : 'failed', { authorizationEventId: d.audit.eventId, reason: ok ? null : 'smoke de produção reprovado: considerar rollback', result: { deploymentId: prod.id, url: prod.url, smoke: pz.results } });
    return { status: ok ? 'succeeded' : 'failed', deploymentId: prod.id, url: prod.url, smoke: pz, reason: ok ? null : 'smoke de produção reprovado' };
  });
  if (!run.locked) return { status: 'busy', reason: 'outro worker está publicando este SHA' };
  return run.value;
}
