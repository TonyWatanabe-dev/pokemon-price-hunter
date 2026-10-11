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
