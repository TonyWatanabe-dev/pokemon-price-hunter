// T5-C parte B (25/10/2026): carta individual × caixa × kit, e a caixa 35880 (Coleção Equipe Rocket) sem produto avulso novo.
// Regras:
//  - Carta individual: o título COMEÇA por "carta"/"card" (depois de "Pokémon"/"TCG"), tem número de carta (65/165, 065/165) e
//    não fala de embalagem lacrada (box, blister, lata, booster, kit, baralho...). Sem produto ("carta avulsa").
//  - Caixa: qualquer embalagem lacrada continua caixa, mesmo com "carta" no título ("Box … com carta promo 065/165",
//    "Carta Pokemon Box Zacian EX do Lupo").
//  - Kit: "Kit com N <embalagem>" (N ≥ 2) é kit montado pela loja, nunca a unidade.
//  - 35880 Mewtwo: vai para o produto que a caixa já tem (colecao_ex-equipe), nunca para a 35579 nem para um avulso novo.
// Títulos reais do ramo data quando indicado; os demais são as sondas da revisão (rev-match.md §2).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { matchProduct, variantesDe } from '../src/match.js';
import { linkAgrees } from '../src/gate.js';

const base = JSON.parse(fs.readFileSync(new URL('../config/catalog.json', import.meta.url), 'utf8'));
base.products ||= []; base.copag ||= {};
base.refs = JSON.parse(fs.readFileSync(new URL('../config/refs-copag.json', import.meta.url), 'utf8'))?.refs || {};
const IDS = ['sv10-colecao_ex-mewtwo', 'sv10-colecao_ex-mewtwo-en', 'sv10-colecao_ex-equipe', 'avulsos-colecao_ex-nidoking', 'avulsos-colecao_ex-persian',
  'sv3_5-colecao_ex-alakazam', 'sv9-colecao_ex-zacian', 'avulsos-colecao_ex-mega-lucario', 'me01-colecao_ex-mega-lucario', 'me02-colecao_ex-mega-lucario'];
const catalog = { ...base, variantes: variantesDe(IDS) };
const m = (title, url, c = catalog) => matchProduct({ title, url }, c);
const id = (title, url, c) => m(title, url, c).productId;
let n = 0; const t = (name, fn) => { fn(); n++; };
const KIT = 'kit montado pela loja ou caixa com várias unidades';
const CARTA = 'carta avulsa, não é produto lacrado';

t('B1. 35880 Mewtwo vai para sv10-colecao_ex-equipe, nunca para avulsos-colecao_ex-mewtwo nem para a 35579', () => {
  for (const [title, url] of [
    ['Box Pokémon Coleção Equipe Rocket Mewtwo Ex', 'https://www.rihappy.com.br/box-pokemon-colecao-equipe-rocket-mewtwo-ex-1003201549/p'], // real (x5)
    ['Pokémon TCG - Box Pokémon Coleção Equipe Rocket Mewtwo Ex - 49 Cartas', 'https://www.preech.com.br/card-game/card-pokemon/pokemon-tcg-box-pokemon-colecao-equipe-rocket-mewtwo-ex-49-cartas'], // real
    ['Box Pokémon TCG Coleção Equipe Rocket Mewtwo Ex - Copag', 'https://4bestplay.com.br/produtos/box-pokemon-tcg-colecao-equipe-rocket-mewtwo-ex-copag-tqp4f/'], // real
    // sondas da revisão que escapavam da v2 e ficavam na 35579
    ['Box Pokémon Coleção Equipe Rocket - Mewtwo Ex', undefined],
    ['Box Equipe Rocket Mewtwo Ex 35880 Pokémon', undefined],
    ['EV10 Coleção Equipe Rocket Mewtwo ex Pokémon', undefined],
  ]) {
    const r = m(title, url);
    assert.notEqual(r.productId, 'avulsos-colecao_ex-mewtwo', title);
    assert.notEqual(r.productId, 'sv10-colecao_ex-mewtwo', title);
    assert.equal(r.productId, 'sv10-colecao_ex-equipe', title);
    if (url) assert.equal(linkAgrees({ title, url }, r, catalog).ok, true, url);
  }
  // sem o produto da 35880 no catálogo: sem produto (não cria avulso falso, não volta para a 35579)
  const semEquipe = { ...base, variantes: variantesDe(IDS.filter((x) => x !== 'sv10-colecao_ex-equipe')) };
  const r = m('Box Pokémon Coleção Equipe Rocket Mewtwo Ex', undefined, semEquipe);
  assert.equal(r.productId, null); assert.deepEqual(r.why, ['coleção não identificada']);
});

t('B2. preservados: 35579, genéricos da 35880, irmãs Nidoking/Persian e o importado', () => {
  for (const [title, esperado] of Object.entries({
    'Pokémon Box Mewtwo EX da Equipe Rocket 35579 - Copag': 'sv10-colecao_ex-mewtwo',
    'Pokémon TCG: Coleção Mewtwo Ex da Equipe Rocket': 'sv10-colecao_ex-mewtwo',
    'Trading Card Game Pokemon - Box Colecao Mewtwo Ex Giovanni (40 Cartas) (Novo)': 'sv10-colecao_ex-mewtwo',
    'Box Pokémon Coleção Ex Equipe Rocket Copag 35880': 'sv10-colecao_ex-equipe',
    'Box Pokémon Coleção EX Equipe Rocket Mewtwo': 'sv10-colecao_ex-equipe',
    'Pokemon Box - Colecao Ex Equipe Rocket - MewTwo COPAG DA AMAZONIA': 'sv10-colecao_ex-equipe',
    'Box Pokémon Coleção Equipe Rocket Nidoking Ex': 'avulsos-colecao_ex-nidoking',
    'Box Pokémon TCG Coleção Equipe Rocket Persian Ex - Copag': 'avulsos-colecao_ex-persian',
    'Pokemon Box Team Rockets Mewtwo Ex (EN)': 'sv10-colecao_ex-mewtwo-en',
  })) assert.equal(id(title), esperado, title);
});

t('B3. carta individual: sem produto', () => {
  for (const title of ['Carta Pokémon TCG Alakazam ex (065/165) Coleção 151', 'Carta Pokémon TCG Golem ex (076/165) Coleção 151', // reais
    'Card Pokémon Alakazam ex (065/165)', 'Carta Pokémon Alakazam ex 65/165', 'Pokémon TCG Carta Alakazam ex 065/165']) {
    const r = m(title);
    assert.equal(r.productId, null, title); assert.ok(r.why.includes(CARTA), title);
  }
});

t('B4. caixa com "carta" no título continua caixa (a regra não casa em qualquer posição)', () => {
  // v2: a regra "carta … NNN/NNN" em qualquer posição deixava esta caixa sem produto
  assert.equal(id('Box Pokémon Alakazam ex com carta promo 065/165'), 'sv3_5-colecao_ex-alakazam');
  assert.equal(id('Carta Pokémon Box Alakazam ex 065/165'), 'sv3_5-colecao_ex-alakazam'); // loja que chama box de "carta"
  assert.equal(id('Carta Pokemon Box Zacian EX do Lupo - Copag'), 'sv9-colecao_ex-zacian'); // real
  assert.equal(id('POKEMON BLISTER QUADRUPLO ME04 CAOS ASCENDENTE 15606/36932 ( 929579 )'), 'me04-blister4'); // real; código de loja
  assert.equal(id('Blister Triplo Equilíbrio Perfeito Pokémon Carta Promo Makuhita - ME03'), 'me03-blister3'); // real
});

t('B5. "Kit com N <embalagem>" é kit; "Kit com N cartas/boosters" não muda', () => {
  for (const title of [
    'Kit com 2 Blister Triplo Caos Ascendente Charmeleon Pokémon Megaevolução', // reais (15 títulos "Kit com 2/3 Blister")
    'Kit com 2 Blister Quádruplo Pokémon EE11 Origem Perdida 31666 - Copag',
    'Kit com 3 Blister Triplo Evoluções Prismáticas Glaceon, Leafeon e Sylveon Pokémon Escarlate e Violeta',
    'Kit com 3 Box Pokémon Coleção EX Equipe Rocket (Mewtwo + Nidoking + Persian)',
    'Kit com 20 Box Pokémon Coleção Mega Lucario Ex', // v2: só 2..19
    'Kit com 2 Latas Pokémon Coroa Estelar',
  ]) { const r = m(title); assert.equal(r.productId, null, title); assert.ok(r.why.includes(KIT), title); }
  assert.equal(id('Pokémon Ferramentas de Treinador Squawkabilly ex Kit Com 92 Cartas e Boosters'), 'avulsos-colecao_especial-ferramentas-de-treinador-squawkabilly');
  assert.equal(id('Kit com 10 Boosters Avulsos Pokémon Mega Evolução'), 'me01-combo10');
  assert.equal(id('Trading Card Game Pokemon - Pokémon Blister Triplo Megaevolução Caos Ascendente Charmeleon (19 Cartas) (Novo)'), 'me04-blister3');
});

console.log(`matching-v3-cartas-kits-tests: ok (${n} grupos)`);
