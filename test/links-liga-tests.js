// "Compare também na Liga Pokémon": só links 1:1 para páginas de produto da Liga, sem preço.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const j = JSON.parse(readFileSync(new URL('../config/links-liga.json', import.meta.url)));
const catalog = JSON.parse(readFileSync(new URL('../config/catalog.json', import.meta.url)));
const cols = new Set(catalog.collections.map((c) => c.id).concat('avulsos'));
const urls = Object.values(j.links);
assert.ok(urls.length > 100, 'mapa carregado');
for (const [id, u] of Object.entries(j.links)) {
  assert.match(u, /^https:\/\/www\.ligapokemon\.com\.br\/\?view=prod\/view&pcode=\d+$/, id);
  assert.ok(cols.has(id.split('-')[0]), `coleção conhecida: ${id}`);
}
assert.equal(new Set(urls).size, urls.length, 'cada página da Liga liga a um produto só');
assert.ok(!JSON.stringify(j).match(/pre[cç]o"\s*:|"price"/i), 'nenhum preço da Liga no arquivo');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert.match(html, /<div id="pp-liga">\$\{ligaBlock\(pid\)\}<\/div>/);
assert.match(html, /rel="noopener nofollow" data-liga=/);
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
assert.match(pkg.scripts.build, /cp config\/links-liga\.json public\/data\/links-liga\.json/);
console.log('links-liga-tests ok');
