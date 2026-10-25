// Golden de regressão com títulos e links REAIS do ramo data (rodada das 00:15 UTC de 25/10/2026, auditoria de
// qualidade). Trava o comportamento correto de hoje: alias EV9/EV09 → Amigos de Jornada (sv9), coleção pelo título e a
// trava do link (src/gate.js) que recusa a página que fala de outra coleção (loja que reaproveitou a página de outro
// produto). Parâmetro de rastreio no link (srsltid) não muda o casamento nem a trava.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { matchProduct } from '../src/match.js';
import { linkAgrees } from '../src/gate.js';

const cat = JSON.parse(fs.readFileSync(new URL('../config/catalog.json', import.meta.url), 'utf8'));
const id = (title) => matchProduct({ title }, cat).productId;
const gate = (title, url) => { const m = matchProduct({ title, url }, cat); return { id: m.productId, ...linkAgrees({ title, url }, m, cat) }; };

// Amigos de Jornada: "EV9"/"Escarlate e Violeta 9" é sv9 (os produtos ev09-* sem oferta são resíduo de 07/10)
const titulos = {
  'POKEMON EV9 AMIGOS DE JORNADA BOOSTER | Pokemon | Paladins Games Store': 'sv9-booster',
  'Booster pokemon Escarlate e Violeta 9 Amigos de Jornada': 'sv9-booster',
  'BOX COLEÇÃO TREINADOR AVANÇADO ETB AMIGOS DE JORNADA EV9 POKÉMON TCG BOOSTERS TR': 'sv9-etb',
  'Box Treinador Avançado Escuridão Absoluta ME05 ETB- Pokémon': 'me05-etb',
  'Blister Triplo Escuridão Absoluta': 'me05-blister3',
  'Combo de Booster Escuridão Absoluta': 'me05-combo',
};
for (const [t, esperado] of Object.entries(titulos)) assert.equal(id(t), esperado, t);
for (const t of Object.keys(titulos)) assert.ok(!/^ev09-/.test(id(t)), `nunca o resíduo ev09-*: ${t}`);

// Trava do link: título de uma coleção, página de outra → recusa (casos reais de happilybrinquedos e rarecandystore)
const recusas = [
  ['Pokémon Blister Quádruplo ME04 Caos Ascendente 95030039 - Copag', 'https://www.happilybrinquedos.com.br/pokemon-blister-quadruplo-escarlate-e-violeta-1-32566-copag', /link é de outra coleção \(sv1\) que o título \(me04\)/],
  ['Pokémon Blister Triplo EV5 Forças Temporais Carvanha e Bellibolt 33972', 'https://www.happilybrinquedos.com.br/pokemon-ee12-blister-triplo-3220232203-copag', /link é de outra coleção \(swsh12\) que o título \(sv5\)/],
  ['Blister Triplo Escuridão Absoluta', 'https://rarecandystore.com.br/produtos/blister-triplo-equilibrio-perfeito-me03-copia-19vmt/', /link é de outra coleção \(me03\) que o título \(me05\)/],
  ['Combo de Booster Escuridão Absoluta', 'https://rarecandystore.com.br/produtos/combo-de-booster-caos-ascendente-me04-com-18-boosters-copia-1v1wb/', /link é de outra coleção \(me04\) que o título \(me05\)/],
];
for (const [t, u, why] of recusas) { const g = gate(t, u); assert.equal(g.ok, false, t); assert.match(g.why, why); }

// Link que concorda passa, com ou sem srsltid (o rastreio não muda produto nem trava)
for (const u of ['https://www.lojalifegeek.com.br/box-treinador-avancado-escuridao-absoluta-me05-etb-pokemon',
  'https://www.lojalifegeek.com.br/box-treinador-avancado-escuridao-absoluta-me05-etb-pokemon?srsltid=AU7gw4VvrQPlXs0T']) {
  const g = gate('Box Treinador Avançado Escuridão Absoluta ME05 ETB- Pokémon', u);
  assert.deepEqual([g.id, g.ok], ['me05-etb', true], u);
}
console.log('golden-dados-25-10-tests: ok');
