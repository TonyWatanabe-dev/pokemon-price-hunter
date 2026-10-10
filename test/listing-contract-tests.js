// Issue #47 — contrato comum do anúncio (src/adapters/contract.js): validateListing(listing, store).
// Offline: fetch simulado, nenhuma requisição real. Três partes:
//   1) anúncios válidos produzidos pelos adaptadores reais (Shopify, VTEX, JSON-LD) e no formato do Mercado Livre;
//   2) anúncios inválidos (preço, moeda, link, estoque, título, timestamp, proveniência);
//   3) varredura: os testes de coletores já existentes rodam num processo filho com os adaptadores instrumentados
//      (sem alterar esses testes) e todo anúncio que eles produzem passa pelo contrato.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const childEnv = { ...process.env }; // os testes varridos rodam com o ambiente original (sem os ajustes abaixo)
process.env.HUNTER_DOMAIN_DELAY_MS = '0';
const { validateListing, storeHosts, STOCK_VALUES, SOURCE_TYPES } = await import('../src/adapters/contract.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOW = Date.parse('2026-10-10T12:00:00Z');
const v = (l, store) => validateListing(l, store, { now: NOW });
const ok = (l, store, label) => { const r = v(l, store); assert.ok(r.ok, `${label}: devia passar — ${JSON.stringify(r.reasons)}`); return r.listing; };
const bad = (l, store, re, label) => { const r = v(l, store); assert.equal(r.ok, false, `${label}: devia falhar`); assert.ok(Array.isArray(r.reasons) && r.reasons.length, `${label}: traz motivos`); if (re) assert.ok(r.reasons.some((x) => re.test(x)), `${label}: motivo ${re} em ${JSON.stringify(r.reasons)}`); return r.reasons; };
let n = 0; const t = async (name, fn) => { await fn(); n++; };

// ---- 1) válidos, produzidos pelos adaptadores reais (fetch simulado)
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const html = (s, status = 200) => new Response(s, { status, headers: { 'content-type': 'text/html' } });
const http = await import('../src/http.js');
http.setFetch(async (url) => {
  const u = new URL(url);
  if (u.pathname === '/robots.txt') return html('', 404);
  if (u.host === 'sh.test' && u.pathname === '/search/suggest.json') return json({ resources: { results: { products: [
    { title: 'Pokémon Box Caos Ascendente', handle: 'box-caos', url: '/products/box-caos?_pos=1', variants: [{ id: 11, price: '359.90', available: true, sku: 'SH-1' }] },
  ] } } });
  if (u.host === 'www.vt.test' && u.pathname.startsWith('/api/catalog_system')) return json([
    { productName: 'Box Display Pokémon ME05 36 Boosters', link: 'https://www.vt.test/me05-display/p', items: [{ itemId: '1', name: 'u', images: [{ imageUrl: 'https://vtimg.cdn.test/1.jpg' }], sellers: [{ sellerId: '1', sellerName: 'Loja VTEX', sellerDefault: true, commertialOffer: { Price: 449.9, ListPrice: 499.9, AvailableQuantity: 5 } }] }] },
    // esgotado: VTEX escreve Price 0; o adaptador manda preço null e OUT_OF_STOCK
    { productName: 'Box Treinador Avançado Caos Ascendente', link: 'https://www.vt.test/me04-etb/p', items: [{ itemId: '2', name: 'u', sellers: [{ sellerId: '1', sellerName: 'Loja VTEX', commertialOffer: { Price: 0, ListPrice: 0, AvailableQuantity: 0 } }] }] },
  ]);
  return html('', 404);
});
const { adapters } = await import('../src/adapters/index.js');
const small = { collections: [{ id: 'me04', name: 'Caos Ascendente' }] };
const SH = { id: 'sh', url: 'https://sh.test', platform: 'shopify' };
const VT = { id: 'vt', url: 'https://www.vt.test', platform: 'vtex' };
const LD = { id: 'ld', url: 'https://ld.test', platform: 'jsonld' };
const ML = { id: 'mercadolivre', url: 'https://api.mercadolibre.com', platform: 'mercadolivre' };

await t('Shopify: anúncio real do adaptador passa', async () => {
  const L = await adapters.shopify.search(SH, small);
  assert.equal(L.length, 1);
  const l = ok(L[0], SH, 'shopify');
  assert.deepEqual([l.url, l.price.base, l.stock, l.sourceType], ['https://sh.test/products/box-caos', 359.9, 'IN_STOCK', 'store_json']);
});

await t('VTEX: em estoque e esgotado (preço null) do adaptador real passam; www. da loja não atrapalha', async () => {
  const L = await adapters.vtex.search(VT, small);
  const inS = L.find((l) => l.stock === 'IN_STOCK'); const out = L.find((l) => l.stock === 'OUT_OF_STOCK');
  ok(inS, VT, 'vtex em estoque'); ok(out, VT, 'vtex esgotado sem preço');
  assert.equal(out.price.base, null, 'esgotado chega sem preço (não inventa)');
  ok(inS, { ...VT, url: 'https://vt.test' }, 'loja sem www., link com www.');
  // _vtex (dados da simulação de frete) é preservado na normalização
  assert.deepEqual(v(inS, VT).listing._vtex, inS._vtex);
});

const ldPage = (name, price, avail = 'InStock', extra = '') => `<html><head><title>${name}</title><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', name, offers: { '@type': 'Offer', price, priceCurrency: 'BRL', availability: 'https://schema.org/' + avail } })}</script></head><body><h1>${name}</h1><p>R$ ${String(price).replace('.', ',')}</p>${extra}</body></html>`;
await t('JSON-LD: páginas reais (em estoque, pré-venda, Pix) passam', () => {
  const a = adapters.jsonld.parseProductPage(ldPage('Pokémon Booster Box Caos Ascendente 36', '359.90'), 'https://ld.test/pokemon-booster-box-caos');
  ok(a, LD, 'jsonld em estoque'); assert.equal(a.sourceType, 'json_ld');
  const b = adapters.jsonld.parseProductPage(ldPage('Pokémon Blister Triplo Caos Ascendente', '49.90', 'PreOrder'), 'https://loja.ld.test/pokemon-blister');
  assert.equal(b.stock, 'PRE_ORDER'); ok(b, LD, 'jsonld pré-venda em subdomínio da loja');
  const c = adapters.jsonld.parseProductPage(ldPage('Pokémon Box Coleção', '100.00', 'InStock', '<p>R$ 95,00 no Pix</p>'), 'https://ld.test/pokemon-box-colecao');
  assert.deepEqual(c.price, { pix: 95, base: 100 }); ok(c, LD, 'jsonld com Pix');
});

await t('Mercado Livre: formatos dos dois caminhos do adaptador passam (link em mercadolivre.com.br, loja na API)', () => {
  // caminho 2 (catálogo): link da página do produto com o vendedor selecionado, ou permalink conferido em /items
  const cat = { title: 'Pokémon Box Caos Ascendente', url: 'https://www.mercadolivre.com.br/p/MLB123?pdp_filters=item_id%3AMLB9', price: { base: 299.9 }, listPrice: null,
    stock: 'UNKNOWN', quantity: null, shipping: 0, sku: 'MLB9', ean: null, image: 'https://http2.mlstatic.com/x.jpg', seller: 'Vendedor', sellerId: 7, sellerKind: 'marketplace_seller', sourceType: 'official_api' };
  ok(cat, ML, 'ml catálogo');
  ok({ ...cat, url: 'https://produto.mercadolivre.com.br/MLB-9-box-_JM', stock: 'IN_STOCK', quantity: 3 }, ML, 'ml permalink');
  ok(cat, { id: 'mercadolivre' }, 'ml: loja só com id (como em test/ml-tests.js)');
  assert.deepEqual(storeHosts(ML), ['api.mercadolibre.com', 'mercadolivre.com.br']);
  bad({ ...cat, url: 'https://www.mercadolivre.com.br.golpe.test/p/MLB1' }, ML, /fora do domínio/, 'ml: domínio parecido');
});

await t('normalização: título aparado, link intacto, opcional ausente continua ausente, moeda informada vira BRL', () => {
  const base = { title: '  Pokémon Box  ', url: 'https://sh.test/products/x?variant=2', price: { base: 10 }, stock: 'IN_STOCK', sourceType: 'store_json' };
  const l = ok(base, SH, 'mínimo');
  assert.equal(l.title, 'Pokémon Box'); assert.equal(l.url, base.url);
  for (const k of ['currency', 'source_timestamp', 'quantity', 'image', 'listPrice', 'shipping']) assert.ok(!(k in l), `${k} ausente continua ausente`);
  assert.equal(ok({ ...base, currency: 'brl' }, SH, 'brl minúsculo').currency, 'BRL');
  ok({ ...base, source_timestamp: '2026-10-10T12:03:00Z' }, SH, 'timestamp dentro da folga');
  ok({ ...base, source_timestamp: '2026-10-09T08:00:00.000-03:00' }, SH, 'timestamp com fuso');
  assert.notEqual(l, base, 'não altera o objeto do adaptador'); assert.equal(base.title, '  Pokémon Box  ');
  for (const s of STOCK_VALUES) assert.ok(v({ ...base, stock: s }, SH).ok, `estoque ${s} aceito`);
  for (const s of SOURCE_TYPES) assert.ok(v({ ...base, sourceType: s }, SH).ok, `proveniência ${s} aceita`);
});

// ---- 2) inválidos
const good = { title: 'Pokémon Box Caos Ascendente', url: 'https://sh.test/products/box-caos', price: { base: 359.9 }, listPrice: null, stock: 'IN_STOCK', quantity: null, sku: 'SH-1', ean: null, seller: null, sourceType: 'store_json', image: null };
await t('preço: 0, negativo, NaN, Infinity, texto, objeto ausente, chave desconhecida', () => {
  bad({ ...good, price: { base: 0 } }, SH, /não é positivo/, 'preço 0');
  bad({ ...good, price: { base: -5 } }, SH, /não é positivo/, 'preço negativo');
  bad({ ...good, price: { base: NaN } }, SH, /não é número/, 'preço NaN');
  bad({ ...good, price: { base: Infinity } }, SH, /não é número/, 'preço infinito');
  bad({ ...good, price: { base: '359,90' } }, SH, /não é número/, 'preço texto (não converte)');
  bad({ ...good, price: { base: 359.9, pix: 0 } }, SH, /preço pix/, 'pix 0 junto de base válida');
  bad({ ...good, price: 359.9 }, SH, /formato/, 'preço número solto');
  bad({ ...good, price: undefined }, SH, /formato/, 'sem preço');
  bad({ ...good, price: { valor: 10 } }, SH, /desconhecido/, 'chave de preço desconhecida');
  bad({ ...good, price: { base: null } }, SH, /sem preço válido para estoque IN_STOCK/, 'em estoque sem preço');
  bad({ ...good, price: { base: null }, stock: 'PRE_ORDER' }, SH, /PRE_ORDER/, 'pré-venda sem preço');
  bad({ ...good, listPrice: 0 }, SH, /preço "de"/, 'preço "de" zero');
});
await t('moeda: USD (currency ou priceCurrency) é recusada', () => {
  bad({ ...good, currency: 'USD' }, SH, /moeda USD/, 'currency USD');
  bad({ ...good, priceCurrency: 'usd' }, SH, /moeda usd/, 'priceCurrency usd');
});
await t('link: javascript:, relativo, outro domínio, domínio parecido, credenciais, ftp, loja sem domínio', () => {
  bad({ ...good, url: 'javascript:alert(1)' }, SH, /protocolo/, 'javascript:');
  bad({ ...good, url: '/products/box-caos' }, SH, /não é absoluto/, 'relativo');
  bad({ ...good, url: '//sh.test/products/box-caos' }, SH, /não é absoluto/, 'sem protocolo');
  bad({ ...good, url: 'https://outra.test/products/box-caos' }, SH, /fora do domínio/, 'outro domínio');
  bad({ ...good, url: 'https://sh.test.golpe.test/p' }, SH, /fora do domínio/, 'sufixo enganoso');
  bad({ ...good, url: 'https://golpesh.test/p' }, SH, /fora do domínio/, 'nome colado sem ponto');
  bad({ ...good, url: 'https://user:pw@sh.test/p' }, SH, /usuário\/senha/, 'credenciais no link');
  bad({ ...good, url: 'ftp://sh.test/p' }, SH, /protocolo/, 'ftp');
  bad({ ...good, url: '' }, SH, /link ausente/, 'link vazio');
  bad(good, { id: 'x', url: null }, /sem domínio conhecido/, 'loja sem url');
  bad(good, undefined, /sem domínio conhecido/, 'sem loja');
  bad({ ...good, image: 'javascript:alert(1)' }, SH, /imagem/, 'imagem javascript:');
});
await t('estoque fora do vocabulário, título vazio, proveniência ausente, quantidade/frete inválidos', () => {
  bad({ ...good, stock: 'DISPONIVEL' }, SH, /vocabulário/, 'estoque desconhecido');
  bad({ ...good, stock: 'in_stock' }, SH, /vocabulário/, 'estoque minúsculo');
  bad({ ...good, stock: undefined }, SH, /vocabulário/, 'sem estoque');
  bad({ ...good, title: '   ' }, SH, /título vazio/, 'título só espaços');
  bad({ ...good, title: undefined }, SH, /título vazio/, 'sem título');
  bad({ ...good, title: 'undefined' }, SH, /título vazio/, 'título "undefined"');
  bad({ ...good, sourceType: undefined }, SH, /proveniência/, 'sem sourceType');
  bad({ ...good, sourceType: 'scraper' }, SH, /proveniência/, 'sourceType desconhecido');
  bad({ ...good, quantity: NaN }, SH, /quantidade/, 'quantidade NaN');
  bad({ ...good, quantity: -1 }, SH, /quantidade/, 'quantidade negativa');
  bad({ ...good, shipping: -1 }, SH, /frete/, 'frete negativo');
  bad(null, SH, /não é objeto/, 'null'); bad([], SH, /não é objeto/, 'lista');
});
await t('timestamp: futuro além da folga e inválido', () => {
  bad({ ...good, source_timestamp: '2026-10-10T12:30:00Z' }, SH, /no futuro/, 'futuro');
  bad({ ...good, source_timestamp: '2027-01-01T00:00:00Z' }, SH, /no futuro/, 'ano que vem');
  bad({ ...good, source_timestamp: 'ontem' }, SH, /timestamp inválido/, 'texto');
  bad({ ...good, source_timestamp: '2026-10-10' }, SH, /timestamp inválido/, 'só a data');
  bad({ ...good, source_timestamp: '2026-13-40T00:00:00Z' }, SH, /timestamp inválido/, 'data impossível');
  bad({ ...good, source_timestamp: 1760000000000 }, SH, /timestamp inválido/, 'número');
});
await t('vários problemas: todos os motivos voltam juntos', () => {
  const r = bad({ title: '', url: 'javascript:x', price: { base: 0 }, stock: 'X', currency: 'USD' }, SH, null, 'tudo errado');
  assert.ok(r.length >= 5, JSON.stringify(r));
});

// ---- 3) varredura: anúncios que os testes de coletores existentes produzem
// Um hook de carregamento acrescenta ao fim de cada adaptador um invólucro de search()/parseProductPage() que grava
// (loja, anúncio) num arquivo. Os testes rodam sem nenhuma alteração; a gravação preserva NaN/Infinity/undefined.
const SWEEP = ['collectors-tests.js', 'run-tests.js', 'ml-tests.js', 'alerts-opportunity-tests.js'];
await t('varredura: todo anúncio produzido pelos testes de coletores existentes cumpre o contrato', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hunter-contract-'));
  const tap = path.join(dir, 'listings.jsonl');
  const append = (name) => `
;import * as __contractTapFs from 'node:fs';
const __contractTapEnc = (x) => JSON.stringify(x, (k, val) => (typeof val === 'number' && !Number.isFinite(val) ? { __num: String(val) } : val === undefined ? { __undef: true } : val));
const __contractTapRec = (rec) => { try { if (process.env.LISTING_TAP_FILE) __contractTapFs.appendFileSync(process.env.LISTING_TAP_FILE, __contractTapEnc(rec) + '\\n'); } catch { /* gravação nunca derruba o teste */ } };
const __contractTapStore = (s) => (s && typeof s === 'object' ? { id: s.id ?? null, url: s.url ?? null, platform: s.platform ?? null } : null);
${name === 'jsonld' ? `parseProductPage = ((f) => function (html, url) { const r = f(html, url); if (r) { let origin = null; try { origin = new URL(url).origin; } catch {} __contractTapRec({ adapter: 'jsonld', via: 'parseProductPage', store: { id: null, url: origin, platform: 'jsonld' }, listing: r }); } return r; })(parseProductPage);` : ''}
search = ((f) => async function (store, ...rest) { const r = await f.call(this, store, ...rest); for (const l of Array.isArray(r) ? r : []) __contractTapRec({ adapter: '${name}', via: 'search', store: { ...__contractTapStore(store), platform: (store && store.platform && store.platform !== 'auto') ? store.platform : '${name}' }, listing: l }); return r; })(search);
`;
  const hooks = path.join(dir, 'hooks.mjs');
  fs.writeFileSync(hooks, `const APPEND = ${JSON.stringify(Object.fromEntries(['shopify', 'vtex', 'jsonld', 'mercadolivre'].map((k) => [k, append(k)])))};
export async function load(url, context, next) {
  const r = await next(url, context);
  const m = /\\/src\\/adapters\\/(shopify|vtex|jsonld|mercadolivre)\\.js$/.exec(url);
  if (!m || r.source == null) return r;
  return { ...r, source: Buffer.from(r.source).toString('utf8') + APPEND[m[1]], shortCircuit: true };
}
`);
  const reg = path.join(dir, 'register.mjs');
  fs.writeFileSync(reg, `import { register } from 'node:module';\nregister(${JSON.stringify(pathToFileURL(hooks).href)});\n`);
  // test/.demo-state.json é escrito por run-tests.js: guardado e devolvido como estava.
  const demo = path.join(root, 'test/.demo-state.json'); const demoBefore = fs.existsSync(demo) ? fs.readFileSync(demo) : null;
  try {
    for (const f of SWEEP) {
      execFileSync(process.execPath, ['--import', pathToFileURL(reg).href, path.join(root, 'test', f)], { cwd: root, env: { ...childEnv, LISTING_TAP_FILE: tap }, stdio: ['ignore', 'ignore', 'pipe'], timeout: 300e3 });
    }
  } finally { if (demoBefore) fs.writeFileSync(demo, demoBefore); }
  const dec = (s) => JSON.parse(s, (k, val) => (val && typeof val === 'object' && !Array.isArray(val) ? ('__num' in val ? Number(val.__num) : val.__undef ? undefined : val) : val));
  const recs = fs.readFileSync(tap, 'utf8').split('\n').filter(Boolean).map(dec);
  fs.rmSync(dir, { recursive: true, force: true });
  const by = {}; for (const r of recs) by[r.adapter] = (by[r.adapter] || 0) + 1;
  for (const a of ['shopify', 'vtex', 'jsonld', 'mercadolivre']) assert.ok(by[a] > 0, `varredura cobre ${a} (${JSON.stringify(by)})`);
  const fails = [];
  for (const r of recs) { const res = validateListing(r.listing, r.store); if (!res.ok) fails.push(`${r.adapter}/${r.via} ${r.listing?.url}: ${res.reasons.join('; ')}`); }
  assert.deepEqual(fails, [], `anúncios dos testes existentes fora do contrato:\n${fails.join('\n')}`);
  console.log(`  varredura: ${recs.length} anúncios dos testes existentes conferidos (${Object.entries(by).map(([k, c]) => `${k} ${c}`).join(', ')})`);
});

console.log(`✓ Contrato comum do anúncio (#47): ${n} grupos de testes passaram`);

// C2 (#177): contrato ligado no coletor (src/run.js), rodada simulada com adaptador falso.
await import('./listing-contract-run-tests.js');
