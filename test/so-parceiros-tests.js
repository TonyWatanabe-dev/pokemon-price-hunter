// Site só com parceiros (decisão do proprietário, 07/11/2026): com SITE_SO_PARCEIROS=1 o estado publicado traz SÓ anúncios do ML com link
// do dono + leituras manuais da Amazon/Shopee; as demais lojas viram só referência de mercado. Com a flag desligada, nada muda.
// Offline: ML e uma loja Shopify simulados via setFetch; sem rede e sem banco.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';

process.env.HUNTER_DOMAIN_DELAY_MS = '0'; process.env.HUNTER_TIPS = '0';
process.env.ML_CLIENT_ID = '123'; process.env.ML_CLIENT_SECRET = 'segredo-de-teste';
for (const k of ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_SHA', 'GITHUB_EVENT_NAME', 'DATABASE_URL', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'HUNTER_CEP', 'ML_ACCESS_TOKEN', 'SITE_SO_PARCEIROS']) delete process.env[k];
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const aff = await import('../api/_lib/affiliates.mjs');
const modo = await import('../src/core/modo-site.js');
let n = 0;

// ---- 1. Funções do módulo de afiliados (único que lê a config) ------------------------------------------------------------------
{
  const cfg = aff.parseAffiliates({ mercadolivre: { anuncios: { MLB55510001: 'https://meli.la/abc' } } });
  assert.equal(aff.ofertaParceira({ url: 'https://www.mercadolivre.com.br/p/MLB111?pdp_filters=item_id%3AMLB55510001' }, cfg), true, 'ML com link no mapa');
  assert.equal(aff.ofertaParceira({ url: 'https://www.mercadolivre.com.br/p/MLB111?pdp_filters=item_id%3AMLB55540001' }, cfg), false, 'ML sem link: fora');
  assert.equal(aff.ofertaParceira({ url: 'https://outraloja.com.br/produto/MLB55510001' }, cfg), false, 'outra loja nunca');
  assert.equal(aff.ofertaParceira({}, cfg), false);
  assert.deepEqual([...aff.LOJAS_PARCEIRAS], [...modo.LOJAS_PARCEIRAS], 'lista de lojas do modo = lista do módulo de afiliados');
  const now = new Date('2026-11-07T20:00:00Z'); const h = (x) => new Date(now.getTime() - x * 3600e3).toISOString();
  const am = { links: [
    { productId: 'p1', asin: 'B0AAAAAAA1', title: 'A', price: 100, seller: 's', stockNote: null, capturedAt: h(1), shortUrl: 'https://link.amazon/aaa1' },
    { productId: 'p1', asin: 'B0AAAAAAA2', title: 'vencida', price: 100, capturedAt: h(49), shortUrl: 'https://link.amazon/aaa2' },
    { productId: 'p1', asin: 'B0AAAAAAA3', title: 'futuro', price: 100, capturedAt: new Date(now.getTime() + 864e5).toISOString(), shortUrl: 'https://link.amazon/aaa3' },
    { productId: 'p1', asin: 'B0AAAAAAA4', title: 'sem preço', price: null, capturedAt: h(1), shortUrl: 'https://link.amazon/aaa4' },
    { productId: 'p1', asin: 'B0AAAAAAA5', title: 'esgotado', price: 90, stockNote: 'Não disponível', capturedAt: h(1), shortUrl: 'https://link.amazon/aaa5' },
    { productId: 'p9', asin: 'B0AAAAAAA6', title: 'produto inexistente', price: 90, capturedAt: h(1), shortUrl: 'https://link.amazon/aaa6' },
    { productId: 'p1', asin: 'B0AAAAAAA7', title: 'sem link do dono', price: 90, capturedAt: h(1), shortUrl: null },
    { productId: 'p1', asin: 'B0AAAAAAA8', title: 'estoque baixo', price: 80, stockNote: 'Somente 2 em estoque', capturedAt: h(2), shortUrl: 'https://link.amazon/aaa8' },
  ] };
  const sh = { ofertas: [
    { productId: 'p1', item: '111111/222222', title: 'S', url: 'https://s.shopee.com.br/AbC123', price: 70, priceCupom: 65, seller: 'v', selo: 'Loja Oficial', stockNote: null, capturedAt: h(3) },
    { productId: 'p1', item: '111111/222223', title: 'S esgotado', url: 'https://s.shopee.com.br/AbC124', price: 70, stockNote: 'esgotado', capturedAt: h(3) },
  ] };
  const r = aff.ofertasManuaisParceiras({ now, products: { p1: {} }, amazon: am, shopee: sh });
  assert.deepEqual(r.map((o) => o.sku).sort(), ['111111/222222', 'B0AAAAAAA1', 'B0AAAAAAA8'], 'só leitura vigente, com preço, em estoque, com link do dono e produto existente');
  for (const o of r) {
    assert.equal(o.manual, true); assert.equal(o.shippingKnown, false); assert.equal(o.shipping, null, 'frete desconhecido nunca é zero'); assert.equal(o.total, o.price);
    assert.ok(['amazon', 'shopee'].includes(o.storeId)); assert.equal(o.confirmed, true); assert.equal(o.stale, false); assert.ok(o.capturedAt);
  }
  const s1 = r.find((o) => o.storeId === 'shopee'); assert.equal(s1.price, 70, 'Shopee: preço sem cupom'); assert.equal(s1.priceCupom, 65); assert.equal(s1.url, 'https://s.shopee.com.br/AbC123');
  assert.equal(r.find((o) => o.sku === 'B0AAAAAAA8').quantity, 2);
  assert.equal(aff.ofertasManuaisParceiras({ now: new Date(now.getTime() + 10 * 864e5), products: { p1: {} }, amazon: am, shopee: sh }).length, 0, 'tudo vence sozinho');
  n++;
}

// ---- 2. Isolamento: só src/parceiros.js importa o módulo de afiliados em src/ -------------------------------------------------
{
  const walk = (d) => fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : /\.(m?js)$/.test(e.name) ? [`${d}/${e.name}`] : []));
  const importers = walk('src').filter((f) => !f.startsWith('src/agents/social/')).filter((f) => /affiliates\.mjs/.test(fs.readFileSync(path.join(root, f), 'utf8').replace(/\/\/.*$/gm, '')));
  assert.deepEqual(importers, ['src/parceiros.js'], 'única exceção nova do isolamento do afiliado fora dos agentes sociais que já liam links');
  const quemUsa = walk('src').filter((f) => /from '(?:\.\.?\/)+(?:core\/)?parceiros\.js'/.test(fs.readFileSync(path.join(root, f), 'utf8')));
  assert.deepEqual(quemUsa, ['src/run.js'], 'só a rodada usa o módulo de parceiros');
  const wf = fs.readFileSync(path.join(root, '.github/workflows/hunter.yml'), 'utf8');
  assert.equal((wf.match(/SITE_SO_PARCEIROS: \$\{\{ vars\.SITE_SO_PARCEIROS \|\| '1' \}\}/g) || []).length, 2, 'caça e banco leem a variável do repositório (padrão ligado)');
  n++;
}

// ---- 3. Rodada completa ------------------------------------------------------------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'so-parceiros-'));
const saved = { cfg: process.env.HUNTER_CONFIG_DIR, data: process.env.HUNTER_DATA_DIR };
process.env.HUNTER_CONFIG_DIR = path.join(tmp, 'config'); process.env.HUNTER_DATA_DIR = path.join(tmp, 'data');
const http = await import('../src/http.js'); const mlauth = await import('../src/mlauth.js');
const fullCatalog = JSON.parse(fs.readFileSync(path.join(root, 'config/catalog.json'), 'utf8'));
const COLL = 'Caos Ascendente'; const PRODUCT = 'me04-etb';
try {
  const C = path.join(tmp, 'config'); const D = path.join(tmp, 'data');
  process.env.HUNTER_CONFIG_DIR = C; process.env.HUNTER_DATA_DIR = D;
  fs.mkdirSync(path.join(C, 'afiliados'), { recursive: true }); fs.mkdirSync(D, { recursive: true });
  const j = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { 'content-type': 'application/json' } });
  const ITEMS = [   // MLB55510001 tem link do dono; MLB55540001 não
    { item_id: 'MLB55510001', seller_id: 77, price: 299.9, available_quantity: 4, condition: 'new', shipping: { free_shipping: true } },
    { item_id: 'MLB55540001', seller_id: 80, price: 250, available_quantity: 6, condition: 'new', shipping: { free_shipping: false } },
  ];
  const shopify = JSON.stringify({ products: [{ title: 'Pokémon Treinador Avançado Caos Ascendente Copag', handle: 'etb-caos', variants: [{ id: 11, price: '280.00', available: true, sku: 'SH-1' }] }] });
  globalThis.fetch = async () => new Response(JSON.stringify({ access_token: 'AT-1', refresh_token: 'RT-1', expires_in: 21600, user_id: 9, scope: 'offline_access read' }), { status: 200 });
  await mlauth.exchange('TG-123');
  http.setFetch(async (url) => {
    const u = new URL(url);
    if (u.host === 'lojax.test') return u.pathname === '/products.json' ? new Response(shopify, { status: 200, headers: { 'content-type': 'application/json' } }) : new Response('', { status: 404 });
    if (url.includes('/sites/MLB/search')) return j({ error: 'forbidden', status: 403 }, 403);
    if (url.includes('/products/search')) return j({ results: url.includes(encodeURIComponent('pokemon ' + COLL)) ? [{ id: 'MLB111', name: `Pokémon TCG ${COLL} Treinador Avançado Copag` }] : [] });
    if (url.endsWith('/products/MLB111/items')) return j({ results: ITEMS });
    if (url.includes('/items?ids=')) return j(url.match(/ids=([^&]+)/)[1].split(',').map((id) => ({ code: 403, body: { id, error: 'access_denied', status: 403 } })));
    if (/\/users\/(77|80)$/.test(url)) return j({ nickname: 'LOJA_' + url.slice(-2), seller_reputation: { level_id: '5_green', transactions: { completed: 900 } } });
    return j({}, 404);
  });
  const cat = structuredClone(fullCatalog); cat.collections = cat.collections.filter((c) => c.name === COLL);
  cat.copag[PRODUCT] = { msrp: 349.99, source_url: 'https://www.copag.com.br/exemplo-teste', confidence: 'OFICIAL', source_timestamp: '2026-10-01' };
  fs.writeFileSync(path.join(C, 'catalog.json'), JSON.stringify(cat));
  fs.writeFileSync(path.join(C, 'watchlist.json'), JSON.stringify({ settings: {}, rules: [{ id: 'alvo', label: 'Alvo', mode: 'target', maxPrice: 100000 }] }));
  fs.writeFileSync(path.join(C, 'stores.json'), JSON.stringify({ stores: [
    { id: 'mercadolivre', name: 'Mercado Livre', url: 'https://api.mercadolibre.com', platform: 'mercadolivre', kind: 'marketplace', evidence: {} },
    { id: 'lojax', name: 'Loja Xis', url: 'https://lojax.test', platform: 'shopify', kind: 'specialist', evidence: {} },
    { id: 'amazon', name: 'Amazon Brasil', url: null, platform: 'unsupported', kind: 'marketplace', evidence: {} },
    { id: 'shopee', name: 'Shopee Brasil', url: null, platform: 'unsupported', kind: 'marketplace', evidence: {} }] }));
  fs.writeFileSync(path.join(C, 'affiliates.json'), JSON.stringify({ mercadolivre: { anuncios: { MLB55510001: 'https://meli.la/abc' } } }));
  const now = new Date(); const ago = (h) => new Date(now.getTime() - h * 3600e3).toISOString();
  fs.writeFileSync(path.join(C, 'afiliados/amazon.json'), JSON.stringify({ links: [
    { productId: PRODUCT, asin: 'B0AAAAAAA1', title: 'ETB Caos Amazon', price: 270, seller: 'Amazon', capturedAt: ago(2), shortUrl: 'https://link.amazon/zzz1' },
    { productId: PRODUCT, asin: 'B0AAAAAAA2', title: 'ETB vencida', price: 100, capturedAt: ago(60), shortUrl: 'https://link.amazon/zzz2' }] }));
  fs.writeFileSync(path.join(C, 'afiliados/shopee-ofertas.json'), JSON.stringify({ ofertas: [
    { productId: PRODUCT, item: '123456/7890123', title: 'ETB Caos Shopee', url: 'https://s.shopee.com.br/ShopX1', price: 285, priceCupom: 280, seller: 'v', stockNote: null, capturedAt: ago(1) },
    { productId: PRODUCT, item: '123456/7890124', title: 'ETB esgotado', url: 'https://s.shopee.com.br/ShopX2', price: 50, stockNote: 'esgotado', capturedAt: ago(1) }] }));
  const { runOnce } = await import('../src/run.js');
  const read = (f) => JSON.parse(fs.readFileSync(path.join(D, f), 'utf8'));
  const rodar = async (flag) => {
    for (const f of fs.readdirSync(D)) if (!/^ml/.test(f)) fs.rmSync(path.join(D, f), { recursive: true, force: true });   // mantém o acesso ao ML (mlauth)
    if (flag == null) delete process.env.SITE_SO_PARCEIROS; else process.env.SITE_SO_PARCEIROS = flag;
    await runOnce({ log: () => {}, send: {}, now });
    return read('state.json');
  };

  // flag desligada: comportamento de sempre (todas as lojas, nenhuma leitura manual)
  const off = await rodar('0');
  assert.deepEqual([...new Set(off.offers.map((o) => o.storeId))].sort(), ['lojax', 'mercadolivre'], 'desligado: lojas lidas, sem Amazon/Shopee manuais');
  assert.equal(off.offers.filter((o) => o.storeId === 'mercadolivre').length, 2);
  assert.equal(off.products.find((p) => p.id === PRODUCT).offerCount, 3);
  assert.ok(off.sources.some((s) => s.id === 'lojax'));
  const marketOff = off.products.find((p) => p.id === PRODUCT).marketAverage;
  n++;

  // flag ligada
  const on = await rodar('1');
  const txt = JSON.stringify(on);
  const prod = on.products.find((p) => p.id === PRODUCT);
  assert.deepEqual([...new Set(on.offers.map((o) => o.storeId))].sort(), ['amazon', 'mercadolivre', 'shopee'], 'só parceiros publicados');
  const ml = on.offers.filter((o) => o.storeId === 'mercadolivre');
  assert.deepEqual(ml.map((o) => o.sku), ['MLB55510001'], 'ML sem link do dono fora');
  for (const proibido of ['lojax', 'Loja Xis', 'MLB55540001']) assert.ok(!txt.includes(proibido), `state.json não menciona ${proibido}`);
  assert.ok(!on.sources.some((s) => s.id === 'lojax')); assert.deepEqual(on.sources.map((s) => s.id).sort(), ['amazon', 'mercadolivre', 'shopee']);
  const am = on.offers.find((o) => o.storeId === 'amazon'); const sh = on.offers.find((o) => o.storeId === 'shopee');
  assert.ok(am && sh, 'Amazon e Shopee entram'); assert.equal(on.offers.filter((o) => o.storeId === 'amazon').length, 1, 'leitura vencida (60 h) fora');
  assert.equal(am.url, 'https://link.amazon/zzz1'); assert.equal(sh.url, 'https://s.shopee.com.br/ShopX1'); assert.equal(sh.price, 285);
  for (const o of [am, sh]) { assert.equal(o.shippingKnown, false); assert.equal(o.shipping, null); assert.equal(o.total, o.price); }
  assert.equal(prod.offerCount, 3, 'contagem só do conjunto publicado'); assert.equal(prod.inStockCount, 3);
  assert.ok(marketOff > 0);
  assert.equal(prod.marketAverage, round((299.9 + 250 + 280 + 270 + 285) / 5), 'marketAverage segue vindo de todas as lojas lidas (inclui ML sem link e Loja Xis)');
  assert.notEqual(prod.marketAverage, round((299.9 + 270 + 285) / 3), 'a média inclui a loja não parceira');
  assert.ok(prod.marketRef === null || typeof prod.marketRef.price === 'number');
  assert.ok(!('lojax' in (prod.hist || {})));
  assert.ok(on.bestDeals.every((id) => on.offers.some((o) => o.id === id)), 'ranking só com ofertas publicadas');
  // ranking entre parceiros: por preço/nota, sem comissão (Amazon 270 < ML 299,90 < Shopee 285? ordem pelo critério do robô, não por link)
  const rk = on.bestDeals.map((id) => on.offers.find((o) => o.id === id));
  for (let i = 1; i < rk.length; i++) assert.ok((rk[i - 1].discount ?? -9) >= (rk[i].discount ?? -9), 'ordenado por desconto/preço entre parceiros');
  assert.ok(!on.activity.some((a) => /Loja Xis/.test(a.storeName)));
  assert.ok(!(on.recentAlerts || []).some((a) => /Loja Xis|lojax/.test(JSON.stringify(a))));
  for (const f of ['hist', 'history.jsonl']) {
    const p = path.join(D, f); if (!fs.existsSync(p)) continue;
    const t = fs.statSync(p).isDirectory() ? fs.readdirSync(p).map((x) => fs.readFileSync(path.join(p, x), 'utf8')).join('') : fs.readFileSync(p, 'utf8');
    assert.ok(!/lojax|Loja Xis/.test(t), `${f} sem a loja não parceira`);
  }
  // a chave é do dono: nenhum dado público a revela
  assert.ok(!/SITE_SO_PARCEIROS|soParceiros|so_parceiros/i.test(txt), 'estado publicado não menciona a chave');
  // operação: ofertas das demais lojas seguem lidas (offers.json interno) para a rodada seguinte
  assert.ok(Object.values(read('offers.json')).some((o) => o.storeId === 'lojax'), 'operação mantém a leitura das demais lojas');
  // segunda rodada: leituras manuais não viram stale nem somem antes de vencer
  const on2 = await (async () => { await runOnce({ log: () => {}, send: {}, now: new Date(now.getTime() + 15 * 60e3) }); return read('state.json'); })();
  assert.ok(on2.offers.some((o) => o.storeId === 'amazon' && !o.stale), 'leitura manual segue publicada na rodada seguinte');
  n++;
} finally {
  delete process.env.SITE_SO_PARCEIROS;
  if (saved.cfg == null) delete process.env.HUNTER_CONFIG_DIR; else process.env.HUNTER_CONFIG_DIR = saved.cfg;
  if (saved.data == null) delete process.env.HUNTER_DATA_DIR; else process.env.HUNTER_DATA_DIR = saved.data;
  fs.rmSync(tmp, { recursive: true, force: true });
}
function round(v) { return Number.isFinite(v) ? Math.round(v * 100) / 100 : null; }

// ---- 4. Price Engine: mercado de todas as lojas vindo do robô -----------------------------------------------------------------
{
  const { computeProductStats } = await import('../src/core/price-engine.js');
  const offers = [{ id: '1', store_id: 'amazon', marketplace_id: 'direct', seller_key: null, status: 'active', condition: 'new', confirmed: true, price: 300, stock_status: 'in_stock', shipping_status: 'unknown', total_price: null, last_seen_at: '2026-11-07T10:00:00Z', events: [] }];
  const asOf = new Date('2026-11-07T12:00:00Z');
  const base = computeProductStats({ product: { condition: 'new' }, offers, reference: null, asOf }).stats;
  assert.equal(base.reference_kind, 'NONE', 'só uma oferta de parceiro: sem mercado próprio');
  const ext = computeProductStats({ product: { condition: 'new' }, offers, reference: null, asOf, externalMarket: { price: 340, offers: 6, sources: 4, composition: 'MARKET_MIXED', confidence: 0.75 } }).stats;
  assert.equal(ext.reference_kind, 'MARKET_CURRENT'); assert.equal(ext.reference_price, 340); assert.equal(ext.quality.market_reference.external, true);
  assert.ok(Math.abs(ext.discount_vs_reference - (340 - 300) / 340) < 1e-3, '"quanto abaixo do mercado" usa a referência de todas as lojas');
  assert.equal(JSON.stringify(ext).includes('amazon'), false);
  n++;
}
console.log(`✓ Site só com parceiros: ${n} blocos passaram`);
