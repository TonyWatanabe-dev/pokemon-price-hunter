// Grafia errada de nome de Pokémon não cria produto duplicado (24/10/2026: "Xarneas EX" na tavernadorei).
import assert from 'node:assert/strict';
import { detectType, normalize } from '../src/match.js';

const v = (t) => detectType(normalize(t)).variant;
assert.equal(v('Pokémon - Coleção EX Lendas Azuis - Xarneas EX'), 'xerneas', 'Xarneas vira Xerneas');
assert.equal(v('Pokémon Coleção EX Lendas Azuis - Xerneas EX'), 'xerneas', 'grafia certa igual');
assert.equal(v('Pokémon - Coleção EX Lendas Azuis - Kyogre EX'), 'kyogre', 'outros nomes não mudam');
assert.equal(v('Box Pokémon Coleção Mega Xarneas ex'), 'mega-xerneas', 'com mega também');
console.log('✓ grafia de Pokémon: Xarneas → Xerneas, demais iguais');
