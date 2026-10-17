// "Também na Shopee" (17/10): anúncios com link de afiliado do dono, lidos no Chrome, em config/afiliados/shopee-ofertas.json.
// Trava as regras: só links do painel do dono (o mesmo de config/afiliados/shopee.json), casados pelo matcher do site com
// confiança >= 0,8, selados, sem anúncio de várias opções; preço sem cupom como principal, sempre com data e hora; fora do
// ranking (nenhum módulo de preço/ranking/API lê o arquivo) e mostrado só no bloco próprio.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { matchProduct } from '../src/match.js';
const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const doc = JSON.parse(read('config/afiliados/shopee-ofertas.json'));
const links = JSON.parse(read('config/afiliados/shopee.json')).links;
const catalog = JSON.parse(read('config/catalog.json')); catalog.products ||= []; catalog.copag ||= {};
assert.equal(doc.program, 'shopee');
assert.ok(Array.isArray(doc.ofertas) && doc.ofertas.length > 0);
const seen = new Set();
for (const o of doc.ofertas) {
  assert.deepEqual(Object.keys(o).sort(), ['capturedAt', 'item', 'price', 'priceCupom', 'productId', 'seller', 'selo', 'stockNote', 'title', 'url'], o.item);
  assert.match(o.item, /^\d+\/\d+$/); assert.ok(!seen.has(o.item), `anúncio repetido ${o.item}`); seen.add(o.item);
  assert.equal(o.url, links[o.item], `${o.item}: url tem de ser o link do dono em shopee.json`);
  assert.match(o.url, /^https:\/\/s\.shopee\.com\.br\/[A-Za-z0-9]+$/);
  assert.ok(typeof o.price === 'number' && o.price > 0 && (o.priceCupom === null || (o.priceCupom > 0 && o.priceCupom <= o.price)), `${o.item}: preços`);
  assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?Z$/.test(o.capturedAt) && Date.parse(o.capturedAt) <= Date.now(), `${o.item}: capturedAt`);
  assert.ok(typeof o.seller === 'string' && o.seller && !/moto|pe[çc]as|natura/i.test(o.seller), `${o.item}: vendedor`);
  assert.doesNotMatch(o.title, /\bou\b|escolh|diversas|v[aá]rias|cole[çc][õo]es/i, `${o.item}: anúncio com várias opções`);
  const m = matchProduct({ title: o.title }, catalog);
  assert.equal(m.productId, o.productId, `${o.item}: casa com ${m.productId}`); assert.ok(m.confidence >= 0.8, `${o.item}: confiança ${m.confidence}`);
}
const html = read('index.html');
assert.equal(html.match(/fetch\("\/data\/afiliados-shopee\.json"\)/g)?.length, 1, 'carregado num único lugar');
assert.equal(html.match(/SHP\?\.ofertas|SHP\.ofertas/g)?.length, 1, 'lido só pelo shpBlock');
const row = html.match(/function shpRow\(l\)\{[\s\S]*?\n/)[0] + html.match(/function shpRow\(l\)\{[\s\S]*?<\/a><\/div>`\}/)[0];
assert.match(row, /money\(l\.price\)\}<\/b> <small>em \$\{esc\(when\)\}/, 'preço com data e hora');
assert.match(row, /com cupom da Shopee/, 'valor com cupom marcado como tal');
assert.match(row, /href="\$\{esc\(safeUrl\(l\.url\)\)\}" target="_blank" rel="noopener nofollow sponsored"/);
assert.match(JSON.parse(read('package.json')).scripts.build, /cp config\/afiliados\/shopee-ofertas\.json public\/data\/afiliados-shopee\.json/);
for (const f of ['src/core/price-engine.js', 'src/core/opportunity-engine.js', 'api/v1.mjs', 'api/pagina.mjs', 'api/_lib/affiliates.mjs'])
  assert.doesNotMatch(read(f), /shopee-ofertas/, `${f} não pode ler a lista`);
console.log(`✓ Também na Shopee: ${doc.ofertas.length} anúncios do dono, fora do ranking`);
for (const f of ['config/afiliados/shopee-ofertas.json', 'config/afiliados/amazon.json'])
  assert.doesNotMatch(read(f), /\b1 unidades?\b/, `${f}: estoque de 1 vira "última unidade"`);
