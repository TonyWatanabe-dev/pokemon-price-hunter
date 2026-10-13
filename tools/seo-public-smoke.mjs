// Public, read-only smoke test for the canonical Vercel deployment.
import assert from 'node:assert/strict';

const SITE = 'https://tcg-price-hunter.vercel.app';

async function get(path) {
  const response = await fetch(SITE + path, { redirect: 'follow', signal: AbortSignal.timeout(15_000), headers: { 'user-agent': 'tcg-price-hunter-seo-smoke/1.0' } });
  const body = await response.text();
  return { response, body };
}

const home = await get('/');
assert.equal(home.response.status, 200, 'Home precisa responder HTTP 200');
assert.match(home.response.headers.get('content-type') || '', /text\/html/i, 'Home precisa responder HTML');
assert.match(home.body, /<link[^>]+rel=["']canonical["'][^>]+href=["']https:\/\/tcg-price-hunter\.vercel\.app\/?["']/i, 'Home precisa declarar canonical para o domínio principal');

const robots = await get('/robots.txt');
assert.equal(robots.response.status, 200, 'robots.txt precisa responder HTTP 200');
assert.match(robots.body, /^User-agent:\s*\*/im, 'robots.txt precisa declarar User-agent');
assert.match(robots.body, /^Sitemap:\s*https:\/\/tcg-price-hunter\.vercel\.app\/sitemap\.xml\s*$/im, 'robots.txt precisa anunciar sitemap canônico');
const disallowed = [...robots.body.matchAll(/^Disallow:\s*(\S+)\s*$/gim)].map((m) => m[1]);
assert.deepEqual(disallowed, ['/api/'], 'somente /api/ deve ser bloqueada; páginas noindex precisam continuar rastreáveis');

const sitemap = await get('/sitemap.xml');
assert.equal(sitemap.response.status, 200, 'sitemap.xml precisa responder HTTP 200');
assert.match(sitemap.response.headers.get('content-type') || '', /xml/i, 'sitemap precisa responder XML');
assert.match(sitemap.body, /<urlset\b/i, 'sitemap precisa conter urlset');
assert.match(sitemap.body, /<loc>https:\/\/tcg-price-hunter\.vercel\.app\/<\/loc>/, 'sitemap precisa incluir a Home canônica');
assert.doesNotMatch(sitemap.body, /\/(conta|favoritos|alertas|configuracoes)(?:<\/loc>|\/)/i, 'sitemap não pode listar rotas privadas');

for (const route of ['/conta', '/favoritos', '/alertas', '/configuracoes']) {
  const { response } = await get(route);
  assert.equal(response.status, 200, route + ' precisa estar acessível ao crawler para ler noindex');
  assert.match(response.headers.get('x-robots-tag') || '', /noindex/i, route + ' precisa enviar X-Robots-Tag: noindex');
}

console.log('SEO public smoke OK:', SITE, '| Home, robots.txt, sitemap.xml, private-route noindex');
