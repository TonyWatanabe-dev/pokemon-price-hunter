// Lote 7 — integridade dos coletores (testes offline, fetch simulado, sem rede nem banco).
// 1) JSON-LD: falha transitória de página não remove oferta; página nova que falhou é lida de novo; página lida e
//    não relevante é relida depois do intervalo. 2) Restock falso depois de falha. 3) Frete VTEX que falha não vira
//    queda de preço. 4) Mercado Livre: cache do catálogo, falha sinalizada, estoque não verificado e vigia.
//    5) Anúncio "Case" (várias unidades) não casa com produto unitário.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.HUNTER_DOMAIN_DELAY_MS = '0'; process.env.HUNTER_TIPS = '0';
for (const k of ['DATABASE_URL', 'TELEGRAM_BOT_TOKEN', 'NTFY_TOPIC', 'HUNTER_CEP', 'ML_CLIENT_SECRET', 'ML_ACCESS_TOKEN']) delete process.env[k];
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'config/catalog.json'), 'utf8'));

const http = await import('../src/http.js');
const { runOnce, jsonldPlan } = await import('../src/run.js');
const { matchProduct } = await import('../src/match.js');
const { comparable } = await import('../src/offer-compare.js');
const { evaluate } = await import('../src/ops-watch.js');
const { watchedSummary } = await import('../src/opstate.js');
const { compose } = await import('../src/alerts.js');

let groups = 0;
const t = async (name, fn) => { try { await fn(); groups++; } catch (e) { console.error('✗ ' + name); throw e; } };
const html = (s, status = 200) => new Response(s, { status, headers: { 'content-type': 'text/html' } });
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const brl = (v) => Number(v).toFixed(2).replace('.', ',');
const page = (name, price, avail = 'InStock') => html(`<html><head><title>${name}</title><script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name, offers: { '@type': 'Offer', price, priceCurrency: 'BRL', availability: 'https://schema.org/' + avail } })}</script></head><body><h1>${name}</h1><p>R$ ${brl(price)}</p></body></html>`);
const notProduct = () => html('<html><head><title>Blog</title></head><body>Como guardar cartas</body></html>');

/** Cenário isolado: pastas próprias de config/data, lojas e regras de alerta. Cada cenário usa hosts próprios (robots.txt fica em cache por host). */
function scenario(stores, rules = []) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lote7-'));
  process.env.HUNTER_CONFIG_DIR = path.join(tmp, 'config'); process.env.HUNTER_DATA_DIR = path.join(tmp, 'data');
  fs.mkdirSync(process.env.HUNTER_CONFIG_DIR, { recursive: true }); fs.mkdirSync(process.env.HUNTER_DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'config/catalog.json'), JSON.stringify(catalog));
  fs.writeFileSync(path.join(tmp, 'config/stores.json'), JSON.stringify({ stores }));
  fs.writeFileSync(path.join(tmp, 'config/watchlist.json'), JSON.stringify({ settings: { cooldownHours: 6, minDropPct: 0.01 }, rules }));
  const msgs = [];
  const send = { cap: async (m) => { msgs.push(m); return true; } };
  const data = (f) => JSON.parse(fs.readFileSync(path.join(tmp, 'data', f), 'utf8'));
  const hist = () => { try { return fs.readFileSync(path.join(tmp, 'data/history.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
  const T0 = Date.parse('2026-10-01T12:00:00Z');
  const run = (min) => runOnce({ log: () => {}, send, now: new Date(T0 + min * 60e3) });
  return { tmp, msgs, data, hist, run };
}

// ============ 1. JSON-LD ============
await t('1a. página nova que falha na 1ª visita é lida de novo na rodada seguinte', async () => {
  const URL1 = 'https://ld1.test/pokemon-blister-triplo-caos-ascendente';
  let up = false; let hits = 0;
  http.setFetch(async (url) => { const u = new URL(url);
    if (u.pathname === '/robots.txt') return html('', 404);
    if (u.pathname === '/sitemap.xml') return html(`<urlset><url><loc>${URL1}</loc></url></urlset>`);
    if (url === URL1) { hits++; return up ? page('Pokémon Blister Triplo Caos Ascendente Copag', '39.90') : html('erro', 503); }
    return html('', 404); });
  const S = scenario([{ id: 'ld1', name: 'LD1', url: 'https://ld1.test', platform: 'jsonld', kind: 'specialist', evidence: {} }]);
  let s = await S.run(0);
  assert.equal(s.offers.length, 0);
  const src = s.sources.find((x) => x.id === 'ld1');
  assert.equal(src.pageFailures, 1, 'falha de página fica registrada na fonte');
  assert.ok(!S.data('url-cache.json').ld1.visited.includes(URL1), 'página que falhou não conta como visitada');
  up = true;
  s = await S.run(15);
  assert.equal(s.offers.length, 1, 'a página volta a ser lida e a oferta aparece');
  assert.equal(hits, 2);
});

await t('1b. página relevante que falha uma rodada: oferta fica stale (não removed) e volta depois', async () => {
  const URL1 = 'https://ld2.test/pokemon-blister-triplo-caos-ascendente';
  let up = true;
  http.setFetch(async (url) => { const u = new URL(url);
    if (u.pathname === '/robots.txt') return html('', 404);
    if (u.pathname === '/sitemap.xml') return html(`<urlset><url><loc>${URL1}</loc></url></urlset>`);
    if (url === URL1) return up ? page('Pokémon Blister Triplo Caos Ascendente Copag', '39.90') : html('erro', 503);
    return html('', 404); });
  const S = scenario([{ id: 'ld2', name: 'LD2', url: 'https://ld2.test', platform: 'jsonld', kind: 'specialist', evidence: {} }],
    [{ id: 'rs', label: 'restock', filter: { productId: 'me04-blister3' }, restock: true }]);
  await S.run(0); await S.run(15);
  up = false;
  let s = await S.run(30);
  const o = s.offers.find((x) => x.storeId === 'ld2');
  assert.ok(o, 'oferta continua no estado'); assert.equal(o.stale, true); assert.equal(o.stock, 'UNKNOWN'); assert.equal(o.lastKnownStock, 'IN_STOCK');
  assert.ok(!S.hist().some((h) => h.event === 'removed'), 'falha transitória não gera "removed"');
  assert.ok(S.data('url-cache.json').ld2.relevant.includes(URL1), 'página continua relevante');
  up = true;
  s = await S.run(45);
  const back = s.offers.find((x) => x.storeId === 'ld2');
  assert.equal(back.stale, false); assert.equal(back.stock, 'IN_STOCK');
  assert.equal(S.msgs.filter((m) => /RESTOCK/.test(m.title)).length, 0, 'voltar depois de falha não é restock');
});

await t('1c. página lida e não relevante é relida depois do intervalo (24 h), não antes', async () => {
  const URL1 = 'https://ld3.test/pokemon-blister-triplo-caos-ascendente';
  let isProduct = false; let hits = 0;
  http.setFetch(async (url) => { const u = new URL(url);
    if (u.pathname === '/robots.txt') return html('', 404);
    if (u.pathname === '/sitemap.xml') return html(`<urlset><url><loc>${URL1}</loc></url></urlset>`);
    if (url === URL1) { hits++; return isProduct ? page('Pokémon Blister Triplo Caos Ascendente Copag', '39.90') : notProduct(); }
    return html('', 404); });
  const S = scenario([{ id: 'ld3', name: 'LD3', url: 'https://ld3.test', platform: 'jsonld', kind: 'specialist', evidence: {} }]);
  let s = await S.run(0);
  assert.equal(s.offers.length, 0); assert.equal(hits, 1);
  isProduct = true;
  s = await S.run(60);
  assert.equal(hits, 1, 'antes de 24 h a página não relevante não é relida'); assert.equal(s.offers.length, 0);
  s = await S.run(24 * 60 + 5);
  assert.equal(hits, 2, 'depois de 24 h é relida'); assert.equal(s.offers.length, 1, 'e o produto que passou a existir entra');
});

await t('1d. página nova que falha 3 vezes vira visitada e só volta depois do intervalo; 404 é definitivo', async () => {
  const URL1 = 'https://ld4.test/pokemon-blister-triplo-caos-ascendente';
  const URL2 = 'https://ld4.test/pokemon-blister-duplo-caos-ascendente';
  let hits = 0; let gone = false;
  http.setFetch(async (url) => { const u = new URL(url);
    if (u.pathname === '/robots.txt') return html('', 404);
    if (u.pathname === '/sitemap.xml') return html(`<urlset><url><loc>${URL1}</loc></url><url><loc>${URL2}</loc></url></urlset>`);
    if (url === URL1) { hits++; return html('erro', 503); }
    if (url === URL2) return gone ? html('não existe', 404) : page('Pokémon Blister Duplo Caos Ascendente Copag', '29.90');
    return html('', 404); });
  const S = scenario([{ id: 'ld4', name: 'LD4', url: 'https://ld4.test', platform: 'jsonld', kind: 'specialist', evidence: {} }]);
  for (const m of [0, 15, 30, 45, 60]) await S.run(m);
  assert.equal(hits, 3, 'três tentativas e para');
  const c = S.data('url-cache.json').ld4;
  assert.ok(c.visited.includes(URL1) && c.checked[URL1], 'depois das tentativas, só no intervalo de releitura');
  gone = true;
  const s = await S.run(75);
  assert.ok(!s.offers.some((o) => o.url === URL2), 'página que sumiu (404) sai como removida');
  assert.ok(S.hist().some((h) => h.event === 'removed'), '404 é definitivo: evento "removed"');
});

await t('1e. cache antigo (sem datas de leitura) entra na releitura, aos poucos', async () => {
  const cache = { candidates: ['a', 'b', 'c'], visited: ['a', 'b', 'c'], relevant: ['a'], checked: { c: '2026-10-01T11:00:00Z' } };
  const p = jsonldPlan(cache, Date.parse('2026-10-01T12:00:00Z'));
  assert.deepEqual(p.fresh, []); assert.deepEqual(p.recheck, ['b'], 'sem data = mais antiga; c foi lida há 1 h');
});

// ============ 2. Restock falso ============
const shopStore = (id) => ({ id, name: id, url: `https://${id}.test`, platform: 'shopify', kind: 'specialist', evidence: {} });
const ME05 = { title: 'Pokémon TCG Booster Box c/36 - Escuridão Absoluta - Copag Lacrado', url: '/products/booster-box-escuridao-absoluta-36' };
function shopFetch(state) {
  return async (url) => { const u = new URL(url);
    if (u.pathname === '/robots.txt') return html('', 404);
    if (state.down) return html('erro', 500);
    if (u.pathname === '/search/suggest.json') return json({ resources: { results: { products: /escurid/i.test(u.searchParams.get('q')) ? [{ ...ME05, price: state.price || '459.90', available: state.available !== false }] : [] } } });
    return json({ products: [] }); };
}
await t('2a. em estoque → loja falha → volta: zero restock (alerta e evento)', async () => {
  const st = { down: false }; http.setFetch(shopFetch(st));
  const S = scenario([shopStore('rs1')], [{ id: 'rs', label: 'restock', filter: { productId: 'me05-box36' }, restock: true }]);
  await S.run(0); await S.run(20);
  st.down = true; const mid = await S.run(40);
  const o = mid.offers.find((x) => x.productId === 'me05-box36');
  assert.equal(o.stale, true); assert.equal(o.lastKnownStock, 'IN_STOCK');
  st.down = false; await S.run(60); st.down = true; await S.run(80); await S.run(100); st.down = false; await S.run(120);
  assert.equal(S.msgs.filter((m) => /RESTOCK/.test(m.title)).length, 0, 'nenhum RESTOCK falso');
});
await t('2b. restock real (esgotado → em estoque) continua avisando, inclusive com falha no meio', async () => {
  const st = { down: false, available: false }; http.setFetch(shopFetch(st));
  const S = scenario([shopStore('rs2')], [{ id: 'rs', label: 'restock', filter: { productId: 'me05-box36' }, restock: true }]);
  await S.run(0); await S.run(20);
  st.down = true; await S.run(40);
  st.down = false; st.available = true; await S.run(60);
  assert.equal(S.msgs.filter((m) => /RESTOCK/.test(m.title)).length, 1, 'esgotado → (falha) → em estoque = 1 restock');
});

// ============ 3. Frete VTEX ============
function vtexFetch(st) {
  return async (url, opt) => { const u = new URL(url);
    if (u.pathname === '/robots.txt') return html('', 404);
    if (u.pathname.startsWith('/api/catalog_system')) return json(/pokemon$|caos/i.test(u.searchParams.get('ft')) ? [{ productName: 'Caixa Pokémon Caos Ascendente 36 Boosters Copag', link: `https://${u.host}/caos-36/p`, items: [{ itemId: '77', name: 'u', sellers: [{ sellerId: '1', sellerName: 'Loja', commertialOffer: { Price: 379.9, ListPrice: 449.99, AvailableQuantity: 5 } }] }] }] : []);
    if (u.pathname.includes('simulation')) return st.shipOk ? json({ logisticsInfo: [{ slas: [{ price: 1990 }] }] }) : html('erro', 502);
    return html('', 404); };
}
await t('3a. frete ok → falha → ok: sem queda falsa, total e histórico estáveis, motivo registrado', async () => {
  process.env.HUNTER_CEP = '01001000';
  const st = { shipOk: true }; http.setFetch(vtexFetch(st));
  const S = scenario([{ id: 'vt1', name: 'VT1', url: 'https://vt1.test', platform: 'vtex', kind: 'specialist', evidence: {} }],
    [{ id: 'alvo', mode: 'target', label: 'alvo', filter: { productId: 'me04-box36' }, maxPrice: 1 }]);
  let s = await S.run(0); await S.run(15);
  const before = S.hist().length;
  st.shipOk = false; s = await S.run(30);
  const o = s.offers.find((x) => x.storeId === 'vt1');
  assert.equal(o.total, 399.8, 'total com o último frete conhecido'); assert.equal(o.shipping, 19.9);
  assert.equal(o.shippingSource, 'anterior'); assert.equal(o.shippingAt, new Date(Date.parse('2026-10-01T12:15:00Z')).toISOString());
  assert.match(o.shippingError, /simulação de frete falhou/);
  const src = s.sources.find((x) => x.id === 'vt1');
  assert.equal(src.shippingFailures, 1); assert.match(src.shippingFailReason, /falhou/);
  st.shipOk = true; s = await S.run(45);
  assert.equal(s.offers.find((x) => x.storeId === 'vt1').shippingSource, 'simulacao');
  assert.equal(S.hist().length, before, 'nenhuma linha de histórico nova: preço e total não mudaram');
  assert.equal(S.msgs.filter((m) => /QUEDA/.test(m.title)).length, 0, 'sem queda falsa');
  assert.ok(s.sources.find((x) => x.id === 'vt1').shippingFailures === 0, 'contador zera quando volta');
  delete process.env.HUNTER_CEP;
});
await t('3b. frete que falha além da validade fica desconhecido (não inventa) e não vira queda', async () => {
  process.env.HUNTER_CEP = '01001000';
  const st = { shipOk: true }; http.setFetch(vtexFetch(st));
  const S = scenario([{ id: 'vt2', name: 'VT2', url: 'https://vt2.test', platform: 'vtex', kind: 'specialist', evidence: {} }],
    [{ id: 'alvo', mode: 'target', label: 'alvo', filter: { productId: 'me04-box36' }, maxPrice: 1 }]);
  await S.run(0); await S.run(15);
  st.shipOk = false;
  const s = await S.run(15 + 25 * 60);
  const o = s.offers.find((x) => x.storeId === 'vt2');
  assert.equal(o.shipping, null); assert.equal(o.shippingKnown, false); assert.equal(o.total, 379.9, 'total = só o produto');
  assert.equal(o.confirmed, true, 'mesmo preço do produto: não fica pendente como queda');
  assert.equal(S.msgs.filter((m) => /QUEDA/.test(m.title)).length, 0);
  assert.ok(!S.data('activity.json').some((e) => e.type === 'drop'), 'atividade do site sem "queda" por frete que sumiu');
  delete process.env.HUNTER_CEP;
});
await t('3c. sem frete anterior, falha da simulação deixa frete desconhecido', async () => {
  process.env.HUNTER_CEP = '01001000';
  http.setFetch(vtexFetch({ shipOk: false }));
  const S = scenario([{ id: 'vt3', name: 'VT3', url: 'https://vt3.test', platform: 'vtex', kind: 'specialist', evidence: {} }]);
  const s = await S.run(0);
  const o = s.offers.find((x) => x.storeId === 'vt3');
  assert.equal(o.shipping, null); assert.equal(o.shippingSource, null); assert.match(o.shippingError, /falhou/);
  delete process.env.HUNTER_CEP;
});
await t('3d. comparable: total só com a mesma situação de frete', () => {
  assert.deepEqual(comparable({ total: 492.8, price: 479.9, shippingKnown: true }, { total: 479.9, price: 479.9, shippingKnown: false }), { from: 479.9, to: 479.9, basis: 'price' });
  assert.deepEqual(comparable({ total: 500, price: 480, shippingKnown: true }, { total: 490, price: 470, shippingKnown: true }), { from: 500, to: 490, basis: 'total' });
  const m = compose({ kind: 'drop', from: 480, to: 470, basis: 'price', offer: { total: 470, priceKindLabel: 'preço', storeName: 'L', shipping: null, url: 'x' }, product: { collectionName: 'X', typeLabel: 'Box', copagConfirmed: false } });
  assert.match(m.text, /480,00 → R\$\s?470,00 \(preço do produto\)/, 'queda medida no preço do produto mostra os dois preços do produto');
});

// ============ 4. Mercado Livre ============
await t('4a. ML: catálogo preservado em falha parcial; falha total sinaliza erro; resposta vazia não apaga', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lote7-ml-')); process.env.HUNTER_DATA_DIR = tmp; process.env.ML_ACCESS_TOKEN = 'teste';
  const ml = await import('../src/adapters/mercadolivre.js');
  const st = { mode: 'ok' };
  http.setFetch(async (url) => { const u = new URL(url);
    if (u.pathname === '/sites/MLB/search') return json({ message: 'forbidden' }, 403);
    if (u.pathname === '/products/search') {
      if (st.mode === 'down') return html('erro', 503);
      if (st.mode === 'partial' && !/escurid/i.test(u.searchParams.get('q'))) return html('erro', 503);
      if (st.mode === 'empty') return json({ results: [] });
      return json({ results: /escurid/i.test(u.searchParams.get('q')) ? [{ id: 'MLB1', name: 'Pokémon Box Display 36 Boosters Escuridão Absoluta Copag' }] : /caos ascendente/i.test(u.searchParams.get('q')) ? [{ id: 'MLB2', name: 'Pokémon Box Display 36 Boosters Caos Ascendente Copag' }] : [] });
    }
    if (/^\/products\/MLB\d\/items$/.test(u.pathname)) return st.items === 'down' ? html('erro', 503) : json({ results: [{ item_id: 'I' + u.pathname.split('/')[2], seller_id: 7, price: 399.9, condition: 'new', official_store_id: 1 }] });
    if (u.pathname === '/items') return json(u.searchParams.get('ids').split(',').map((id) => ({ code: 403, body: { id } })));
    return json({}, 404); });
  const cacheFile = path.join(tmp, 'ml-catalog.json');
  const age = () => { const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); c.at = '2000-01-01T00:00:00Z'; delete c.retryAt; fs.writeFileSync(cacheFile, JSON.stringify(c)); };
  let l = await ml.search({}, catalog);
  assert.equal(l.length, 2);
  assert.ok(l.every((x) => x.stock === 'IN_STOCK' && x.stockVerified === false), 'pela lista do catálogo: estoque não verificado');
  age(); st.mode = 'partial'; l = await ml.search({}, catalog);
  assert.equal(l.length, 2, 'falha parcial não perde o produto das outras buscas');
  assert.ok(JSON.parse(fs.readFileSync(cacheFile, 'utf8')).retryAt, 'tenta de novo antes de 24 h');
  age(); st.mode = 'empty'; l = await ml.search({}, catalog);
  assert.equal(l.length, 2, 'busca sem nenhum produto não apaga o catálogo anterior');
  age(); st.mode = 'down';
  await assert.rejects(() => ml.search({}, catalog), /todas as \d+ buscas de catálogo falharam/, 'falha total vira erro, não zero produtos');
  assert.equal(Object.keys(JSON.parse(fs.readFileSync(cacheFile, 'utf8')).products).length, 2, 'catálogo preservado');
  st.mode = 'ok'; st.items = 'down';
  await assert.rejects(() => ml.search({}, catalog), /todas as 2 consultas de ofertas falharam/);
  delete process.env.ML_ACCESS_TOKEN;
});
await t('4b. ML: /items comprova estoque (quantidade 0 = esgotado); alerta não diz "confirmado" sem verificação', async () => {
  const msg = compose({ kind: 'target', offer: { total: 399.9, priceKindLabel: 'preço', stockVerified: false, storeName: 'Mercado Livre', quantity: null, shipping: null, url: 'x' }, product: { collectionName: 'X', typeLabel: 'Box', copagConfirmed: false } });
  assert.match(msg.text, /Estoque: anunciado, quantidade não verificada/); assert.doesNotMatch(msg.text, /confirmado/);
  const msg2 = compose({ kind: 'target', offer: { total: 1, priceKindLabel: 'preço', storeName: 'L', quantity: null, shipping: 10, shippingSource: 'anterior', shippingAt: '2026-10-01T12:15:00Z', url: 'x' }, product: { collectionName: 'X', typeLabel: 'Box', copagConfirmed: false } });
  assert.match(msg2.text, /Frete: R\$\s?10,00 \(cotação de 01\/10, 09:15\)/);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lote7-ml2-')); process.env.HUNTER_DATA_DIR = tmp; process.env.ML_ACCESS_TOKEN = 'teste';
  const ml = await import('../src/adapters/mercadolivre.js');
  http.setFetch(async (url) => { const u = new URL(url);
    if (u.pathname === '/sites/MLB/search') return json({}, 403);
    if (u.pathname === '/products/search') return json({ results: /escurid/i.test(u.searchParams.get('q')) ? [{ id: 'MLB1', name: 'Pokémon Box Display 36 Boosters Escuridão Absoluta Copag' }] : [] });
    if (u.pathname === '/products/MLB1/items') return json({ results: [{ item_id: 'I1', seller_id: 7, price: 399.9, condition: 'new', official_store_id: 1 }, { item_id: 'I2', seller_id: 8, price: 410, condition: 'new', official_store_id: 2 }] });
    if (u.pathname === '/items') return json([{ code: 200, body: { id: 'I1', price: 399.9, status: 'active', condition: 'new', available_quantity: 0, catalog_product_id: 'MLB1' } }, { code: 200, body: { id: 'I2', price: 410, status: 'active', condition: 'new', available_quantity: 3, catalog_product_id: 'MLB1' } }]);
    return json({}, 404); });
  const l = await ml.search({}, catalog);
  assert.deepEqual(l.map((x) => [x.stock, x.stockVerified, x.quantity]), [['OUT_OF_STOCK', true, null], ['IN_STOCK', true, 3]]);
  delete process.env.ML_ACCESS_TOKEN;
});
await t('4c. vigia: fonte acompanhada que já teve anúncios e zera/cai por 2 rodadas fica degradada', () => {
  const NOW = '2026-10-09T19:30:00Z';
  const rec = (at, w) => ({ runId: at, attempt: 1, generatedAt: at, startedAt: at, finishedAt: at, reader: { status: 'ok', valid: 5, read: 5 }, stores: { active: 1 }, dbSync: { status: 'ok' }, watched: { mercadolivre: w } });
  const meta = (a, b) => ({ ops: { runs: [rec('2026-10-09T19:00:00Z', a), rec('2026-10-09T19:15:00Z', b)], last: rec('2026-10-09T19:15:00Z', b) } });
  const ev = (a, b) => evaluate({ now: NOW, stateGeneratedAt: '2026-10-09T19:15:00Z', meta: meta(a, b), runs: [] });
  const ok = { status: 'ACTIVE', listings: 285, lastListingsAt: '2026-10-09T19:00:00Z' };
  const zero = { status: 'ACTIVE', listings: 0, lastListingsAt: '2026-10-09T18:45:00Z' };
  const err = { status: 'ERROR', listings: 285, lastListingsAt: '2026-10-09T18:45:00Z', reason: 'Mercado Livre: todas as 40 buscas de catálogo falharam' };
  assert.equal(ev(ok, ok).status, 'saudavel');
  assert.equal(ev(ok, zero).status, 'saudavel', 'uma rodada só não basta');
  const z = ev(zero, zero); assert.equal(z.status, 'degradado'); assert.ok(z.reasons.some((r) => r.code === 'fonte_zerada' && /Mercado Livre sem anúncios/.test(r.text)));
  const e = ev(err, { ...err, status: 'BLOCKED' }); assert.equal(e.status, 'degradado'); assert.ok(e.reasons.some((r) => r.code === 'fonte_zerada' && /fora do ar \(BLOCKED/.test(r.text)));
  const never = { status: 'ACTIVE', listings: 0, lastListingsAt: null };
  assert.equal(ev(never, never).status, 'saudavel', 'fonte que nunca teve anúncios não é "zerada"');
  assert.deepEqual(watchedSummary({ mercadolivre: { status: 'ACTIVE', listings: 3, lastListingsAt: NOW, reason: null }, outra: { status: 'ACTIVE' } }), { mercadolivre: { status: 'ACTIVE', listings: 3, lastListingsAt: NOW, reason: null } });
});

// ============ 5. Case ============
await t('5. "Case" (várias unidades) não casa com produto unitário; "case vazio" segue acessório', () => {
  const real = ['Case Blister Quádruplo Heróis Excelsos - Pokemon Tcg', 'Case Blister Quadruplo De Raio Preto E Fogo Branco - Pokemon Tcg', 'Case Combo De Booster Heróis Excelsos - Pokemon Tcg Port'];
  for (const title of real) {
    const m = matchProduct({ title, url: 'https://www.shogunlivraria.com.br/x' }, catalog);
    assert.equal(m.productId ?? null, null, title);
    assert.ok(m.why.includes('kit montado pela loja ou caixa com várias unidades'), title + ': ' + m.why);
  }
  const vazio = matchProduct({ title: 'Case vazio para Booster Box Pokémon', url: 'https://x.test/a' }, catalog);
  assert.equal(vazio.productId ?? null, null); assert.ok(vazio.why.includes('acessório ou item não-TCG')); assert.ok(!vazio.why.includes('kit montado pela loja ou caixa com várias unidades'));
  assert.ok(matchProduct({ title: 'Combo De Booster Heróis Excelsos - Pokemon Tcg Port', url: 'https://www.shogunlivraria.com.br/combo-de-booster-herois-excelsos-pokemon-tcg-port' }, catalog).productId, 'o combo unitário continua casando');
  assert.ok(matchProduct({ title: 'Pokémon TCG Showcase Blister Quádruplo Heróis Excelsos Copag', url: 'https://x.test/b' }, catalog).productId, '"showcase" não é "case"');
});

console.log(`✓ Integridade dos coletores (Lote 7): ${groups} grupos de testes passaram`);
