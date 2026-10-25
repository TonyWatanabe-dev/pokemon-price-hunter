// T5-C parte D (25/10/2026): duas caixas ligadas por "&", "+" ou "/" no mesmo anúncio ficam sem produto, com ou sem coleção no
// título; caixas legítimas de treinador ("Lillie & Clefairy ex") e "Pikachu ex & Amigos" continuam casando (a v2 as deixava
// sem produto). Sondas da revisão (rev-match.md §2, M3) e títulos reais do ramo data quando indicado.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { matchProduct, variantesDe } from '../src/match.js';

const base = JSON.parse(fs.readFileSync(new URL('../config/catalog.json', import.meta.url), 'utf8'));
base.products ||= []; base.copag ||= {};
base.refs = JSON.parse(fs.readFileSync(new URL('../config/refs-copag.json', import.meta.url), 'utf8'))?.refs || {};
const IDS = ['sv6_5-colecao_ex-kingdra', 'sv6_5-colecao_ex-greninja', 'sv6_5-colecao_ilustracao-kingdra', 'avulsos-colecao_ex-mega-lucario',
  'me01-colecao_ex-mega-lucario', 'me02-colecao_ex-mega-lucario', 'me02_5-colecao_ex-mega-lucario', 'me02_5-colecao_ex-mega-gardevoir',
  'sv9-colecao_ex-clefairy', 'avulsos-colecao_ex-bellibolt', 'avulsos-colecao_ex-pikachu', 'avulsos-deck-mega-gengar'];
const catalog = { ...base, variantes: variantesDe(IDS) };
const m = (title) => matchProduct({ title }, catalog);
const id = (title) => m(title).productId;
let n = 0; const t = (name, fn) => { fn(); n++; };
const DUAS = 'mais de um produto no mesmo anúncio';
const semProduto = (titulos) => { for (const title of titulos) { const r = m(title); assert.equal(r.productId, null, title); assert.deepEqual(r.why, [DUAS], title); } };

t('D1. "&": duas caixas sem produto, com e sem coleção no título', () => {
  semProduto(['Jogo de Cartas - Pokemon - Box Greninja & Kingdra Ex - Copag', // real
    'Jogo De Cartas - Pokémon - Box Coleção Mega Lucario Ex & Mega Gardevoir', // real
    'Box Pokémon Fábulas Nebulosas Greninja & Kingdra ex', // v2: sv6_5-colecao_ex-kingdra
    'Box Pokémon Heróis Excelsos Mega Lucario ex & Mega Gardevoir ex', // v2: me02_5-colecao_ex-mega-lucario
    'Box Pokémon Kingdra ex &amp; Greninja ex']);
});

t('D2. "+": duas caixas sem produto (v2: escapavam)', () => {
  semProduto(['Box Pokémon Greninja ex + Kingdra ex', 'Box Pokémon Greninja + Kingdra ex', 'Box Pokémon Fábulas Nebulosas Greninja ex + Kingdra ex',
    'Kit com Baralho De Batalha Pokémon Mega Gengar EX + Mega Diancie EX']); // real: dois baralhos (R$ 218,49) no baralho Gengar
});

t('D3. "/": duas caixas sem produto (v2: escapavam)', () => {
  semProduto(['Box Pokémon Greninja ex/Kingdra ex', 'Box Pokémon Greninja/Kingdra ex', 'Box Pokémon Greninja ex / Kingdra ex']);
});

t('D4. sem falso positivo: treinador + Pokémon, "& Amigos", brinde/promo, "Scarlet & Violet", número de carta, entidade HTML', () => {
  for (const [title, esperado] of Object.entries({
    'Box Pokémon Lillie & Clefairy ex': 'sv9-colecao_ex-clefairy', // v2: sem produto
    'Box Pokémon Iono & Bellibolt ex': 'avulsos-colecao_ex-bellibolt', // v2: sem produto
    'Box Pokémon Ash & Pikachu ex': 'avulsos-colecao_ex-pikachu', // v2: sem produto
    'Box Pokémon Pikachu ex & Amigos': 'avulsos-colecao_ex-pikachu', // v2: sem produto
    'Box Pokémon Kingdra ex + Brinde': 'sv6_5-colecao_ex-kingdra',
    'Box Pokémon Kingdra ex + Envio Imediato': 'sv6_5-colecao_ex-kingdra',
    'Pokémon Box Kingdra Ex 6 Boosters + Promo + Jumbo': 'sv6_5-colecao_ex-kingdra',
    'Box Pokémon Kingdra ex 065/165': 'sv6_5-colecao_ex-kingdra',
    'Scarlet & Violet Destined Rivals Elite Trainer Box': 'sv10-etb-en', // real
    'Blister Quadruplo Herois Excelsos &#8211; Komala - Caverna TCG': 'me02_5-blister4', // real
    'EV6.5 Box Kingdra EX Fabulas Nebulosas Pokémon TCG': 'sv6_5-colecao_ex-kingdra', // real
    'Pokemon Box - Coleção Mega Lucario Ex': 'avulsos-colecao_ex-mega-lucario', // real
    'Box Pokémon Baralho Batalha de Liga Mega Gengar ex': 'avulsos-deck-mega-gengar',
  })) assert.equal(id(title), esperado, title);
});

console.log(`matching-v3-simbolos-tests: ok (${n} grupos)`);
