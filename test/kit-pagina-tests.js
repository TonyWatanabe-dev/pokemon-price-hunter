// Monte seu kit (K3): página protótipo oculta + rota /api/v1/site/kit. Fora do índice e do menu até o critério de §6.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const html = read('kit.html'); const js = read('assets/web/kit-v1.js'); const index = read('index.html');
const vj = JSON.parse(read('vercel.json'));
assert.ok(vj.rewrites.some((r) => r.source === '/monte-seu-kit' && r.destination === '/kit.html'));
assert.ok(vj.rewrites.some((r) => r.source === '/monte-seu-kit/:passo*' && r.destination === '/kit.html'), 'etapas viram caminho (funil no Analytics)');
assert.match(JSON.parse(read('package.json')).scripts.build, /\bkit\.html\b/, 'build copia kit.html');
assert.match(vj.functions['api/v1.mjs'].includeFiles, /config\/frete-gratis\.json/, 'função leva a regra de frete grátis');
assert.match(html, /<meta name="robots" content="noindex, nofollow">/, 'protótipo fora do índice');
assert.match(html, /Protótipo em teste/); assert.match(html, /Sua jornada <span>Pokémon<\/span> começa aqui/);
assert.doesNotMatch(html.replace(/<script[^>]*\ssrc="[^"]+"[^>]*><\/script>/g, ''), /<script/i, 'sem script inline (CSP)');
assert.doesNotMatch(index, /monte-seu-kit/, 'ainda fora do menu e da Home (K6)');
assert.doesNotMatch(JSON.stringify(vj.rewrites.filter((r) => /sitemap/.test(r.source))), /kit/);
assert.doesNotMatch(read('api/sitemap.mjs'), /monte-seu-kit/, 'fora do sitemap');
assert.match(js, /\/api\/v1\/site\/kit\?/, 'preço vem da API'); assert.match(js, /sessionStorage/); assert.match(js, /try \{ sessionStorage/);
assert.match(js, /rel="noopener nofollow"/);
assert.doesNotMatch(js + html, /rara|raridade|chance|garantid|probabilidade/i, 'sem promessa de carta');

// rota da API com estado sintético
const { setLegacyLoader } = await import('../api/_lib/legacy.mjs');
const now = new Date().toISOString();
const st = { generatedAt: now, collections: [{ id: 'xx1', name: 'X' }], products: [{ id: 'xx1-blister3', collection: 'xx1', type: 'blister_3', name: 'X - Blister Triplo', offerCount: 1 }, { id: 'xx1-deck', collection: 'xx1', type: 'deck', name: 'X - Baralho', offerCount: 1 }],
  offers: [{ id: 'o1', productId: 'xx1-blister3', storeId: 'a', storeName: 'A', price: 30, total: 30, stock: 'IN_STOCK', url: 'https://a.test/b3', source_timestamp: now, shippingKnown: false },
    { id: 'o2', productId: 'xx1-deck', storeId: 'b', storeName: 'B', price: 80, total: 95, shipping: 15, shippingKnown: true, stock: 'IN_STOCK', url: 'https://b.test/d', source_timestamp: now }], sources: {} };
setLegacyLoader(async () => st);
delete process.env.API_DATABASE_URL;
const { default: api } = await import('../api/v1.mjs');
const call = async (url) => { const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } }; await api({ url, method: 'GET' }, res); return { status: res.statusCode, json: JSON.parse(res.body) }; };
let r = await call('/api/v1/site/kit?objetivo=colecionar&orcamento=100&idioma=pt&fonte=state');
assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.prototipo, true);
assert.deepEqual(r.json.itens.map((i) => [i.productId, i.quantidade]), [['xx1-blister3', 3]]); assert.equal(r.json.total, null);
r = await call('/api/v1/site/kit?objetivo=jogar&orcamento=100&idioma=pt&fonte=state'); assert.equal(r.json.total, 95);
assert.ok(r.json.itens.every((i) => typeof i.nome === 'string' && i.nome.length > 3), 'todo item tem nome');
// produto sem `name` (como na fonte do banco) e state do robô indisponível: rótulo, nunca erro
{ const semNome = structuredClone(st); semNome.products.forEach((p) => { delete p.name; p.collectionName = 'X'; p.typeLabel = p.type === 'deck' ? 'Baralho de Batalha' : 'Blister Triplo'; });
  let n = 0; setLegacyLoader(async () => { if (n++) throw new Error('indisponível'); return semNome; });
  const { _cache } = await import('../api/v1.mjs'); _cache?.clear?.();
  const { clearCatalogCache } = await import('../api/_lib/catalog.mjs'); clearCatalogCache();
  const rr = await call('/api/v1/site/kit?objetivo=jogar&orcamento=100&idioma=pt&fonte=state&x=1');
  assert.equal(rr.status, 200, JSON.stringify(rr.json)); assert.equal(rr.json.itens[0].nome, 'X - Baralho de Batalha'); }
assert.equal((await call('/api/v1/site/kit?objetivo=voar&orcamento=10')).status, 400);
assert.equal((await call('/api/v1/site/kit?objetivo=jogar&orcamento=0')).status, 400);
assert.equal((await call('/api/v1/site/kit?objetivo=jogar&orcamento=50&idioma=xx')).status, 400);
assert.equal((await call('/api/v1/site/kit?objetivo=proteger&fonte=state')).status, 200, 'proteger sem orçamento: limitação, não erro');
console.log('✓ kit-pagina: rota oculta, sem índice/menu, API com validação e total honesto');
