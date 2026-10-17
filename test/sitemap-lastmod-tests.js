// lastmod do sitemap: lido com segurança e usado para priorizar páginas novas e não reler irrelevante sem alteração.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { lastmodDe } from '../src/adapters/jsonld.js';

const now = Date.parse('2026-10-17T12:00:00Z');
const xml = `<urlset><url><loc>https://l.com/produtos/a</loc><lastmod>2026-10-16</lastmod></url>
<url><loc>https://l.com/produtos/b</loc><lastmod>2026-10-10T08:00:00-03:00</lastmod></url>
<url><loc>https://l.com/produtos/c</loc></url><url><loc>https://l.com/produtos/d</loc><lastmod>lixo</lastmod></url>
<url><loc>https://l.com/produtos/e</loc><lastmod>2030-01-01</lastmod></url></urlset>`;
assert.deepEqual(lastmodDe(xml, now), { 'https://l.com/produtos/a': '2026-10-16T00:00:00.000Z', 'https://l.com/produtos/b': '2026-10-10T11:00:00.000Z' });
assert.deepEqual(lastmodDe(''), {});
const run = fs.readFileSync(new URL('../src/run.js', import.meta.url), 'utf8');
assert.match(run, /cache\.lastmod = cache\.candidates\.lastmod \|\| \{\}/);
assert.match(run, /sort\(\(a, b\) => \(lm\[b\] \|\| ''\)\.localeCompare\(lm\[a\] \|\| ''\)\)\.slice\(0, 25\)/, 'novas mais recentes primeiro');
assert.match(run, /!\(lm\[u\] && at\[u\] && lm\[u\] <= at\[u\]\)/, 'irrelevante sem alteração não volta');
console.log('sitemap-lastmod-tests: ok');
