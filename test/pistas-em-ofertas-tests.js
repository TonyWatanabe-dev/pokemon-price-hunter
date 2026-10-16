// Pistas misturadas na página /oportunidades (decisão do proprietário, 16/10/2026). Roda o código real do index.html num
// sandbox: a pista entra entre as ofertas com o selo "Pista não verificada", sem nota; pista que virou oferta, encerrada,
// barata demais ou sem produto fica fora; filtros de nota/confiança/referência/loja escondem as pistas; menu sem "Pistas".
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const A = html.indexOf('/* Categorias do site'); const B = html.indexOf('/* Pré-vendas: status sempre visível */');
assert.ok(A > 0 && B > A);
const code = html.slice(A, B);
const t = async (name, fn) => { try { await fn(); } catch (e) { e.message = `${name}: ${e.message}`; throw e; } };

const offer = (i) => ({ product: { id: 'p' + i, name: 'Prod ' + i, type: 'etb', type_label: 'ETB', group: 'ETB', collection: { code: 'c', name: 'Col' } },
  offer: { id: 'o' + i, url: 'https://loja/x' + i }, price: 100 + i, total: 100 + i, shipping: 'free', store: { id: 's', name: 'Loja' },
  opportunity_score: 80 - i, opportunity_band: 'boa', confidence: 0.8, confidence_level: 'alta', reference_comparison: { available: false }, warnings: [], reasons: [], updated_at: new Date().toISOString() });
const tips = [
  { id: 'a', productId: 'me05-etb', title: 'ETB', label: 'ETB', collectionName: 'Escuridão', source: 'Telegram mecpromo', store: 'Shopee', url: 'https://s.shopee.com.br/1', price: 300, discount: 0.25, postedAt: new Date().toISOString() },
  { id: 'a2', productId: 'me05-etb', title: 'ETB cara', source: 'Pelando', store: 'Amazon', url: 'https://amzn.to/1', price: 350, discount: 0.12 },
  { id: 'b', productId: 'me05-b3', title: 'Blister', source: 'Telegram x', store: 'Amazon', url: 'https://amzn.to/2', price: 50, discount: 0.4 },
  { id: 'ml', productId: 'me05-b3', title: 'ML', store: 'Mercado Livre', url: 'https://meli.la/1', price: 40, discount: 0.5, virouOferta: 'oml' },
  { id: 'enc', productId: 'me05-etb', price: 200, expired: true, url: 'https://x/1' },
  { id: 'bar', productId: 'me05-etb', price: 20, anomalous: true, url: 'https://x/2' },
  { id: 'sem', title: 'Coisa', price: 10, url: 'https://x/3' },
];
const products = [{ id: 'me05-etb', collection: 'me05', collectionName: 'Escuridão', type: 'etb', typeLabel: 'Treinador Avançado (ETB)', group: 'ETB' },
  { id: 'me05-b3', collection: 'me05', collectionName: 'Escuridão', type: 'blister_3', typeLabel: 'Blister Triplo', group: 'Blisters' }];

function sandbox(nOffers, of = {}) {
  const view = { innerHTML: '' }; const calls = [];
  const ctx = {
    console, URLSearchParams, Math, String, Number, Array, JSON, Object, Promise, Map, setTimeout,
    store: { get: (k, d) => ({ ...d, ...of }), set() {} }, S: { collections: [], reputation: { lojas: {} } }, SLUG: {}, P: {},
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    money: (v) => 'R$ ' + Number(v).toFixed(2).replace('.', ','), ic: (id) => `<i data-ic="${id}"></i>`, photo: () => '<div class="photo"></div>',
    catOf: () => 'x', g: () => ({ c: '#000' }), catChip: () => '', isFav: () => false, raBadge: () => '', safeUrl: (u) => u, outUrl: (u) => u, outRel: () => '',
    afilSelo: () => '', pixTag: () => '', ago: () => 'há 1 h', live: () => true, document: { addEventListener() {}, querySelectorAll: () => [] },
    view: 'oportunidades', $: (s) => (s === '#view' ? view : null),
    mergeProducts: (l) => { for (const p of l) ctx.P[p.id] = p; },
    apiGet: async (path) => { calls.push(path); if (path === 'site/pagina/pistas') return { tips, products };
      if (path === 'oportunidades/lojas') return { data: [] };
      return { data: Array.from({ length: nOffers }, (_, i) => offer(i)), meta: { total: nOffers, pages: 1, status: 'ok' } }; },
  };
  vm.createContext(ctx);
  vm.runInContext(code + '\n;globalThis.__t={renderOpp,OF,OPP,oppTips};', ctx);
  return { ...ctx.__t, view, calls };
}
const order = (h) => [...h.matchAll(/data-tip="([^"]+)"|data-store="([^"]+)"/g)].map((m) => m[1] ? 'T:' + m[1] : m[2]);
const settle = () => new Promise((r) => setTimeout(r, 0));

await t('pistas entram entre as ofertas, uma a cada 4, maior desconto primeiro; sobras no fim da última página', async () => {
  const s = sandbox(5); await s.renderOpp(); await settle();
  assert.equal(order(s.view.innerHTML).join(), ['o0', 'o1', 'o2', 'o3', 'T:b', 'o4', 'T:a'].join());
  assert.match(s.view.innerHTML, /Pista não verificada/);
  assert.match(s.view.innerHTML, /5 ofertas · 2 pistas/);
  assert.match(s.view.innerHTML, /−40,0%[\s\S]*?do preço Copag/);
  assert.match(s.view.innerHTML, /href="https:\/\/amzn\.to\/2" target="_blank" rel="noopener"/);
});
await t('fica fora: virou oferta, encerrada, barata demais, sem produto, e a mais cara do mesmo produto', async () => {
  const s = sandbox(1); await s.renderOpp(); await settle();
  assert.deepEqual(s.oppTips().map((x) => x.id).join(), ['b', 'a'].join());
  assert.doesNotMatch(s.view.innerHTML, /data-tip="(ml|enc|bar|sem|a2)"/);
  assert.doesNotMatch(s.view.innerHTML, /data-tip="[^"]+"[\s\S]{0,400}Opportunity Score<\/span>/, 'pista sem medidor de nota');
});
await t('filtros: nota/confiança/referência/loja escondem; categoria, preço máximo e % abaixo filtram', async () => {
  for (const k of ['faixa', 'conf', 'ref', 'loja']) { const s = sandbox(2, { [k]: 'x' }); await s.renderOpp(); await settle(); assert.equal(s.oppTips().length, 0, k); }
  let s = sandbox(2, { cat: 'ETB' }); await s.renderOpp(); await settle(); assert.deepEqual(s.oppTips().map((x) => x.id).join(), ['a'].join());
  s = sandbox(2, { max: '100' }); await s.renderOpp(); await settle(); assert.deepEqual(s.oppTips().map((x) => x.id).join(), ['b'].join());
  s = sandbox(2, { abaixo: '30' }); await s.renderOpp(); await settle(); assert.deepEqual(s.oppTips().map((x) => x.id).join(), ['b'].join());
  s = sandbox(2, { sort: 'preco' }); await s.renderOpp(); await settle(); assert.deepEqual(s.oppTips().map((x) => x.id).join(), ['b', 'a'].join());
});
await t('menu sem "Pistas"; /pistas leva às oportunidades', () => {
  assert.doesNotMatch(html, /data-go="pistas"|href="\/pistas"/);
  assert.match(html, /const ROUTES=\{[^}]*pistas:"oportunidades"/);
  const v = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.ok(v.redirects.some((r) => r.source === '/pistas' && r.destination === '/oportunidades' && r.permanent === false));
});
console.log('pistas-em-ofertas-tests: ok');
