// Smoke público de SEO (tools/seo-public-smoke.mjs) offline: roda o mesmo contrato contra os handlers locais,
// roteados como no vercel.json (arquivo estático > rewrites; headers pela rota pedida). Não acessa a rede: o
// state.json é simulado. Também confere que o smoke falha quando o contrato quebra (canonical, robots, sitemap, noindex).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const file = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(file), '..');
process.chdir(root);
const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const generatedAt = process.argv[2] === '--stale' ? '2020-01-01T00:00:00.000Z' : new Date().toISOString();

// Rede bloqueada: só o state.json simulado responde; qualquer outra URL falha o teste.
globalThis.fetch = async (url) => {
  if (String(url).endsWith('/state.json')) return new Response(JSON.stringify({ generatedAt, products: [], offers: [], collections: [], types: [] }), { status: 200 });
  throw new Error('rede bloqueada no teste offline: ' + url);
};
delete process.env.DATABASE_URL;

const { runSeoSmoke, PRIVATE_ROUTES, SITE } = await import('../tools/seo-public-smoke.mjs');
const { SITE: SEO_SITE } = await import('../api/_seo.mjs');
const handlers = { '/api/pagina': (await import('../api/pagina.mjs')).default, '/api/sitemap': (await import('../api/sitemap.mjs')).default };
assert.equal(SITE, SEO_SITE, 'o smoke confere o mesmo domínio canônico usado pelas funções de SEO');

// Sintaxe de rota do Vercel usada no vercel.json: ":nome*" (resto), ":nome" (segmento) e grupos regex.
const routeRe = (source) => new RegExp('^' + source.replace(/:(\w+)\*/g, '(?<$1>.*)').replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$');
const rewrite = (p) => {
  for (const r of vercel.rewrites) {
    const m = routeRe(r.source).exec(p);
    if (m) return r.destination.replace(/:(\w+)\*?/g, (_, k) => m.groups?.[k] ?? '');
  }
  return p;
};
// Saída do build (public/): os arquivos que o "npm run build" copia, sem precisar rodá-lo.
const build = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts.build;
const staticFile = (p) => {
  if (p === '/app.html') return path.join(root, 'index.html');
  const name = p.slice(1);
  return name && !name.includes('/') && new RegExp(`\\bcp [^&]*\\b${name.replace('.', '\\.')}\\b[^&]*public/`).test(build) ? path.join(root, name) : null;
};
const TYPES = { '.html': 'text/html; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };

async function localGet(p, mutate = {}) {
  const headers = new Map();
  for (const h of vercel.headers) if (routeRe(h.source).test(p)) for (const { key, value } of h.headers) headers.set(key.toLowerCase(), value);
  let status = 200; let body = '';
  const direct = staticFile(p);
  const dest = direct ? p : rewrite(p);
  const fileOut = direct || staticFile(dest.split('?')[0]);
  if (fileOut && fs.existsSync(fileOut)) {
    body = fs.readFileSync(fileOut, 'utf8');
    headers.set('content-type', TYPES[path.extname(fileOut)] || 'application/octet-stream');
  } else {
    const handler = handlers[dest.split('?')[0]];
    assert.ok(handler, `rota ${p} -> ${dest} sem handler local`);
    const res = { statusCode: 200, setHeader(k, v) { headers.set(k.toLowerCase(), String(v)); }, end(b) { body = String(b ?? ''); } };
    await handler({ url: dest, headers: { host: new URL(SITE).host } }, res);
    status = res.statusCode;
  }
  const out = { response: { status, headers: { get: (k) => headers.get(k.toLowerCase()) ?? null } }, body };
  return mutate[p] ? mutate[p](out) : out;
}

// Rotas resolvidas como no deploy.
assert.equal(rewrite('/'), '/api/pagina?t=home');
assert.equal(rewrite('/sitemap.xml'), '/api/sitemap');
for (const r of PRIVATE_ROUTES) assert.equal(rewrite(r), '/app.html', r + ' cai na casca do app');
assert.ok(staticFile('/robots.txt'), 'npm run build copia robots.txt para public/');

// 1) Contrato atual passa offline.
await runSeoSmoke((p) => localGet(p));

// 2) O smoke falha quando cada parte do contrato quebra.
const breaks = {
  'Home sem canonical': { '/': (o) => ({ ...o, body: o.body.replace(/<link rel="canonical"[^>]*>/, '') }) },
  'Home com canonical de outro domínio': { '/': (o) => ({ ...o, body: o.body.replace(/(<link rel="canonical" href=")[^"]*"/, '$1https://exemplo.vercel.app/"') }) },
  'robots.txt bloqueando rota noindex': { '/robots.txt': (o) => ({ ...o, body: o.body + '\nDisallow: /conta\n' }) },
  'robots.txt sem Sitemap canônico': { '/robots.txt': (o) => ({ ...o, body: o.body.replace(/^Sitemap:.*$/m, '') }) },
  'sitemap sem a Home': { '/sitemap.xml': (o) => ({ ...o, body: o.body.replace(`<loc>${SITE}/</loc>`, '') }) },
  'sitemap listando rota privada': { '/sitemap.xml': (o) => ({ ...o, body: o.body.replace('</urlset>', `<url><loc>${SITE}/favoritos</loc></url></urlset>`) }) },
  'rota privada sem X-Robots-Tag': { '/alertas': (o) => ({ ...o, response: { ...o.response, headers: { get: () => null } } }) },
  'rota privada bloqueada (403)': { '/conta': (o) => ({ ...o, response: { ...o.response, status: 403 } }) },
};
for (const [name, mutate] of Object.entries(breaks)) {
  await assert.rejects(runSeoSmoke((p) => localGet(p, mutate)), assert.AssertionError, 'o smoke deveria falhar: ' + name);
}

if (process.argv[2] === '--stale') {
  console.log('seo-public-smoke (dados desatualizados): contrato ok');
} else {
  // 3) Com state.json desatualizado a Home mantém canonical e o sitemap ainda lista a Home (processo novo: caches).
  const r = spawnSync(process.execPath, [file, '--stale'], { cwd: root, encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 0, r.stderr || r.stdout || 'cenário stale falhou');
  console.log(`seo-public-smoke: contrato offline ok (dados em dia e desatualizados) + ${Object.keys(breaks).length} quebras detectadas`);
}
