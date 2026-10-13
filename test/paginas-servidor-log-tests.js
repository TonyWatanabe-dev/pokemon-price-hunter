// api/pagina.mjs e api/sitemap.mjs: exceção inesperada gera console.error (rota + mensagem); dado velho não gera.
// Sem rede: fetch falso, em subprocesso (os módulos guardam cache de state).
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOW = Date.parse('2026-10-12T18:00:00.000Z');
const fresh = new Date(NOW - 5 * 6e4).toISOString();
const old = new Date(NOW - 5 * 24 * 36e5).toISOString();
const mk = (generatedAt, extra = {}) => ({ generatedAt, coverage: { found: 0 }, totals: { offers: 0 }, products: [], offers: [], collections: [], types: [], sources: [], activity: [], tips: [], bestDeals: [], ...extra });
const BAD = { collections: [null], products: [{ id: 'p1', name: 'P', offerCount: 1, collection: 'a', type: 't' }] };

function run(mod, query, st) {
  const script = `import { setFreshnessClock } from ${JSON.stringify(pathToFileURL(path.join(root, 'api/_lib/freshness.mjs')).href)};
    setFreshnessClock(() => ${NOW}); const st = JSON.parse(process.argv[1]);
    globalThis.fetch = async () => new Response(JSON.stringify(st), { status: 200 });
    const errs = []; console.error = (...a) => errs.push(a.join(' '));
    const { default: h } = await import(${JSON.stringify(pathToFileURL(path.join(root, mod)).href)});
    const res = { headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = b; } };
    await h({ url: '/x?' + process.argv[2], headers: { host: 'x' } }, res);
    console.log(JSON.stringify({ status: res.statusCode, errs }));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script, JSON.stringify(st), query],
    { cwd: root, encoding: 'utf8', env: { ...process.env, API_DATABASE_URL: '' } });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

// Dado velho: sem log de erro.
assert.deepEqual(run('api/pagina.mjs', 't=home', mk(old)).errs, []);
assert.deepEqual(run('api/sitemap.mjs', '', mk(old)).errs, []);
// Caminho feliz: sem log.
assert.deepEqual(run('api/pagina.mjs', 't=home', mk(fresh)).errs, []);
assert.deepEqual(run('api/sitemap.mjs', '', mk(fresh)).errs, []);
// Exceção no build (coleção nula quebra o render): log com rota, resposta 200 como antes.
const bad = run('api/pagina.mjs', 't=home', mk(fresh, BAD));
assert.equal(bad.status, 200);
assert.equal(bad.errs.length, 1);
assert.match(bad.errs[0], /pagina: erro inesperado.*t=home/);
// Exceção no sitemap depois da checagem de frescor.
const sbad = run('api/sitemap.mjs', '', mk(fresh, BAD));
assert.equal(sbad.errs.length, 1);
assert.match(sbad.errs[0], /sitemap: erro inesperado/);
console.log('paginas-servidor-log: ok');
