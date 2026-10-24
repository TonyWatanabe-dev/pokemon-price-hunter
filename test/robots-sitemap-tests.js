// Mapas do site declarados no robots.txt (24/10/2026), usados pelo diagnóstico da sonda. Só do mesmo host, no máximo 5.
// Não entram no robô diário: a sonda mostrou 0 anúncio a mais nas lojas testadas (Kalunga, Leitura, Havan, VIP TCG).
import assert from 'node:assert/strict';
import { sitemapsFrom } from '../src/robots.js';
const txt = 'User-agent: *\nDisallow: /checkout\nSitemap: https://www.loja.test/sitemap_index.xml\nsitemap:https://loja.test/produtos.xml\nSitemap: https://outra.test/s.xml\nSitemap: lixo\n';
assert.deepEqual(sitemapsFrom(txt, 'https://www.loja.test'), ['https://www.loja.test/sitemap_index.xml', 'https://loja.test/produtos.xml']);
assert.deepEqual(sitemapsFrom('', 'https://a.test'), []);
assert.equal(sitemapsFrom(Array.from({ length: 9 }, (_, i) => `Sitemap: https://a.test/s${i}.xml`).join('\n'), 'https://a.test').length, 5);
console.log('✓ robots-sitemap: linhas Sitemap: do robots.txt (diagnóstico da sonda)');
