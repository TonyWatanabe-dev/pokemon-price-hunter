// Associações incorretas restantes (ramo data 89279c7e, 25/10/2026), com títulos e links reais.
// 1. "Lendas de Paldea" (Copag 33017, 2023) e "Lendas Implacáveis" (35239, 2025) com Koraidon caíam no mesmo produto
//    (sv10-colecao_ex-koraidon). A Paldea agora tem variante própria; a Implacáveis segue no produto de sempre.
// 2. ME06 (Reinado Delta) sem código no título: só o cadastro da coleção resolve (proposta em config/catalog.json,
//    fora desta branch). Aqui fica a prova com o catálogo + a entrada proposta, sem mexer no config.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { matchProduct, variantesDe, normalize, detectCollection } from '../src/match.js';
import { linkAgrees } from '../src/gate.js';

const catalog = JSON.parse(fs.readFileSync(new URL('../config/catalog.json', import.meta.url), 'utf8'));
catalog.products ||= []; catalog.copag ||= {};
catalog.refs = JSON.parse(fs.readFileSync(new URL('../config/refs-copag.json', import.meta.url), 'utf8'))?.refs || {};
// Catálogo automático com os ids reais que decidem a variante conhecida (data/products.json de 25/10).
catalog.variantes = variantesDe(['sv10-colecao_ex-koraidon', 'avulsos-colecao_ex-miraidon', 'sv8-deck-koraidon', 'sv8-deck-miraidon', 'sv4_5-colecao_ex-quaquaval']);
const id = (title, url) => matchProduct({ title, url }, catalog).productId;
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
const IMPLACAVEIS_KORAIDON = [
  'Box Pokémon Lendas Implacáveis Koraidon',
  'POKEMON BOX LENDAS IMPLACAVEIS KORAIDON EX | Pokemon | Paladins Games Store',
  'Pokémon TCG – Box Coleção Lendas Implacáveis: Koraidon EX (PT-BR) | 6 Boosters + Promo + Jumbo',
  'Pokémon Box Coleção EX Lendas Implacáveis Koraidon 38 Cartas 100-10392 35239 - Copag',
  'Box Coleção - Lendas Implacáveis Koraidon EX (Pokémon TCG)',
  'Pokémon TCG - Coleção Lendas Implacáveis - Koraidon Ex',
];

t('Lendas de Paldea Koraidon não cai no produto da Lendas Implacáveis', () => {
  for (const [title, url] of PALDEA_KORAIDON) {
    assert.equal(id(title, url), 'avulsos-colecao_ex-lendas-de-paldea-koraidon', title);
    assert.equal(linkAgrees({ title, url }, matchProduct({ title, url }, catalog), catalog).ok, true, url);
  }
  for (const title of IMPLACAVEIS_KORAIDON) assert.equal(id(title), 'sv10-colecao_ex-koraidon', title);
});

t('Lendas de Paldea Miraidon tem a mesma variante da linha (não junta com outra caixa Miraidon)', () => {
  for (const [title, url] of PALDEA_MIRAIDON) assert.equal(id(title, url), 'avulsos-colecao_ex-lendas-de-paldea-miraidon', title);
});

t('outras linhas "de Paldea" e baralhos Koraidon/Miraidon não mudam', () => {
  assert.equal(id('Box Pokémon Destinos De Paldea Charizard Ex Brilhante Copag'), 'sv4_5-colecao_ex-charizard');
  assert.equal(id('Pokemon Box Parceiros De Paldea-Quaquaval ex'), 'sv4_5-colecao_ex-quaquaval');
  assert.equal(id('Box Pokémon Parceiros de Paldea - Meowscarada EX- 33208 Copag'), 'avulsos-colecao_ex-meowscarada');
  assert.equal(id('Pokemon Cartas - Baralho Batalha Deluxe Koraidon Ex - Escarlate e Violeta 8'), 'sv8-deck-koraidon');
  assert.equal(id('Pokemon Box - Coleção Treinador Avançado - Escarlate e Violeta - Koraidon (vermelho)'), 'sv1-etb');
  assert.equal(id('Pokémon Box Lendas de Paldea'), null); // sem o Pokémon: não vira produto
});

// Entrada proposta para config/catalog.json (depois de me05). Nome PT: "Megaevolução - Reinado Delta"; EN: "Delta Reign".
const ME06 = { id: 'me06', name: 'Reinado Delta', series: 'Megaevolução', aliases: ['reinado delta', 'me 06', 'me06', 'me6'], langAliases: { en: ['delta reign'] } };
const comMe06 = { ...catalog, collections: [...catalog.collections, ME06] };
const idMe06 = (title) => matchProduct({ title }, comMe06).productId;

t('sem ME06 no catálogo, o combo sem código não tem como sair de ME01 (por isso a proposta de cadastro)', () => {
  assert.equal(detectCollection(normalize('Combo de Boosters - Megaevolução Reinado Delta'), catalog.collections).id, 'me01');
});

t('com a entrada proposta, os anúncios reais de ME06 vão para me06-*', () => {
  assert.equal(idMe06('Combo de Boosters - Megaevolução Reinado Delta'), 'me06-combo');
  assert.equal(idMe06('Combo Booster Box Pokémon Reinado Delta Megaevolução ME06 - 18 Pacotes'), 'me06-combo18');
  assert.equal(idMe06('Elite Trainer Box (ETB) Megaevolução - Reinado Delta (ME06) — PT'), 'me06-etb');
  assert.equal(idMe06('Booster Box Megaevolução - Reinado Delta (ME06) — PT — 36 Boosters'), 'me06-box36');
  assert.equal(idMe06('Blister Triplo Megaevolução - Reinado Delta (ME06) — PT — 3 Boosters'), 'me06-blister3');
  // ME01 de verdade e o Reinado Arrepiante (swsh6) continuam onde estavam
  assert.equal(idMe06('Box Treinador Avançado Pokémon Megaevolução Copag'), 'me01-etb');
  assert.equal(idMe06('Box - Coleção Treinador Avançado - Reinado Arrepiante - Pokémon TCG'), 'swsh6-etb');
  // por isso a entrada não tem "megaevolucao 6": "Megaevolução 6 Cartas" é a contagem de cartas de um booster ME01
  assert.equal(idMe06('Booster Avulso Pokémon TCG Megaevolução 6 Cartas – Copag'), 'me01-booster');
  assert.equal(idMe06('Trading Card Game Pokemon - Blister Mega Evolução (6 Cartas) (01 Blister Sortido) (Novo)'), 'me01-blister1');
});

console.log(`✓ Associações restantes (Paldea × Implacáveis, ME06): ${n} grupos de testes passaram`);
