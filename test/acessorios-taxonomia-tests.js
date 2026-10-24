// K5: taxonomia de acessórios (classificação pura, ainda não ligada ao robô). Lacrado nunca vira acessório; oficial só com
// evidência no título; categorias iguais às do banco (db/migrations/002_seed.sql).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { classificarAcessorio as c, CATEGORIAS_ACESSORIO, KIT_DE } from '../api/_lib/acessorios.mjs';
const cat = (t) => c(t)?.categoria ?? null;
// categorias
assert.equal(cat('Sleeves Pokémon Copag 65 unidades Pikachu'), 'protection.sleeve');
assert.equal(cat('Protetor de Cartas Pokémon - Charizard - 65 un - Copag'), 'protection.sleeve');
assert.equal(cat('Ultra PRO Pokémon Pikachu Deck Protector Sleeves 65ct'), 'protection.sleeve');
assert.equal(cat('Perfect Fit Inner Sleeves 100 unidades'), 'protection.inner_sleeve');
assert.equal(cat('Pasta Fichário Pokémon Copag Escarlate e Violeta'), 'organization.binder');
assert.equal(cat('Páginas para fichário 9 bolsos - pacote com 10 folhas'), 'organization.pages_9');
assert.equal(cat('Deck Box Pokémon Copag Pikachu'), 'organization.deck_box');
assert.equal(cat('Top Loader 35pt 25 unidades'), 'protection.top_loader');
assert.equal(cat('Card Saver I semi rígido 50 un'), 'protection.semi_rigid');
assert.equal(cat('Playmat Pokémon Escuridão Absoluta Ultra PRO'), 'gameplay.playmat');
assert.equal(cat('Dados Pokémon Copag - 6 dados'), 'gameplay.dice');
assert.equal(cat('Marcadores de dano Pokémon'), 'gameplay.damage_counter');
// títulos reais da pesquisa de candidatos (24/10)
assert.equal(cat('Shield Ultra Pro - Pokémon - Pikachu (65 unidades)'), 'protection.sleeve');
assert.equal(c('Shield Ultra Pro - Pokémon - Pikachu (65 unidades)').oficial, 'licenciado');
assert.equal(cat('Fichário Fixo Ultra Pro - 9 Bolsos - Pokémon - Pikachu (PRO-Binder) - Amarelo'), 'organization.binder', 'fichário com 9 bolsos é fichário');
assert.equal(cat('Pokemon Pasta Album Pokebal Ultra Pro 4 Bolsos C/ 10 Folhas'), 'organization.binder');
assert.equal(cat('Folhas para fichário 9 bolsos Ultra Pro - 10 unidades'), 'organization.pages_9');
assert.equal(cat('Deck Box Ultra Pro - Pokémon - Charizard'), 'organization.deck_box');
assert.equal(cat('Ultra PRO - Pikachu Toploader and Penny Sleeves Combo Pack for the Pokémon Trading Card Game (25 Pack)'), 'protection.top_loader');
assert.equal(cat('Playmat Oficial Ultra PRO - Pokémon TCG: Charizard'), 'gameplay.playmat');
// lacrado com acessório no nome continua lacrado (null aqui)
for (const t of ['Pokémon TCG Coleção com Fichário Escarlate e Violeta', 'Treinador Avançado (ETB) Caos Ascendente com dados e marcadores', 'Blister Triplo + moeda Celebração 30 anos', 'Deck de Batalha ex Melmetal', 'Booster Box 36 Pokémon',
  'Pokémon TCG Box + Fichário Celebração 30 Anos Copag 37139', 'Box - Pokémon - Coleção Fichário  - Especial 30 Anos - Copag', 'Pokémon TCG - Fichário Coleção Pokemon 30 Anos', 'Box Coleção Fichário Comemoração Pokémon 30 anos'])
  assert.equal(c(t), null, t);
// não é acessório de carta
for (const t of ['Pelúcia Pikachu 20cm', 'Caneca Pokémon', 'Boneco Charizard']) assert.equal(c(t), null, t);
// oficial só com evidência
assert.equal(c('Sleeves Pokémon Copag 65 unidades').oficial, 'copag');
assert.equal(c('Ultra PRO Pokémon Pikachu Deck Protector Sleeves 65ct').oficial, 'licenciado');
assert.equal(c('Sleeves 65 unidades Dragon Shield Matte').oficial, null, 'marca sem licença Pokémon não é oficial');
assert.equal(c('Sleeves Pokémon 65 unidades Charizard').oficial, null, 'sem marca: genérico, nunca oficial');
assert.deepEqual(c('Sleeves Pokémon Copag 65 unidades').quantidade, { valor: 65, unidade: 'unidades' });
assert.equal(c('Deck Box Pokémon Copag').quantidade, null, 'sem quantidade no título: null, não inventa');
// categorias existem no banco e todas mapeiam para uma chave do kit
const seed = fs.readFileSync(new URL('../db/migrations/002_seed.sql', import.meta.url), 'utf8');
for (const k of CATEGORIAS_ACESSORIO) { assert.ok(seed.includes(`('${k}',`), `${k} no seed do banco`); assert.ok(KIT_DE[k], `${k} tem chave do kit`); assert.doesNotMatch(k, /^sealed\./); }
console.log('✓ acessorios-taxonomia: categorias do banco, lacrado separado, oficial só com evidência');
