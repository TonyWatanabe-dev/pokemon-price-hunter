// Catalog Agent (Fase 7, item 6): só proposta, com evidência estruturada. Dados SINTÉTICOS, sem rede/banco.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { catalogReport, catalogMarkdown, catalogPrerequisites, CATALOG_AGENT_VERSION } from '../src/agents/catalog-agent.js';
import { runGolden } from '../src/agents/golden-eval.js';

let n = 0; const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };
const AS_OF = '2026-10-15T12:00:00.000Z';
const catalog = { collections: [
  { id: 'sv9', name: 'Amigos de Jornada', series: 'EV', aliases: ['sv9', 'amigos de jornada'] },
  { id: 'me04', name: 'Caos Ascendente', series: 'ME', aliases: ['me04', 'caos ascendente'] },
  { id: 'me05', name: 'Escuridão Absoluta', series: 'ME', aliases: ['me05', 'escuridao absoluta'] },
], products: [] };
const P = (id, collection, type, boosters, x = {}) => ({ id, collection, type, boosters, name: x.name || id, ...x });
const O = (id, productId, storeId, x = {}) => ({ id, productId, storeId, url: `https://${storeId}.example/p/${x.slug || id}`, title: x.title || `Pokémon ${productId}`,
  price: 100, stock: 'IN_STOCK', matchConfidence: 0.8, source_timestamp: '2026-10-15T11:00:00.000Z', ...x });
const state = () => ({
  generatedAt: '2026-10-15T11:00:00.000Z',
  products: [
    P('sv9-etb', 'sv9', 'etb', null, { collectionName: 'Amigos de Jornada', name: 'Amigos de Jornada - ETB' }),
    P('ev09-etb', 'ev09', 'etb', null, { collectionName: 'Amigos de Jornada', name: 'Amigos de Jornada - ETB' }),
    P('me04-box36', 'me04', 'booster_box', 36),
    P('me04-etb', 'me04', 'etb', null),
    P('me05-etb', 'me05', 'etb', null),
    P('me05-box36', 'me05', 'booster_box', 36, { ean: '0196214156098' }),
  ],
  offers: [
    O('a1', 'me04-box36', 'lojaA', { ean: '7890000000011' }), O('b1', 'me04-box36', 'lojaB', { ean: '07890000000011' }),
    O('c1', 'me04-etb', 'copag', { ean: '196214156036' }), O('c2', 'me05-etb', 'copag', { ean: '196214156036' }),
    O('d1', 'me05-box36', 'lojaA', { ean: '196214156999' }),
    O('e1', 'me04-box36', 'lojaC', { title: 'Booster Box Caos Ascendente 18 boosters' }),
    O('f1', 'me04-etb', 'lojaD', { slug: 'mesmo' }), O('f2', 'me04-etb', 'lojaD', { slug: 'mesmo', url: 'https://lojaD.example/p/mesmo?utm_source=x' }),
    O('g1', 'me04-etb', 'lojaE', { slug: 'url-dupla' }), O('g2', 'me05-etb', 'lojaE', { slug: 'url-dupla' }),
  ],
  unmatched: [{ store: 'lojaF', url: 'https://lojaF.example/x', title: 'Pokémon Caos Ascendente coisa', why: ['tipo de produto não identificado'] }],
});
const report = (s = state(), o = {}) => catalogReport({ state: s, catalog, asOf: AS_OF, ...o });
const of = (rep, kind) => rep.proposals.filter((p) => p.kind === kind);

t('envelope: só proposta, nada gravado, versão e horário de referência', () => {
  const r = report();
  assert.equal(r.agent, 'catalog'); assert.equal(r.version, CATALOG_AGENT_VERSION);
  assert.equal(r.mode, 'proposta'); assert.equal(r.writes, false); assert.equal(r.autoApply, false); assert.equal(r.asOf, AS_OF);
  assert.ok(r.proposals.length > 0);
  for (const p of r.proposals) {
    assert.equal(p.decision, 'needs_review', p.key); assert.equal(p.autoApply, false, p.key);
    assert.ok(Array.isArray(p.evidence) && p.evidence.length, `${p.key} sem evidência`);
    for (const e of p.evidence) assert.ok(e.code && e.detail && e.source && ['observado', 'inferido'].includes(e.basis), `${p.key}: evidência malformada ${JSON.stringify(e)}`);
  }
  assert.equal(new Set(r.proposals.map((p) => p.key)).size, r.proposals.length, 'chaves únicas (idempotentes)');
});

t('não altera a entrada e é determinístico', () => {
  const s = state(); const before = JSON.stringify(s);
  const a = report(s); const b = report(s);
  assert.equal(JSON.stringify(s), before, 'state mutado');
  assert.deepEqual(a, b);
});

t('duplicata de produto reaproveita duplicates.js (código legado com mesmo nome)', () => {
  const [d] = of(report(), 'produto_duplicado');
  assert.deepEqual(d.subject.products, ['ev09-etb', 'sv9-etb']);
  assert.ok(d.evidence.some((e) => e.code === 'COLECAO_MESMO_NOME_CODIGO_DIFERENTE'));
  assert.ok(d.confidence >= 60);
});

t('coleção fora do catálogo sugere o código com o mesmo nome', () => {
  const [c] = of(report(), 'colecao_fora_do_catalogo');
  assert.equal(c.subject.collection, 'ev09');
  assert.deepEqual(c.suggestion, { action: 'revisar_codigo_legado', from: 'ev09', to: 'sv9' });
});

t('EAN observado em 2 lojas vira proposta; normaliza zeros à esquerda; nunca grava', () => {
  const p = of(report(), 'ean_observado').find((x) => x.subject.product === 'me04-box36');
  assert.equal(p.suggestion.ean, '7890000000011'); assert.deepEqual(p.suggestion.stores, ['lojaA', 'lojaB']);
  assert.ok(p.confidence >= 70); assert.deepEqual(p.ambiguity, []);
  assert.ok(p.evidence.every((e) => e.url?.startsWith('https://') && e.observedAt === '2026-10-15T11:00:00.000Z'));
});

t('EAN de uma só loja: confiança baixa e ambiguidade declarada', () => {
  const s = state(); s.offers = s.offers.filter((o) => o.id !== 'b1');
  const p = of(report(s), 'ean_observado').find((x) => x.subject.product === 'me04-box36');
  assert.ok(p.confidence < 50); assert.match(p.ambiguity.join(), /uma única loja/);
});

t('mesmo EAN em produtos diferentes é conflito; não vira cadastro', () => {
  const r = report();
  const c = of(r, 'ean_em_produtos_diferentes').find((x) => x.subject.ean === '196214156036');
  assert.deepEqual(c.subject.products, ['me04-etb', 'me05-etb']); assert.equal(c.confidence, 0); assert.equal(c.suggestion, null);
  for (const pid of ['me04-etb', 'me05-etb']) {
    const p = of(r, 'ean_observado').find((x) => x.subject.product === pid);
    assert.ok(p.confidence <= 10 && p.ambiguity.some((a) => /outros produtos/.test(a)), pid);
  }
});

t('EAN do anúncio diferente do catálogo: conflito sem sugestão', () => {
  const c = of(report(), 'ean_divergente').find((x) => x.subject.product === 'me05-box36');
  assert.equal(c.suggestion, null); assert.equal(c.confidence, 0); assert.match(c.ambiguity[0], /196214156999/);
});

t('título com contagem explícita diferente da do produto é sinalizado (inferida não conta)', () => {
  const [c] = of(report(), 'contagem_divergente');
  assert.equal(c.subject.product, 'me04-box36'); assert.deepEqual(c.subject.offers, ['e1']);
  const s = state(); s.offers.find((o) => o.id === 'e1').title = 'Box Display Caos Ascendente'; // display = 36 inferido
  assert.equal(of(report(s), 'contagem_divergente').length, 0);
});

t('oferta duplicada (URL canônica igual, rastreio removido) e mesma URL em produtos diferentes', () => {
  const r = report();
  const [d] = of(r, 'oferta_duplicada'); assert.deepEqual(d.subject.offers, ['f1', 'f2']);
  const [u] = of(r, 'url_em_produtos_diferentes'); assert.deepEqual(u.subject.products, ['me04-etb', 'me05-etb']); assert.equal(u.suggestion, null);
});

t('matching: reaproveita reviewCandidates com contrato de evidência', () => {
  const [m] = of(report(), 'revisao_matching');
  assert.equal(m.subject.kind, 'tipo_desconhecido');
  assert.equal(m.evidence[0].source, 'state.unmatched'); assert.equal(m.evidence[0].basis, 'observado');
  assert.equal(of(report(state(), { matchingLimit: 0 }), 'revisao_matching').length, 0);
});

t('sem asOf nem generatedAt: recusa (não usa o relógio)', () => {
  const s = state(); delete s.generatedAt;
  assert.throws(() => catalogReport({ state: s, catalog }), /asOf ausente/);
});

t('pré-requisitos: golden sintético verde = parcial; falha = não atendido; ausente = não verificável', () => {
  const golden = runGolden(JSON.parse(fs.readFileSync(new URL('./golden/cases.json', import.meta.url), 'utf8')));
  const st = (g) => catalogPrerequisites({ golden: g }).find((p) => p.id === 'golden_matching').status;
  assert.equal(st(golden), golden.failures.length ? 'nao_atendido' : 'parcial');
  assert.equal(st({ ...golden, failures: [{ id: 'x' }] }), 'nao_atendido');
  assert.equal(st(null), 'nao_verificavel');
  assert.equal(catalogPrerequisites().find((p) => p.id === 'autorizacao_ia').status, 'nao_atendido');
});

t('Markdown: diz que é só proposta e lista pré-requisitos e conflitos', () => {
  const md = catalogMarkdown(report());
  assert.match(md, /somente proposta/); assert.match(md, /## Pré-requisitos/);
  assert.match(md, /Mesmo EAN em produtos diferentes/); assert.match(md, /Possível produto duplicado/);
  assert.doesNotMatch(md, /\n\| [^|]*\n[^|]/, 'tabela quebrada');
});

t('módulo é puro: sem fs, rede, banco ou escrita', () => {
  const src = fs.readFileSync(new URL('../src/agents/catalog-agent.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /from 'node:(fs|http|https|net|child_process)'|from '\.\.\/db|pg\.js|fetch\(|writeFile|INSERT|UPDATE |DELETE /);
  const cli = fs.readFileSync(new URL('../tools/agente-catalogo.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(cli, /DATABASE_URL|pg\.js|fetch\(|catalog\.json', *JSON|writeFileSync\([^)]*catalog/);
});

console.log(`OK — catalog agent: ${n} testes`);

// Workflow opcional: manual, só leitura, sem secrets e desligado por variável.
{
  const y = fs.readFileSync(new URL('../.github/workflows/agente-catalogo.yml', import.meta.url), 'utf8');
  const code = y.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
  assert.match(code, /^on:\n  workflow_dispatch:\n(?!\s+\w)/m, 'só workflow_dispatch');
  assert.doesNotMatch(code, /schedule:|push:|pull_request|workflow_run|issues:/);
  assert.match(code, /^permissions:\n  contents: read\nconcurrency:/m, 'permissão mínima');
  assert.doesNotMatch(code, /secrets\.|DATABASE_URL|write|GH_TOKEN|github\.token/);
  assert.match(code, /if: vars\.AGENTE_CATALOGO == 'true'/);
  assert.match(code, /node tools\/agente-catalogo\.mjs rel >> "\$GITHUB_STEP_SUMMARY"/);
  console.log('OK — workflow do catalog agent: manual, só leitura, desligado por padrão');
}
