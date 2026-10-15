// Domínio canônico (decisão do proprietário, 15/10/2026): https://tcgpricehunter.com.br.
// Estático, sem rede: nenhuma declaração canônica (SITE, canonical/og:url/og:image, Sitemap:, sitemap/JSON-LD/SSR via SITE,
// smokes) pode usar *.vercel.app. Hosts *.vercel.app com outra função (allowlist do próprio deploy, Preview, OAuth)
// ficam fora desta checagem: ver docs/producao-canonica.md.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const CANONICO = 'https://tcgpricehunter.com.br';
const VERCEL_URL_RE = /https?:\/\/[^\s'"`<>)]*vercel\.app/i;

// 1) Constantes de site: SEO (SSR, sitemap, JSON-LD) e smokes públicos apontam para o domínio oficial.
const { SITE } = await import('../api/_seo.mjs');
const { SITE: SMOKE_SITE, runSeoSmoke } = await import('../tools/seo-public-smoke.mjs');
assert.equal(SITE, CANONICO, 'api/_seo.mjs SITE');
assert.equal(SMOKE_SITE, CANONICO, 'tools/seo-public-smoke.mjs SITE (post-deploy-smoke reusa)');
assert.match(read('tools/post-deploy-smoke.mjs'), /import \{[^}]*\bSITE\b[^}]*\} from '\.\/seo-public-smoke\.mjs'/, 'post-deploy-smoke usa o SITE do smoke');

// 2) index.html: canonical, og:url e og:image no domínio oficial.
const index = read('index.html');
const attr = (re) => (index.match(re) || [])[1];
assert.equal(attr(/<link rel="canonical" href="([^"]*)">/), CANONICO + '/', 'canonical do index.html');
assert.equal(attr(/<meta property="og:url" content="([^"]*)">/), CANONICO + '/', 'og:url do index.html');
assert.equal(attr(/<meta property="og:image" content="([^"]*)">/), CANONICO + '/og.jpg', 'og:image do index.html');

// 3) robots.txt anuncia o sitemap no domínio oficial, e só nele.
const sitemaps = [...read('robots.txt').matchAll(/^Sitemap:\s*(\S+)\s*$/gim)].map((m) => m[1]);
assert.deepEqual(sitemaps, [CANONICO + '/sitemap.xml'], 'robots.txt Sitemap:');

// 4) Nenhuma URL *.vercel.app nos arquivos que declaram o canônico (comentários sobre *.vercel.app sem URL não contam).
for (const f of ['index.html', 'robots.txt', 'api/_seo.mjs', 'api/sitemap.mjs', 'api/pagina.mjs', 'tools/seo-public-smoke.mjs', 'tools/post-deploy-smoke.mjs'])
  assert.doesNotMatch(read(f), VERCEL_URL_RE, `${f}: declaração canônica com *.vercel.app`);

// 5) O smoke público recusa uma Home cujo canonical ainda seja o domínio antigo.
const resp = (body, ct = 'text/html') => ({ response: { status: 200, headers: { get: (n) => (n.toLowerCase() === 'content-type' ? ct : null) } }, body });
await assert.rejects(runSeoSmoke(async () => resp('<link rel="canonical" href="https://tcg-price-hunter.vercel.app/">')), /canonical/, 'smoke aceita canonical antigo');

// 6) O documento de produção registra a decisão.
assert.ok(read('docs/producao-canonica.md').includes('`' + CANONICO + '`'), 'docs/producao-canonica.md cita o domínio canônico');

console.log('dominio-canonico: SITE, index.html, robots.txt e smokes no domínio oficial; nenhuma declaração canônica em *.vercel.app');
