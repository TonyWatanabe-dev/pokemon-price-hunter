// Site só com parceiros, camada de interface (decisão do proprietário, 07/11/2026; fase 2 de docs/afiliados.md).
// Com o modo ligado (padrão do servidor), o que o visitante recebe (HTML do SSR, JSON-LD, sitemap, index.html) não cita nem linka
// loja fora das parceiras (Mercado Livre com link do dono + leituras manuais de Amazon/Shopee), não promete "todas as lojas" nem
// "menor preço do Brasil", e nunca revela a chave do modo. Leituras manuais mostram data/hora da leitura e frete desconhecido.
// Sem rede e sem banco: state.json vem de um fetch falso, como em lojas-page-tests.js.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0;
async function t(name, fn) { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } }
const NOW = Date.parse('2026-11-08T15:00:00.000Z');
const iso = (min) => new Date(NOW - min * 6e4).toISOString();
const T = iso(5);

const off = (id, storeId, productId, url, extra = {}) => ({ id, productId, storeId, storeName: storeId, title: 'x', url, price: 100, priceKind: 'base', shipping: 0, shippingKnown: true, total: 100,
  stock: 'IN_STOCK', confirmed: true, anomalous: false, stale: false, discount: null, firstSeen: T, source_timestamp: T, ...extra });
const manual = (id, storeId, productId, url, price, min) => off(id, storeId, productId, url, { storeName: storeId === 'amazon' ? 'Amazon' : 'Shopee', price, total: price,
  shipping: null, shippingKnown: false, manual: true, sourceType: 'manual_afiliado', capturedAt: iso(min), source_timestamp: iso(min), firstSeen: iso(min) });
const P = [
  { id: 'p1', collection: 'c1', collectionName: 'Escuridão Absoluta', type: 'blister_3', typeLabel: 'Blister Triplo', group: 'Blisters', boosters: null, copagConfirmed: true, msrp: 90, offerCount: 5, marketAverage: 120, marketRef: 'média de 5 lojas' },
  { id: 'p2', collection: 'c1', collectionName: 'Escuridão Absoluta', type: 'etb', typeLabel: 'Elite Trainer Box', group: 'ETB', boosters: null, copagConfirmed: true, msrp: 400, offerCount: 0, marketAverage: 450, marketRef: 'média de 3 lojas' },
];
const O = [
  off('o1', 'alfa', 'p1', 'https://www.alfa.com.br/products/blister-triplo', { storeName: 'Alfa Cards', total: 80, price: 80 }),
  off('o2', 'beta', 'p1', 'https://beta.com.br/produtos/blister-triplo/', { storeName: 'Beta Games', total: 88, price: 88 }),
  off('o3', 'mercadolivre', 'p1', 'https://produto.mercadolivre.com.br/MLB-123456789-x', { storeName: 'Mercado Livre', price: 99, shipping: 12, total: 111 }),
  manual('o4', 'amazon', 'p1', 'https://link.amazon/abc123', 97.5, 90),
  manual('o5', 'shopee', 'p1', 'https://s.shopee.com.br/AbCd1', 93, 30),
];
const SOURCES = [
  { id: 'alfa', name: 'Alfa Cards', kind: 'specialist', status: 'ACTIVE', url: 'https://www.alfa.com.br', checks: 1, ok: 1, lastSuccess: T },
  { id: 'beta', name: 'Beta Games', kind: 'specialist', status: 'ACTIVE', url: 'https://beta.com.br', checks: 1, ok: 1, lastSuccess: T },
  { id: 'mercadolivre', name: 'Mercado Livre', kind: 'marketplace', status: 'ACTIVE', url: 'https://api.mercadolibre.com', checks: 1, ok: 1, lastSuccess: T },
];
const state = { generatedAt: T, coverage: { found: O.length }, totals: { offers: O.length }, products: P, offers: O,
  collections: [{ id: 'c1', name: 'Escuridão Absoluta', series: 'S', aliases: [], products: 2 }], types: [{ id: 'blister_3', label: 'Blister Triplo', group: 'Blisters', products: 1 }, { id: 'etb', label: 'Elite Trainer Box', group: 'ETB', products: 1 }],
  sources: SOURCES, activity: [], tips: [], bestDeals: [] };

const Q = ['t=home', 't=lojas', 't=produto&slug=escuridao-absoluta-blister-triplo', 't=produto&slug=escuridao-absoluta-elite-trainer-box', 't=produtos', 't=termos'];
function render(queries, st = state, env = {}) {
  const script = `import { setFreshnessClock } from ${JSON.stringify(pathToFileURL(path.join(root, 'api/_lib/freshness.mjs')).href)};
    setFreshnessClock(() => ${NOW}); const st = JSON.parse(process.argv[1]);
    globalThis.fetch = async () => new Response(JSON.stringify(st), { status: 200 });
    const { default: h } = await import(${JSON.stringify(pathToFileURL(path.join(root, 'api/pagina.mjs')).href)});
    const { default: sm } = await import(${JSON.stringify(pathToFileURL(path.join(root, 'api/sitemap.mjs')).href)});
    const out = {};
    for (const q of JSON.parse(process.argv[2])) {
      const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
      await h({ url: '/api/pagina?' + q, headers: { host: 'x' } }, res);
      out[q] = { status: res.statusCode, body: res.body, headers: res.headers };
    }
    { const res = { setHeader() {}, end(b) { this.body = b; } }; await sm({}, res); out.sitemap = res.body; }
    console.log(JSON.stringify(out));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script, JSON.stringify(st), JSON.stringify(queries)],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: Object.fromEntries(Object.entries({ ...process.env, API_DATABASE_URL: '', SITE_SO_PARCEIROS: undefined, ...env }).filter(([, v]) => v !== undefined)) });
  if (r.status !== 0) throw new Error(`falha ao renderizar (status ${r.status}): ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}
const FORA = /alfa|beta games|\bbeta\b/i;
const PROIBIDO = /todas as lojas|menor preço do brasil|SITE_SO_PARCEIROS|so[_-]?parceiros/i;
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const on = render(Q);

await t('1. SSR com o modo ligado: nenhuma loja fora das parceiras (nome, domínio, preço) e nenhuma promessa de "todas as lojas"', () => {
  for (const q of [Q[0], Q[2], Q[3], Q[4], Q[5]]) {
    const b = on[q].body; assert.ok(b, q);
    assert.doesNotMatch(b, FORA, `${q}: loja fora das parceiras`);
    assert.doesNotMatch(b, /alfa\.com\.br|beta\.com\.br/, q);
    assert.doesNotMatch(b, PROIBIDO, q);
    assert.doesNotMatch(JSON.stringify(on[q].headers), /parceiros/i, `${q}: cabeçalhos não revelam o modo`);
  }
  assert.doesNotMatch(on.sitemap, FORA); assert.doesNotMatch(on.sitemap, /\/lojas</);
});

await t('2. /lojas vira 301 para a Home; o produto não oferece "Procurar em outras lojas"', () => {
  assert.equal(on[Q[1]].status, 301); assert.ok(!on[Q[1]].body);
  assert.doesNotMatch(on[Q[2]].body, /Procurar em outras lojas|outras lojas|ssr-lojas/);
});

await t('3. produto com ofertas: só parceiras, leitura manual com dia e hora, frete desconhecido nunca zero', () => {
  const b = on[Q[2]].body;
  const ssr = (b.match(/<div class="ssr">([\s\S]*?)<\/div><\/div>/) || [])[1] || '';
  assert.match(ssr, /Mercado Livre/); assert.match(ssr, /Amazon/); assert.match(ssr, /Shopee/);
  assert.match(ssr, /lido em \d{2}\/\d{2} às \d{2}:\d{2}/, 'ofertas manuais mostram quando foram lidas');
  assert.equal((ssr.match(/lido em/g) || []).length, 2, 'só as duas leituras manuais');
  const linhaAmazon = ssr.match(/<tr><td>Amazon<\/td>[\s\S]*?<\/tr>/)?.[0] || '';
  assert.match(linhaAmazon, /frete/i); assert.doesNotMatch(linhaAmazon, /frete grátis|\+ R\$ 0,00|frete R\$ 0,00/i);
  assert.match(on[Q[2]].body, /lojas parceiras/);
  // JSON-LD: só ofertas de parceiras e sem shippingDetails inventado para leitura manual
  const ld = [...b.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
  assert.doesNotMatch(ld, FORA);
});

await t('4. produto sem oferta de parceira: "Sem oferta nas lojas parceiras agora" com a referência (preço Copag), sem citar quem vende', () => {
  const b = on[Q[3]].body;
  assert.match(b, /Sem oferta nas lojas parceiras agora/);
  assert.match(b, /R\$ 400/, 'preço sugerido Copag como referência');
  assert.doesNotMatch(b, FORA);
});

await t('5. filtro server-side: o estado com lojas antigas (state.json de antes do corte) fica só com parceiras e recontagem coerente', async () => {
  const { estadoParceiro } = await import('../api/_lib/modo-parceiros.mjs');
  const out = estadoParceiro(JSON.parse(JSON.stringify(state)), {});
  assert.deepEqual([...new Set(out.offers.map((o) => o.storeId))].sort(), ['amazon', 'mercadolivre', 'shopee']);
  assert.deepEqual(out.sources.map((s) => s.id), ['mercadolivre']);
  assert.equal(out.products.find((p) => p.id === 'p1').offerCount, 3);
  assert.equal(out.products.find((p) => p.id === 'p2').offerCount, 0);
  const desligado = estadoParceiro(state, { SITE_SO_PARCEIROS: '0' });
  assert.equal(desligado, state, 'modo desligado devolve o próprio estado');
  assert.equal(estadoParceiro(state, {}), estadoParceiro(state, {}), 'cache: mesmo objeto');
});

await t('6. modo desligado (variável 0, só no servidor): o comportamento anterior volta, sem mudar o HTML de quem não depende dele', () => {
  const off0 = render([Q[1], Q[2]], state, { SITE_SO_PARCEIROS: '0' });
  assert.equal(off0[Q[1]].status, 200);
  assert.match(off0[Q[2]].body, /Alfa Cards/);
});

await t('7. banco: com o modo ligado todas as consultas de ofertas recebem a lista de parceiras como parâmetro', async () => {
  const src = fs.readFileSync(path.join(root, 'api/_lib/read-db.mjs'), 'utf8');
  assert.match(src, /idsParceiros/);
  assert.match(src, /store_id = ANY\(/, 'filtro por loja no SQL');
  const { idsParceiros } = await import('../api/_lib/modo-parceiros.mjs');
  assert.deepEqual(idsParceiros({}), ['mercadolivre', 'amazon', 'shopee']);
  assert.equal(idsParceiros({ SITE_SO_PARCEIROS: '0' }), null);
});

await t('8. SPA (index.html): sem diretório de lojas, sem "Procurar em outras lojas", sem blocos Amazon/Shopee, sem chave do modo, sem promessa de "todas as lojas"', () => {
  assert.doesNotMatch(html, /SITE_SO_PARCEIROS|so[_-]?parceiros/i);
  assert.doesNotMatch(html, /todas as lojas(?! parceiras)|menor preço do brasil/i);
  assert.doesNotMatch(html, /renderLojas|outrasLojas|LOJAS_CFG|lojasNormalize|data-go="lojas"|Procurar em outras lojas/);
  assert.doesNotMatch(html, /function amzBlock|function shpBlock|pp-amz|pp-shp/);
  assert.match(html, /Todas as lojas parceiras/);
  assert.match(html, /Sem oferta nas lojas parceiras agora/);
  assert.match(html, /lidoEm\(/, 'oferta manual mostra "Lido em dd/mm às hh:mm"');
  assert.match(html, /link\\\.amazon\|s\\\.shopee\\\.com\\\.br/, 'links manuais saem como patrocinados');
  assert.match(html, /A ordem das ofertas segue o preço, não a comissão/);
  const lh = html.match(/async function loadHist\(pid\)\{[\s\S]*?\n  if\(view==="produto"/)?.[0] || '';
  assert.match(lh, /"mercadolivre","amazon","shopee"/, 'histórico: séries de lojas que o site não mostra saem no front (arquivo antigo do ramo de dados)');
});

await t('9. SPA: nenhum nome de loja fora das parceiras escrito no código (copy, menu, rodapé, termos)', () => {
  const visivel = html.replace(/<script[\s\S]*?<\/script>/g, (s) => s.length > 200000 ? '' : s);
  for (const nome of ['Magazine Luiza', 'Magalu', 'Kabum', 'Pelando', 'Americanas', 'Fast Shop']) assert.doesNotMatch(visivel, new RegExp(nome, 'i'), nome);
  assert.ok(html.length < 450 * 1024, `index.html com ${html.length} caracteres: o teto de perf-slim é ${450 * 1024}`);
});

await t('10. social: só ofertas parceiras entram em prévia, ranking e Telegram', async () => {
  const { ehParceira } = await import('../tools/social-preview.mjs');
  const { apenasParceiras } = await import('../tools/social-top.mjs');
  assert.equal(ehParceira(manual('x', 'amazon', 'p1', 'https://link.amazon/a', 90, 10), {}), true);
  assert.equal(ehParceira(off('y', 'alfa', 'p1', 'https://www.alfa.com.br/p'), {}), false);
  const resp = { data: [{ store: { id: 'alfa' }, total: 1 }, { store: { id: 'amazon' }, total: 2 }, { store: { id: 'mercadolivre' }, total: 3 }] };
  assert.deepEqual(apenasParceiras(resp, {}).data.map((x) => x.store.id), ['amazon', 'mercadolivre']);
  assert.equal(apenasParceiras(resp, { SITE_SO_PARCEIROS: '0' }).data.length, 3);
});

console.log(`✓ Site só com parceiros (interface): ${n} grupos passaram`);

// Home (08/11/2026, pedido do dono): o selo da Home mostra só o número de ofertas, sem a quantidade de lojas.
{
  const fs = await import('node:fs');
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const i = html.indexOf('<span class="lv-head">'); const trecho = html.slice(i, html.indexOf('</div>', i));
  assert.ok(i > 0 && /ofertas com estoque/.test(trecho), 'selo da Home com o número de ofertas');
  assert.ok(!/lojas? parceiras?|nStores|counts\.stores/.test(trecho), 'selo da Home sem a quantidade de lojas');
  console.log('✓ so-parceiros-ui: Home sem quantidade de lojas');
}
