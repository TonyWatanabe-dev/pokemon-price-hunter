// Sitemap deve refletir a indexabilidade real das páginas quando os dados do produto estão stale.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://tcg-price-hunter.vercel.app';

function urlsFor(generatedAt) {
  const script = `
    globalThis.fetch = async () => new Response(JSON.stringify({
      generatedAt: ${JSON.stringify(generatedAt)},
      products: [], offers: [], collections: [], types: []
    }), { status: 200 });
    const { default: handler } = await import('./api/sitemap.mjs');
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { this.body = body; } };
    await handler({}, res);
    process.stdout.write(res.body);
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: root, encoding: 'utf8', timeout: 10000
  });
  assert.equal(result.status, 0, result.stderr || 'sitemap child process failed');
  return [...result.stdout.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
}

const stale = urlsFor('2020-01-01T00:00:00.000Z');
assert.deepEqual(stale, [SITE + '/'], 'com dados stale, somente a Home indexável deve permanecer no sitemap');

const fresh = urlsFor(new Date().toISOString());
assert.equal(fresh.length, 9, 'com dados atuais, as nove páginas fixas devem estar no sitemap');
for (const p of ['/', '/oportunidades', '/precos', '/pre-vendas', '/lojas', '/como-funciona', '/guia/glossario', '/termos', '/privacidade']) {
  assert.ok(fresh.includes(SITE + p), 'página fixa ausente: ' + p);
}

console.log('sitemap-stale: 2 testes ok');
