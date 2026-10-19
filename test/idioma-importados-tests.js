// Importados (inglês, japonês, chinês, coreano): produto próprio com sufixo de idioma, sem preço Copag,
// filtro de idioma no site (padrão Português) e idioma no nome/slug.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { matchProduct, msrpKeys, langOfId } from '../src/match.js';
import { slugs, label, langOf } from '../api/_seo.mjs';
import { siteProducts } from '../api/_lib/site.mjs';
import { productsRows } from '../src/core/mappers.js';

const catalog = JSON.parse(readFileSync(new URL('../config/catalog.json', import.meta.url)));
const m = (t) => matchProduct({ title: t, price: 300 }, catalog);

const pt = m('Pokémon TCG Booster Box Fagulhas Impetuosas 36 Boosters');
const en = m('Pokémon TCG Booster Box Fagulhas Impetuosas 36 Boosters Inglês');
const ja = m('Pokémon TCG Booster Box Fagulhas Impetuosas 36 Boosters Japonês');
const zh = m('Booster Box Pokémon Fagulhas Impetuosas 36 boosters Chinês');
const ko = m('Booster Box Pokémon Fagulhas Impetuosas 36 boosters Coreano');
assert.equal(pt.productId, 'sv8-box36');
assert.deepEqual([en, ja, zh, ko].map((x) => x.productId), ['sv8-box36-en', 'sv8-box36-ja', 'sv8-box36-zh', 'sv8-box36-ko']);
assert.equal(en.product.language, 'en'); assert.equal(pt.product.language, 'pt');
assert.equal(m('Booster Box Fagulhas Impetuosas 36 boosters Francês').productId, null, 'outros idiomas seguem recusados');
assert.equal(m('Booster Box Fagulhas Impetuosas 36 boosters Inglês Português').productId, null, 'dois idiomas: recusa');
assert.equal(langOfId('sv8-box36-en'), 'en'); assert.equal(langOfId('sv8-box36'), 'pt');
assert.deepEqual(msrpKeys({ id: 'sv8-box36-en', collection: 'sv8', type: 'booster_box', boosters: 36 }), [], 'importado não herda preço Copag');
assert.ok(msrpKeys({ id: 'sv8-box36', collection: 'sv8', type: 'booster_box', boosters: 36 }).includes('sv8-box36'));

// nome, slug e banco
const P = (id, extra = {}) => ({ id, collection: 'sv8', collectionName: 'Fagulhas Impetuosas', type: 'booster_box', typeLabel: 'Booster Box', group: 'Boosters', boosters: 36, ...extra });
assert.equal(label(P('sv8-box36-ja')), 'Booster Box 36 Japonês'); assert.equal(langOf(P('sv8-box36-ja')), 'ja');
const { of } = slugs([P('sv8-box36', { offerCount: 1 }), P('sv8-box36-en', { offerCount: 9 })]);
assert.equal(of['sv8-box36'], 'fagulhas-impetuosas-booster-box-36', 'importado com mais ofertas não toma o slug do PT');
assert.equal(of['sv8-box36-en'], 'fagulhas-impetuosas-booster-box-36-ingles');
assert.deepEqual(productsRows([P('sv8-box36-zh'), P('sv8-box36')]).map((r) => r.language), ['zh', 'pt-BR']);

// site: padrão Português; importado aparece na lista (não no bloco "sem preço sugerido"), com filtro por idioma
const O = (id, productId, total) => ({ id, productId, storeId: 's', storeName: 'Loja', total, price: total, stock: 'IN_STOCK', stale: false, anomalous: false, url: 'https://loja.test/' + id });
const st = { products: [P('sv8-box36', { msrp: 500, copagConfirmed: true }), P('sv8-box36-en'), P('sv8-box36-ja')], offers: [O('a', 'sv8-box36', 400), O('b', 'sv8-box36-en', 450), O('c', 'sv8-box36-ja', 420)], collections: [{ id: 'sv8', name: 'Fagulhas Impetuosas' }] };
const ids = (F) => siteProducts(st, F).items.map((e) => e.p.id).sort();
assert.deepEqual(ids({}), ['sv8-box36'], 'padrão: só português');
assert.deepEqual(ids({ lang: 'en' }), ['sv8-box36-en']);
assert.deepEqual(ids({ lang: 'todos' }), ['sv8-box36', 'sv8-box36-en', 'sv8-box36-ja']);
assert.equal(siteProducts(st, { lang: 'ja' }).noCopagCount, 0, 'importado não vai para "sem preço sugerido"');
assert.deepEqual(siteProducts(st, {}).facets.langs, [['pt', 1], ['en', 1], ['ja', 1]]);

// site (navegador): mesma regra e etiqueta no card
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert.match(html, /lang:"pt"\},store\.get\("f"/, 'filtro abre em Português');
assert.match(html, /id="f-lang" data-f="lang"/);
assert.match(html, /q\.set\("idioma",F\.lang\)/);
assert.equal((html.match(/class="lang-chip"/g) || []).length, 3, 'etiqueta de idioma nos cards');
console.log('idioma-importados-tests ok');

// nomes da coleção em outro idioma (langAliases): sem idioma no título, vale o idioma do nome
{
  const t = (s) => matchProduct({ title: s }, catalog).productId;
  assert.equal(t('Pokemon TCG Surging Sparks Booster Box 36 packs'), 'sv8-box36-en');
  assert.equal(t('Pokémon Elite Trainer Box Prismatic Evolutions'), 'sv8_5-etb-en');
  assert.equal(t('Booster Box Surging Sparks 36 Boosters Português'), null, 'português com nome em inglês: contraditório');
  assert.equal(t('Booster Box Pokémon Card 151 japonês 20 boosters'), 'sv3_5-box20-ja');
  assert.match(t('Pokémon Booster Box Mega Brave 30 boosters'), /^jp\d+-box30-ja$/, 'coleção só do Japão');
  assert.match(t('Booster Box Mega Brave Coreano 30 boosters'), /-box30-ko$/, 'idioma do título vence o do nome');
  assert.match(t('Booster Box Pokemon CSV9 Stellar Crystal 30 boosters'), /^cn\d+-box30-zh$/);
  assert.equal(t('Pokémon TCG Booster Box Fagulhas Impetuosas 36 boosters'), 'sv8-box36', 'nome em português continua PT');
}

// banco: listOpportunities aplica o idioma ($13, com pt → pt-BR); a página pré-renderizada pede só português
{
  const { listOpportunities } = await import('../api/_lib/read-db.mjs');
  const calls = []; const query = async (sql, params) => { calls.push({ sql, params }); return []; };
  for (const idioma of ['pt', 'en', null]) await listOpportunities({ page: 1, limit: 5, idioma, query });
  assert.deepEqual(calls.map((c) => c.params[12]), ['pt-BR', 'en', null]);
  assert.match(calls[0].sql, /\$13::text IS NULL OR p\.language = \$13/);
  const pagina = readFileSync(new URL('../api/pagina.mjs', import.meta.url), 'utf8');
  assert.match(pagina, /listOpportunities\(\{ page: 1, limit: t === 'home' \? 15 : 20, idioma: 'pt' \}\)/, 'SSR da Home e de /oportunidades só com português');
}
console.log('idioma-importados-tests: nomes, banco e SSR ok');
