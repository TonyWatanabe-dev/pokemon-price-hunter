// Frente 7 — página /lojas + deep links (api/_lib/lojas.mjs, api/pagina.mjs, api/sitemap.mjs, vercel.json, index.html):
// toda loja conhecida aparece (monitorada, sem leitura automática, marketplace ou pausada) com link para a busca de Pokémon
// na própria loja; o produto ganha "Procurar em outras lojas". Nunca um preço que o robô não leu; texto nunca diz "fora do ar".
// Sem rede: state.json (com `sources`) vem de um fetch falso, como em seo-lote-e-tests.js.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LOJAS_CFG, normalizeLojas, searchUrlFor, inferPlatform, sections, outrasLojas } from '../api/_lib/lojas.mjs';
// Lojas dentro de marketplace (link direto) vêm da config: as contagens abaixo acompanham a lista, sem número fixo.
const OF = Object.keys(LOJAS_CFG.lojasOficiais || {}); const K = OF.length;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0;
async function t(name, fn) { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } }
const NOW = Date.parse('2026-10-12T18:00:00.000Z');
const T = new Date(NOW - 5 * 6e4).toISOString();
const T2 = new Date(NOW - 40 * 6e4).toISOString();

const off = (id, storeId, productId, url, extra = {}) => ({ id, productId, storeId, storeName: storeId, title: 'x', url, price: 100, priceKind: 'base', shipping: 0, shippingKnown: true, total: 100,
  stock: 'IN_STOCK', confirmed: true, anomalous: false, stale: false, discount: null, firstSeen: T, source_timestamp: T, ...extra });
const src = (id, status, url, extra = {}) => ({ id, name: id, kind: 'specialist', status, url, checks: 1, ok: 1, ...extra });
const SOURCES = [
  src('alfa', 'ACTIVE', 'https://www.alfa.com.br', { name: 'Alfa Cards', platform: 'shopify', lastSuccess: T }),
  src('beta', 'ACTIVE', 'https://beta.com.br', { platform: 'jsonld', lastSuccess: T2 }),
  src('gama', 'ACTIVE', 'https://gama.com.br', { platform: 'jsonld', lastSuccess: T2 }),
  src('lambda', 'ACTIVE', 'https://lambda.com.br', { platform: 'jsonld', platformHint: 'tray' }),
  src('delta', 'BLOCKED', 'https://delta.com.br', { reason: 'delta.com.br fora do ar ou lento para responder (timeout)', errorClass: 'bloqueio', httpStatus: 403, fails: 20 }),
  src('eps', 'ERROR', 'https://eps.com.br', { platform: 'shopify', reason: 'HTTP 503 em https://eps.com.br/products.json', errorClass: 'http_5xx' }),
  src('kalungacombr', 'BLOCKED', 'https://www.kalunga.com.br', { errorClass: 'plataforma', reason: 'plataforma não reconhecida' }),
  src('zeta', 'UNAVAILABLE', 'https://www.zeta.com.br', { reason: 'Marketplace grande: bloqueia robôs e não tem API pública' }),
  src('eta', 'PAUSED', 'https://eta.com.br', { reason: 'pausada manualmente' }),
  src('theta', 'PENDING', null, { name: 'Theta Store', reason: 'domínio ainda não confirmado' }),
  src('thetacombr', 'ACTIVE', 'https://theta.com.br', { platform: 'vtex' }),
  src('iota', 'PENDING', null, { name: 'Iota', reason: 'domínio ainda não confirmado' }),
  src('mercadolivre', 'ACTIVE', 'https://api.mercadolibre.com', { name: 'Mercado Livre', kind: 'marketplace', platform: 'mercadolivre', lastSuccess: T }),
  src('mercadolivrecombr', 'UNAVAILABLE', 'https://www.mercadolivre.com.br'),
  src('amazon', 'UNAVAILABLE', null, { name: 'Amazon Brasil', kind: 'marketplace', reason: 'Sem API pública' }),
  src('amazoncombr', 'UNAVAILABLE', 'https://www.amazon.com.br'),
  src('shopee', 'UNAVAILABLE', null, { name: 'Shopee Brasil', kind: 'marketplace' }),
  src('magalu', 'UNAVAILABLE', null, { name: 'Magalu', kind: 'marketplace' }),
];
const P = [{ id: 'p1', collection: 'c1', collectionName: 'Escuridão Absoluta', type: 'blister_3', typeLabel: 'Blister Triplo', group: 'Blisters', boosters: null, copagConfirmed: true, msrp: 90, offerCount: 3 }];
const O = [
  off('o1', 'alfa', 'p1', 'https://www.alfa.com.br/products/blister-triplo', { total: 80, price: 80 }),
  off('o2', 'alfa', 'p1', 'https://www.alfa.com.br/products/blister-triplo-2', { total: 85, price: 85, stale: true, source_timestamp: T2 }),
  off('o3', 'beta', 'p1', 'https://beta.com.br/produtos/blister-triplo/', { total: 88, price: 88 }),
  off('o4', 'gama', 'p1', 'https://gama.com.br/blister-triplo-pokemon', { total: 95, price: 95, stock: 'OUT_OF_STOCK' }),
  off('o5', 'mercadolivre', 'p1', 'https://produto.mercadolivre.com.br/MLB-123456789-x', { total: 99, price: 99, stale: true }),
];
const state = { generatedAt: T, coverage: { found: O.length }, totals: { offers: O.length }, products: P, offers: O,
  collections: [{ id: 'c1', name: 'Escuridão Absoluta', series: 'S', aliases: [], products: 1 }], types: [{ id: 'blister_3', label: 'Blister Triplo', group: 'Blisters', products: 1 }],
  sources: SOURCES, activity: [], tips: [], bestDeals: [] };

function render(queries, st = state) {
  const script = `import { setFreshnessClock } from ${JSON.stringify(pathToFileURL(path.join(root, 'api/_lib/freshness.mjs')).href)};
    setFreshnessClock(() => ${NOW}); const st = JSON.parse(process.argv[1]);
    globalThis.fetch = async () => new Response(JSON.stringify(st), { status: 200 });
    const { default: h } = await import(${JSON.stringify(pathToFileURL(path.join(root, 'api/pagina.mjs')).href)});
    const { default: sm } = await import(${JSON.stringify(pathToFileURL(path.join(root, 'api/sitemap.mjs')).href)});
    const out = {};
    for (const q of JSON.parse(process.argv[2])) {
      const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
      await h({ url: '/api/pagina?' + q, headers: { host: 'x' } }, res);
      out[q] = { status: res.statusCode, body: res.body };
    }
    { const res = { setHeader() {}, end(b) { this.body = b; } }; await sm({}, res); out.sitemap = res.body; }
    console.log(JSON.stringify(out));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script, JSON.stringify(st), JSON.stringify(queries)],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, API_DATABASE_URL: '' } });
  if (r.status !== 0) throw new Error(`falha ao renderizar (status ${r.status}, ${r.signal || r.error || ''}): ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}
const meta = (h, re) => (h.match(re) || [])[1] || '';
const parse = (body) => ({
  title: meta(body, /<title>([^<]*)<\/title>/), desc: meta(body, /<meta name="description" content="([^"]*)">/), canonical: meta(body, /<link rel="canonical" href="([^"]*)">/),
  ld: [...body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1])),
  ssr: (body.match(/<div class="ssr">([\s\S]*?)<\/div><\/div>/) || [])[1] || '', noindex: body.includes('<meta name="robots" content="noindex">'),
});
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const anchors = (h) => [...h.matchAll(/<a ([^>]*)>/g)].map((m) => Object.fromEntries([...m[1].matchAll(/([a-z-]+)="([^"]*)"/g)].map((x) => [x[1], x[2]])));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const L = normalizeLojas({ sources: SOURCES, stores: [], offers: O });
const by = Object.fromEntries(L.map((l) => [l.id, l]));

await t('1. normalização: status por fonte, marketplaces, duplicata por host/pendente, contagem só de oferta viva, motivo honesto', () => {
  assert.deepEqual(L.map((l) => [l.id, l.status]).filter(([id]) => ['alfa', 'beta', 'gama', 'lambda', 'thetacombr', 'mercadolivre'].includes(id)).map(([, s]) => s), Array(6).fill('monitorada'));
  assert.equal(by.delta.status, 'sem-leitura'); assert.equal(by.eps.status, 'sem-leitura'); assert.equal(by.kalungacombr.status, 'sem-leitura');
  assert.equal(by.zeta.status, 'indisponivel'); assert.equal(by.eta.status, 'pausada');
  for (const id of ['amazon', 'shopee', 'magalu']) assert.equal(by[id].status, 'marketplace', id);
  assert.ok(!by.amazoncombr && !by.mercadolivrecombr, 'mesmo host: amazon × amazon.com.br e mercadolivre × mercadolivre.com.br viram uma só');
  assert.equal(by.amazon.host, 'amazon.com.br'); assert.equal(by.amazon.url, 'https://www.amazon.com.br');
  assert.equal(by.mercadolivre.status, 'monitorada'); assert.equal(by.mercadolivre.host, 'mercadolivre.com.br'); assert.equal(by.mercadolivre.platform, 'mercadolivre');
  assert.ok(!by.theta, 'pendente sem domínio que já existe com domínio (theta → thetacombr) não duplica');
  assert.ok(by.iota && by.iota.url === null && by.iota.searchUrl === null && by.iota.status === 'sem-leitura', 'pendente sem domínio e sem par fica, sem link');
  assert.equal(by.alfa.name, 'Alfa Cards'); assert.equal(by.alfa.offersLive, 1, 'oferta stale não conta'); assert.equal(by.alfa.lastReadAt, T);
  assert.equal(by.gama.offersLive, 0, 'sem estoque não conta'); assert.equal(by.beta.lastReadAt, T, 'última leitura = oferta mais recente');
  assert.equal(by.delta.offersLive, 0); assert.equal(by.delta.lastReadAt, null, 'loja sem leitura não anuncia leitura');
  for (const l of L) { assert.doesNotMatch(String(l.reason || ''), /fora do ar|lento|timeout|HTTP/i, `${l.id}: ${l.reason}`); assert.ok(!('price' in l) && !('total' in l), 'nunca preço'); }
  assert.match(by.delta.reason, /não aceita leitura automática/); assert.match(by.kalungacombr.reason, /Plataforma ainda sem leitura/); assert.match(by.zeta.reason, /Sem API pública/);
  assert.match(by.amazon.reason, /Marketplace/); assert.match(by.eta.reason, /pausada/i);
  const secs = sections(L); assert.deepEqual(secs.map(([k, , xs]) => [k, xs.length]), [['monitoradas', 6], ['sem-leitura', 5], ['marketplaces', 3 + K], ['pausadas', 1]]);
  assert.deepEqual(secs[0][2].slice(0, 2).map((l) => l.id), ['alfa', 'beta'], 'monitoradas: mais ofertas vivas primeiro');
});

await t('2. searchUrl: padrão por plataforma, dica/inferência pelas URLs das ofertas, busca própria do host, marketplaces e página inicial como último recurso', () => {
  const u = (platform, url = 'https://www.x.com.br') => searchUrlFor({ url, host: 'x.com.br', platform, marketplace: null });
  assert.equal(u('shopify'), 'https://www.x.com.br/search?q=pokemon');
  assert.equal(u('vtex'), 'https://www.x.com.br/pokemon?_q=pokemon&map=ft');
  assert.equal(u('nuvemshop'), 'https://www.x.com.br/search/?q=pokemon');
  assert.equal(u('tray'), 'https://www.x.com.br/loja/busca.php?palavra_busca=pokemon');
  assert.equal(u('woocommerce'), 'https://www.x.com.br/?s=pokemon&post_type=product');
  assert.equal(u('lojaintegrada'), 'https://www.x.com.br/buscar?q=pokemon');
  assert.equal(u('magento'), 'https://www.x.com.br/catalogsearch/result/?q=pokemon');
  assert.equal(u('opencart'), 'https://www.x.com.br/index.php?route=product/search&search=pokemon');
  assert.equal(u(null), 'https://www.x.com.br/', 'sem padrão confirmado: página inicial');
  assert.equal(u('jsonld'), 'https://www.x.com.br/', '"jsonld" é método de leitura, não plataforma');
  assert.equal(by.alfa.searchUrl, 'https://www.alfa.com.br/search?q=pokemon'); assert.equal(by.alfa.searchKind, 'busca');
  assert.equal(by.beta.platform, 'nuvemshop', 'inferida de /produtos/'); assert.equal(by.beta.searchUrl, 'https://beta.com.br/search/?q=pokemon');
  assert.equal(by.gama.platform, null); assert.equal(by.gama.searchUrl, 'https://gama.com.br/'); assert.equal(by.gama.searchKind, 'inicio');
  assert.equal(by.lambda.platform, 'tray', 'platformHint da fonte vale primeiro'); assert.equal(by.lambda.searchUrl, 'https://lambda.com.br/loja/busca.php?palavra_busca=pokemon');
  assert.equal(by.thetacombr.searchUrl, 'https://theta.com.br/pokemon?_q=pokemon&map=ft');
  assert.equal(by.eps.searchUrl, 'https://eps.com.br/search?q=pokemon', 'loja com erro mas plataforma conhecida tem busca');
  assert.equal(by.kalungacombr.searchUrl, 'https://www.kalunga.com.br/busca/1?q=pokemon', 'busca própria confirmada por host');
  assert.equal(by.mercadolivre.searchUrl, 'https://lista.mercadolivre.com.br/pokemon-tcg');
  assert.equal(by.amazon.searchUrl, 'https://www.amazon.com.br/s?k=pokemon+tcg');
  assert.equal(by.shopee.searchUrl, 'https://shopee.com.br/search?keyword=pokemon%20tcg');
  assert.equal(by.magalu.searchUrl, 'https://www.magazineluiza.com.br/busca/pokemon%20tcg/');
  assert.equal(searchUrlFor(by.mercadolivre, 'Escuridão Absoluta Blister Triplo'), 'https://lista.mercadolivre.com.br/escuridao-absoluta-blister-triplo');
  assert.equal(searchUrlFor(by.alfa, 'Escuridão Absoluta Blister Triplo'), 'https://www.alfa.com.br/search?q=Escurid%C3%A3o%20Absoluta%20Blister%20Triplo');
  assert.equal(inferPlatform(['https://a.com/products/x', 'https://a.com/products/y']), 'shopify'); assert.equal(inferPlatform(['https://a.com/x/p']), 'vtex');
  assert.equal(inferPlatform(['https://a.com/produto/x']), null, '/produto/ não prova WooCommerce (há Wix com o mesmo caminho)'); assert.equal(inferPlatform([]), null);
  for (const [k, v] of Object.entries(LOJAS_CFG.busca)) assert.ok(v.startsWith('/') && v.includes('{q}'), k);
  const out = outrasLojas(L, 'Escuridão Absoluta Blister Triplo');
  assert.deepEqual(out.slice(0, 4).map((x) => x.id), ['mercadolivre', 'amazon', 'shopee', 'magalu'], 'marketplaces primeiro');
  assert.deepEqual(out.slice(4).map((x) => x.id), [...OF.slice().sort((x, y) => LOJAS_CFG.lojasOficiais[x].name.localeCompare(LOJAS_CFG.lojasOficiais[y].name, 'pt-BR')), 'eps', 'kalungacombr'].slice(0, 8), 'depois a loja oficial dentro do marketplace e só loja não monitorada com busca própria, em ordem alfabética');
  assert.equal(out.find((x) => x.id === 'ml-pokemon').url, 'https://www.mercadolivre.com.br/loja/pokemon', 'loja oficial: link direto da loja, sem inventar busca');
  const pk = L.find((l) => l.id === 'ml-pokemon'); assert.equal(pk.status, 'marketplace'); assert.equal(pk.oficial, true); assert.equal(pk.offersLive, 0); assert.equal(pk.searchKind, 'loja');
  assert.ok(out.length <= 12);
  assert.equal(outrasLojas(L, 'x', { max: 5 }).length, 5);
});

const Q = ['t=lojas', 't=produto&slug=escuridao-absoluta-blister-triplo'];
const out = render(Q);
const pg = Object.fromEntries(Q.map((q) => [q, { status: out[q].status, ...parse(out[q].body) }]));
const SAMPLES = process.env.SEO_SAMPLES_DIR;
if (SAMPLES) { fs.mkdirSync(SAMPLES, { recursive: true }); fs.writeFileSync(path.join(SAMPLES, 'lojas.html'), out[Q[0]].body); fs.writeFileSync(path.join(SAMPLES, 'produto.html'), out[Q[1]].body); }

await t('3. SSR /lojas: título, descrição ≤160, 1 h1, 4 seções (h2) na ordem, ItemList de Store/Organization, links nofollow em nova aba, sem preço, texto honesto', () => {
  const p = pg['t=lojas']; assert.equal(p.status, 200); assert.equal(p.noindex, false);
  assert.equal(p.title, 'Lojas de Pokémon TCG no Brasil: todas as lojas monitoradas | TCG Price Hunter');
  assert.equal(p.canonical, 'https://tcgpricehunter.com.br/lojas');
  assert.ok(p.desc.length > 60 && p.desc.length <= 160, p.desc.length); assert.match(p.desc, new RegExp(`6 monitoradas agora, 5 sem leitura automática e ${3 + K} marketplaces\\. Busca direta em cada uma\\.$`));
  assert.equal((p.ssr.match(/<h1[ >]/g) || []).length, 1);
  const h2 = [...p.ssr.matchAll(/<h2 id="([^"]*)">([^<]*)<\/h2>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(h2, [['monitoradas', 'Monitoradas agora (6)'], ['sem-leitura', 'Conhecidas, sem leitura automática (5)'], ['marketplaces', `Marketplaces (${3 + K})`], ['pausadas', 'Pausadas (1)']]);
  assert.ok(!/<h3|<h4/.test(p.ssr) && p.ssr.indexOf('<h1') < p.ssr.indexOf('<h2'), 'h1 → h2');
  const s = text(p.ssr);
  assert.match(s, /Alfa Cards Shopify Monitorada · 1 oferta com estoque · última leitura \d\d\/\d\d, \d\d:\d\d · Buscar Pokémon na loja/);
  assert.match(s, /beta Nuvemshop Monitorada · 1 oferta com estoque/); assert.match(s, /gama Monitorada · 0 ofertas com estoque · última leitura .*? · Abrir a loja/);
  assert.match(s, /delta Sem leitura automática · Abrir a loja .*?A loja não aceita leitura automática/);
  assert.match(s, /zeta Sem leitura automática · Abrir a loja .*?Sem API pública/); assert.match(s, /Iota Sem leitura automática .*?Endereço da loja ainda não confirmado/);
  assert.match(s, /Amazon Brasil Marketplace · Buscar Pokémon na loja/); assert.match(s, /eta Pausada · Abrir a loja/);
  assert.doesNotMatch(s, /fora do ar|lento|timeout/i); assert.doesNotMatch(s, /R\$/, 'nenhum preço na página de lojas');
  const ext = anchors(p.ssr).filter((a) => /^https?:/.test(a.href));
  assert.ok(ext.length >= 14, ext.length);
  for (const a of ext) { assert.equal(a.rel, 'nofollow noopener', a.href); assert.equal(a.target, '_blank', a.href); }
  assert.ok(ext.some((a) => a.href === 'https://www.alfa.com.br/search?q=pokemon') && ext.some((a) => a.href === 'https://lista.mercadolivre.com.br/pokemon-tcg') && ext.some((a) => a.href === 'https://www.kalunga.com.br/busca/1?q=pokemon'));
  assert.ok(!ext.some((a) => /tag=|afiliad/i.test(a.href)), 'busca sem tag de afiliado');
  const opp = anchors(p.ssr).filter((a) => a.href.startsWith('/oportunidades?loja=')).map((a) => a.href);
  assert.deepEqual(opp, ['/oportunidades?loja=alfa', '/oportunidades?loja=beta'], 'filtro de loja só para monitorada com oferta viva');
  const il = p.ld.find((x) => x['@type'] === 'ItemList'); assert.ok(il, 'ItemList');
  assert.equal(il.numberOfItems, il.itemListElement.length); assert.equal(il.itemListElement.length, 14 + K, 'toda loja com endereço, inclusive a loja oficial dentro do marketplace (a pendente sem domínio fica fora)');
  assert.ok(!il.itemListElement.some((x) => x.item.name === 'Iota'));
  for (const it of il.itemListElement) { assert.ok(['Store', 'Organization'].includes(it.item['@type'])); assert.ok(/^https?:\/\//.test(it.item.url)); assert.ok(!('offers' in it.item) && !('price' in it.item)); }
  assert.equal(il.itemListElement.find((x) => x.item.name === 'Amazon Brasil').item['@type'], 'Organization'); assert.equal(il.itemListElement.find((x) => x.item.name === 'Alfa Cards').item['@type'], 'Store');
  assert.deepEqual(p.ld.find((x) => x['@type'] === 'BreadcrumbList').itemListElement.map((i) => i.name), ['Início', 'Lojas de Pokémon TCG no Brasil']);
});

await t('4. SSR do produto: "Procurar em outras lojas" abaixo de "Onde comprar", fechado, até 12 links nofollow com o nome do produto, marketplaces primeiro, sem preço', () => {
  const p = pg['t=produto&slug=escuridao-absoluta-blister-triplo']; assert.equal(p.status, 200);
  const i1 = p.ssr.indexOf('<h2>Onde comprar</h2>'), i2 = p.ssr.indexOf('<details class="more outras">'), i3 = p.ssr.indexOf('<h2>Mais de ');
  assert.ok(i1 > 0 && i2 > i1 && (i3 === -1 || i2 < i3), 'bloco depois de Onde comprar');
  assert.ok(!/<details class="more outras" open/.test(p.ssr), 'fechado (sem open)');
  const block = p.ssr.slice(i2, p.ssr.indexOf('</details>', i2));
  assert.ok(block.includes(`<summary><h2>Procurar em outras lojas (${Math.min(12, 6 + K)})</h2></summary>`)); assert.match(block, /Preços não lidos pelo Hunter — confira na loja\./);
  assert.doesNotMatch(block, /R\$/);
  const a = anchors(block); assert.equal(a.length, Math.min(12, 6 + K));
  for (const x of a) { assert.equal(x.rel, 'nofollow noopener'); assert.equal(x.target, '_blank'); assert.ok(/Escurid%C3%A3o%20Absoluta%20Blister%20Triplo|Escurid%C3%A3o\+Absoluta\+Blister\+Triplo|escuridao-absoluta-blister-triplo/.test(x.href) || OF.some((id) => LOJAS_CFG.lojasOficiais[id].url === x.href), x.href); }
  assert.deepEqual(a.slice(0, 4).map((x) => x.href), ['https://lista.mercadolivre.com.br/escuridao-absoluta-blister-triplo', 'https://www.amazon.com.br/s?k=Escurid%C3%A3o+Absoluta+Blister+Triplo',
    'https://shopee.com.br/search?keyword=Escurid%C3%A3o%20Absoluta%20Blister%20Triplo', 'https://www.magazineluiza.com.br/busca/Escurid%C3%A3o%20Absoluta%20Blister%20Triplo/']);
  assert.ok(a.some((x) => x.href.startsWith('https://eps.com.br/search?q=')) && a.some((x) => x.href.startsWith('https://www.kalunga.com.br/busca/1?q=')));
  assert.ok(!a.some((x) => x.href.startsWith('https://www.alfa.com.br')), 'loja monitorada não entra (já está em Onde comprar)');
  assert.ok(!a.some((x) => /tag=/.test(x.href)), 'sem tag de afiliado');
  assert.equal((p.ssr.match(/<h1[ >]/g) || []).length, 1);
  // Com 12+ lojas não monitoradas com busca: corta em 12.
  const many = Array.from({ length: 15 }, (_, i) => src('loja' + i, 'BLOCKED', `https://loja${i}.com.br`, { platform: 'shopify' }));
  const o2 = render([Q[1]], { ...state, sources: [...SOURCES, ...many] });
  const b2 = parse(o2[Q[1]].body).ssr; const k = b2.indexOf('<details class="more outras">'); const blk = b2.slice(k, b2.indexOf('</details>', k));
  assert.equal(anchors(blk).length, 12); assert.match(blk, /Procurar em outras lojas \(12\)/);
});

await t('5. sitemap tem /lojas; vercel.json reescreve /lojas e leva config/stores.json na função; sem dados em dia a página sai sem conteúdo e noindex', () => {
  assert.match(out.sitemap, /<loc>https:\/\/tcgpricehunter.com.br\/lojas<\/loc>/);
  const v = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  assert.equal(Object.fromEntries(v.rewrites.map((r) => [r.source, r.destination]))['/lojas'], '/api/pagina?t=lojas');
  assert.match(v.functions['api/pagina.mjs'].includeFiles, /index\.html/); assert.match(v.functions['api/pagina.mjs'].includeFiles, /config\/stores\.json/, 'a função leva a config junto');
  assert.ok(!v.headers.some((h) => /lojas/.test(h.source) && h.headers.some((x) => x.key === 'X-Robots-Tag')), '/lojas é indexável');
  const old = render(['t=lojas'], { ...state, generatedAt: new Date(NOW - 5 * 3600e3).toISOString() });
  assert.equal(parse(old['t=lojas'].body).noindex, true); assert.equal(parse(old['t=lojas'].body).ssr, '');
});

await t('6. site (index.html): rota /lojas, título, menu Mais, rodapé, redirecionamento antigo removido; LOJAS_CFG e lojasNormalize iguais ao módulo', () => {
  assert.match(html, /const ROUTES=\{[^\n]*lojas:"lojas"/); assert.match(html, /const PATHS=\{[^\n]*lojas:"lojas"/); assert.match(html, /const TITLES=\{[^\n]*lojas:"Lojas de Pokémon TCG no Brasil"/);
  assert.match(html, /view==="lojas"\)renderLojas\(\)/); assert.match(html, /<button type="button" data-go="lojas">/); assert.match(html, /<a href="\/lojas" data-go="lojas">Lojas<\/a>/);
  assert.doesNotMatch(html, /página Lojas foi retirada/); assert.match(html, /OLDHASH=\{[^\n]*lojas:"lojas"/);
  assert.match(html, /\$\{outrasLojasBlock\(p\)\}\s*<div id="pp-amz">/, 'bloco do produto logo abaixo de Onde comprar');
  assert.match(html, /\[data-oppstore\]/, 'Ver ofertas abre Oportunidades filtrada pela loja');
  const m = html.match(/^const LOJAS_CFG=(\{.*\});$/m); assert.ok(m, 'const LOJAS_CFG=... numa linha só');
  const a = html.indexOf('/* Frente 7: lojas (dados)'), b = html.indexOf('/* Frente 7: lojas (telas)');
  assert.ok(a > 0 && b > a);
  const ctx = vm.createContext({ live: (o) => o.stock === 'IN_STOCK' && !o.stale && !o.anomalous && o.total > 0, URL, encodeURIComponent });
  vm.runInContext(html.slice(a, b) + ';globalThis.__ = { LOJAS_CFG, lojasNormalize, outrasLojas, ljSearchUrl };', ctx);
  const spa = ctx.__;
  assert.deepEqual(JSON.parse(JSON.stringify(spa.LOJAS_CFG)), JSON.parse(JSON.stringify(LOJAS_CFG)));
  const mine = spa.lojasNormalize({ sources: SOURCES, offers: O });
  assert.deepEqual(JSON.parse(JSON.stringify(mine)), JSON.parse(JSON.stringify(L)), 'mesma lista no site e no servidor');
  assert.deepEqual(JSON.parse(JSON.stringify(spa.outrasLojas(mine, 'Escuridão Absoluta Blister Triplo'))), JSON.parse(JSON.stringify(outrasLojas(L, 'Escuridão Absoluta Blister Triplo'))));
  assert.equal(spa.ljSearchUrl(mine[0], 'ETB Alfa'), searchUrlFor(L[0], 'ETB Alfa'));
  const fn = html.slice(b, html.indexOf('function renderLegal(kind){'));
  assert.match(fn, /rel="noopener nofollow"/); assert.match(fn, /Buscar Pokémon na loja/); assert.match(fn, /Preços não lidos pelo Hunter — confira na loja\./); assert.doesNotMatch(fn, /fora do ar/);
  assert.match(fn, /matchMedia\("\(min-width:860px\)"\)\.matches\?" open":""/, 'fechado no celular, aberto no desktop');
});

console.log(`✓ Lojas (Frente 7): ${n} grupos de testes passaram`);
