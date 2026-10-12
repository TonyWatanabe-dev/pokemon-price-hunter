// Frente 6 — diagnóstico de bloqueio por loja, filtro de sitemap mais amplo e relatório. Offline (fetch simulado).
//   1) wafOf classifica por cabeçalho/cookie/corpo/código de rede; 2) platformHintOf reconhece a plataforma;
//   3) lastFailure gravado pelo HTTP é compacto e nunca carrega valor de cookie, query ou token;
//   4) isProductCandidate aceita link de produto com palavra de lacrado e recusa o resto;
//   5) catálogo estilo tcgculture (inglês, singles com condição) é lido pelo Shopify mas não casa com o catálogo Copag;
//   6) relatório agrupa por waf; 7) removidas.txt não entra na coleta; 8) run.js grava lastFailure/platformHint.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
process.env.HUNTER_DOMAIN_DELAY_MS ??= '0';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const diag = await import('../src/diagnostico.js');
const http = await import('../src/http.js');
const { isProductCandidate } = await import('../src/adapters/jsonld.js');
const shopify = await import('../src/adapters/shopify.js');
const { matchProduct } = await import('../src/match.js');
const { linhas, markdown } = await import('../tools/coleta-relatorio.mjs');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'config/catalog.json'), 'utf8'));

let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { e.message = `[${name}] ${e.message}`; throw e; } };
const html = (s, status = 200, headers = {}) => new Response(s, { status, headers: { 'content-type': 'text/html', ...headers } });
const json = (o, status = 200, headers = {}) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', ...headers } });
const failure = async (p) => { try { await p; } catch (e) { return e; } return assert.fail('devia falhar'); };

// ---------- 1) wafOf
await t('wafOf: cabeçalhos, cookies e corpo de cada WAF; rede por código', () => {
  const W = (o) => diag.wafOf(o);
  assert.equal(W({ status: 403, headers: { server: 'cloudflare', 'cf-ray': '8a1b2c3d4e5f6a7b-GRU' }, body: '<html>Forbidden' }), 'cloudflare');
  assert.equal(W({ status: 200, headers: {}, body: '<html><title>Just a moment...</title><script src="/cdn-cgi/challenge-platform/h/b/orchestrate"></script>' }), 'cloudflare');
  assert.equal(W({ status: 403, headers: { server: 'AkamaiGHost' }, body: 'Access Denied. Reference #18.4f2a1c3b.1700000000.1a2b3c' }), 'akamai');
  assert.equal(W({ status: 403, headers: { 'set-cookie': 'datadome=abc123; Path=/; Secure' }, body: '' }), 'datadome');
  assert.equal(W({ status: 403, headers: {}, body: '<script src="https://ct.captcha-delivery.com/c.js"></script>' }), 'datadome');
  assert.equal(W({ status: 403, headers: { 'set-cookie': '_pxhd=xyz; Path=/' }, body: '' }), 'perimeterx');
  assert.equal(W({ status: 403, headers: { 'x-iinfo': '1-2-3' }, body: '' }), 'imperva');
  assert.equal(W({ status: 403, headers: { 'set-cookie': 'visid_incap_123=abc; Path=/' }, body: '' }), 'imperva');
  assert.equal(W({ status: 403, headers: { server: 'Sucuri/Cloudproxy', 'x-sucuri-id': '1' }, body: '' }), 'sucuri');
  assert.equal(W({ status: 403, headers: { 'x-amzn-waf-action': 'challenge' }, body: '' }), 'aws-waf');
  assert.equal(W({ status: 403, headers: { 'set-cookie': 'aws-waf-token=abc; Path=/' }, body: '' }), 'aws-waf');
  assert.equal(W({ status: 403, headers: { server: 'nginx' }, body: '<h1>403 Forbidden</h1>' }), 'generic-403');
  assert.equal(W({ status: 401, headers: {}, body: '' }), 'generic-403');
  assert.equal(W({ code: 'TIMEOUT' }), 'timeout');
  assert.equal(W({ code: 'ENOTFOUND' }), 'dns');
  assert.equal(W({ code: 'EAI_AGAIN' }), 'dns');
  assert.equal(W({ code: 'ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR' }), 'tls');
  assert.equal(W({ code: 'CERT_HAS_EXPIRED' }), 'tls');
  assert.equal(W({ status: 503, headers: { server: 'nginx' }, body: 'Service Unavailable' }), 'unknown');
  assert.equal(W({ status: 429, headers: {}, body: '' }), 'unknown');
  // Headers do fetch (objeto Headers) funcionam igual ao objeto simples
  assert.equal(W({ status: 403, headers: new Headers({ server: 'cloudflare' }), body: '' }), 'cloudflare');
});

// ---------- 2) platformHintOf
await t('platformHintOf: VTEX, Shopify, Nuvemshop, Tray, Loja Integrada, WooCommerce, Magento; nada = null', () => {
  const P = (o) => diag.platformHintOf(o);
  assert.equal(P({ headers: { 'x-vtex-cache-status-js': 'HIT' }, body: '<html>' }), 'vtex');
  assert.equal(P({ headers: {}, body: '<script>window.__RUNTIME__ = {}</script><img src="https://loja.vteximg.com.br/a.png">' }), 'vtex');
  assert.equal(P({ headers: { 'x-shopify-stage': 'production' }, body: '' }), 'shopify');
  assert.equal(P({ headers: {}, body: '<link href="https://cdn.shopify.com/s/files/1/x.css">' }), 'shopify');
  assert.equal(P({ headers: {}, body: "<script>LS.product = { id: 1 };</script>" }), 'nuvemshop');
  assert.equal(P({ headers: {}, body: '<img src="https://images.tcdn.com.br/img/a.jpg">' }), 'tray');
  assert.equal(P({ headers: {}, body: '<script src="https://cdn.awsli.com.br/x.js"></script>' }), 'lojaintegrada');
  assert.equal(P({ headers: {}, body: '<link href="/wp-content/plugins/woocommerce/assets/css/x.css">' }), 'woocommerce');
  assert.equal(P({ headers: { 'x-magento-tags': 'cat_p' }, body: '' }), 'magento');
  assert.equal(P({ headers: {}, body: '<script src="/static/version1700000000/frontend/Magento/luma/x.js">' }), 'magento');
  assert.equal(P({ headers: { server: 'nginx' }, body: '<html><body>Olá</body></html>' }), null);
});

// ---------- 3) lastFailure pelo caminho real do HTTP: compacto e sem valor de cookie
const SECRET_COOKIE = 'datadome=SEGREDO_DO_COOKIE_123; Path=/; Secure; HttpOnly';
const routes = {};
http.setFetch(async (url) => {
  const u = new URL(url);
  if (u.pathname === '/robots.txt') return routes[u.host]?.robots ? routes[u.host].robots() : html('', 404);
  const r = routes[u.host]; if (!r) return html('', 404);
  return r.handle(u);
});
await t('lastFailure: 403 com cookie do WAF guarda só o NOME do cookie, cf-ray truncado, bodyHead sem script e ≤ 300 caracteres', async () => {
  routes['dd.test'] = { handle: () => html('<html><head><script>var secret="TOKEN_NO_SCRIPT";</script><style>.x{}</style></head><body><h1>Acesso negado</h1>' + 'texto '.repeat(200) + '</body></html>', 403,
    { 'set-cookie': SECRET_COOKIE, server: 'nginx', 'cf-ray': '8a1b2c3d4e5f6a7b-GRU', via: '1.1 varnish' }) };
  const e = await failure(http.get('https://dd.test/produto?token=QUERY_SECRETA'));
  assert.ok(e.blocked && e.forensics, 'erro bloqueado com forense anexada');
  const f = e.forensics; const s = JSON.stringify(f);
  assert.equal(f.status, 403); assert.equal(f.waf, 'cloudflare', 'cf-ray presente = cloudflare');
  assert.deepEqual(f.setCookieNames, ['datadome']);
  assert.equal(f.cfRay, '8a1b2c3d'); assert.equal(f.server, 'nginx'); assert.equal(f.via, '1.1 varnish');
  assert.ok(Number.isInteger(f.elapsedMs) && f.elapsedMs >= 0);
  assert.ok(f.bodyHead.startsWith('Acesso negado texto'), f.bodyHead);
  assert.ok(f.bodyHead.length <= 300);
  for (const bad of ['SEGREDO_DO_COOKIE', 'TOKEN_NO_SCRIPT', 'QUERY_SECRETA', '<script', '8a1b2c3d4e5f6a7b']) assert.ok(!s.includes(bad), `forense não pode conter ${bad}`);
  assert.ok(s.length < 600, `forense compacta (${s.length} bytes)`);
  // via lastFailureOf (o que o run.js grava): mesma forense, com a hora da rodada
  const lf = diag.lastFailureOf(e, { at: '2026-10-12T10:00:00.000Z', elapsedMs: 5, code: null });
  assert.equal(lf.at, '2026-10-12T10:00:00.000Z'); assert.equal(lf.waf, 'cloudflare'); assert.deepEqual(lf.setCookieNames, ['datadome']);
});
await t('lastFailure: 429 e 5xx também levam forense; rede/timeout classificam pelo código', async () => {
  routes['rl.test'] = { handle: () => html('slow down', 429, { 'retry-after': '120', server: 'openresty' }) };
  const e429 = await failure(http.get('https://rl.test/x'));
  assert.equal(e429.forensics.status, 429); assert.equal(e429.forensics.server, 'openresty'); assert.equal(e429.forensics.waf, 'unknown');
  routes['s5.test'] = { handle: () => html('<h1>502 Bad Gateway</h1>', 502, { server: 'nginx' }) };
  const e5 = await failure(http.get('https://s5.test/x'));
  assert.equal(e5.forensics.status, 502); assert.equal(e5.forensics.bodyHead, '502 Bad Gateway');
  routes['dns.test'] = { handle: () => { throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('getaddrinfo ENOTFOUND dns.test'), { code: 'ENOTFOUND' }) }); } };
  const ed = await failure(http.get('https://dns.test/x'));
  assert.equal(ed.forensics.waf, 'dns'); assert.equal(ed.forensics.errorCode, 'ENOTFOUND'); assert.equal(ed.forensics.status, null);
  routes['to.test'] = { handle: () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); } };
  const et = await failure(http.get('https://to.test/x'));
  assert.equal(et.forensics.waf, 'timeout'); assert.equal(et.forensics.errorCode, 'TIMEOUT');
  // sem forense (erro criado fora do HTTP): lastFailureOf monta a partir do status/código
  const lf = diag.lastFailureOf(Object.assign(new Error('x'), { status: 'platform' }), { at: 'T', code: null });
  assert.equal(lf.status, null); assert.equal(lf.waf, 'unknown'); assert.deepEqual(lf.setCookieNames, []);
});
await t('lastFailure atravessa o robots.txt: guard() devolve a forense do 403 do robots', async () => {
  routes['rb.test'] = { robots: () => html('<title>Just a moment...</title>', 403, { server: 'cloudflare', 'set-cookie': '__cf_bm=VALOR; Path=/' }), handle: () => html('<p>nunca chega</p>') };
  const { guard } = await import('../src/adapters/common.js');
  const e = await failure(guard('https://rb.test/produtos/x'));
  assert.ok(e.blocked); assert.equal(e.forensics?.waf, 'cloudflare'); assert.deepEqual(e.forensics.setCookieNames, ['__cf_bm']);
  assert.ok(!JSON.stringify(e.forensics).includes('VALOR'));
});
await t('platformHint: resposta boa anota a plataforma por host, sem requisição extra', async () => {
  routes['pl.test'] = { handle: () => html('<html><script>window.__RUNTIME__={}</script><img src="https://pl.vteximg.com.br/a.png"></html>', 200, { 'x-vtex-cache-status-js': 'HIT' }) };
  await http.get('https://pl.test/');
  assert.equal(diag.platformHintFor('https://pl.test'), 'vtex'); assert.equal(diag.platformHintFor('pl.test'), 'vtex'); assert.equal(diag.platformHintFor('www.pl.test'), 'vtex');
  assert.equal(diag.platformHintFor('nada.test'), null);
});

// ---------- 4) filtro de sitemap mais amplo
await t('isProductCandidate: aceita link de produto com palavra de lacrado (sem "pokemon"), recusa categoria/roupa/falsos positivos', () => {
  const yes = ['https://x.com/pokemon-booster-box-caos-ascendente-36', 'https://x.com/produtos/booster-box-caos-ascendente', 'https://x.com/produto/lata-charizard-ex',
    'https://x.com/product/elite-trainer-box-escuridao', 'https://x.com/products/mini-tin-eevee', 'https://x.com/p/colecao-especial-151', 'https://x.com/produtos/cole%C3%A7%C3%A3o-30-anos',
    'https://x.com/produtos/treinador-avan%C3%A7ado-me04', 'https://x.com/produtos/blister-triplo-me05', 'https://x.com/produtos/deck-batalha-ex', 'https://x.com/produtos/bundle-6-boosters',
    'https://x.com/produtos/box-escuridao-absoluta', 'https://x.com/produtos/etb-fogo-fantasmagorico', 'https://x.com/produtos/tcg-pokemon-caixa'];
  const no = ['https://x.com/camiseta', 'https://x.com/produtos/camiseta-preta', 'https://x.com/produtos/xbox-series-s', 'https://x.com/produtos/chocolate-latam', 'https://x.com/categoria/pokemon/',
    'https://x.com/produtos/tenis-elite', 'https://x.com/produtos/plataforma-de-madeira', 'https://x.com/produtos/destino-final-dvd', 'https://x.com/blog/booster-box-vale-a-pena', 'https://x.com/produtos/',
    'https://x.com/pokemon-camiseta', 'https://x.com/produtos/boxer-masculino', 'https://x.com/produtos/decksaver-capa'];
  for (const u of yes) assert.ok(isProductCandidate(u), `devia aceitar ${u}`);
  for (const u of no) assert.ok(!isProductCandidate(u), `devia recusar ${u}`);
});
await t('productUrls: sitemap com links de produto sem "pokemon" agora entra; teto `max` continua', async () => {
  const { productUrls } = await import('../src/adapters/jsonld.js');
  routes['sm.test'] = { handle: (u) => u.pathname === '/sitemap.xml' ? html('<urlset>' + ['/produtos/booster-box-caos-ascendente', '/produtos/lata-charizard', '/produtos/camiseta', '/sobre', '/pokemon-blister-triplo-me04'].map((p) => `<url><loc>https://sm.test${p}</loc></url>`).join('') + '</urlset>') : html('', 404) };
  const urls = await productUrls('https://sm.test', 60);
  assert.deepEqual(urls.sort(), ['https://sm.test/pokemon-blister-triplo-me04', 'https://sm.test/produtos/booster-box-caos-ascendente', 'https://sm.test/produtos/lata-charizard']);
  assert.equal((await productUrls('https://sm.test', 2)).length, 2);
});

// ---------- 5) catálogo estilo tcgculture.com: Shopify lê, o matching recusa (produto em inglês / singles com condição)
await t('tcgculture-style: Shopify lê os anúncios Pokémon; nenhum casa com o catálogo Copag (é o comportamento certo, não falha de coleta)', async () => {
  const P = (id, title, price) => ({ id, title, handle: `p-${id}`, product_type: 'Pokemon', tags: ['Pokemon'], vendor: 'Pokemon', variants: [{ id: id * 10, title: 'Default Title', price, available: true }] });
  const items = [
    P(1, 'Zarude (088) (Pokemon Center Exclusive) [Mega Evolution Promo] Near Mint Holofoil', '4.99'),
    P(2, 'Lapras (023/078) [Pokémon GO] Lightly Played Reverse Holofoil', '1.50'),
    P(3, 'Pokemon TCG: Scarlet & Violet Prismatic Evolutions Mini Tin Espeon', '14.99'),
    P(4, 'Pokémon Scarlet & Violet: Obsidian Flames Box (36 Packs)', '149.99'),
    P(5, 'Pokémon Scarlet & Violet Elite Trainer Box', '49.99'),
    P(6, 'Pokémon Booster Box Caos Ascendente 36 boosters Copag', '389.90'), // controle: produto Copag casa
  ];
  routes['tc.test'] = { handle: (u) => u.pathname === '/products.json' ? json({ products: Number(u.searchParams.get('page') || 1) === 1 ? items : [] }) : html('', 404) };
  const L = await shopify.search({ id: 'tc', url: 'https://tc.test' }, catalog);
  assert.equal(L.length, 6, 'todos passam pelo filtro pokemonish');
  const matched = L.filter((l) => matchProduct(l, catalog).productId);
  assert.deepEqual(matched.map((l) => l.title), ['Pokémon Booster Box Caos Ascendente 36 boosters Copag']);
  const why = L.filter((l) => !matchProduct(l, catalog).productId).map((l) => matchProduct(l, catalog).why.join(';'));
  assert.ok(why.every((w) => /coleção não identificada|acessório|kit/.test(w)), why.join(' | '));
});

// ---------- 6) relatório
await t('coleta-relatorio: agrupa por waf, usa lastFailure quando existe e cai para httpStatus/netCode quando não', () => {
  const sources = {
    a: { name: 'A', status: 'BLOCKED', platform: null, lastFailure: { at: 'T', status: 403, waf: 'cloudflare', server: 'cloudflare', cfRay: '8a1b2c3d', setCookieNames: ['__cf_bm'], bodyHead: 'Just a moment...', elapsedMs: 120 } },
    b: { name: 'B', status: 'BLOCKED', netCode: 'ENOTFOUND' },
    c: { name: 'C', status: 'ACTIVE', platform: 'jsonld', platformHint: 'nuvemshop', listings: 10, matched: 4 },
    d: { name: 'D', status: 'BLOCKED', httpStatus: 403 },
    e: { name: 'E', status: 'ERROR', netCode: 'TIMEOUT', lastFailure: { at: 'T', waf: 'timeout', errorCode: 'TIMEOUT' } },
  };
  const rows = linhas(sources);
  assert.deepEqual(rows.map((r) => `${r.id}:${r.waf}`), ['a:cloudflare', 'd:generic-403', 'e:timeout', 'b:dns', 'c:—']);
  const md = markdown(sources, 'AGORA');
  assert.match(md, /## cloudflare \(1\)/); assert.match(md, /## dns \(1\)/); assert.match(md, /## sem falha \(ACTIVE\) \(1\)/);
  assert.match(md, /\| A \| — \| BLOCKED \| HTTP 403 · server=cloudflare · cf-ray=8a1b2c3d… · cookies=__cf_bm · 120 ms · "Just a moment\.\.\." \| —\/— \|/);
  assert.match(md, /\| C \| jsonld \(dica: nuvemshop\) \| ACTIVE \| — \| 10\/4 \|/);
});

// ---------- 7) inventário: removidas.txt é só comentário; duplicatas PENDING saíram do stores.json
await t('removidas.txt: nenhuma linha vira loja; stores.json sem as PENDING duplicadas; listas sem os domínios mortos', () => {
  const txt = fs.readFileSync(path.join(root, 'config/lojas/removidas.txt'), 'utf8');
  for (const line of txt.split(/\r?\n/)) assert.equal(line.replace(/#.*/, '').trim(), '', `linha ativa em removidas.txt: ${line}`);
  for (const h of ['uzgames.com.br', 'geek-shop.com.br', 'monsterstcg.com.br', 'brofist.com.br', 'bandecole.com.br', 'onlinelojageek.com.br', 'collectandplay.com.br', 'tcgculture.com']) assert.ok(txt.includes(h), `${h} registrado em removidas.txt`);
  const { stores } = JSON.parse(fs.readFileSync(path.join(root, 'config/stores.json'), 'utf8'));
  for (const id of ['nerbstore', 'grbcards', 'cardora', 'matostcg', 'gorupa', 'culturetcg']) assert.ok(!stores.some((s) => s.id === id), `${id} ainda em stores.json`);
  const ativas = fs.readdirSync(path.join(root, 'config/lojas')).filter((f) => f.endsWith('.txt') && f !== 'removidas.txt')
    .flatMap((f) => fs.readFileSync(path.join(root, 'config/lojas', f), 'utf8').split(/\r?\n/).map((l) => l.replace(/#.*/, '').trim()).filter(Boolean));
  for (const h of ['uzgames.com.br', 'geek-shop.com.br', 'monsterstcg.com.br', 'brofist.com.br', 'bandecole.com.br', 'onlinelojageek.com.br', 'collectandplay.com.br', 'tcgculture.com']) assert.ok(!ativas.some((l) => l.includes(h)), `${h} ainda numa lista ativa`);
  // as lojas vivas que as PENDING duplicavam continuam nas listas
  for (const h of ['grbcards.com.br', 'cardora.com.br', 'matostcg.com.br', 'gorupa.com.br', 'resetnerdstore.com.br']) assert.ok(ativas.some((l) => l.includes(h)), `${h} sumiu das listas`);
});

// ---------- 8) run.js grava lastFailure (loja bloqueada) e platformHint (loja ativa) em sources.json
await t('runOnce: sources.json ganha lastFailure na loja bloqueada e platformHint na loja ativa', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pph-diag-'));
  fs.mkdirSync(path.join(tmp, 'config/lojas'), { recursive: true }); fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
  for (const f of ['catalog.json', 'pistas.json', 'watchlist.json']) { try { fs.copyFileSync(path.join(root, 'config', f), path.join(tmp, 'config', f)); } catch { /* opcional */ } }
  fs.writeFileSync(path.join(tmp, 'config/stores.json'), JSON.stringify({ stores: [
    { id: 'blk', name: 'Bloqueada', url: 'https://blk.test', platform: 'auto', kind: 'specialist', evidence: {} },
    { id: 'ok', name: 'Ativa', url: 'https://ok.test', platform: 'jsonld', kind: 'specialist', evidence: {} },
  ] }));
  process.env.HUNTER_DATA_DIR = path.join(tmp, 'data'); process.env.HUNTER_CONFIG_DIR = path.join(tmp, 'config');
  routes['blk.test'] = { handle: () => html('<title>Just a moment...</title>', 403, { server: 'cloudflare', 'set-cookie': '__cf_bm=SEGREDO; Path=/' }) };
  routes['ok.test'] = { handle: (u) => u.pathname === '/sitemap.xml' ? html('<urlset><url><loc>https://ok.test/produtos/booster-box-me04</loc></url></urlset>') : html('<html><script>LS.product = { id: 1 };</script><body>Loja</body></html>') };
  const { runOnce } = await import('../src/run.js');
  await runOnce({ log: () => {}, send: { capture: async () => true }, now: new Date('2026-10-12T10:00:00Z') });
  const src = JSON.parse(fs.readFileSync(path.join(tmp, 'data/sources.json'), 'utf8'));
  assert.equal(src.blk.status, 'BLOCKED'); assert.equal(src.blk.lastFailure?.waf, 'cloudflare'); assert.equal(src.blk.lastFailure.at, '2026-10-12T10:00:00.000Z');
  assert.deepEqual(src.blk.lastFailure.setCookieNames, ['__cf_bm']); assert.ok(!JSON.stringify(src.blk).includes('SEGREDO'));
  assert.equal(src.ok.status, 'ACTIVE'); assert.equal(src.ok.platformHint, 'nuvemshop');
  fs.rmSync(tmp, { recursive: true, force: true });
});

console.log(`coleta-diagnostico: ${n} testes OK`);
