// Smoke pós-deploy (tools/post-deploy-smoke.mjs) offline: roda o mesmo contrato contra os handlers locais (api/pagina,
// api/v1), roteados como no vercel.json (arquivo estático > rewrites; headers pela rota pedida), com o data/state.json do
// repositório servido no lugar do GitHub. Não acessa a rede. Também confere que o smoke falha quando cada parte quebra
// (API, busca, detalhe, assets sem cache imutável, link interno quebrado) e que dados velhos não reprovam o deploy.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const file = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(file), '..');
process.chdir(root);
const STALE = process.argv[2] === '--stale';
const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const state = JSON.parse(fs.readFileSync(path.join(root, 'data/state.json'), 'utf8'));
// Dados em dia (agora) ou velhos (3 h: "desatualizado", ainda servidos, sem pré-render).
state.generatedAt = new Date(Date.now() - (STALE ? 3 * 3600e3 : 0)).toISOString();
const stateJson = JSON.stringify(state);

globalThis.fetch = async (url) => {
  if (String(url).endsWith('/state.json')) return new Response(stateJson, { status: 200, headers: { 'content-type': 'application/json' } });
  throw new Error('rede bloqueada no teste offline: ' + url);
};
delete process.env.DATABASE_URL; delete process.env.API_DATABASE_URL;

const { runPostDeploySmoke, internalLinks, sampleLinks, assetRefs, SITE_PAGES } = await import('../tools/post-deploy-smoke.mjs');
const { SITE } = await import('../tools/seo-public-smoke.mjs');
const { slim } = await import('../api/_lib/slim.mjs');
const handlers = { '/api/pagina': (await import('../api/pagina.mjs')).default, '/api/v1': (await import('../api/v1.mjs')).default, '/api/sitemap': (await import('../api/sitemap.mjs')).default };

const routeRe = (source) => new RegExp('^' + source.replace(/:(\w+)\*/g, '(?<$1>.*)').replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$');
const rewrite = (p) => {
  for (const r of vercel.rewrites) {
    const m = routeRe(r.source).exec(p);
    if (m) return r.destination.replace(/:(\w+)\*?/g, (_, k) => m.groups?.[k] ?? '');
  }
  return p;
};
// Saída do build em /assets/web: arquivos de assets/web/ + CSS/JS da casca gerados pelo slim (mesmo nome do build).
const built = Object.fromEntries(slim(fs.readFileSync(path.join(root, 'index.html'), 'utf8')).arquivos.map((a) => ['/assets/web/' + a.nome, a]));
const TYPES = { '.css': 'text/css', '.js': 'text/javascript', '.webp': 'image/webp', '.woff2': 'font/woff2', '.html': 'text/html; charset=utf-8' };
function staticFile(p) {
  if (built[p]) return { body: built[p].conteudo, type: built[p].tipo };
  if (p.startsWith('/assets/web/') && !p.slice(12).includes('/') && fs.existsSync(path.join(root, 'assets/web', p.slice(12)))) return { body: '(binário)', type: TYPES[path.extname(p)] || 'application/octet-stream' };
  if (p === '/app.html') return { body: slim(fs.readFileSync(path.join(root, 'index.html'), 'utf8')).html, type: TYPES['.html'] };
  return null;
}

async function localGet(full, mutate = {}) {
  const [p, qs = ''] = full.split('?');
  const headers = new Map();
  for (const h of vercel.headers) if (routeRe(h.source).test(p)) for (const { key, value } of h.headers) headers.set(key.toLowerCase(), value);
  let status = 200; let body = '';
  const st = staticFile(p);
  if (st) { body = st.body; headers.set('content-type', st.type); }
  else if (p.startsWith('/assets/')) { status = 404; body = 'not found'; }
  else {
    const dest = rewrite(p);
    const [dp, dq = ''] = dest.split('?');
    const st2 = staticFile(dp);
    if (st2) { body = st2.body; headers.set('content-type', st2.type); }
    else {
      const handler = handlers[dp];
      assert.ok(handler, `rota ${p} -> ${dest} sem handler local`);
      const url = dp + '?' + [dq, qs].filter(Boolean).join('&');
      const res = { statusCode: 200, setHeader(k, v) { headers.set(k.toLowerCase(), String(v)); }, end(b) { body = String(b ?? ''); } };
      await handler({ url, method: 'GET', headers: { host: new URL(SITE).host } }, res);
      status = res.statusCode;
    }
  }
  const out = { response: { status, headers: { get: (k) => headers.get(k.toLowerCase()) ?? null } }, body };
  const m = Object.entries(mutate).find(([k]) => (k.endsWith('*') ? full.startsWith(k.slice(0, -1)) : k === full));
  return m ? m[1](out) : out;
}

// Funções puras
assert.deepEqual(internalLinks('<a href="/lojas">x</a><a href="/api/v1/home">a</a><a href="https://loja.com/x">e</a><a href="/produto/a?x=1">q</a><link href="/assets/web/a.css"><a href="/og.jpg">i</a><a href="//cdn.x/y">c</a>'), ['/lojas']);
assert.deepEqual(assetRefs('<link href="/assets/web/app-0123456789ab.css"><script src="/assets/web/app-0123456789ab.js"></script> url("/assets/web/rubik-v1.woff2")'), ['/assets/web/app-0123456789ab.css', '/assets/web/app-0123456789ab.js', '/assets/web/rubik-v1.woff2']);
assert.deepEqual(sampleLinks(['/', '/colecao/a', '/colecao/b', '/colecao/c', '/lojas', '/tipo/x', '/guia/glossario', '/produto/p']), ['/', '/lojas', '/colecao/a', '/colecao/b', '/tipo/x', '/guia/glossario', '/produto/p']);
assert.deepEqual(sampleLinks(['/a', '/b', '/c'], 2), ['/a', '/b']);
assert.deepEqual(SITE_PAGES, ['copag', 'pistas', 'prevenda', 'lojas']);

// 1) Contrato atual passa offline.
const report = await runPostDeploySmoke((p) => localGet(p));
assert.equal(report.freshness, STALE ? 'desatualizado' : 'atual');
assert.ok(report.assets >= 2 && report.links >= 3, JSON.stringify(report));

if (STALE) {
  console.log('post-deploy-smoke (dados desatualizados): contrato ok', JSON.stringify(report));
} else {
  // 2) O smoke falha quando cada parte do contrato quebra.
  const set = (o, k, v) => ({ ...o, response: { ...o.response, headers: { get: (n) => (n.toLowerCase() === k ? v : o.response.headers.get(n)) } } });
  const status = (s) => (o) => ({ ...o, response: { ...o.response, status: s } });
  const body = (f) => (o) => ({ ...o, body: f(o.body) });
  const breaks = {
    '/api/v1/home fora do ar (503)': { '/api/v1/home': status(503) },
    '/api/v1/home sem frescor': { '/api/v1/home': body((b) => JSON.stringify({ ...JSON.parse(b), freshness: undefined })) },
    '/api/v1/home sem X-Data-Freshness': { '/api/v1/home': (o) => set(o, 'x-data-freshness', null) },
    '/api/v1/home devolvendo HTML': { '/api/v1/home': (o) => set(o, 'content-type', 'text/html') },
    'site/pagina/pistas quebrada': { '/api/v1/site/pagina/pistas': status(500) },
    'listagem sem produtos': { '/api/v1/produtos?limite=1&estoque=1': body(() => JSON.stringify({ data: [] })) },
    'busca não acha o produto': { '/api/v1/produtos?limite=50&busca=*': body(() => JSON.stringify({ data: [] })) },
    'ofertas da busca sem o produto': { '/api/v1/site/ofertas?*': body((b) => JSON.stringify({ ...JSON.parse(b), products: [] })) },
    'detalhe da API 404': { '/api/v1/site/produto/*': status(404) },
    'página do produto 404': { '/produto/*': status(404) },
    'página do produto sem canonical': { '/produto/*': body((b) => b.replace(/<link rel="canonical"[^>]*>/, '')) },
    'Home sem CSS/JS com hash': { '/': body((b) => b.replace(/\/assets\/web\/app-[0-9a-f]{12}\.(css|js)/g, '/inline')) },
    'asset sem immutable': { '/assets/web/app-*': (o) => set(o, 'cache-control', 'public, max-age=31536000') },
    'asset com max-age curto': { '/assets/web/rubik-*': (o) => set(o, 'cache-control', 'public, max-age=60, immutable') },
    'asset sumiu (404)': { '/assets/web/app-*': status(404) },
    'link interno quebrado': { '/lojas': status(404) },
  };
  for (const [name, mutate] of Object.entries(breaks)) {
    await assert.rejects(runPostDeploySmoke((p) => localGet(p, mutate)), assert.AssertionError, 'o smoke deveria falhar: ' + name);
  }

  // 3) O smoke só faz GET em caminhos do próprio site (nunca segue para lojas) e respeita o teto de links.
  const asked = [];
  await runPostDeploySmoke((p) => { asked.push(p); return localGet(p); }, { maxLinks: 5 });
  assert.ok(asked.every((p) => p.startsWith('/') && !p.startsWith('//')), 'só caminhos relativos ao domínio canônico');
  assert.ok(asked.length <= 25, `teto de pedidos com maxLinks 5 (foram ${asked.length})`);

  // 4) Workflow: roda o smoke pós-deploy, só leitura, sem secrets, ações fixadas por SHA.
  const wf = fs.readFileSync(path.join(root, '.github/workflows/seo-public-smoke.yml'), 'utf8');
  assert.match(wf, /run: node tools\/post-deploy-smoke\.mjs/, 'workflow precisa rodar o smoke pós-deploy');
  assert.match(wf, /^permissions:\n  contents: read\n/m, 'workflow só com contents: read');
  assert.doesNotMatch(wf, /secrets\.|write/, 'workflow sem secrets nem permissão de escrita');
  for (const u of wf.matchAll(/uses: (\S+)/g)) assert.match(u[1], /@[0-9a-f]{40}$/, 'ação fixada por SHA: ' + u[1]);

  // 5) Dados desatualizados: o deploy continua aprovado (processo novo: caches dos handlers).
  const r = spawnSync(process.execPath, [file, '--stale'], { cwd: root, encoding: 'utf8', timeout: 30000 });
  assert.equal(r.status, 0, r.stderr || r.stdout || 'cenário stale falhou');
  console.log(`post-deploy-smoke: contrato offline ok (dados em dia e desatualizados) + ${Object.keys(breaks).length} quebras detectadas | ${JSON.stringify(report)}`);
}
