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

console.log(`matching-v3-rodada2-tests: ok (${n} grupos)`);
