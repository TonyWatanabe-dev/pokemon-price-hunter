// Lote F (performance): fonte e logo saem do HTML inline para arquivos estáticos com cache longo.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const r = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url));
const html = r('index.html').toString();
assert.doesNotMatch(html, /data:font\//, 'fonte não fica inline');
assert.doesNotMatch(html, /<img src="data:image\/webp;base64/, 'logo não fica inline');
assert.match(html, /<link rel="preload" href="\/assets\/web\/rubik-v1\.woff2" as="font" type="font\/woff2" crossorigin>/);
assert.match(html, /src:url\(\/assets\/web\/rubik-v1\.woff2\)/);
assert.match(html, /<img src="\/assets\/web\/logo-v1\.webp" alt="TCG Price Hunter" width="733" height="310"/);
assert.equal(r('assets/web/rubik-v1.woff2').subarray(0, 4).toString(), 'wOF2');
assert.equal(r('assets/web/logo-v1.webp').subarray(8, 12).toString(), 'WEBP');
assert.match(JSON.parse(r('package.json')).scripts.build, /cp assets\/web\/\* public\/assets\/web\//);
const h = JSON.parse(r('vercel.json')).headers.find((x) => x.source === '/assets/web/(.*)');
assert.equal(h?.headers.find((x) => x.key === 'Cache-Control')?.value, 'public, max-age=31536000, immutable', 'nome versionado (-v1): cache imutável');
assert.ok(html.length < 450 * 1024, `index.html ${Math.round(html.length / 1024)} KB`);
console.log('perf-lote-f-tests ok');
