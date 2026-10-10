// Contrato dos adaptadores por loja (Shopify, VTEX, JSON-LD, Mercado Livre), offline com fetch simulado:
// todo adaptador devolve anúncios na estrutura comum OU falha de forma tipada, e a falha de um não afeta os outros.
// Complementa test/collectors-tests.js (falha passageira ponta a ponta) e test/ml-tests.js (fluxo do catálogo do ML).
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import * as fx from './fixtures/adapter-contract.js';
process.env.HUNTER_DOMAIN_DELAY_MS = '0';
process.env.HUNTER_TIPS = '0';
for (const k of ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_SHA', 'GITHUB_EVENT_NAME', 'HUNTER_CEP', 'HUNTER_BUDGET_MIN', 'ML_CLIENT_SECRET']) delete process.env[k];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hunter-contract-'));
process.env.HUNTER_CONFIG_DIR = path.join(tmp, 'config'); process.env.HUNTER_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.HUNTER_CONFIG_DIR, { recursive: true });
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
fs.copyFileSync(path.join(root, 'config/catalog.json'), path.join(tmp, 'config/catalog.json'));
fs.writeFileSync(path.join(tmp, 'config/stores.json'), JSON.stringify({ stores: [
  { id: 'sh', name: 'Loja Shopify', url: 'https://sh.test', platform: 'shopify', kind: 'specialist', evidence: {} },
  { id: 'vt', name: 'Loja VTEX', url: 'https://vt.test', platform: 'vtex', kind: 'specialist', evidence: {} },
  { id: 'ld', name: 'Loja JSON-LD', url: 'https://ld.test', platform: 'jsonld', kind: 'specialist', evidence: {} },
] }));
fs.writeFileSync(path.join(tmp, 'config/watchlist.json'), JSON.stringify({ settings: { cep: null }, rules: [] }));

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const html = (s, status = 200) => new Response(s, { status, headers: { 'content-type': 'text/html' } });
const http = await import('../src/http.js');

// Cada loja simulada responde conforme o modo: texto = falha (código HTTP, timeout, JSON ilegível); objeto = corpo JSON.
const mode = { sh: 'ok', vt: 'ok', ml: 'ok' };
const reply = (m) => {
  if (m === 'timeout') throw Object.assign(new Error('aborted'), { name: 'AbortError' });
  if (m === 'badjson') return html('isto não é json');
  if (/^\d+$/.test(m)) return html('erro', Number(m));
  return json(m);
};
const okBody = {
  sh: fx.shopifySuggest(fx.shopifyProduct()),
  vt: [fx.vtexProduct()],
  ml: { results: [fx.mlResult()] },
};
const body = (k) => (mode[k] === 'ok' ? okBody[k] : mode[k]);
const PAGES = { // JSON-LD: uma página por cenário
  '/pokemon-box-ok': () => html(fx.productPage('Pokémon Booster Box Caos Ascendente 36 boosters Copag', '359.90')),
  '/pokemon-box-esgotado': () => html(fx.productPage('Pokémon Box Treinador Avançado Caos Ascendente Copag', '289.90', 'OutOfStock')),
  '/pokemon-box-vazio': () => html(fx.emptyPage),
  '/pokemon-box-lixo': () => html('<html><script type="application/ld+json">{quebrado</script></html>'),
  '/pokemon-box-404': () => html('não encontrado', 404),
  '/pokemon-box-503': () => html('erro', 503),
  '/pokemon-box-timeout': () => reply('timeout'),
  '/pokemon-box-403': () => html('Forbidden', 403),
};
http.setFetch(async (url) => {
  const u = new URL(url);
  if (u.pathname === '/robots.txt') return html('', 404);
  if (u.host === 'sh.test') return reply(body('sh'));
  if (u.host === 'vt.test') return u.pathname.includes('simulation') ? html('erro', 500) : reply(body('vt'));
  if (u.host === 'pg.test') return (PAGES[u.pathname] || (() => html('', 404)))();
  if (u.host === 'api.mercadolibre.com') {
    if (typeof mode.ml === 'string' && mode.ml !== 'ok') return reply(mode.ml);
    return u.pathname === '/sites/MLB/search' ? json(body('ml')) : json({});
  }
  if (u.host === 'ld.test') {
    if (u.pathname === '/sitemap.xml') return html('<urlset><url><loc>https://ld.test/pokemon-booster-box-caos-ascendente-36</loc></url></urlset>');
    return html(fx.productPage('Pokémon Booster Box Caos Ascendente 36 boosters Copag', '359.90'));
  }
  return html('', 404);
});

// ===== Estrutura comum de um anúncio
const STOCK = new Set(['IN_STOCK', 'OUT_OF_STOCK', 'UNKNOWN', 'PRE_ORDER', 'UNAVAILABLE']);
function assertListing(l, label) {
  assert.ok(l && typeof l === 'object', `${label}: anúncio é objeto`);
  assert.ok(typeof l.title === 'string' && l.title.trim() && l.title !== 'undefined', `${label}: título`);
  assert.ok(typeof l.url === 'string' && /^https?:\/\/[^\s]+$/.test(l.url), `${label}: URL absoluta (${l.url})`);
  assert.ok(l.price && typeof l.price === 'object', `${label}: price é objeto`);
  assert.ok(l.price.base === null || (typeof l.price.base === 'number' && Number.isFinite(l.price.base) && l.price.base > 0), `${label}: preço base positivo ou nulo (${l.price.base})`);
  assert.ok(STOCK.has(l.stock), `${label}: estoque válido (${l.stock})`);
  assert.ok(l.quantity === null || l.quantity === undefined || (Number.isFinite(l.quantity) && l.quantity >= 0), `${label}: quantidade`);
  assert.ok(typeof l.sourceType === 'string' && l.sourceType, `${label}: sourceType`);
  assert.ok(l.listPrice == null || l.listPrice > 0, `${label}: preço "de"`);
  assert.ok(l.image == null || /^https?:\/\//.test(l.image), `${label}: imagem absoluta`);
}
// Falha tipada: Error com status (HTTP, 0 = timeout) e, quando é bloqueio, blocked = true.
const failure = async (p) => { try { await p; } catch (e) { return e; } return assert.fail('devia falhar'); };
function assertTyped(e, label) {
  assert.ok(e instanceof Error && e.message, `${label}: Error com mensagem`);
  if (e.blocked) assert.ok(['number', 'string'].includes(typeof e.status), `${label}: bloqueio traz status`);
  else assert.ok(Number.isInteger(e.status), `${label}: falha de rede traz status inteiro (${e.status})`);
}

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'config/catalog.json'), 'utf8'));
const small = { ...catalog, collections: catalog.collections.slice(0, 1) }; // poucas buscas por teste
const { adapters } = await import('../src/adapters/index.js');
const sh = { id: 'sh', url: 'https://sh.test' }; const vt = { id: 'vt', url: 'https://vt.test' };

// Todo adaptador registrado expõe search() (e detect(), exceto o Mercado Livre, que é por API autorizada)
for (const [name, a] of Object.entries(adapters)) assert.equal(typeof a.search, 'function', `${name}: search()`);
for (const name of ['shopify', 'vtex', 'jsonld']) assert.equal(typeof adapters[name].detect, 'function', `${name}: detect()`);

// ===== Shopify
{ const L = await adapters.shopify.search(sh, small);
  assert.equal(L.length, 1); assertListing(L[0], 'shopify');
  assert.deepEqual([L[0].url, L[0].price.base, L[0].stock, L[0].sku, L[0].sourceType], ['https://sh.test/products/box-caos', 359.9, 'IN_STOCK', 'SH-1', 'store_json'], 'shopify: preço, estoque, URL sem query');
  mode.sh = fx.shopifySuggest(fx.shopifyProduct({ available: false }));
  assert.equal((await adapters.shopify.search(sh, small))[0].stock, 'OUT_OF_STOCK', 'shopify: sem estoque');
  mode.sh = fx.shopifySuggest(fx.shopifyNoPrice());
  const [np] = await adapters.shopify.search(sh, small); assertListing(np, 'shopify sem preço');
  assert.deepEqual([np.price.base, np.stock], [null, 'UNKNOWN'], 'shopify: sem preço = nulo, estoque desconhecido (nunca inventa)');
  mode.sh = [1, 2, 3]; // payload inesperado (JSON válido, formato errado)
  assert.deepEqual(await adapters.shopify.search(sh, small), [], 'shopify: payload inesperado não vira anúncio');
  for (const m of ['503', 'timeout']) { mode.sh = m; assertTyped(await failure(adapters.shopify.search(sh, small)), 'shopify ' + m); }
  mode.sh = '403'; const b = await failure(adapters.shopify.search(sh, small));
  assertTyped(b, 'shopify 403'); assert.ok(b.blocked && b.status === 403, 'shopify: 403 é bloqueio tipado');
  mode.sh = 'badjson'; const bj = await failure(adapters.shopify.search(sh, small));
  assert.ok(bj instanceof Error, 'shopify: JSON ilegível falha com Error (sem anúncio parcial)');
  mode.sh = 'ok'; }

// ===== VTEX
{ const L = await adapters.vtex.search(vt, small);
  assert.equal(L.length, 1); assertListing(L[0], 'vtex');
  assert.deepEqual([L[0].url, L[0].price.base, L[0].stock, L[0].quantity, L[0].sku, L[0].sourceType], ['https://vt.test/me05-display/p', 449.9, 'IN_STOCK', 5, '1', 'store_api'], 'vtex: preço, estoque, URL');
  assert.deepEqual(L[0]._vtex, { base: 'https://vt.test', itemId: '1', sellerId: '1' }, 'vtex: dados para a simulação de frete');
  mode.vt = [fx.vtexProduct({ qty: 0 })];
  assert.deepEqual([(await adapters.vtex.search(vt, small))[0].stock, (await adapters.vtex.search(vt, small))[0].quantity], ['OUT_OF_STOCK', null], 'vtex: sem estoque');
  mode.vt = [fx.vtexProduct({ price: 0, qty: 0 })];
  const [np] = await adapters.vtex.search(vt, small); assertListing(np, 'vtex sem preço');
  assert.deepEqual([np.price.base, np.stock], [null, 'OUT_OF_STOCK'], 'vtex: preço zero = nulo e sem estoque');
  mode.vt = { erro: 'formato novo' }; assert.deepEqual(await adapters.vtex.search(vt, small), [], 'vtex: payload que não é lista não vira anúncio');
  mode.vt = [{ productName: 'Sem itens', link: 'https://vt.test/x/p' }, { productName: 'Sem vendedor', link: 'https://vt.test/y/p', items: [{ itemId: '9' }] }];
  assert.deepEqual(await adapters.vtex.search(vt, small), [], 'vtex: produto sem itens ou sem vendedor é ignorado');
  for (const m of ['503', 'timeout']) { mode.vt = m; assertTyped(await failure(adapters.vtex.search(vt, small)), 'vtex ' + m); }
  mode.vt = '429'; const b = await failure(adapters.vtex.search(vt, small));
  assertTyped(b, 'vtex 429'); assert.ok(b.blocked && b.status === 429, 'vtex: 429 é bloqueio tipado');
  mode.vt = 'ok'; }

// ===== JSON-LD (páginas de produto lidas direto, sem sitemap)
{ const pg = (...paths) => ({ id: 'pg', url: 'https://pg.test', plannedUrls: paths.map((p) => 'https://pg.test' + p) });
  const L = await adapters.jsonld.search(pg('/pokemon-box-ok', '/pokemon-box-esgotado', '/pokemon-box-vazio', '/pokemon-box-lixo', '/pokemon-box-404', '/pokemon-box-503', '/pokemon-box-timeout'));
  assert.equal(L.length, 2, 'jsonld: só as páginas com produto viram anúncio'); L.forEach((l, i) => assertListing(l, 'jsonld ' + i));
  const ok = L.find((l) => l.url.endsWith('-ok')); const out = L.find((l) => l.url.endsWith('-esgotado'));
  assert.deepEqual([ok.price.base, ok.stock, ok.sourceType, ok.url], [359.9, 'IN_STOCK', 'json_ld', 'https://pg.test/pokemon-box-ok'], 'jsonld: preço, estoque, URL');
  assert.deepEqual([out.price.base, out.stock], [289.9, 'OUT_OF_STOCK'], 'jsonld: esgotado');
  // página sem produto, JSON-LD quebrado e 404 (produto não existe mais) não são falha; 5xx e timeout são, e a página fica registrada
  assert.deepEqual([...L.failed].sort(), ['https://pg.test/pokemon-box-503', 'https://pg.test/pokemon-box-timeout'], 'jsonld: falhas passageiras listadas em failed');
  const b = await failure(adapters.jsonld.search(pg('/pokemon-box-ok', '/pokemon-box-403')));
  assertTyped(b, 'jsonld 403'); assert.ok(b.blocked && b.status === 403, 'jsonld: bloqueio derruba a loja, não vira anúncio parcial'); }

// ===== Mercado Livre (API oficial com token de teste; o fluxo do catálogo está em test/ml-tests.js)
{ delete process.env.ML_ACCESS_TOKEN;
  const sem = await failure(adapters.mercadolivre.search({ id: 'mercadolivre' }, small));
  assertTyped(sem, 'ml sem acesso'); assert.ok(sem.blocked && sem.status === 'auth', 'ml: sem autorização é bloqueio tipado, sem tentar raspar');
  process.env.ML_ACCESS_TOKEN = 'token-de-teste';
  const ml = { id: 'mercadolivre' };
  const L = await adapters.mercadolivre.search(ml, small);
  assert.equal(L.length, 1); assertListing(L[0], 'ml');
  assert.deepEqual([L[0].url, L[0].price.base, L[0].stock, L[0].quantity, L[0].image.startsWith('https:'), L[0].sourceType], ['https://produto.mercadolivre.com.br/MLB1-pokemon', 299.9, 'IN_STOCK', 3, true, 'official_api'], 'ml: preço, estoque, URL, imagem em https');
  mode.ml = { results: [fx.mlResult({ qty: 0 })] };
  assert.equal((await adapters.mercadolivre.search(ml, small))[0].stock, 'OUT_OF_STOCK', 'ml: sem estoque');
  mode.ml = { results: [{ ...fx.mlResult(), condition: 'used' }] }; // usado nunca entra; sem anúncios na busca aberta cai no catálogo (vazio)
  assert.deepEqual(await adapters.mercadolivre.search(ml, small), [], 'ml: anúncio usado fica de fora');
  mode.ml = { message: 'formato novo' }; // payload inesperado
  assert.deepEqual(await adapters.mercadolivre.search(ml, small), [], 'ml: payload inesperado não vira anúncio');
  for (const m of ['503', 'timeout']) { mode.ml = m; assertTyped(await failure(adapters.mercadolivre.search(ml, small)), 'ml ' + m); }
  fs.rmSync(path.join(process.env.HUNTER_DATA_DIR, 'ml-catalog.json'), { force: true }); // sem cache, a busca do catálogo também chama a API
  mode.ml = '401'; const b = await failure(adapters.mercadolivre.search(ml, small));
  assertTyped(b, 'ml 401'); assert.ok(b.blocked && b.status === 401, 'ml: 401 é bloqueio tipado');
  mode.ml = 'ok'; delete process.env.ML_ACCESS_TOKEN; }

// ===== Isolamento: a falha de uma loja não afeta as outras, e o coletor carimba origem e horário
{ const { runOnce } = await import('../src/run.js');
  const send = { capture: async () => true }; const quiet = () => {};
  const at = (min) => new Date(Date.parse('2026-10-06T10:00:00Z') + min * 60e3);
  const ldOffer = (s) => s.offers.find((o) => o.storeId === 'ld' && o.productId === 'me04-box36');
  const vtOffer = (s) => s.offers.find((o) => o.storeId === 'vt' && o.productId === 'me05-box36');
  const status = (s, id) => s.sources.find((x) => x.id === id).status;

  let s = await runOnce({ log: quiet, send, now: at(0) });
  assert.equal(status(s, 'vt'), 'ACTIVE'); assert.equal(status(s, 'ld'), 'ACTIVE');
  assert.ok(ldOffer(s) && vtOffer(s), 'rodada saudável: ofertas das duas lojas');
  for (const o of [ldOffer(s), vtOffer(s)]) {
    assert.equal(o.source_url, o.url, 'oferta guarda a URL de origem');
    assert.equal(Date.parse(o.source_timestamp), at(0).getTime(), 'oferta carimbada com o horário da leitura');
    assert.ok(STOCK.has(o.stock) && o.price > 0, 'oferta na estrutura comum');
  }

  mode.sh = '403'; mode.vt = '503'; // Shopify bloqueada e VTEX fora do ar; JSON-LD segue normal
  s = await runOnce({ log: quiet, send, now: at(15) });
  assert.equal(status(s, 'sh'), 'BLOCKED'); assert.equal(status(s, 'vt'), 'ERROR'); assert.equal(status(s, 'ld'), 'ACTIVE', 'a falha de outras lojas não derruba a JSON-LD');
  { const o = ldOffer(s);
    assert.ok(o && !o.stale && o.stock === 'IN_STOCK', 'JSON-LD: oferta viva');
    assert.equal(Date.parse(o.source_timestamp), at(15).getTime(), 'JSON-LD: leitura nova');
    const v = vtOffer(s);
    assert.ok(v && v.stale && v.stock === 'UNKNOWN', 'VTEX: oferta preservada como não confirmada');
    assert.equal(v.lastValid.stock, 'IN_STOCK', 'VTEX: guarda a última leitura válida'); }

  mode.sh = 'ok'; mode.vt = 'ok';
  s = await runOnce({ log: quiet, send, now: at(60) });
  assert.equal(status(s, 'vt'), 'ACTIVE'); assert.equal(status(s, 'ld'), 'ACTIVE');
  assert.ok(!['BLOCKED', 'ERROR'].includes(status(s, 'sh')), 'Shopify volta depois do bloqueio');
  assert.ok(vtOffer(s) && !vtOffer(s).stale && vtOffer(s).stock === 'IN_STOCK', 'VTEX recuperada: oferta viva'); }

console.log('OK — contrato dos adaptadores');
