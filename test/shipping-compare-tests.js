// Issue #84 — página do produto: oferta com frete desconhecido não disputa o "menor total" com quem já tem frete conhecido.
// Roda o código real da página (trechos de index.html) num sandbox.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const cut = (a, b) => { const i = html.indexOf(a); const j = html.indexOf(b, i); assert.ok(i > 0 && j > i, `trecho ${a}`); return html.slice(i, j); };
const liveCode = cut('const live=(o)=>', '\n');
const shipNoteCode = cut('const shipNote=', '\n');
const productCode = cut('/* Página de produto: entender', '/* Conta: login');
let n = 0; const t = (name, fn) => { fn(); n++; };

function page(OFF) {
  const view = { innerHTML: '' };
  const ctx = {
    console, Math, String, Number, Array, JSON, Object, Date, Set, document: { title: '' }, history: { pushState() {}, replaceState() {} }, location: { pathname: '/' },
    P: { p1: { id: 'p1', collectionName: 'Caos Ascendente', typeLabel: 'Booster Box', type: 'bb', group: 'Boxes', copagConfirmed: false, copag: null } }, OFF, S: { collections: [] }, SLUG: {},
    HIST: { p1: [] }, drawHist() {}, loadHist() {}, $: (s) => (s === '#view' ? view : null),
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    money: (v) => (v == null ? '-' : 'R$ ' + Number(v).toFixed(2).replace('.', ',')), pct: (v) => `${(v * 100).toFixed(1)}%`, ic: (k) => `<i data-ic="${k}"></i>`,
    g: () => ({ c: '#000', icon: 'x' }), label: (p) => p.typeLabel, colHref: () => '', typeHref: () => '', photo: () => '<div class="photo"></div>', favBtn: () => '',
    pixTag: () => '', pixTxt: () => '', scoreBlock: () => '', alertBox: () => '', liveTips: () => [], tipCard: () => '', raBadge: () => '', thirdParty: () => false,
    stockChip: () => '', oppOf: () => null, oppScore: () => null, bandUI: () => ['', '', ''], dial: () => '', NO_SCORE: () => 'Sem nota', ago: () => 'agora',
    safeUrl: (u) => u, searchBox: () => '', REFNOTE: '', track() {}, render() {}, scrollTo() {},
  };
  vm.createContext(ctx);
  vm.runInContext(liveCode + ';' + shipNoteCode + ';' + productCode + '\n;globalThis.__t={OFFER_SORTS,bestOffer:typeof bestOffer==="function"?bestOffer:null,renderProduct};', ctx);
  return { ...ctx.__t, view, ctx };
}
const offer = (id, x = {}) => ({ id, productId: 'p1', storeId: id, storeName: 'Loja ' + id, url: 'https://loja.example/' + id, stock: 'IN_STOCK', stale: false, anomalous: false, ...x });
const unk = (id, price, x) => offer(id, { price, total: price, shipping: null, shippingKnown: undefined, ...x });   // a API omite shippingKnown:false
const known = (id, price, ship, x) => offer(id, { price, shipping: ship, total: price + ship, shippingKnown: true, ...x });
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

// exemplo da issue: A R$ 100 + frete desconhecido; B R$ 105 com frete R$ 0 conhecido
const A = unk('a', 100), B = known('b', 105, 0);
const OFF = [A, B, known('c', 100, 10), unk('d', 90), known('esg', 50, 0, { stock: 'OUT_OF_STOCK' })];

t('ordem "Menor preço": totais com frete conhecido primeiro; frete a calcular depois, por preço; sem estoque no fim', () => {
  const s = page(OFF);
  assert.deepEqual([...OFF].sort(s.OFFER_SORTS.price).map((o) => o.id), ['b', 'c', 'd', 'a', 'esg']);
});
t('"melhor preço com estoque" é o menor total com frete conhecido, não a oferta sem frete', () => {
  const s = page(OFF);
  assert.equal(s.bestOffer(OFF).id, 'b');
  assert.equal(s.bestOffer([A, unk('d', 90)]).id, 'd', 'só frete desconhecido: menor preço, sem fingir que é total');
  assert.equal(s.bestOffer([unk('x', 1, { stock: 'OUT_OF_STOCK' })]), undefined);
});
t('página do produto: destaque em B (R$ 105, frete grátis) e A/D num grupo "Frete a calcular"', () => {
  const s = page(OFF); s.renderProduct('p1'); const h = s.view.innerHTML; const buy = h.split('<section class="card buy">')[1].split('</section>')[0];
  assert.match(text(buy), /^Melhor preço com estoque R\$ 105,00 Frete grátis · Loja b/);
  assert.match(text(buy), /2 ofertas com preço menor não informam o frete e ficam fora desta comparação/);
  assert.match(buy, /data-store="b"/); assert.doesNotMatch(buy, /data-store="a"|data-store="d"/);
  const where = h.split('id="ondecomprar"')[1]; const order = [...where.matchAll(/data-store="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, ['b', 'c', 'd', 'a', 'esg']);
  const [head, tail] = where.split('<h3 class="so-group">');
  assert.ok(tail, 'grupo separado para frete a calcular'); assert.match(text(tail), /^Frete a calcular Preço antes do frete: não dá para comparar com os totais acima/);
  assert.doesNotMatch(head, /data-store="a"|data-store="d"/, 'frete desconhecido fora do grupo de totais');
  assert.match(text(tail), /R\$ 90,00 Preço antes do frete · frete a calcular/);
  assert.match(text(head), /R\$ 110,00 Produto R\$ 100,00 \+ frete R\$ 10,00/); assert.doesNotMatch(head, /frete a calcular/);
});
t('só ofertas sem frete informado: destaque não diz "melhor preço", diz frete a calcular; sem cabeçalho de grupo', () => {
  const s = page([A, unk('d', 90)]); s.renderProduct('p1'); const h = s.view.innerHTML;
  assert.match(text(h.split('<section class="card buy">')[1]), /^Menor preço com estoque, frete a calcular R\$ 90,00 Preço antes do frete · Loja d/);
  assert.doesNotMatch(h, /Melhor preço com estoque|so-group|não informam o frete/);
});
t('outras ordens não agrupam por frete, mas o destaque continua no menor total comparável', () => {
  const s = page(OFF.map((o) => ({ ...o, source_timestamp: o.id === 'a' ? '2026-10-10' : '2026-10-01' })));
  vm.runInContext('offerSort="fresh"', s.ctx); s.renderProduct('p1'); const h = s.view.innerHTML;
  assert.match(text(h.split('<section class="card buy">')[1]), /^Melhor preço com estoque R\$ 105,00/);
  assert.deepEqual([...h.split('id="ondecomprar"')[1].matchAll(/data-store="(\w+)"/g)].map((m) => m[1])[0], 'a', 'mais recente primeiro');
  assert.doesNotMatch(h, /so-group/);
});
t('estoque desconhecido continua fora da lista com estoque (nada vira "com estoque")', () => {
  const s = page([known('b', 105, 0), unk('u', 80, { stock: 'UNKNOWN' })]); s.renderProduct('p1');
  const h = s.view.innerHTML; assert.match(text(h.split('<section class="card buy">')[1]), /^Melhor preço com estoque R\$ 105,00/);
  assert.match(h.split('<details class="more so-more">')[1], /data-store="u"/); assert.doesNotMatch(h, /não informam o frete|não informa o frete/);
});
console.log(`✓ Frete comparável na página do produto (#84): ${n} grupos de testes passaram`);
