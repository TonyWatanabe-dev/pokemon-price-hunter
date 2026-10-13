// robots.txt x vercel.json: Sitemap aponta para a URL canônica; rotas noindex precisam continuar rastreáveis.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SITE } from '../api/_seo.mjs';

const robots = fs.readFileSync(new URL('../robots.txt', import.meta.url), 'utf8');
const vercel = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));

const sitemaps = [...robots.matchAll(/^Sitemap:\s*(\S+)\s*$/gim)].map((m) => m[1]);
assert.deepEqual(sitemaps, [SITE + '/sitemap.xml'], 'Sitemap aponta para a URL canônica');

const noindex = vercel.headers
  .filter((h) => h.headers.some((x) => x.key === 'X-Robots-Tag' && /noindex/i.test(x.value)))
  .map((h) => new RegExp('^' + h.source + '$'));
const disallowed = [...robots.matchAll(/^Disallow:\s*(\S+)\s*$/gim)].map((m) => m[1]);
assert.deepEqual(disallowed, ['/api/'], 'somente a API deve ser bloqueada no robots.txt');

for (const route of ['/conta', '/favoritos', '/alertas', '/configuracoes']) {
  assert.ok(!disallowed.some((path) => route === path || route.startsWith(path)), route + ' deve continuar rastreável para o buscador ler noindex');
  assert.ok(noindex.some((re) => re.test(route)), route + ' precisa enviar X-Robots-Tag: noindex no vercel.json');
}

console.log('OK — robots.txt consistente com o vercel.json; rotas noindex rastreáveis');
