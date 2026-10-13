// api/pagina.mjs — cache por tipo de resposta: 200 com SSR mantém o cache longo; 404 e casca sem dados saem com s-maxage curto.
// Sem rede: o state.json vem de um fetch falso, em subprocesso (o módulo guarda cache de state).
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOW = Date.parse('2026-10-12T18:00:00.000Z');
const fresh = new Date(NOW - 5 * 6e4).toISOString();
const old = new Date(NOW - 5 * 24 * 36e5).toISOString();
const mk = (generatedAt) => ({ generatedAt, coverage: { found: 0 }, totals: { offers: 0 }, products: [], offers: [], collections: [], types: [], sources: [], activity: [], tips: [], bestDeals: [] });

function head(query, st) {
  const script = `import { setFreshnessClock } from ${JSON.stringify(pathToFileURL(path.join(root, 'api/_lib/freshness.mjs')).href)};
    setFreshnessClock(() => ${NOW}); const st = JSON.parse(process.argv[1]);
    globalThis.fetch = async () => new Response(JSON.stringify(st), { status: 200 });
    const { default: h } = await import(${JSON.stringify(pathToFileURL(path.join(root, 'api/pagina.mjs')).href)});
    const res = { headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = b; } };
    await h({ url: '/api/pagina?' + process.argv[2], headers: { host: 'x' } }, res);
    console.log(JSON.stringify({ status: res.statusCode, cc: res.headers['cache-control'] }));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script, JSON.stringify(st), query],
    { cwd: root, encoding: 'utf8', env: { ...process.env, API_DATABASE_URL: '' } });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

const LONGO = 'public, max-age=0, s-maxage=600, stale-while-revalidate=3600';
const ok = head('t=home', mk(fresh));
assert.equal(ok.status, 200); assert.equal(ok.cc, LONGO, '200 com SSR mantém o cabeçalho atual');

const nf = head('t=produto&slug=nao-existe', mk(fresh));
assert.equal(nf.status, 404); assert.equal(nf.cc, 'public, max-age=0, s-maxage=30', '404 com cache curto');

const shell = head('t=home', mk(old));
assert.equal(shell.status, 200); assert.equal(shell.cc, 'public, max-age=0, s-maxage=30', 'casca sem dados com cache curto');
console.log('paginas-servidor-cache: ok');
