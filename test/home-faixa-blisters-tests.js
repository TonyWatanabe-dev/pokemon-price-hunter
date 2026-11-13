// Faixa "Blisters e unitários" na Home (13/11/2026, pedido do dono: destaque para blister e unitário). Roda o código real
// de index.html num sandbox: ordem pelo menor preço por booster, uma linha por produto, só formatos de blister/booster
// avulso com estoque, e nada do Opportunity Score ou de comissão entrando na ordem.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const cut = (a, b) => { const i = html.indexOf(a); const j = html.indexOf(b, i); assert.ok(i > 0 && j > i, `trecho ${a}`); return html.slice(i, j); };
const trecho = (ini) => { const i = html.indexOf(ini); assert.ok(i > 0, ini); const j = html.indexOf('\nfunction ', html.indexOf('{', i)); assert.ok(j > i, ini); return html.slice(i, j); };
const code = cut('/* Faixa "Blisters e unitários"', 'function kitCtaHTML(){');
const dealCardCode = trecho('function dealCard(e,opt={}){');
let n = 0; const t = (name, fn) => { fn(); n++; };

const P = {
  'me05-blister1': { id: 'me05-blister1', type: 'blister_1', group: 'Blisters', collectionName: 'Escuridão Absoluta' },
  'me05-blister3': { id: 'me05-blister3', type: 'blister_3', group: 'Blisters', collectionName: 'Escuridão Absoluta' },
  'me01-blister4': { id: 'me01-blister4', type: 'blister_4', group: 'Blisters', collectionName: 'Megaevolução' },
  'me04-booster': { id: 'me04-booster', type: 'booster_pack', group: 'Boosters', collectionName: 'Caos Ascendente' },
  'me05-box36': { id: 'me05-box36', type: 'booster_box', group: 'Boosters', collectionName: 'Escuridão Absoluta' },
  'me03-etb': { id: 'me03-etb', type: 'etb', group: 'ETB', collectionName: 'Equilíbrio Perfeito' },
};
const of = (id, productId, perBooster, total, x = {}) => ({ id, productId, perBooster, total, price: total, storeId: 'shopee', storeName: 'Shopee', url: 'https://s.shopee.com.br/x', stock: 'IN_STOCK', ...x });
const OFF = [
  of('o1', 'me05-blister3', 13.30, 39.90),
  of('o2', 'me05-blister3', 16.63, 49.90),            // mesma linha, oferta pior: não pode repetir o produto
  of('o3', 'me01-blister4', 13.12, 52.46),
  of('o4', 'me05-blister1', 21.90, 21.90),
  of('o5', 'me04-booster', 15.00, 15.00),
  of('o6', 'me05-box36', 10.14, 365.00),              // display: fora da faixa, mesmo com o melhor por booster
  of('o7', 'me03-etb', 12.00, 395.00),                // ETB: fora da faixa
  of('o8', 'me05-blister1', null, 19.90),             // sem preço por booster: não entra
  of('o9', 'me05-blister1', 9.90, 9.90, { stock: 'OUT_OF_STOCK' }),   // sem estoque: não entra
];

function run(offers = OFF, produtos = P) {
  const ctx = {
    console, Math, String, Number, Array, JSON, Object, Set, Map, Date,
    OFF: offers, P: produtos, SLUG: {}, F: { mode: 'tudo' }, view: 'deals', CHANGED: new Set(), OFFPRE: {},
    live: (o) => o.stock === 'IN_STOCK', esc: (s) => String(s ?? ''), money: (v) => 'R$ ' + Number(v).toFixed(2).replace('.', ','),
    ic: (id) => `<i data-ic="${id}"></i>`, photo: () => '', catChip: () => '', catOf: () => 'blister', g: () => ({ c: '#000' }),
    isFav: () => false, raBadge: () => '', safeUrl: (u) => u, outUrl: (u) => u, outRel: () => '', pixTag: () => '',
    label: (p) => p.type, storeTxt: (o) => o.storeName, refOf: () => null, discOf: () => null, oppOf: () => null,
    scoreMeter: () => '', shipNote: () => '', staleOnly: () => null, staleNote: () => '', bandUI: () => ['', ''], cmpLink: () => '',
    sectionHead: (icon, title, sub, action) => `<header><h2>${title}</h2><p>${sub}</p>${action || ''}</header>`,
    dealCard: null,
  };
  vm.createContext(ctx);
  vm.runInContext(dealCardCode + code + '\n;globalThis.__h=blisterRailHTML();', ctx);
  return ctx.__h;
}
const ids = (h) => [...h.matchAll(/data-p="([^"]+)"/g)].map((m) => m[1]);

t('1. ordem pelo menor preço por booster, um card por produto', () => {
  const h = run();
  assert.deepEqual(ids(h), ['me01-blister4', 'me05-blister3', 'me04-booster', 'me05-blister1']);
  assert.equal(ids(h).filter((x) => x === 'me05-blister3').length, 1, 'produto não se repete quando há duas ofertas');
  assert.match(h, /R\$ 39,90/); assert.ok(!h.includes('49,90'), 'fica a oferta mais barata do produto');
});

t('2. só blister 1–4 e booster avulso: display, ETB e outros formatos ficam de fora', () => {
  const h = run();
  for (const fora of ['me05-box36', 'me03-etb']) assert.ok(!h.includes(fora), fora);
});

t('3. sem preço por booster ou sem estoque, a oferta não entra', () => {
  const h = run(OFF.filter((o) => ['o8', 'o9'].includes(o.id)));
  assert.equal(h, '', 'nenhuma oferta elegível: a seção não aparece');
});

t('4. mostra o preço por booster no card, e o total junto', () => {
  const h = run();
  assert.match(h, /R\$ 13,12/, 'preço por booster do primeiro');
  assert.match(h, /por booster · total R\$ 52,46/);
});

t('5. no máximo 12 cards', () => {
  const muitos = Array.from({ length: 20 }, (_, i) => of('x' + i, 'p' + i, 10 + i, 30));
  const prods = Object.fromEntries(muitos.map((o, i) => [o.productId, { id: o.productId, type: 'blister_3', group: 'Blisters', collectionName: 'C' }]));
  assert.equal(ids(run(muitos, prods)).length, 12);
});

t('6. a faixa é renderizada na Home entre o palco e o "Monte seu kit", e o link leva ao filtro de Blisters', () => {
  const i = html.indexOf('id="home-bl"'), j = html.indexOf('${kitCtaHTML()}', i), k = html.indexOf('id="home-rail"', i);
  assert.ok(i > 0 && j > i && k > j, 'ordem: faixa → Monte seu kit → Em sequência');
  assert.match(run(), /data-fmt="Blisters"/);
  assert.ok(!/opportunity_score|opp_score|HOMEOPP|apiGet/.test(code), 'a faixa não lê o motor nem chama a API');
});

console.log(`✓ Home — faixa "Blisters e unitários": ${n} grupos de testes passaram`);
