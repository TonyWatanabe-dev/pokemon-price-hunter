// UX de confiança, comparação e conversão (relatório de UX, itens A–E + estados). Roda o código real da página
// (trechos de index.html) em sandbox, como os outros testes de página. Contratos da API usados como estão.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const pagina = fs.readFileSync(new URL('../api/pagina.mjs', import.meta.url), 'utf8');
const cut = (a, b) => { const i = html.indexOf(a); const j = html.indexOf(b, i); assert.ok(i > 0 && j > i, `trecho ${a}`); return html.slice(i, j); };
const oppCode = cut('/* Categorias do site', '/* Pré-vendas: status sempre visível */');
const homeCode = cut('/* Home (6B.2): pódio, sequência e destaques', 'let stageIO=null;');
const hlCode = cut('/* Destaques (6B.2)', 'function preHTML(){');
const freshCode = cut('const FRESH_LIM=', 'setInterval(fresh,30e3);');
const apiCode = cut('const APIC=new Map();', 'const PAGE_DONE=');
const clickCode = cut('/* UX-E: clique em "Ver oferta"', 'function track(name,data){');
let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const NOW = Date.now(); const minAgo = (m) => new Date(NOW - m * 6e4).toISOString();

// ------------------------------------------------------------------ fixture no formato real de GET /api/v1/oportunidades
const item = (x = {}) => ({
  product: { id: 'me04-etb', slug: 'caos-ascendente-etb', name: 'Caos Ascendente ETB', type: 'etb', type_label: 'Treinador Avançado (ETB)', group: 'ETB', image: null, collection: { code: 'me04', name: 'Caos Ascendente' } },
  offer: { id: 'of-1', title: 't', url: 'https://loja.example/etb', image: null, first_seen_at: minAgo(600), price_kind: 'pix' },
  price: 322.9, total: null, shipping: 'unknown', stock: 'in_stock', store: { id: 'loja-x', name: 'Loja X' }, marketplace: null,
  opportunity_score: 86, opportunity_band: 'excelente', confidence: 0.77, confidence_level: 'alta',
  current_reference: { kind: 'COPAG_OFFICIAL_CURRENT', label: 'Preço sugerido Copag', price: 399.99, confidence: 0.95 }, market_composition: 'NONE',
  reference_comparison: { available: true, reference_kind: 'COPAG_OFFICIAL_CURRENT', reference_label: 'Preço sugerido Copag', reference_value: 399.99, percentage_below: 19.27, amount_below: 77.09, position: 'below' },
  product_variation_7d: null, historical_context: [], community_reference: null, warnings: [], reasons: [],
  engine_version: 'opportunity-v2.2', updated_at: minAgo(10), ...x,
});
const page = (items, meta = {}) => ({ data: items, meta: { page: 1, limit: 24, total: items.length, pages: 1, engine: 'opportunity-v2.2', freshness: { status: 'atual', source: 'db', dataAt: minAgo(12), ageMin: 12 }, ...meta } });
const STALE = { data: [], meta: { page: 1, limit: 24, total: 0, pages: 1, status: 'stale_db', message: 'O banco não recebe preços novos há 130 min: as oportunidades ficam pausadas até a próxima sincronização.',
  freshness: { status: 'desatualizado', source: 'db', dataAt: '2026-10-09T14:05:00.000Z', ageMin: 130 } } };

function sandbox(api, extra = {}) {
  const calls = []; const slots = { '#pp-opp': { innerHTML: '' }, '#view': { innerHTML: '' }, '#home-pod': { innerHTML: '' }, '#home-rail': { innerHTML: '' }, '#home-hl': { innerHTML: '' } };
  const ctx = {
    console, URLSearchParams, Math, String, Number, Array, JSON, Object, Promise, Date, setTimeout,
    store: { get: (k, d) => d, set() {} }, S: { collections: [], reputation: { lojas: {} } }, SLUG: { 'me04-etb': 'caos-ascendente-etb' }, P: {}, OFF: [], APIC: new Map(), APITTL: 60e3, API_LAST: new Map(),
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    money: (v) => (v == null ? '-' : 'R$ ' + Number(v).toFixed(2).replace('.', ',')), ic: (id) => `<i data-ic="${id}"></i>`,
    photo: () => '<div class="photo"></div>', catOf: () => 'etb', g: () => ({ c: '#000' }), catChip: () => '', isFav: () => false, raBadge: () => '',
    safeUrl: (u) => u, pixTag: (o) => (o?.priceKind === 'pix' ? '<em class="pixk">no Pix</em>' : ''), ago: () => 'há 1 h', live: () => true, label: (p) => p.type, storeTxt: (o) => o.storeName,
    freshAt: (iso) => new Date(iso).toISOString().slice(11, 16), sectionHead: (i, title) => `<h2>${title}</h2>`, seeAll: () => '', stageInit() {}, revealInit: undefined,
    document: { addEventListener() {}, querySelectorAll: () => [] }, view: 'oportunidades', $: (sel) => slots[sel] || null, IntersectionObserver: undefined,
    apiGet: (path) => { calls.push(path); return Promise.resolve(typeof api === 'function' ? api(path) : api); }, ...extra,
  };
  vm.createContext(ctx);
  vm.runInContext(oppCode + hlCode + homeCode + `\n;globalThis.__t={ppOppHTML,loadPpOpp,ppOppKey,oppCard,podCardOpp,renderOpp,loadHomeOpp,podiumOppHTML,paintHomeOpp,oppQuery,prefetchOpp,oppTick,revive,markOld,ageLine,oppTotal,oppShip,cmpLink,
    get OPP(){return OPP},get OF(){return OF},get HOMEOPP(){return HOMEOPP},get OPP_PAUSE(){return OPP_PAUSE}};`, ctx);
  return { t: ctx.__t, calls, slots, ctx };
}

// ================================================================== B — frescor honesto
await t('B1. nenhuma tela diz "tempo real" (página, prévia do servidor)', () => {
  assert.ok(!/tempo real/i.test(html), 'index.html sem "tempo real"'); assert.ok(!/tempo real/i.test(pagina), 'api/pagina.mjs sem "tempo real"');
  assert.match(html, /<span id="live-t">\$\{freshTxt\(freshState\(S\)\)\[0\]\}<\/span>/, 'topo da Home usa o mesmo frescor da barra');
});
function siteFresh(S, pause = null, now = NOW) {
  const el = { className: '', dataset: {} }; const body = { dataset: {} };
  const slots = { '#fresh': el, '#mini-t': { innerHTML: '' }, '#fresh-t': { innerHTML: '' }, '#live-t': { innerHTML: '' }, body };
  const ctx = { S, OPP_PAUSE: pause, $: (s) => slots[s], Date: class extends Date { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } }, Math, Number };
  vm.runInNewContext(freshCode + '\nfresh();', ctx);
  return { mini: slots['#mini-t'].innerHTML, full: slots['#fresh-t'].innerHTML, live: slots['#live-t'].innerHTML, body: body.dataset.fresh };
}
await t('B2. barra, mini e topo da Home com a idade real; preços em dia + notas pausadas aparecem juntos', () => {
  let s = siteFresh({ generatedAt: minAgo(12) });
  assert.match(s.full, /<b>Ao vivo<\/b> · preços atualizados há 12 min\./); assert.equal(s.live, s.mini); assert.match(s.live, /atualizado há 12 min/); assert.equal(s.body, 'atual');
  assert.doesNotMatch(s.full + s.mini, /pausad/);
  s = siteFresh({ generatedAt: minAgo(12) }, { why: 'x' });   // /home em dia (state.json) e /oportunidades em stale_db
  assert.match(s.mini, /notas pausadas/); assert.match(s.full, /As notas de oportunidade estão pausadas/); assert.match(s.live, /notas pausadas/);
  s = siteFresh({ generatedAt: minAgo(45) }, { why: 'x' }); assert.match(s.full, /Atualizado há 45 min.*notas de oportunidade estão pausadas/); assert.equal(s.body, 'atrasado');
  s = siteFresh({ generatedAt: minAgo(200) }, { why: 'x' }); assert.match(s.full, /Preços desatualizados/); assert.doesNotMatch(s.full, /Ao vivo/);
});
await t('B3. 503 da API é registrado (≠ falha de rede) e pedidos iguais em andamento são um só', async () => {
  let fetches = 0; let status = 503;
  const ctx = { Map, Date, Promise, setTimeout, clearTimeout, AbortController,
    fetch: async () => { fetches++; await new Promise((r) => setTimeout(r, 5)); return { status, ok: status < 400, json: async () => ({ data: [] }) }; } };
  vm.createContext(ctx); vm.runInContext(apiCode + ';globalThis.__a={apiGet,API_LAST,APIC};', ctx); const { apiGet, API_LAST, APIC } = ctx.__a;
  assert.equal(await apiGet('oportunidades?x=1'), null); assert.equal(API_LAST.get('oportunidades?x=1'), 503);
  status = 200; fetches = 0; const [a, b] = await Promise.all([apiGet('home2'), apiGet('home2')]);
  assert.equal(fetches, 1, 'um pedido só'); assert.deepEqual(a, b); assert.ok(APIC.has('home2'));
  status = 404; assert.deepEqual({ ...(await apiGet('produtos/zz')) }, { notFound: true });
});
await t('B4. boot: /oportunidades e as notas da Home são pedidos junto com o /home', () => {
  assert.match(html, /loading\(\);prefetchOpp\(\);\n\s*const st=API_VIEWS\.has\(view\)\?\(await fetchHome\(\)\)/);
  const s = sandbox(page([])); s.t.prefetchOpp(); assert.deepEqual(s.calls, [s.t.oppQuery(1)]);
  const h = sandbox(page([])); h.ctx.view = 'deals'; h.t.prefetchOpp(); assert.equal(h.calls[0], 'oportunidades?limite=15&pagina=1&ordem=score');
});

// ================================================================== A — preço com frete (known / free / unknown)
await t('A. cartão e pódio mostram o mesmo valor da página do produto (total), com o frete explícito', () => {
  const s = sandbox(page([]));
  const known = item({ price: 1250, total: 1300, shipping: 'known' }); const free = item({ price: 1250, total: 1250, shipping: 'free' }); const unk = item({ price: 1250, total: null, shipping: 'unknown' });
  for (const [x, v, note] of [[known, 'R$ 1300,00', /Produto R\$ 1250,00 \+ frete R\$ 50,00 · % sobre o produto/], [free, 'R$ 1250,00', /Frete grátis/], [unk, 'R$ 1250,00', /Preço antes do frete/]]) {
    const card = s.t.oppCard(x, 1); const pod = s.t.podCardOpp(x, 1);
    assert.ok(text(card).includes(v + ' no Pix'), `cartão ${x.shipping}: ${v}`); assert.match(text(card), note);
    assert.match(pod, new RegExp(`<strong data-price="of-1">${v.replace(/[$.]/g, '\\$&')}</strong>`)); assert.match(text(pod), note);
    assert.match(pod, new RegExp(`aria-label="1º lugar: [^"]*${v.replace(/[$.]/g, '\\$&')} em Loja X"`));
  }
  assert.equal(s.t.oppTotal(item({ price: 10, total: 12, shipping: 'unknown' })), 10, 'frete desconhecido: nunca soma');
  assert.equal(s.t.oppShip(item({ price: 10, total: 10, shipping: 'known' })), 'Frete grátis', 'known com frete 0 = frete grátis (igual à página do produto)');
});

// ================================================================== E — comparação e rastreio
await t('E1. "Comparar N ofertas com estoque" leva à seção Onde comprar (liveCount do resumo da API)', () => {
  const s = sandbox(page([])); s.ctx.P['me04-etb'] = { id: 'me04-etb', liveCount: 4 };
  const card = s.t.oppCard(item(), 0); const link = card.match(/<a class="opp-stores"[^>]*>.*?<\/a>/)[0];
  assert.match(link, /href="\/produto\/caos-ascendente-etb#ondecomprar"/); assert.match(link, /data-p="me04-etb" data-hash="ondecomprar"/); assert.match(text(link), /Comparar 4 ofertas com estoque/);
  assert.match(s.t.podCardOpp(item(), 1), /Comparar 4 ofertas com estoque/);
  s.ctx.P['me04-etb'].liveCount = 1; assert.doesNotMatch(s.t.oppCard(item(), 0), /opp-stores/, 'uma oferta só: nada a comparar');
  delete s.ctx.P['me04-etb']; assert.doesNotMatch(s.t.oppCard(item(), 0), /opp-stores/, 'sem resumo: sem atalho (nada estimado)');
  assert.match(html, /PENDING_HASH=pb\.dataset\.hash\|\|"";openProduct\(pb\.dataset\.p\)/); assert.match(html, /if\(pid in HIST\)drawHist\(pid\);else loadHist\(pid\);\n  hashScroll\(\);/);
  assert.match(html, /<section class="card wbuy" id="ondecomprar">/);
});
await t('E2. todo "Ver oferta" do motor gera click_store, mesmo fora do estado (OFF)', () => {
  const s = sandbox(page([])); const x = item({ price: 1250, total: 1300, shipping: 'known' });
  for (const h of [s.t.oppCard(x, 0), s.t.podCardOpp(x, 1), s.t.oppCard(x, 4, { rail: true })]) assert.match(h, /data-store="of-1" data-pid="me04-etb" data-sid="loja-x" data-price="1300"/);
  const run = (OFF, dataset) => { const c = { OFF }; vm.createContext(c); vm.runInContext(clickCode + ';globalThis.r=storeClick(' + JSON.stringify({ dataset }) + ');', c); return c.r; };
  assert.deepEqual({ ...run([], { store: 'of-1', pid: 'me04-etb', sid: 'loja-x', price: '1300' }) }, { store: 'loja-x', id: 'me04-etb', price: 1300, src: 'opp' });
  assert.deepEqual({ ...run([{ id: 'of-1', storeId: 's', productId: 'p', total: 9 }], { store: 'of-1' }) }, { store: 's', id: 'p', price: 9 }, 'oferta do estado: igual a antes');
  assert.match(html, /const stb=t\.closest\("\[data-store\]"\);if\(stb\)\{const d=storeClick\(stb\);if\(d\)track\("click_store",d\);return\}/);
});

// ================================================================== C — idade da nota, volta à aba, expiração após 90 min
await t('C1. cada cartão diz quando foi avaliado; acima de 90 min: "Nota de HH:MM" e "Conferir na loja"', () => {
  const s = sandbox(page([]));
  const fresh = s.t.oppCard(item({ updated_at: minAgo(10) }), 0); assert.match(text(fresh), /Avaliado há 10 min/); assert.match(fresh, /<span class="cta-l">Ver oferta<\/span>/); assert.doesNotMatch(fresh, /data-old/);
  const old = s.t.oppCard(item({ updated_at: minAgo(120) }), 0); assert.match(old, /data-old/); assert.match(text(old), /Nota de \d\d:\d\d: pode ter mudado/); assert.match(old, /<span class="cta-l">Conferir na loja<\/span>/);
  const pod = s.t.podCardOpp(item({ updated_at: minAgo(120) }), 1); assert.match(pod, /class="pod" data-old/); assert.match(pod, /Conferir na loja/);
  assert.equal(s.t.ageLine(minAgo(90), NOW).old, false); assert.equal(s.t.ageLine(minAgo(91), NOW).old, true); assert.equal(s.t.ageLine(null), null);
});
await t('C2. na tela parada, o tick de 30 s envelhece os cartões sem redesenhar', () => {
  const s = sandbox(page([])); const at = minAgo(80);
  const attrs = new Set(); const span = { textContent: '' }; const age = { classList: { toggle() {} } }; const cta = { textContent: 'Ver oferta' };
  const card = { dataset: { at }, toggleAttribute: (k, on) => (on ? attrs.add(k) : attrs.delete(k)), querySelector: (q) => ({ '.opp-age span': span, '.opp-age': age, '.cta-l': cta }[q]) };
  const root = { querySelectorAll: () => [card] };
  s.t.markOld(root, NOW); assert.ok(!attrs.has('data-old')); assert.equal(span.textContent, 'Avaliado há 1 h');
  s.t.markOld(root, NOW + 20 * 6e4); assert.ok(attrs.has('data-old')); assert.match(span.textContent, /^Nota de/); assert.equal(cta.textContent, 'Conferir na loja');
  assert.match(html, /setInterval\(\(\)=>oppTick\(\),30e3\);/); assert.match(html, /function oppTick\(now=Date\.now\(\)\)\{\n  markOld\(document,now\);/);
});
await t('C3. ao voltar para a aba, notas com mais de 30 min são buscadas de novo', async () => {
  assert.match(html, /document\.addEventListener\("visibilitychange",\(\)=>\{if\(document\.visibilityState==="visible"\)revive\(\)\}\);/);
  const s = sandbox(() => page([item()])); await s.t.renderOpp(); const before = s.calls.length;
  s.t.revive(Date.now() + 10 * 6e4); assert.equal(s.calls.length, before, 'resposta com 10 min: não busca');
  s.t.revive(Date.now() + 31 * 6e4); await new Promise((r) => setTimeout(r, 0)); assert.equal(s.calls.length, before + 1, 'resposta com 31 min: busca de novo');
});

// ================================================================== pausa (stale_db / 503) e troca de filtro
await t('P1. /oportunidades pausada: motivo e horário da API, nova tentativa e caminho para /produtos', async () => {
  const s = sandbox(STALE); await s.t.renderOpp(); const h = s.slots['#view'].innerHTML;
  assert.match(h, /<h3>Oportunidades pausadas<\/h3>/); assert.match(text(h), /há 130 min: as oportunidades ficam pausadas/); assert.match(text(h), /Últimos preços recebidos em 14:05/);
  assert.match(h, /<button[^>]*data-oppretry>/); assert.match(h, /href="\/produtos" data-go="produtos"/); assert.equal(s.t.OPP_PAUSE.ageMin, 130);
  assert.doesNotMatch(h, /opp-card|class="meter"/, 'nenhuma nota antiga');
  // 503 (dados sem horário confiável): pausa, não "Pode ser a conexão"
  const s2 = sandbox(null); s2.ctx.API_LAST.set(s2.t.oppQuery(1), 503); await s2.t.renderOpp(); const h2 = s2.slots['#view'].innerHTML;
  assert.match(h2, /Oportunidades pausadas/); assert.doesNotMatch(h2, /conexão/); assert.match(text(h2), /sem atualização confiável/);
  // falha de rede continua sendo erro com nova tentativa
  const s3 = sandbox(null); await s3.t.renderOpp(); assert.match(s3.slots['#view'].innerHTML, /Não conseguimos carregar as oportunidades agora/);
});
await t('P2. pausa: nova tentativa sozinha a cada 5 min; volta ao normal limpa a pausa', async () => {
  let r = STALE; const s = sandbox(() => r); await s.t.renderOpp(); const c0 = s.calls.length;
  s.t.oppTick(Date.now() + 4 * 6e4); assert.equal(s.calls.length, c0, 'antes de 5 min: espera');
  r = page([item()]); s.t.oppTick(Date.now() + 5 * 6e4); await new Promise((q) => setTimeout(q, 0));
  assert.equal(s.calls.length, c0 + 1); assert.equal(s.t.OPP.status, 'ok'); assert.equal(s.t.OPP_PAUSE, null); assert.match(s.slots['#view'].innerHTML, /Caos Ascendente/);
});
await t('P3. Home pausada: mesmo bloco (motivo, horário, tentar de novo, /produtos)', async () => {
  const s = sandbox(STALE); s.ctx.view = 'deals'; await s.t.loadHomeOpp(); const h = s.t.podiumOppHTML();
  assert.match(h, /<div class="stage-empty pause"><h3>Oportunidades pausadas<\/h3>/); assert.match(h, /data-homeretry/); assert.match(h, /href="\/produtos"/); assert.match(text(h), /Últimos preços recebidos em 14:05/);
});
await t('F. troca de filtro: a lista atual fica na tela (esmaecida) até a nova chegar', async () => {
  let release; const pending = new Promise((r) => { release = r; });
  const s = sandbox((p) => (p.includes('categoria=etb') ? pending : page([item(), item({ product: { ...item().product, id: 'b', name: 'B', type_label: 'Outro produto' }, offer: { ...item().offer, id: 'of-2' } })], { pages: 3 })));
  await s.t.renderOpp(); assert.match(s.slots['#view'].innerHTML, /Outro produto/);
  s.t.OF.cat = 'etb'; const pr = s.t.renderOpp(); const mid = s.slots['#view'].innerHTML;
  assert.match(mid, /class="opp-list is-loading" aria-busy="true"/); assert.match(mid, /Outro produto/, 'lista anterior visível'); assert.doesNotMatch(mid, /class="skel"/);
  assert.doesNotMatch(mid, /id="opp-more"/, 'sem "carregar mais" da lista antiga');
  release(page([item()])); await pr; const end = s.slots['#view'].innerHTML;
  assert.match(end, /class="opp-list" aria-busy="false"/); assert.doesNotMatch(end, /Outro produto/);
  const s2 = sandbox(() => pending); s2.t.renderOpp(); assert.match(s2.slots['#view'].innerHTML, /class="skel"/, 'sem lista anterior: esqueleto');
});

// ================================================================== D — coerência entre cartão e página do produto
await t('D1. página do produto destaca a mesma loja, valor, % e referência do cartão', () => {
  const s = sandbox(page([]));
  for (const x of [item({ price: 1250, total: 1300, shipping: 'known' }), item(), item({ shipping: 'free', total: 322.9 })]) {
    const card = s.t.oppCard(x, 0); const pp = s.t.ppOppHTML(x, 'of-1');
    const price = (h) => h.match(/R\$ [\d.,]+(?= no Pix)/)[0]; const cmp = (h) => text(h.match(/<p class="opp-cmp"[\s\S]*?<p class="opp-ref">[^<]*<\/p>/)[0]);
    assert.equal(price(text(pp)), price(text(card)), `valor (${x.shipping})`); assert.equal(cmp(pp), cmp(card), 'mesmo % e mesmo texto de referência');
    assert.match(cmp(pp), /−19,3% abaixo do preço sugerido Copag · R\$ 399,99/);
    assert.match(text(pp), new RegExp(s.t.oppShip(x).replace(/[$.+%]/g, '\\$&') + ' · Loja X')); assert.match(pp, /href="https:\/\/loja\.example\/etb"/); assert.match(pp, /data-pid="me04-etb"/);
  }
  assert.doesNotMatch(s.t.ppOppHTML(item(), 'of-1'), /outra oferta/); assert.match(text(s.t.ppOppHTML(item(), 'of-9')), /O menor preço com estoque é outra oferta/);
  assert.match(s.t.ppOppHTML(item({ updated_at: minAgo(120) }), 'of-1'), /data-old[\s\S]*Conferir na loja<\/span> na Loja X/);
  assert.match(html, /<aside class="pp-side">\n    <div id="pp-opp" class="pp-opp"><\/div>/); assert.match(html, /hashScroll\(\);loadPpOpp\(pid,best\?\.id\|\|null\);/);
});
await t('D2. a página do produto lê a mesma API do cartão; pausada ou sem nota, não mostra nada', async () => {
  const s = sandbox(page([item()])); s.ctx.view = 'produto'; s.ctx.curPid = 'me04-etb';
  await s.t.loadPpOpp('me04-etb', 'of-1'); assert.deepEqual(s.calls, ['oportunidades?produto=me04-etb&limite=1']); assert.match(s.slots['#pp-opp'].innerHTML, /Oportunidade do Hunter/);
  for (const r of [STALE, page([]), null, page([item({ product: { ...item().product, id: 'outro' } })])]) {
    const s2 = sandbox(r); s2.ctx.view = 'produto'; s2.ctx.curPid = 'me04-etb'; s2.slots['#pp-opp'].innerHTML = 'antigo';
    await s2.t.loadPpOpp('me04-etb', 'of-1'); assert.equal(s2.slots['#pp-opp'].innerHTML, '', 'nada de nota antiga ou de outro produto');
  }
  const s3 = sandbox(page([item()])); s3.ctx.view = 'produto'; s3.ctx.curPid = 'outro'; await s3.t.loadPpOpp('me04-etb', 'of-1'); assert.equal(s3.slots['#pp-opp'].innerHTML, '', 'usuário já mudou de produto');
});

console.log(`✓ UX de confiança (A, B, C, D, E, pausa, filtros): ${n} grupos de testes passaram`);
