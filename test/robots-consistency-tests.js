// robots.txt x vercel.json: o Sitemap aponta para a URL canônica e toda rota em Disallow (exceto /api/) tem noindex.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SITE } from '../api/_seo.mjs';

const robots = fs.readFileSync(new URL('../robots.txt', import.meta.url), 'utf8');
const vercel = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));

const sitemaps = [...robots.matchAll(/^Sitemap:\s*(\S+)\s*$/gim)].map((m) => m[1]);
assert.deepEqual(sitemaps, [`${SITE}/sitemap.xml`], 'Sitemap aponta para a URL canônica');

const noindex = vercel.headers
  .filter((h) => h.headers.some((x) => x.key === 'X-Robots-Tag' && /noindex/i.test(x.value)))
  .map((h) => new RegExp(`^${h.source}$`));
const disallowed = [...robots.matchAll(/^Disallow:\s*(\S+)\s*$/gim)].map((m) => m[1]).filter((p) => p !== '/api/');
assert.ok(disallowed.length > 0, 'há rotas em Disallow');
for (const p of disallowed) assert.ok(noindex.some((re) => re.test(p)), `${p} está em Disallow e precisa de noindex no vercel.json`);

console.log('OK — robots.txt consistente com o vercel.json');
