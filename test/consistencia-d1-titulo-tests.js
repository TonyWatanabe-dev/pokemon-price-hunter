// E6-E / D1 (auditoria T4-E): o <title> que o app escreve na página do produto (index.html renderProduct) tem de ser o
// MESMO do SSR (api/pagina.mjs, Lote D): menor preço visível na tabela "Onde comprar" (15 primeiras pela regra #84), "no Pix"
// quando for Pix e "(frete a calcular)" quando a loja não informa o frete; sem oferta com estoque, ": preço e lojas".
// O Googlebot executa o JS e indexa o título do app; antes, ele trocava o número do SSR/JSON-LD e omitia "(frete a calcular)".
// Código real dos dois lados (handler do SSR e trecho da página num sandbox), com data/state.json versionado e um caso
// sintético. Sem rede, sem banco.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
delete process.env.DATABASE_URL; delete process.env.API_DATABASE_URL;
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const cut = (a, b) => { const i = html.indexOf(a); const j = html.indexOf(b, i); assert.ok(i > 0 && j > i, `trecho ${a}`); return html.slice(i, j); };
const line = (a) => cut(a, '\n');
const productCode = cut('/* Página de produto: entender', '/* Conta: login');
let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { e.message = `${name}: ${e.message}`; throw e; } };
const norm = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

// ---- app: renderProduct real num sandbox; devolve document.title
function appTitle(st, pid) {
  const P = Object.fromEntries(st.products.map((p) => [p.id, { ...p, copagConfirmed: !!p.copagConfirmed }]));
  const OFF = st.offers.filter((o) => o.productId === pid);
  const view = { innerHTML: '' }; const doc = { title: '' };
  const ctx = {
    console, Math, String, Number, Array, JSON, Object, Date, Set, Map, Intl, document: doc, history: { pushState() {}, replaceState() {} }, location: { pathname: '/' },
    P, OFF, S: { collections: st.collections || [], types: st.types || [] }, SLUG: {}, HIST: { [pid]: [] }, drawHist() {}, loadHist() {}, loadPpOpp() {}, $: (s) => (s === '#view' ? view : null),
    esc: (s) => String(s ?? ''), pct: (v) => `${(v * 100).toFixed(1)}%`, ic: () => '', g: () => ({ c: '#000', icon: 'x' }),
    colHref: () => '', typeHref: () => '', photo: () => '', favBtn: () => '', shareBtn: () => '', pixTag: () => '', scoreBlock: () => '', alertBox: () => '',
    liveTips: () => [], tipCard: () => '', raBadge: () => '', thirdParty: () => false, stockChip: () => '', oppOf: () => null, oppScore: () => null, bandUI: () => ['', '', ''],
    dial: () => '', NO_SCORE: () => '', ago: () => '', safeUrl: (u) => u, outUrl: (u) => u, outRel: () => '', afilSelo: () => '', searchBox: () => '', REFNOTE: '', track() {},
    render() {}, scrollTo() {}, outrasLojasBlock: () => '', AFIL: { anuncios: {} },
  };
  vm.createContext(ctx);
  const code = [line('const money='), line('const label=(p)=>'), line('const live=(o)=>'), line('const pixTxt='), line('const mlItem='), line('const afPref='), cut('const readKnown=', 'const shipNote='), line('const shipNote='), productCode].join('\n');
  vm.runInContext(code + '\n;globalThis.__r=renderProduct;', ctx);
  try { ctx.__r(pid); } catch { /* resto da página fora do escopo: o título é escrito antes do HTML */ }
  return doc.title;
}

// ---- SSR: handler real de api/pagina.mjs com fetch falso do state.json e relógio fixo
const FR = await import(pathToFileURL(path.join(root, 'api/_lib/freshness.mjs')).href);
const { slugs } = await import(pathToFileURL(path.join(root, 'api/_seo.mjs')).href);
async function ssrTitles(st, pids) {
  const text = JSON.stringify(st);
  globalThis.fetch = async (u) => { if (/state\.json/.test(String(u))) return new Response(text, { status: 200 }); throw new Error('rede bloqueada: ' + u); };
  FR.setFreshnessClock(() => Date.parse(st.dataAt ?? st.generatedAt) + 5 * 60e3);
  const { default: pagina } = await import(pathToFileURL(path.join(root, 'api/pagina.mjs')).href);
  const { of } = slugs(st.products); const out = {};
  for (const pid of pids) {
    const res = { statusCode: 200, h: {}, setHeader(k, v) { this.h[k] = v; }, getHeader(k) { return this.h[k]; }, end(b) { this.body = String(b ?? ''); } };
    await pagina({ url: `/api/pagina?t=produto&slug=${of[pid]}`, headers: { host: 'tcgpricehunter.com.br' } }, res);
    out[pid] = (res.body.match(/<title>([^<]*)<\/title>/) || [])[1];
  }
  return out;
}

// ---- 1. caso sintético: menor preço visível sem frete informado (e no Pix) × melhor oferta pela regra #84
const T0 = '2026-10-25T12:00:00.000Z';
const prod = { id: 'alfa-etb', collection: 'alfa', collectionName: 'Alfa', type: 'etb', typeLabel: 'Treinador Avançado (ETB)', group: 'ETB', copagConfirmed: false, msrp: null, offerCount: 3 };
const off = (id, price, ship, extra = {}) => ({ id, productId: 'alfa-etb', storeId: 's' + id, storeName: 'Loja ' + id, url: 'https://loja.example/' + id, price, priceKind: 'base',
  shipping: ship, shippingKnown: ship != null, total: ship != null ? price + ship : price, stock: 'IN_STOCK', stale: false, anomalous: false, confirmed: true, source_timestamp: T0, ...extra });
const sint = { dataAt: T0, generatedAt: T0, collections: [{ id: 'alfa', name: 'Alfa' }], types: [{ id: 'etb', label: 'Treinador Avançado (ETB)' }], products: [prod, { ...prod, id: 'alfa-bb', type: 'bb', typeLabel: 'Booster Box', offerCount: 1 }],
  offers: [off('a', 412.83, 0), off('b', 299, null, { priceKind: 'pix' }), off('c', 450, 10), off('z', 100, 0, { productId: 'alfa-bb', stock: 'OUT_OF_STOCK' })] };
// um só state.json por processo (api/_seo.mjs guarda o download por 10 min): o caso sintético entra junto do state real
const st = JSON.parse(fs.readFileSync(path.join(root, 'data/state.json'), 'utf8'));
const all = { ...st, collections: [...(st.collections || []), ...sint.collections], types: [...(st.types || []), ...sint.types], products: [...st.products, ...sint.products], offers: [...st.offers, ...sint.offers] };
const live = (o) => o.stock === 'IN_STOCK' && !o.stale && !o.anomalous && o.total > 0;
const ids = [...new Set(st.offers.filter(live).map((o) => o.productId))].filter((id) => st.products.some((p) => p.id === id)).sort();
const sAll = await ssrTitles(all, ['alfa-etb', ...ids]);
const sSint = sAll; const sReal = sAll;
await t('sintético: SSR usa o menor preço visível, com "no Pix" e "(frete a calcular)"', () => {
  assert.match(norm(sSint['alfa-etb']), /a partir de R\$ 299,00 no Pix \(frete a calcular\) \|/);
});
await t('sintético: o título do app é o mesmo do SSR', () => {
  assert.equal(norm(appTitle(sint, 'alfa-etb')), norm(sSint['alfa-etb']));
});
await t('sintético: só frete conhecido, sem "(frete a calcular)"', () => {
  const st2 = { ...sint, offers: [off('a', 412.83, 0), off('c', 400, 30)] };
  assert.match(norm(appTitle(st2, 'alfa-etb')), /a partir de R\$ 412,83 \| TCG Price Hunter$/);
});
await t('sintético: sem oferta com estoque, o app diz ": preço e lojas" como o SSR', () => {
  assert.match(norm(appTitle(sint, 'alfa-bb')), /Pokémon TCG: preço e lojas \| TCG Price Hunter$/);
});

// ---- 2. data/state.json versionado: todo produto com estoque, app × SSR
await t('state real: produtos com estoque suficientes', () => assert.ok(ids.length >= 20, `só ${ids.length}`));
await t('state real: título do app = título do SSR em todos os produtos com estoque', () => {
  const div = ids.filter((pid) => norm(appTitle(st, pid)) !== norm(sReal[pid])).map((pid) => `${pid}: SSR "${norm(sReal[pid])}" × app "${norm(appTitle(st, pid))}"`);
  assert.deepEqual(div.slice(0, 5), [], `${div.length}/${ids.length} divergem`);
});

FR.setFreshnessClock(null);
console.log(`consistencia-d1-titulo: ${n} verificações ok`);
