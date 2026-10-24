// Leitor JSON-LD acha o mapa do site declarado no robots.txt (24/10/2026). Só do mesmo host, no máximo 5.
import assert from 'node:assert/strict';
import { sitemapsFrom } from '../src/robots.js';
const txt = 'User-agent: *\nDisallow: /checkout\nSitemap: https://www.loja.test/sitemap_index.xml\nsitemap:https://loja.test/produtos.xml\nSitemap: https://outra.test/s.xml\nSitemap: lixo\n';
assert.deepEqual(sitemapsFrom(txt, 'https://www.loja.test'), ['https://www.loja.test/sitemap_index.xml', 'https://loja.test/produtos.xml']);
assert.deepEqual(sitemapsFrom('', 'https://a.test'), []);
assert.equal(sitemapsFrom(Array.from({ length: 9 }, (_, i) => `Sitemap: https://a.test/s${i}.xml`).join('\n'), 'https://a.test').length, 5);
// productUrls usa o mapa declarado quando /sitemap.xml não existe
const http = await import('../src/http.js'); const robots = await import('../src/robots.js');
const pages = {
  'https://m.test/robots.txt': 'User-agent: *\nAllow: /\nSitemap: https://m.test/mapa/produtos.xml',
  'https://m.test/mapa/produtos.xml': '<urlset><url><loc>https://m.test/prod/booster-pokemon-tcg-caos-ascendente/1</loc></url><url><loc>https://m.test/prod/caneta/2</loc></url></urlset>',
};
http.setSleep(async () => {}); robots._resetRobots();
http.setFetch(async (url) => { const b = pages[url]; return { status: b == null ? 404 : 200, ok: b != null, headers: new Map(), url, text: async () => b ?? '' }; });
const { productUrls } = await import('../src/adapters/jsonld.js');
assert.deepEqual([...(await productUrls('https://m.test', 10))], ['https://m.test/prod/booster-pokemon-tcg-caos-ascendente/1']);
console.log('✓ robots-sitemap: mapa do robots.txt usado pelo leitor JSON-LD');
