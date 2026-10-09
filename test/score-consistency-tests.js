// Fase 6C.2 — Consolidação do Opportunity Engine: página do produto, listas, busca e textos usam só a nota oficial
// (o.opp, a mesma linha de hunter.opportunity de /oportunidades). Sem nota oficial: estado explícito, nada estimado,
// nunca o Deal Score antigo. Roda o código real da página (trechos de index.html) e do servidor num sandbox.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import * as SITE from '../api/_lib/site.mjs';
import { OFFER_FIELDS } from '../api/_lib/home.mjs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const cut = (a, b, src = html) => { const i = src.indexOf(a); const j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, `trecho ${a}`); return src.slice(i, j); };
let n = 0; const t = async (name, fn) => { await fn(); n++; };

const helpers = cut('const BAND_UI=', '/* 6C.1 TCG Rarity System');
const dialCode = cut('function dial(', 'function scoreBlock(');
const blockCode = cut('function scoreBlock(o){', '/* PriceDisplay:');
const meterCode = cut('function scoreMeter(x){', 'function dealCard(');
const chipCode = cut('/* selo da oferta na lista de lojas', 'function storeOffer(o,p){');
const sortsCode = cut('const OFFER_SORTS=', 'let offerSort=');
const listCode = cut('function entries(){', 'const REFNOTE=');
const whyCode = cut('const pctPts=', 'function oppCard(');
const popCode = cut('/* Por que esta nota? Explicação oficial', '/* PriceHistory:');

function page(extra = {}) {
  const ctx = { S: { source: 'db' }, esc: (s) => String(s ?? ''), ic: (k) => `<i:${k}>`, money: (v) => `R$ ${Number(v).toFixed(2)}`, ago: () => 'agora',
    live: (o) => o.stock === 'IN_STOCK' && !o.stale && !o.anomalous && o.total > 0, storeTxt: (o) => o.storeName, pixTxt: () => '', track() {}, innerWidth: 400, ...extra };
  vm.createContext(ctx);
  vm.runInContext(helpers + dialCode + blockCode + meterCode + chipCode + sortsCode + whyCode, ctx);
  return ctx;
}
const opp = (score, band, confidence, level) => ({ score, band, confidence, level });
const offer = (id, x = {}) => ({ id, productId: 'p1', storeId: 's', storeName: 'Loja ' + id, stock: 'IN_STOCK', total: 50, price: 50, ...x });

await t('nenhuma tela lê o Deal Score: sem dealScore/scoreParts na página nem no que a API envia ao navegador', () => {
  assert.doesNotMatch(html, /\bdealScore\b|\bscoreParts\b/, 'index.html');
  assert.doesNotMatch(html, /\bscoreColor\b|\bBANDS\b|\bCRIT\b|data-score=/, 'faixas e critérios antigos');
  assert.ok(!OFFER_FIELDS.includes('dealScore') && !OFFER_FIELDS.includes('scoreParts') && OFFER_FIELDS.includes('opp'));
  for (const f of ['api/_lib/site.mjs', 'api/_lib/home.mjs', 'api/_lib/read-db.mjs']) assert.doesNotMatch(fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8'), /\bdealScore\b|\bscoreParts\b/, f);
  assert.doesNotMatch(cut('function renderGuide(){', 'function renderLegal('), /Deal Score/, 'Como funciona');
});

await t('página do produto: nota oficial com faixa e confiança separadas; ação "Por que esta nota?"', () => {
  const c = page(); const h = c.scoreBlock(offer('a', { opp: opp(80, 'boa', 0.51, 'média') }));
  assert.match(h, /data-oscore="a"/); assert.match(h, /<b>80<\/b>/); assert.match(h, /Boa oportunidade/); assert.match(h, /Média confiança \(51%\)/);
  assert.match(h, /Opportunity Score/); assert.match(h, /Por que esta nota\?/); assert.doesNotMatch(h, /Deal Score/);
});
await t('sem nota oficial: estado explícito, sem número, mesmo que a oferta ainda traga um Deal Score antigo', () => {
  const c = page(); const legacy = offer('a', { dealScore: 82, scoreParts: { copag: 33 } });
  for (const h of [c.scoreBlock(legacy), c.scoreBlock(offer('b', { opp: null })), c.scoreBlock(offer('c', { opp: { score: null } }))]) {
    assert.match(h, /Sem nota oficial/); assert.match(h, /Nada é estimado/); assert.doesNotMatch(h, /82|data-oscore/);
  }
  assert.match(c.scoreChip(legacy), /Sem nota/); assert.doesNotMatch(c.scoreChip(legacy), /82/);
  assert.match(c.scoreMeter(null), /Sem nota oficial/); assert.doesNotMatch(c.scoreMeter(null), /\/100/);
  const st = page({ S: { source: 'state' } }); assert.match(st.scoreBlock(legacy), /notas oficiais estão indisponíveis/);
});
await t('selo da oferta e medidor do card mostram a nota oficial daquela oferta', () => {
  const c = page(); const o = offer('a', { opp: opp(91, 'excelente', 0.8, 'alta') });
  const chip = c.scoreChip(o); assert.match(chip, /data-oscore="a"/); assert.match(chip, /<b>91<\/b>/); assert.match(chip, /Excelente/);
  const m = c.scoreMeter(o.opp); assert.match(m, /Opportunity Score/); assert.match(m, /91<small>\/100/); assert.match(m, /var\(--ok\)/);
});
await t('ordem "Melhor oportunidade" das ofertas: com estoque primeiro, nota oficial, sem nota depois, depois preço', () => {
  const c = page();
  const list = [offer('sem', { total: 10 }), offer('b', { opp: opp(70, 'normal'), total: 40, dealScore: 99 }), offer('a', { opp: opp(80, 'boa'), total: 60, dealScore: 1 }),
    offer('esg', { stock: 'OUT_OF_STOCK', opp: opp(95, 'excelente') }), offer('c', { opp: opp(70, 'normal'), total: 30 })];
  assert.deepEqual(list.sort(vm.runInContext('OFFER_SORTS', c).score).map((o) => o.id), ['a', 'c', 'b', 'sem', 'esg']);
});

await t('listas: navegador e servidor ordenam igual, pela nota oficial da oferta exibida (o Deal Score não decide nada)', () => {
  const P = { p1: { id: 'p1', group: 'ETB', collection: 'x', copagConfirmed: true, msrp: 100 }, p2: { id: 'p2', group: 'ETB', collection: 'x', copagConfirmed: true, msrp: 100 },
    p3: { id: 'p3', group: 'ETB', collection: 'x', copagConfirmed: true, msrp: 100 }, p4: { id: 'p4', group: 'ETB', collection: 'x', copagConfirmed: true, msrp: 100 } };
  const OFF = [
    { id: 'o1', productId: 'p1', storeId: 'a', stock: 'IN_STOCK', total: 90, discount: 0.1, opp: opp(60, 'normal'), dealScore: 95 },
    { id: 'o2', productId: 'p2', storeId: 'a', stock: 'IN_STOCK', total: 80, discount: 0.2, opp: opp(85, 'boa'), dealScore: 10 },
    { id: 'o3', productId: 'p3', storeId: 'a', stock: 'IN_STOCK', total: 70, discount: 0.3, dealScore: 99 },               // sem nota oficial
    { id: 'o4', productId: 'p4', storeId: 'a', stock: 'IN_STOCK', total: 70, discount: 0.05, opp: opp(85, 'boa') },
    { id: 'o2b', productId: 'p2', storeId: 'b', stock: 'IN_STOCK', total: 80, discount: 0.2, opp: opp(40, 'baixa'), dealScore: 100 },   // empate de preço: decide o id
  ];
  const F = { mode: 'guardar', group: '', col: '', store: '', sort: 'score', stock: true, type: '', max: '', below: false };
  const c = page({ OFF, P, F }); vm.runInContext(listCode, c);
  const client = Array.from(c.sortEntries(c.entries()), (e) => `${e.p.id}:${e.o.id}`);
  const server = SITE.sortEntries(SITE.entries({ products: Object.values(P), offers: OFF }, F), F).map((e) => `${e.p.id}:${e.o.id}`);
  assert.deepEqual(client, server, 'paridade navegador × servidor');
  assert.deepEqual(client, ['p2:o2', 'p4:o4', 'p1:o1', 'p3:o3'], 'nota oficial desc; empate de nota segue o desconto; sem nota no fim');
  assert.equal(SITE.byTot({ total: 1, id: 'b', dealScore: 99 }, { total: 1, id: 'a', dealScore: 0 }) > 0, true, 'desempate de preço é o id, não o Deal Score');
});
await t('busca e coleção/formato desempatam pela nota oficial', () => {
  assert.match(cut('function searchProducts(q){', 'function searchCollections('), /oppScore\(bl\[b\.p\.id\]\)/);
  assert.match(cut('function renderGroup(kind,slug){', 'const inStock='), /oppScore\(b\.o\)/);
});

await t('"Por que esta nota?" carrega a explicação oficial da própria oferta; falha da API não inventa nada', async () => {
  const x = { offer: { id: 'a' }, product: { id: 'p1' }, price: 50, opportunity_score: 80, opportunity_band: 'boa', confidence: 0.51, confidence_level: 'média',
    current_reference: { kind: 'COPAG_OFFICIAL_CURRENT', price: 70 }, reference_comparison: { available: true, reference_kind: 'COPAG_OFFICIAL_CURRENT', reference_value: 70, percentage_below: 28.57, amount_below: 20, position: 'below' },
    warnings: [{ code: 'UNKNOWN_FREIGHT', text: 'Frete não confirmado' }], reasons: [{ code: 'BELOW_REFERENCE', text: '28,6% abaixo do preço sugerido Copag', impact: '+' }], historical_context: [], updated_at: null };
  const pop = { innerHTML: '', dataset: {}, showPopover() {}, offsetWidth: 300, offsetHeight: 200 };
  let calls = 0; let resp = { data: [x] }; let html1 = '';
  const c = page({ $: () => pop, OFF: [offer('a', { opp: opp(80, 'boa', 0.51, 'média'), dealScore: 82 })], apiGet: async (k) => { calls++; assert.equal(k, 'oportunidades?produto=p1&ofertas=todas&limite=50'); html1 = pop.innerHTML; return resp; } });
  vm.runInContext(popCode, c);
  await c.showScore({ dataset: { oscore: 'a' }, getBoundingClientRect: () => ({}) });
  assert.match(html1, /Carregando a explicação/, 'carregando'); assert.match(html1, /<b>80<\/b>/);
  assert.match(pop.innerHTML, /28,6% abaixo do preço sugerido Copag/); assert.match(pop.innerHTML, /Frete não confirmado/); assert.match(pop.innerHTML, /Média confiança \(51%\)/);
  assert.doesNotMatch(pop.innerHTML, /82|Deal Score|Faixas e critérios/); assert.equal(calls, 1);
  await c.showScore({ dataset: { oscore: 'a' }, getBoundingClientRect: () => ({}) }); assert.equal(calls, 1, 'segunda abertura usa o que já veio');
  const c2 = page({ $: () => pop, OFF: [offer('a', { opp: opp(80, 'boa') })], apiGet: async () => null }); vm.runInContext(popCode, c2);
  await c2.showScore({ dataset: { oscore: 'a' }, getBoundingClientRect: () => ({}) });
  assert.match(pop.innerHTML, /Não consegui carregar a explicação/); assert.match(pop.innerHTML, /<b>80<\/b>/, 'a nota oficial continua visível');
  const c3 = page({ $: () => pop, OFF: [offer('a', { dealScore: 82 })], apiGet: async () => { throw new Error('não deveria chamar'); } }); vm.runInContext(popCode, c3);
  pop.innerHTML = 'antes'; await c3.showScore({ dataset: { oscore: 'a' }, getBoundingClientRect: () => ({}) }); assert.equal(pop.innerHTML, 'antes', 'oferta sem nota oficial não abre explicação');
});
await t('/oportunidades continua com a mesma explicação de antes (oppWhy = <details> + oppWhyBody)', () => {
  const prev = execFileSync('git', ['show', '2df9e86:index.html'], { cwd: new URL('..', import.meta.url), maxBuffer: 64 << 20 }).toString();
  const old = { esc: (s) => String(s ?? ''), ic: (k) => `<i:${k}>`, money: (v) => `R$ ${Number(v).toFixed(2)}`, ago: () => 'agora' }; vm.createContext(old);
  vm.runInContext(cut('const BAND_UI=', '/* 6C.1 TCG Rarity System', prev) + cut('const pctPts=', 'function oppCard(', prev).replace('function oppWhy(', 'function oppWhyOld('), old);
  const now = page();
  const x = { price: 50, opportunity_score: 80, opportunity_band: 'boa', confidence: 0.51, confidence_level: 'média', current_reference: { kind: 'MARKET_CURRENT', price: 70, market_sources: 4 },
    reference_comparison: { available: true, reference_kind: 'MARKET_CURRENT', reference_value: 70, percentage_below: 28.57, amount_below: 20, position: 'below' },
    warnings: [{ text: 'Aviso' }], reasons: [{ text: 'Motivo', impact: '-' }], historical_context: [{ label: 'Lançamento', price: 60, published_at: '2024-01' }], community_reference: { price: 65 }, updated_at: '2026-10-09T00:00:00Z', engine_version: 'opportunity-v2.2' };
  assert.equal(now.oppWhy(x), old.oppWhyOld(x));
});
await t('script da página compila', () => {
  const scripts = [...html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  for (const sc of scripts) { if (sc.trim().startsWith('{')) continue; assert.doesNotThrow(() => new vm.Script(sc), 'erro de sintaxe no index.html'); }
});
console.log(`✓ Consolidação do Opportunity Engine (6C.2): ${n} grupos de testes passaram`);
