// Fase 5 — critério de saída "fonte não oficial não aparece como Copag confirmada" (camada de referências e motores).
// Testes puros (sem banco, sem rede). Cobre todos os caminhos pelos quais uma referência vira COPAG_OFFICIAL_*:
//  robô (robotReferenceKind / referenceRows), importação (validateImportEntry), Price Engine, Opportunity Engine e contrato da API,
//  e a paridade entre o predicado JS (isCopagUrl) e a CHECK do banco (reference_price_copag_domain_check, migration 006).
// Fora do escopo (decisão do proprietário, PR #186): a apresentação "Copag confirmada" do site para as entradas manuais
// do catálogo cuja fonte é o Instagram — ver o último grupo, que só impede o conjunto de crescer sem marcação manual.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isCopagUrl, robotReferenceKind, validateImportEntry, pickCurrentReference, resolveCurrentReference, currentReferenceView,
  contextReferenceView, LABEL, KINDS } from '../src/core/references.js';
import { referenceRows } from '../src/core/mappers.js';
import { computeProductStats } from '../src/core/price-engine.js';
import { calculateOpportunity } from '../src/core/opportunity-engine.js';
import { copagStatus } from '../src/score.js';

let n = 0; const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const root = new URL('../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), 'utf8');
const OFFICIAL = (k) => String(k || '').startsWith('COPAG_OFFICIAL');

// regra do banco, lida da própria migration (não copiada à mão)
const mig = read('db/migrations/006_reference_kinds.sql');
const m = mig.match(/reference_price_copag_domain_check CHECK \(reference_kind NOT LIKE 'COPAG_OFFICIAL%'\s*OR source_url ~\* '([^']+)'\)/);
assert.ok(m, 'CHECK reference_price_copag_domain_check não encontrada na migration 006');
const DB_RULE = new RegExp(m[1], 'i');

const NOT_COPAG = [
  'https://www.instagram.com/voltztcg/', 'https://www.instagram.com/p/tabela-copag/', 'https://www.facebook.com/copagoficial', 'https://mestrepull.com.br/copag',
  'https://copagloja.com.br.golpe.com/x', 'https://golpecopag.com.br/x', 'https://copag.com.br@evil.com/', 'https://evil.com/copag.com.br', 'https://evil.com/?u=https://copag.com.br',
  'https://copag.com.br./x', 'https://copag.com.br.evil/x', 'https://xn--copag-xxx.com.br', 'https://copag.com/x', 'https://copagloja.com/x', 'https://copag.net.br/x',
  '//copag.com.br/x', 'copag.com.br', 'www.copagloja.com.br/x', '', null, undefined, 42, {},
  // host Copag, mas fora da regra do banco: aceitar aqui faria o INSERT em lote do sync falhar (e "javascript:"/"ftp:" não são página)
  'ftp://copag.com.br/x', 'javascript://copag.com.br/%0aalert(1)', 'https://copag.com.br:443/x', 'https://copag.com.br?x=1', 'https://copag.com.br#a',
  'https://user@copag.com.br/', 'https://copag.com.br\\@evil.com',
];
const COPAG = ['https://www.copagloja.com.br/treinador-avancado-pokemon-me04-caos-ascendente/p', 'https://copagloja.com.br', 'https://copag.com.br/',
  'HTTPS://WWW.COPAGLOJA.COM.BR/X', 'http://loja.copag.com.br/a?b=1#c'];

t('isCopagUrl: domínios parecidos, outras redes e URLs fora da regra do banco não são Copag', () => {
  for (const u of NOT_COPAG) assert.equal(isCopagUrl(u), false, String(u));
  for (const u of COPAG) assert.equal(isCopagUrl(u), true, u);
});

t('paridade com o banco: o que o JS chama de Copag o banco aceita (nunca o contrário do que a CHECK permite)', () => {
  for (const u of [...NOT_COPAG, ...COPAG].filter((x) => typeof x === 'string')) {
    if (isCopagUrl(u)) assert.ok(DB_RULE.test(u), `JS aceita e o banco recusaria: ${u}`);
  }
  // as outras cópias da regra no repositório são idênticas à da CHECK
  for (const f of ['db/migrations/010_reference_evidence.sql', 'tools/db-validate.mjs']) {
    const src = read(f).replace(/\\\\/g, '\\');
    assert.ok(src.includes(m[1]), `${f}: regra de domínio Copag diferente da migration 006`);
  }
});

t('robô: fonte não Copag vira COMMUNITY_REFERENCE em robotReferenceKind e no mapper', () => {
  for (const u of NOT_COPAG) assert.equal(robotReferenceKind({ source_url: u }), 'COMMUNITY_REFERENCE', String(u));
  const products = NOT_COPAG.filter((u) => typeof u === 'string' && u).map((u, i) => ({ id: `p${i}`, copagConfirmed: true, msrp: 100 + i,
    copag: { source_url: u, confidence: 'OFICIAL', source_timestamp: '2026-10-07', manual: true } }));
  products.push({ id: 'pend', copagReference: 99.9, copagReferenceUrl: 'https://www.instagram.com/p/x/' });
  for (const r of referenceRows(products)) {
    assert.ok(!OFFICIAL(r.reference_kind), `${r.legacy_id} (${r.source_url}) virou ${r.reference_kind}`);
    assert.notEqual(r.source, 'copag_loja');
  }
  // e o que o mapper chama de oficial sempre passa na CHECK do banco
  const ok = referenceRows(COPAG.map((u, i) => ({ id: `c${i}`, copagConfirmed: true, msrp: 10, copag: { source_url: u, confidence: 'OFICIAL', source_timestamp: '2026-10-07' } })));
  for (const r of ok) { assert.equal(r.reference_kind, 'COPAG_OFFICIAL_CURRENT'); assert.ok(DB_RULE.test(r.source_url)); }
});

t('importação: COPAG_OFFICIAL_* com fonte não Copag é recusada, qualquer que seja a confiança/fonte declarada', () => {
  const base = { legacy_id: 'x', value: 399.99, source: 'manual', observed_at: '2026-10-07T00:00:00Z', verification_status: 'verified',
    verified_at: '2026-10-07T00:00:00Z', confidence: 100, evidence_text: 'tabela' };
  for (const kind of KINDS.filter(OFFICIAL)) for (const source of ['manual', 'copag_loja', 'copag_loja_catalog', 'instagram']) for (const u of NOT_COPAG) {
    const bad = validateImportEntry({ ...base, reference_kind: kind, source, source_url: u });
    assert.ok(bad.includes('Copag oficial fora do domínio Copag') || bad.includes('sem URL'), `${kind}/${source}/${u}: ${bad}`);
  }
  assert.deepEqual(validateImportEntry({ ...base, reference_kind: 'COMMUNITY_REFERENCE', source_url: 'https://www.instagram.com/voltztcg/' }), []);
});

t('motores: comunitária/histórica nunca entram como Copag; razões nunca citam Copag sem referência Copag atual', () => {
  const asOf = new Date('2026-10-15T12:00:00Z');
  const off = (id, store, price) => ({ id, store_id: store, marketplace_id: 'direct', status: 'active', condition: 'new', confirmed: true, price, stock_status: 'in_stock',
    shipping_status: 'unknown', total_price: null, last_seen_at: '2026-10-15T10:00:00Z', events: [] });
  const offers = [off('1', 'a', 300), off('2', 'b', 310), off('3', 'c', 320), off('4', 'd', 330)];
  for (const kind of ['COMMUNITY_REFERENCE', 'COPAG_OFFICIAL_HISTORICAL', 'MARKET_HISTORICAL']) {
    const { stats } = computeProductStats({ product: { condition: 'new' }, offers, reference: { value: 399.99, status: 'verified', source: 'manual', kind, confidence: 95 }, asOf });
    assert.notEqual(stats.reference_kind, 'COPAG_OFFICIAL_CURRENT', kind);
    const o = calculateOpportunity({ ...stats, reference_context: { historical: [], community: [{ price: 399.99 }] } }, { ...offers[0], store: {}, seller: {} }, { now: asOf });
    assert.notEqual(o.reference_kind, 'COPAG_OFFICIAL_CURRENT');
    for (const x of o.reasons) assert.ok(!/Copag/.test(x.text), `${kind}: razão cita Copag: ${x.text}`);
  }
  // linhas de banco: comunitária verificada nunca é a referência atual; resolveCurrentReference só aceita o tipo Copag atual
  const row = (x) => ({ id: 1, value: 399.99, verification_status: 'verified', confidence: 100, verified_at: '2026-10-15T00:00:00Z', ...x });
  assert.equal(pickCurrentReference([row({ reference_kind: 'COMMUNITY_REFERENCE', source_url: 'https://www.instagram.com/voltztcg/' })]), null);
  for (const k of ['COMMUNITY_REFERENCE', 'COPAG_OFFICIAL_HISTORICAL', 'MARKET_HISTORICAL', 'MARKET_CURRENT', null])
    assert.notEqual(resolveCurrentReference({ copag: row({ reference_kind: k }), asOf: new Date('2026-10-15T12:00:00Z') }).kind, 'COPAG_OFFICIAL_CURRENT', String(k));
});

t('contrato da API: rótulo/fonte "Copag" só para tipos COPAG_OFFICIAL_*', () => {
  for (const k of KINDS.filter((x) => !OFFICIAL(x))) assert.ok(!/Copag/.test(LABEL[k]), `${k}: ${LABEL[k]}`);
  const v = currentReferenceView({ kind: 'MARKET_CURRENT', price: 315, confidence: 0.7, reason: 'robust_current_market' });
  assert.equal(v.source, 'market'); assert.ok(!/Copag/.test(v.label));
  for (const k of KINDS.filter((x) => !OFFICIAL(x))) {
    const c = contextReferenceView({ reference_kind: k, value: 399.99, confidence: 95, source: 'manual', source_url: 'https://www.instagram.com/voltztcg/' });
    assert.notEqual(c.source, 'Copag', k); assert.ok(!/Copag/.test(c.label || ''), k);
  }
});

t('catálogo: "Copag confirmada" com fonte fora da Copag só existe com marcação manual (decisão do proprietário, PR #186)', () => {
  const catalog = JSON.parse(read('config/catalog.json'));
  const confirmedOffDomain = Object.entries(catalog.copag || {}).filter(([, c]) => copagStatus({ copag: c }).confirmed && !isCopagUrl(c.source_url));
  for (const [id, c] of confirmedOffDomain) assert.equal(c.manual, true, `${id}: confirmada com fonte fora da Copag (${c.source_url}) sem marcação manual`);
  // no Marketplace Core essas linhas são COMMUNITY_REFERENCE (não entram no score); a apresentação no site é a decisão pendente
  const rows = referenceRows(confirmedOffDomain.map(([id, c]) => ({ id, copagConfirmed: true, msrp: c.msrp, copag: c })));
  assert.ok(rows.every((r) => r.reference_kind === 'COMMUNITY_REFERENCE'));
  console.log(`  catálogo: ${confirmedOffDomain.length} entradas manuais "OFICIAL" com fonte fora da Copag (todas COMMUNITY_REFERENCE no motor)`);
});

console.log(`✓ Referência não oficial nunca vira Copag oficial (Fase 5): ${n} grupos`);
