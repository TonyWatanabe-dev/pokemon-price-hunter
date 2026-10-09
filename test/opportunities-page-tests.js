// Fase 6B.1 — página /oportunidades: 100% pela API do Opportunity Engine, sem regra de negócio no navegador.
// Roda o próprio código da página (trecho de index.html) num sandbox com o mínimo de ambiente e confere o que ela desenha.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const A = html.indexOf('/* Categorias do site'); const B = html.indexOf('/* Pré-vendas: status sempre visível */');
assert.ok(A > 0 && B > A, 'trecho da página de oportunidades encontrado');
const code = html.slice(A, B);
const oppCode = code.slice(code.indexOf('/* Oportunidades (6B.1)'));
let n = 0; const t = (name, fn) => { fn(); n++; };

// ------------------------------------------------------------------ fixtures no formato real da API
const base = (x = {}) => ({
  product: { id: 'sv4-box36', slug: 'fenda-paradoxal-booster-box-36', name: 'Fenda Paradoxal - Booster Box 36', type: 'booster_box', type_label: 'Booster Box', group: 'Boosters', image: null, collection: { code: 'sv4', name: 'Fenda Paradoxal' } },
  offer: { id: 'o1', title: 't', url: 'https://ml/x', image: null, first_seen_at: '2026-10-08T13:30:10Z' },
  price: 1250, total: 1250, shipping: 'free', stock: 'in_stock', store: { id: 'mercadolivre', name: 'Mercado Livre' }, marketplace: 'mercadolivre',
  opportunity_score: 75, opportunity_band: 'boa', confidence: 0.41,
  current_reference: { kind: 'MARKET_CURRENT', label: 'Referência de mercado', price: 1844.95, source: 'market', confidence: 0.638, reason: 'robust_current_market', market_sources: 4, market_composition: 'MARKETPLACE_ONLY' },
  market_composition: 'MARKETPLACE_ONLY',
  reference_comparison: { available: true, reference_kind: 'MARKET_CURRENT', reference_label: 'Referência de mercado', reference_value: 1844.95, percentage_below: 32.25, amount_below: 594.95, position: 'below' },
  product_variation_7d: null,
  historical_context: [{ kind: 'COPAG_OFFICIAL_HISTORICAL', label: 'Preço sugerido de lançamento', price: 319.99, published_at: '2023-10', status: 'pending' }],
  community_reference: null,
  warnings: [{ code: 'MARKETPLACE_ONLY', text: 'Referência de mercado formada exclusivamente por vendedores de marketplace (4 fontes)' },
    { code: 'MARKET_HIGHLY_DEVIATED_FROM_HISTORY', text: 'O mercado atual (R$ 1.844,95) está 5,77× o preço sugerido de lançamento: muito acima do histórico disponível. Só informativo; não altera o score' }],
  reasons: [{ code: 'BELOW_REFERENCE', text: '32,2% abaixo da referência de mercado', impact: '+', reference_kind: 'MARKET_CURRENT' }],
  engine_version: 'opportunity-v2.2', updated_at: '2026-10-09T00:06:11Z', ...x,
});
const copag = () => base({ product: { ...base().product, id: 'me04-etb', type: 'etb', type_label: 'Treinador Avançado (ETB)', group: 'ETB', collection: { code: 'me04', name: 'Caos Ascendente' } },
  price: 322.9, opportunity_score: 86, confidence: 0.77, market_composition: 'MARKETPLACE_ONLY',   // composição do topo ≠ referência usada
  current_reference: { kind: 'COPAG_OFFICIAL_CURRENT', label: 'Preço sugerido Copag', price: 399.99, source: 'Copag', confidence: 0.95, reason: 'verified_current_copag' },
  reference_comparison: { available: true, reference_kind: 'COPAG_OFFICIAL_CURRENT', reference_label: 'Preço sugerido Copag', reference_value: 399.99, percentage_below: 19.27, amount_below: 77.09, position: 'below' },
  historical_context: [], warnings: [{ code: 'UNKNOWN_FREIGHT', text: 'Frete não confirmado' }] });
const noRef = () => base({ opportunity_score: 65, opportunity_band: 'normal', confidence: null, market_composition: 'NONE',
  current_reference: { kind: 'NONE', label: null, price: null, source: null, confidence: null, reason: 'no_copag_insufficient_offers' },
  reference_comparison: { available: false, reference_kind: 'NONE', reference_value: null, percentage_below: null, amount_below: null, position: null, reason: 'no_current_reference' },
  historical_context: [{ kind: 'COPAG_OFFICIAL_HISTORICAL', label: 'Preço sugerido de lançamento', price: 29.9, published_at: '2024-01', status: 'verified' }],
  community_reference: { kind: 'COMMUNITY_REFERENCE', label: 'Referência comunitária', price: 25 },
  reasons: [{ code: 'BELOW_MARKET', text: '19,1% abaixo da mediana de 2 ofertas com estoque', impact: '+' }], warnings: [{ code: 'NO_CURRENT_REFERENCE', text: 'Não há referência atual suficiente' }] });

// ------------------------------------------------------------------ sandbox: helpers mínimos do site + API simulada
function sandbox(apiResponse) {
  const calls = []; const view = { innerHTML: '' };
  const ctx = {
    console, URLSearchParams, Math, String, Number, Array, JSON, Object, Promise, setTimeout,
    store: { get: (k, d) => d, set() {} }, S: { collections: [{ id: 'sv4', name: 'Fenda Paradoxal' }], reputation: { lojas: {} } }, SLUG: {},
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    money: (v) => (v == null ? '-' : 'R$ ' + Number(v).toFixed(2).replace('.', ',')), ic: (id) => `<i data-ic="${id}"></i>`,
    photo: () => '<div class="photo"></div>', catOf: () => 'box', g: () => ({ c: '#000' }), catChip: () => '', isFav: () => false, raBadge: () => '',
    safeUrl: (u) => u, ago: () => 'há 1 h', revealInit: undefined, OFF: [], P: {}, live: () => true,
    view: 'oportunidades', $: (sel) => (sel === '#view' ? view : null), IntersectionObserver: undefined,
    apiGet: async (path) => { calls.push(path); return typeof apiResponse === 'function' ? apiResponse(path) : apiResponse; },
  };
  vm.createContext(ctx);
  vm.runInContext(code + '\n;globalThis.__t={oppCard,oppFlags,oppWhy,oppQuery,renderOpp,OF,OPP,filterControls};', ctx);
  return { ...ctx.__t, calls, view, ctx };
}
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const page = (items, meta = {}) => ({ data: items, meta: { page: 1, limit: 24, total: items.length, pages: 1, engine: 'opportunity-v2.2', ...meta } });

// 1. a página recebe os dados do endpoint de oportunidades
{ const s = sandbox(page([base(), copag()])); await s.renderOpp();
  assert.deepEqual(s.calls, ['oportunidades?limite=24&pagina=1&ordem=score']); assert.match(s.view.innerHTML, /Fenda Paradoxal/); assert.match(text(s.view.innerHTML), /2 ofertas/); n++; }
// 2–5. score, faixa, confiança e referência atual exatamente como a API mandou
t('2–5. score, faixa, confiança e referência vêm da API', () => {
  const s = sandbox(page([]));
  const h = text(s.oppCard(base({ opportunity_score: 61, opportunity_band: 'excelente', confidence: 0.33 }), 5));
  assert.match(h, /Opportunity Score 61 \/100/, 'score da API, mesmo que não "combine" com a faixa'); assert.match(h, /Excelente oportunidade/, 'faixa da API');
  assert.match(h, /Confiança dos dados 33%/); assert.ok(!/Deal Score/i.test(h), 'nomenclatura nova');
  assert.match(h, /Ref\. mercado R\$ 1844,95/); assert.match(h, /Referência atual: Referência de mercado R\$ 1844,95 · 4 fontes/);
  const c = text(s.oppCard(copag(), 0)); assert.match(c, /19,3% abaixo do preço sugerido Copag/); assert.match(c, /Copag R\$ 399,99/);
});
// 6–7. composição e aviso MARKETPLACE_ONLY pela referência ATUAL
t('6–7. MARKETPLACE_ONLY: aviso visual decidido por current_reference', () => {
  const s = sandbox(page([]));
  assert.match(s.oppFlags(base()), /Mercado observado apenas em marketplaces/);
  assert.ok(!/apenas em marketplaces/.test(s.oppFlags(copag())), 'Copag como referência: composição do topo não gera aviso');
  const mixed = base({ current_reference: { ...base().current_reference, market_composition: 'MARKET_MIXED' }, warnings: [] });
  assert.equal(s.oppFlags(mixed), '');
  assert.match(text(s.oppCard(base(), 0)), /32,3% abaixo da referência de mercado/, 'aviso não transforma em má oportunidade: score e % continuam');
});
// 8. desvio histórico
t('8. MARKET_HIGHLY_DEVIATED_FROM_HISTORY gera aviso com o texto da API', () => {
  const s = sandbox(page([])); const f = s.oppFlags(base());
  assert.match(f, /Mercado muito acima do histórico/); assert.match(f, /5,77× o preço sugerido de lançamento/, 'texto da API no title');
  const below = base({ warnings: [{ code: 'MARKET_HIGHLY_DEVIATED_FROM_HISTORY', text: 'O mercado atual está 0,4× ...: muito abaixo do histórico disponível' }] });
  assert.match(s.oppFlags(below), /Mercado muito abaixo do histórico/);
});
// 9–10. sem referência e sem confiança não quebram; histórico/comunitária ficam como contexto
t('9–10. sem referência / sem confiança', () => {
  const s = sandbox(page([])); const h = text(s.oppCard(noRef(), 0));
  assert.match(h, /Sem referência atual para comparar/); assert.match(h, /sem referência atual/); assert.match(h, /Confiança não informada/);
  assert.ok(!/abaixo do preço sugerido|abaixo da referência/.test(h), 'nenhum percentual inventado');
  assert.match(h, /Preço sugerido de lançamento R\$ 29,90 \(2024-01\): contexto, não é preço atual/);
  assert.match(h, /Referência comunitária R\$ 25,00: não é preço Copag/);
  const nulls = base({ opportunity_score: null, opportunity_band: null, confidence: null, current_reference: null, reference_comparison: null, warnings: null, reasons: null, historical_context: null });
  assert.doesNotThrow(() => s.oppCard(nulls, 0));
});
// filtros e ordens → parâmetros reais da API (filtragem e ordenação no servidor)
t('filtros e ordenação viram parâmetros da API', () => {
  const s = sandbox(page([])); Object.assign(s.OF, { cat: 'Blisters', col: 'sv4', faixa: 'boa', abaixo: '20', ref: 'mercado', conf: '60', sort: 'economia' });
  assert.equal(s.oppQuery(2), 'oportunidades?limite=24&pagina=2&ordem=economia&categoria=Blisters&colecao=sv4&faixa=boa&abaixo=20&referencia=mercado&confianca_minima=60');
  const f = text(s.filterControls()); for (const l of ['Categoria', 'Coleção', 'Faixa', 'Abaixo da referência', 'Referência atual', 'Confiança', 'Ordenar']) assert.ok(f.includes(l), l);
  assert.ok(!/Desconto|Deal Score/.test(f));
});
// estados: vazio, erro, sem banco
{ const s = sandbox(page([])); await s.renderOpp(); assert.match(text(s.view.innerHTML), /Nenhuma oportunidade encontrada/); }
{ const s = sandbox(null); await s.renderOpp(); assert.match(text(s.view.innerHTML), /Não conseguimos carregar as oportunidades/); }
{ const s = sandbox({ data: [], meta: { status: 'requires_db', total: 0 } }); await s.renderOpp(); assert.match(text(s.view.innerHTML), /indisponíveis/); assert.ok(!/R\$/.test(text(s.view.innerHTML))); }
n++;

// 11. nenhum cálculo de score/percentual no navegador (inspeção do código da página)
t('11. sem regra de negócio no frontend', () => {
  for (const bad of [/dealScore/, /discount/, /reference_value\s*[-*/]/, /\bprice\s*[-/]\s*/, /percentage_below\s*[*/+-]/, /opportunity_score\s*[*/+-]/, /confidence\s*[*]\s*(?!100)/, /WEIGHTS|CAPS|market_signal|reference_signal/])
    assert.ok(!bad.test(oppCode), `trecho proibido: ${bad}`);
  assert.ok(!/market_composition==="MARKETPLACE_ONLY"/.test(oppCode.replace(/cr\.market_composition==="MARKETPLACE_ONLY"/g, '')), 'aviso só pela composição da referência atual');
  assert.ok(!/\.sort\(/.test(oppCode), 'ordenação só no servidor'); assert.ok(!/\.filter\(\(x\)=>x\.(opportunity|confidence|reference)/.test(oppCode), 'filtro só no servidor');
});
// 12. state.json não é fonte da página
t('12. state.json não é usado na página de oportunidades', () => {
  assert.ok(!/state\.json|fetchState|ensureFull|OFF\b/.test(oppCode), 'sem state.json no trecho');
  assert.match(html, /const API_VIEWS=new Set\(\[[^\]]*"oportunidades"/, '/oportunidades abre pelo resumo da API, sem baixar o state.json');
});
console.log(`✓ Página /oportunidades (6B.1): ${n} grupos de testes passaram`);
