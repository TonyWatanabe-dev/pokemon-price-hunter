// Referências de preço (Fase 5.6): testes puros — tipos, escopo, prioridade, datas, fonte, importação, Price Engine.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { KINDS, SCOPE, CURRENT_PRIORITY, LABEL, confidenceLabel, isPartialDate, isCopagUrl, robotReferenceKind, pickCurrentReference, historicalContext, validateImportEntry } from '../src/core/references.js';
import { planImport } from '../src/core/reference-import.js';
import { referenceRows } from '../src/core/mappers.js';
import { computeProductStats } from '../src/core/price-engine.js';

let n = 0; const t = (name, fn) => { fn(); n++; };
const row = (x) => ({ id: 1, value: 100, verification_status: 'verified', confidence: 90, verified_at: '2026-10-01T00:00:00Z', ...x });

t('tipos e escopos', () => {
  assert.deepEqual(KINDS.sort(), ['COMMUNITY_REFERENCE', 'COPAG_OFFICIAL_CURRENT', 'COPAG_OFFICIAL_HISTORICAL', 'MARKET_CURRENT', 'MARKET_HISTORICAL']);
  assert.equal(SCOPE.COPAG_OFFICIAL_CURRENT, 'current'); assert.equal(SCOPE.MARKET_CURRENT, 'current');
  assert.equal(SCOPE.COPAG_OFFICIAL_HISTORICAL, 'historical'); assert.equal(SCOPE.MARKET_HISTORICAL, 'historical');
  assert.equal(SCOPE.COMMUNITY_REFERENCE, 'community');
  assert.notEqual('COPAG_OFFICIAL_HISTORICAL', 'COPAG_OFFICIAL_CURRENT'); assert.notEqual(SCOPE.COPAG_OFFICIAL_HISTORICAL, SCOPE.COPAG_OFFICIAL_CURRENT);
  assert.equal(LABEL.COPAG_OFFICIAL_HISTORICAL, 'Preço sugerido de lançamento'); assert.equal(LABEL.COPAG_OFFICIAL_CURRENT, 'Preço sugerido Copag');
  assert.ok(!('COPAG_OFFICIAL_HISTORICAL' in CURRENT_PRIORITY) && !('COMMUNITY_REFERENCE' in CURRENT_PRIORITY));
});

t('Copag atual', () => {
  const c = pickCurrentReference([row({ reference_kind: 'COPAG_OFFICIAL_CURRENT', value: 399.99 })]);
  assert.equal(c.value, 399.99); assert.equal(c.reference_kind, 'COPAG_OFFICIAL_CURRENT');
});

t('Copag histórica NUNCA vira referência atual', () => {
  const h = row({ reference_kind: 'COPAG_OFFICIAL_HISTORICAL', value: 369.99, published_at: '2023-03' });
  assert.equal(pickCurrentReference([h]), null, 'só histórico → sem referência atual (NONE)');
  assert.deepEqual(historicalContext([h]).map((x) => x.value), [369.99]);
  // mesmo com confiança maior e verificação mais recente, o histórico não ganha do atual
  const cur = row({ id: 2, reference_kind: 'COPAG_OFFICIAL_CURRENT', value: 399.99, confidence: 50, verified_at: '2020-01-01T00:00:00Z' });
  assert.equal(pickCurrentReference([{ ...h, confidence: 100, verified_at: '2026-10-08T00:00:00Z' }, cur]).value, 399.99);
});

t('mercado atual e mercado histórico', () => {
  const m = row({ reference_kind: 'MARKET_CURRENT', value: 320 });
  assert.equal(pickCurrentReference([m]).value, 320);
  const mh = row({ reference_kind: 'MARKET_HISTORICAL', value: 280, published_at: '2025' });
  assert.equal(pickCurrentReference([mh]), null);
  assert.equal(historicalContext([mh, m]).length, 1);
});

t('referência comunitária não é oficial nem atual', () => {
  const c = row({ reference_kind: 'COMMUNITY_REFERENCE', value: 399.99, source_url: 'https://www.instagram.com/voltztcg/' });
  assert.equal(pickCurrentReference([c]), null); assert.deepEqual(historicalContext([c]), []);
  assert.equal(robotReferenceKind({ source_url: 'https://www.instagram.com/voltztcg/' }), 'COMMUNITY_REFERENCE');
  assert.equal(robotReferenceKind({ source_url: 'https://www.copagloja.com.br/x/p' }), 'COPAG_OFFICIAL_CURRENT');
  assert.equal(robotReferenceKind({ source_url: 'https://copagloja.com.br.golpe.com/x' }), 'COMMUNITY_REFERENCE', 'domínio parecido não engana');
  assert.equal(robotReferenceKind({ source_url: null }), 'COMMUNITY_REFERENCE');
  // o mapper do robô: tabela de 30 anos (Instagram) vira comunitária; loja Copag vira Copag atual
  const rows = referenceRows([
    { id: 'c30-etb', copagConfirmed: true, msrp: 399.99, copag: { source_url: 'https://www.instagram.com/voltztcg/', confidence: 'OFICIAL', source_timestamp: '2026-10-07', manual: true } },
    { id: 'me04-etb', copagConfirmed: true, msrp: 399.99, copag: { source_url: 'https://www.copagloja.com.br/treinador-avancado-pokemon-me04-caos-ascendente/p', confidence: 'OFICIAL', source_timestamp: '2026-10-08T20:20:51Z' } },
  ]);
  assert.deepEqual(rows.map((r) => [r.legacy_id, r.reference_kind]), [['c30-etb', 'COMMUNITY_REFERENCE'], ['me04-etb', 'COPAG_OFFICIAL_CURRENT']]);
  assert.equal(rows[1].observed_at, rows[1].verified_at);
});

t('ausência de referência = NONE (null)', () => {
  assert.equal(pickCurrentReference([]), null); assert.equal(pickCurrentReference(null), null);
  assert.equal(pickCurrentReference([row({ reference_kind: 'COPAG_OFFICIAL_CURRENT', verification_status: 'pending' })]), null, 'pendente não é referência atual');
});

t('prioridade: Copag atual > mercado atual; desempate por confiança, data, id', () => {
  const a = row({ id: 1, reference_kind: 'MARKET_CURRENT', value: 300, confidence: 100 });
  const b = row({ id: 2, reference_kind: 'COPAG_OFFICIAL_CURRENT', value: 399.99, confidence: 60 });
  assert.equal(pickCurrentReference([a, b]).id, 2); assert.equal(pickCurrentReference([b, a]).id, 2);
  const c = row({ id: 3, reference_kind: 'COPAG_OFFICIAL_CURRENT', value: 389.99, confidence: 90 });
  assert.equal(pickCurrentReference([b, c]).id, 3);
  const d = row({ id: 4, reference_kind: 'COPAG_OFFICIAL_CURRENT', value: 389.99, confidence: 90, verified_at: '2026-10-05T00:00:00Z' });
  assert.equal(pickCurrentReference([c, d]).id, 4);
  assert.equal(pickCurrentReference([{ ...c, id: 5 }, { ...c, id: 9 }]).id, 9);
});

t('confiança', () => {
  assert.equal(confidenceLabel(90), 'alta'); assert.equal(confidenceLabel(85), 'alta'); assert.equal(confidenceLabel(60), 'média'); assert.equal(confidenceLabel(30), 'baixa'); assert.equal(confidenceLabel(null), null);
});

t('datas: parciais, sem inventar dia', () => {
  for (const d of ['2023', '2023-03', '2023-03-31', null, undefined]) assert.ok(isPartialDate(d), String(d));
  for (const d of ['03.2023', '2023-13', '2023-02-32', '31/03/2023', '2023-3']) assert.ok(!isPartialDate(d), d);
});

t('fonte: domínio Copag', () => {
  assert.ok(isCopagUrl('https://copag.com.br/pokemon/blog/detalhes/x')); assert.ok(isCopagUrl('https://www.copagloja.com.br/p'));
  assert.ok(!isCopagUrl('https://www.instagram.com/copagoficial/')); assert.ok(!isCopagUrl('https://topdrawblog.com.br/copag')); assert.ok(!isCopagUrl('nada'));
});

const file = JSON.parse(fs.readFileSync(new URL('../db/reference-imports/2026-10-08-copag-audit.json', import.meta.url), 'utf8'));
t('arquivo de importação da auditoria', () => {
  assert.equal(file.entries.length, 60);
  const by = (k) => file.entries.filter((e) => e.reference_kind === k).length;
  assert.equal(by('COPAG_OFFICIAL_HISTORICAL'), 55); assert.equal(by('COPAG_OFFICIAL_CURRENT'), 5);
  assert.equal(file.entries.filter((e) => e.audit_confidence === 'alta').length, 51);
  assert.equal(file.entries.filter((e) => e.audit_confidence === 'média').length, 9);
  for (const e of file.entries) {
    assert.deepEqual(validateImportEntry(e, { excluded: file.excluded }), [], e.legacy_id);
    assert.equal(e.confidence, e.audit_confidence === 'alta' ? 90 : 60, 'confiança não é elevada');
    assert.equal(e.verification_status, e.audit_confidence === 'alta' ? 'verified' : 'pending');
    assert.equal(e.effective_date, null, 'vigência não inferida da data de publicação');
    if (e.reference_kind === 'COPAG_OFFICIAL_HISTORICAL') { assert.match(e.published_at, /^\d{4}-\d{2}$/); assert.match(e.source_url, /^https:\/\/copag\.com\.br\/pokemon\/blog\//); }
    assert.ok(e.evidence_text && e.page_title && e.source_url);
  }
  assert.deepEqual([...file.excluded].sort(), ['sv3_5-combo', 'sv4_5-colecao_ex-rreo', 'sv4_5-combo', 'sv6_5-colecao_premium', 'sv6_5-combo', 'sv7-combo']);
  assert.ok(!file.entries.some((e) => file.excluded.includes(e.legacy_id)));
});

t('importação: recusa o que não presta', () => {
  const base = file.entries.find((e) => e.legacy_id === 'sv3-etb');
  const products = [{ id: 1, legacy_id: 'sv3-etb' }, { id: 2, legacy_id: 'sv7-combo' }];
  const bad = [
    { ...base, legacy_id: 'sv7-combo' },                                                   // ambíguo
    { ...base, legacy_id: 'nao-existe' },                                                  // produto inexistente
    { ...base, source_url: 'https://www.instagram.com/voltztcg/' },                       // "Copag oficial" fora do domínio
    { ...base, published_at: '03.2023' },                                                  // data em formato inventado
    { ...base, reference_kind: 'COPAG_OFFICIAL_ADJUSTED' },                                // tipo inexistente (ex.: corrigido por inflação)
    { ...base, value: 0 },
    { ...base, evidence_text: '' },
    { ...base, verification_status: 'verified', verified_at: null },
  ];
  const plan = planImport({ import_id: 't', excluded: ['sv7-combo'], entries: [base, ...bad] }, products);
  assert.equal(plan.ok.length, 1); assert.equal(plan.rejected.length, bad.length);
  assert.match(plan.rejected[0].reasons.join(), /ambíguo/); assert.match(plan.rejected[1].reasons.join(), /não existe/);
  assert.match(plan.rejected[2].reasons.join(), /domínio Copag/); assert.match(plan.rejected[4].reasons.join(), /tipo inválido/);
  assert.equal(plan.ok[0].value, base.value, 'preço importado sem correção');
});

t('Price Engine: histórico e comunitária não são referência atual (defesa no motor)', () => {
  const offers = [{ id: 1, store_id: 'a', status: 'active', condition: 'new', confirmed: true, price: 300, stock_status: 'in_stock', shipping_status: 'unknown', events: [] }];
  const asOf = new Date('2026-10-08T12:00:00Z');
  const run = (reference) => computeProductStats({ product: { condition: 'new' }, offers, reference, asOf }).stats;
  const hist = run({ value: 369.99, status: 'verified', source: 'copag_blog', kind: 'COPAG_OFFICIAL_HISTORICAL' });
  assert.equal(hist.reference_price, null); assert.equal(hist.discount_vs_reference, null, 'nada de "19% abaixo da Copag" com preço de 2023');
  const com = run({ value: 399.99, status: 'verified', source: 'manual', kind: 'COMMUNITY_REFERENCE' });
  assert.equal(com.discount_vs_reference, null);
  const cur = run({ value: 400, status: 'verified', source: 'copag_loja', kind: 'COPAG_OFFICIAL_CURRENT' });
  assert.equal(cur.discount_vs_reference, 0.25); assert.equal(cur.reference_kind, 'COPAG_OFFICIAL_CURRENT');
});

t('função da Vercel não importa de src/ (src/ não é publicado: .vercelignore)', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : /\.m?js$/.test(e.name) ? [`${d}/${e.name}`] : []));
  const dir = fileURLToPath(new URL('../api', import.meta.url));
  const bad = walk(dir).filter((f) => /from\s+['"](\.\.\/)+src\//.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(bad, []);
});

console.log(`✓ Referências (atual × histórico): ${n} grupos de testes passaram`);
