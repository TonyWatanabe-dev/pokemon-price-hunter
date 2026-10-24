// K5 (24/10/2026): acessório nunca casa com produto lacrado. "Deck Box Pokémon Mewtwo ex" casava com
// avulsos-colecao_ex-mewtwo (Box Pokémon ex) e entraria no ranking do lacrado. Cruza o classificador de acessórios
// (api/_lib/acessorios.mjs) com o casamento (src/match.js): o que é acessório não vira produto do catálogo, e o lacrado
// com acessório no nome continua lacrado e fora do classificador.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { matchProduct } from '../src/match.js';
import { classificarAcessorio } from '../api/_lib/acessorios.mjs';
const cat = JSON.parse(fs.readFileSync(new URL('../config/catalog.json', import.meta.url), 'utf8'));
const id = (t) => matchProduct({ title: t }, cat).productId;

// Títulos dos candidatos da K5 (docs/kit-acessorios-candidatos.md) e de lojas lidas em 24/10 (sonda 40113961823)
const acessorios = [
  'Shield Ultra Pro – Pokémon – Pikachu (65 un.)', 'Sleeve Standard Ultra PRO – Pokémon TCG: Charizard (65 un.)',
  'Fichário Fixo Ultra Pro 9 bolsos – Pokémon – Pikachu (PRO-Binder)', 'Ultra PRO Pokémon Snorlax & Munchlax PRO-Binder 9 bolsos',
  'Deck Box Ultra Pro – Pokémon – Charizard', 'Ultra PRO Pikachu Toploader + Penny Sleeves (25)', 'Playmat Ultra PRO – Pokémon TCG: Charizard',
  'Deck Box Pokébola - Estojo para 400 Cartas de TCG Pokémon', 'Deck Box japonesa de celebrações 30 anos pokemon', 'Moeda Marcador Pokémon',
  // o caso que contaminava: nome de Pokémon "ex" depois de "Deck Box"
  'Deck Box Pokémon Mewtwo ex', 'Deck Box Pokémon Charizard ex', 'Porta Deck Pokémon Gardevoir ex', 'Caixa para Deck Pokémon Miraidon ex',
  'Sleeves Pokémon Mega Lucario ex 65 unidades', 'Top Loader Pokémon Charizard ex 25 unidades', 'Playmat Pokémon Miraidon ex',
];
for (const t of acessorios) {
  assert.ok(classificarAcessorio(t), `classificado como acessório: ${t}`);
  assert.equal(id(t), null, `acessório não casa com produto lacrado: ${t}`);
}

// Lacrado com acessório no nome: continua lacrado e o classificador não pega
const lacrados = {
  'Pokémon Box Coleção Mega Lucario EX - Copag': 'avulsos-colecao_ex-mega-lucario',
  'Deck Batalha de Liga Pokemon Mega Lucario EX Copag': 'avulsos-deck-mega-lucario',
};
for (const [t, esperado] of Object.entries(lacrados)) { assert.equal(id(t), esperado, t); assert.equal(classificarAcessorio(t), null, t); }
assert.notEqual(id('Pokémon Coleção com Fichário Fogo Fantasmagórico'), null, 'Coleção com Fichário é lacrado');

// Seleção inicial por perfil (docs/kit-acessorios-candidatos.md): cada acessório sugerido pelo kit tem nome na página e
// categoria no classificador; "cartas especiais" pede proteção extra (toploader). Só categoria: nenhum produto é publicado.
{
  const { MODELOS, ACESSORIO_NOME } = await import('../api/_lib/kit.mjs');
  const { KIT_DE } = await import('../api/_lib/acessorios.mjs');
  const doClassificador = new Set(Object.values(KIT_DE));
  for (const [m, def] of Object.entries(MODELOS)) for (const a of def.acessorios) { assert.ok(ACESSORIO_NOME[a], `${m}: ${a} tem nome`); assert.ok(doClassificador.has(a), `${m}: ${a} existe no classificador`); }
  assert.deepEqual(MODELOS.especiais.acessorios, ['sleeve', 'toploader']);
  assert.deepEqual(MODELOS.jogar.acessorios, ['sleeve', 'deck_box', 'playmat']);
}
console.log('acessorio-nao-contamina-tests: ok');
