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
