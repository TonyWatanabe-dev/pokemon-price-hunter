// T5-C rodada 2 (25/10/2026): ressalvas da revisão independente da v3 (frentes/rev-match-v3.md). Cada grupo marca com
// "(nova)" as asserções que falham em 9c56a407 e com "(guarda)" as que já valiam e só travam o comportamento.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { matchProduct, variantesDe } from '../src/match.js';

const base = JSON.parse(fs.readFileSync(new URL('../config/catalog.json', import.meta.url), 'utf8'));
base.products ||= []; base.copag ||= {};
base.refs = JSON.parse(fs.readFileSync(new URL('../config/refs-copag.json', import.meta.url), 'utf8'))?.refs || {};
const IDS = ['sv9-colecao_ex-zacian', 'sv10-colecao_ex-koraidon', 'avulsos-colecao_ex-miraidon', 'sv10-colecao_ex-mewtwo', 'sv10-colecao_ex-mewtwo-en',
  'sv10-colecao_ex-equipe', 'avulsos-colecao_ex-nidoking', 'sv8-colecao_ex-ogerpon', 'avulsos-colecao_ex-charizard', 'sv4_5-colecao_ex-charizard', 'sv9-colecao_ex-charizard'];
const catalog = { ...base, variantes: variantesDe(IDS) };
const m = (title, c = catalog) => matchProduct({ title }, c);
const id = (title, c) => m(title, c).productId;
let n = 0; const t = (name, fn) => { fn(); n++; };
const todos = (casos, c) => { for (const [title, esperado] of Object.entries(casos)) assert.equal(id(title, c), esperado, title); };

t('R1. código Copag que não é o da caixa herdada não cai nela ("Box Koraidon ex 33016" ≠ sv10, que é a 35239)', () => {
  // (nova) em 9c56a407 iam para sv10-colecao_ex-koraidon / sv9-colecao_ex-zacian pela variante conhecida
  for (const title of ['Box Pokémon Koraidon ex 33016 Copag', 'Pokémon TCG Box Koraidon ex 33016', 'Box Pokémon Zacian ex 33016']) {
    const r = m(title);
    assert.equal(r.productId, null, title);
    assert.deepEqual(r.why, ['código Copag diverge da caixa conhecida'], title);
  }
  // (guarda) código certo, sem código e linha explícita continuam como estão
  todos({
    'Box Pokémon Koraidon ex 35239 Copag': 'sv10-colecao_ex-koraidon',
    'Pokémon Box Coleção EX Lendas Implacáveis Koraidon 38 Cartas 100-10392 35239 - Copag': 'sv10-colecao_ex-koraidon', // real
    'Box Pokémon Koraidon ex': 'sv10-colecao_ex-koraidon',
    'Pokémon Box Lendas de Paldea Koraidon ex 33016 - Copag': 'avulsos-colecao_ex-koraidon',
    'Box Pokémon Coleção Zacian Ex Do Lupo Copag 35263': 'sv9-colecao_ex-zacian', // real
    'Pokémon Box Mewtwo EX da Equipe Rocket 35579 - Copag': 'sv10-colecao_ex-mewtwo', // real
    'POKEMON BLISTER QUADRUPLO ME04 CAOS ASCENDENTE 15606/36932 ( 929579 )': 'me04-blister4', // real; código de loja
  });
});

t('R2. Miraidon Implacáveis × Miraidon Paldea: cada um no seu id atual, com hífen e código, hoje e com uma caixa Miraidon futura', () => {
  // ids atuais: Paldea = avulsos-colecao_ex-miraidon; Implacáveis Miraidon não existe = sem produto (guarda H3 da v2)
  const PALDEA = ['Box Pokémon Lendas de Paldea - Miraidon EX - 33017 Copag', 'Box Pokémon Lendas De Paldea Miraidon Ex Copag', // reais
    'Box Pokémon Lendas-de-Paldea Miraidon ex', 'Box Pokémon Lendas Paldea Miraidon ex', 'Box Pokémon Miraidon ex 33017 Copag'];
  const IMPLAC = ['Box Pokémon Lendas Implacáveis Miraidon', 'Box Pokémon Lendas-Implacáveis Miraidon ex', 'Box Pokémon Miraidon ex 35239',
    'Pokemon Box - Lendas Implac?veis - Miraidon Ex'];
  // (guarda) catálogo de hoje: já valia em 9c56a407
  for (const title of PALDEA) assert.equal(id(title), 'avulsos-colecao_ex-miraidon', title);
  for (const title of IMPLAC) assert.equal(id(title), null, title);
  // risco futuro: o catálogo automático ganha uma caixa Miraidon de coleção (ex.: canal40 "… EV10" cria sv10-colecao_ex-miraidon)
  const futuro = { ...base, variantes: variantesDe([...IDS, 'sv10-colecao_ex-miraidon']) };
  for (const title of PALDEA) assert.equal(id(title, futuro), 'avulsos-colecao_ex-miraidon', title); // (nova) o 33017 sem linha herdava sv10
  for (const title of IMPLAC) assert.equal(id(title, futuro), null, title); // (guarda) Implacáveis só herda Koraidon
  assert.equal(id('Box Pokémon Miraidon ex', futuro), 'sv10-colecao_ex-miraidon'); // (guarda) sem linha nem código: variante conhecida
});

t('R3. variantes de escrita do kit: "Kit c/ 2", "Kit com 02", "Kit 2x", "Kit com Duas" = "Kit com 2"', () => {
  const KIT = 'kit montado pela loja ou caixa com várias unidades';
  // (nova) em 9c56a407 caíam no blister/caixa unitário
  for (const title of ['Kit c/ 2 Blister Triplo Caos Ascendente Charmeleon Pokémon Megaevolução', 'Kit c/2 Blister Triplo Caos Ascendente Charmeleon Pokémon',
    'Kit com 02 Blister Quadruplo Caos Ascendente Toxel Pokémon', 'Kit 2x Blister Triplo Caos Ascendente Charmeleon Pokémon',
    'Kit 2x Blister quadruplo Pokemon TCG Heróis Excelsos 50u', // real (ramo data b1fcfa20), estava em me02_5-blister4
    'Kit com Duas Box Pokémon Coleção Mega Lucario Ex']) {
    const r = m(title); assert.equal(r.productId, null, title); assert.ok(r.why.includes(KIT), title);
  }
  // (guarda) não é kit de várias unidades
  todos({
    'Kit c/ 10 Boosters Pokémon Mega Evolução': 'me01-combo10',
    'Kit com 10 Boosters Avulsos Pokémon Mega Evolução': 'me01-combo10', // real
    'Pokémon Ferramentas de Treinador Squawkabilly ex Kit Com 92 Cartas e Boosters': 'avulsos-colecao_especial-ferramentas-de-treinador-squawkabilly', // real
    'Kit de Cartas Pokemon Blister Triplo Origem Perdida 3 Pacotes + 1 Carta Scorbunny': 'swsh11-blister3', // real
    'Kit Treinador Pokémon Escarlate e Violeta': 'sv1-kit_treinador',
  });
});

t('R4. importado de caixa que não herda a coleção (35880, Implacáveis, Paldea) não cria id novo', () => {
  const IMP = 'importado sem produto identificado no idioma';
  // (nova) em 9c56a407 criavam avulsos-colecao_ex-mewtwo-en / -zacian-en / -koraidon-en
  for (const title of ['Box Pokémon Coleção Equipe Rocket Mewtwo Ex Inglês', 'Box Pokémon Coleção Equipe Rocket Mewtwo Ex - English',
    'Box Pokémon Coleção Equipe Rocket Mewtwo Ex (EN)', 'Box Pokémon Lendas Implacáveis Zacian ex Inglês', 'Box Pokémon Lendas de Paldea Koraidon ex Inglês']) {
    const r = m(title);
    assert.equal(r.productId, null, title); assert.deepEqual(r.why, [IMP], title);
  }
  // (guarda) regra de idioma do projeto (id PT + sufixo) onde o produto PT está identificado
  todos({
    'Pokemon Box Team Rockets Mewtwo Ex (EN)': 'sv10-colecao_ex-mewtwo-en', // real
    "Team's Rocket Mewtwo Ex Box - Pokémon TCG: Destined Rivals - Inglês - Galápagos": 'sv10-colecao_ex-mewtwo-en', // real
    'Box Pokémon Lendas de Paldea Miraidon ex Inglês': 'avulsos-colecao_ex-miraidon-en', // avulso sem herança: igual à base
    'Box Pokémon Coleção Equipe Rocket Mewtwo Ex': 'sv10-colecao_ex-equipe', // o PT continua
  });
});

console.log(`matching-v3-rodada2-tests: ok (${n} grupos)`);
