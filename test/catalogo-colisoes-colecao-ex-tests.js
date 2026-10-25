// Auditoria dos produtos colecao_ex (ramo data 79a63425 / 345ff5f0 / 89279c7e, 25/10/2026): caixas diferentes no mesmo
// produto. Títulos e links reais. Mesmo princípio da correção "Lendas de Paldea": nenhum id existente muda de dono nem
// perde histórico; só os títulos errados saem do produto (para um avulso da caixa certa ou para "sem produto").
//  1. Zacian "Lendas Implacáveis" (35239, 38 cartas) dentro de sv9-colecao_ex-zacian, a "Zacian ex do Lupo" (35263, Amigos
//     de Jornada, 40 cartas). O menor preço publicado do Lupo (R$ 113,89, facilshopping) era da Implacáveis.
//  2. "Coleção Equipe Rocket Mewtwo Ex" (35880, 49 cartas) dentro de sv10-colecao_ex-mewtwo ("Mewtwo ex da Equipe Rocket",
//     35579, 40 cartas); menor preço publicado (R$ 139,99, rihappy) era da 35880.
//  3. Carta avulsa "(065/165)" dentro da caixa sv3_5-colecao_ex-alakazam (menor preço R$ 47,41) e produtos de caixa falsos.
//  4. "Box Greninja & Kingdra Ex" (R$ 229,99, único ponto em estoque de sv6_5-colecao_ex-kingdra) e "Mega Lucario Ex & Mega
//     Gardevoir" (link "premium-collection-me25", R$ 249,99) dentro de caixas de um Pokémon só.
//  5. "Charizard ex Brilhante" (Destinos de Paldea, R$ 249,90) dentro de avulsos-colecao_ex-charizard ("em Dobro").
//  6. "Destinos Paradoxais": Fogo Corrosão + Chifres Férreos + kit em avulsos-colecao_ex-destinos.
//  7. "Kit com 3 Box" (R$ 398,72) em sv10-colecao_ex-equipe; "Kit com 2/3 Box Ilustração" em c30-colecao_ilustracao.
// Mais o teste de guarda do risco H3 ("Lendas Implacáveis Miraidon", título sintético) e a hipótese H2 (Meowscarada).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { matchProduct, variantesDe } from '../src/match.js';
import { linkAgrees } from '../src/gate.js';

const base = JSON.parse(fs.readFileSync(new URL('../config/catalog.json', import.meta.url), 'utf8'));
base.products ||= []; base.copag ||= {};
base.refs = JSON.parse(fs.readFileSync(new URL('../config/refs-copag.json', import.meta.url), 'utf8'))?.refs || {};
// Ids reais do catálogo automático (data/products.json, ramo data 79a63425) que decidem a variante conhecida destes títulos.
const IDS = ['sv9-colecao_ex-zacian', 'sv7-colecao_ex-lupo', 'sv10-colecao_ex-koraidon', 'sv10-colecao_ex-mewtwo', 'sv10-colecao_ex-mewtwo-en',
  'sv10-colecao_ex-equipe', 'avulsos-colecao_ex-nidoking', 'avulsos-colecao_ex-persian', 'avulsos-deck-mewtwo', 'sv3_5-colecao_ex-alakazam',
  'sv3_5-colecao_ex-mew', 'sv3_5-colecao_ex-zapdos', 'sv6_5-colecao_ex-kingdra', 'sv6_5-colecao_ex-greninja', 'sv6_5-colecao_ilustracao-kingdra',
  'avulsos-colecao_ex-mega-lucario', 'me01-colecao_ex-mega-lucario', 'me02-colecao_ex-mega-lucario', 'me02_5-colecao_ex-mega-lucario',
  'me02_5-colecao_ex-mega-gardevoir', 'avulsos-colecao_ex-charizard', 'sv4_5-colecao_ex-charizard', 'sv9-colecao_ex-charizard',
  'avulsos-colecao_ex-destinos', 'avulsos-colecao_ex-ferreos', 'avulsos-colecao_ex-furia', 'avulsos-colecao_ex-paradoxais',
  'avulsos-colecao_ex-miraidon', 'avulsos-deck-miraidon', 'sv8-deck-miraidon', 'sv6_5-deck-miraidon', 'avulsos-colecao_ex-meowscarada',
  'sv4_5-colecao_premium-meowscarada', 'sv4_5-colecao_ex-quaquaval', 'sv4_5-colecao_ex-skeledirge'];
const catalog = { ...base, variantes: variantesDe(IDS) };
const m = (title, url, c = catalog) => matchProduct({ title, url }, c);
const id = (title, url, c) => m(title, url, c).productId;
let n = 0; const t = (name, fn) => { fn(); n++; };
const vai = (casos, esperado) => { for (const [title, url] of casos) { const r = m(title, url); assert.equal(r.productId, esperado, title); if (esperado) assert.equal(linkAgrees({ title, url }, r, catalog).ok, true, url); } };
const fica = (casos) => { for (const [title, esperado] of Object.entries(casos)) assert.equal(id(title), esperado, title); };

t('1. Zacian Lendas Implacáveis sai do produto do Lupo (sv9) e vai para avulsos-colecao_ex-zacian', () => {
  vai([
    ['Box Pokémon Lendas Implacáveis Zacian', 'https://www.rihappy.com.br/box-pokemon-lendas-implacaveis-zacian-1003175671/p'],
    ['Pokemon Box - Coleção Ex Lendas Implacáveis - Zacian', 'https://www.mpbrinquedos.com.br/pokemon-box---colecao-ex-lendas-implacaveis---zacian-0033914/p'],
    ['POKEMON BOX LENDAS IMPLACAVEIS ZACIAN EX | Pokemon | Paladins Games Store', 'https://paladinsgames.com.br/pokemon-box-lendas-implacaveis-zacian-ex'],
    ['Pokemon Box - Lendas Implac?veis - Zacian Ex', 'https://www.facilshopping.com.br/produtos/pokemon-box-lendas-implacaveis-zacian-ex/'],
    ['Trading Card Game Pokemon - Baralho Coleção Lendas Implacáveis Zacian Ex (38 Cartas) (Novo)', 'https://lojaarenagames.com.br/trading-card-game-pokemon-baralho-colecao-lendas-implacaveis-zacian-ex-38-cartas-novo/'],
    ['Pokémon TCG – Box Coleção Lendas Implacáveis: Zacian EX (PT-BR) | 6 Boosters + Promo + Jumbo', 'https://coffeecatstore.lojavirtualnuvem.com.br/produtos/pokemon-tcg-box-colecao-lendas-implacaveis-zacian-ex-pt-br-6-boosters-promo-jumbo/'],
    ['Pokémon Box Coleção EX Lendas Implacáveis Zacian 38 Cartas 100-10392 35239 - Copag', 'https://www.doremibrinquedos.com.br/produtos/pokemon-box-colecao-ex-lendas-implacaveis-zacian-38-cartas-100-10392-35239-copag/'],
    ['Baralho Box Pokémon Lendas Implacáveis Zacian', 'https://www.theoriginals.com.br/baralho-box-pokemon-lendas-implacaveis-zacian'],
    ['Box Coleção - Lendas Implacáveis Zacian EX (Pokémon TCG)', 'https://kamikards.com.br/produtos/box-colecao-lendas-implacaveis-zacian-ex-pokemon-tcg/'],
    ['Pokémon TCG - Coleção Lendas Implacáveis - Zacian Ex', 'https://www.dalaran.com.br/pokemon-tcg-colecao-lendas-implacaveis-zacian-ex'],
  ], 'avulsos-colecao_ex-zacian');
  // o Lupo (dono do id: o canal40 "EV9" criou sv9-colecao_ex-zacian em 07/10) continua igual, com e sem coleção no título
  fica({
    'Box Pokémon Coleção Zacian Ex Do Lupo Pokémon Tcg': 'sv9-colecao_ex-zacian',
    'Pokémon TCG Coleção Zacian ex do Lupo com 40 Cartas, 4 Cartas Holográficas e 6 Boosters': 'sv9-colecao_ex-zacian',
    'POKEMON BOX COLEÇÃO ZACIAN EX DO LUPO | Pokemon | Paladins Games Store': 'sv9-colecao_ex-zacian',
    'Pokemon Box Zacian Ex do Ludo': 'sv9-colecao_ex-zacian',
    'BOX POKÉMON COLEÇÃO ZACIAN EX DO LUPO COPAG 40 CARTAS TCG JUMBO PACOTE BOOSTER TREINADOR EV9': 'sv9-colecao_ex-zacian',
    'Trading Card Game Pokemon - Baralho Coleção Zacian Ex Do Lupo (40 Cartas) (Novo) (Caixa Detalhe)': 'sv9-colecao_ex-zacian',
    'Box Pokémon Coleção Zacian EX do Lupo com 50 Cartas 10-10134-101 35263 - Copag': 'sv9-colecao_ex-zacian',
    'Carta Pokemon Box Zacian EX do Lupo - Copag': 'sv9-colecao_ex-zacian',
    'Box Pokémon Coleção Zacian Ex Do Lupo Copag 35263': 'sv9-colecao_ex-zacian',
    'Pokémon TCG: Box Coleção Zacian Ex do Lupo': 'sv9-colecao_ex-zacian',
    // o Koraidon da mesma linha Implacáveis continua no produto que já é dele (com o histórico)
    'Box Pokémon Lendas Implacáveis Koraidon': 'sv10-colecao_ex-koraidon',
    'Pokemon Box - Lendas Implac?veis - Koraidon Ex': 'sv10-colecao_ex-koraidon',
    'Pokémon TCG – Box Coleção Lendas Implacáveis: Koraidon EX (PT-BR) | 6 Boosters + Promo + Jumbo': 'sv10-colecao_ex-koraidon',
  });
});

// T5-C/B: o destino era avulsos-colecao_ex-mewtwo (id novo), mas a caixa 35880 já tem produto no catálogo automático,
// sv10-colecao_ex-equipe ("Box Pokémon Coleção Ex Equipe Rocket Copag 35880", "… Equipe Rocket - MewTwo"). A asserção antiga
// fixava um produto avulso novo para uma caixa que já existia (a mesma caixa em dois produtos): agora vai para o da 35880.
t('2. "Coleção Equipe Rocket Mewtwo Ex" (35880) sai de sv10-colecao_ex-mewtwo (35579) e vai para o produto da 35880', () => {
  vai([
    ['Box Pokémon Coleção Equipe Rocket Mewtwo Ex', 'https://www.mercadolivre.com.br/p/MLB56462428'],
    ['Pokémon TCG - Box Pokémon Coleção Equipe Rocket Mewtwo Ex - 49 Cartas', 'https://www.preech.com.br/card-game/card-pokemon/pokemon-tcg-box-pokemon-colecao-equipe-rocket-mewtwo-ex-49-cartas'],
    ['Box Pokémon TCG Coleção Equipe Rocket Mewtwo Ex - Copag', 'https://4bestplay.com.br/produtos/box-pokemon-tcg-colecao-equipe-rocket-mewtwo-ex-copag-tqp4f/'],
  ], 'sv10-colecao_ex-equipe');
  fica({
    // 35579 continua no produto dele
    'Pokémon Box Mewtwo EX da Equipe Rocket 35579 - Copag': 'sv10-colecao_ex-mewtwo',
    'BOX POKÉMON COLEÇÃO MEWTWO EX DA EQUIPE ROCKET 40 CARTAS TCG BOOSTERS TREINADOR EV10 GIOVANNI MEOWTH': 'sv10-colecao_ex-mewtwo',
    'Pokemon Box - Coleção Mewtwo Ex da Equipe Rocket': 'sv10-colecao_ex-mewtwo',
    'Pokemon Box Team Rockets Mewtwo Ex': 'sv10-colecao_ex-mewtwo',
    'Trading Card Game Pokemon - Box Colecao Mewtwo Ex Giovanni (40 Cartas) (Novo)': 'sv10-colecao_ex-mewtwo',
    'Pokemon Box Team Rockets Mewtwo Ex (EN)': 'sv10-colecao_ex-mewtwo-en',
    // irmãs da 35880 e anúncios genéricos da linha: sem mudança
    'Box Pokémon Coleção Equipe Rocket Nidoking Ex': 'avulsos-colecao_ex-nidoking',
    'Pokémon TCG - Box Pokémon Coleção Equipe Rocket Persian Ex - 49 Cartas': 'avulsos-colecao_ex-persian',
    'Box Pokémon Coleção EX Equipe Rocket Mewtwo': 'sv10-colecao_ex-equipe',
    'Box Pokémon Coleção EX Equipe Rocket (Mewtwo, Nidoking, Persian)': 'sv10-colecao_ex-equipe',
    'Pokemon Box EX Equipe Rocket 35880 - Copag': 'sv10-colecao_ex-equipe',
  });
});

t('3. carta avulsa com número (NNN/NNN) não vira caixa', () => {
  for (const title of ['Carta Pokémon TCG Alakazam ex (065/165) Coleção 151', 'Carta Pokémon TCG Golem ex (076/165) Coleção 151',
    'Carta Pokémon TCG Venusaur ex (003/165) Coleção 151', 'Carta Pokémon TCG Wigglytuff EX (040/165) Coleção 151']) {
    const r = m(title);
    assert.equal(r.productId, null, title);
    assert.deepEqual(r.why, ['carta avulsa, não é produto lacrado'], title);
  }
  fica({
    'Box Pokémon Alakazam EX 151 33293 - Copag': 'sv3_5-colecao_ex-alakazam',
    'Pokemon Box - Coleção Alakazam Ex - Escarlate e Violeta 151': 'sv3_5-colecao_ex-alakazam',
    'Carta Pokemon Box Zacian EX do Lupo - Copag': 'sv9-colecao_ex-zacian', // "carta" sem número continua
    'POKEMON BLISTER QUADRUPLO ME04 CAOS ASCENDENTE 15606/36932 ( 929579 )': 'me04-blister4', // código da loja, não carta
  });
});

t('4. duas caixas no mesmo anúncio ("&") não caem na caixa de um Pokémon só', () => {
  for (const [title, url] of [
    ['Jogo de Cartas - Pokemon - Box Greninja & Kingdra Ex - Copag', 'https://www.rihappy.com.br/jogo-de-cartas-pokemon-box-greninja--kingdra-ex-copag/p'],
    ['Jogo De Cartas - Pokémon - Box Coleção Mega Lucario Ex & Mega Gardevoir', 'https://www.rihappy.com.br/jogo-de-cartas-pokemon-box-premium-collection-me25-copag/p'],
  ]) assert.deepEqual([id(title, url), m(title, url).why], [null, ['mais de um produto no mesmo anúncio']], title);
  fica({
    'EV6.5 Box Kingdra EX Fabulas Nebulosas Pokémon TCG': 'sv6_5-colecao_ex-kingdra',
    'Box - Fábulas Nebulosas Kingdra ex': 'sv6_5-colecao_ex-kingdra',
    'Pokemon Box - Coleção Mega Lucario Ex': 'avulsos-colecao_ex-mega-lucario',
    'Pokémon Coleção Mega Lucario Ex 49 Cartas 10066 35576 - Copag': 'avulsos-colecao_ex-mega-lucario',
    // "&" de "Scarlet & Violet" e entidade HTML (&#8211;) não são duas caixas
    'Scarlet & Violet Destined Rivals Elite Trainer Box': 'sv10-etb-en',
    'Blister Quadruplo Herois Excelsos &#8211; Komala - Caverna TCG': 'me02_5-blister4',
  });
});

t('5. "Charizard ex Brilhante" sem coleção não cai na "Charizard ex em Dobro" (vai para a caixa sv4_5)', () => {
  // T5-C/E: a v2 esperava null (sem produto, falso negativo). A caixa tem produto: os 7 títulos com coleção e "Charizard ex
  // Brilhante" do ramo data estão em sv4_5-colecao_ex-charizard. Associação anterior e nova: matching-v3-charizard-brilhante-tests.
  assert.equal(id('Pokémon Box Coleção Charizard ex Brilhante', 'https://tiocharles.com.br/produtos/pokemon-box-colecao-charizard-ex-brilhante/'), 'sv4_5-colecao_ex-charizard');
  fica({
    'Pokémon Box Coleção Charizard ex Em Dobro': 'avulsos-colecao_ex-charizard',
    'Pokemon Box - Coleção Charizard Ex em Dobro': 'avulsos-colecao_ex-charizard',
    'Carta Pokemon Box Charizard EX - Copag': 'avulsos-colecao_ex-charizard', // hipótese (sem "em Dobro"), fica como está
    'Box Pokémon Destinos de Paldea Charizard Ex Brilhante': 'sv4_5-colecao_ex-charizard',
    'Pokémon EV4.5 Box Charizard Ex Brilhante - Copag': 'sv4_5-colecao_ex-charizard',
    'BOX POKÉMON COLEÇÃO CHARIZARD EX EM DOBRO COPAG 64 CARTAS TCG BOOSTER CHARMANDER CHARMELEON EV9 JOGO': 'sv9-colecao_ex-charizard',
  });
});

t('6. "Destinos Paradoxais": cada caixa no seu produto, kit sem produto', () => {
  vai([['Pokémon TCG - Coleção Ex Destinos Paradoxais - Fogo Corrosão', 'https://www.dalaran.com.br/pokemon-tcg-colecao-ex-destinos-paradoxais-fogo-corrosao']], 'avulsos-colecao_ex-corrosao');
  vai([['Pokémon TCG - Coleção Ex Destinos Paradoxais - Chifres Férreos', 'https://www.dalaran.com.br/pokemon-tcg-colecao-ex-destinos-paradoxais-']], 'avulsos-colecao_ex-ferreos');
  assert.equal(id('Pokémon Kit Box Coleção ex Destinos Paradoxais', 'https://tiocharles.com.br/produtos/pokemon-kit-box-colecao-ex-destinos-paradoxais/'), null);
  fica({
    'Pokémon Box Destinos Paradoxais Chifres Férreos Ex - Copag': 'avulsos-colecao_ex-ferreos',
    'Pokémon Box Destinos Paradoxais Raio de Fúria Ex - Copag': 'avulsos-colecao_ex-furia',
    'Box Coleção Raio Furia EX Destinos Paradoxais Pokémon TCG': 'avulsos-colecao_ex-furia',
  });
  // T5-C/C: a asserção antiga ('avulsos-colecao_ex-paradoxais') fixava a variante tirada do nome da linha ("Paradoxais EX"), que
  // junta qualquer caixa escrita "Destinos Paradoxais EX <caixa>". A Rocha Férrea já tem id próprio no catálogo automático,
  // avulsos-colecao_ex-ferrea (omniverse "Destinos Paradoxais - Box Rocha Férrea ex", 17/10); vai para ele.
  assert.equal(id('Pokémon Box Destinos Paradoxais EX Rocha Férrea Futurista 3707 - Copag'), 'avulsos-colecao_ex-ferrea');
});

t('7. "Kit com N Box" é kit montado pela loja, não a caixa', () => {
  for (const title of ['Kit com 3 Box Pokémon Coleção EX Equipe Rocket (Mewtwo + Nidoking + Persian)',
    'Kit com 2 Box Ilustração Parceiro Inicial Série 1 Pokémon 30 Anos – Original Lacrado',
    'Kit com 3 Box Ilustração Parceiro Inicial Série 1 Pokémon 30 Anos – Original Lacrado']) {
    const r = m(title);
    assert.equal(r.productId, null, title);
    assert.ok(r.why.includes('kit montado pela loja ou caixa com várias unidades'), title);
  }
  fica({
    'Box Ilustração Parceiro Inicial Série 1 Pokémon 30 Anos – Original Lacrado': 'c30-colecao_ilustracao',
    'Pokémon Ferramentas de Treinador Squawkabilly ex Kit Com 92 Cartas e Boosters': 'avulsos-colecao_especial-ferramentas-de-treinador-squawkabilly',
  });
  // T5-C/B: a asserção antiga ('me04-blister3') fixava o defeito conhecido (o próprio comentário admitia): um kit de 2 blisters
  // (R$ 81,68) dentro do blister triplo unitário. "Kit com N <embalagem>" agora é kit montado pela loja, como "Kit com N Box".
  const kit2 = m('Kit com 2 Blister Triplo Caos Ascendente Charmeleon Pokémon Megaevolução');
  assert.equal(kit2.productId, null);
  assert.ok(kit2.why.includes('kit montado pela loja ou caixa com várias unidades'));
});

t('H3 (guarda): "Lendas Implacáveis Miraidon" nunca entra no produto da Lendas de Paldea', () => {
  // Título sintético: a caixa não existe no ramo data (25/10). Antes desta mudança ia para avulsos-colecao_ex-miraidon, que é a
  // "Lendas de Paldea Miraidon" (33017). Comportamento desejado e atual: sem produto, para revisão.
  const sint = 'Box Pokémon Lendas Implacáveis Miraidon';
  assert.notEqual(id(sint), 'avulsos-colecao_ex-miraidon');
  assert.equal(id(sint), null);
  assert.equal(id('Pokémon TCG - Coleção Lendas Implacáveis - Miraidon Ex'), null);
  // nem herda uma coleção que um dia tenha outra caixa Miraidon ex (só o Koraidon da linha herda: IMPLACAVEIS_HERDA)
  assert.equal(id(sint, undefined, { ...base, variantes: variantesDe([...IDS, 'sv10-colecao_ex-miraidon']) }), null);
  // a Paldea e os outros Miraidon não mudam
  fica({
    'Box Pokémon Lendas de Paldea - Miraidon EX - 33017 Copag': 'avulsos-colecao_ex-miraidon',
    'Box Pokémon Lendas De Paldea Miraidon Ex Copag': 'avulsos-colecao_ex-miraidon',
    'Box Pokémon Batalha De Liga Pokémon Miraidon Ex - 33598 - Copag': 'avulsos-deck-miraidon',
  });
});

t('H2 (não é colisão): Meowscarada "Parceiros de Paldea" fica onde está', () => {
  // Os 6 anúncios são a mesma caixa (33208); a irmã Quaquaval/Skeledirge mora em sv4_5 só por variante conhecida. Inconsistência
  // de coleção, não caixas diferentes juntas: sem mudança (trocar o id moveria histórico).
  fica({
    'Pokemom Box Parceiros De Paldea Meowscarada Ex Copag 33208': 'avulsos-colecao_ex-meowscarada',
    'Box Pokémon Parceiros De Paldea Meowscarada EX Copag': 'avulsos-colecao_ex-meowscarada',
    'Box Pokémon Parceiros De Paldea Quaquaval EX Copag': 'sv4_5-colecao_ex-quaquaval',
  });
});

console.log(`catalogo-colisoes-colecao-ex-tests: ok (${n} grupos)`);
