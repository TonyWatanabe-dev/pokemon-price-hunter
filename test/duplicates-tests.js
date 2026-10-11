// Candidatos a produto duplicado (Issue #102): evidências, score, ambiguidade e falsos candidatos. Testes puros.
import assert from 'node:assert/strict';
import { duplicateCandidates, duplicateReviewItems, scorePair, AMBIGUOUS_CAP } from '../src/core/duplicates.js';

let n = 0; const t = (name, fn) => { fn(); n++; };
const collections = [{ id: 'sv9', name: 'Heróis Excepcionais' }, { id: 'ev09', name: 'Heróis Excepcionais' }, { id: 'me04', name: 'Caos Ascendente' }, { id: 'me05', name: 'Outra Coleção' }];
const P = (id, collection, type, boosters, x = {}) => ({ id, collection, type, boosters, ...x });
const run = (products) => duplicateCandidates(products, { collections });

t('coleção legada com mesmo nome, tipo e boosters vira candidato com evidências', () => {
  const [c] = run([P('sv9-etb', 'sv9', 'etb', null), P('ev09-etb', 'ev09', 'etb', null)]);
  assert.ok(c.score >= 60); assert.equal(c.decision, 'needs_review'); assert.equal(c.autoMerge, false); assert.equal(c.ambiguous, false);
  assert.ok(c.evidence.some((e) => e.code === 'COLECAO_MESMO_NOME_CODIGO_DIFERENTE'));
});

t('mesma coleção e mesmo produto com ids diferentes é candidato forte', () => {
  const [c] = run([P('me04-box36', 'me04', 'booster_box', 36, { ean: '0196214156098' }), P('me04-box36-b', 'me04', 'booster_box', 36, { ean: '196214156098' })]);
  assert.equal(c.score, 100); assert.ok(c.evidence.some((e) => e.code === 'MESMO_EAN'));
});

t('falsos candidatos: coleção, tipo, boosters, variante e idioma diferentes não geram candidato', () => {
  assert.deepEqual(run([P('me04-etb', 'me04', 'etb', null), P('me05-etb', 'me05', 'etb', null)]), []);
  assert.deepEqual(run([P('me04-etb', 'me04', 'etb', null), P('me04-booster', 'me04', 'booster_pack', null)]), []);
  assert.deepEqual(run([P('me04-box36', 'me04', 'booster_box', 36), P('me04-box18', 'me04', 'booster_box', 18)]), []);
  assert.deepEqual(run([P('me04-combo-a', 'me04', 'combo', 6, { variant: 'sylveon' }), P('me04-combo-b', 'me04', 'combo', 6, { variant: 'greninja' })]), []);
  assert.deepEqual(run([P('me04-etb', 'me04', 'etb', null), P('me04-etb-jp', 'me04', 'etb', null, { name: 'ETB Japonês' })]), []);
});

t('EAN igual com coleção ou tipo diferentes é conflito de cadastro: ambíguo, score limitado, nunca automático', () => {
  const [c] = run([P('me04-etb', 'me04', 'etb', null, { ean: '123' }), P('me05-etb', 'me05', 'etb', null, { ean: '123' })]);
  assert.equal(c.ambiguous, true); assert.ok(c.score <= AMBIGUOUS_CAP); assert.equal(c.autoMerge, false);
  assert.ok(c.blockers.some((b) => b.startsWith('coleção diferente')));
});

t('EANs diferentes no mesmo produto reduzem o score e marcam ambiguidade', () => {
  const [c] = run([P('a', 'me04', 'etb', null, { ean: '111' }), P('b', 'me04', 'etb', null, { ean: '222', name: 'x' })]);
  assert.ok(c); assert.equal(c.ambiguous, true); assert.ok(c.evidence.some((e) => e.code === 'EAN_DIVERGENTE'));
});

t('produto em mais de um candidato é ambíguo', () => {
  const r = run([P('sv9-etb', 'sv9', 'etb', null), P('ev09-etb', 'ev09', 'etb', null), P('sv9-etb-2', 'sv9', 'etb', null)]);
  assert.equal(r.length, 3); assert.ok(r.every((c) => c.ambiguous && c.score <= AMBIGUOUS_CAP && c.autoMerge === false));
});

t('só o nome igual não basta', () => {
  assert.equal(scorePair(P('a', 'me04', 'etb', null, { name: 'x' }), P('b', 'me05', 'etb', null, { name: 'x' })), null);
});

t('itens de revisão: categoria, chave estável sem depender da ordem e motivo legível', () => {
  const ab = duplicateReviewItems(run([P('sv9-etb', 'sv9', 'etb', null), P('ev09-etb', 'ev09', 'etb', null)]));
  const ba = duplicateReviewItems(run([P('ev09-etb', 'ev09', 'etb', null), P('sv9-etb', 'sv9', 'etb', null)]));
  assert.equal(ab.length, 1); assert.equal(ab[0].category, 'duplicate_product'); assert.equal(ab[0].dedupeKey, ba[0].dedupeKey);
  assert.equal(ab[0].proposal.autoMerge, false); assert.match(ab[0].proposal.reason, /COLECAO_MESMO_NOME_CODIGO_DIFERENTE/);
});

console.log(`duplicates-tests: ${n} ok`);
