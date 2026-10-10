// Coleta nas lojas sem insistir: volume do Shopify, motivo real da falha e espera própria para 429.
// Offline: fetch simulado (setFetch), nenhuma requisição às lojas. Cobre:
//   1) Shopify: 1 a 8 páginas de /products.json por loja e rodada (antes: 1 suggest.json por coleção do catálogo, 24);
//      acima do teto, até 2 páginas de /collections.json + 6 páginas das coleções Pokémon;
//   2) reason com o status HTTP real (429, 403, desafio com 200, 5xx) e o código de rede (ENOTFOUND, ECONNREFUSED,
//      TIMEOUT, CERT_*), sem query nem token na URL;
//   3) espera depois da falha: 429 tem curva própria (Retry-After, 30 min a 2 h); 403/WAF e DNS seguem até 6 h.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
process.env.HUNTER_DOMAIN_DELAY_MS ??= '0'; // antes de carregar o cliente HTTP (o intervalo é lido na importação)
const http = await import('../src/http.js');
const shopify = await import('../src/adapters/shopify.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'config/catalog.json'), 'utf8'));

let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { e.message = `[${name}] ${e.message}`; throw e; } };
const json = (o, status = 200, headers = {}) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', ...headers } });
const html = (s, status = 200, headers = {}) => new Response(s, { status, headers: { 'content-type': 'text/html', ...headers } });
const failure = async (p) => { try { await p; } catch (e) { return e; } return assert.fail('devia falhar'); };
const netError = (code) => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(code), { code }) });

// Cada cenário usa um host próprio (o cache de robots.txt é por origem). robots.txt 404 = liberado, salvo indicação.
let routes = {}; const calls = {};
http.setFetch(async (url) => {
  const u = new URL(url);
  (calls[u.host] ||= []).push(u.pathname + u.search);
  const r = routes[u.host];
  if (u.pathname === '/robots.txt') return (r?.robots || (() => html('', 404)))();
  if (!r) return html('', 404);
  return r.handle(u);
});
const pages = (host) => (calls[host] || []).filter((p) => !p.startsWith('/robots.txt'));

// ---------- 1) Shopify: volume de requisições por loja e rodada, com o catálogo real (24 coleções)
const prod = (i, x = {}) => ({ id: i, title: `Pokémon Booster Avulso ${i} Copag`, handle: `p-${i}`, product_type: 'TCG', tags: ['pokemon'], vendor: 'Copag',
  variants: [{ id: i * 10, title: 'Default Title', price: '29.90', available: true, sku: `S${i}` }], ...x });
const catalogOf = (total) => Array.from({ length: total }, (_, i) => (i % 3 === 2 ? prod(i + 1, { title: `Camiseta ${i + 1}`, product_type: 'Roupa', tags: [], vendor: 'Loja' }) : prod(i + 1)));
const shopifyStore = (host, products, extra = {}) => {
  routes[host] = { handle: (u) => {
    if (u.pathname === '/products.json') { const p = Number(u.searchParams.get('page') || 1); const lim = Number(u.searchParams.get('limit') || 30); return json({ products: products.slice((p - 1) * lim, p * lim) }); }
    if (u.pathname === '/search/suggest.json') return json({ resources: { results: { products: [] } } });
    return html('', 404);
  }, ...extra };
  return { id: host, url: `https://${host}` };
};

const measured = {};
const isPage = (p) => p.startsWith('/products.json?limit=250&page=');
const isSuggest = (p) => p.startsWith('/search/suggest.json?');
await t('Shopify: no máximo MAX_PAGES (8) páginas de /products.json por loja, sem uma busca por coleção', async () => {
  assert.equal(catalog.collections.length >= 20, true, 'catálogo real com muitas coleções (cada uma era uma busca)');
  assert.equal(shopify.MAX_PAGES, 8);
  for (const [host, total] of [['vol-pequena.test', 40], ['vol-media.test', 300], ['vol-grande.test', 2000]]) {
    const L = await shopify.search(shopifyStore(host, catalogOf(total)), catalog);
    const all = pages(host); const req = all.filter(isPage);
    measured[host] = { total, requests: req.length, robots: (calls[host] || []).length - all.length };
    assert.ok(req.length <= shopify.MAX_PAGES, `${host}: ${req.length} requisições (${req.join(', ')})`);
    // 2000 produtos = 8 páginas cheias: pode haver mais, então lista as coleções (aqui não há: 404) e não lê mais nada
    assert.deepEqual(all.filter((p) => !isPage(p)), total === 2000 ? ['/collections.json?limit=250&page=1'] : [], `${host}: só /products.json paginado (${all.join(', ')})`);
    assert.equal(measured[host].robots, 1, `${host}: robots.txt lido uma vez`);
    assert.ok(L.length > 0 && L.every((l) => /pok[eé]mon/i.test(l.title)), `${host}: só os produtos Pokémon do catálogo`);
  }
  assert.equal(measured['vol-pequena.test'].requests, 1, 'catálogo menor que uma página: 1 requisição (sem pedir a página vazia)');
  assert.equal(measured['vol-media.test'].requests, 2, '300 produtos: 2 páginas');
  // Na #188 eram 3 requisições (teto de 3 páginas). Com o teto de 8 (regressão da mox.land), 2000 produtos = 8 páginas.
  assert.equal(measured['vol-grande.test'].requests, 8, 'catálogo grande: para no teto de 8 páginas');
  // o resultado de uma página é o mesmo anúncio que a busca preditiva gerava (mesma extração)
  const [l] = await shopify.search(shopifyStore('vol-um.test', [prod(7, { variants: [{ id: 70, title: 'Default Title', price: '359.90', compare_at_price: '449.90', available: true, sku: 'SH-1', barcode: '789' }], images: [{ src: '//cdn.vol.test/7.jpg' }] })]), catalog);
  assert.deepEqual([l.url, l.price.base, l.listPrice, l.stock, l.sku, l.ean, l.sourceType, l.image],
    ['https://vol-um.test/products/p-7', 359.9, 449.9, 'IN_STOCK', 'SH-1', '789', 'store_json', 'https://cdn.vol.test/7.jpg']);
});

await t('Shopify: /products.json indisponível cai para a busca preditiva; bloqueio para na hora', async () => {
  const host = 'vol-sem-json.test';
  routes[host] = { handle: (u) => (u.pathname === '/search/suggest.json' ? json({ resources: { results: { products: [prod(1)] } } }) : html('', 404)) };
  const L = await shopify.search({ id: host, url: `https://${host}` }, catalog);
  assert.equal(L.length, 1); assert.equal(pages(host)[0], '/products.json?limit=250&page=1', 'tenta o catálogo primeiro');
  for (const status of [429, 403]) {
    const h = `vol-${status}.test`;
    const e = await failure(shopify.search(shopifyStore(h, [], { handle: () => html('bloqueado', status) }), catalog));
    assert.ok(e.blocked && e.status === status, `${status}: bloqueio`); assert.equal(pages(h).length, 1, `${status}: uma requisição, sem cair para a busca`);
  }
});

// ---------- 2) motivo real: status HTTP e código de rede, até o reason
const { safeReason } = http;
await t('robots.txt barrado: 429 vira limite de requisições (com Retry-After), não "barra robôs (403)"', async () => {
  const e = await failure(shopify.search(shopifyStore('rb-429.test', [prod(1)], { robots: () => html('Too Many Requests', 429, { 'retry-after': '120' }) }), catalog));
  assert.ok(e.blocked); assert.equal(e.status, 429); assert.equal(e.retryAfter, 120);
  assert.match(e.message, /429/); assert.doesNotMatch(e.message, /barra robôs|\(403\)/);
  assert.equal(pages('rb-429.test').length, 0, 'nenhuma página depois do 429 no robots.txt');
  const d = await failure(shopify.search(shopifyStore('rb-429-data.test', [prod(1)], { robots: () => html('', 429, { 'retry-after': new Date(Date.now() + 600e3).toUTCString() }) }), catalog));
  assert.ok(d.retryAfter >= 590 && d.retryAfter <= 600, `Retry-After em data HTTP: ${d.retryAfter}`);
});
await t('robots.txt barrado: 403 com desafio e desafio com HTTP 200 guardam o status real', async () => {
  const e = await failure(shopify.search(shopifyStore('rb-403.test', [prod(1)], { robots: () => html('<title>Just a moment...</title>', 403) }), catalog));
  assert.ok(e.blocked && e.status === 403); assert.match(e.message, /403/); assert.equal(e.httpStatus, 403);
  const c = await failure(shopify.search(shopifyStore('rb-200.test', [prod(1)], { robots: () => html('<html><title>Just a moment...</title></html>') }), catalog));
  assert.ok(c.blocked && c.status === 403, 'desafio anti-robô continua na classe 403/WAF'); assert.equal(c.httpStatus, 200);
  assert.match(c.message, /desafio/); assert.match(c.message, /200/);
});
await t('robots.txt inacessível: DNS, conexão recusada, timeout, TLS e 5xx não viram o mesmo "fora do ar"', async () => {
  const cases = [
    ['rb-dns.test', () => { throw netError('ENOTFOUND'); }, 'ENOTFOUND', null],
    ['rb-refused.test', () => { throw netError('ECONNREFUSED'); }, 'ECONNREFUSED', null],
    ['rb-tls.test', () => { throw netError('CERT_HAS_EXPIRED'); }, 'CERT_HAS_EXPIRED', null],
    ['rb-timeout.test', () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); }, 'TIMEOUT', null],
    ['rb-503.test', () => html('erro', 503), null, 503],
  ];
  const seen = new Set();
  for (const [host, robots, code, status] of cases) {
    const e = await failure(shopify.search(shopifyStore(host, [prod(1)], { robots }), catalog));
    assert.ok(e.blocked && e.status === 'unreachable', `${host}: continua "não rastrear"`);
    if (code) { assert.equal(e.code, code, host); assert.match(e.message, new RegExp(code === 'TIMEOUT' ? 'tempo esgotado' : code)); }
    if (status) { assert.equal(e.httpStatus, status, host); assert.match(e.message, new RegExp(String(status))); }
    seen.add(e.message.replace(host, ''));
    assert.equal(pages(host).length, 0, `${host}: nenhuma página`);
  }
  assert.equal(seen.size, cases.length, 'cada causa tem um motivo diferente');
});
await t('erro de rede numa página guarda o código; o motivo nunca leva query nem token', async () => {
  routes['pg-dns.test'] = { handle: () => { throw netError('ECONNRESET'); } };
  const e = await failure(shopify.search({ id: 'pg', url: 'https://pg-dns.test' }, catalog));
  assert.equal(http.netCode(e), 'ECONNRESET'); assert.match(safeReason(e), /ECONNRESET/); assert.match(safeReason(e), /pg-dns\.test/);
  assert.equal(pages('pg-dns.test').length, 1, 'erro de rede: não tenta outra rota na mesma rodada');
  const h = Object.assign(new Error('HTTP 500 em https://x.test/api/busca?q=pokemon&token=SEGREDO&access_token=abc'), { status: 500 });
  const r = safeReason(h);
  assert.doesNotMatch(r, /SEGREDO|token|\?q=/); assert.match(r, /HTTP 500 em https:\/\/x\.test\/api\/busca/);
  assert.equal(safeReason(new Error('x'.repeat(2000))).length <= 300, true, 'motivo com tamanho limitado');
});

// ---------- 3) espera depois da falha
const { backoffMs } = await import('../src/run.js');
const min = (src) => backoffMs(src) / 60e3;
await t('429 tem espera própria (30 min a 2 h) e não escala para 6 h como 403/DNS', async () => {
  const curve = (x) => Array.from({ length: 8 }, (_, i) => min({ status: 'BLOCKED', fails: i + 1, ...x }));
  const c429 = curve({ httpStatus: 429 }); const c403 = curve({ httpStatus: 403 }); const cDns = curve({ netCode: 'ENOTFOUND' });
  measured.backoff = { 429: c429, 403: c403, ENOTFOUND: cDns };
  assert.deepEqual(c429, [30, 60, 120, 120, 120, 120, 120, 120], '429 sem Retry-After');
  assert.deepEqual(c403, [15, 30, 60, 120, 240, 360, 360, 360], '403/WAF: curva longa de antes');
  assert.deepEqual(cDns, c403, 'DNS: curva longa de antes');
  assert.equal(min({ status: 'BLOCKED', fails: 1, httpStatus: 429, retryAfterSec: 10 }), 30, 'Retry-After curto: piso de 30 min');
  assert.equal(min({ status: 'BLOCKED', fails: 1, httpStatus: 429, retryAfterSec: 5400 }), 90, 'Retry-After de 1 h 30 respeitado');
  assert.equal(min({ status: 'BLOCKED', fails: 5, httpStatus: 429, retryAfterSec: 5 * 3600 }), 300, 'Retry-After maior que 2 h é respeitado (nunca volta antes do pedido)');
  assert.equal(min({ status: 'BLOCKED', fails: 5, httpStatus: 429, retryAfterSec: 48 * 3600 }), 360, '... até o teto geral de 6 h');
  assert.equal(min({ status: 'ERROR', fails: 3, httpStatus: 503 }), 60, '5xx: curva de antes');
  assert.equal(min({ status: 'BLOCKED', fails: 2 }), 30, 'loja antiga sem o status gravado: curva de antes');
});

await t('rodada completa: sources.json guarda status/código real e a espera certa', async () => {
  const keep = Object.fromEntries(['HUNTER_CONFIG_DIR', 'HUNTER_DATA_DIR', 'HUNTER_TIPS', 'HUNTER_CEP', 'HUNTER_BUDGET_MIN'].map((k) => [k, process.env[k]]));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hunter-blk-'));
  try {
    process.env.HUNTER_CONFIG_DIR = path.join(tmp, 'config'); process.env.HUNTER_DATA_DIR = path.join(tmp, 'data'); process.env.HUNTER_TIPS = '0';
    delete process.env.HUNTER_CEP; delete process.env.HUNTER_BUDGET_MIN;
    fs.mkdirSync(process.env.HUNTER_CONFIG_DIR, { recursive: true });
    fs.copyFileSync(path.join(root, 'config/catalog.json'), path.join(tmp, 'config/catalog.json'));
    const S = (id, host) => ({ id, name: id, url: `https://${host}`, platform: 'shopify', kind: 'specialist', evidence: {} });
    fs.writeFileSync(path.join(tmp, 'config/stores.json'), JSON.stringify({ stores: [S('r429', 'e2e-429.test'), S('r403', 'e2e-403.test'), S('rdns', 'e2e-dns.test'), S('rok', 'e2e-ok.test')] }));
    fs.writeFileSync(path.join(tmp, 'config/watchlist.json'), JSON.stringify({ settings: { cep: null }, rules: [] }));
    shopifyStore('e2e-429.test', [prod(1)], { robots: () => html('', 429, { 'retry-after': '3600' }) });
    shopifyStore('e2e-403.test', [prod(1)], { robots: () => html('<title>Just a moment...</title>', 403) });
    shopifyStore('e2e-dns.test', [prod(1)], { robots: () => { throw netError('ENOTFOUND'); } });
    shopifyStore('e2e-ok.test', catalogOf(30));
    const { runOnce } = await import('../src/run.js');
    const send = { capture: async () => true };
    await runOnce({ log: () => {}, send, now: new Date() });
    const src = JSON.parse(fs.readFileSync(path.join(tmp, 'data/sources.json'), 'utf8'));
    assert.deepEqual([src.r429.status, src.r429.httpStatus, src.r429.retryAfterSec], ['BLOCKED', 429, 3600]);
    assert.match(src.r429.reason, /429/); assert.doesNotMatch(src.r429.reason, /barra robôs/);
    assert.deepEqual([src.r403.status, src.r403.httpStatus], ['BLOCKED', 403]); assert.match(src.r403.reason, /403/);
    assert.deepEqual([src.rdns.status, src.rdns.netCode], ['BLOCKED', 'ENOTFOUND']); assert.match(src.rdns.reason, /ENOTFOUND/);
    assert.equal(src.rok.status, 'ACTIVE');
    assert.ok(pages('e2e-ok.test').length <= shopify.MAX_PAGES, `loja Shopify ativa: ${pages('e2e-ok.test').length} requisições na rodada`);
    measured.e2eOk = pages('e2e-ok.test').length;
    assert.deepEqual([backoffMs(src.r429), backoffMs(src.r403), backoffMs(src.rdns)].map((x) => x / 60e3), [60, 15, 15], 'espera da 1ª falha: 429 pelo Retry-After (1 h)');
  } finally {
    for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------- 4) regressão da #188 (coleta 38077043674): a mox.land voltou ACTIVE com 148 anúncios e 0 casados; as 37
// ofertas viraram "removed". Os títulos dela não têm a palavra "Pokémon" e o filtro do /products.json os descartava.
const { matchProduct } = await import('../src/match.js'); const { linkAgrees } = await import('../src/gate.js');
// Títulos e links reais da mox.land (data/offers.json antes da #188); metadados sem a palavra Pokémon.
const MOX = [
  ['Booster - Megaevolução 4 Caos Ascendente', 'booster-megaevolucao-4-caos-ascendente', '34.90'],
  ['Box - Treinador Avançado Heróis Excelsos', 'box-treinador-avancado-herois-excelsos', '499.90'],
  ['Blister Triplo - Megaevolução 2 Fogo Fantasmagórico Cottonee', 'blister-triplo-megaevolucao-2-fogo-fantasmagorico-cottonee', '89.90'],
  ['Combo de Boosters - Escarlate e Violeta - Evoluções Prismáticas', 'combo-de-boosters-escarlate-e-violeta-evolucoes-prismaticas', '149.90'],
];
const moxProd = (i, x = {}) => ({ id: 500 + i, title: MOX[i][0], handle: MOX[i][1], product_type: 'Booster', tags: ['TCG', 'Lacrado'], vendor: 'Copag',
  variants: [{ id: 5000 + i, title: 'Default Title', price: MOX[i][2], available: true }], ...x });
const MAGIC = ['Booster de Coleção - Magic: The Gathering - Duskmourn', 'Commander Deck - Bloomburrow', 'Sleeve Dragon Shield Matte Preto']
  .map((title, i) => ({ id: 900 + i, title, handle: `mtg-${i}`, product_type: 'Magic', tags: ['MTG'], vendor: 'Wizards', variants: [{ id: 9000 + i, title: 'Default Title', price: '39.90', available: true }] }));
const casa = (l) => { const m = matchProduct(l, catalog); return !!(m.productId && linkAgrees(l, m, catalog).ok); };

await t('Shopify /products.json: título sem "Pokémon" que cita coleção do catálogo (mox.land) vira anúncio e casa', async () => {
  const L = await shopify.search(shopifyStore('mox-titulos.test', [...MOX.map((_, i) => moxProd(i)), ...MAGIC]), catalog);
  assert.deepEqual(L.map((l) => l.title).sort(), MOX.map((x) => x[0]).sort(), 'os 4 produtos lacrados entram; Magic e acessório ficam de fora');
  assert.equal(L.filter(casa).length, MOX.length, 'todos casam com o catálogo (como na busca preditiva de antes)');
  assert.equal(pages('mox-titulos.test').length, 1, 'continua 1 página para um catálogo pequeno');
});

// ---------- 5) regressão da #188, 2ª causa (coleta de 10/10 19:15Z, depois da #191): a mox.land vende outros jogos e
// os produtos Pokémon dela ficam depois das 3 primeiras páginas de /products.json (148 anúncios lidos, 0 casados).
const filler = (i) => ({ id: 100000 + i, title: `Card Avulso Magic ${i} Near Mint`, handle: `mtg-avulso-${i}`, product_type: 'Magic', tags: ['MTG'], vendor: 'Wizards',
  variants: [{ id: 1000000 + i, title: 'Default Title', price: '9.90', available: true }] });
// catálogo de `total` produtos de outros jogos, com os produtos de `at` ({posição: produto}) no lugar
const bigCatalog = (total, at = {}) => Array.from({ length: total }, (_, i) => at[i] || filler(i));
const moxAt = (positions) => Object.fromEntries(positions.map((pos, i) => [pos, moxProd(i)]));

await t('Shopify: catálogo de 1200 com os Pokémon nas páginas 4 e 5 (mox.land) → os anúncios casam', async () => {
  const host = 'mox-grande.test';
  const L = await shopify.search(shopifyStore(host, bigCatalog(1200, moxAt([760, 990, 1010, 1190]))), catalog);
  assert.deepEqual(L.map((l) => l.title).sort(), MOX.map((x) => x[0]).sort(), 'os 4 produtos lacrados depois da página 3 entram');
  assert.equal(L.filter(casa).length, MOX.length, 'todos casam com o catálogo');
  assert.deepEqual(pages(host), [1, 2, 3, 4, 5].map((p) => `/products.json?limit=250&page=${p}`), '1200 produtos: 5 páginas, nenhuma busca');
  assert.equal(L.partial, undefined, 'leu o catálogo inteiro: não é leitura parcial');
});

await t('Shopify: requisições por tamanho de catálogo; teto atingido registra leitura parcial, sem voltar às 24 buscas', async () => {
  const counts = {};
  for (const total of [300, 1200, 3000]) {
    const host = `cnt-${total}.test`;
    const L = await shopify.search(shopifyStore(host, bigCatalog(total, { 5: moxProd(0), 2600: moxProd(1) })), catalog);
    counts[total] = pages(host).filter(isPage).length;
    const other = pages(host).filter((p) => !isPage(p));
    assert.deepEqual(other, total === 3000 ? ['/collections.json?limit=250&page=1'] : [], `${host}: só /products.json (+ a lista de coleções acima do teto) (${pages(host).join(', ')})`);
    assert.equal(pages(host).filter(isSuggest).length, 0, `${host}: nenhuma busca suggest.json com catálogo público`);
    assert.ok(counts[total] <= shopify.MAX_PAGES, `${host}: nunca passa do teto`);
    assert.equal((calls[host] || []).length, counts[total] + other.length + 1, `${host}: páginas + 1 robots.txt`);
    if (total === 3000) {
      assert.equal(L.partial, shopify.PARTIAL_NO_COLLECTION, '3000 sem coleção Pokémon (/collections.json 404): leitura parcial registrada com o motivo');
      assert.match(L.partial, /maior que 8 páginas.*leitura parcial.*nenhuma coleção Pokémon/);
      assert.deepEqual(L.map((l) => l.title), [MOX[0][0]], '3000: só o que foi lido; nada inventado para o produto depois do teto');
    } else {
      assert.equal(L.partial, undefined, `${total}: leitura completa`);
      assert.deepEqual(L.map((l) => l.title).sort(), [MOX[0][0], ...(total > 2600 ? [MOX[1][0]] : [])].sort());
    }
  }
  measured.counts = counts;
  assert.deepEqual(counts, { 300: 2, 1200: 5, 3000: 8 }, 'contagem de requisições /products.json');
});

await t('Shopify: para na página vazia, na página curta e no teto', async () => {
  // página vazia: catálogo de exatamente 500 → páginas 1 e 2 cheias, a 3 vem vazia e encerra
  shopifyStore('fim-vazia.test', bigCatalog(500, { 499: moxProd(0) }));
  const a = await shopify.search({ id: 'v', url: 'https://fim-vazia.test' }, catalog);
  assert.equal(pages('fim-vazia.test').length, 3, 'página 3 vazia encerra'); assert.equal(a.length, 1); assert.equal(a.partial, undefined);
  // página curta: 260 → a 2 tem 10 itens e é a última (não pede a 3)
  shopifyStore('fim-curta.test', bigCatalog(260, { 259: moxProd(0) }));
  const b = await shopify.search({ id: 'c', url: 'https://fim-curta.test' }, catalog);
  assert.equal(pages('fim-curta.test').length, 2, 'página curta encerra'); assert.equal(b.length, 1);
});

await t('Shopify: o mesmo produto em duas páginas vira um anúncio só', async () => {
  // catálogo mudando durante a leitura: o produto da posição 249 (fim da página 1) reaparece no início da página 2
  const host = 'dup.test';
  const list = bigCatalog(400, { 249: moxProd(0), 250: moxProd(0), 300: moxProd(1, { handle: MOX[1][1] }), 301: { ...moxProd(1), id: undefined } });
  const L = await shopify.search(shopifyStore(host, list), catalog);
  assert.deepEqual(L.map((l) => l.title).sort(), [MOX[0][0], MOX[1][0]].sort(), 'duplicados por id e por handle/URL entram uma vez');
  assert.equal(new Set(L.map((l) => l.url)).size, L.length);
});

await t('Shopify: 429 (Retry-After), 5xx ou timeout no meio da paginação → para, registra o motivo, sem outra rota', async () => {
  const mid = (host, fail) => { const all = bigCatalog(3000, { 5: moxProd(0) });
    routes[host] = { handle: (u) => {
      if (u.pathname !== '/products.json') return json({ resources: { results: { products: [moxProd(1)] } } });
      const p = Number(u.searchParams.get('page')); return p === 2 ? fail() : json({ products: all.slice((p - 1) * 250, p * 250) });
    } };
    return { id: host, url: `https://${host}` };
  };
  const e429 = await failure(shopify.search(mid('mid-429.test', () => html('Too Many Requests', 429, { 'retry-after': '900' })), catalog));
  assert.ok(e429.blocked); assert.equal(e429.httpStatus, 429); assert.equal(e429.retryAfter, 900);
  assert.equal(pages('mid-429.test').length, 2, '429 na página 2: para ali, sem busca suggest.json');
  const e500 = await failure(shopify.search(mid('mid-500.test', () => html('erro', 503)), catalog));
  assert.equal(e500.httpStatus, 503); assert.ok(!e500.blocked); assert.equal(pages('mid-500.test').length, 2, '5xx na página 2: para');
  const eTo = await failure(shopify.search(mid('mid-to.test', () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); }), catalog));
  assert.equal(eTo.code, 'TIMEOUT'); assert.equal(pages('mid-to.test').length, 2, 'timeout na página 2: para');
});

// ---------- 6) mox.land acima do teto (coleta de 10/10 19:45Z, ramo data 9752b56): ACTIVE, 192 anúncios, 0 casados,
// "catálogo maior que 8 páginas". Os 37 produtos que ela casava antes da #188 (títulos e links reais de data/offers.json)
// ficam depois do teto no /products.json e aparecem na coleção Pokémon da loja (/collections/pokemon-tcg/products.json).
const MOX37 = [
  ['Combo de Boosters - Escarlate e Violeta - Evoluções Prismáticas', 'combo-de-boosters-escarlate-e-violeta-evolucoes-prismaticas', '499.00'],
  ['Blister Quádruplo - Escarlate e Violeta 6 Máscaras do Crepúsculo Snorlax', 'blister-quadruplo-escarlate-e-violeta-6-mascaras-do-crepusculo-snorlax', '45.00'],
  ['Booster - Escarlate e Violeta - Máscaras do Crepúsculo', 'booster-escarlate-e-violeta-mascaras-do-crepusculo', '10.00'],
  ['Blister Quádruplo - Escarlate e Violeta 6 Máscaras do Crepúsculo Revavroom', 'blister-quadruplo-escarlate-e-violeta-6-mascaras-do-crepusculo-revavroom', '45.00'],
  ['Blister Triplo - Escarlate e Violeta 6 Máscaras do Crepúsculo Toxel', 'blister-triplo-escarlate-e-violeta-6-mascaras-do-crepusculo-toxel', '35.00'],
  ['Blister Quádruplo - Megaevolução 2 Fogo Fantasmagórico Sneasel', 'blister-quadruplo-megaevolucao-2-fogo-fantasmagorico-sneasel', '49.00'],
  ['Box - Treinador Avançado Fábulas Nebulosas', 'box-treinador-avancado-fabulas-nebulosas', '370.00'],
  ['Blister Quádruplo - Escarlate e Violeta 8 Fagulhas Impetuosas Zapdos', 'blister-quadruplo-escarlate-e-violeta-8-fagulhas-impetuosas-zapdos', '50.00'],
  ['Booster - Escarlate e Violeta - Fagulhas Impetuosas', 'booster-escarlate-e-violeta-fagulhas-impetuosas', '11.00'],
  ['Blister Triplo - Escarlate e Violeta 8 Fagulhas Impetuosas Wooper', 'blister-triplo-escarlate-e-violeta-8-fagulhas-impetuosas-wooper', '40.00'],
  ['Blister Quádruplo - Escarlate e Violeta 8 Fagulhas Impetuosas Quagsire', 'blister-quadruplo-escarlate-e-violeta-8-fagulhas-impetuosas-quagsire', '50.00'],
  ['Blister Triplo - Escarlate e Violeta 8 Fagulhas Impetuosas Pachirisu', 'blister-triplo-escarlate-e-violeta-8-fagulhas-impetuosas-pachirisu', '30.00'],
  ['Booster - Escarlate e Violeta 9 Amigos de Jornada', 'booster-escarlate-e-violeta-9-amigos-de-jornada', '11.00'],
  ['Box - Treinador Avançado Amigos de Jornada', 'box-treinador-avancado-amigos-de-jornada', '400.00'],
  ['Blister Quádruplo - Escarlate e Violeta 9 Amigos de Jornada Scrafty', 'blister-quadruplo-escarlate-e-violeta-9-amigos-de-jornada-scrafty', '49.00'],
  ['Blister Triplo - Escarlate e Violeta 9 Amigos de Jornada Yanma', 'blister-triplo-escarlate-e-violeta-9-amigos-de-jornada-yanma', '39.00'],
  ['Combo de Boosters - Escarlate e Violeta - Amigos de Jornada', 'combo-de-boosters-escarlate-e-violeta-amigos-de-jornada', '200.00'],
  ['Booster - Megaevolução 2 Fogo Fantasmagórico', 'booster-mega-evolucao-2-fogos-fantasmagoricos', '14.00'],
  ['Blister Quádruplo - Megaevolução 2 Fogo Fantasmagórico Weavile', 'blister-quadruplo-megaevolucao-2-fogo-fantasmagorico-weavile', '49.00'],
  ['Combo de Boosters - Megaevolução Caos Ascendente', 'combo-de-boosters-megaevolucao-caos-ascendente', '239.00'],
  ['Blister Quádruplo - Megaevolução 5 Escuridão Absoluta Binacle', 'blister-quadruplo-megaevolucao-5-escuridao-absoluta-binacle', '49.00'],
  ['Booster - Megaevolução 4 Caos Ascendente', 'booster-megaevolucao-4-caos-ascendente', '14.00'],
  ['Booster - Megaevolução 3 Equilíbrio Perfeito', 'booster-megaevolucao-3-equilibrio-perfeito', '14.00'],
  ['Blister Triplo - Megaevolução 4 Caos Ascendente Charmeleon', 'blister-triplo-megaevolucao-4-caos-ascendente-charmeleon', '39.00'],
  ['Blister Triplo - Megaevolução 2 Fogo Fantasmagórico Whimsicott', 'blister-triplo-megaevolucao-2-fogo-fantasmagorico-whimsicott', '39.00'],
  ['Blister Triplo - Megaevolução 2 Fogo Fantasmagórico Cottonee', 'blister-triplo-megaevolucao-2-fogo-fantasmagorico-cottonee', '39.00'],
  ['Combo de Boosters - Megaevolução Heróis Excelsos', 'combo-de-boosters-megaevolucao-herois-excelsos', '399.00'],
  ['Blister Quádruplo - Megaevolução 2.5 Heróis Excelsos Komala', 'blister-quadruplo-megaevolucao-2-5-herois-excelsos-komala', '49.00'],
  ['Blister Triplo - Megaevolução 2.5 Heróis Excelsos Gastly', 'blister-triplo-megaevolucao-2-5-herois-excelsos-gastly', '39.00'],
  ['Box - Treinador Avançado Heróis Excelsos', 'box-treinador-avancado-herois-excelsos', '399.00'],
  ['Blister Triplo - Megaevolução 2.5 Heróis Excelsos Charmander', 'blister-triplo-megaevolucao-2-5-herois-excelsos', '39.00'],
  ['Blister Quádruplo - Megaevolução 2.5 Heróis Excelsos Tangela', 'blister-quadruplo-megaevolucao-2-5-herois-excelsos-tangela', '49.00'],
  ['Blister Quádruplo - Megaevolução 3 Equilíbrio Perfeito Chikorita', 'blister-quadruplo-megaevolucao-3-equilibrio-perfeito-chikorita', '49.00'],
  ['Blister Triplo - Megaevolução 3 Equilíbrio Perfeito Makuhita', 'blister-triplo-megaevolucao-3-equilibrio-perfeito-makuhita', '39.00'],
  ['Box - Treinador Avançado Equilíbrio Perfeito', 'box-treinador-avancado-equilibrio-perfeito', '399.00'],
  ['Combo de Boosters - Megaevolução Equilíbrio Perfeito', 'combo-de-boosters-megaevolucao-equilibrio-perfeito', '239.00'],
  ['Booster - Megaevolução 5 Escuridão Absoluta', 'booster-megaevolucao-5-escuridao-absoluta', '14.00'],
];
const mox37 = (i, x = {}) => ({ id: 7000 + i, title: MOX37[i][0], handle: MOX37[i][1], product_type: 'TCG', tags: ['Lacrado'], vendor: 'Copag',
  variants: [{ id: 70000 + i, title: 'Default Title', price: MOX37[i][2], available: true }], ...x });
const MOX37_ALL = MOX37.map((_, i) => mox37(i));
const MOX37_URLS = MOX37.map((x) => `https://mox.land/products/${x[1]}`);
// as coleções que a Shopify cria em toda loja (all, frontpage) + as da loja; "frontpage" cita Pokémon mas é genérica
const COLS = [
  { id: 1, handle: 'all', title: 'Todos os produtos', products_count: 3000 },
  { id: 2, handle: 'frontpage', title: 'Destaques Pokémon', products_count: 12 },
  { id: 3, handle: 'magic-the-gathering', title: 'Magic: The Gathering', products_count: 2900 },
  { id: 4, handle: 'pokemon-tcg', title: 'Pokémon TCG', products_count: 37 },
];
const slice = (list, u) => { const p = Number(u.searchParams.get('page') || 1); const lim = Number(u.searchParams.get('limit') || 30); return list.slice((p - 1) * lim, p * lim); };
// loja Shopify com /products.json, /collections.json e /collections/<handle>/products.json; `over` troca uma rota
const colStore = (host, products, collections, byHandle, over = {}) => {
  routes[host] = { handle: (u) => {
    for (const [re, fn] of Object.entries(over)) if (new RegExp(re).test(u.pathname)) return fn(u);
    if (u.pathname === '/products.json') return json({ products: slice(products, u) });
    if (u.pathname === '/collections.json') return json({ collections: slice(collections, u) });
    const m = u.pathname.match(/^\/collections\/([^/]+)\/products\.json$/);
    if (m && byHandle[decodeURIComponent(m[1])]) return json({ products: slice(byHandle[decodeURIComponent(m[1])], u) });
    if (u.pathname === '/search/suggest.json') return json({ resources: { results: { products: MOX37_ALL.slice(0, 10) } } });
    return html('', 404);
  } };
  return { id: host, url: `https://${host}` };
};
const moxBig = (at = {}) => bigCatalog(3000, { ...Object.fromEntries(MOX37.map((_, i) => [2100 + i, mox37(i)])), ...at });
const isColList = (p) => p.startsWith('/collections.json?');
const isColPage = (p) => /^\/collections\/[^/]+\/products\.json\?/.test(p);
const census = (host) => { const all = pages(host);
  return { products: all.filter(isPage).length, list: all.filter(isColList).length, collection: all.filter(isColPage).length, suggest: all.filter(isSuggest).length,
    robots: (calls[host] || []).length - all.length, total: all.length }; };
const LIMIT = shopify.MAX_PAGES + shopify.COLLECTION_LIST_PAGES + shopify.MAX_EXTRA_REQUESTS; // 8 + 2 + 6
measured.col = {};

await t('Shopify acima do teto: os 37 produtos reais da mox.land vêm da coleção Pokémon e casam', async () => {
  const host = 'mox.land';
  const L = await shopify.search(colStore(host, moxBig(), COLS, { 'pokemon-tcg': MOX37_ALL, frontpage: [filler(1)] }), catalog);
  const c = measured.col.mox = census(host);
  assert.deepEqual(L.map((l) => l.url).sort(), [...MOX37_URLS].sort(), 'os 37 anúncios (links reais), nenhum a mais');
  assert.deepEqual(L.map((l) => l.title).sort(), MOX37.map((x) => x[0]).sort());
  assert.equal(L.filter(casa).length, 37, 'os 37 casam com o catálogo, como na busca preditiva de antes da #188');
  assert.deepEqual([c.products, c.list, c.collection, c.suggest, c.robots], [8, 1, 1, 0, 1], `requisições: ${pages(host).join(', ')}`);
  assert.ok(c.total <= LIMIT, `${c.total} requisições ≤ ${LIMIT} (+ robots.txt)`);
  assert.ok(pages(host).includes('/collections/pokemon-tcg/products.json?limit=250&page=1'));
  assert.ok(!pages(host).some((p) => /\/collections\/(all|frontpage|magic)/.test(p)), 'coleções genéricas e de outros jogos não são lidas');
  assert.equal(L.partial, undefined, 'coleção Pokémon lida inteira: sem "partial"');
  assert.equal(L.find((l) => l.title === MOX37[22][0]).price.base, 14);
});

await t('Shopify acima do teto sem coleção Pokémon: "partial" com o motivo, nada inventado', async () => {
  const host = 'sem-colecao.test';
  const L = await shopify.search(colStore(host, moxBig(), COLS.filter((x) => x.handle !== 'pokemon-tcg'), { frontpage: MOX37_ALL }), catalog);
  const c = measured.col.none = census(host);
  assert.equal(L.partial, shopify.PARTIAL_NO_COLLECTION); assert.match(L.partial, /nenhuma coleção Pokémon encontrada/);
  assert.equal(L.length, 0, 'nada lido dos produtos Pokémon além do teto: nenhuma oferta');
  assert.deepEqual([c.products, c.list, c.collection, c.suggest], [8, 1, 0, 0], `"frontpage" (genérica) não é lida; nem suggest.json: ${pages(host).join(', ')}`);
});

await t('Shopify acima do teto: 429 em /collections.json interrompe a loja (Retry-After), sem outra rota', async () => {
  const host = 'col-429.test';
  const e = await failure(shopify.search(colStore(host, moxBig(), COLS, { 'pokemon-tcg': MOX37_ALL },
    { '^/collections\\.json$': () => html('Too Many Requests', 429, { 'retry-after': '600' }) }), catalog));
  const c = measured.col.r429 = census(host);
  assert.ok(e.blocked); assert.equal(e.httpStatus, 429); assert.equal(e.retryAfter, 600);
  assert.deepEqual([c.products, c.list, c.collection, c.suggest], [8, 1, 0, 0], `para no 429: ${pages(host).join(', ')}`);
  // 403 e 5xx numa página da coleção também param ali e sobem com o status real
  const e403 = await failure(shopify.search(colStore('col-403.test', moxBig(), COLS, {}, { '^/collections/pokemon-tcg/': () => html('<title>Just a moment...</title>', 403) }), catalog));
  assert.ok(e403.blocked); assert.equal(e403.httpStatus, 403); assert.equal(census('col-403.test').collection, 1);
  const e503 = await failure(shopify.search(colStore('col-503.test', moxBig(), COLS, {}, { '^/collections/pokemon-tcg/': () => html('erro', 503) }), catalog));
  assert.equal(e503.httpStatus, 503); assert.deepEqual([census('col-503.test').collection, census('col-503.test').suggest], [1, 0]);
});

await t('Shopify acima do teto: produto em /products.json e na coleção vira um anúncio só', async () => {
  const host = 'col-dup.test';
  // 0 por id; 1 sem id (por handle); 2 com id diferente e o mesmo handle (a mesma URL)
  const L = await shopify.search(colStore(host, moxBig({ 5: mox37(0), 6: mox37(1, { id: undefined }), 7: mox37(2, { id: 99999 }) }), COLS,
    { 'pokemon-tcg': [...MOX37_ALL.slice(0, 1), mox37(1, { id: undefined }), ...MOX37_ALL.slice(2), mox37(3)] }), catalog);
  assert.equal(L.length, 37, 'duplicados por id, handle e URL entram uma vez');
  assert.equal(new Set(L.map((l) => l.url)).size, 37);
  measured.col.dup = census(host);
});

await t('Shopify acima do teto: teto de páginas extras (por coleção e total) registra leitura parcial', async () => {
  const host = 'col-teto.test';
  const singles = Array.from({ length: 2000 }, (_, i) => ({ id: 300000 + i, title: `Carta Avulsa Pokémon ${i}/165 Near Mint`, handle: `avulsa-${i}`, product_type: 'Carta', tags: [], vendor: 'Loja',
    variants: [{ id: 3000000 + i, title: 'Default Title', price: '2.00', available: true }] }));
  const cols = [...COLS, { id: 5, handle: 'pokemon-cartas-avulsas', title: 'Pokémon - Cartas Avulsas', products_count: 2000 }, { id: 6, handle: 'acessorios-pokemon', title: 'Acessórios Pokémon' }];
  const L = await shopify.search(colStore(host, moxBig(), cols, { 'pokemon-tcg': MOX37_ALL, 'pokemon-cartas-avulsas': singles, 'acessorios-pokemon': singles.slice(0, 300) }), catalog);
  const c = measured.col.teto = census(host);
  assert.deepEqual([c.products, c.list, c.collection], [8, 1, shopify.MAX_EXTRA_REQUESTS], `teto total de páginas extras: ${pages(host).join(', ')}`);
  assert.equal(pages(host).filter((p) => p.startsWith('/collections/pokemon-cartas-avulsas/')).length, shopify.MAX_PAGES_PER_COLLECTION, 'teto por coleção');
  assert.ok(pages(host)[8 + 1].startsWith('/collections/pokemon-tcg/'), 'a coleção menor (lacrados) é lida primeiro');
  assert.equal(L.partial, shopify.PARTIAL_AFTER_COLLECTIONS); assert.match(L.partial, /leitura parcial após coleções/);
  assert.equal(L.filter(casa).length, 37, 'os 37 lacrados continuam casando');
  assert.ok(c.total <= LIMIT);
});

await t('Shopify: catálogo pequeno (300) não chama /collections.json', async () => {
  const host = 'col-pequena.test';
  const L = await shopify.search(colStore(host, bigCatalog(300, { 5: mox37(0) }), COLS, { 'pokemon-tcg': MOX37_ALL }), catalog);
  const c = measured.col.small = census(host);
  assert.deepEqual([c.products, c.list, c.collection, c.suggest], [2, 0, 0, 0], `só /products.json: ${pages(host).join(', ')}`);
  assert.deepEqual(L.map((l) => l.title), [MOX37[0][0]]); assert.equal(L.partial, undefined);
});

await t('rodada: 5xx no meio da paginação fica no sources.json e não vira oferta', async () => {
  const keep = Object.fromEntries(['HUNTER_CONFIG_DIR', 'HUNTER_DATA_DIR', 'HUNTER_TIPS', 'HUNTER_CEP', 'HUNTER_BUDGET_MIN'].map((k) => [k, process.env[k]]));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hunter-mid-'));
  try {
    process.env.HUNTER_CONFIG_DIR = path.join(tmp, 'config'); process.env.HUNTER_DATA_DIR = path.join(tmp, 'data'); process.env.HUNTER_TIPS = '0';
    delete process.env.HUNTER_CEP; delete process.env.HUNTER_BUDGET_MIN;
    fs.mkdirSync(process.env.HUNTER_CONFIG_DIR, { recursive: true });
    fs.copyFileSync(path.join(root, 'config/catalog.json'), path.join(tmp, 'config/catalog.json'));
    fs.writeFileSync(path.join(tmp, 'config/stores.json'), JSON.stringify({ stores: [{ id: 'rmid', name: 'rmid', url: 'https://e2e-mid.test', platform: 'shopify', kind: 'specialist', evidence: {} }] }));
    fs.writeFileSync(path.join(tmp, 'config/watchlist.json'), JSON.stringify({ settings: { cep: null }, rules: [] }));
    const all = bigCatalog(1000, { 3: moxProd(0) });
    routes['e2e-mid.test'] = { handle: (u) => { const p = Number(u.searchParams.get('page')); return p === 2 ? html('erro', 502) : json({ products: all.slice((p - 1) * 250, p * 250) }); } };
    const { runOnce } = await import('../src/run.js');
    await runOnce({ log: () => {}, send: { capture: async () => true }, now: new Date() });
    const src = JSON.parse(fs.readFileSync(path.join(tmp, 'data/sources.json'), 'utf8'));
    assert.deepEqual([src.rmid.status, src.rmid.httpStatus], ['ERROR', 502]); assert.match(src.rmid.reason, /502/);
    const offers = Object.values(JSON.parse(fs.readFileSync(path.join(tmp, 'data/offers.json'), 'utf8')));
    assert.equal(offers.filter((o) => o.storeId === 'rmid').length, 0, 'nenhuma oferta com a leitura pela metade');
    assert.equal(pages('e2e-mid.test').length, 2);
  } finally {
    for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

await t('rodada: catálogo maior que o teto grava "partial" no sources.json (ACTIVE); leitura completa limpa o campo', async () => {
  const keep = Object.fromEntries(['HUNTER_CONFIG_DIR', 'HUNTER_DATA_DIR', 'HUNTER_TIPS', 'HUNTER_CEP', 'HUNTER_BUDGET_MIN'].map((k) => [k, process.env[k]]));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hunter-part-'));
  try {
    process.env.HUNTER_CONFIG_DIR = path.join(tmp, 'config'); process.env.HUNTER_DATA_DIR = path.join(tmp, 'data'); process.env.HUNTER_TIPS = '0';
    delete process.env.HUNTER_CEP; delete process.env.HUNTER_BUDGET_MIN;
    fs.mkdirSync(process.env.HUNTER_CONFIG_DIR, { recursive: true });
    fs.copyFileSync(path.join(root, 'config/catalog.json'), path.join(tmp, 'config/catalog.json'));
    const S = (id, host) => ({ id, name: id, url: `https://${host}`, platform: 'shopify', kind: 'specialist', evidence: {} });
    fs.writeFileSync(path.join(tmp, 'config/stores.json'), JSON.stringify({ stores: [S('pbig', 'part-3000.test'), S('psmall', 'part-300.test')] }));
    fs.writeFileSync(path.join(tmp, 'config/watchlist.json'), JSON.stringify({ settings: { cep: null }, rules: [] }));
    shopifyStore('part-3000.test', bigCatalog(3000, { 5: moxProd(0) }));
    shopifyStore('part-300.test', bigCatalog(300, { 5: moxProd(1) }));
    const { runOnce } = await import('../src/run.js');
    const read = () => JSON.parse(fs.readFileSync(path.join(tmp, 'data/sources.json'), 'utf8'));
    const t0 = Date.now();
    await runOnce({ log: () => {}, send: { capture: async () => true }, now: new Date(t0) });
    let src = read();
    assert.deepEqual([src.pbig.status, src.pbig.matched, src.pbig.partial], ['ACTIVE', 1, shopify.PARTIAL_NO_COLLECTION], '3000 produtos sem coleção Pokémon: leitura parcial registrada');
    assert.equal(src.psmall.status, 'ACTIVE'); assert.ok(!('partial' in src.psmall), '300 produtos: sem o campo');
    // a loja grande encolhe para 300: a leitura volta a ser completa e o aviso some
    shopifyStore('part-3000.test', bigCatalog(300, { 5: moxProd(0) }));
    await runOnce({ log: () => {}, send: { capture: async () => true }, now: new Date(t0 + 3600e3) });
    src = read();
    assert.equal(src.pbig.status, 'ACTIVE'); assert.ok(!('partial' in src.pbig), 'leitura completa limpa o "partial"');
  } finally {
    for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

await t('rodada: loja que cai para 0 casados mantém as ofertas stale (sem "removed"); queda parcial remove; sucesso limpa o erro', async () => {
  const keep = Object.fromEntries(['HUNTER_CONFIG_DIR', 'HUNTER_DATA_DIR', 'HUNTER_TIPS', 'HUNTER_CEP', 'HUNTER_BUDGET_MIN'].map((k) => [k, process.env[k]]));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hunter-zero-'));
  try {
    process.env.HUNTER_CONFIG_DIR = path.join(tmp, 'config'); process.env.HUNTER_DATA_DIR = path.join(tmp, 'data'); process.env.HUNTER_TIPS = '0';
    delete process.env.HUNTER_CEP; delete process.env.HUNTER_BUDGET_MIN;
    fs.mkdirSync(process.env.HUNTER_CONFIG_DIR, { recursive: true }); fs.mkdirSync(process.env.HUNTER_DATA_DIR, { recursive: true });
    fs.copyFileSync(path.join(root, 'config/catalog.json'), path.join(tmp, 'config/catalog.json'));
    const S = (id, host) => ({ id, name: id, url: `https://${host}`, platform: 'shopify', kind: 'specialist', evidence: {} });
    fs.writeFileSync(path.join(tmp, 'config/stores.json'), JSON.stringify({ stores: [S('zmox', 'zero-mox.test'), S('zpart', 'zero-part.test'), S('zback', 'zero-back.test')] }));
    fs.writeFileSync(path.join(tmp, 'config/watchlist.json'), JSON.stringify({ settings: { cep: null }, rules: [] }));
    // zback falhou com 429 na rodada anterior (há 1 dia: a espera já passou)
    fs.writeFileSync(path.join(tmp, 'data/sources.json'), JSON.stringify({ zback: { checks: 1, ok: 0, status: 'BLOCKED', reason: 'Limite de requisições (429)', fails: 1,
      lastCheck: new Date(Date.now() - 864e5).toISOString(), httpStatus: 429, netCode: 'ECONNRESET', retryAfterSec: 3600 } }));
    const tagged = (i) => moxProd(i, { tags: ['Pokémon'] }); // 1ª rodada casa por tag, independente do filtro do título
    let round = 1;
    const serve = (host, byRound) => { routes[host] = { handle: (u) => (u.pathname === '/products.json' ? json({ products: Number(u.searchParams.get('page')) === 1 ? byRound[round] : [] }) : html('', 404)) }; };
    // rodada 2: a loja responde (anúncios Pokémon que não são lacrados do catálogo + Magic), mas nada casa
    const NOISE = ['Pelúcia Pokémon Pikachu 20 cm', 'Sleeve Pokémon Pikachu 65 unidades'].map((title, i) => ({ id: 800 + i, title, handle: `pk-${i}`, product_type: 'Acessório', tags: [], vendor: 'Loja',
      variants: [{ id: 8000 + i, title: 'Default Title', price: '59.90', available: true }] }));
    serve('zero-mox.test', { 1: [tagged(0), tagged(1), tagged(2)], 2: [...NOISE, ...MAGIC] });
    serve('zero-part.test', { 1: [tagged(0), tagged(3)], 2: [tagged(0)] });
    serve('zero-back.test', { 1: [tagged(1)], 2: [tagged(1)] });
    const { runOnce } = await import('../src/run.js');
    const send = { capture: async () => true };
    const read = (f) => JSON.parse(fs.readFileSync(path.join(tmp, 'data', f), 'utf8'));
    const t0 = Date.now();
    await runOnce({ log: () => {}, send, now: new Date(t0) });
    let src = read('sources.json');
    assert.deepEqual([src.zmox.matched, src.zpart.matched, src.zback.matched], [3, 2, 1], 'rodada 1 casa tudo');
    assert.equal(src.zback.status, 'ACTIVE');
    assert.deepEqual([src.zback.httpStatus, src.zback.netCode, src.zback.retryAfterSec], [undefined, undefined, undefined], 'loja que voltou: sem httpStatus/netCode/retryAfterSec da falha antiga');
    assert.equal(src.zback.reason, null);
    round = 2;
    await runOnce({ log: () => {}, send, now: new Date(t0 + 3600e3) });
    src = read('sources.json'); const offers = Object.values(read('offers.json'));
    const hist = fs.readFileSync(path.join(tmp, 'data/history.jsonl'), 'utf8').split('\n').filter(Boolean).map((x) => JSON.parse(x));
    const mox = offers.filter((o) => o.storeId === 'zmox');
    assert.equal(mox.length, 3, 'as 3 ofertas da loja que caiu para 0 casados continuam');
    assert.ok(mox.every((o) => o.stale === true && o.stock === 'UNKNOWN' && o.lastValid?.stock === 'IN_STOCK' && o.lastValid?.total > 0), 'stale, estoque desconhecido, lastValid da leitura boa');
    assert.equal(hist.filter((h) => h.storeId === 'zmox' && h.event === 'removed').length, 0, 'nenhum "removed" para a loja que caiu para 0');
    assert.deepEqual([src.zmox.status, src.zmox.matched, src.zmox.listings], ['ACTIVE', 0, NOISE.length]);
    assert.match(src.zmox.reason || '', /zero casados após 3/, 'motivo registrado no sources.json');
    const part = offers.filter((o) => o.storeId === 'zpart');
    assert.deepEqual(part.map((o) => [o.title, o.stale]), [[MOX[0][0], false]], 'queda parcial: o que sumiu sai das ofertas');
    assert.equal(hist.filter((h) => h.storeId === 'zpart' && h.event === 'removed').length, 1, 'queda parcial: remoção normal');
    assert.equal(src.zpart.reason, null);
  } finally {
    for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

http.setFetch(globalThis.fetch);
const v = (h) => measured[h]?.requests;
console.log(`✓ Coleta sem insistir (Shopify, motivo real, espera do 429): ${n} grupos de testes passaram`
  + ` | Shopify por loja/rodada: ${v('vol-pequena.test')}/${v('vol-media.test')}/${v('vol-grande.test')} req (40/300/2000 produtos), ${measured.counts[300]}/${measured.counts[1200]}/${measured.counts[3000]} req (300/1200/3000; teto ${shopify.MAX_PAGES}) + 1 robots.txt; antes ${catalog.collections.length} suggest.json + 1 robots.txt`
  + ` | acima do teto (products/collections.json/coleção, + 1 robots.txt; teto ${LIMIT}): mox 37 casados ${Object.entries(measured.col).map(([k, c]) => `${k} ${c.products}/${c.list}/${c.collection}=${c.total}`).join(', ')}`
  + ` | espera (min) após 1..8 falhas: 429 ${measured.backoff['429'].join(',')}; 403 ${measured.backoff['403'].join(',')}`);
