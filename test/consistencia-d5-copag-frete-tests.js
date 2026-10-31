// E6-E / D5 (auditoria T4-E): o % frente ao preço sugerido Copag na página do produto é calculado sobre o TOTAL com frete
// (src/run.js: discount = 1 − total/msrp; o cálculo não muda aqui). Quando a oferta destacada tem frete pago, a frase
// precisa dizer "(com frete)": antes, a própria Loja Copag vendendo no preço sugerido aparecia "15,2% acima da referência
// Copag" sem explicação. Frete grátis ou a calcular: texto como antes. renderProduct real num sandbox.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const cut = (a, b) => { const i = html.indexOf(a); const j = html.indexOf(b, i); assert.ok(i > 0 && j > i, `trecho ${a}`); return html.slice(i, j); };
const line = (a) => cut(a, '\n');
let n = 0; const t = (nome, fn) => { try { fn(); n++; } catch (e) { e.message = `${nome}: ${e.message}`; throw e; } };
const P0 = { id: 'deck', collection: 'av', collectionName: 'Avulsos', type: 'deck', typeLabel: 'Deck', group: 'Decks', copagConfirmed: true, msrp: 69.99,
  copag: { msrp: 69.99, source_url: 'https://www.copagloja.com.br/deck/p', source_timestamp: '2026-10-25T12:00:00Z' } };
function disc(best) {
  const view = { innerHTML: '' };
  const ctx = { console, Math, String, Number, Array, JSON, Object, Date, Set, Map, Intl, document: { title: '' }, history: { pushState() {}, replaceState() {} }, location: { pathname: '/' },
    P: { deck: P0 }, OFF: [best], S: { collections: [], types: [] }, SLUG: {}, HIST: { deck: [] }, drawHist() {}, loadHist() {}, loadPpOpp() {}, $: (s) => (s === '#view' ? view : null),
    esc: (s) => String(s ?? ''), pct: (v) => `${(v * 100).toFixed(1).replace('.', ',')}%`, ic: () => '', g: () => ({ c: '#000', icon: 'x' }), label: (p) => p.typeLabel, colHref: () => '', typeHref: () => '',
    photo: () => '', favBtn: () => '', shareBtn: () => '', pixTag: () => '', pixTxt: () => '', scoreBlock: () => '', alertBox: () => '', liveTips: () => [], tipCard: () => '', raBadge: () => '', thirdParty: () => false,
    stockChip: () => '', oppOf: () => null, oppScore: () => null, bandUI: () => ['', '', ''], dial: () => '', NO_SCORE: () => '', ago: () => '', safeUrl: (u) => u, outUrl: (u) => u, outRel: () => '', afilSelo: () => '',
    searchBox: () => '', REFNOTE: '', track() {}, render() {}, scrollTo() {}, outrasLojasBlock: () => '', AFIL: { anuncios: {} } };
  vm.createContext(ctx);
  vm.runInContext([line('const money='), line('const live=(o)=>'), line('const mlItem='), line('const afPref='), cut('const readKnown=', 'const shipNote='), line('const shipNote='),
    cut('/* Página de produto: entender', '/* Conta: login')].join('\n') + '\n;globalThis.__r=renderProduct;', ctx);
  try { ctx.__r('deck'); } catch { /* blocos fora do escopo; o selo do % vem antes */ }
  const m = view.innerHTML.match(/<p class="pp-disc[^"]*">([\s\S]*?)<\/p>/); assert.ok(m, 'pp-disc não renderizado: ' + view.innerHTML.slice(0, 200));
  return m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}
const of = (price, shipping, known = true) => ({ id: 'o', productId: 'deck', storeId: 'copagloja', storeName: 'Loja Copag', url: 'https://www.copagloja.com.br/deck/p', price, shipping, shippingKnown: known,
  total: known ? +(price + shipping).toFixed(2) : price, discount: +(1 - (known ? price + shipping : price) / 69.99).toFixed(4), stock: 'IN_STOCK', stale: false, anomalous: false, priceKind: 'base' });
t('frete pago: o % diz que inclui o frete (Loja Copag no preço sugerido + R$ 10,66)', () => {
  assert.equal(disc(of(69.99, 10.66)), '15,2% acima da referência Copag (com frete)');
});
t('frete pago e abaixo da referência: idem', () => {
  assert.equal(disc(of(50, 5)), '21,4% abaixo da referência Copag (com frete)');
});
t('frete grátis: texto como antes', () => {
  assert.equal(disc(of(59.99, 0)), '14,3% abaixo da referência Copag');
});
t('frete a calcular: sem "(com frete)" (o total é só o preço)', () => {
  assert.doesNotMatch(disc(of(59.99, null, false)), /com frete/);
});
console.log(`consistencia-d5-copag-frete: ${n} verificações ok`);
