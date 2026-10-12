// Lote E — conteúdo SEO (api/pagina.mjs, api/sitemap.mjs, api/_lib/guia.mjs, vercel.json, index.html):
// /como-funciona com o guia completo (um h2 por seção) e perguntas frequentes (FAQPage); /tipo/blister reunindo os
// formatos de blister; /guia/glossario com DefinedTermSet; os dois no sitemap. Sem rede: state.json vem de um fetch falso.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0;
async function t(name, fn) { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } }
const NOW = Date.parse('2026-10-12T18:00:00.000Z');
const T = new Date(NOW - 5 * 6e4).toISOString();

const off = (id, productId, price, ship, extra = {}) => ({ id, productId, storeId: 's-' + id, storeName: 'Loja ' + id, title: 'x', url: 'https://x.com.br/' + id,
  price, priceKind: 'base', shipping: ship, shippingKnown: ship != null, total: ship != null ? price + ship : price, stock: 'IN_STOCK', confirmed: true,
  anomalous: false, stale: false, discount: null, matchConfidence: 0.95, firstSeen: T, source_timestamp: T, ...extra });
const prod = (id, col, colName, type, typeLabel, extra = {}) => ({ id, collection: col, collectionName: colName, type, typeLabel, group: typeLabel, boosters: null,
  copagConfirmed: false, msrp: null, offerCount: 1, ...extra });
const P = [
  prod('b1', 'c1', 'Alfa', 'blister_1', 'Blister Unitário', { copagConfirmed: true, msrp: 30 }),
  prod('b3', 'c1', 'Alfa', 'blister_3', 'Blister Triplo', { copagConfirmed: true, msrp: 90 }),
  prod('b4', 'c2', 'Beta', 'blister_4', 'Blister Quádruplo', { copagConfirmed: true, msrp: 120 }),
  prod('e1', 'c1', 'Alfa', 'etb', 'Treinador Avançado (ETB)', { copagConfirmed: true, msrp: 400 }),
];
const O = [off('a', 'b1', 25, 0, { discount: 0.1667 }), off('b', 'b3', 80, 10, { discount: 0 }), off('c', 'b4', 100, 0, { priceKind: 'pix', discount: 0.1667 }), off('d', 'e1', 350, 0, { discount: 0.125 })];
const state = { generatedAt: T, coverage: { found: O.length }, totals: { offers: O.length }, products: P, offers: O,
  collections: [{ id: 'c1', name: 'Alfa', series: 'S', aliases: [], products: 3 }, { id: 'c2', name: 'Beta', series: 'S', aliases: [], products: 1 }],
  types: [{ id: 'etb', label: 'Treinador Avançado (ETB)', group: 'ETB', products: 1 }, { id: 'blister_1', label: 'Blister Unitário', group: 'Blisters', products: 1 },
    { id: 'blister_2', label: 'Blister Duplo', group: 'Blisters', products: 0 }, { id: 'blister_3', label: 'Blister Triplo', group: 'Blisters', products: 1 }, { id: 'blister_4', label: 'Blister Quádruplo', group: 'Blisters', products: 1 }],
  sources: [], activity: [], tips: [], bestDeals: [] };

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
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const links = (h) => [...h.matchAll(/<a href="([^"]*)"/g)].map((m) => m[1]);

const Q = ['t=como-funciona', 't=tipo&slug=blister', 't=glossario', 't=tipo&slug=blister-triplo'];
const out = render(Q);
const pg = Object.fromEntries(Q.map((q) => [q, { status: out[q].status, ...parse(out[q].body) }]));
const SAMPLES = process.env.SEO_SAMPLES_DIR;
if (SAMPLES) { fs.mkdirSync(SAMPLES, { recursive: true }); for (const q of Q) fs.writeFileSync(path.join(SAMPLES, q.replace(/[^a-z0-9]+/gi, '_') + '.html'), out[q].body); fs.writeFileSync(path.join(SAMPLES, 'sitemap.xml'), out.sitemap); }

await t('1. /como-funciona: guia completo com 6+ h2, FAQPage com 6+ perguntas (as mesmas do HTML), descrição ≤160, link para o glossário', () => {
  const p = pg['t=como-funciona']; assert.equal(p.status, 200); assert.equal(p.noindex, false);
  assert.equal(p.canonical, 'https://tcg-price-hunter.vercel.app/como-funciona');
  assert.ok(p.desc.length > 60 && p.desc.length <= 160, p.desc.length);
  const h2 = [...p.ssr.matchAll(/<h2>([^<]*)<\/h2>/g)].map((m) => m[1]);
  assert.ok(h2.length >= 6, `h2: ${h2.length}`); assert.ok(h2.includes('Perguntas frequentes') && h2.includes('Opportunity Score (0 a 100)') && h2.includes('Preço sugerido Copag'));
  const s = text(p.ssr);
  assert.match(s, /Excelente oportunidade 90 a 100 Boa oportunidade 75 a 89 Oportunidade normal 50 a 74 Oportunidade baixa 0 a 49/);
  const faq = p.ld.find((x) => x['@type'] === 'FAQPage'); assert.ok(faq, 'FAQPage');
  assert.ok(faq.mainEntity.length >= 6);
  for (const q of faq.mainEntity) { assert.equal(q['@type'], 'Question'); assert.ok(q.acceptedAnswer.text.length > 80); assert.ok(s.includes(q.name), q.name); assert.doesNotMatch(q.acceptedAnswer.text, /</); }
  const h3 = [...p.ssr.matchAll(/<h3>([^<]*)<\/h3>/g)].map((m) => m[1]);
  assert.deepEqual(h3, faq.mainEntity.map((q) => q.name), 'perguntas do HTML = perguntas do JSON-LD');
  assert.ok(links(p.ssr).includes('/guia/glossario'));
  assert.deepEqual(p.ld.find((x) => x['@type'] === 'BreadcrumbList').itemListElement.map((i) => i.name), ['Início', 'Como funciona o TCG Price Hunter']);
});

await t('2. /tipo/blister: reúne produtos de 2+ formatos de blister, com melhor preço e links para cada formato; o formato real segue existindo', () => {
  const p = pg['t=tipo&slug=blister']; assert.equal(p.status, 200); assert.equal(p.noindex, false);
  assert.equal(p.title, 'Blister Pokémon TCG: preços e onde comprar mais barato | TCG Price Hunter');
  assert.equal(p.canonical, 'https://tcg-price-hunter.vercel.app/tipo/blister');
  assert.ok(p.desc.length <= 160 && /Blister Pokémon TCG lacrado/.test(p.desc) && /3 produtos/.test(p.desc) && /a partir de R\$ 25,00/.test(p.desc), p.desc);
  const s = text(p.ssr);
  assert.match(s, /Alfa · Blister Unitário — R\$ 25,00 em Loja a · Copag R\$ 30,00/);
  assert.match(s, /Alfa · Blister Triplo — R\$ 90,00 em Loja b · Copag R\$ 90,00/);
  assert.match(s, /Beta · Blister Quádruplo — R\$ 100,00 no Pix em Loja c · Copag R\$ 120,00/);
  assert.doesNotMatch(s, /Treinador Avançado \(ETB\) — /, 'ETB fora');
  const l = links(p.ssr);
  for (const u of ['/tipo/blister-unitario', '/tipo/blister-triplo', '/tipo/blister-quadruplo', '/produto/alfa-blister-unitario', '/produto/beta-blister-quadruplo']) assert.ok(l.includes(u), u);
  assert.ok(!l.includes('/tipo/blister-duplo'), 'formato sem produto com oferta não vira link');
  assert.match(s, /Por tipo de blister Blister Unitário \(1\) Blister Triplo \(1\) Blister Quádruplo \(1\)/);
  const cp = p.ld.find((x) => x['@type'] === 'CollectionPage'); assert.equal(cp.mainEntity.itemListElement.length, 3);
  assert.equal(pg['t=tipo&slug=blister-triplo'].status, 200); assert.match(text(pg['t=tipo&slug=blister-triplo'].ssr), /^Início › Blister Triplo Blister Triplo Pokémon TCG/);
});

await t('3. /guia/glossario: DefinedTermSet com 15+ termos, iguais aos do HTML (dl/dt/dd), descrição ≤160, caminho e links', () => {
  const p = pg['t=glossario']; assert.equal(p.status, 200); assert.equal(p.noindex, false);
  assert.equal(p.canonical, 'https://tcg-price-hunter.vercel.app/guia/glossario'); assert.ok(p.desc.length <= 160 && p.desc.length > 60);
  assert.match(p.title, /^Glossário de Pokémon TCG lacrado/);
  const set = p.ld.find((x) => x['@type'] === 'DefinedTermSet'); assert.ok(set, 'DefinedTermSet');
  assert.ok(set.hasDefinedTerm.length >= 15, set.hasDefinedTerm.length);
  const dts = [...p.ssr.matchAll(/<dt id="([^"]*)">([^<]*)<\/dt>/g)];
  assert.deepEqual(dts.map((m) => m[2]), set.hasDefinedTerm.map((x) => x.name));
  for (const [i, x] of set.hasDefinedTerm.entries()) { assert.equal(x['@type'], 'DefinedTerm'); assert.equal(x.url, `https://tcg-price-hunter.vercel.app/guia/glossario#${dts[i][1]}`); assert.ok(x.description.length > 40); }
  assert.ok(links(p.ssr).includes('/como-funciona') && links(p.ssr).includes('/colecao/alfa') && links(p.ssr).includes('/tipo/blister-triplo'));
  assert.deepEqual(p.ld.find((x) => x['@type'] === 'BreadcrumbList').itemListElement.map((i) => i.name), ['Início', 'Glossário de Pokémon TCG lacrado']);
});

await t('4. sitemap com /tipo/blister (lastmod dos blisters) e /guia/glossario; vercel.json reescreve /guia/glossario', () => {
  const sm = out.sitemap;
  assert.match(sm, /<loc>https:\/\/tcg-price-hunter.vercel.app\/tipo\/blister<\/loc><lastmod>2026-10-12<\/lastmod>/);
  assert.match(sm, /<loc>https:\/\/tcg-price-hunter.vercel.app\/guia\/glossario<\/loc>/);
  assert.match(sm, /\/tipo\/blister-triplo</); assert.doesNotMatch(sm, /\/tipo\/blister-duplo</);
  const v = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  assert.equal(Object.fromEntries(v.rewrites.map((r) => [r.source, r.destination]))['/guia/glossario'], '/api/pagina?t=glossario');
  // Sem nenhum formato de blister, /tipo/blister é 404 e não entra no sitemap.
  const st2 = { ...state, products: P.filter((p) => p.type === 'etb'), offers: O.filter((o) => o.productId === 'e1'), types: state.types.filter((t) => t.id === 'etb') };
  const o2 = render(['t=tipo&slug=blister'], st2);
  assert.equal(o2['t=tipo&slug=blister'].status, 404); assert.doesNotMatch(o2.sitemap, /\/tipo\/blister/);
});

console.log(`✓ SEO Lote E: ${n} grupos de testes passaram`);
