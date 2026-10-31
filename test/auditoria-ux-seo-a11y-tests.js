// Auditoria de UX, SEO e acessibilidade (25/10/2026), correções seguras:
//  • og:image e JSON-LD do produto em https (a foto vinha em http da CDN da Nuvemshop; o site já troca em photo());
//  • "1 produto" no singular nas páginas de coleção e de formato (saía "1 produtos" na description e no texto);
//  • busca: o campo com aria-expanded é um combobox (axe: aria-allowed-attr crítico em todas as páginas) e a lista de
//    sugestões tem nome acessível (axe: aria-input-field-name);
//  • selo do Reclame Aqui com alvo de toque de 24 px (WCAG 2.5.8) e o texto do selo cinza sem opacidade (contraste 4,5:1).
// Sem rede: o state.json é sintético e servido pelo fetch simulado.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0;
const t = async (name, fn) => { try { await fn(); n++; } catch (e) { e.message = `${name}: ${e.message}`; throw e; } };

const now = new Date().toISOString();
const offer = (id, productId, total, extra = {}) => ({ id, productId, storeId: 's' + id, storeName: 'Loja ' + id, url: `https://loja${id}.test/p`, price: total, total, stock: 'IN_STOCK', stale: false, anomalous: false, priceKind: 'cash', firstSeen: now, ...extra });
const state = {
  generatedAt: now, dataAt: now,
  collections: [{ id: 'ca', name: 'Coleção Única', series: 'Teste' }, { id: 'cb', name: 'Coleção Dupla', series: 'Teste' }],
  types: [{ id: 'etb', label: 'Treinador Avançado (ETB)' }, { id: 'lata', label: 'Lata' }],
  products: [
    { id: 'ca-etb', collection: 'ca', collectionName: 'Coleção Única', type: 'etb', typeLabel: 'Treinador Avançado (ETB)', name: 'ETB Coleção Única', offerCount: 1, image: 'http://dcdn-us.mitiendanube.com/x/etb.webp' },
    { id: 'cb-etb', collection: 'cb', collectionName: 'Coleção Dupla', type: 'etb', typeLabel: 'Treinador Avançado (ETB)', name: 'ETB Coleção Dupla', offerCount: 1, image: 'https://cdn.test/cb-etb.webp' },
    { id: 'cb-lata', collection: 'cb', collectionName: 'Coleção Dupla', type: 'lata', typeLabel: 'Lata', name: 'Lata Coleção Dupla', offerCount: 1 },
  ],
  offers: [
    offer('1', 'ca-etb', 399.9, { image: 'http://acdn-us.mitiendanube.com/stores/1/products/etb-640-0.webp' }),
    offer('2', 'cb-etb', 410),
    offer('3', 'cb-lata', 120),
  ],
};
delete process.env.DATABASE_URL; delete process.env.API_DATABASE_URL;
globalThis.fetch = async (u) => (/state\.json/.test(String(u)) ? new Response(JSON.stringify(state), { status: 200, headers: { 'content-type': 'application/json' } }) : new Response('offline', { status: 503 }));
const { default: pagina, httpsImg, nProd } = await import('../api/pagina.mjs');
const { slugs, colSlug, typeSlug } = await import('../api/_seo.mjs');
const { of } = slugs(state.products);
const get = async (qs) => { let body = ''; const res = { statusCode: 200, setHeader() {}, end(b) { body = String(b ?? ''); return this; } };
  await pagina({ url: `/api/pagina?${qs}`, headers: {} }, res); return { status: res.statusCode, body }; };
const meta = (html, prop) => (html.match(new RegExp(`<meta property="${prop}" content="([^"]*)">`)) || [])[1];
const lds = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));

await t('httpsImg: http vira https; https, vazio e outros esquemas ficam como estão', () => {
  assert.equal(httpsImg('http://dcdn-us.mitiendanube.com/a.webp'), 'https://dcdn-us.mitiendanube.com/a.webp');
  assert.equal(httpsImg('HTTP://x.test/a.jpg'), 'https://x.test/a.jpg');
  assert.equal(httpsImg('https://x.test/a.jpg'), 'https://x.test/a.jpg');
  assert.equal(httpsImg(''), ''); assert.equal(httpsImg(null), ''); assert.equal(httpsImg(undefined), '');
  assert.equal(httpsImg('/og.jpg'), '/og.jpg');
});

await t('produto: og:image e image do JSON-LD em https quando a loja grava a foto em http', async () => {
  const pg = await get(`t=produto&slug=${encodeURIComponent(of['ca-etb'])}`);
  assert.equal(pg.status, 200);
  assert.equal(meta(pg.body, 'og:image'), 'https://acdn-us.mitiendanube.com/stores/1/products/etb-640-0.webp');
  const prod = lds(pg.body).find((j) => j['@type'] === 'Product');
  assert.equal(prod.image, 'https://acdn-us.mitiendanube.com/stores/1/products/etb-640-0.webp');
  assert.doesNotMatch(pg.body, /content="http:\/\//, 'nenhuma meta de prévia em http');
});

await t('produto: foto do catálogo em https fica igual; sem foto nenhuma, a imagem padrão do site', async () => {
  const a = await get(`t=produto&slug=${encodeURIComponent(of['cb-etb'])}`);
  assert.equal(meta(a.body, 'og:image'), 'https://cdn.test/cb-etb.webp');
  const b = await get(`t=produto&slug=${encodeURIComponent(of['cb-lata'])}`);
  assert.equal(meta(b.body, 'og:image'), 'https://tcgpricehunter.com.br/og.jpg');
  assert.equal(lds(b.body).find((j) => j['@type'] === 'Product').image, 'https://tcgpricehunter.com.br/og.jpg');
});

await t('nProd: singular e plural', () => {
  assert.equal(nProd(1), '1 produto'); assert.equal(nProd(0), '0 produtos'); assert.equal(nProd(2), '2 produtos');
});

await t('coleção com um produto diz "1 produto" (description e texto); com dois, "2 produtos"', async () => {
  const um = await get(`t=colecao&slug=${colSlug(state.collections[0])}`);
  assert.equal(um.status, 200);
  assert.doesNotMatch(um.body, /\b1 produtos\b/);
  assert.match(um.body, /<meta name="description" content="Coleção Única Pokémon TCG lacrado: 1 produto em lojas do Brasil/);
  assert.match(um.body, /<p>1 produto da coleção Coleção Única/);
  const dois = await get(`t=colecao&slug=${colSlug(state.collections[1])}`);
  assert.match(dois.body, /2 produtos em lojas do Brasil/); assert.match(dois.body, /<p>2 produtos da coleção/);
});

await t('formato com um produto diz "1 produto"', async () => {
  const pg = await get(`t=tipo&slug=${typeSlug(state.types[1])}`);
  assert.equal(pg.status, 200);
  assert.doesNotMatch(pg.body, /\b1 produtos\b/);
  assert.match(pg.body, /preço de 1 produto, de todas as coleções/); assert.match(pg.body, /<p>1 produto neste formato/);
});

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
await t('busca: campo é combobox (aria-expanded permitido) ligado à lista de sugestões com nome acessível', () => {
  const inp = (html.match(/<input id="\$\{id\}" name="q"[^>]*>/) || [])[0];
  assert.ok(inp, 'campo da busca no searchBox');
  assert.match(inp, /role="combobox"/); assert.match(inp, /aria-expanded="false"/); assert.match(inp, /aria-controls="\$\{id\}-ac"/); assert.match(inp, /aria-autocomplete="list"/);
  assert.match(html, /<div class="ac" id="\$\{id\}-ac" role="listbox" aria-label="[^"]+"/, 'listbox com nome acessível');
});

await t('selo do Reclame Aqui: alvo de toque de 24 px e texto do selo cinza sem opacidade', () => {
  const ra = (html.match(/\n\.ra\{[^}]*\}/) || [])[0];
  assert.ok(ra, 'regra .ra'); assert.match(ra, /min-height:24px/);
  assert.match(html, /\.ra-none span\{opacity:1\}/);
});

console.log(`auditoria-ux-seo-a11y: ${n} testes ok`);
