// Coleta nas lojas sem insistir: volume do Shopify, motivo real da falha e espera própria para 429.
// Offline: fetch simulado (setFetch), nenhuma requisição às lojas. Cobre:
//   1) Shopify: 1 a 3 páginas de /products.json por loja e rodada (antes: 1 suggest.json por coleção do catálogo, 24);
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
await t('Shopify: no máximo 3 páginas de /products.json por loja, sem uma busca por coleção', async () => {
  assert.equal(catalog.collections.length >= 20, true, 'catálogo real com muitas coleções (cada uma era uma busca)');
  for (const [host, total] of [['vol-pequena.test', 40], ['vol-media.test', 300], ['vol-grande.test', 2000]]) {
    const L = await shopify.search(shopifyStore(host, catalogOf(total)), catalog);
    const req = pages(host);
    measured[host] = { total, requests: req.length, robots: (calls[host] || []).length - req.length };
    assert.ok(req.length <= 3, `${host}: ${req.length} requisições (${req.join(', ')})`);
    assert.ok(req.every((p) => p.startsWith('/products.json?limit=250&page=')), `${host}: só /products.json paginado (${req.join(', ')})`);
    assert.equal(measured[host].robots, 1, `${host}: robots.txt lido uma vez`);
    assert.ok(L.length > 0 && L.every((l) => /pok[eé]mon/i.test(l.title)), `${host}: só os produtos Pokémon do catálogo`);
  }
  assert.equal(measured['vol-pequena.test'].requests, 1, 'catálogo menor que uma página: 1 requisição (sem pedir a página vazia)');
  assert.equal(measured['vol-media.test'].requests, 2, '300 produtos: 2 páginas');
  assert.equal(measured['vol-grande.test'].requests, 3, 'catálogo grande: para em 3 páginas');
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
    assert.ok(pages('e2e-ok.test').length <= 3, `loja Shopify ativa: ${pages('e2e-ok.test').length} requisições na rodada`);
    measured.e2eOk = pages('e2e-ok.test').length;
    assert.deepEqual([backoffMs(src.r429), backoffMs(src.r403), backoffMs(src.rdns)].map((x) => x / 60e3), [60, 15, 15], 'espera da 1ª falha: 429 pelo Retry-After (1 h)');
  } finally {
    for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

http.setFetch(globalThis.fetch);
const v = (h) => measured[h]?.requests;
console.log(`✓ Coleta sem insistir (Shopify, motivo real, espera do 429): ${n} grupos de testes passaram`
  + ` | Shopify por loja/rodada: ${v('vol-pequena.test')}/${v('vol-media.test')}/${v('vol-grande.test')} req (40/300/2000 produtos) + 1 robots.txt; antes ${catalog.collections.length} suggest.json + 1 robots.txt`
  + ` | espera (min) após 1..8 falhas: 429 ${measured.backoff['429'].join(',')}; 403 ${measured.backoff['403'].join(',')}`);
