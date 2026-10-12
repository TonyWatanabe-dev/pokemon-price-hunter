// Lote A (UX no celular) — PR #288: selo Reclame Aqui com prefixo, CTA única nos cartões, um H1 por rota,
// eixo do gráfico sem marcas repetidas, % nas quedas e piso tipográfico/contraste no CSS.
// Roda trechos reais de index.html num sandbox (mesmo método de home-page-tests.js e opportunities-page-tests.js).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const cut = (a, b) => { const i = html.indexOf(a); const j = html.indexOf(b, i); assert.ok(i > 0 && j > i, `trecho ${a}`); return html.slice(i, j); };
const cutFn = (a) => { const i = html.indexOf(a); assert.ok(i > 0, `função ${a}`); const j = html.indexOf('\n}\n', i); assert.ok(j > i, `fim de ${a}`); return html.slice(i, j + 3); };
const line = (prefix) => { const l = html.split('\n').find((x) => x.startsWith(prefix)); assert.ok(l, `linha ${prefix}`); return l; };
let n = 0; const t = async (name, fn) => { await fn(); n++; };
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (v) => (typeof v !== 'number' ? '-' : 'R$ ' + v.toFixed(2).replace('.', ','));
const ic = (id) => `<i data-ic="${id}"></i>`;
const h1s = (h) => (h.match(/<h1[\s>]/g) || []).length;
const run = (code, ctx, expose) => { vm.createContext(ctx); vm.runInContext(code + `\n;globalThis.__t={${expose}};`, ctx); return ctx.__t; };

// ------------------------------------------------------------------ 1. selo Reclame Aqui: "RA 8,2", "RA: sem cadastro", "RA: sem índice"
await t('1. raShort e raBadge: prefixo RA e aria-label com "Reclame Aqui"', () => {
  const code = cut('const RA_ST=', 'const pixOf=');
  const ctx = { esc, safeUrl: (u) => u, encodeURIComponent, String, Date, S: { reputation: { consultadoEm: '2026-10-10', lojas: {
    boa: { status: 'BOM', nota: 8.2, url: 'https://www.reclameaqui.com.br/empresa/boa/' }, semcad: { status: 'NAO_ENCONTRADA' }, semidx: { status: 'SEM_INDICE' } } } } };
  const { raShort, raBadge } = run(code, ctx, 'raShort,raBadge');
  assert.equal(raShort('Boa', '8,2'), 'RA 8,2');
  assert.equal(raShort('Sem cadastro', null), 'RA: sem cadastro');
  assert.equal(raShort('Sem índice', null), 'RA: sem índice');
  assert.equal(raShort('RA1000', null), 'RA1000');
  const chip = raBadge({ storeId: 'boa', storeName: 'Loja Boa' });
  assert.match(chip, /<b>RA 8,2<\/b>/, 'texto visível com prefixo');
  const al = chip.match(/aria-label="([^"]*)"/)[1];
  assert.match(al, /Reclame Aqui/); assert.match(al, /^RA 8,2 · /, 'aria-label começa pelo texto visível');
  assert.match(raBadge({ storeId: 'semcad', storeName: 'X' }), /<b>RA: sem cadastro<\/b>/);
  assert.match(raBadge({ storeId: 'semidx', storeName: 'X' }), /<b>RA: sem índice<\/b>/);
  for (const sid of ['boa', 'semcad', 'semidx']) assert.match(raBadge({ storeId: sid, storeName: 'X' }).match(/aria-label="([^"]*)"/)[1], /Reclame Aqui/);
  // página do produto (full): texto completo, sem prefixo
  assert.match(raBadge({ storeId: 'boa', storeName: 'Loja Boa' }, true), /<span>Reclame Aqui<\/span><b>Boa<\/b><em>8,2\/10<\/em>/);
});

// ------------------------------------------------------------------ sandbox de /busca e do produto (fixtures de search-product-flow-tests.js)
const flowCode = [
  ...['const esc=', 'const money=', 'const pct=', 'const ago=', 'const safeUrl=', 'const norm=', 'function stockChip', 'const live=', 'const nrm=', 'const thirdParty=',
    'const storeTxt=', 'const pixTag=', 'const pixTxt=', 'const label=', 'const shipNote=', 'const byTot=', 'const bestLive=',
    'let AFIL=', 'const AFIL_OK=', 'const mlItem=', 'const outUrl=', 'const outRel='].map(line),
  cut('const readKnown=', 'const shipNote='),
  cut('function scoreChip', 'function storeOffer'),
  cut('const BAND_UI=', 'const RARITY='),
  cut('/* Busca: nome', '/* SearchInput'),
  cut('/* SearchInput com autocomplete', 'function acClose'),
  cutFn('function renderSearch'),
  cut('function scoreMeter', 'function dealCard'), cutFn('function dealCard'),
  cut('let curPid=null;', 'function openProduct'),
  cutFn('function storeOffer'), cutFn('function renderProduct'), cut('/* "Também na Amazon"', '/* Conta: login'),
  line('let PENDING_HASH='), line('function hashScroll'),
].join('\n');
const NOW = Date.now(); const iso = (minAgo) => new Date(NOW - minAgo * 6e4).toISOString();
const col = { id: 'me04', name: 'Caos Ascendente', series: 'Mega Evolução', products: 3 };
const prod = (id, x) => ({ id, collection: 'me04', collectionName: 'Caos Ascendente', type: 'blister_4', typeLabel: 'Blister Quádruplo', group: 'Blisters', boosters: 4, copagConfirmed: true, msrp: 55.99, offerCount: 1, ...x });
const PA = prod('p-a', { variant: 'Charizard', offerCount: 3 });
const PB = prod('p-b', { variant: 'Pikachu' });
const off = (id, productId, x) => ({ id, productId, storeId: 's-' + id, storeName: 'Loja ' + id.toUpperCase(), seller: 'Loja ' + id.toUpperCase(), stock: 'IN_STOCK', price: x.total, shipping: null, shippingKnown: false,
  url: 'https://loja.example/' + id, source_timestamp: iso(60), ...x });
const O1 = off('o1', 'p-a', { total: 49.9, opp: { score: 82, band: 'boa', confidence: 0.7, level: 'média' } });
const O2 = off('o2', 'p-a', { total: 45, price: 37, shipping: 8, shippingKnown: true });
const OB = off('ob', 'p-b', { total: 52 });
function flowSandbox() {
  const slots = { '#view': { innerHTML: '' } };
  const ctx = {
    console, S: { collections: [col], products: [PA, PB], reputation: { lojas: {} } }, OFF: [O1, O2, OB], P: { 'p-a': PA, 'p-b': PB },
    SLUG: { 'p-a': 'caos-ascendente-blister-quadruplo-charizard', 'p-b': 'caos-ascendente-blister-quadruplo-pikachu' },
    F: { q: '' }, view: 'busca', CHANGED: new Set(), HIST: {}, REFNOTE: 'ref', SEARCH_TIPS: new Map(), STOCK: { IN_STOCK: ['ok', 'Em estoque'], OUT_OF_STOCK: ['bad', 'Sem estoque'], PRE_ORDER: ['warn', 'Pré-venda'] },
    $: (sel) => slots[sel] || null, ic, dial: () => '', g: () => ({ c: '#000', icon: 'x' }), catOf: () => 'blister', catChip: () => '',
    isFav: () => false, raBadge: () => '', photo: () => '<div class="photo"></div>', tipHits: () => [], liveTips: () => [], tipCard: () => '',
    refOf: (p) => (p.copagConfirmed ? { v: p.msrp } : null), discOf: (p, o) => (p.copagConfirmed && o ? 1 - o.total / p.msrp : null),
    colHref: () => '', typeHref: () => '', favBtn: () => '', alertBox: () => '', scoreBlock: () => '', searchBox: () => '<form role="search"></form>', drawHist() {}, loadHist() {}, loadPpOpp() {},
    document: { title: '', getElementById: () => null, querySelectorAll: () => [] },
  };
  const x = run(flowCode, ctx, 'buildIndex,renderSearch,renderProduct,dealCard,bestOfferFor,nLiveOf');
  x.buildIndex();
  return { ...x, ctx, slots };
}

// ------------------------------------------------------------------ sandbox de /oportunidades (fixtures de opportunities-page-tests.js)
const oppPage = cut('/* Categorias do site', '/* Pré-vendas: status sempre visível */');
const oppItem = (id = 'sv4-box36', x = {}) => ({
  product: { id, slug: id, name: 'Fenda Paradoxal - Booster Box 36', type: 'booster_box', type_label: 'Booster Box', group: 'Boosters', image: null, collection: { code: 'sv4', name: 'Fenda Paradoxal' } },
  offer: { id: 'o-' + id, title: 't', url: 'https://ml/x', image: null, first_seen_at: '2026-10-08T13:30:10Z' },
  price: 1250, total: 1250, shipping: 'free', stock: 'in_stock', store: { id: 'mercadolivre', name: 'Mercado Livre' }, marketplace: 'mercadolivre',
  opportunity_score: 75, opportunity_band: 'boa', confidence: 0.41, confidence_level: 'baixa',
  current_reference: { kind: 'COPAG_OFFICIAL_CURRENT', label: 'Preço sugerido Copag', price: 1844.95, source: 'Copag', confidence: 0.95 }, market_composition: 'MARKETPLACE_ONLY',
  reference_comparison: { available: true, reference_kind: 'COPAG_OFFICIAL_CURRENT', reference_label: 'Preço sugerido Copag', reference_value: 1844.95, percentage_below: 32.25, amount_below: 594.95, position: 'below' },
  historical_context: [], community_reference: null, warnings: [], reasons: [], engine_version: 'opportunity-v2.2', updated_at: new Date().toISOString(), ...x,
});
function oppSandbox(items, liveCount = 3) {
  const view = { innerHTML: '' };
  const ctx = {
    console, URLSearchParams, Math, String, Number, Array, JSON, Object, Promise, setTimeout, Date,
    store: { get: (k, d) => d, set() {} }, S: { collections: [{ id: 'sv4', name: 'Fenda Paradoxal' }], reputation: { lojas: {} } }, SLUG: {},
    esc, money, ic, photo: () => '<div class="photo"></div>', catOf: () => 'box', g: () => ({ c: '#000' }), catChip: () => '', isFav: () => false, raBadge: () => '',
    safeUrl: (u) => u, outUrl: (u) => u, outRel: () => '', pixTag: () => '', ago: () => 'há 1 h', revealInit: undefined, OFF: [], P: Object.fromEntries(items.map((x) => [x.product.id, { liveCount }])), live: () => true,
    document: { addEventListener() {}, querySelectorAll: () => [] }, view: 'oportunidades', $: (sel) => (sel === '#view' ? view : null), IntersectionObserver: undefined,
    apiGet: async (path) => (path === 'oportunidades/lojas' ? { data: [] } : { data: items, meta: { page: 1, limit: 24, total: items.length, pages: 1, engine: 'opportunity-v2.2' } }),
  };
  return { ...run(oppPage, ctx, 'oppCard,renderOpp'), view, ctx };
}

// ------------------------------------------------------------------ 2. CTA única: "Ver oferta" preenchido + "Comparar N ofertas" secundário
await t('2. oppCard e dealCard: botão primário "Ver oferta" e link secundário "Comparar N ofertas"; áreas de toque ≥ 44px no CSS', () => {
  const o = oppSandbox([oppItem()]);
  const card = o.oppCard(oppItem(), 0, { h: 'h2' });
  assert.match(card, /<a class="deal-cta" href="https:\/\/ml\/x"[^>]*><span class="cta-l">Ver oferta<\/span>/, 'oportunidade: âncora com a classe do botão preenchido');
  assert.match(card, /<a class="opp-stores" href="\/produto\/[^"]*#ondecomprar"[^>]*>[\s\S]*?Comparar 3 ofertas com estoque<\/a>/, 'link secundário de comparação');
  assert.ok(card.indexOf('class="deal-cta"') < card.indexOf('class="opp-stores"'), 'botão antes do link secundário');
  assert.equal((card.match(/class="deal-cta"/g) || []).length, 1, 'uma CTA só');
  const f = flowSandbox();
  const dc = f.dealCard({ p: PA, o: f.bestOfferFor('p-a'), n: f.nLiveOf('p-a') }, { plain: true });
  assert.match(dc, /<a class="deal-cta" href="https:\/\/loja\.example\/o2"[^>]*>Ver oferta<span class="sr"> na Loja O2 \(abre em nova aba\)<\/span>/, 'busca: mesma classe do botão');
  assert.doesNotMatch(dc, /class="btn/, 'sem o botão antigo no cartão');
  assert.match(html, /\.deal-cta\{[^}]*min-height:44px/, 'botão com ≥44px');
  assert.match(html, /\.opp-stores\{[^}]*min-height:44px/, 'link de comparação com ≥44px');
});

// ------------------------------------------------------------------ 3. H1 em /busca, /precos e hierarquia do produto
await t('3. /busca e /precos com um H1; produto sem H3 antes do primeiro H2', () => {
  const f = flowSandbox();
  f.ctx.F.q = 'charizard'; f.renderSearch(); const busca = f.slots['#view'].innerHTML;
  assert.equal(h1s(busca), 1, '/busca: um H1'); assert.match(busca, /<h1>1 produto para "charizard"<\/h1>/); assert.match(busca, /<h2 class="deal-name">/, 'cartões em H2');
  f.ctx.F.q = 'zzzz'; f.renderSearch(); const vazio = f.slots['#view'].innerHTML;
  assert.equal(h1s(vazio), 1, '/busca sem resultado: um H1'); assert.match(vazio, /<h2>Não achamos esse produto<\/h2>/);
  f.renderProduct('p-a'); const det = f.slots['#view'].innerHTML;
  assert.equal(h1s(det), 1, 'produto: um H1');
  const h2 = det.search(/<h2[\s>]/), h3 = det.search(/<h3[\s>]/);
  assert.ok(h2 > 0, 'produto tem H2'); assert.ok(h3 === -1 || h3 > h2, 'nenhum H3 antes do primeiro H2');
  // /precos (renderCopag)
  const copagCode = cutFn('function renderCopag');
  const slot = { innerHTML: '' };
  const c = run(copagCode, { S: { products: [PA, { ...PB, copagConfirmed: false, copagReference: 50 }], collections: [col] }, esc, money, ic, safeUrl: (u) => u, REFNOTE: 'ref', label: (p) => p.typeLabel, Date, $: () => slot }, 'renderCopag');
  c.renderCopag();
  assert.equal(h1s(slot.innerHTML), 1, '/precos: um H1'); assert.match(slot.innerHTML, /<h1 class="panel-h1">Preços sugeridos Copag<\/h1>/);
  assert.match(html, /\.panel h2,\.panel \.panel-h1\{/, 'H1 do painel com o mesmo estilo do H2');
});

// ------------------------------------------------------------------ 4. eixo do gráfico: faixa < R$ 5 com 1 casa decimal, sem marcas repetidas
await t('4. tick(): faixa < 5 → decimais distintos; faixa ≥ 5 → inteiros', () => {
  const tickLine = line('  const tick=');
  const mk = (lo, hi) => run(`const lo=${lo},hi=${hi};${tickLine.trim()}`, { Math, Number }, 'tick').tick;
  const ticks = (lo, hi) => [0, 1, 2, 3].map((k) => mk(lo, hi)(lo + (hi - lo) * k / 3));
  const small = ticks(16.6, 17.4);
  assert.deepEqual(small, ['R$ 16,6', 'R$ 16,9', 'R$ 17,1', 'R$ 17,4']);
  for (const s of small) assert.match(s, /^R\$ \d+,\d$/, 'uma casa decimal');
  assert.equal(new Set(small).size, 4, 'marcas distintas');
  const big = ticks(10, 40);
  assert.deepEqual(big, ['R$ 10', 'R$ 20', 'R$ 30', 'R$ 40']);
  for (const s of big) assert.match(s, /^R\$ \d+$/, 'inteiros');
  assert.match(cutFn('function chart'), /hi-lo<5\?/, 'limiar na função real');
});

// ------------------------------------------------------------------ 5. quedas: percentual em cada item
await t('5. dropsHTML mostra o % de cada queda', () => {
  const code = cut('function dropsHTML(){', 'function highlightsOppHTML(){');
  const P = { 'p-a': PA, 'p-b': PB };
  const ctx = { P, SLUG: { 'p-a': 'a', 'p-b': 'b' }, esc, money, ic, Object, Math, label: (p) => p.typeLabel, photo: () => '<div class="photo"></div>', bestLive: () => null, dayLabel: () => 'ontem', pixOf: () => '',
    pct: (v) => (v * 100).toFixed(1).replace('.', ',') + '%', sectionHead: (i, t2) => `<h2>${t2}</h2>`,
    activity: () => [{ type: 'drop', productId: 'p-a', from: 100, to: 80, t: iso(60), storeName: 'L1', offerId: 'o1' }, { type: 'drop', productId: 'p-b', from: 50, to: 45, t: iso(30), storeName: 'L2', offerId: 'ob' }, { type: 'drop', productId: 'p-a', from: 0, to: 1 }] };
  const h = run(code, ctx, 'dropsHTML').dropsHTML();
  const items = h.split('<li ').slice(1);
  assert.equal(items.length, 2, 'uma queda por produto');
  for (const li of items) assert.match(li, /<span class="dl-pct"><i data-ic="trend-down"><\/i>\d+,\d%<\/span>/, 'percentual visível');
  assert.match(items[0], /20,0%/); assert.match(items[1], /10,0%/);
  assert.ok(items[0].includes('R$ 100,00') && items[0].includes('R$ 80,00'), 'de → para');
});

// ------------------------------------------------------------------ 6. CSS: contraste de --hot e piso tipográfico no celular
await t('6. --hot claro #C93D25 com contraste ≥ 4,5:1 sobre branco; piso de 12px no celular', () => {
  const root = cut(':root{', '}');
  const hot = root.match(/--hot:(#[0-9A-Fa-f]{6})/)?.[1];
  assert.equal(hot, '#C93D25');
  const lum = (hex) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contrast = (1 + lum('#ffffff')) / (lum(hot) + 0.05);
  assert.ok(contrast >= 4.5, `contraste ${contrast.toFixed(2)}:1`);
  const mobile = cut('/* Lote A: piso tipográfico no celular', '/* Reclame Aqui: reputação');
  assert.match(mobile, /@media \(max-width:760px\)\{/);
  const rules = mobile.slice(mobile.indexOf('@media (max-width:760px){') + '@media (max-width:760px){'.length);
  for (const sel of ['.pixk', '.pod-col', '.deal-col']) {
    const rule = rules.split('}').map((r) => r.split('{')).find(([sels, decl]) => decl && sels.split(',').some((s) => s.trim() === sel) && /font-size:(\d+)px/.test(decl));
    assert.ok(rule, `${sel} no bloco do celular`);
    const px = Number(rule[1].match(/font-size:(\d+)px/)[1]);
    assert.ok(px >= 12, `${sel} com ${px}px`);
  }
  assert.match(html, /\.pixk\{[^}]*font-size:11px/, 'desktop fica como está');
});

// ------------------------------------------------------------------ 7. um H1 por rota
await t('7. cada rota desenha um único H1 em #view', async () => {
  const got = {};
  // /busca e /produto
  const f = flowSandbox(); f.ctx.F.q = 'charizard'; f.renderSearch(); got.busca = f.slots['#view'].innerHTML; f.renderProduct('p-a'); got.produto = f.slots['#view'].innerHTML;
  // /oportunidades (lista pela API)
  const o = oppSandbox([oppItem(), oppItem('me04-etb')]); await o.renderOpp(); got.oportunidades = o.view.innerHTML;
  assert.match(got.oportunidades, /<h2 class="deal-name">/, 'cartões de oportunidade em H2');
  // / (home): renderDeals com as seções estubadas (cada uma é testada em home-page-tests.js)
  { const slot = { innerHTML: '' }; const cls = new Set();
    const ctx = { entries: () => [], sortEntries: (l) => l, refOf: () => null, F: { mode: 'guardar' }, S: { slim: true, counts: { liveOffers: 10, stores: 3 } }, OFF: [], live: () => true, Set, Date, Object, Math, ic, esc,
      freshState: () => ({}), freshTxt: () => ['agora'], tickerHTML: () => '', podiumOppHTML: () => '<div class="pod-skel"></div>', railOppHTML: () => '', colWallHTML: () => '<section><h2>Coleções</h2></section>',
      radarHTML: () => '', feedHTML: () => '<section><h2>Feed</h2></section>', dropsHTML: () => '<section><h2>Quedas</h2></section>', highlightsOppHTML: () => '', homeMotion() {}, startTicker() {}, stageInit() {}, revealInit() {},
      HOMEOPP: { status: 'ok', at: Date.now() }, APITTL: 60e3, loadHomeOpp: () => Promise.resolve(), paintHomeOpp() {}, $: () => slot, document: { body: { classList: { toggle: (c, v) => (v ? cls.add(c) : cls.delete(c)) } } } };
    run(cut('function renderDeals(){', '/* Produtos: todos os produtos com oferta'), ctx, 'renderDeals').renderDeals(); got.home = slot.innerHTML; }
  // /precos
  { const slot = { innerHTML: '' }; run(cutFn('function renderCopag'), { S: { products: [PA], collections: [col] }, esc, money, ic, safeUrl: (u) => u, REFNOTE: 'ref', label: (p) => p.typeLabel, Date, $: () => slot }, 'renderCopag').renderCopag(); got.precos = slot.innerHTML; }
  // /prevenda (com e sem pré-venda)
  { const slot = { innerHTML: '' }; const pre = { ...O1, id: 'pre', stock: 'PRE_ORDER' };
    const ctx = { OFF: [pre], P: { 'p-a': PA }, Object, ic, $: () => slot, dealCard: (e, opt) => `<article><${opt.h} class="deal-name">${e.p.typeLabel}</${opt.h}></article>` };
    run(cutFn('function renderPre'), ctx, 'renderPre').renderPre(); got.prevenda = slot.innerHTML; assert.match(got.prevenda, /<h2 class="deal-name">/, 'pré-venda: cartões em H2');
    ctx.OFF = []; ctx.__t.renderPre(); got['prevenda-vazia'] = slot.innerHTML; }
  // /guia (Lote E: o texto vem da const GUIA, logo acima de renderGuide)
  { const slot = { innerHTML: '' }; run(cut('const GUIA=', 'function renderGlossario'), { BAND_UI: { excelente: ['Excelente', '#0a0'], boa: ['Boa', '#0a0'], normal: ['Normal', '#aa0'], baixa: ['Baixa', '#a00'] }, ic, $: () => slot }, 'renderGuide').renderGuide(); got.guia = slot.innerHTML; }
  for (const [route, h] of Object.entries(got)) assert.equal(h1s(h), 1, `${route}: um H1 (${h1s(h)})`);
  assert.match(got.guia, /<h1 class="panel-h1">Como o site avalia as ofertas<\/h1>/);
  assert.match(got.home, /<h1><span class="ln"/, 'home: H1 do palco');
});

console.log(`ux-lote-a: ${n} testes ok`);
