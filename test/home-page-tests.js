// Fase 6B.2 — Home: pódio, sequência e destaques pelo Opportunity Engine (GET /api/v1/oportunidades), sem Deal Score,
// sem oppPool e sem conta de oportunidade no navegador. Roda o código real da página (trechos de index.html) num sandbox.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const fullHtml = html; // a página inteira (dentro de alguns testes, html é o trecho renderizado)
const cut = (a, b) => { const i = html.indexOf(a); const j = html.indexOf(b, i); assert.ok(i > 0 && j > i, `trecho ${a}`); return html.slice(i, j); };
const hlCode = cut('/* Destaques (6B.2)', 'function preHTML(){');
const homeCode = cut('/* Home (6B.2): pódio, sequência e destaques', 'let stageIO=null;');
const renderDealsCode = cut('function renderDeals(){', '/* Produtos: todos os produtos com oferta');
const oppCode = cut('/* Categorias do site', '/* Pré-vendas: status sempre visível */');
const dropsCode = cut('function dropsHTML(){', 'function highlightsOppHTML(){');
let n = 0; const t = (name, fn) => { fn(); n++; };

// ------------------------------------------------------------------ fixtures no formato real da API
const mk = (id, score, band, x = {}) => ({
  product: { id, slug: id, name: `Produto ${id}`, type: 'blister_4', type_label: 'Blister Quádruplo', group: 'Blisters', image: null, collection: { code: 'me04', name: 'Caos Ascendente' } },
  offer: { id: 'o-' + id, title: 't', url: 'https://loja/x', image: null, first_seen_at: '2026-10-08T10:00:00Z' },
  price: 39.9, total: null, shipping: 'unknown', stock: 'in_stock', store: { id: 'mercadolivre', name: 'Mercado Livre' }, marketplace: 'mercadolivre',
  opportunity_score: score, opportunity_band: band, confidence: 0.51, confidence_level: 'média',
  current_reference: { kind: 'COPAG_OFFICIAL_CURRENT', label: 'Preço sugerido Copag', price: 55.99, source: 'Copag', confidence: 0.95 },
  market_composition: 'MARKETPLACE_ONLY',     // topo ≠ referência usada: não pode gerar aviso de marketplace
  reference_comparison: { available: true, reference_kind: 'COPAG_OFFICIAL_CURRENT', reference_label: 'Preço sugerido Copag', reference_value: 55.99, percentage_below: 28.74, amount_below: 16.09, position: 'below' },
  historical_context: [], community_reference: null, warnings: [], reasons: [], engine_version: 'opportunity-v2.2', updated_at: '2026-10-09T00:00:00Z', ...x,
});
const market = (id, score) => mk(id, score, 'boa', { price: 1250, confidence: 0.41, confidence_level: 'baixa',
  current_reference: { kind: 'MARKET_CURRENT', label: 'Referência de mercado', price: 1844.95, source: 'market', market_sources: 4, market_composition: 'MARKETPLACE_ONLY' },
  reference_comparison: { available: true, reference_kind: 'MARKET_CURRENT', reference_label: 'Referência de mercado', reference_value: 1844.95, percentage_below: 32.25, amount_below: 594.95, position: 'below' },
  warnings: [{ code: 'MARKETPLACE_ONLY', text: 'Referência de mercado formada exclusivamente por vendedores de marketplace (4 fontes)' }, { code: 'MARKET_HIGHLY_DEVIATED_FROM_HISTORY', text: '... muito acima do histórico ...' }] });
const noRef = (id, score) => mk(id, score, 'baixa', { confidence: null, confidence_level: null, market_composition: 'NONE',
  current_reference: { kind: 'NONE', label: null, price: null }, reference_comparison: { available: false, reference_kind: 'NONE', reference_value: null, percentage_below: null, amount_below: null, position: null, reason: 'no_current_reference' } });
const TOP = [mk('a', 90, 'excelente'), mk('b', 79, 'boa', { confidence: 0.8, confidence_level: 'alta' }), noRef('c', 61), market('d', 75), mk('e', 55, 'normal'), ...Array.from({ length: 10 }, (_, i) => mk('z' + i, 50 - i, 'normal'))];
const page = (items, meta = {}) => ({ data: items, meta: { page: 1, limit: 15, total: items.length, pages: 1, engine: 'opportunity-v2.2', ...meta } });

function sandbox(responder) {
  const calls = []; const slots = { '#home-pod': { innerHTML: '' }, '#home-rail': { innerHTML: '' }, '#home-hl': { innerHTML: '' } };
  const ctx = {
    console, URLSearchParams, Math, String, Number, Array, JSON, Object, Promise, Date, setTimeout,
    store: { get: (k, d) => d, set() {} }, S: { collections: [], reputation: { lojas: {} } }, SLUG: {}, APITTL: 60e3, OFF: [], P: {},
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    money: (v) => (v == null ? '-' : 'R$ ' + Number(v).toFixed(2).replace('.', ',')), ic: (id) => `<i data-ic="${id}"></i>`,
    photo: () => '<div class="photo"></div>', catOf: () => 'blister', g: () => ({ c: '#000' }), catChip: () => '', isFav: () => false, raBadge: () => '',
    safeUrl: (u) => u, pixTag: (o) => (o?.priceKind === 'pix' ? '<em class="pixk">no Pix</em>' : ''), ago: () => 'há 1 h', live: () => true, label: (p) => p.type, storeTxt: (o) => o.storeName,
    sectionHead: (i, title) => `<h2>${title}</h2>`, seeAll: (go, l = 'Ver todas') => `<a data-go="${go}">${l}</a>`,
    stageInit() {}, revealInit() {}, document: { addEventListener() {}, querySelectorAll: () => [] },
    view: 'deals', $: (sel) => slots[sel] || null,
    apiGet: async (path) => { calls.push(path); return responder(path); },
  };
  vm.createContext(ctx);
  vm.runInContext(oppCode + hlCode + homeCode + '\n;globalThis.__t={HOMEOPP,loadHomeOpp,podiumOppHTML,railOppHTML,highlightsOppHTML,paintHomeOpp,podCardOpp};', ctx);
  return { ...ctx.__t, calls, slots, ctx };
}
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const api = (path) => path.includes('ordem=score') ? page(TOP) : path.includes('ordem=abaixo') ? page([market('d', 75)]) : page([market('d', 75)]);

// 1. a Home recebe as oportunidades da API (uma chamada para pódio+sequência, duas de 1 item para os destaques)
const s = sandbox(api); assert.match(s.podiumOppHTML(), /pod-skel/, '12. carregando: esqueleto do pódio');
await s.loadHomeOpp(); s.paintHomeOpp();
assert.deepEqual(s.calls, ['oportunidades?limite=15&pagina=1&ordem=score', 'oportunidades?limite=1&pagina=1&ordem=abaixo', 'oportunidades?limite=1&pagina=1&ordem=economia']); n++;
// 2. pódio = as 3 primeiras na ordem da API, com o Opportunity Score de cada uma
t('2. pódio usa a ordem e o Opportunity Score da API', () => {
  const pod = s.slots['#home-pod'].innerHTML; const cards = pod.split('<article class="pod"').slice(1);
  assert.equal(cards.length, 3); assert.match(cards[0], /data-p="a"/); assert.match(cards[1], /data-p="b"/); assert.match(cards[2], /data-p="c"/);
  assert.match(cards[0], /--v:90/); assert.match(cards[0], /Opportunity Score 90\/100: Excelente oportunidade/); assert.match(cards[1], /<span>79<\/span>/);
});
// 6–10. referência, comparação, score, faixa e confiança exatamente como a API mandou
t('6–10. referência, comparação, score, faixa e confiança da API', () => {
  const pod = text(s.slots['#home-pod'].innerHTML);
  assert.match(pod, /R\$ 39,90 Copag · R\$ 55,99 −28,7% abaixo do preço sugerido/, '6C.1: preço antes do desconto');
  assert.match(pod, /Alta confiança/); assert.match(pod, /Média confiança/);
  assert.match(pod, /Sem referência atual/, 'sem referência: nada de percentual'); assert.ok(!/0,0%/.test(pod));
  const third = s.slots['#home-pod'].innerHTML.split('<article class="pod"')[3]; assert.ok(!/pod-off/.test(third), 'sem referência não mostra "abaixo"');
  assert.ok(!/marketplaces/.test(pod), 'Copag como referência: composição do topo não gera aviso');
  // mercado só de marketplace (pela referência atual) no pódio
  assert.match(text(s.podCardOpp(market('d', 75), 1)), /Mercado \(marketplaces\) · R\$ 1844,95/);
  assert.match(text(s.podCardOpp(mk('p', 80, 'boa', { offer: { id: 'op', url: 'u', price_kind: 'pix' } }), 1)), /R\$ 39,90 no Pix/, 'selo Pix vem de offer.price_kind');
  const rail = text(s.slots['#home-rail'].innerHTML);
  assert.match(rail, /#4 Boa .* Opportunity Score 75 · Boa/); assert.match(rail, /Referência formada por marketplaces/);
  assert.ok(!/Mercado acima do histórico/.test(rail), 'sequência não vira painel de avisos (só a etiqueta de marketplace)');
  assert.ok(!/Por que esta nota/.test(rail), 'detalhe fica na /oportunidades e no produto');
  assert.equal((s.slots['#home-rail'].innerHTML.match(/<article class="deal opp-card/g) || []).length, 12, 'sequência = posições 4 a 15 da API');
});
t('destaques: recordes vêm prontos da API', () => {
  const hl = text(s.slots['#home-hl'].innerHTML);
  assert.match(hl, /Melhor oportunidade 90 \/100 Opportunity Score/); assert.match(hl, /Mais abaixo da referência 32,3% abaixo da referência de mercado/);
  assert.match(hl, /Maior economia R\$ 594,95 abaixo da referência de mercado/); assert.ok(!/Deal Score|Maior desconto|desconto/i.test(hl));
});
// 11–14. sem banco, erro e vazio
{ const x = sandbox(() => ({ data: [], meta: { status: 'requires_db', total: 0 } })); await x.loadHomeOpp(); x.paintHomeOpp();
  assert.match(x.slots['#home-pod'].innerHTML, /indisponíveis/); assert.equal(x.slots['#home-rail'].innerHTML, ''); assert.equal(x.slots['#home-hl'].innerHTML, ''); n++; }
{ const x = sandbox(() => null); await x.loadHomeOpp(); x.paintHomeOpp(); assert.match(x.slots['#home-pod'].innerHTML, /Não conseguimos carregar.*data-homeretry/s); n++; }
{ const x = sandbox(() => page([])); await x.loadHomeOpp(); x.paintHomeOpp(); assert.match(x.slots['#home-pod'].innerHTML, /Nenhuma oportunidade avaliada agora/); assert.equal(x.slots['#home-rail'].innerHTML, ''); n++; }
// 3–5. sem Deal Score, sem oppPool e sem state.json para oportunidades
t('3–5. Home sem Deal Score, sem oppPool e sem state.json para oportunidades', () => {
  for (const code of [homeCode, hlCode, renderDealsCode, dropsCode]) {
    assert.ok(!/dealScore|Deal Score|legacyDealScore|scoreColor|discOf|oppPool/.test(code), 'sem score legado');
    assert.ok(!/state\.json|fetchState|ensureFull/.test(code), 'sem state.json');
    assert.ok(!/\.sort\(|percentage_below\s*[*/+-]|opportunity_score\s*[*/+-]|reference_value\s*[-*/]/.test(code.replace(/dropsHTML[\s\S]*$/, '')), 'sem ordenação ou conta de oportunidade');
  }
  assert.ok(!/function oppPool/.test(html), 'oppPool legado removido');
  assert.match(renderDealsCode, /podiumOppHTML\(\)/); assert.match(renderDealsCode, /loadHomeOpp\(\)/);
});
// a página inteira continua com JavaScript válido (o pódio é montado por template literals)
// 6C.1 — destaques FOIL → ULTRA RARA → RARA; escala global oculta no pódio e independente da posição
t('6C.1. pódio: FOIL, ULTRA RARA e RARA sem medalhas; nota e escala intactas', () => {
  const html = s.slots['#home-pod'].innerHTML; const cards = html.split('<article class="pod"').slice(1);
  assert.ok(!/OURO|PRATA|BRONZE|--medal/.test(html + homeCode), 'sem ouro, prata nem bronze');
  // brilho que passa pelo cartão: voltou a pedido (visual anterior), um por card, só sem movimento reduzido
  assert.equal((html.match(/class="pod-sheen" aria-hidden="true"/g) || []).length, 3, 'brilho decorativo nos três cards');
  assert.match(fullHtml, /@media \(prefers-reduced-motion:no-preference\)\{\.pod \.pod-sheen\{animation:sheen/, 'brilho só anima sem movimento reduzido');
  assert.deepEqual(cards.map((c) => c.match(/data-hl="(\w+)"/)[1]), ['foil', 'ultra', 'rara']);
  assert.deepEqual(cards.map((c) => text(c.match(/class="pod-rank">([\s\S]*?)<\/span>/)[1])), ['FOIL', 'ULTRA RARA', 'RARA']);
  // escala global pela nota (90 → sr, 79 → r, 61 → u), não pela posição; não aparece como texto no pódio
  assert.deepEqual(cards.map((c) => c.match(/data-rar="(\w+)"/)[1]), ['sr', 'r', 'u']);
  assert.ok(!/rar-line|Secret Rare|Uncommon/.test(html), 'escala global oculta nos três cards do pódio');
  const low = s.podCardOpp(mk('q', 72, 'normal'), 1); assert.match(low, /data-hl="foil"/); assert.match(low, /data-rar="r"/, '1º lugar com nota 72 continua Rare');
  // confiança só muda a intensidade
  assert.match(cards[0], /--int:0\.65/); assert.match(cards[1], /--int:1/); assert.match(cards[2], /--int:1/, 'sem confiança: tratamento padrão');
  assert.ok(!/foilSpin/.test(html), 'sem animação contínua');
  // sequência: escala global visível e sem foil por faixa
  const rail = s.slots['#home-rail'].innerHTML; assert.ok(!/class="deal opp-card foil/.test(rail)); assert.match(text(rail), /Ultra Rare|Rare|Uncommon|Common/);
});
// Lote 3 — radar do topo: com oportunidades pausadas (stale/nodb), oferta nova não aparece como "Nova oportunidade"
t('Lote 3. ticker: "Nova oportunidade" só com oportunidades disponíveis; pausadas → "Novo preço"', () => {
  const labelCode = cut('/* Início: painel editorial de oportunidades', 'const hhmm=');
  const tickCode = cut('function tickerHTML(){', 'let tickT=0;');
  const actItemCode = cut('function actItem(e){', 'function tipItem(t){');
  const ctx = { HOMEOPP: { status: 'idle' }, P: { p1: { id: 'p1', collectionName: 'Caos Ascendente', type: 'combo' } }, SLUG: { p1: 'p1' },
    activity: () => [{ type: 'new', productId: 'p1', t: '2026-10-09T18:30:00Z', to: 239, offerId: 'o1' }, { type: 'drop', productId: 'p1', t: '2026-10-09T18:15:00Z', from: 250, to: 239, offerId: 'o2' }],
    dedupeAct: (l) => l, hhmm: () => '15:30', dayLabel: () => '15:30', pct: () => '', pixOf: () => '', label: () => 'Combo de Booster',
    esc: (x) => String(x ?? ''), money: (v) => 'R$ ' + Number(v).toFixed(2).replace('.', ','), ic: (id) => `<i data-ic="${id}"></i>` };
  vm.createContext(ctx);
  vm.runInContext(labelCode + tickCode + actItemCode + ';globalThis.__k={tickerHTML,actItem,actLabel};', ctx);
  const k = ctx.__k; const nova = /Nova oportunidade/;
  for (const st of ['ok', 'idle', 'error']) { ctx.HOMEOPP.status = st; assert.match(k.tickerHTML(), nova, st); }
  for (const st of ['stale', 'nodb']) {
    ctx.HOMEOPP.status = st; const h = k.tickerHTML();
    assert.doesNotMatch(h, nova, st); assert.match(text(h), /15:30 Novo preço Caos Ascendente · Combo de Booster R\$ 239,00/, st);
    assert.match(h, /Queda de preço/, 'outros tipos seguem iguais');
    assert.doesNotMatch(k.actItem(ctx.activity()[0]), nova, 'lista de novidades segue o mesmo rótulo');
  }
  // a Home repinta o radar quando o status pausado chega depois da primeira pintura
  assert.match(homeCode, /const tk=\$\("\.stage \.ticker"\);if\(tk&&oppPaused\(\)\)\{tk\.outerHTML=tickerHTML\(\);startTicker\(\)\}/);
});
t('script da página compila', () => {
  const scripts = [...html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  for (const sc of scripts) { if (sc.trim().startsWith('{')) continue; assert.doesNotThrow(() => new vm.Script(sc), 'erro de sintaxe no index.html'); }
});
console.log(`✓ Home (6B.2): ${n} grupos de testes passaram`);
