// "Lendas Implacáveis" (24/10/2026, achado da prova de conceito Tray): em "Coleção Ex Lendas Implacáveis - Zacian" a palavra
// "lendas" virava o nome do Pokémon e juntava Zacian e Koraidon num produto só (avulsos-colecao_ex-lendas, 5 ofertas no
// ramo data). O nome vem logo depois de "Lendas Implacáveis". Títulos reais do ramo data de 24/10 (18:10 UTC).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { matchProduct, variantesDe } from '../src/match.js';
const cat = JSON.parse(fs.readFileSync(new URL('../config/catalog.json', import.meta.url), 'utf8'));
// como o robô roda: caixa conhecida no catálogo automático vai para a coleção dela (src/run.js: cat.variantes)
const comVariantes = { ...cat, variantes: variantesDe(['sv9-colecao_ex-zacian', 'sv10-colecao_ex-koraidon']) };
const id = (t, c = comVariantes) => matchProduct({ title: t }, c).productId;

// 25/10/2026 (auditoria T4-C): as 3 linhas Zacian abaixo esperavam sv9-colecao_ex-zacian, que é a "Zacian ex do Lupo" (35263,
// Amigos de Jornada), outra caixa; fixavam a colisão. A Zacian Implacáveis (35239) fica no avulso; o Koraidon continua em sv10.
const casos = {
  'Pokemon Box - Coleção Ex Lendas Implacáveis - Zacian': 'avulsos-colecao_ex-zacian',
  'Pokemon Box - Coleção Ex Lendas Implacáveis - Koraidon': 'sv10-colecao_ex-koraidon',
  'Pokémon Box Coleção EX Lendas Implacáveis Zacian 38 Cartas 100-10392 35239 - Copag': 'avulsos-colecao_ex-zacian',
  'Pokémon Box Coleção EX Lendas Implacáveis Koraidon 38 Cartas 100-10392 35239 - Copag': 'sv10-colecao_ex-koraidon',
  // formato com ":" e "(PT-BR)": a Zacian também saiu de sv9-colecao_ex-zacian (Lupo) para o avulso (T4-C); o Koraidon não muda
  'Box Coleção - Lendas Implacáveis Zacian EX (Pokémon TCG)': 'avulsos-colecao_ex-zacian',
  'Pokémon TCG – Box Coleção Lendas Implacáveis: Koraidon EX (PT-BR) | 6 Boosters + Promo': 'sv10-colecao_ex-koraidon',
};
for (const [t, esperado] of Object.entries(casos)) assert.equal(id(t), esperado, t);
// sem catálogo automático: produtos avulsos diferentes, nunca o mesmo
assert.equal(id('Pokemon Box - Coleção Ex Lendas Implacáveis - Zacian', cat), 'avulsos-colecao_ex-zacian');
assert.equal(id('Pokemon Box - Coleção Ex Lendas Implacáveis - Koraidon', cat), 'avulsos-colecao_ex-koraidon');
for (const t of Object.keys(casos)) assert.notEqual(id(t, cat), 'avulsos-colecao_ex-lendas', t);
// sem nome depois de "Lendas Implacáveis": sem produto (não inventa)
assert.equal(id('Coleção Ex Lendas Implacáveis - ex', cat), null);
console.log('lendas-implacaveis-tests: ok');
