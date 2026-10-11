// Regressão do matching de produtos selados (issue #42): ETB, booster box, blister, combo, coleção,
// variante, idioma e quantidade de boosters. Princípio do src/match.js: na dúvida, NÃO casa.
// Só testes: nenhum caso aqui muda lógica. Importado por test/review-tests.js (roda no npm test).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { matchProduct } from '../src/match.js';

const catalog = JSON.parse(fs.readFileSync(new URL('../config/catalog.json', import.meta.url), 'utf8'));
let n = 0;
const test = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const m = (title, ean) => matchProduct(ean ? { title, ean } : { title }, catalog);
/** Casa exatamente com o produto esperado. */
const casa = (title, id) => {
  const r = m(title);
  assert.equal(r.productId, id, `${title} -> ${JSON.stringify(r.why)}`);
  assert.deepEqual(r.why, [], title);
  assert.ok(r.confidence > 0, title);
  return r;
};
/** Recusa (sem produto, confiança 0) e o motivo cita o esperado. */
const recusa = (title, motivo) => {
  const r = m(title);
  assert.equal(r.productId, null, `${title} casou com ${r.productId}`);
  assert.equal(r.confidence, 0, title);
  assert.ok(r.why.some((w) => motivo.test(w)), `${title}: motivo ${JSON.stringify(r.why)} não bate com ${motivo}`);
  return r;
};

test('tipos parecidos da mesma coleção viram produtos distintos (ETB x booster box x blister x combo x coleção)', () => {
  const ids = [
    casa('Pokémon TCG Box Treinador Avançado Fogo Fantasmagórico', 'me02-etb'),
    casa('Pokémon TCG Elite Trainer Box Fogo Fantasmagórico', 'me02-etb'),
    casa('Pokémon TCG Booster Box Fogo Fantasmagórico 36 Boosters', 'me02-box36'),
    casa('Pokémon TCG Booster Fogo Fantasmagórico', 'me02-booster'),
    casa('Pokémon TCG Blister Unitário Fogo Fantasmagórico', 'me02-blister1'),
    casa('Pokémon TCG Blister Duplo Fogo Fantasmagórico', 'me02-blister2'),
    casa('Pokémon TCG Blister Triplo Fogo Fantasmagórico', 'me02-blister3'),
    casa('Pokémon TCG Blister Quádruplo Fogo Fantasmagórico', 'me02-blister4'),
    casa('Pokémon TCG Combo Fogo Fantasmagórico 6 Boosters', 'me02-combo6'),
    casa('Pokémon TCG Coleção com Fichário Fogo Fantasmagórico', 'me02-colecao_fichario'),
    casa('Pokémon TCG Coleção com Pôster Fogo Fantasmagórico', 'me02-colecao_poster'),
    casa('Pokémon TCG Coleção com Miniatura Fogo Fantasmagórico', 'me02-colecao_miniatura'),
    casa('Pokémon TCG Box Coleção Premium Fogo Fantasmagórico', 'me02-colecao_premium'),
    casa('Pokémon TCG Lata Fogo Fantasmagórico', 'me02-lata'),
    casa('Pokémon TCG Minilata Fogo Fantasmagórico', 'me02-minilata'),
    casa('Pokémon TCG Baralho de Batalha Fogo Fantasmagórico', 'me02-deck'),
  ].map((r) => r.productId);
  // ETB e Elite Trainer Box são o mesmo produto; todo o resto é distinto
  assert.equal(new Set(ids).size, ids.length - 1);
});

test('quantidade de boosters separa produtos e, sem contagem, booster box não casa', () => {
  casa('Pokémon TCG Booster Box Fogo Fantasmagórico 18 Boosters', 'me02-box18');
  casa('Pokémon TCG Booster Box Fogo Fantasmagórico 36 Boosters', 'me02-box36');
  casa('Pokémon TCG Booster Box 24 boosters Fogo Fantasmagórico', 'me02-box24');
  casa('Pokémon TCG Caixa de Booster Caos Ascendente 36 Pacotes', 'me04-box36');
  assert.notEqual(m('Pokémon TCG Booster Box Fogo Fantasmagórico 18 Boosters').productId, m('Pokémon TCG Booster Box Fogo Fantasmagórico 36 Boosters').productId);
  recusa('Pokémon TCG Booster Box Fogo Fantasmagórico', /quantidade de boosters não informada/);
  recusa('Pokémon TCG Mini Booster Box Fogo Fantasmagórico', /quantidade de boosters não informada/);
  // contagem inferida (Display = 36, 144 cartas = 24) casa com confiança menor que a explícita
  const explicita = m('Pokémon TCG Booster Box Fogo Fantasmagórico 36 Boosters').confidence;
  const display = casa('Pokémon TCG Box Display Fogo Fantasmagórico', 'me02-box36');
  assert.ok(display.confidence < explicita && display.parsed.boostersInferred);
  const cartas = casa('Pokémon TCG 144 cartas box Fogo Fantasmagórico', 'me02-box24');
  assert.ok(cartas.confidence < explicita && cartas.parsed.boostersInferred);
  // combo com e sem contagem não se confundem
  assert.notEqual(m('Pokémon TCG Combo Fogo Fantasmagórico').productId, m('Pokémon TCG Combo Fogo Fantasmagórico 6 Boosters').productId);
});

test('idioma diferente de PT nunca casa, nem com EAN cadastrado', () => {
  for (const t of [
    'Pokémon TCG Elite Trainer Box Fogo Fantasmagórico Inglês',
    'Pokémon TCG Elite Trainer Box Fogo Fantasmagórico (EN)',
    'Pokémon TCG Booster Box Caos Ascendente 36 Boosters English',
    'Pokémon TCG Booster Box Caos Ascendente 36 Boosters Japonês',
    'Pokémon TCG Booster Box Fogo Fantasmagórico Japonesa 30 Boosters',
    'Pokémon TCG Booster Box Fogo Fantasmagórico 36 Boosters Inglês Português', // conflito: na dúvida, não casa
  ]) recusa(t, /idioma diferente de PT/);
  const ean = m('Pokémon TCG Booster Box Caos Ascendente 36 Boosters Inglês', '196214156098');
  assert.equal(ean.productId, null); assert.ok(ean.why.includes('idioma diferente de PT'));
  casa('Pokémon TCG Booster Box Fogo Fantasmagórico 36 Boosters Português', 'me02-box36');
});

test('coleção: diferente vira outro produto; duas coleções no título não casam', () => {
  assert.notEqual(m('Pokémon TCG Box Treinador Avançado Fogo Fantasmagórico').productId, m('Pokémon TCG Box Treinador Avançado Caos Ascendente').productId);
  casa('Pokémon TCG Box Treinador Avançado Caos Ascendente', 'me04-etb');
  recusa('Pokémon TCG Box Treinador Avançado Fogo Fantasmagórico e Caos Ascendente', /mais de uma coleção no título: me02, me04/);
  // produto conjunto só quando o título cita exatamente as coleções combinadas
  casa('Pokémon TCG Box Treinador Avançado Fogo Branco e Raio Preto', 'sv10_5-etb');
  casa('Pokémon TCG Box Treinador Avançado Fogo Branco', 'sv10_5w-etb');
  // alias genérico (fallback) casa, mas com confiança menor
  const fb = casa('Pokémon TCG Treinador Avançado Megaevolução', 'me01-etb');
  assert.ok(fb.parsed.collectionFallback && fb.confidence < m('Pokémon TCG Box Treinador Avançado Caos Ascendente').confidence);
  recusa('Pokémon TCG Box Treinador Avançado', /coleção não identificada/);
});

test('variante: Pokémon ex diferentes são produtos diferentes; "X ou Y" não casa', () => {
  const a = casa('Pokémon TCG Box Coleção Sylveon ex Fogo Fantasmagórico', 'me02-colecao_ex-sylveon');
  const b = casa('Pokémon TCG Box Coleção Greninja ex Fogo Fantasmagórico', 'me02-colecao_ex-greninja');
  assert.notEqual(a.productId, b.productId);
  recusa('Pokémon TCG Box Coleção Zapdos ex ou Alakazam ex Fogo Fantasmagórico', /tipo de produto não identificado/);
  // coleção genérica com nome que a diferencia (Dia de Pokémon) não vira a "Box Coleção" genérica
  casa('Pokémon TCG Box Coleção Fogo Fantasmagórico', 'me02-colecao');
  recusa('Pokémon TCG Box Coleção Dia de Pokémon Fogo Fantasmagórico', /tipo de produto não identificado/);
});

test('acessórios e itens com nome de coleção não viram o produto lacrado', () => {
  recusa('Sleeves Pokémon Fogo Fantasmagórico 65 unidades', /acessório ou item não-TCG/);
  recusa('Playmat Pokémon Caos Ascendente', /acessório ou item não-TCG/);
  recusa('Caixa vazia Treinador Avançado Fogo Fantasmagórico Pokémon', /acessório ou item não-TCG/);
  recusa('Dados Treinador Avançado Fogo Fantasmagórico', /acessório avulso/);
});

test('usado, aberto ou avariado não casa', () => {
  recusa('Pokémon TCG Box Treinador Avançado Fogo Fantasmagórico Usado', /não lacrado/);
  recusa('Pokémon TCG Box Treinador Avançado Fogo Fantasmagórico Sem Lacre', /não lacrado/);
  recusa('Pokémon TCG Box Treinador Avançado Fogo Fantasmagórico Caixa Amassada', /não lacrado/);
});

test('case, várias unidades e kit montado pela loja não casam com a unidade do catálogo', () => {
  recusa('Pokémon TCG Case Booster Box Caos Ascendente 6 unidades', /várias unidades/);
  recusa('Pokémon TCG 6x Booster Box Caos Ascendente', /várias unidades/);
  recusa('Kit Fichário + 6 Boosters Fogo Fantasmagórico Pokémon', /kit montado/);
});

test('EAN: cadastrado vence o título; divergente bloqueia', () => {
  const ok = m('Pokémon TCG Booster Box Caos Ascendente 36 Boosters', '0196214156098');
  assert.equal(ok.productId, 'me04-box36'); assert.equal(ok.confidence, 0.99);
  const div = m('Pokémon TCG Booster Box Caos Ascendente 36 Boosters', '7896192300000');
  assert.equal(div.productId, null); assert.deepEqual(div.why, ['EAN diverge do catálogo']);
});

console.log(`✓ Matching de selados: ${n} grupos de testes passaram`);
