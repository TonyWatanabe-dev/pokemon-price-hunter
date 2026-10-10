// Issue #43 — fluxo principal de compra: busca → resultado (card) → detalhe do produto → ofertas por loja.
// Roda o código real de index.html (busca, dealCard, renderSearch, renderProduct, storeOffer) num sandbox, sem navegador.
// Não exercita: navegador real, rede nem layout renderizado (só a presença de viewport e media queries no CSS).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const cut = (a, b) => { const i = html.indexOf(a); const j = html.indexOf(b, i); assert.ok(i > 0 && j > i, `trecho ${a}`); return html.slice(i, j); };
const cutFn = (a) => { const i = html.indexOf(a); assert.ok(i > 0, `função ${a}`); const j = html.indexOf('\n}\n', i); assert.ok(j > i, `fim de ${a}`); return html.slice(i, j + 3); };
const line = (prefix) => { const l = html.split('\n').find((x) => x.startsWith(prefix)); assert.ok(l, `linha ${prefix}`); return l; };
let n = 0; const t = (name, fn) => { fn(); n++; };
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const code = [
  ...['const esc=', 'const money=', 'const pct=', 'const ago=', 'const safeUrl=', 'const norm=', 'function stockChip', 'const live=', 'const nrm=', 'const thirdParty=',
    'const storeTxt=', 'const pixTag=', 'const pixTxt=', 'const label=', 'const shipNote=', 'const byTot=', 'const bestLive=', 'function scoreChip'].map(line),
  cut('const BAND_UI=', 'const RARITY='),
  cut('/* Busca: nome', '/* SearchInput'),
  cut('/* SearchInput', 'function acClose'),
  cutFn('function renderSearch'),
  cut('function scoreMeter', 'function dealCard'), cutFn('function dealCard'),
  cut('let curPid=null;', 'function openProduct'),
  cutFn('function storeOffer'), cutFn('function renderProduct'),
].join('\n');

const NOW = Date.now(); const iso = (minAgo) => new Date(NOW - minAgo * 6e4).toISOString();
const col = { id: 'me04', name: 'Caos Ascendente', series: 'Mega Evolução', products: 3 };
const prod = (id, x) => ({ id, collection: 'me04', collectionName: 'Caos Ascendente', type: 'blister_4', typeLabel: 'Blister Quádruplo', group: 'Blisters', boosters: 4, copagConfirmed: true, msrp: 55.99, offerCount: 1, ...x });
const PA = prod('p-a', { variant: 'Charizard', offerCount: 3 });
const PB = prod('p-b', { variant: 'Pikachu' });
const PC = prod('p-c', { type: 'etb', typeLabel: 'Elite Trainer Box', group: 'Caixas', boosters: 9, copagConfirmed: false });
const off = (id, productId, x) => ({ id, productId, storeId: 's-' + id, storeName: 'Loja ' + id.toUpperCase(), seller: 'Loja ' + id.toUpperCase(), stock: 'IN_STOCK', price: x.total, shipping: null, shippingKnown: false,
  url: 'https://loja.example/' + id, source_timestamp: iso(60), ...x });
const O1 = off('o1', 'p-a', { total: 49.9, opp: { score: 82, band: 'boa', confidence: 0.7, level: 'média' } });          // frete desconhecido
const O2 = off('o2', 'p-a', { total: 45, price: 37, shipping: 8, shippingKnown: true });                                   // melhor oferta com estoque
const O3 = off('o3', 'p-a', { total: 30, stale: true });                                                                   // mais barata, mas leitura antiga
const OB = off('ob', 'p-b', { total: 52 });
const OC = off('oc', 'p-c', { total: 100, stock: 'OUT_OF_STOCK' });

function sandbox({ loaded = true } = {}) {
  const slots = { '#view': { innerHTML: '' } }; const boxes = { 'q-ac': { innerHTML: '', hidden: true } };
  const ctx = {
    console, S: loaded ? { collections: [col], reputation: { lojas: {} } } : null, OFF: [O1, O2, O3, OB, OC], P: { 'p-a': PA, 'p-b': PB, 'p-c': PC },
    SLUG: { 'p-a': 'caos-ascendente-blister-quadruplo-charizard', 'p-b': 'caos-ascendente-blister-quadruplo-pikachu', 'p-c': 'caos-ascendente-elite-trainer-box' },
    F: { q: '' }, view: 'busca', CHANGED: new Set(), HIST: {}, REFNOTE: 'ref', SEARCH_TIPS: new Map(), STOCK: { IN_STOCK: ['ok', 'Em estoque'], OUT_OF_STOCK: ['bad', 'Sem estoque'], PRE_ORDER: ['warn', 'Pré-venda'] },
    $: (sel) => slots[sel] || null, ic: (id) => `<i data-ic="${id}"></i>`, dial: () => '', g: () => ({ c: '#000', icon: 'x' }), catOf: () => 'blister', catChip: () => '',
    isFav: () => false, raBadge: () => '', photo: () => '<div class="photo"></div>', tipHits: () => [], liveTips: () => [], tipCard: () => '',
    refOf: (p) => (p.copagConfirmed ? { v: p.msrp } : null), discOf: (p, o) => (p.copagConfirmed && o ? 1 - o.total / p.msrp : null),
    colHref: () => '', typeHref: () => '', favBtn: () => '', alertBox: () => '', scoreBlock: () => '', searchBox: () => '<form role="search"></form>', drawHist() {}, loadHist() {},
    document: { title: '', getElementById: (id) => boxes[id] || null, querySelectorAll: () => [] },
  };
  vm.createContext(ctx);
  vm.runInContext(code + '\n;globalThis.__t={buildIndex,searchProducts,renderSearch,renderProduct,dealCard,storeOffer,bestOfferFor,nLiveOf,acRender};', ctx);
  if (loaded) ctx.__t.buildIndex();
  return { ...ctx.__t, ctx, slots, boxes };
}
const input = (value) => { const attrs = {}; return { id: 'q', value, attrs, setAttribute: (k, v) => { attrs[k] = v; } }; };
const search = (s, q) => { s.ctx.F.q = q; s.renderSearch(); return s.slots['#view'].innerHTML; };
const cardOf = (s, pid) => s.dealCard({ p: s.ctx.P[pid], o: s.bestOfferFor(pid), n: s.nLiveOf(pid) }, { plain: true });
const detail = (s, pid) => { s.renderProduct(pid); return s.slots['#view'].innerHTML; };

// ------------------------------------------------------------------ busca: resultados, variante, tolerância
t('busca: coleção, variante, plural e erro de digitação', () => {
  const s = sandbox();
  assert.deepEqual(s.searchProducts('charizard').map((x) => x.p.id), ['p-a'], 'variante separa produtos da mesma coleção');
  assert.deepEqual(s.searchProducts('pikachu').map((x) => x.p.id), ['p-b']);
  assert.deepEqual(s.searchProducts('charizrd').map((x) => x.p.id), ['p-a'], 'erro de digitação');
  assert.deepEqual(s.searchProducts('blisters').map((x) => x.p.id).sort(), ['p-a', 'p-b'], 'plural');
  assert.deepEqual(s.searchProducts('caos charizard').map((x) => x.p.id), ['p-a'], 'todos os termos precisam casar');
  assert.deepEqual(s.searchProducts('   '), [], 'busca vazia não lista nada');
});

// ------------------------------------------------------------------ resultados parciais (com e sem estoque)
t('resultados parciais: com estoque primeiro, sem estoque sinalizado', () => {
  const s = sandbox(); const h = search(s, 'caos');
  assert.match(text(h), /3 produtos para "caos"/);
  const pos = ['p-a', 'p-b', 'p-c'].map((id) => h.indexOf(`data-p="${id}"`));
  assert.ok(pos.every((x) => x > 0) && pos[0] < pos[2] && pos[1] < pos[2], 'produto sem estoque vem depois dos com estoque');
  const c = cardOf(s, 'p-c');
  assert.match(c, /deal-badge muted">Sem estoque/, 'card sem estoque diz que não há estoque');
  assert.ok(!/scoreMeter|class="meter/.test(c), 'sem estoque não mostra nota');
  assert.match(text(h), /Caos Ascendente/);
});

// ------------------------------------------------------------------ vazio, erro/carregando, escape
t('estado vazio: mensagem, sugestão de coleção e saída', () => {
  const s = sandbox(); const h = search(s, 'xyzzyq');
  assert.match(text(h), /Nenhum produto para "xyzzyq"/); assert.match(h, /Não achamos esse produto/);
  assert.match(h, /data-q="Caos Ascendente"/, 'sugere coleção'); assert.match(h, /data-go=""/, 'tem saída para as ofertas');
});
t('termo digitado é escapado (título, vazio e autocomplete)', () => {
  const s = sandbox(); const h = search(s, '<img src=x onerror=alert(1)>');
  assert.ok(!/<img src=x/.test(h), 'sem HTML injetado'); assert.match(h, /&lt;img/);
  const i = input('<script>x'); s.acRender(i); assert.ok(!/<script>x/.test(s.boxes['q-ac'].innerHTML));
});
t('carregando: autocomplete avisa enquanto os produtos não chegaram', () => {
  const s = sandbox({ loaded: false }); const i = input('char'); s.acRender(i);
  assert.match(s.boxes['q-ac'].innerHTML, /Carregando os produtos/); assert.equal(s.boxes['q-ac'].hidden, false);
});
t('autocomplete: sem resultado, curto e com resultado (papéis de acessibilidade)', () => {
  const s = sandbox();
  s.acRender(input('zzzzqq')); assert.match(s.boxes['q-ac'].innerHTML, /Nada encontrado para "zzzzqq"/);
  const curto = input('c'); s.acRender(curto); assert.equal(s.boxes['q-ac'].hidden, true); assert.equal(curto.attrs['aria-expanded'], 'false');
  const ok = input('charizard'); s.acRender(ok); const h = s.boxes['q-ac'].innerHTML;
  assert.equal(ok.attrs['aria-expanded'], 'true'); assert.match(h, /role="option"/); assert.match(h, /href="\/produto\/caos-ascendente-blister-quadruplo-charizard"/);
  assert.match(text(h), /R\$ 45,00/, 'autocomplete mostra o menor preço com estoque');
  s.acRender(input('caos')); assert.match(text(s.boxes['q-ac'].innerHTML), /Elite Trainer Box.*sem estoque/, 'produto sem oferta com estoque diz "sem estoque"');
});

// ------------------------------------------------------------------ card × detalhe: mesmo produto, variante, idioma, preço
t('card e detalhe mostram o mesmo produto, variante e preço', () => {
  const s = sandbox();
  for (const pid of ['p-a', 'p-b']) {
    const p = s.ctx.P[pid]; const best = s.bestOfferFor(pid); const c = cardOf(s, pid); const d = detail(s, pid);
    const name = `Blister Quádruplo ${p.variant}`;
    assert.match(text(c), new RegExp(name)); assert.match(text(d), new RegExp(name + ' · 4 boosters'));
    assert.match(c, new RegExp(`data-price="${best.id}">R\\$\\s${best.total.toFixed(2).replace('.', ',')}`), 'preço do card');
    assert.match(d, new RegExp(`class="big" data-price="${best.id}">R\\$\\s${best.total.toFixed(2).replace('.', ',')}`), 'preço do detalhe = preço do card');
    assert.match(c, new RegExp(`href="/produto/${s.ctx.SLUG[pid]}"`), 'card leva ao detalhe do mesmo produto');
    assert.match(text(d), /Idioma Português \(Copag\)/, 'idioma no detalhe');
    const other = pid === 'p-a' ? 'Pikachu' : 'Charizard'; assert.ok(!text(c + d).includes(other), 'não mistura variantes');
  }
  assert.match(detail(s, 'p-a'), /data-price="o2"/, 'melhor oferta é a mais barata COM estoque (o3 stale não vale)');
  assert.match(s.ctx.document.title, /Charizard.*a partir de R\$\s45,00/);
});

// ------------------------------------------------------------------ ofertas por loja, links, frete e preço desconhecidos
t('ofertas por loja: links seguros, stale separado e contagem', () => {
  const s = sandbox(); const d = detail(s, 'p-a');
  assert.match(text(d), /2 com estoque/);
  for (const id of ['o1', 'o2']) assert.match(d, new RegExp(`href="https://loja.example/${id}" target="_blank" rel="noopener" data-store="${id}"`));
  const [on, more] = d.split('class="more so-more"'); assert.ok(more && !/data-store="o3"/.test(on) && /data-store="o3"/.test(more), 'oferta velha fica em "Outras ofertas"');
  assert.match(more, /Leitura antiga/); assert.match(more, /class="so dim"/);
  const bad = s.storeOffer({ ...O1, id: 'ox', url: 'javascript:alert(1)' }, PA); assert.ok(!/javascript:/.test(bad)); assert.match(bad, /href="#"/);
  assert.match(s.storeOffer({ ...O1, storeName: 'A<b>', seller: 'A<b>' }, PA), /A&lt;b&gt;/, 'nome da loja escapado');
});
t('frete e preço desconhecidos ficam explícitos', () => {
  const s = sandbox(); const d = text(detail(s, 'p-a'));
  assert.match(d, /Preço antes do frete/, 'frete desconhecido no detalhe');
  assert.match(d, /Produto R\$ 37,00 \+ frete R\$ 8,00/, 'frete conhecido soma ao produto');
  assert.match(d, /Sem frete informado, o valor é o preço antes do frete/);
  assert.match(text(cardOf(s, 'p-b')), /Preço antes do frete/, 'card da busca também avisa frete desconhecido');
  assert.ok(!/Preço antes do frete/.test(text(cardOf(s, 'p-a'))), 'frete conhecido não leva o aviso');
  assert.equal(s.ctx.shipNote({ shippingKnown: true, shipping: 0, price: 10 }), 'Frete grátis');
  const semPreco = s.storeOffer({ ...O1, id: 'on', total: null, price: null }, PA);
  assert.match(semPreco, /class="so-price">-</, 'preço desconhecido aparece como "-" e não como R$ 0,00'); assert.match(semPreco, /class="so dim"/, 'e não conta como oferta com estoque');
});

// ------------------------------------------------------------------ estados do detalhe: sem estoque, stale, inexistente
t('detalhe sem estoque, só com oferta velha e produto inexistente', () => {
  const s = sandbox(); const d = detail(s, 'p-c');
  assert.match(text(d), /Sem estoque confirmado agora/); assert.match(text(d), /Nenhuma loja com estoque confirmado agora/); assert.ok(!/class="big"/.test(d), 'sem preço "melhor" inventado');
  assert.ok(!/a partir de/.test(s.ctx.document.title));
  s.ctx.OFF = [O3]; const velho = detail(s, 'p-a'); assert.ok(!/class="big"/.test(velho), 'só oferta stale: sem melhor preço'); assert.match(velho, /Leitura antiga/);
  const nf = detail(s, 'zzz'); assert.match(text(nf), /Produto não encontrado/); assert.match(nf, /role="search"/, 'oferece nova busca');
});

// ------------------------------------------------------------------ acessibilidade básica e layout responsivo (estático)
t('acessibilidade dos controles do card e do detalhe', () => {
  const s = sandbox(); const c = cardOf(s, 'p-a'); const d = detail(s, 'p-a');
  assert.match(c, /class="deal-hit" href="[^"]+" data-p="p-a" aria-label="Caos Ascendente Blister Quádruplo Charizard"/, 'link do card com nome acessível');
  assert.match(c, /class="deal-fav"[^>]*aria-pressed="false"[^>]*aria-label="Favoritar"/);
  assert.match(d, /<nav class="crumbs" aria-label="Caminho">/); assert.match(d, /<label class="osort"><span class="sr">Ordenar ofertas<\/span><select id="osort">/, 'ordenação com rótulo');
  assert.match(d, /aria-label="Opportunity Score 82 de 100/, 'nota da oferta com texto acessível'); assert.match(d, /Sem nota/, 'oferta sem avaliação diz "Sem nota"');
});
t('layout responsivo: viewport e media queries presentes', () => {
  assert.match(html, /<meta name="viewport"[^>]*width=device-width/);
  assert.match(html, /@media ?\(max-width:\s*\d+px\)/);
  assert.match(html, /\.deals\{[^}]*grid/); assert.match(html, /\.pp\{[^}]*(grid|flex)/);
});
console.log(`✓ Busca e produto (issue #43): ${n} grupos de testes passaram`);
