// T5-C parte E (25/10/2026): "Charizard ex Brilhante" sem coleção no título não fica sem produto.
// Associação anterior (base, origin/main c0b6bf44): avulsos-colecao_ex-charizard, junto da "Charizard ex em Dobro" (outra caixa).
// v2 (63fb80c4): sem produto. Nova: sv4_5-colecao_ex-charizard. Evidência (ramo data, 3.285 títulos): os 7 títulos com coleção e
// "Charizard ex Brilhante" estão todos em sv4_5-colecao_ex-charizard (Destinos de Paldea); os demais de avulsos-colecao_ex-charizard
// são "em Dobro". Preço do anúncio real (tiocharles, R$ 249,90) dentro da faixa do sv4_5 (R$ 159,99–499,90).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { matchProduct, variantesDe } from '../src/match.js';
import { linkAgrees } from '../src/gate.js';

const base = JSON.parse(fs.readFileSync(new URL('../config/catalog.json', import.meta.url), 'utf8'));
base.products ||= []; base.copag ||= {};
base.refs = JSON.parse(fs.readFileSync(new URL('../config/refs-copag.json', import.meta.url), 'utf8'))?.refs || {};
const IDS = ['sv4_5-colecao_ex-charizard', 'sv9-colecao_ex-charizard', 'avulsos-colecao_ex-charizard', 'sv4_5-colecao_ex-ferreo', 'sv4_5-colecao_ex-grande'];
const catalog = { ...base, variantes: variantesDe(IDS) };
const m = (title, url) => matchProduct({ title, url }, catalog);
const id = (title) => m(title).productId;
let n = 0; const t = (name, fn) => { fn(); n++; };

const REAL = ['Pokémon Box Coleção Charizard ex Brilhante', 'https://tiocharles.com.br/produtos/pokemon-box-colecao-charizard-ex-brilhante/'];
const ANTERIOR = 'avulsos-colecao_ex-charizard';
const NOVA = 'sv4_5-colecao_ex-charizard';

t('E1. associação anterior × nova do anúncio real', () => {
  const r = m(...REAL);
  assert.notEqual(r.productId, null, 'não pode ficar sem produto (v2)');
  assert.notEqual(r.productId, ANTERIOR, 'não volta para a caixa "em Dobro" (base)');
  assert.equal(r.productId, NOVA);
  assert.equal(linkAgrees({ title: REAL[0], url: REAL[1] }, r, catalog).ok, true);
  assert.ok(r.confidence < 0.75, 'sem coleção no título: abaixo do limiar de alerta, como a variante conhecida');
});

t('E2. preservados: "em Dobro" no avulso de sempre, títulos com coleção, irmãs Brilhante', () => {
  for (const [title, esperado] of Object.entries({
    'Pokémon Box Coleção Charizard ex Em Dobro': ANTERIOR, // real
    'Pokémon TCG - Box Charizard Ex em Dobro': ANTERIOR, // real
    'Carta Pokemon Box Charizard EX - Copag': ANTERIOR, // real, sem "Brilhante": fica como está
    'Box Pokémon Destinos de Paldea Charizard Ex Brilhante': NOVA, // real
    'Pokémon EV4.5 Box Charizard Ex Brilhante - Copag': NOVA, // real
    'BOX POKÉMON COLEÇÃO CHARIZARD EX EM DOBRO COPAG 64 CARTAS TCG BOOSTER CHARMANDER CHARMELEON EV9 JOGO': 'sv9-colecao_ex-charizard', // real
    'Box Pokémon Trilho Férreo ex Brilhante': 'sv4_5-colecao_ex-ferreo', // base já ia (variante conhecida); v2 deixava sem produto
    'Box Pokémon Presa Grande ex Brilhante': 'sv4_5-colecao_ex-grande',
  })) assert.equal(id(title), esperado, title);
});

t('E3. outro "ex Brilhante" sem coleção nem caixa conhecida em sv4_5: sem produto (não junta com avulso de outra caixa)', () => {
  assert.equal(id('Box Pokémon Pikachu ex Brilhante'), null);
});

console.log(`matching-v3-charizard-brilhante-tests: ok (${n} grupos)`);
