// Lote B (UX das listas) — cartão compacto em /oportunidades no celular e /busca com paginação (24), ordenação e chips de tipo.
// Roda trechos reais de index.html num sandbox (mesmo método de ux-lote-a-tests.js e search-product-flow-tests.js).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const cut = (a, b) => { const i = html.indexOf(a); const j = html.indexOf(b, i); assert.ok(i > 0 && j > i, `trecho ${a}`); return html.slice(i, j); };
const cutFn = (a) => { const i = html.indexOf(a); assert.ok(i > 0, `função ${a}`); const j = html.indexOf('\n}\n', i); assert.ok(j > i, `fim de ${a}`); return html.slice(i, j + 3); };
const line = (prefix) => { const l = html.split('\n').find((x) => x.startsWith(prefix)); assert.ok(l, `linha ${prefix}`); return l; };
let n = 0; const t = async (name, fn) => { await fn(); n++; };
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const ic = (id) => `<i data-ic="${id}"></i>`;
const run = (code, ctx, expose) => { vm.createContext(ctx); vm.runInContext(code + `\n;globalThis.__t={${expose}};`, ctx); return ctx.__t; };

// ------------------------------------------------------------------ sandbox de /busca (fixtures no estilo de search-product-flow-tests.js, com 30 produtos)
const flowCode = [
  ...['const esc=', 'const money=', 'const pct=', 'const ago=', 'const safeUrl=', 'const norm=', 'function stockChip', 'const live=', 'const nrm=', 'const thirdParty=',
    'const storeTxt=', 'const pixTag=', 'const pixTxt=', 'const label=', 'const shipNote=', 'const byTot=', 'const bestLive=',
    'let AFIL=', 'const AFIL_OK=', 'const mlItem=', 'const outUrl=', 'const outRel=', 'const BTIPOS=', 'const btipoOf=', 'const BORDS='].map(line),
  cut('const readKnown=', 'const shipNote='),
  cut('function scoreChip', 'function storeOffer'),
  cut('const BAND_UI=', 'const RARITY='),
  cut('/* Busca: nome', '/* SearchInput'),
  cut('/* SearchInput com autocomplete', 'function acClose'),
  cutFn('function renderSearch'), cutFn('function moreBusca'), line('function buscaNav'),
  cut('function scoreMeter', 'function dealCard'), cutFn('function dealCard'),
].join('\n');
const NOW = Date.now(); const iso = (minAgo) => new Date(NOW - minAgo * 6e4).toISOString();
const col = { id: 'me04', name: 'Caos Ascendente', series: 'Mega Evolução', products: 30 };
const prod = (id, x) => ({ id, collection: 'me04', collectionName: 'Caos Ascendente', type: 'blister_4', typeLabel: 'Blister Quádruplo', group: 'Blisters', boosters: 4, copagConfirmed: true, msrp: 55.99, offerCount: 1, ...x });
const off = (id, productId, x) => ({ id, productId, storeId: 's-' + id, storeName: 'Loja ' + id.toUpperCase(), seller: 'Loja ' + id.toUpperCase(), stock: 'IN_STOCK', price: x.total, shipping: null, shippingKnown: false,
  url: 'https://loja.example/' + id, source_timestamp: iso(60), ...x });
// 30 produtos: 24 blisters (contêm boosters), 3 booster box, 2 ETB e 1 booster avulso; cada um com uma oferta, preços e notas variados
const PRODS = [], OFFS = [];
for (let i = 0; i < 24; i++) { PRODS.push(prod('bl-' + i, { variant: 'Var' + i })); OFFS.push(off('o-bl-' + i, 'bl-' + i, { total: 40 + i, opp: { score: 50 + i, band: 'boa' } })); }
for (let i = 0; i < 3; i++) { PRODS.push(prod('bb-' + i, { type: 'booster_box', typeLabel: 'Booster Box', group: 'Boosters', boosters: 36, msrp: 1500 })); OFFS.push(off('o-bb-' + i, 'bb-' + i, { total: 900 + i * 50, opp: { score: 90 - i, band: 'excelente' } })); }
for (let i = 0; i < 2; i++) { PRODS.push(prod('etb-' + i, { type: 'etb', typeLabel: 'Treinador Avançado (ETB)', group: 'Caixas', boosters: 9, msrp: 300 })); OFFS.push(off('o-etb-' + i, 'etb-' + i, { total: 250 + i, opp: { score: 95, band: 'excelente' } })); }
PRODS.push(prod('bp-0', { type: 'booster_pack', typeLabel: 'Booster unitário', group: 'Boosters', boosters: 1, copagConfirmed: false })); OFFS.push(off('o-bp-0', 'bp-0', { total: 16.9 }));
function flowSandbox() {
  const slots = { '#view': { innerHTML: '' } };
  const ctx = {
    console, URLSearchParams, S: { collections: [col], products: PRODS, reputation: { lojas: {} } }, OFF: OFFS, P: Object.fromEntries(PRODS.map((p) => [p.id, p])), SLUG: {},
    F: { q: '', tipo: '', ord: '' }, view: 'busca', CHANGED: new Set(), HIST: {}, REFNOTE: 'ref', SEARCH_TIPS: new Map(), STOCK: { IN_STOCK: ['ok', 'Em estoque'], OUT_OF_STOCK: ['bad', 'Sem estoque'], PRE_ORDER: ['warn', 'Pré-venda'] },
    $: (sel) => slots[sel] || null, ic, dial: () => '', g: () => ({ c: '#000', icon: 'x' }), catOf: () => 'blister', catChip: () => '',
    isFav: () => false, raBadge: () => '', photo: () => '<div class="photo"></div>', tipHits: () => [], liveTips: () => [], tipCard: () => '',
    refOf: (p) => (p.copagConfirmed ? { v: p.msrp } : null), discOf: (p, o) => (p.copagConfirmed && o ? 1 - o.total / p.msrp : null),
    searchBox: () => '<form role="search"></form>', track() {}, render() {}, history: { pushState() {} }, location: { pathname: '/busca', search: '' },
    document: { title: '', getElementById: () => null, querySelectorAll: () => [] },
  };
  const x = run(flowCode, ctx, 'buildIndex,renderSearch,searchProducts,sortBusca,buscaCards,buscaURL,buscaFromURL,btipoOf,B_PAGE');
  x.buildIndex();
  const search = (q, o = {}) => { Object.assign(ctx.F, { q, tipo: '', ord: '' }, o); x.renderSearch(); return slots['#view'].innerHTML; };
  // arrays do vm vêm de outro realm: deepEqual compararia protótipos diferentes
  return { ...x, ctx, slots, search, searchProducts: (q) => Array.from(x.searchProducts(q)), sortBusca: (c, o) => Array.from(x.sortBusca(c, o)), buscaCards: (q) => { const r = x.buscaCards(q); return { ...r, cards: Array.from(r.cards) }; } };
}
const names = (h) => [...h.matchAll(/<h2 class="deal-name">([^<]*)<\/h2>/g)].map((m) => m[1]);

// ------------------------------------------------------------------ 1. cartão compacto de /oportunidades no celular (CSS)
await t('1. CSS: no celular (≤760px) a imagem do cartão de oportunidade tem altura fixa ≤ 140px; linha de ação com botão + "Comparar N"', () => {
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  const m = css.match(/\n  \.opp \.deals \.opp-card \.deal-media\{([^}]*)\}/); assert.ok(m, 'regra da imagem do cartão compacto');
  const before = css.slice(0, m.index); const open = before.lastIndexOf('@media (max-width:760px){');
  assert.ok(open > 0 && !/\n\}/.test(before.slice(open)), 'regra dentro de @media (max-width:760px)');
  const h = Number((m[1].match(/height:(\d+)px/) || [])[1]);
  assert.ok(h >= 120 && h <= 140, `altura da imagem entre 120 e 140px (${h})`); assert.match(m[1], /aspect-ratio:auto/, 'sem o 4/3 do desktop');
  assert.match(css, /\.opp \.deals \.opp-card \.opp-act\{flex-direction:row/, 'botão e "Comparar N" na mesma linha');
  assert.match(css, /\.opp \.deals \.opp-card \.opp-stores-x\{position:absolute;width:1px;height:1px[^}]*clip:rect\(0 0 0 0\)/, 'no celular o link mostra "Comparar N" mas mantém o nome acessível');
  assert.match(css, /\.opp \.deals \.opp-card \.opp-cmp-r,\.opp \.deals \.opp-card \.opp-cmp:not\(\.up\) \.opp-cmp-w\{position:absolute;width:1px;height:1px[^}]*clip:rect\(0 0 0 0\)/, '"acima" continua escrito; só "abaixo" vira o sinal −');
  assert.match(css, /\.deal-cta\{[^}]*min-height:44px/, 'botão ≥ 44px continua');
  assert.doesNotMatch(css, /\.opp \.deals \.opp-card \.pixk\{[^}]*display:none/, 'etiqueta Pix nunca some');
});

// ------------------------------------------------------------------ 2. oppCard: preço, Pix e referência num bloco; confiança + idade juntas; "Comparar N" dentro do bloco de ação
await t('2. oppCard: Pix e referência continuam visíveis, "Por que esta nota?" continua, Comparar N na linha de ação', () => {
  const oppPage = cut('/* Categorias do site', '/* Pré-vendas: status sempre visível */');
  const item = { product: { id: 'sv4-box36', slug: 'sv4-box36', name: 'Fenda Paradoxal - Booster Box 36', type: 'booster_box', type_label: 'Booster Box', group: 'Boosters', image: null, collection: { code: 'sv4', name: 'Fenda Paradoxal' } },
    offer: { id: 'o-1', title: 't', url: 'https://ml/x', image: null, first_seen_at: '2026-10-08T13:30:10Z', price_kind: 'pix' },
    price: 1250, total: 1250, shipping: 'free', stock: 'in_stock', store: { id: 'ml', name: 'Mercado Livre' }, marketplace: 'ml',
    opportunity_score: 88, opportunity_band: 'boa', confidence: 0.9, confidence_level: 'alta',
    current_reference: { kind: 'COPAG_OFFICIAL_CURRENT', label: 'Preço sugerido Copag', price: 1844.95, source: 'Copag', confidence: 0.95 }, market_composition: 'NONE',
    reference_comparison: { available: true, reference_kind: 'COPAG_OFFICIAL_CURRENT', reference_label: 'Preço sugerido Copag', reference_value: 1844.95, percentage_below: 32.25, amount_below: 594.95, position: 'below' },
    historical_context: [], community_reference: null, warnings: [], reasons: [], engine_version: 'opportunity-v2.2', updated_at: new Date().toISOString() };
  const ctx = { console, URLSearchParams, Math, String, Number, Array, JSON, Object, Promise, setTimeout, Date, store: { get: (k, d) => d, set() {} },
    S: { collections: [], reputation: { lojas: {} } }, SLUG: {}, esc: (s) => String(s ?? ''), money: (v) => 'R$ ' + v.toFixed(2).replace('.', ','), ic, photo: () => '<div class="photo"></div>',
    catOf: () => 'box', g: () => ({ c: '#000' }), catChip: () => '', isFav: () => false, raBadge: () => '', safeUrl: (u) => u, outUrl: (u) => u, outRel: () => '',
    pixTag: (o) => (o?.priceKind === 'pix' ? '<em class="pixk">no Pix</em>' : ''), ago: () => 'há 1 h', OFF: [], P: { 'sv4-box36': { liveCount: 5 } }, live: () => true,
    document: { addEventListener() {}, querySelectorAll: () => [] }, view: 'oportunidades', $: () => null };
  const { oppCard } = run(oppPage, ctx, 'oppCard');
  const card = oppCard(item, 0, { h: 'h2' }); const tx = text(card);
  assert.match(card, /<div class="opp-pv"><p class="deal-price opp-price"><b>R\$ 1250,00<\/b><em class="pixk">no Pix<\/em><\/p><p class="opp-cmp"/, 'preço + Pix + comparação no mesmo bloco');
  assert.match(tx, /R\$ 1250,00 no Pix −32,3% abaixo do preço sugerido Copag · R\$ 1844,95 Frete grátis/, 'Pix e referência sempre no texto');
  assert.match(card, /<span class="opp-cmp-w">abaixo<\/span> <span class="opp-cmp-r">do preço sugerido<\/span>/);
  assert.match(card, /<div class="rc-row"><p class="opp-conf lv-alta"[^>]*>.*?<\/p><p class="opp-age ">/, 'confiança e idade na mesma linha');
  assert.match(tx, /88 · Boa/); assert.match(card, /Por que esta nota\?/);
  assert.match(card, /<div class="opp-act"><a class="deal-cta"[\s\S]*?<\/a><a class="opp-stores"[^>]*>.*?Comparar 5<span class="opp-stores-x"> ofertas com estoque<\/span><\/a><\/div><\/div>/, 'botão e Comparar N juntos no rodapé');
  assert.equal((card.match(/<h1/g) || []).length, 0); assert.equal((card.match(/<h2 /g) || []).length, 1, 'cartão em H2');
});

// ------------------------------------------------------------------ 3. /busca pagina de 24 em 24 com "Carregar mais (N restantes)"
await t('3. /busca: 24 cartões, botão "Carregar mais (6 restantes)" e região viva com a contagem', () => {
  const f = flowSandbox(); const h = f.search('caos');
  assert.equal(f.B_PAGE, 24); assert.match(h, /<h1>30 produtos para "caos"<\/h1>/);
  assert.equal(names(h).length, 24, '24 cartões na primeira página');
  assert.match(h, /<button class="btn" type="button" id="busca-more" data-buscamore>Carregar mais \(6 restantes\)<\/button>/);
  assert.match(h, /<p class="sr" id="busca-live" aria-live="polite">Mostrando 24 de 30 produtos<\/p>/);
  assert.equal((h.match(/<h1/g) || []).length, 1, 'um H1'); assert.match(h, /<div class="deals busca-deals" id="busca-deals">/);
  // com 24 ou menos, sem botão
  const h2 = f.search('caos', { tipo: 'blister' }); assert.equal(names(h2).length, 24); assert.doesNotMatch(h2, /busca-more/); assert.match(h2, /Mostrando 24 de 24 produtos/);
});

// ------------------------------------------------------------------ 4. ordenação
await t('4. sortBusca: menor preço, maior desconto, melhor nota (sem oferta/sem dado no fim; relevância = ordem de entrada)', () => {
  const f = flowSandbox(); const { cards } = f.buscaCards('caos');
  const tot = (c) => c.map((e) => e.o?.total);
  const preco = f.sortBusca(cards, 'preco'); assert.deepEqual(tot(preco).slice(0, 3), [16.9, 40, 41]); assert.equal(tot(preco).at(-1), 1000);
  const desc = f.sortBusca(cards, 'desconto'); assert.deepEqual(desc.slice(0, 3).map((e) => e.p.id), ['bb-0', 'bb-1', 'bb-2'], 'booster box com 40%, 37% e 33% de desconto primeiro');
  assert.equal(desc.at(-1).p.id, 'bp-0', 'sem preço Copag (sem desconto) no fim');
  const nota = f.sortBusca(cards, 'nota'); assert.deepEqual(nota.slice(0, 2).map((e) => e.p.id), ['etb-0', 'etb-1']); assert.equal(nota.at(-1).p.id, 'bp-0', 'sem nota no fim');
  assert.deepEqual(f.sortBusca(cards, '').map((e) => e.p.id), cards.map((e) => e.p.id), 'relevância não mexe na ordem');
  assert.deepEqual(cards.map((e) => e.o?.total).slice(0, 3), [250, 251, 900], 'não muda o array original (relevância: nota maior primeiro)');
  const h = f.search('caos', { ord: 'preco' }); assert.equal(names(h)[0], 'Booster unitário'); assert.match(h, /<option value="preco" selected>Menor preço<\/option>/);
  assert.match(h, /<select id="b-ord" data-bord>/); assert.match(h, /<option value="">Relevância<\/option>/, 'Relevância sem selected quando a ordem é outra');
});

// ------------------------------------------------------------------ 5. relevância: tipo exato primeiro
await t('5. "booster": booster box e booster avulso antes dos blisters que só contêm boosters', () => {
  const f = flowSandbox(); const r = f.searchProducts('booster').map((x) => x.p.id);
  assert.equal(r.length, 30, 'todos batem (blister tem "4 boosters")');
  assert.deepEqual(new Set(r.slice(0, 4)), new Set(['bb-0', 'bb-1', 'bb-2', 'bp-0']), 'os 4 de tipo booster primeiro');
  assert.ok(r.slice(4).every((id) => id.startsWith('bl-') || id.startsWith('etb-')), 'blisters e ETB depois');
  // nome antes de coleção: "var3" é variante (nome) de um blister só
  assert.equal(f.searchProducts('var3')[0].p.id, 'bl-3');
  // coleção pura: ordem de relevância segue a pontuação (booster box com nota maior na frente)
  assert.equal(f.searchProducts('caos')[0].p.id, 'etb-0');
});

// ------------------------------------------------------------------ 6. chips de tipo
await t('6. chips de tipo da taxonomia: contagem, aria-pressed e filtro que reduz a lista', () => {
  const f = flowSandbox(); const h = f.search('caos');
  assert.match(h, /<div class="busca-tipos" role="group" aria-label="Filtrar por tipo">/);
  assert.match(h, /<button type="button" class="fchip" data-btipo="booster_box" aria-pressed="false">Booster Box <small>3<\/small><\/button>/);
  assert.match(h, /data-btipo="blister" aria-pressed="false">Blister <small>24<\/small>/); assert.match(h, /data-btipo="etb"[^>]*>ETB <small>2<\/small>/); assert.match(h, /data-btipo="booster_pack"[^>]*>Booster avulso <small>1<\/small>/);
  assert.doesNotMatch(h, /data-btipo="lata"/, 'tipo sem resultado não vira chip');
  const e = f.search('caos', { tipo: 'etb' });
  assert.match(e, /<h1>2 produtos para "caos"<\/h1>/); assert.equal(names(e).length, 2); assert.match(e, /data-btipo="etb" aria-pressed="true"/);
  assert.match(e, /data-btipo="blister" aria-pressed="false">Blister <small>24<\/small>/, 'contagem dos chips é da busca inteira');
  assert.equal(f.btipoOf({ type: 'blister_2' }), 'blister'); assert.equal(f.btipoOf({ type: 'minilata' }), 'lata'); assert.equal(f.btipoOf({ type: 'desafio' }), 'deck'); assert.equal(f.btipoOf({ type: 'colecao_ex' }), 'colecao'); assert.equal(f.btipoOf({ type: 'zzz' }), '');
  const z = f.search('var3', { tipo: 'etb' }); assert.match(z, /<h1>Nenhum produto para "var3"<\/h1>/); assert.match(z, /<h2>Nenhum produto desse tipo<\/h2>/); assert.match(z, /data-btipo="etb">Ver todos os tipos/);
  assert.doesNotMatch(f.search('var3'), /busca-tipos/, 'um tipo só: sem chips');
});

// ------------------------------------------------------------------ 7. estado na URL
await t('7. URL ⇄ estado: /busca?q=&tipo=&ord= e valores inválidos viram vazio', () => {
  const f = flowSandbox();
  Object.assign(f.ctx.F, { q: 'booster box', tipo: 'etb', ord: 'preco' }); assert.equal(f.buscaURL(), '/busca?q=booster+box&tipo=etb&ord=preco');
  Object.assign(f.ctx.F, { q: 'caos', tipo: '', ord: '' }); assert.equal(f.buscaURL(), '/busca?q=caos');
  f.buscaFromURL('?q=booster+box&tipo=etb&ord=preco'); assert.deepEqual([f.ctx.F.q, f.ctx.F.tipo, f.ctx.F.ord], ['booster box', 'etb', 'preco']);
  f.buscaFromURL('?q=x&tipo=hack&ord=hack'); assert.deepEqual([f.ctx.F.q, f.ctx.F.tipo, f.ctx.F.ord], ['x', '', '']);
  f.buscaFromURL('?q=' + 'a'.repeat(100)); assert.equal(f.ctx.F.q.length, 80);
  for (const u of ['/busca?q=caos&tipo=blister&ord=nota', '/busca?q=caos&ord=desconto', '/busca?q=caos']) { f.buscaFromURL(u.slice(u.indexOf('?'))); assert.equal(f.buscaURL(), u, 'ida e volta: ' + u); }
  assert.match(html, /if\(r\.view==="busca"\)buscaFromURL\(location\.search\);/, 'popstate lê a URL (voltar/avançar)');
  assert.match(html, /if\(location\.pathname\.startsWith\("\/busca"\)\)buscaFromURL\(location\.search\)/, 'carga inicial lê a URL');
  assert.match(html, /F\.q=q;F\.tipo="";const u=buscaURL\(\)/, 'nova busca zera o tipo e mantém a ordenação');
});

// ------------------------------------------------------------------ 8. hierarquia do cartão na busca: preço sempre maior, % embaixo
await t('8. CSS: na busca o preço é o maior elemento e o % de desconto vem embaixo, menor', () => {
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  assert.match(css, /\.busca-deals \.deal-price\{order:2\}\.busca-deals \.deal-save\{order:3\}/, 'preço antes do desconto');
  const price = Number(css.match(/\.busca-deals \.deal-price b\{font-size:(\d+)px/)[1]); const save = Number(css.match(/\.busca-deals \.deal-save b\{font-size:(\d+)px/)[1]);
  assert.ok(price > save, `preço (${price}px) maior que o % (${save}px)`);
  assert.match(css, /\.busca-more\{display:flex;justify-content:center/);
});

t('mobile: texto resumido fica só visualmente oculto (nome acessível preservado)', () => {
  const css = html.slice(html.indexOf('<style'), html.indexOf('</style>'));
  for (const sel of ['.opp-stores-x', '.opp-cmp-r']) {
    const i = css.indexOf('.opp .deals .opp-card ' + sel); assert.ok(i > 0, sel);
    const rule = css.slice(i, css.indexOf('}', i));
    assert.ok(!/display:none/.test(rule) && /clip:rect\(0 0 0 0\)/.test(rule), sel + ' deve usar ocultação visual, não display:none');
  }
});
console.log(`ux-lote-b: ${n} testes ok`);
