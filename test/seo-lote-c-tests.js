// Lote C — SEO rápido (api/pagina.mjs, api/sitemap.mjs, vercel.json, index.html photo()):
// /oportunidades sem banco lista a melhor oferta com estoque de cada produto (state.json) e, com /pre-vendas, traz links
// para coleções/formatos; /precos lista todo produto com preço sugerido, por coleção, dizendo oficial × referência, com
// fonte e data; /termos e /privacidade têm título/canonical próprios; rotas privadas saem noindex (X-Robots-Tag);
// descrições de até 160 caracteres; sitemap com lastmod por produto; imagens dos cards com alt, width/height e lazy.
// Sem rede: o state.json vem de um fetch falso, num processo separado.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0;
async function t(name, fn) { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } }
const NOW = Date.parse('2026-10-09T18:00:00.000Z');
const T = new Date(NOW - 5 * 6e4).toISOString();
const D1 = '2026-10-08T10:00:00.000Z', D2 = '2026-10-09T17:30:00.000Z';

const off = (id, productId, price, ship, extra = {}) => ({ id, productId, storeId: 's-' + id, storeName: 'Loja ' + id, title: 'x', url: 'https://x.com.br/' + id,
  price, priceKind: 'base', shipping: ship, shippingKnown: ship != null, total: ship != null ? price + ship : price, stock: 'IN_STOCK', confirmed: true,
  anomalous: false, stale: false, discount: null, matchConfidence: 0.95, firstSeen: T, source_timestamp: T, ...extra });
const prod = (id, col, colName, type, typeLabel, extra = {}) => ({ id, collection: col, collectionName: colName, type, typeLabel, group: typeLabel, boosters: null,
  copagConfirmed: false, msrp: null, offerCount: 1, ...extra });
const P = [
  prod('p1', 'c1', 'Alfa', 'etb', 'Treinador Avançado (ETB)', { copagConfirmed: true, msrp: 400, copag: { msrp: 400, source_url: 'https://www.copagloja.com.br/etb-alfa/p', source_timestamp: D2, confidence: 'OFICIAL', msrp_updated_at: D1 } }),
  prod('p2', 'c1', 'Alfa', 'booster_box', 'Booster Box', { boosters: 36, msrp: 900, copagConfirmed: false, copagReference: 'lojas (referência)', copagReferenceUrl: 'https://ref.example/box', lastSeen: D2 }),
  prod('p5', 'c1', 'Alfa', 'etb', 'Treinador Avançado (ETB)', { copagConfirmed: true, msrp: 410, copag: { msrp: 410, source_url: 'javascript:alert(1)', source_timestamp: D2 } }),
  prod('p3', 'c2', 'Beta', 'etb', 'Treinador Avançado (ETB)', { copagConfirmed: true, msrp: 300, copag: { msrp: 300, source_url: 'https://www.copagloja.com.br/etb-beta/p', source_timestamp: D1, msrp_updated_at: D1 } }),
  prod('p4', 'c2', 'Beta', 'booster_box', 'Booster Box', { boosters: 36 }),
];
const O = [off('a', 'p1', 320, 0, { discount: 0.2, source_timestamp: D2 }), off('b', 'p1', 310, null, { discount: 0.225 }), off('c', 'p2', 800, 0, { priceKind: 'pix', source_timestamp: D1 }),
  off('d', 'p3', 290, 10, { discount: 0, source_timestamp: D1 }), off('e', 'p4', 700, 0, { stock: 'PRE_ORDER' })];
const state = { generatedAt: T, coverage: { found: O.length }, totals: { offers: O.length }, products: P, offers: O,
  collections: [{ id: 'c1', name: 'Alfa', series: 'S', aliases: [], products: 2 }, { id: 'c2', name: 'Beta', series: 'S', aliases: [], products: 2 }],
  types: [{ id: 'etb', label: 'Treinador Avançado (ETB)', group: 'ETB', products: 2 }, { id: 'booster_box', label: 'Booster Box', group: 'Box', products: 2 }],
  sources: [], activity: [], tips: [], bestDeals: [] };

function render(queries, sitemap = false) {
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
    if (${sitemap}) { const res = { setHeader() {}, end(b) { this.body = b; } }; await sm({}, res); out.sitemap = res.body; }
    console.log(JSON.stringify(out));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script, JSON.stringify(state), JSON.stringify(queries)],
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

const Q = ['t=oportunidades', 't=pre-vendas', 't=precos', 't=termos', 't=privacidade', 't=home', 't=produtos', 't=como-funciona', 't=colecao&slug=alfa', 't=tipo&slug=booster-box', 't=produto&slug=alfa-treinador-avancado-etb', 't=produto&slug=alfa-booster-box-36'];
const out = render(Q, true);
const pg = Object.fromEntries(Q.map((q) => [q, { status: out[q].status, ...parse(out[q].body) }]));

await t('1. /oportunidades sem banco: melhor oferta com estoque de cada produto (regra #84), Pix sinalizado, sem Opportunity Score inventado, com links de coleção/formato', () => {
  const p = pg['t=oportunidades']; assert.equal(p.status, 200); assert.equal(p.noindex, false);
  const s = text(p.ssr);
  assert.match(s, /Melhores ofertas com estoque agora/); assert.doesNotMatch(s, /Opportunity Score \d/);
  assert.match(s, /Alfa · Treinador Avançado \(ETB\) — R\$ 320,00 em Loja a · Copag R\$ 400,00 \(frete grátis\) · 20% abaixo do preço sugerido Copag/, 'A (frete grátis) vence B (frete desconhecido), #84');
  assert.doesNotMatch(s, /Loja b/);
  assert.match(s, /Alfa · Booster Box 36 — R\$ 800,00 no Pix em Loja c \(frete grátis\)/, 'Pix sinalizado; sem "abaixo" (preço sugerido não confirmado)');
  assert.doesNotMatch(s, /Booster Box 36 — R\$ 800,00 no Pix em Loja c[^·]*abaixo/);
  assert.doesNotMatch(s, /Loja e/, 'pré-venda não é oferta com estoque');
  const l = links(p.ssr);
  assert.ok(l.includes('/colecao/alfa') && l.includes('/colecao/beta') && l.includes('/tipo/booster-box') && l.includes('/tipo/treinador-avancado-etb'), 'links internos para coleções e formatos');
  assert.match(s, /Navegue por coleção ou formato/);
});

await t('2. /pre-vendas: lista as pré-vendas e também traz os links de coleção/formato', () => {
  const p = pg['t=pre-vendas']; const s = text(p.ssr);
  assert.match(s, /Beta · Booster Box 36 — R\$ 700,00 em Loja e/);
  assert.ok(links(p.ssr).includes('/colecao/beta') && links(p.ssr).includes('/tipo/booster-box'));
});

await t('3. /precos: todo produto com preço sugerido, por coleção, "oficial" × "referência", com fonte e data', () => {
  const p = pg['t=precos']; const s = text(p.ssr);
  assert.match(s, /Alfa Produto Preço sugerido Tipo Fonte Data Treinador Avançado \(ETB\) R\$ 400,00 Preço sugerido Copag \(oficial\) copagloja.com.br 08\/10\/2026 Booster Box 36 R\$ 900,00 Referência da comunidade \(não confirmada\) ref.example 09\/10\/2026/);
  assert.match(s, /Beta Produto Preço sugerido Tipo Fonte Data Treinador Avançado \(ETB\) R\$ 300,00 Preço sugerido Copag \(oficial\) copagloja.com.br 08\/10\/2026/);
  assert.doesNotMatch(s, /Beta[\s\S]*Booster Box 36 R\$/, 'produto sem preço sugerido fica fora');
  const l = links(p.ssr);
  assert.ok(l.includes('https://www.copagloja.com.br/etb-alfa/p') && l.includes('https://ref.example/box') && l.includes('/colecao/alfa'));
  assert.match(p.ssr, /<a href="https:\/\/www\.copagloja\.com\.br\/etb-alfa\/p" rel="nofollow noopener">/);
  assert.doesNotMatch(p.ssr, /javascript:/i, 'fonte com esquema fora de http(s) não vira link');
  assert.match(s, /R\$ 410,00 Preço sugerido Copag \(oficial\) —/, 'sem link, a fonte aparece como —');
});

await t('4. /termos e /privacidade: título, descrição e canonical próprios, indexáveis, com caminho (BreadcrumbList)', () => {
  for (const [q, h1, u] of [['t=termos', 'Termos de uso', '/termos'], ['t=privacidade', 'Política de privacidade', '/privacidade']]) {
    const p = pg[q]; assert.equal(p.status, 200, q); assert.equal(p.noindex, false, q);
    assert.equal(p.title, `${h1} | TCG Price Hunter`); assert.equal(p.canonical, 'https://tcgpricehunter.com.br' + u);
    assert.ok(p.desc.length > 60 && p.desc.length <= 160, q);
    assert.match(text(p.ssr), new RegExp('^' + h1 + ' '));
    assert.deepEqual(p.ld.find((x) => x['@type'] === 'BreadcrumbList').itemListElement.map((i) => i.name), ['Início', h1]);
  }
  assert.match(text(pg['t=privacidade'].ssr), /Lei Geral de Proteção de Dados/); assert.match(text(pg['t=termos'].ssr), /preço sugerido oficial da Copag/);
});

await t('5. descrições de até 160 caracteres em todos os modelos, com as palavras-chave', () => {
  for (const q of Q) {
    const p = pg[q]; assert.ok(p.desc.length > 0 && p.desc.length <= 160, `${q}: ${p.desc.length} caracteres`);
    if (!/termos|privacidade/.test(q)) assert.match(p.desc, /Pokémon TCG/, q);
  }
  for (const q of ['t=home', 't=oportunidades', 't=precos', 't=pre-vendas', 't=colecao&slug=alfa', 't=tipo&slug=booster-box']) assert.match(pg[q].desc, /preço sugerido Copag/, q);
  assert.match(pg['t=colecao&slug=alfa'].desc, /^Alfa Pokémon TCG lacrado: 3 produtos/); assert.match(pg['t=tipo&slug=booster-box'].desc, /^Booster Box Pokémon TCG lacrado/);
});

await t('6. sitemap: lastmod por produto (última conferência da melhor oferta), coleção/formato = maior entre os seus; /termos e /privacidade presentes', () => {
  const sm = out.sitemap; const lm = (u) => meta(sm, new RegExp(`<loc>https://tcgpricehunter.com.br${u.replace(/\//g, '\\/')}</loc><lastmod>([^<]*)`));
  assert.equal(lm('/produto/alfa-treinador-avancado-etb'), '2026-10-09', 'A (melhor oferta) conferida em D2');
  assert.equal(lm('/produto/alfa-booster-box-36'), '2026-10-08', 'C conferida em D1');
  assert.equal(lm('/produto/beta-treinador-avancado-etb'), '2026-10-08');
  assert.equal(lm('/colecao/alfa'), '2026-10-09', 'coleção = maior entre os produtos'); assert.equal(lm('/colecao/beta'), '2026-10-09', 'p4 sem melhor oferta cai no generatedAt');
  assert.equal(lm('/tipo/treinador-avancado-etb'), '2026-10-09'); assert.equal(lm('/tipo/booster-box'), '2026-10-09', 'p4 (só pré-venda) sem melhor oferta: cai no generatedAt');
  assert.equal(lm('/termos'), '2026-10-09'); assert.equal(lm('/privacidade'), '2026-10-09');
  assert.doesNotMatch(sm, /beta-booster-box/, 'produto só com pré-venda (sem estoque) fora do sitemap');
});

await t('7. vercel.json: trailingSlash desligado, rotas /termos e /privacidade no SSR, rotas privadas com X-Robots-Tag noindex', () => {
  const v = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  assert.equal(v.trailingSlash, false);
  const rw = Object.fromEntries(v.rewrites.map((r) => [r.source, r.destination]));
  assert.equal(rw['/termos'], '/api/pagina?t=termos'); assert.equal(rw['/privacidade'], '/api/pagina?t=privacidade');
  const h = v.headers.find((x) => x.source === '/(busca|pistas|conta|favoritos|alertas|configuracoes)');
  assert.deepEqual(h.headers, [{ key: 'X-Robots-Tag', value: 'noindex' }]);
  assert.ok(v.headers.find((x) => x.source === '/app.html').headers.some((k) => k.key === 'X-Robots-Tag'), 'app.html segue noindex');
});

await t('8. index.html photo(): alt descritivo (coleção · formato), width/height e lazy (pódio eager)', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const fn = html.slice(html.indexOf('function photo('), html.indexOf('const live=(o)=>'));
  assert.match(fn, /alt="\$\{esc\(alt\)\}"/); assert.doesNotMatch(fn, /alt=""/);
  assert.match(fn, /width="\$\{r43\?800:600\}" height="600"/); assert.match(fn, /loading="\$\{eager\?"eager":"lazy"\}"/);
  assert.match(html, /photo\(p,\{image:of\.image\},"photo",true\)/, 'pódio carrega sem lazy');
  assert.equal((html.match(/photo\([^)]*,true\)/g) || []).length, 1, 'só o pódio é eager');
});

console.log(`✓ SEO Lote C: ${n} grupos de testes passaram`);
