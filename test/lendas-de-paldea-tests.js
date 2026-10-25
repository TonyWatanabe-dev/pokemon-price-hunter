// "Lendas de Paldea" × "Lendas Implacáveis" (ramo data 345ff5f0 / 89279c7e, 25/10/2026), títulos e links reais.
// A caixa "Lendas de Paldea" Koraidon ex (Copag, 2023) caía em sv10-colecao_ex-koraidon, o produto da "Lendas Implacáveis"
// (35239), porque catalog.variantes ("colecao_ex|koraidon" → sv10) vale para qualquer título sem coleção. Agora a linha
// Paldea não herda a coleção conhecida e fica no avulso com a variante de sempre. Sem id novo de variante: o Miraidon
// Paldea continua em avulsos-colecao_ex-miraidon (com o histórico que já tem) e nada da Implacáveis muda.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { matchProduct, variantesDe } from '../src/match.js';
import { linkAgrees } from '../src/gate.js';

const base = JSON.parse(fs.readFileSync(new URL('../config/catalog.json', import.meta.url), 'utf8'));
base.products ||= []; base.copag ||= {};
base.refs = JSON.parse(fs.readFileSync(new URL('../config/refs-copag.json', import.meta.url), 'utf8'))?.refs || {};
// Ids reais do catálogo automático (data/products.json de 25/10) que decidem a variante conhecida destes títulos.
const IDS = ['sv10-colecao_ex-koraidon', 'avulsos-colecao_ex-miraidon', 'avulsos-deck-miraidon', 'sv6_5-deck-miraidon', 'sv8-deck-koraidon',
  'sv8-deck-miraidon', 'sv9-colecao_ex-zacian', 'sv4_5-colecao_ex-quaquaval', 'sv4_5-colecao_ex-skeledirge', 'sv4_5-colecao_ex-charizard'];
const catalog = { ...base, variantes: variantesDe(IDS) };
const m = (title, url, c = catalog) => matchProduct({ title, url }, c);
const id = (title, url, c) => m(title, url, c).productId;
let n = 0; const t = (name, fn) => { fn(); n++; };

const PALDEA_KORAIDON = [
  ['Pokémon Box Lendas de Paldea - KORAIDON EX', 'https://www.tavolageek.com.br/pokemon-box-lendas-de-paldea-koraidon-ex'],
  ['Box Pokémon Lendas De Paldea Koraidon Ex Copag', 'https://www.theoriginals.com.br/box-pokemon-lendas-de-paldea-koraidon-ex-copag'],
  ['Pokémon TCG - Coleção Lendas de Paldea: Koraidon Ex', 'https://www.dalaran.com.br/pokemon-tcg-colecao-lendas-de-paldea-koraidon-ex'],
];
const PALDEA_MIRAIDON = [
  ['Box Pokémon Lendas de Paldea - Miraidon EX - 33017 Copag', 'https://www.realbrinquedos.com.br/box-pokemon-lendas-de-paldea-miraidon-ex-33017-copag'],
  ['Box Pokémon Lendas De Paldea Miraidon Ex Copag', 'https://www.theoriginals.com.br/box-pokemon-lendas-de-paldea-miraidon-ex-copag'],
];
const IMPLACAVEIS = {
  'Box Pokémon Lendas Implacáveis Koraidon': 'sv10-colecao_ex-koraidon',
  'Baralho Box Pokémon Lendas Implacáveis Koraidon': 'sv10-colecao_ex-koraidon',
  'POKEMON BOX LENDAS IMPLACAVEIS KORAIDON EX | Pokemon | Paladins Games Store': 'sv10-colecao_ex-koraidon',
  'Pokémon TCG – Box Coleção Lendas Implacáveis: Koraidon EX (PT-BR) | 6 Boosters + Promo + Jumbo': 'sv10-colecao_ex-koraidon',
  'Pokémon Box Coleção EX Lendas Implacáveis Koraidon 38 Cartas 100-10392 35239 - Copag': 'sv10-colecao_ex-koraidon',
  'Box Coleção - Lendas Implacáveis Koraidon EX (Pokémon TCG)': 'sv10-colecao_ex-koraidon',
  'Pokémon TCG - Coleção Lendas Implacáveis - Koraidon Ex': 'sv10-colecao_ex-koraidon',
  'Pokemon Box - Coleção Ex Lendas Implacáveis - Koraidon': 'sv10-colecao_ex-koraidon',
  'Pokemon Box - Lendas Implac?veis - Koraidon Ex': 'sv10-colecao_ex-koraidon',
  // 25/10/2026 (T4-C): as 4 Zacian esperavam sv9-colecao_ex-zacian, o produto da "Zacian ex do Lupo" (35263) — fixavam a
  // colisão H1. A Zacian Implacáveis (35239) fica no avulso; só o Koraidon da linha herda a coleção conhecida.
  'Box Pokémon Lendas Implacáveis Zacian': 'avulsos-colecao_ex-zacian',
  'Pokemon Box - Coleção Ex Lendas Implacáveis - Zacian': 'avulsos-colecao_ex-zacian',
  'Pokémon TCG – Box Coleção Lendas Implacáveis: Zacian EX (PT-BR) | 6 Boosters + Promo + Jumbo': 'avulsos-colecao_ex-zacian',
  'Pokémon Box Coleção EX Lendas Implacáveis Zacian 38 Cartas 100-10392 35239 - Copag': 'avulsos-colecao_ex-zacian',
};

t('(a) Lendas de Paldea Koraidon não cai mais em sv10 (produto da Lendas Implacáveis)', () => {
  for (const [title, url] of PALDEA_KORAIDON) {
    const r = m(title, url);
    assert.notEqual(r.productId, 'sv10-colecao_ex-koraidon', title);
    assert.equal(r.productId, 'avulsos-colecao_ex-koraidon', title);
    assert.equal(r.via, 'avulso', title);
    assert.equal(linkAgrees({ title, url }, r, catalog).ok, true, url);
  }
});

t('(b) Lendas de Paldea Miraidon mantém o id atual (avulsos-colecao_ex-miraidon)', () => {
  for (const [title, url] of PALDEA_MIRAIDON) {
    const r = m(title, url);
    assert.equal(r.productId, 'avulsos-colecao_ex-miraidon', title);
    assert.equal(linkAgrees({ title, url }, r, catalog).ok, true, url);
  }
  // e continua nele mesmo se um dia surgir outra caixa Miraidon ex numa coleção (a Paldea não herda a coleção de outra caixa)
  const futuro = { ...base, variantes: variantesDe([...IDS, 'sv10-colecao_ex-miraidon']) };
  for (const [title, url] of PALDEA_MIRAIDON) assert.equal(id(title, url, futuro), 'avulsos-colecao_ex-miraidon', title);
});

t('(b) outros casamentos válidos com Koraidon/Miraidon/Paldea não mudam', () => {
  const casos = {
    // variante conhecida continua valendo para título sem linha "Lendas de Paldea"
    'Box Pokémon Koraidon ex': 'sv10-colecao_ex-koraidon',
    'Box Pokémon Batalha De Liga Pokémon Miraidon Ex - 33598 - Copag': 'avulsos-deck-miraidon',
    // outras linhas "de Paldea" leem a coleção pelo título (sv4_5 / sv2) ou a variante conhecida
    'Box Pokémon Destinos de Paldea Charizard Ex Brilhante': 'sv4_5-colecao_ex-charizard',
    'Box Pokémon Parceiros De Paldea Quaquaval EX Copag': 'sv4_5-colecao_ex-quaquaval',
    'Box Pokémon Parceiros De Paldea Skeledirge EX Copag': 'sv4_5-colecao_ex-skeledirge',
    'Treinador Avançado Pokémon Destinos de Paldea': 'sv4_5-etb',
    'Pokémon EV2 Booster Evoluções em Paldea - Copag': 'sv2-booster',
  };
  for (const [title, esperado] of Object.entries(casos)) assert.equal(id(title), esperado, title);
});

t('(c) Lendas Implacáveis Koraidon continua em sv10; Zacian no avulso (sv9 é o Lupo)', () => {
  for (const [title, esperado] of Object.entries(IMPLACAVEIS)) {
    const r = m(title);
    assert.equal(r.productId, esperado, title);
    assert.equal(r.via, esperado.startsWith('avulsos-') ? 'avulso' : 'variante-conhecida', title);
  }
});

t('sem catálogo automático, Paldea e Implacáveis ficam no avulso como antes', () => {
  assert.equal(id(PALDEA_KORAIDON[0][0], PALDEA_KORAIDON[0][1], base), 'avulsos-colecao_ex-koraidon');
  assert.equal(id('Box Pokémon Lendas Implacáveis Koraidon', undefined, base), 'avulsos-colecao_ex-koraidon');
});

console.log(`lendas-de-paldea-tests: ok (${n} grupos)`);
