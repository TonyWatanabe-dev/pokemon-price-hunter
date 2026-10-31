// T5-C parte A (25/10/2026): "Lendas Implacáveis" (35239) × "Lendas de Paldea" × Lupo (35263).
// Confirma, com os 13 títulos reais que mudaram na v2 (ramo data, 3.285 títulos distintos), onde cada caixa mora, e fecha
// os vazamentos achados na revisão independente (rev-match.md §2): hífen ("Lendas-Implacáveis", "Lendas-de-Paldea"),
// "Lendas Paldea" sem o "de" e o código Copag 35239 sem o nome da linha. Sem estas regras esses títulos voltavam para o
// Lupo (sv9-colecao_ex-zacian) ou para sv10-colecao_ex-koraidon.
// Ids válidos preservados: Lupo em sv9, Koraidon Implacáveis em sv10-colecao_ex-koraidon (dono do histórico),
// Miraidon Paldea em avulsos-colecao_ex-miraidon.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { matchProduct, variantesDe } from '../src/match.js';

const base = JSON.parse(fs.readFileSync(new URL('../config/catalog.json', import.meta.url), 'utf8'));
base.products ||= []; base.copag ||= {};
base.refs = JSON.parse(fs.readFileSync(new URL('../config/refs-copag.json', import.meta.url), 'utf8'))?.refs || {};
// ids reais de data/products.json (ramo data) que decidem a variante conhecida destes títulos
const IDS = ['sv9-colecao_ex-zacian', 'sv10-colecao_ex-koraidon', 'avulsos-colecao_ex-miraidon', 'sv7-colecao_ex-lupo'];
const catalog = { ...base, variantes: variantesDe(IDS) };
const id = (title) => matchProduct({ title }, catalog).productId;
let n = 0; const t = (name, fn) => { fn(); n++; };
const todos = (titulos, esperado) => { for (const title of titulos) assert.equal(id(title), esperado, title); };

t('A1. as 10 Zacian "Lendas Implacáveis" reais ficam em avulsos-colecao_ex-zacian (não no Lupo)', () => {
  todos(['Box Pokémon Lendas Implacáveis Zacian',
    'POKEMON BOX LENDAS IMPLACAVEIS ZACIAN EX | Pokemon | Paladins Games Store',
    'Pokemon Box - Lendas Implac?veis - Zacian Ex',
    'Trading Card Game Pokemon - Baralho Coleção Lendas Implacáveis Zacian Ex (38 Cartas) (Novo)',
    'Pokémon TCG – Box Coleção Lendas Implacáveis: Zacian EX (PT-BR) | 6 Boosters + Promo + Jumbo',
    'Pokémon Box Coleção EX Lendas Implacáveis Zacian 38 Cartas 100-10392 35239 - Copag',
    'Baralho Box Pokémon Lendas Implacáveis Zacian',
    'Box Coleção - Lendas Implacáveis Zacian EX (Pokémon TCG)',
    'Pokémon TCG - Coleção Lendas Implacáveis - Zacian Ex',
    'Pokemon Box - Coleção Ex Lendas Implacáveis - Zacian'], 'avulsos-colecao_ex-zacian');
});

t('A2. os 3 Koraidon "Lendas de Paldea" reais ficam em avulsos-colecao_ex-koraidon (não na Implacáveis)', () => {
  todos(['Pokémon Box Lendas de Paldea - KORAIDON EX', 'Box Pokémon Lendas De Paldea Koraidon Ex Copag',
    'Pokémon TCG - Coleção Lendas de Paldea: Koraidon Ex'], 'avulsos-colecao_ex-koraidon');
});

t('A3. ids válidos preservados: Lupo, Koraidon Implacáveis e Miraidon Paldea não mudam', () => {
  todos(['Box Pokémon Coleção Zacian Ex Do Lupo Copag 35263', 'Box Pokémon Coleção Zacian EX do Lupo com 50 Cartas 10-10134-101 35263 - Copag',
    'Pokemon Box Zacian Ex do Ludo', 'Box Pokémon Zacian ex'], 'sv9-colecao_ex-zacian');
  todos(['Box Pokémon Lendas Implacáveis Koraidon', 'Pokemon Box - Lendas Implac?veis - Koraidon Ex',
    'Pokémon Box Coleção EX Lendas Implacáveis Koraidon 38 Cartas 100-10392 35239 - Copag', 'Box Pokémon Koraidon ex'], 'sv10-colecao_ex-koraidon');
  todos(['Box Pokémon Lendas de Paldea - Miraidon EX - 33017 Copag', 'Box Pokémon Lendas De Paldea Miraidon Ex Copag'], 'avulsos-colecao_ex-miraidon');
});

t('A4 (regressão v3). hífen, "Lendas Paldea" e código 35239 não devolvem a caixa ao produto errado', () => {
  // v2: os três primeiros iam para sv9-colecao_ex-zacian (Lupo); o 1º sem "ex" nem casava
  todos(['Box Pokémon Lendas-Implacáveis Zacian Ex', 'Box Pokémon Zacian ex 35239 - Copag', 'Pokémon TCG - Coleção Lendas-Implacáveis - Zacian',
    'Box Pokémon Lendas-Implacáveis Zacian'], 'avulsos-colecao_ex-zacian');
  // v2: iam para sv10-colecao_ex-koraidon (a Implacáveis)
  todos(['Box Pokémon Lendas Paldea Koraidon Ex', 'Box Pokémon Lendas-de-Paldea Koraidon Ex'], 'avulsos-colecao_ex-koraidon');
  // e a Implacáveis Koraidon com hífen ou só o código continua no dono do histórico
  todos(['Box Pokémon Lendas-Implacáveis Koraidon Ex', 'Box Pokémon Koraidon ex 35239 Copag'], 'sv10-colecao_ex-koraidon');
  // Miraidon com o código da Implacáveis nunca entra no avulso da Paldea
  assert.equal(id('Box Pokémon Miraidon ex 35239'), null);
});

console.log(`matching-v3-paldea-implacaveis-tests: ok (${n} grupos)`);
