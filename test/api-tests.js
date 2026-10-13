// API v1 (FASE 3): resumo da Home, endpoints, paginação, cache, fallback, consistência com o state.json.
// Roda sempre (fonte state.json), sem banco. A parte de banco fica em test/api-db-tests.js.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { slimHome } from '../api/_lib/home.mjs';
import { setLegacyLoader } from '../api/_lib/legacy.mjs';
import { compareHome, compareEndpoints, homeView } from '../tools/api-compare.mjs';

const now = Date.now(); const T = (h) => new Date(now - h * 3600e3).toISOString();
const fx = () => ({
  generatedAt: T(0), coverage: { stores: 3 }, totals: { offers: 7 },
  collections: [{ id: 'me05', name: 'Escuridão Absoluta', series: 'Megaevolução', aliases: ['me5'] }, { id: 'sv9', name: 'Amigos de Jornada', series: 'Escarlate e Violeta', aliases: [] }],
  types: [{ id: 'etb', label: 'Treinador Avançado (ETB)', group: 'ETB' }, { id: 'booster_pack', label: 'Booster', group: 'Boosters' }, { id: 'lata', label: 'Lata', group: 'Latas' }],
  products: [
    { id: 'me05-etb', collection: 'me05', collectionName: 'Escuridão Absoluta', type: 'etb', typeLabel: 'Treinador Avançado (ETB)', group: 'ETB', boosters: 9, image: 'https://img/etb.png', firstSeen: T(48),
      copagConfirmed: true, msrp: 400, copag: { source_url: 'https://www.copagloja.com.br/etb/p', confidence: 'OFICIAL', source_timestamp: T(10) }, offerCount: 6, inStockCount: 3, lowestHistorical: { total: 350, at: T(30), storeId: 'a', offerId: 'oa' } },
    { id: 'me05-booster', collection: 'me05', collectionName: 'Escuridão Absoluta', type: 'booster_pack', typeLabel: 'Booster', group: 'Boosters', boosters: 1, firstSeen: T(48), copagConfirmed: false, msrp: null, offerCount: 1 },  // sem referência
    { id: 'sv9-lata', collection: 'sv9', collectionName: 'Amigos de Jornada', type: 'lata', typeLabel: 'Lata', group: 'Latas', boosters: 4, firstSeen: T(48), copagConfirmed: false, msrp: null, copagReference: 99.9, copagReferenceUrl: 'https://ref/lata', offerCount: 0 }, // sem ofertas
  ],
  offers: [
    { id: 'oa', productId: 'me05-etb', storeId: 'a', storeName: 'Loja A', title: 'ETB', url: 'https://a/etb', image: 'https://a/i.png', price: 380, priceKind: 'pix', prices: { pix: 380, base: 399 }, shipping: null, shippingKnown: false, total: 380, perBooster: 42.22, stock: 'IN_STOCK', firstSeen: T(40), source_timestamp: T(1), confirmed: true, anomalous: false, stale: false, discount: 0.05, savings: 20, dealScore: 61, scoreParts: { copag: 5 }, matchConfidence: 0.9, sourceType: 'store_api', source_url: 'https://a/etb', sku: 'ETB-ME05' },
    { id: 'ob', productId: 'me05-etb', storeId: 'b', storeName: 'Loja B', title: 'ETB', url: 'https://b/etb', price: 360, priceKind: 'base', shipping: 20, shippingKnown: true, total: 380, perBooster: 42.22, stock: 'IN_STOCK', firstSeen: T(40), source_timestamp: T(1), confirmed: true, anomalous: false, stale: false, discount: 0.05, savings: 20, dealScore: 70, matchConfidence: 0.9 },
    { id: 'oc', productId: 'me05-etb', storeId: 'rihappycombr', storeName: 'Ri Happy', seller: 'Gourmande', sellerKind: 'store', title: 'ETB', url: 'https://rh/etb', price: 300, priceKind: 'base', shipping: null, shippingKnown: false, total: 300, perBooster: 33.33, stock: 'OUT_OF_STOCK', firstSeen: T(40), source_timestamp: T(1), confirmed: true, anomalous: false, stale: false, discount: 0.25, savings: 100, dealScore: null },
    { id: 'od', productId: 'me05-etb', storeId: 'mercadolivre', storeName: 'Mercado Livre', seller: 'VENDEDOR_X', sellerId: '77', sellerKind: 'marketplace_seller', sku: 'MLB1', title: 'ETB', url: 'https://ml/p/1', price: 340, priceKind: 'base', shipping: 0, shippingKnown: true, total: 340, perBooster: 37.78, stock: 'IN_STOCK', firstSeen: T(40), source_timestamp: T(1), confirmed: false, anomalous: false, stale: false, discount: 0.15, savings: 60, dealScore: null },
    { id: 'oe', productId: 'me05-etb', storeId: 'a', storeName: 'Loja A', title: 'ETB caixa', url: 'https://a/etb2', price: 410, priceKind: 'base', shipping: null, shippingKnown: false, total: 410, perBooster: 45.56, stock: 'IN_STOCK', firstSeen: T(40), source_timestamp: T(30), confirmed: true, anomalous: false, stale: true, discount: -0.025, savings: -10, dealScore: null },
    { id: 'of', productId: 'me05-booster', storeId: 'b', storeName: 'Loja B', title: 'Booster', url: 'https://b/bst', price: 30, priceKind: 'base', shipping: null, shippingKnown: false, total: 30, perBooster: 30, stock: 'IN_STOCK', firstSeen: T(40), source_timestamp: T(1), confirmed: true, anomalous: false, stale: false, discount: null, savings: null, dealScore: null },
  ],
  activity: [{ t: T(2), productId: 'me05-etb', offerId: 'oa', storeName: 'Loja A', to: 380, from: 400, msrp: 400, type: 'drop' }, { t: T(24 * 30), productId: 'me05-etb', offerId: 'oa', storeName: 'Loja A', to: 390, type: 'new' }],
  tips: [{ key: 'tg:1', id: 't1', source: 'Telegram x', title: 'ETB barata', text: 'texto bruto longo do canal', productId: 'me05-etb', price: 330, discount: 0.17, postedAt: T(3), url: 'https://t.me/x/1' }],
  sources: [{ id: 'a', name: 'Loja A', url: 'https://a.com.br', status: 'ACTIVE', score: { evidence: ['CNPJ'] }, secretNote: 'interno' }, { id: 'b', name: 'Loja B', url: 'https://b.com.br', status: 'ACTIVE' },
    { id: 'rihappycombr', name: 'Ri Happy', url: 'https://rihappy.com.br', status: 'ACTIVE' }, { id: 'mercadolivre', name: 'Mercado Livre', url: 'https://mercadolivre.com.br', status: 'ACTIVE' }],
  reputation: { consultadoEm: '2026-10-01', lojas: { b: { status: 'BOM', nota: 7.9 }, z: { status: 'RUIM' } } },
  distrust: null, unmatched: [{ title: 'x' }], rules: [{ id: 'r' }], recentAlerts: [{ id: 'al' }],
});

// ------------------------------------------------------------------ A) resumo da Home (puro)
const st = fx(); const h = slimHome(st, { source: 'state', now });
// produto sem ofertas fica de fora; os outros entram com contagens prontas
assert.deepEqual(h.products.map((p) => p.id).sort(), ['me05-booster', 'me05-etb']);
const pe = h.products.find((p) => p.id === 'me05-etb');
assert.equal(pe.liveCount, 3, 'oa, ob e od com estoque (no site, "viva" não olha confirmação; oe é stale; oc sem estoque)');
assert.ok(pe.codes.includes('ETB-ME05') && pe.codes.includes('MLB1'));
assert.equal(pe.collectionName, undefined, 'nome da coleção vem de collections'); assert.equal(pe.typeLabel, undefined);
assert.deepEqual(pe.lowestHistorical, { total: 350, at: st.products[0].lowestHistorical.at });
// ofertas: melhor com estoque, sem a inteira da atividade
const ids = h.offers.map((o) => o.id).sort();
// od: melhor com estoque (340); of: único do booster. ob (maior Deal Score) não entra mais: a oportunidade vem do Opportunity Engine
// (pódio pela API /oportunidades), não de uma seleção pelo Deal Score. oe (stale), oc (sem estoque) e oa ficam de fora
assert.deepEqual(ids, ['od', 'of']);
assert.ok(h.offers.every((o) => !('dealScore' in o) && !('scoreParts' in o)), 'Deal Score não vai ao navegador');
assert.deepEqual(h.offerKinds, { oa: 'pix' }, 'oferta citada só na atividade: viaja apenas o selo "no Pix"');
assert.equal(h.activity.length, 1, 'atividade só dos últimos 7 dias');
assert.deepEqual(h.counts, { products: 3, productsWithOffers: 2, liveOffers: 4, stores: 3, pre: 0, tips: 1, offersIncluded: h.offers.length });
// o que a Home mostra é igual com o resumo e com o estado completo
const vFull = homeView({ ...st, products: st.products, offers: st.offers, counts: h.counts }); const vSlim = homeView(h);
assert.deepEqual(Object.fromEntries(Object.entries(vSlim.best).map(([k, o]) => [k, o.id])), Object.fromEntries(Object.entries(vFull.best).filter(([k]) => vSlim.P.has(k)).map(([k, o]) => [k, o.id])));
assert.deepEqual(vSlim.poolList, vFull.poolList); assert.deepEqual(vSlim.wall, vFull.wall);
// nada interno: varre todas as chaves do resumo
const FORBIDDEN = /^(matchConfidence|match_confidence|sourceType|source_url|sellerId|external_id|affiliate.*|quality|text|secretNote|unmatched|rules|recentAlerts|copag|prices|password|token|legacy_id|decided_by.*|review.*)$/i;
const keys = new Set(); (function walk(x) { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) { keys.add(k); walk(v); } })(h);
assert.deepEqual([...keys].filter((k) => FORBIDDEN.test(k)), [], 'resumo da Home sem campos internos');
assert.deepEqual(Object.keys(h.reputation.lojas), ['b'], 'reputação só das lojas presentes no resumo');
// tamanho: com um estado real (se houver) ≤ 150 KB; com o fixture, mínimo
const real = ['data/state.json', 'test/.demo-state.json'].map((f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }).find((x) => x?.products?.length > 100);
if (real) { const b = Buffer.byteLength(JSON.stringify(slimHome(real, { now: Date.parse(real.generatedAt) || now }))); assert.ok(b <= 150 * 1024, `resumo da Home com dados reais: ${b} bytes`); console.log(`  resumo da Home com dados reais: ${(b / 1024).toFixed(1)} KB`); }

// ------------------------------------------------------------------ A) endpoints pelo state.json
setLegacyLoader(async () => fx());
delete process.env.API_DATABASE_URL;
const { default: api, _cache } = await import('../api/v1.mjs');
const call = async (url, method = 'GET') => { const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } }; await api({ url, method }, res); return { status: res.statusCode, headers: res.headers, json: JSON.parse(res.body) }; };
let r = await call('/api/v1/home');
assert.equal(r.status, 200); assert.equal(r.headers['X-Data-Source'], 'state'); assert.equal(r.headers['X-Cache'], 'MISS'); assert.match(r.headers['Cache-Control'], /s-maxage=60/);
r = await call('/api/v1/home'); assert.equal(r.headers['X-Cache'], 'HIT', 'segundo pedido sai do cache');
// paginação
r = await call('/api/v1/produtos?limite=2&pagina=1'); assert.equal(r.json.data.length, 2); { const { freshness, ...m } = r.json.meta; assert.deepEqual(m, { page: 1, limit: 2, total: 3, pages: 2 }); assert.equal(freshness.status, 'atual'); assert.equal(freshness.source, 'state'); }
r = await call('/api/v1/produtos?limite=2&pagina=2'); assert.equal(r.json.data.length, 1);
r = await call('/api/v1/produtos?limite=999'); assert.equal(r.json.meta.limit, 50, 'limite máximo 50');
r = await call('/api/v1/produtos?pagina=9'); assert.equal(r.json.data.length, 0); assert.equal(r.json.meta.total, 3);
// limites server-side e páginas sem duplicata/lacuna, em qualquer ordenação
r = await call('/api/v1/produtos?limite=0&pagina=0'); assert.equal(r.json.meta.page, 1); assert.ok(r.json.meta.limit >= 1, 'limite inválido vira o mínimo');
r = await call('/api/v1/produtos?limite=abc&pagina=-3'); assert.equal(r.status, 200); assert.equal(r.json.meta.page, 1);
for (const ordem of ['relevancia', 'nome', 'ofertas']) {
  const full = (await call(`/api/v1/produtos?limite=50&ordem=${ordem}`)).json.data.map((p) => p.id);
  const paged = [];
  for (let pg = 1; pg <= full.length; pg++) paged.push(...(await call(`/api/v1/produtos?limite=1&pagina=${pg}&ordem=${ordem}`)).json.data.map((p) => p.id));
  assert.deepEqual(paged, full, `páginas concatenadas = lista completa (${ordem})`);
  assert.equal(new Set(paged).size, paged.length, `sem duplicatas (${ordem})`);
}
{
  const a = (await call('/api/v1/referencias?limite=50')).json.data.map((x) => x.product.id);
  const b = (await call('/api/v1/referencias?limite=50')).json.data.map((x) => x.product.id);
  assert.deepEqual(a, b, 'referências em ordem determinística'); assert.equal(new Set(a).size, a.length);
}
r = await call('/api/v1/produtos?ordem=xpto'); assert.equal(r.status, 400);
// produto inexistente / identificador inválido / rota / método
assert.equal((await call('/api/v1/produtos/nao-existe')).status, 404);
assert.equal((await call('/api/v1/produtos/..%2F..%2Fetc')).status, 400);
assert.equal((await call('/api/v1/xyz')).status, 404);
assert.equal((await call('/api/v1/home', 'POST')).status, 405);
// inputs extremos: limites fixados, valores absurdos não quebram nem estouram
r = await call('/api/v1/produtos?limite=-5&pagina=0'); assert.equal(r.status, 200); assert.equal(r.json.meta.limit, 1); assert.equal(r.json.meta.page, 1);
r = await call('/api/v1/produtos?limite=abc&pagina=416'); assert.equal(r.status, 200); assert.equal(r.json.meta.limit, 24); assert.equal(r.json.meta.page, 416);
// teto de OFFSET (pagina × limite ≤ 10 000): página gigante (fixada em 10 000 × 24) e logo após o teto → 400; até o teto → 200
r = await call('/api/v1/produtos?limite=abc&pagina=99999999999999999999'); assert.equal(r.status, 400); assert.match(r.json.error, /10000/);
assert.equal((await call('/api/v1/produtos?pagina=417')).status, 400, '417 × 24 > 10 000');
assert.equal((await call('/api/v1/produtos?limite=50&pagina=200')).status, 200, '200 × 50 = 10 000');
for (const q of ['produtos?limite=50&pagina=201', 'produtos/me05-etb/ofertas?limite=50&pagina=201', 'referencias?limite=50&pagina=201', 'oportunidades?limite=50&pagina=201'])
  assert.equal((await call(`/api/v1/${q}`)).status, 400, q);
for (const q of ['produtos/me05-etb/ofertas?limite=50&pagina=200', 'referencias?limite=50&pagina=200', 'oportunidades?limite=50&pagina=200', 'produtos/me05-etb?pagina=10000'])
  assert.equal((await call(`/api/v1/${q}`)).status, 200, q);
r = await call('/api/v1/produtos?busca=' + 'x'.repeat(100_000)); assert.equal(r.status, 200, 'busca gigante é truncada, não rejeitada');
r = await call('/api/v1/site/ofertas?produtos=' + Array.from({ length: 200 }, (_, i) => `p${i}`).join(',')); assert.equal(r.status, 400, 'mais de 60 ids');
r = await call('/api/v1/site/produtos?limite=100000&pagina=100000'); assert.equal(r.json.limit, 60); assert.equal(r.json.page, 1000);
assert.equal((await call('/api/v1/produtos/' + 'a'.repeat(500))).status, 400, 'slug longo demais');
{ const n = _cache.size; for (let i = 0; i < 20; i++) await call(`/api/v1/produtos?limite=2&lixo=${i}`); assert.ok(_cache.size <= n + 1, 'parâmetros desconhecidos não multiplicam entradas do cache'); }
// bordas das rotas site/*: parâmetros inválidos, afiliados, HEAD, 405 e cache sem distinção de caixa
for (const q of ['modo=x', 'ordem=x', 'grupo=x', 'max=abc', 'max=-1', 'max=1e3']) assert.equal((await call(`/api/v1/site/produtos?${q}`)).status, 400, q);
r = await call('/api/v1/afiliados'); assert.equal(r.status, 200); assert.ok(r.headers['Cache-Control']);
assert.ok((await call('/api/v1/home', 'HEAD')).status < 500, 'HEAD sem 5xx');
r = await call('/api/v1/produtos', 'DELETE'); assert.equal(r.status, 405); assert.equal(r.headers.Allow, 'GET, HEAD');
{ _cache.clear(); const a = await call('/api/v1/produtos/ME05-ETB'); const n = _cache.size; const b = await call('/api/v1/produtos/me05-etb');
  assert.equal(_cache.size, n, 'ABC e abc usam uma entrada só'); assert.equal(b.headers['X-Cache'], 'HIT'); assert.deepEqual(a.json, b.json); }
// prazo total: fonte que não responde vira 503 curto com Retry-After (não deixa o pedido pendurado até a plataforma matar a função)
{
  setLegacyLoader(() => new Promise(() => {}));
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  const t0 = Date.now(); await api({ url: '/api/v1/produtos?pagina=77', method: 'GET' }, res, { deadlineMs: 50 });
  assert.equal(res.statusCode, 503); assert.equal(res.headers['Retry-After'], '5'); assert.equal(res.headers['Cache-Control'], 'no-store'); assert.ok(Date.now() - t0 < 2000);
  setLegacyLoader(async () => fx());
}
// preço atual, estoque, referência (state)
r = await call('/api/v1/produtos/me05-etb'); const ps = r.json.data.stats;
assert.equal(ps.market.current_price, 360, 'menor preço com estoque e confirmado (od não confirmada fica de fora)'); assert.equal(ps.market.current_total_price, 380);
assert.equal(ps.coverage.in_stock_offers, 2); assert.deepEqual(ps.reference, { value: 400, status: 'verified', source: null, verified_at: null });
r = await call('/api/v1/produtos/me05-booster'); assert.equal(r.json.data.references.length, 0); assert.equal(r.json.data.stats.reference, null, 'sem referência');
r = await call('/api/v1/produtos/sv9-lata'); assert.equal(r.json.data.stats.status, 'no_offers'); assert.equal(r.json.data.stats.market.current_price, null, 'sem ofertas');
assert.equal(r.json.data.references[0].status, 'pending');
r = await call('/api/v1/produtos/me05-etb/ofertas?limite=10'); assert.equal(r.json.meta.total, 5);
assert.equal(r.json.data.find((o) => o.id === 'oa').total_price, null, 'frete desconhecido: total nulo, nunca o preço');
r = await call('/api/v1/oportunidades'); assert.equal(r.status, 200); assert.equal(r.json.meta.status, 'requires_db'); assert.deepEqual(r.json.data, []);
assert.equal((await call('/api/v1/oportunidades?faixa=otima')).status, 400); assert.equal((await call('/api/v1/oportunidades?ofertas=x')).status, 400);
// filtros novos da página (loja, preço máximo, preço por booster) e lista de lojas
assert.equal((await call('/api/v1/oportunidades?loja=../x')).status, 400); assert.equal((await call('/api/v1/oportunidades?max=-1')).status, 400);
assert.equal((await call('/api/v1/oportunidades?max=abc')).status, 400); assert.equal((await call('/api/v1/oportunidades?ordem=booster&loja=moxland&max=300')).status, 200);
// números estritos: sem sufixo, hexa, expoente ou Infinity (#313); ausentes e válidos seguem como antes
for (const bad of ['minimo=abc', 'minimo=10abc', 'abaixo=x', 'abaixo=20%25', 'confianca_minima=abc', 'confianca_minima=50x', 'max=0x10', 'max=1e3', 'max=Infinity', 'max=12,5'])
  assert.equal((await call('/api/v1/oportunidades?' + bad)).status, 400, bad);
for (const ok of ['minimo=70', 'abaixo=20', 'confianca_minima=60', 'minimo=150&abaixo=-5', 'minimo=', 'max=12.5', 'max=0', 'max=250'])
  assert.equal((await call('/api/v1/oportunidades?' + ok)).status, 200, ok);
for (const bad of ['max=0x10', 'max=1e3', 'max=12,5']) assert.equal((await call('/api/v1/site/produtos?' + bad)).status, 400, bad);
assert.equal((await call('/api/v1/site/produtos?max=12.5')).status, 200, 'max=12.5');
r = await call('/api/v1/oportunidades/lojas'); assert.equal(r.status, 200); assert.deepEqual(r.json.data, []); assert.equal(r.json.meta.status, 'requires_db');
r = await call('/api/v1/referencias?status=verified'); assert.equal(r.json.data.length, 1);


// ------------------------------------------------------------------ A) FASE 4 — páginas do site (state.json)
// lista de produtos: filtros, ordenação, paginação, "sem preço sugerido" sob demanda
r = await call('/api/v1/site/produtos'); assert.equal(r.status, 200); assert.equal(r.headers['X-Data-Source'], 'state');
assert.deepEqual(r.json.items.map((e) => e.p.id), ['me05-etb'], 'modo guardar: só produto com referência');
assert.equal(r.json.items[0].o.id, 'od', 'melhor oferta: menor preço com estoque (od R$ 340; como no site, "viva" não exige confirmação)');
assert.equal(r.json.noCopagCount, 1); assert.equal(r.json.noCopag, undefined, 'lista sem referência não vem na 1ª carga');
assert.deepEqual(r.json.facets.groups, [['Boosters', 1], ['ETB', 1]]); assert.ok(r.json.facets.stores.some(([id]) => id === 'mercadolivre'));
r = await call('/api/v1/site/produtos?semref=1'); assert.deepEqual(r.json.items.map((e) => e.p.id), ['me05-booster']);
r = await call('/api/v1/site/produtos?modo=abrir&ordem=ppb'); assert.deepEqual(r.json.items.map((e) => e.p.id), ['me05-booster', 'me05-etb'], 'abrir: por preço por booster');
r = await call('/api/v1/site/produtos?modo=abrir&limite=1&pagina=2'); assert.equal(r.json.items.length, 1); assert.equal(r.json.pages, 2); assert.equal(r.json.total, 2);
r = await call('/api/v1/site/produtos?loja=b'); assert.equal(r.json.items[0].o.id, 'ob', 'filtro de loja: a melhor oferta daquela loja (empate de total com oa desfeito pelo Deal Score)');
r = await call('/api/v1/site/produtos?max=300'); assert.equal(r.json.total, 0, 'preço até R$ 300: nenhuma ETB com estoque');
r = await call('/api/v1/site/produtos?estoque=0&loja=rihappycombr'); assert.equal(r.json.total, 0, 'sem estoque negado: oferta sem estoque (oc) não entra');
r = await call('/api/v1/site/produtos?grupo=Latas'); assert.equal(r.json.total, 0, 'produto sem oferta não aparece na lista');
for (const bad of ['modo=x', 'ordem=x', 'grupo=x', 'max=-1', 'max=Infinity', 'max=abc']) assert.equal((await call('/api/v1/site/produtos?' + bad)).status, 400, bad);
// produto: ofertas, frete, referência, pistas; inexistente; sem ofertas
r = await call('/api/v1/site/produto/me05-etb'); const sp = r.json;
assert.equal(sp.offers.length, 5); assert.equal(sp.liveCount, 3); assert.equal(sp.product.msrp, 400);
assert.equal(sp.offers.find((o) => o.id === 'ob').shipping, 20); assert.ok(!sp.offers.find((o) => o.id === 'oa').shippingKnown, 'frete desconhecido continua desconhecido');
assert.equal(sp.tips.length, 1); assert.equal(sp.tips[0].text, undefined, 'pista sem texto bruto');
assert.equal((await call('/api/v1/site/produto/nao-existe')).status, 404);
r = await call('/api/v1/site/produto/sv9-lata'); assert.equal(r.status, 200); assert.deepEqual(r.json.offers, []); assert.equal(r.json.product.copagReference, 99.9);
// coleção, tipo e busca: só as ofertas candidatas
r = await call('/api/v1/site/ofertas?colecao=me05'); assert.deepEqual(r.json.offers.map((o) => o.id).sort(), ['oc', 'od', 'of'], 'melhor com estoque (od), menor de todas para o cartão sem estoque (oc), booster (of)');
assert.equal(r.json.liveCount['me05-etb'], 3);
r = await call('/api/v1/site/ofertas?tipo=lata'); assert.deepEqual(r.json.offers, []);
r = await call('/api/v1/site/ofertas?busca=etb%20barata&produtos=me05-etb'); assert.equal(r.json.tips.length, 1);
assert.equal((await call('/api/v1/site/ofertas')).status, 400);

console.log('OK — API v1 (state.json); a parte de banco está em api-db-tests.js');
