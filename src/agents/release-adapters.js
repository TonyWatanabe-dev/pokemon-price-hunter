// Adaptadores reais da Release Executor Bridge. Só falam com as APIs oficiais e devolvem dados crus mínimos.
// GitHub: pela CLI `gh` já autenticada na máquina (executor local) ou por GH_TOKEN no ambiente do job; este
// módulo não lê nem imprime o token. Vercel: API REST com token passado por quem cria o adaptador.
import { execFile } from 'node:child_process';
import { ProviderError, redact } from './release-executor-bridge.js';

const classify = (status) => status === 401 || status === 403 ? 'auth' : status === 404 ? 'not_found'
  : status === 405 || status === 409 || status === 422 ? 'conflict' : status >= 500 ? 'unavailable' : 'unknown';

/** Executa `gh api` e devolve JSON. Erros viram ProviderError com classe (auth, conflict, timeout...). */
export function ghApi({ run = execFile, timeoutMs = 20_000 } = {}) {
  return (path, { method = 'GET', fields = {} } = {}) => new Promise((resolve, reject) => {
    const args = ['api', '-X', method, path, '-H', 'Accept: application/vnd.github+json', '-i'];
    for (const [k, v] of Object.entries(fields)) args.push('-f', `${k}=${v}`);
    run('gh', args, { timeout: timeoutMs, maxBuffer: 20 * 1024 * 1024 }, (err, stdout = '', stderr = '') => {
      const out = String(stdout); const sep = out.indexOf('\r\n\r\n') >= 0 ? out.indexOf('\r\n\r\n') : out.indexOf('\n\n');
      const head = sep >= 0 ? out.slice(0, sep) : ''; const body = sep >= 0 ? out.slice(sep).trim() : out.trim();
      const status = Number((head.match(/^HTTP\/[\d.]+\s+(\d{3})/m) || [])[1]) || null;
      if (err && err.killed) return reject(new ProviderError(`GitHub: tempo esgotado em ${path}`, { provider: 'github', kind: 'timeout' }));
      if (status && status >= 400) return reject(new ProviderError(`GitHub ${status} em ${path}: ${redact(body, 200)}`, { provider: 'github', kind: classify(status), status }));
      if (err && !status) return reject(new ProviderError(`GitHub indisponível: ${redact(stderr || err.message, 200)}`, { provider: 'github', kind: 'unavailable' }));
      try { resolve(body ? JSON.parse(body) : null); } catch { reject(new ProviderError(`GitHub: resposta ilegível em ${path}`, { provider: 'github', kind: 'unknown', status })); }
    });
  });
}

/** Adaptador GitHub para a ponte (repo "dono/nome"). `api` injetável para testes. */
export function githubAdapter({ repo, api = ghApi() }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(String(repo))) throw new Error('repo inválido');
  const R = `repos/${repo}`;
  return {
    async getPull(n) { return api(`${R}/pulls/${n}`); },
    async listFiles(n) {
      const all = [];
      for (let page = 1; page <= 10; page++) { const rows = await api(`${R}/pulls/${n}/files?per_page=100&page=${page}`); all.push(...rows.map((f) => f.filename)); if (rows.length < 100) break; }
      return all;
    },
    async listCheckRuns(sha) {
      const all = [];
      for (let page = 1; page <= 5; page++) { const r = await api(`${R}/commits/${sha}/check-runs?per_page=100&page=${page}`); all.push(...(r.check_runs || [])); if ((r.check_runs || []).length < 100) break; }
      return all;
    },
    // sha fixa o HEAD: o GitHub recusa (409) se o PR tiver mudado desde a avaliação
    async merge(n, sha) { return api(`${R}/pulls/${n}/merge`, { method: 'PUT', fields: { sha, merge_method: 'merge' } }); },
    async getRefSha(ref) { return (await api(`${R}/git/ref/heads/${ref}`)).object.sha; },
    async isAncestor(a, b) { const c = await api(`${R}/compare/${a}...${b}`); return c.status === 'ahead' || c.status === 'identical'; },
    async getTree(sha) { return (await api(`${R}/git/commits/${sha}`)).tree.sha; },
  };
}

/** Adaptador Vercel (REST v13). Deploy a partir do Git conectado ao projeto, no SHA exato. */
export function vercelAdapter({ token, teamId, project, org, repo, fetchImpl = fetch, timeoutMs = 20_000 }) {
  if (!token) throw new ProviderError('Vercel: token ausente (defina VERCEL_TOKEN no ambiente do executor)', { provider: 'vercel', kind: 'auth' });
  const q = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
  const call = async (path, init = {}) => {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeoutMs);
    let res;
    try { res = await fetchImpl(`https://api.vercel.com${path}${path.includes('?') ? q.replace('?', '&') : q}`, { ...init, signal: ac.signal, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }); }
    catch (e) { throw new ProviderError(e.name === 'AbortError' ? 'Vercel: tempo esgotado' : `Vercel indisponível: ${e.message}`, { provider: 'vercel', kind: e.name === 'AbortError' ? 'timeout' : 'unavailable' }); }
    finally { clearTimeout(t); }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ProviderError(`Vercel ${res.status}: ${redact(body?.error?.message || '', 200)}`, { provider: 'vercel', kind: classify(res.status), status: res.status });
    return body;
  };
  const view = (d) => ({ id: d.id, state: d.readyState || d.state, sha: d.meta?.githubCommitSha || null, url: d.url ? `https://${d.url}` : null, target: d.target || 'preview' });
  return {
    async createDeployment({ sha, target }) {
      const body = { name: project, project, gitSource: { type: 'github', org, repo, ref: 'main', sha }, ...(target === 'production' ? { target: 'production' } : {}) };
      return view(await call('/v13/deployments', { method: 'POST', body: JSON.stringify(body) }));
    },
    async getDeployment(id) { return view(await call(`/v13/deployments/${encodeURIComponent(id)}`)); },
  };
}

// ------------------------------------------------------------------ sink de auditoria no GitHub (opção C, #231 item 3)
// Cada evento de auditoria vira UM comentário append-only numa issue dedicada: uma linha legível + um marcador
// de máquina `<!-- ponte:auditoria v=1 {json} -->`. Fail-closed: qualquer erro, configuração ausente, resposta
// sem id ou leitura de volta divergente lança, e a ponte não age (a auditoria vem ANTES da ação).
// NÃO está ativo por padrão: só é usado com RELEASE_AUDIT_SINK=github (ver parseAuditSinkConfig).
const MARKER_RE = /<!-- ponte:auditoria v=1 (\{[^<>]*\}) -->/g;
const MAX_COMMENT = 60_000;   // limite do GitHub é 65 536; acima disso falha fechado em vez de truncar
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@"]+@/gi;
const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\[bot\])?$/;

/** Cópia do evento com strings redigidas (tokens, URLs com credenciais) e sem quebras de linha. */
export function sanitizeAuditEvent(value, depth = 0) {
  if (depth > 8) return null;
  if (typeof value === 'string') return redact(value.replace(URL_CREDENTIALS, '$1[redigido]@'), 2000);
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => sanitizeAuditEvent(v, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value).slice(0, 100)) out[redact(k, 80)] = sanitizeAuditEvent(v, depth + 1);
    return out;
  }
  return typeof value === 'number' || typeof value === 'boolean' || value === null ? value : null;
}

// < > & escapados como \u003c etc.: o JSON continua válido e não consegue fechar o comentário HTML
const safeJson = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
const word = (s, max = 40) => String(s ?? '').replace(/[^\w.:-]/g, '').slice(0, max) || '-';

/** Corpo do comentário: linha humana (sem @, links ou markdown vindos do evento) + marcador de máquina. */
export function formatAuditComment(event) {
  if (!event || typeof event.eventId !== 'string' || !/^[a-f0-9]{64}$/.test(event.eventId)) throw new Error('eventId SHA-256 inválido para auditoria');
  const clean = sanitizeAuditEvent(event);
  const line = ['Auditoria da Ponte', word(clean.component), word(clean.action), word(clean.decision ?? clean.status), word(clean.risk),
    `sha ${word(clean.headSha ?? clean.sha, 12)}`, `evento ${event.eventId.slice(0, 12)}`].join(' · ');
  const body = `${line}\n\n<!-- ponte:auditoria v=1 ${safeJson(clean)} -->`;
  if (body.length > MAX_COMMENT) throw new Error('evento de auditoria grande demais para um comentário');
  return body;
}

/** Eventos dos marcadores de um corpo de comentário (marcadores ilegíveis são ignorados). */
export function parseAuditMarkers(body) {
  const out = [];
  for (const m of String(body ?? '').matchAll(MARKER_RE)) { try { const e = JSON.parse(m[1]); if (e && typeof e.eventId === 'string') out.push(e); } catch { /* ignora */ } }
  return out;
}

/** Eventos de uma lista de comentários, SÓ dos escritos pelo ator esperado (outros autores não valem). */
export function auditEventsFromComments(comments, expectedActor) {
  if (!LOGIN_RE.test(String(expectedActor || ''))) throw new Error('ator esperado da auditoria ausente ou inválido');
  return (Array.isArray(comments) ? comments : []).filter((c) => c?.user?.login === expectedActor).flatMap((c) => parseAuditMarkers(c.body));
}

/**
 * Sink de auditoria em issue do GitHub. `expectedActor` = login que o executor usa (o comentário criado tem de
 * ser dele). Depois de criar, relê o comentário pelo id e confirma issue, autor e o mesmo eventId.
 */
export function githubIssueAuditSink({ repo, issueNumber, expectedActor, api = ghApi() } = {}) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(String(repo))) throw new Error('auditoria GitHub: repo inválido');
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) throw new Error('auditoria GitHub: número da issue de auditoria inválido');
  if (!LOGIN_RE.test(String(expectedActor || ''))) throw new Error('auditoria GitHub: ator esperado (login) ausente ou inválido');
  if (typeof api !== 'function') throw new Error('auditoria GitHub: api obrigatória');
  const R = `repos/${repo}`;
  const issueUrlSuffix = `/repos/${repo}/issues/${issueNumber}`.toLowerCase();
  return async function persistReleaseAuditToGithub(event) {
    const body = formatAuditComment(event);
    const created = await api(`${R}/issues/${issueNumber}/comments`, { method: 'POST', fields: { body } });
    const id = created?.id;
    if (!Number.isInteger(id) || id <= 0) throw new Error('auditoria GitHub: comentário sem id confirmado');
    const back = await api(`${R}/issues/comments/${id}`);
    const ok = back?.id === id && back?.user?.login === expectedActor
      && String(back?.issue_url || '').toLowerCase().endsWith(issueUrlSuffix)
      && parseAuditMarkers(back?.body).some((e) => e.eventId === event.eventId);
    if (!ok) throw new Error('auditoria GitHub: leitura de volta não confirmou o comentário (issue, autor ou evento divergente)');
    return { persisted: true, eventId: event.eventId, commentId: id };
  };
}

/**
 * Escolha do sink pelo ambiente. Sem RELEASE_AUDIT_SINK (ou vazio) → 'postgres', exatamente como antes.
 * 'github' exige RELEASE_AUDIT_ISSUE (inteiro > 0) e RELEASE_AUDIT_ACTOR (login); qualquer outro valor falha.
 */
export function parseAuditSinkConfig(env = {}) {
  const kind = String(env.RELEASE_AUDIT_SINK ?? '').trim();
  if (kind === '' || kind === 'postgres') return { kind: 'postgres' };
  if (kind !== 'github') throw new Error(`RELEASE_AUDIT_SINK desconhecido: ${word(kind)}`);
  const raw = String(env.RELEASE_AUDIT_ISSUE ?? '').trim();
  const issueNumber = /^[1-9]\d{0,9}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(issueNumber)) throw new Error('RELEASE_AUDIT_SINK=github exige RELEASE_AUDIT_ISSUE com o número da issue de auditoria');
  const expectedActor = String(env.RELEASE_AUDIT_ACTOR ?? '').trim();
  if (!LOGIN_RE.test(expectedActor)) throw new Error('RELEASE_AUDIT_SINK=github exige RELEASE_AUDIT_ACTOR com o login que publica a auditoria');
  return { kind: 'github', issueNumber, expectedActor };
}
