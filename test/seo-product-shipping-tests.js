// Issue #84 (continuação da #182) + Lote D (SEO) — SEO da página do produto (api/pagina.mjs).
// Lote D (decisão do dono): título, descrição, og: e AggregateOffer.lowPrice usam o MENOR PREÇO VISÍVEL na tabela
// "Onde comprar" (a oferta com estoque mais barata, Pix incluído e sinalizado); sem frete informado, diz "frete a calcular".
// A regra #84 ("menor total com frete comparável": frete conhecido compara pelo total; frete desconhecido nunca vence frete
// conhecido) continua no corpo como frase própria e segue ordenando a tabela e a lista de /produtos (bestBy).
// Nunca se inventa frete (sem shippingDetails/shippingRate). Estoque desconhecido não vira "com estoque" nem "sem estoque";
// produto sem oferta com estoque segue com noindex (#141). Sem rede: o state.json vem de um fetch falso, em processo separado.
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0;
async function t(name, fn) { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } }
const NOW = Date.parse('2026-10-09T18:00:00.000Z');
const T = new Date(NOW - 5 * 6e4).toISOString();

const off = (id, productId, price, ship, extra = {}) => ({ id, productId, storeId: 's-' + id, storeName: 'Loja ' + id, title: 'ETB', url: 'https://x.com.br/' + id,
  price, priceKind: 'base', shipping: ship, shippingKnown: ship != null, total: ship != null ? price + ship : price, stock: 'IN_STOCK', confirmed: true,
  anomalous: false, stale: false, discount: null, matchConfidence: 0.95, firstSeen: T, source_timestamp: T, ...extra });
const prod = (id, name) => ({ id, collection: 'c-' + id, collectionName: name, type: 'etb', typeLabel: 'Treinador Avançado (ETB)', group: 'ETB', boosters: 9,
  copagConfirmed: true, msrp: 400, offerCount: 2 });
const state = (products, offers) => ({ generatedAt: T, coverage: { found: offers.length }, totals: { offers: offers.length }, products, offers,
  collections: products.map((p) => ({ id: p.collection, name: p.collectionName, series: 'Teste', aliases: [], products: 1 })),
  types: [{ id: 'etb', label: 'Treinador Avançado (ETB)', group: 'ETB', products: products.length }],
  sources: [], activity: [], tips: [], bestDeals: [] });

// p1 = exemplo da issue: A R$ 100 com frete desconhecido × B R$ 105 com frete grátis
// p2 = só frete desconhecido: C R$ 90 e D R$ 80 → menor preço (D), "frete a calcular"
// p3 = frete pago conhecido: E 100+30, F 110+10 e G R$ 60 com frete desconhecido → F (R$ 120) pelo total
// p4 = só estoque desconhecido → nenhuma oferta com estoque confirmado: noindex (#141), sem preço
const P = [prod('p1', 'Alfa'), prod('p2', 'Beta'), prod('p3', 'Gama'), prod('p4', 'Delta')];
const O = [off('a', 'p1', 100, null), off('b', 'p1', 105, 0), off('c', 'p2', 90, null), off('d', 'p2', 80, null),
  off('e', 'p3', 100, 30), off('f', 'p3', 110, 10), off('g', 'p3', 60, null), off('h', 'p4', 50, 0, { stock: 'UNKNOWN' })];

function render(queries) {
  const script = `import { setFreshnessClock } from ${JSON.stringify(pathToFileURL(path.join(root, 'api/_lib/freshness.mjs')).href)};
    setFreshnessClock(() => ${NOW}); const st = JSON.parse(process.argv[1]);
    globalThis.fetch = async () => new Response(JSON.stringify(st), { status: 200 });
    const { default: h } = await import(${JSON.stringify(pathToFileURL(path.join(root, 'api/pagina.mjs')).href)});
    const out = {};
    for (const q of JSON.parse(process.argv[2])) {
      const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
      await h({ url: '/api/pagina?' + q, headers: { host: 'x' } }, res);
      out[q] = { status: res.statusCode, body: res.body };
    }
    console.log(JSON.stringify(out));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script, JSON.stringify(state(P, O)), JSON.stringify(queries)],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, API_DATABASE_URL: '' } });
  if (r.status !== 0) throw new Error(`falha ao renderizar (status ${r.status}, ${r.signal || r.error || ''}): ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}
const meta = (h, re) => (h.match(re) || [])[1] || '';
const parse = (body) => ({
  title: meta(body, /<title>([^<]*)<\/title>/), desc: meta(body, /<meta name="description" content="([^"]*)">/),
  ogTitle: meta(body, /<meta property="og:title" content="([^"]*)">/), ogDesc: meta(body, /<meta property="og:description" content="([^"]*)">/),
  ld: [...body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1])),
  ssr: (body.match(/<div class="ssr">([\s\S]*?)<\/div><\/div>/) || [])[1] || '', noindex: body.includes('<meta name="robots" content="noindex">'), body,
});
const product = (pg) => pg.ld.find((x) => x['@type'] === 'Product');
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

const out = render(['t=produto&slug=p1', 't=produto&slug=p2', 't=produto&slug=p3', 't=produto&slug=p4', 't=produtos']);
const pg = Object.fromEntries(Object.entries(out).map(([q, r]) => [q, { status: r.status, ...parse(r.body) }]));

await t('1. A R$ 100 (frete desconhecido) × B R$ 105 (frete grátis): título/descrição/lowPrice = menor preço visível (A); menor total comparável (B) no corpo', () => {
  const p = pg['t=produto&slug=p1'];
  assert.equal(p.status, 200); assert.equal(p.noindex, false);
  assert.match(p.title, /a partir de R\$ 100,00 \(frete a calcular\)/); assert.doesNotMatch(p.title, /R\$ 105,00/);
  assert.match(p.desc, /a partir de R\$ 100,00 \(frete a calcular\) em Loja a/); assert.doesNotMatch(p.desc, /R\$ 105,00|Loja b/);
  assert.ok(p.desc.length <= 160, 'descrição de até 160 caracteres');
  assert.equal(p.ogTitle, p.title); assert.equal(p.ogDesc, p.desc);
  const ao = product(p).offers;
  assert.equal(ao['@type'], 'AggregateOffer'); assert.equal(ao.lowPrice, 100, 'lowPrice = menor preço visível na tabela (A)');
  assert.equal(ao.lowPrice, Math.min(...ao.offers.map((o) => o.price)), 'lowPrice bate com o menor Offer listado');
  assert.ok(ao.highPrice >= ao.lowPrice, 'highPrice nunca abaixo do lowPrice'); assert.equal(ao.offerCount, 2);
  assert.equal(ao.availability, undefined, 'availability sai do AggregateOffer');
  assert.deepEqual(ao.offers.map((o) => [o['@type'], o.price, o.availability, o.seller.name]), [['Offer', 105, 'https://schema.org/InStock', 'Loja b'], ['Offer', 100, 'https://schema.org/InStock', 'Loja a']], 'cada Offer listada com availability, na ordem da tabela');
  assert.match(product(p).description, /R\$ 100,00/);
  const ssr = text(p.ssr);
  assert.match(ssr, /Menor preço com estoque agora, frete a calcular: R\$ 100,00 em Loja a\./);
  assert.match(ssr, /Menor total com frete comparável: R\$ 105,00 \(frete grátis\) em Loja b\./, 'regra #84 segue no corpo, em frase própria');
  assert.match(ssr, /Loja b R\$ 105,00 \(frete grátis\) Loja a R\$ 100,00 \(frete a calcular\)/, 'tabela: B antes de A (#84); A sem total inventado');
  const bcl = p.ld.find((x) => x['@type'] === 'BreadcrumbList').itemListElement.map((i) => i.name);
  assert.deepEqual(bcl, ['Início', 'Alfa', 'Treinador Avançado (ETB)', 'Treinador Avançado (ETB) Alfa'], 'último item do caminho = produto, não o formato de novo');
});

await t('2. só frete desconhecido: menor preço dizendo "frete a calcular", sem frete nem total inventado; sem segunda frase (é a mesma oferta)', () => {
  const p = pg['t=produto&slug=p2'];
  assert.match(p.title, /a partir de R\$ 80,00 \(frete a calcular\)/);
  assert.match(p.desc, /a partir de R\$ 80,00 \(frete a calcular\) em Loja d/); assert.doesNotMatch(p.desc, /frete grátis|com frete|total/i);
  const ao = product(p).offers; assert.equal(ao.lowPrice, 80); assert.equal(ao.highPrice, 90);
  assert.equal(ao.lowPrice, Math.min(...ao.offers.map((o) => o.price)));
  assert.match(text(p.ssr), /Menor preço com estoque agora, frete a calcular: R\$ 80,00 em Loja d/);
  assert.doesNotMatch(text(p.ssr), /frete grátis|com frete|Menor total com frete comparável/);
});

await t('3. frete pago conhecido: título/lowPrice = menor preço visível (G, frete a calcular); menor total comparável (F, R$ 120) no corpo; tabela pela #84', () => {
  const p = pg['t=produto&slug=p3'];
  assert.match(p.title, /a partir de R\$ 60,00 \(frete a calcular\)/); assert.doesNotMatch(p.title, /R\$ 120,00/);
  assert.match(p.desc, /a partir de R\$ 60,00 \(frete a calcular\) em Loja g/);
  const ao = product(p).offers; assert.equal(ao.lowPrice, 60); assert.equal(ao.highPrice, 130);
  assert.equal(ao.lowPrice, Math.min(...ao.offers.map((o) => o.price)));
  assert.match(text(p.ssr), /Menor total com frete comparável: R\$ 120,00 \(com frete\) em Loja f\./);
  assert.match(text(p.ssr), /Loja f R\$ 120,00 \(com frete\) Loja e R\$ 130,00 \(com frete\) Loja g R\$ 60,00 \(frete a calcular\)/);
});

await t('4. JSON-LD nunca declara frete: sem shippingDetails/shippingRate, nem para frete desconhecido', () => {
  for (const q of ['t=produto&slug=p1', 't=produto&slug=p2', 't=produto&slug=p3']) {
    const ld = JSON.stringify(pg[q].ld);
    assert.doesNotMatch(ld, /shippingDetails|shippingRate|OfferShippingDetails/, q);
  }
});

await t('5. só estoque desconhecido: segue noindex (#141), sem preço e sem dizer que está esgotado', () => {
  const p = pg['t=produto&slug=p4'];
  assert.equal(p.status, 200); assert.equal(p.noindex, true);
  assert.equal(product(p).offers, undefined, 'sem AggregateOffer'); assert.doesNotMatch(p.title + p.desc, /R\$ 50,00/);
  assert.match(text(p.ssr), /Nenhuma loja acompanhada tem estoque confirmado deste produto agora/);
});

await t('6. /produtos: melhor oferta de cada produto pela mesma regra (B em p1, F em p3)', () => {
  const s = text(pg['t=produtos'].ssr);
  assert.match(s, /Alfa · Treinador Avançado \(ETB\) — R\$ 105,00 em Loja b/); assert.doesNotMatch(s, /Loja a/);
  assert.match(s, /Gama · Treinador Avançado \(ETB\) — R\$ 120,00 em Loja f/); assert.doesNotMatch(s, /Loja g/);
  assert.match(s, /Beta · Treinador Avançado \(ETB\) — R\$ 80,00 em Loja d/); assert.doesNotMatch(s, /Delta/);
});

console.log(`✓ SEO da página do produto com frete (issue #84 + Lote D): ${n} grupos de testes passaram`);
await import('./seo-lote-c-tests.js');
