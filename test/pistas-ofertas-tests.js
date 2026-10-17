// Pista do Mercado Livre vira oferta (src/pistas-ofertas.js): resolução do meli.la, conferência na API oficial com
// fetch falso, formato da oferta igual ao do adaptador do ML, recusas com motivo, seleção com teto e revalidação,
// dedupe com oferta existente e kill switch na rodada. Sem rede e sem banco.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/catalog.json'), 'utf8'));
const { mlbDeUrl, mlbDeLink, verificarPista, pistasParaVerificar, ofertaDuplicada, registroDeOferta, verificarPistas, ehLinkML, SOURCE_TYPE } = await import('../src/pistas-ofertas.js');
const { validateListing } = await import('../src/adapters/contract.js');

const t = async (name, fn) => { try { await fn(); } catch (e) { e.message = `${name}: ${e.message}`; throw e; } };
const now = new Date('2026-10-16T12:00:00Z');
const PERMALINK = 'https://produto.mercadolivre.com.br/MLB-4012345678-box-booster-pokemon-caos-ascendente-_JM';
const ITEM = {
  id: 'MLB4012345678', title: 'Box Booster Pokémon Caos Ascendente ME04 36 Pacotes Copag Lacrado', price: 480, original_price: 599.9,
  status: 'active', condition: 'new', available_quantity: 7, permalink: PERMALINK, seller_id: 123, official_store_id: null,
  thumbnail: 'http://http2.mlstatic.com/D_1-O.jpg', pictures: [{ url: 'http://http2.mlstatic.com/D_1-F.jpg', secure_url: 'https://http2.mlstatic.com/D_1-F.jpg' }], shipping: { free_shipping: true },
};
const USER = { id: 123, nickname: 'LOJA_TCG', seller_reputation: { level_id: '5_green', transactions: { completed: 900 } } };
const tip = { id: 'abc', productId: 'me04-box36', price: 470, url: 'https://meli.la/1WWyH25', postUrl: 'https://t.me/mecpromo/499', matchConfidence: 0.8, discount: 0.2, postedAt: '2026-10-16T09:00:00+00:00' };

const resp = (status, body, headers = {}) => ({ status, ok: status >= 200 && status < 300, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, json: async () => body, url: '' });
// fetch falso: encurtador → página do anúncio (2 saltos) e API de itens/usuários; registra as chamadas e o que foi enviado
function fakeFetch({ item = ITEM, user = USER, itemStatus = 200, userStatus = 200, hops = ['https://www.mercadolivre.com.br/sec/abc', PERMALINK] } = {}) {
  const calls = [];
  const f = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (url.startsWith('https://meli.la/')) return resp(301, null, { location: hops[0] });
    if (url === hops[0]) return resp(302, null, { location: hops[1] });
    if (url.startsWith('https://api.mercadolibre.com/items/')) return resp(itemStatus, item);
    if (url.startsWith('https://api.mercadolibre.com/users/')) return resp(userStatus, user);
    return resp(200, '<html>');
  };
  f.calls = calls; return f;
}

await t('mlbDeUrl: id do anúncio em várias formas; /p/MLB… (catálogo) só vale com item_id', () => {
  assert.equal(mlbDeUrl(PERMALINK), 'MLB4012345678');
  assert.equal(mlbDeUrl('https://www.mercadolivre.com.br/p/MLB19887654?pdp_filters=item_id%3AMLB4012345678'), 'MLB4012345678');
  assert.equal(mlbDeUrl('https://www.mercadolivre.com.br/p/MLB19887654'), null, 'id de catálogo não é anúncio');
  assert.equal(mlbDeUrl('https://meli.la/1WWyH25'), null);
  assert.equal(ehLinkML('https://meli.la/1WWyH25'), true); assert.equal(ehLinkML(PERMALINK), true);
  assert.equal(ehLinkML('https://s.shopee.com.br/abc'), false); assert.equal(ehLinkML('https://www.mercadolivre.com.br/p/MLB19887654'), true, 'catálogo /p/ agora é conferido pelo buy box');
});

await t('mlbDeLink: segue só o cabeçalho Location (redirect manual) e para assim que a URL traz o MLB', async () => {
  const f = fakeFetch();
  assert.equal(await mlbDeLink('https://meli.la/1WWyH25', { fetch: f }), 'MLB4012345678');
  assert.deepEqual(f.calls.map((c) => c.url), ['https://meli.la/1WWyH25', 'https://www.mercadolivre.com.br/sec/abc'], 'a página do anúncio não é baixada');
  for (const c of f.calls) { assert.equal(c.opts.redirect, 'manual'); assert.ok(c.opts.signal, 'com timeout'); }
  assert.equal(await mlbDeLink(PERMALINK, { fetch: f }), 'MLB4012345678', 'URL já com MLB não vai à rede');
  let n = 0; const loop = async () => { n++; return resp(302, null, { location: 'https://www.mercadolivre.com.br/sec/' + n }); };
  assert.equal(await mlbDeLink('https://meli.la/x', { fetch: loop }), null, 'máximo de saltos');
  assert.ok(n <= 4, `no máximo 3 saltos depois do primeiro (${n} chamadas)`);
  assert.equal(await mlbDeLink('https://meli.la/x', { fetch: async () => { throw new Error('rede'); } }), null, 'falha de rede → null, sem lançar');
  assert.equal(await mlbDeLink('https://meli.la/x', { fetch: async () => resp(301, null, { location: 'http://127.0.0.1/x' }) }), null, 'destino privado é recusado');
});

await t('verificarPista: anúncio ativo, novo, com estoque e mesmo produto → oferta no formato do adaptador do ML', async () => {
  const f = fakeFetch();
  const r = await verificarPista(tip, { fetch: f, token: 'TOKEN-SECRETO', catalog, now });
  assert.equal(r.ok, true, r.motivo); assert.equal(r.mlb, 'MLB4012345678');
  const o = r.oferta;
  assert.equal(o.storeId, 'mercadolivre'); assert.equal(o.storeName, 'Mercado Livre'); assert.equal(o.sourceType, 'pista_verificada');
  assert.equal(o.url, PERMALINK); assert.deepEqual(o.price, { base: 480 }); assert.equal(o.listPrice, 599.9);
  assert.equal(o.stock, 'IN_STOCK'); assert.equal(o.quantity, 7); assert.equal(o.stockSource, 'ml-api-item');
  assert.equal(o.image, 'https://http2.mlstatic.com/D_1-F.jpg'); assert.equal(o.shipping, 0); assert.equal(o.sku, 'MLB4012345678');
  assert.equal(o.seller, 'LOJA_TCG'); assert.equal(o.sellerId, '123'); assert.equal(o.sellerKind, 'marketplace_seller');
  assert.equal(o.source_url, 'https://t.me/mecpromo/499'); assert.equal(o.source_timestamp, now.toISOString());
  assert.equal(o.matchConfidence, 0.8); assert.equal(o.confirmed, true); assert.equal(o.pista, 'abc');
  assert.equal(r.produto.id, 'me04-box36');
  const api = f.calls.find((c) => c.url === 'https://api.mercadolibre.com/items/MLB4012345678');
  assert.equal(api.opts.headers.authorization, 'Bearer TOKEN-SECRETO');
  assert.ok(!JSON.stringify(r).includes('TOKEN-SECRETO'), 'o token nunca sai no resultado');
  const v = validateListing({ ...o, productId: 'me04-box36' }, { id: 'mercadolivre', url: 'https://api.mercadolibre.com', platform: 'mercadolivre' }, { now });
  assert.equal(v.ok, true, JSON.stringify(v.reasons));
  const reg = registroDeOferta({ ...o, productId: 'me04-box36', boosters: 36 }, { id: 'x1', T: now.toISOString() });
  assert.equal(reg.total, 480); assert.equal(reg.priceKind, 'base'); assert.equal(reg.perBooster, 13.33); assert.equal(reg.shippingKnown, true); assert.equal(reg.stale, false); assert.equal(reg.firstSeen, now.toISOString());
});

await t('verificarPista: loja oficial dispensa reputação; thumbnail http vira https', async () => {
  const f = fakeFetch({ item: { ...ITEM, official_store_id: 55, official_store_name: 'Pokémon Oficial', pictures: [] }, userStatus: 500 });
  const r = await verificarPista(tip, { fetch: f, token: 'T', catalog, now });
  assert.equal(r.ok, true, r.motivo); assert.equal(r.oferta.sellerKind, 'official_store'); assert.equal(r.oferta.seller, 'Pokémon Oficial');
  assert.equal(r.oferta.image, 'https://http2.mlstatic.com/D_1-O.jpg');
});

await t('verificarPista: recusas com motivo (usado, pausado, sem estoque, preço subiu, outro produto, 404, vendedor, sem token)', async () => {
  const caso = async (over, extra = {}) => (await verificarPista(tip, { fetch: fakeFetch({ item: { ...ITEM, ...over }, ...extra }), token: 'T', catalog, now }));
  let r = await caso({ condition: 'used' }); assert.equal(r.ok, false); assert.equal(r.motivo, 'usado'); assert.equal(r.oferta, null);
  r = await caso({ status: 'paused' }); assert.equal(r.ok, false); assert.equal(r.motivo, 'status paused');
  r = await caso({ available_quantity: 0 }); assert.equal(r.ok, false); assert.equal(r.motivo, 'sem estoque');
  r = await caso({ price: 530 }); assert.equal(r.ok, false); assert.match(r.motivo, /^preço subiu/);
  r = await caso({ price: 517 }); assert.equal(r.ok, true, 'até 10% acima ainda é a mesma promoção');
  r = await caso({ title: 'Blister Triplo Pokémon Caos Ascendente ME04 Copag' }); assert.equal(r.ok, false); assert.equal(r.motivo, 'outro produto');
  r = await caso({}, { itemStatus: 404 }); assert.equal(r.ok, false); assert.equal(r.motivo, 'anúncio não encontrado');
  r = await caso({}, { itemStatus: 403 }); assert.equal(r.ok, false); assert.equal(r.motivo, 'API do ML recusou (403)');
  r = await caso({}, { user: { ...USER, seller_reputation: { level_id: '1_red', transactions: { completed: 3 } } } }); assert.equal(r.ok, false); assert.equal(r.motivo, 'vendedor sem reputação');
  r = await caso({}, { userStatus: 500 }); assert.equal(r.ok, false); assert.equal(r.motivo, 'reputação do vendedor indisponível');
  r = await verificarPista(tip, { fetch: fakeFetch(), token: null, catalog, now }); assert.equal(r.ok, false); assert.equal(r.motivo, 'sem token do Mercado Livre');
  r = await verificarPista({ ...tip, url: 'https://s.shopee.com.br/abc' }, { fetch: async () => resp(200, '<html>'), token: 'T', catalog, now }); assert.equal(r.ok, false); assert.equal(r.motivo, 'link sem MLB');
  r = await verificarPista(tip, { fetch: async () => { throw Object.assign(new Error('x'), { code: 'ECONNRESET' }); }, token: 'T', catalog, now }); assert.equal(r.ok, false); assert.match(r.motivo, /falha de rede/);
});

await t('pistasParaVerificar: só ML vivas (identificadas primeiro), maior desconto primeiro, com teto e revalidação', () => {
  const T = (minAgo) => new Date(now.getTime() - minAgo * 60e3).toISOString();
  const store = {
    a: { ...tip, id: 'a', discount: 0.10 },
    b: { ...tip, id: 'b', discount: 0.30 },
    c: { ...tip, id: 'c', discount: 0.20, url: PERMALINK },
    semProduto: { ...tip, id: 'semProduto', productId: null },
    shopee: { ...tip, id: 'shopee', url: 'https://s.shopee.com.br/x' },
    expirada: { ...tip, id: 'expirada', expired: true },
    anomala: { ...tip, id: 'anomala', anomalous: true },
    semPreco: { ...tip, id: 'semPreco', price: null },
    recente: { ...tip, id: 'recente', discount: 0.5, verificada: { at: T(10), ok: true } },
    antiga: { ...tip, id: 'antiga', discount: 0.4, verificada: { at: T(90), ok: true } },
    definitiva: { ...tip, id: 'definitiva', discount: 0.9, verificada: { at: T(500), ok: false, motivo: 'usado', versao: 3 } },
    definitivaV1: { ...tip, id: 'definitivaV1', discount: 0.01, verificada: { at: T(500), ok: false, motivo: 'link sem MLB' } },
    recusaTemporaria: { ...tip, id: 'recusaTemporaria', discount: 0.35, verificada: { at: T(120), ok: false, motivo: 'sem estoque' } },
  };
  assert.deepEqual(pistasParaVerificar(store, { now }).map((x) => x.id), ['antiga', 'recusaTemporaria', 'b', 'c', 'a', 'definitivaV1', 'semProduto']);
  assert.deepEqual(pistasParaVerificar(store, { now, max: 2 }).map((x) => x.id), ['antiga', 'recusaTemporaria']);
  assert.deepEqual(pistasParaVerificar(store, { now, revalidarMin: 5 }).map((x) => x.id), ['recente', 'antiga', 'recusaTemporaria', 'b', 'c', 'a', 'definitivaV1', 'semProduto']);
  assert.deepEqual(pistasParaVerificar({}, { now }), []); assert.deepEqual(pistasParaVerificar(null, { now }), []);
});

await t('ofertaDuplicada: mesma URL ou mesmo MLB (sku ou link) de oferta do ML já publicada', () => {
  const oferta = { url: PERMALINK, storeId: 'mercadolivre' };
  assert.equal(ofertaDuplicada(oferta, { x: { id: 'x', storeId: 'mercadolivre', url: PERMALINK, sourceType: 'official_api' } }), 'x');
  assert.equal(ofertaDuplicada(oferta, { y: { id: 'y', storeId: 'mercadolivre', url: 'https://www.mercadolivre.com.br/p/MLB19887654?pdp_filters=item_id%3AMLB4012345678', sku: 'MLB4012345678', sourceType: 'official_api' } }), 'y');
  assert.equal(ofertaDuplicada(oferta, { z: { id: 'z', storeId: 'mercadolivre', url: 'https://www.mercadolivre.com.br/p/MLB19887654?pdp_filters=item_id%3AMLB9999999999', sku: 'MLB9999999999', sourceType: 'official_api' } }), null);
  assert.equal(ofertaDuplicada(oferta, { w: { id: 'w', storeId: 'lojaa', url: PERMALINK } }), null, 'outra loja não conta');
  assert.equal(ofertaDuplicada(oferta, { p: { id: 'p', storeId: 'mercadolivre', url: PERMALINK, sourceType: SOURCE_TYPE } }), null, 'oferta de pista anterior não bloqueia a própria pista');
});

await t('verificarPistas: anota verificada { at, ok, motivo, mlb } em cada pista, mantém o teto e nunca lança', async () => {
  const store = { a: { ...tip, id: 'a', discount: 0.3 }, b: { ...tip, id: 'b', discount: 0.2, url: 'https://meli.la/quebrado' }, c: { ...tip, id: 'c', discount: 0.1 } };
  const f = fakeFetch(); const base = f;
  const fetch = async (url, o) => { if (url === 'https://meli.la/quebrado') throw new Error('rede'); return base(url, o); };
  const logs = []; const out = await verificarPistas(store, { fetch, token: 'T', catalog, now, max: 2, log: (m) => logs.push(m) });
  assert.deepEqual(out.map((x) => x.tip.id), ['a']); assert.equal(out[0].oferta.productId, 'me04-box36');
  assert.deepEqual(store.a.verificada, { at: now.toISOString(), ok: true, motivo: null, mlb: 'MLB4012345678', ofertaId: null, versao: 3 });
  assert.equal(store.b.verificada.ok, false); assert.equal(store.b.verificada.motivo, 'falha de rede (rede)', 'encurtador fora do ar não é "link sem MLB": tenta de novo depois'); assert.ok(logs.some((l) => /\[pistas\] b/.test(l)));
  assert.equal(store.c.verificada, undefined, 'fora do teto: fica para a próxima rodada');
});

// ------------------------------------------------------------ rodada completa (src/run.js) com adaptadores e fetch falsos
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pistas-ofertas-'));
const dataDir = path.join(tmp, 'data'); const cfgDir = path.join(tmp, 'config');
fs.mkdirSync(dataDir, { recursive: true }); fs.mkdirSync(path.join(cfgDir, 'alertas'), { recursive: true });
const w = (d, f, v) => fs.writeFileSync(path.join(d, f), JSON.stringify(v));
w(cfgDir, 'catalog.json', catalog);
w(cfgDir, 'stores.json', { stores: [{ id: 'mercadolivre', name: 'Mercado Livre', url: 'https://api.mercadolibre.com', platform: 'mercadolivre', kind: 'marketplace', evidence: {} }] });
w(cfgDir, 'watchlist.json', { settings: {}, rules: [] });
w(cfgDir, 'pistas.json', { pelando: { buscas: [] }, telegram: [], descontoMinimoAlerta: 0.15, horasMaximas: 72 });
w(cfgDir, 'matching-overrides.json', {});
const tipFile = () => JSON.parse(fs.readFileSync(path.join(dataDir, 'tips.json'), 'utf8'));
w(dataDir, 'tips.json', { abc: { ...tip, firstSeen: '2026-10-16T09:05:00.000Z', lastSeen: '2026-10-16T11:45:00.000Z', postedAt: '2026-10-16T09:00:00+00:00', source: 'Telegram mecpromo', title: 'Box Caos Ascendente', text: 'Box Caos Ascendente R$ 470' },
  shp: { ...tip, id: 'shp', url: 'https://s.shopee.com.br/x', firstSeen: '2026-10-16T09:05:00.000Z', lastSeen: '2026-10-16T11:45:00.000Z', source: 'Telegram mecpromo', title: 'Box', text: 'Box R$ 470' } });

const keep = Object.fromEntries(['HUNTER_CONFIG_DIR', 'HUNTER_DATA_DIR', 'HUNTER_TIPS', 'PISTAS_OFERTAS', 'PISTAS_VERIFICAR_MAX', 'ML_ACCESS_TOKEN', 'HUNTER_DOMAIN_DELAY_MS', 'TELEGRAM_BOT_TOKEN', 'DATABASE_URL', 'HUNTER_OPPORTUNITY_URL'].map((k) => [k, process.env[k]]));
process.env.HUNTER_CONFIG_DIR = cfgDir; process.env.HUNTER_DATA_DIR = dataDir; process.env.HUNTER_DOMAIN_DELAY_MS = '0';
delete process.env.HUNTER_TIPS; delete process.env.TELEGRAM_BOT_TOKEN; delete process.env.DATABASE_URL; delete process.env.HUNTER_OPPORTUNITY_URL;
process.env.ML_ACCESS_TOKEN = 'TOKEN-DE-TESTE';
const { adapters } = await import('../src/adapters/index.js');
const http = await import('../src/http.js');
let mlListings = []; const origMl = adapters.mercadolivre;
adapters.mercadolivre = { ...origMl, search: async () => mlListings };   // adaptador do ML falso (sem rede)
const { runOnce } = await import('../src/run.js');
process.env.PISTAS_DESTINO = '0';   // destino limpo das pistas tem teste próprio (pistas-destino-tests.js); aqui só a verificação na API
const quiet = () => {}; const send = { telegram: async () => {}, email: async () => {}, push: async () => {} };
const realFetch = globalThis.fetch;
const offersFile = () => JSON.parse(fs.readFileSync(path.join(dataDir, 'offers.json'), 'utf8'));
try {
  await t('rodada: PISTAS_OFERTAS=0 desliga (nenhuma chamada, pista sem verificada)', async () => {
    process.env.PISTAS_OFERTAS = '0'; let hits = 0;
    globalThis.fetch = async (u, o) => { hits++; return fakeFetch()(u, o); };
    const s = await runOnce({ log: quiet, send, now });
    assert.equal(hits, 0); assert.equal(s.offers.length, 0); assert.equal(tipFile().abc.verificada, undefined);
  });
  await t('rodada: pista do ML conferida vira oferta normal do Mercado Livre (ranking, Copag, estado) e a pista ganha virouOferta', async () => {
    delete process.env.PISTAS_OFERTAS;
    globalThis.fetch = fakeFetch();
    const s = await runOnce({ log: quiet, send, now: new Date(now.getTime() + 60e3) });
    const o = s.offers.find((x) => x.sourceType === 'pista_verificada');
    assert.ok(o, 'oferta publicada no state'); assert.equal(o.storeId, 'mercadolivre'); assert.equal(o.productId, 'me04-box36'); assert.equal(o.url, PERMALINK);
    assert.equal(o.stock, 'IN_STOCK'); assert.equal(o.stockSource, 'ml-api-item'); assert.equal(o.total, 480); assert.equal(o.confirmed, true); assert.equal(o.source_url, 'https://t.me/mecpromo/499');
    assert.ok('storeScore' in o && 'storeValidated' in o, 'pontuada como qualquer oferta'); assert.ok(s.products.some((p) => p.id === 'me04-box36'), 'produto registrado');
    const tf = tipFile();
    assert.equal(tf.abc.virouOferta, o.id); assert.equal(tf.abc.verificada.ok, true); assert.equal(tf.abc.verificada.ofertaId, o.id); assert.equal(tf.abc.verificada.mlb, 'MLB4012345678');
    assert.equal(tf.shp.verificada, undefined, 'Shopee continua só pista');
    const st = s.tips.find((x) => x.id === 'abc'); assert.equal(st.virouOferta, o.id, 'state.tips carrega virouOferta');
    assert.equal(offersFile()[o.id].sourceType, 'pista_verificada');
    assert.ok(!fs.readFileSync(path.join(dataDir, 'tips.json'), 'utf8').includes('TOKEN-DE-TESTE'));
  });
  await t('rodada seguinte (dentro da revalidação): oferta segue publicada sem nova consulta à API', async () => {
    let apiHits = 0; const f = fakeFetch(); globalThis.fetch = async (u, o) => { if (/api\.mercadolibre\.com/.test(u)) apiHits++; return f(u, o); };
    const s = await runOnce({ log: quiet, send, now: new Date(now.getTime() + 10 * 60e3) });
    assert.equal(apiHits, 0); const o = s.offers.find((x) => x.sourceType === 'pista_verificada'); assert.ok(o); assert.equal(o.stale, false); assert.equal(o.confirmed, true);
  });
  await t('dedupe: adaptador do ML já publica o mesmo anúncio → sem duplicata, pista só aponta para a oferta', async () => {
    mlListings = [{ title: ITEM.title, url: PERMALINK, price: { base: 480 }, listPrice: null, stock: 'IN_STOCK', quantity: 7, shipping: 0, sku: 'MLB4012345678', ean: null, image: 'https://http2.mlstatic.com/D_1-F.jpg', seller: 'LOJA_TCG', sellerId: 123, sellerKind: 'marketplace_seller', sourceType: 'official_api' }];
    globalThis.fetch = fakeFetch();
    const s = await runOnce({ log: quiet, send, now: new Date(now.getTime() + 90 * 60e3) });
    const ml = s.offers.filter((x) => x.storeId === 'mercadolivre');
    assert.equal(ml.length, 1); assert.equal(ml[0].sourceType, 'official_api');
    assert.equal(tipFile().abc.virouOferta, ml[0].id);
    mlListings = [];
  });
  await t('revalidação falhou (preço subiu): oferta sai, pista perde virouOferta e guarda o motivo', async () => {
    globalThis.fetch = fakeFetch({ item: { ...ITEM, price: 999 } });
    const s = await runOnce({ log: quiet, send, now: new Date(now.getTime() + 200 * 60e3) });
    assert.equal(s.offers.filter((x) => x.sourceType === 'pista_verificada').length, 0);
    assert.ok(s.offers.every((x) => x.storeId !== 'mercadolivre' || x.stale), 'a leitura antiga do adaptador fica como não confirmada (regra de sempre), nunca como oferta viva');
    const tf = tipFile(); assert.equal(tf.abc.virouOferta, undefined); assert.equal(tf.abc.verificada.ok, false); assert.match(tf.abc.verificada.motivo, /preço subiu/);
  });
  await t('sem token: não consulta e não derruba a rodada', async () => {
    delete process.env.ML_ACCESS_TOKEN; let hits = 0;
    globalThis.fetch = async (u, o) => { hits++; return fakeFetch()(u, o); };
    const logs = []; await runOnce({ log: (m) => logs.push(String(m)), send, now: new Date(now.getTime() + 400 * 60e3) });
    assert.equal(hits, 0); assert.ok(logs.some((l) => /\[pistas\] sem token/.test(l)), logs.join('\n'));
  });
} finally {
  globalThis.fetch = realFetch; adapters.mercadolivre = origMl;
  for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  void http;
}

console.log('pistas-ofertas-tests: ok');
