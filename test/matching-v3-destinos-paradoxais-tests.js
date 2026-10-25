// T5-C parte C (25/10/2026): "Coleção Ex Destinos Paradoxais" por lista fechada das 4 caixas (Raio de Fúria, Chifres Férreos,
// Fogo Corrosão, Rocha Férrea), com as variantes que já são ids do catálogo automático (avulsos-colecao_ex-furia/-ferreos/
// -corrosao/-ferrea). A v2 pegava a última palavra do título: sufixo de loja deixava a caixa sem produto, "… Kit" criava
// avulsos-colecao_ex-kit e duas caixas no título caíam numa só.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { matchProduct, variantesDe } from '../src/match.js';

const base = JSON.parse(fs.readFileSync(new URL('../config/catalog.json', import.meta.url), 'utf8'));
base.products ||= []; base.copag ||= {};
base.refs = JSON.parse(fs.readFileSync(new URL('../config/refs-copag.json', import.meta.url), 'utf8'))?.refs || {};
const catalog = { ...base, variantes: variantesDe(['avulsos-colecao_ex-furia', 'avulsos-colecao_ex-ferreos', 'avulsos-colecao_ex-corrosao',
  'avulsos-colecao_ex-ferrea', 'avulsos-colecao_ex-paradoxais', 'avulsos-colecao_ex-destinos', 'sv4_5-colecao_ex-ferreo']) };
const m = (title) => matchProduct({ title }, catalog);
const id = (title) => m(title).productId;
let n = 0; const t = (name, fn) => { fn(); n++; };
const todos = (titulos, esperado) => { for (const title of titulos) assert.equal(id(title), esperado, title); };

t('C1. títulos reais: cada caixa no seu id existente', () => {
  todos(['Pokémon TCG - Coleção Ex Destinos Paradoxais - Fogo Corrosão'], 'avulsos-colecao_ex-corrosao');
  todos(['Pokémon TCG - Coleção Ex Destinos Paradoxais - Chifres Férreos', 'Pokémon Box Destinos Paradoxais Chifres Férreos Ex - Copag'], 'avulsos-colecao_ex-ferreos');
  todos(['Pokémon Box Destinos Paradoxais Raio de Fúria Ex - Copag', 'Box Coleção Raio Furia EX Destinos Paradoxais Pokémon TCG'], 'avulsos-colecao_ex-furia');
  // antes em avulsos-colecao_ex-paradoxais (variante = nome da linha); a Rocha Férrea já tem id próprio
  todos(['Pokémon Box Destinos Paradoxais EX Rocha Férrea Futurista 3707 - Copag'], 'avulsos-colecao_ex-ferrea');
});

t('C2. sufixos de loja não tiram a caixa do produto (v2: sem produto)', () => {
  todos(['Pokémon TCG - Coleção Ex Destinos Paradoxais - Fogo Corrosão (PT-BR)', 'Pokémon Box Destinos Paradoxais Fogo Corros?o Ex'], 'avulsos-colecao_ex-corrosao');
  todos(['Pokémon TCG - Coleção Ex Destinos Paradoxais - Chifres Férreos - Copag', 'Pokémon Coleção Ex Destinos Paradoxais Chifres Férreos | Loja X'], 'avulsos-colecao_ex-ferreos');
  todos(['Pokémon Box Destinos Paradoxais Raio de Fúria Ex | Loja X'], 'avulsos-colecao_ex-furia');
  todos(['Pokémon Box Destinos Paradoxais Rocha F?rrea Ex', 'Pokémon Box Destinos Paradoxais Rocha Férrea Ex (PT-BR)'], 'avulsos-colecao_ex-ferrea');
});

t('C3. kit, linha sem caixa e duas caixas: sem produto, e nunca ids falsos (-kit, -destinos, -paradoxais)', () => {
  const falsos = new Set(['avulsos-colecao_ex-kit', 'avulsos-colecao_ex-destinos', 'avulsos-colecao_ex-paradoxais']);
  for (const title of ['Pokémon Kit Box Coleção ex Destinos Paradoxais', 'Pokémon Coleção Ex Destinos Paradoxais Kit', // v2: -kit
    'Pokémon Coleção Ex Destinos Paradoxais', 'Pokémon Box Destinos Paradoxais EX - Copag',
    'Pokémon Coleção Ex Destinos Paradoxais - Fogo Corrosão e Chifres Férreos']) { // v2: -ferreos
    const r = m(title);
    assert.equal(r.productId, null, title);
    assert.ok(!falsos.has(r.productId), title);
  }
});

t('C4. fora da linha: "Trilho Férreo ex Brilhante" (Destinos de Paldea) continua em sv4_5', () => {
  assert.equal(id('Box Pokémon Destinos de Paldea Trilho Ferreo Ex Brilhante'), 'sv4_5-colecao_ex-ferreo');
});

console.log(`matching-v3-destinos-paradoxais-tests: ok (${n} grupos)`);
