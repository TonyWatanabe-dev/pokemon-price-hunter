// E6-E / D2 (auditoria T4-E): preço no Pix no Monte seu kit diz "no Pix", como a página do produto e a Home.
// Antes, /api/v1/site/kit e /site/kit/cesta não mandavam priceKind e a kit-v2.js mostrava só "R$ 25,85 cada" para um valor
// que no produto aparece "R$ 25,85 no Pix" (no cartão a loja cobra mais). Rota real (estado sintético, sem banco/rede) e
// kit-v2.js real num DOM falso.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

let n = 0; const t = async (nome, fn) => { try { await fn(); n++; } catch (e) { e.message = `${nome}: ${e.message}`; throw e; } };
const { setLegacyLoader } = await import('../api/_lib/legacy.mjs');
const now = new Date().toISOString();
const st = { generatedAt: now, collections: [{ id: 'xx1', name: 'X' }],
  products: [{ id: 'xx1-blister3', collection: 'xx1', type: 'blister_3', name: 'X - Blister Triplo', offerCount: 1 }, { id: 'xx1-deck', collection: 'xx1', type: 'deck', name: 'X - Baralho', offerCount: 1 }],
  offers: [{ id: 'o1', productId: 'xx1-blister3', storeId: 'a', storeName: 'A', price: 25.85, priceKind: 'pix', total: 25.85, stock: 'IN_STOCK', url: 'https://a.test/b3', source_timestamp: now, shippingKnown: false },
    { id: 'o2', productId: 'xx1-deck', storeId: 'b', storeName: 'B', price: 80, priceKind: 'base', total: 95, shipping: 15, shippingKnown: true, stock: 'IN_STOCK', url: 'https://b.test/d', source_timestamp: now }], sources: {} };
setLegacyLoader(async () => st);
delete process.env.API_DATABASE_URL; delete process.env.DATABASE_URL;
const { default: api } = await import('../api/v1.mjs');
const call = async (url) => { const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } }; await api({ url, method: 'GET' }, res); return { status: res.statusCode, json: JSON.parse(res.body) }; };

const kit = await call('/api/v1/site/kit?objetivo=colecionar&orcamento=100&idioma=pt&fonte=state');
await t('API /site/kit: oferta leva priceKind', () => {
  assert.equal(kit.status, 200, JSON.stringify(kit.json));
  const it = kit.json.itens.find((i) => i.productId === 'xx1-blister3'); assert.ok(it, 'item Pix no kit');
  assert.equal(it.oferta.priceKind, 'pix');
});
const cesta = await call('/api/v1/site/kit/cesta?itens=xx1-blister3:1,xx1-deck:1&fonte=state');
await t('API /site/kit/cesta: ofertas levam priceKind (Pix e base)', () => {
  assert.equal(cesta.status, 200, JSON.stringify(cesta.json));
  const kinds = Object.fromEntries(cesta.json.dividir.itens.map((i) => [i.productId, i.oferta.priceKind]));
  assert.deepEqual(kinds, { 'xx1-blister3': 'pix', 'xx1-deck': 'base' });
});

// ---- kit-v2.js real: o resultado marca "no Pix" só no item Pix (item e "Outras opções")
const js = fs.readFileSync(new URL('../assets/web/kit-v2.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../kit.html', import.meta.url), 'utf8');
await t('kit.html carrega a kit-v2.js', () => assert.match(html, /\/assets\/web\/kit-v2\.js/));
async function resultado(resp) {
  const ouvintes = {}; const app = { innerHTML: '', addEventListener: (tp, f) => { (ouvintes[tp] = ouvintes[tp] || []).push(f); }, querySelector: () => null, querySelectorAll: () => ({ forEach() {} }) };
  const loc = { pathname: '/monte-seu-kit', search: '', href: 'https://x.test/monte-seu-kit' };
  const ctx = { console, URLSearchParams, Promise, Number, String, JSON, Math, Error, document: { getElementById: () => app }, location: loc,
    history: { replaceState: (_s, _t, u) => { const [p, q = ''] = u.split('?'); loc.pathname = p; loc.search = q ? '?' + q : ''; } }, sessionStorage: { getItem: () => null, setItem() {} },
    fetch: (u) => Promise.resolve({ ok: true, json: () => Promise.resolve(u.includes('/cesta') ? { dividir: { subtotal: resp.subtotal, total: null, fretes: [], pedidos: 1 } } : resp) }) };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(js, ctx);
  const botao = (attrs) => { const b = { dataset: {}, hasAttribute: (k) => k in attrs, getAttribute: (k) => (k in attrs ? attrs[k] : null) }; if ('data-v' in attrs) b.dataset.v = attrs['data-v']; b.closest = (s) => (s === 'button' ? b : null); return b; };
  const fire = (a) => (ouvintes.click || []).forEach((f) => f({ type: 'click', button: 0, target: botao(a) }));
  for (const a of [{ 'data-v': 'colecionar' }, { 'data-avancar': '' }, { 'data-v': '100' }, { 'data-avancar': '' }, { 'data-v': 'pt' }, { 'data-avancar': '' }, { 'data-avancar': '' }]) fire(a);
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
  return app.innerHTML;
}
const item = (pid, price, priceKind) => ({ productId: pid, quantidade: 1, nome: pid, porque: 'x', imagem: '', oferta: { storeId: 's', storeName: 'S', price, priceKind, url: 'https://s.test/' + pid } });
const RESP = { modelo: 'primeira-colecao', nomeModelo: 'Primeira coleção', orcamento: 100, subtotal: 105.85, total: null, fretes: [], limitacoes: [],
  itens: [item('pix1', 25.85, 'pix'), item('base1', 80, 'base')], alternativas: [{ ...item('alt-pix', 12.5, 'pix'), quantidade: undefined }] };
const h = await resultado(RESP);
const bloco = (pid) => { const i = h.indexOf(`data-pid="${pid}"`); assert.ok(i > 0, `item ${pid} no HTML`); return h.slice(h.lastIndexOf('<div class="item">', i), i); };
await t('kit-v2: item Pix mostra "no Pix"; item base não', () => {
  assert.match(bloco('pix1'), /R\$\s?25,85 <small>no Pix<\/small> <small>cada<\/small>/);
  assert.doesNotMatch(bloco('base1'), /no Pix/);
});
await t('kit-v2: "Outras opções" também marca o Pix', () => {
  const i = h.indexOf('data-add="alt-pix"'); assert.ok(i > 0, 'alternativa no HTML');
  assert.match(h.slice(h.lastIndexOf('<div class="cmp alt">', i), i), /R\$\s?12,50 <small>no Pix<\/small> em S/);
});
console.log(`consistencia-d2-kit-pix: ${n} verificações ok`);
process.exit(0);
