// Falsos positivos reais do matching de selados (issue #42, tabela da PR #166): lote/kit de várias
// unidades, bundle, dois produtos no mesmo anúncio, caixa vazia e fichário avulso NÃO podem casar com a
// unidade do catálogo. Princípio do src/match.js: na dúvida, NÃO casa. Importado por test/ml-tests.js.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { matchProduct } from '../src/match.js';

const catalog = JSON.parse(fs.readFileSync(new URL('../config/catalog.json', import.meta.url), 'utf8'));
let n = 0;
const test = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const m = (title) => matchProduct({ title }, catalog);
const casa = (title, id) => {
  const r = m(title);
  assert.equal(r.productId, id, `${title} -> ${JSON.stringify(r.why)}`);
  assert.deepEqual(r.why, [], title);
  assert.ok(r.confidence > 0, title);
};
const recusa = (title, motivo) => {
  const r = m(title);
  assert.equal(r.productId, null, `${title} casou com ${r.productId}`);
  assert.equal(r.confidence, 0, title);
  assert.ok(r.why.some((w) => motivo.test(w)), `${title}: motivo ${JSON.stringify(r.why)} não bate com ${motivo}`);
};

test('lote de N unidades, "N Box", "Kit N" e bundle não casam com a unidade', () => {
  recusa('Pokémon TCG Booster Fogo Fantasmagórico 10 unidades', /várias unidades/); // era me02-booster
  recusa('Pokémon TCG Booster Fogo Fantasmagórico 3 unidades', /várias unidades/); // era me02-booster
  recusa('Pokémon TCG Booster Bundle Fogo Fantasmagórico 6 boosters', /várias unidades/); // era me02-booster
  recusa('Kit 3 Blister Triplo Fogo Fantasmagórico Pokémon', /várias unidades/); // era me02-blister3
  recusa('2 Box Treinador Avançado Fogo Fantasmagórico Pokémon', /várias unidades/); // era me02-etb
  recusa('Pokémon TCG Box Treinador Avançado Fogo Fantasmagórico 2 unidades', /várias unidades/); // era me02-etb
  recusa('Pokémon TCG Box Treinador Avançado Fogo Fantasmagórico Kit 2', /várias unidades/); // era me02-etb
  recusa('Pokémon TCG Booster Box Fogo Fantasmagórico 36 Boosters 2 unidades', /várias unidades/); // era me02-box36
});

test('dois produtos no mesmo anúncio ("+ Box ...") não casam', () => {
  recusa('Pokémon TCG Booster Box Fogo Fantasmagórico 36 Boosters + Box Treinador Avançado', /mais de um produto/); // era me02-etb
});

test('caixa vazia e fichário avulso não viram o produto lacrado', () => {
  recusa('Pokémon TCG Box Treinador Avançado Vazio Fogo Fantasmagórico', /acessório ou item não-TCG/); // era me02-etb
  recusa('Pasta Fichário Pokémon Fogo Fantasmagórico', /acessório ou item não-TCG/); // era me02-colecao_fichario
});

test('controles positivos continuam casando', () => {
  casa('Pokémon TCG Booster Fogo Fantasmagórico', 'me02-booster');
  casa('Pokémon TCG Box Treinador Avançado Fogo Fantasmagórico', 'me02-etb');
  casa('Pokémon TCG Blister Triplo Fogo Fantasmagórico', 'me02-blister3');
  casa('Pokémon TCG Booster Box Fogo Fantasmagórico 36 Boosters', 'me02-box36');
  casa('Pokémon TCG Combo Fogo Fantasmagórico 6 Boosters', 'me02-combo6');
  casa('Pokémon TCG Coleção com Fichário Fogo Fantasmagórico', 'me02-colecao_fichario');
  casa('Pokémon TCG Box Coleção Premium Fogo Fantasmagórico', 'me02-colecao_premium');
  // "1 unidade" é a própria unidade; "Treinador Avançado com 9 boosters" é o conteúdo do ETB.
  casa('Pokémon TCG Box Treinador Avançado Fogo Fantasmagórico 1 unidade', 'me02-etb');
  casa('Pokémon TCG Box Treinador Avançado Fogo Fantasmagórico com 9 Boosters', 'me02-etb');
});

// Regressão da PR #168 (C5 da Fase 3, issue #177): títulos reais que casavam na linha de base e são o produto do catálogo.
test('"Bundle (18 Boosters)" é o próprio combo, não lote', () => {
  casa('Combo de Booster / Bundle (18 Boosters) Pokémon Megaevolução — Escuridão Absoluta (ME05)', 'me05-combo18'); // geekstorebrasil
  casa('Combo de Booster / Bundle (18 Boosters) Pokémon Megaevolução — Caos Ascendente (ME04)', 'me04-combo18'); // geekstorebrasil
  casa('Combo de Booster / Bundle (18 Boosters) Pokémon Megaevolução – Heróis Excelsos (ME02.5)', 'me02_5-combo18'); // geekstorebrasil
  // Sem contagem explícita de boosters no combo, "bundle" segue como lote.
  recusa('Pokémon TCG Combo Bundle Fogo Fantasmagórico', /várias unidades/);
});

test('"Box + Fichário" e "Box + Poster" são a coleção com o acessório, não dois produtos', () => {
  casa('Pokémon TCG Box + Fichário Celebração 30 Anos Copag 37139', 'c30-colecao_fichario'); // pbkids / rihappy
  casa('Pokémon TCG Box Celebração 30 Anos + Poster Copag 21 Cartas', 'c30-colecao_poster'); // pbkids / rihappy
  // O acessório depois do "+" só é parte do produto quando o título inteiro é essa coleção.
  recusa('Pokémon TCG Booster Box Fogo Fantasmagórico 36 Boosters + Fichário', /mais de um produto/);
  recusa('Pokémon TCG Box Treinador Avançado Fogo Fantasmagórico + Poster', /mais de um produto/);
  recusa('Pokémon TCG Coleção com Fichário Fogo Fantasmagórico + Box Treinador Avançado', /mais de um produto/);
});

// "BOOSTER 36 PACOTES" é display de 36, não o booster unitário que casava na linha de base: recusa correta da #168.
test('booster com 36 pacotes continua recusado como booster unitário', () => {
  recusa('POKEMON TCG ME05 ESCURIDAO ABSOLUTA BOOSTER 36 PACOTES - COPAG', /várias unidades/);
});

console.log(`✓ Falsos positivos de selados: ${n} grupos de testes passaram`);
