// Catálogo automático: todo anúncio lacrado de Pokémon vira um produto
// identificado por coleção + tipo + quantidade de boosters + variante (ex.: "Sylveon ex").
// Princípio: na dúvida, NÃO casa. Falso negativo custa menos que falso positivo.

export const normalize = (s = '') => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/(\d),(\d)/g, '$1.$2').replace(/[^a-z0-9/\s.,-]/g, ' ').replace(/\s+/g, ' ').trim();

const has = (t, re) => re.test(t);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRe = (alias) => new RegExp('(^|[^a-z0-9.])' + esc(alias).replace(/ /g, '\\s?') + '($|[^a-z0-9.]|\\.(?!\\d))');

// Brinquedo licenciado (figura, Funko, Pokébola de brinquedo, LEGO...): não é carta. Lata Pokébola/box seguem como TCG.
const TOY = /\b(funko|figuras?|bonecos?|lego|monopoly|playset|squish|pokedex|arena de combate|pops open|pikachu de combate|guia de personagens|meu parceiro pikachu|game ataque surpresa)\b|\b(clipe|cinto com) pokebola\b/;
const TOY_BALL = (t) => /\b(pokebola|poke ball)\b/.test(t) && !/\b(lata|box|colecao|boosters?|cartas|cards|tcg)\b/.test(t);
const CARTA_INICIO = /^(?:(?:pokemon|tcg|-)\s+)*(?:carta|card)\b(?!s)/;
const NUMERO_CARTA = /(?<![\d/])\d{1,3}\/\d{2,3}(?![\d/])/;
const EMBALAGEM = /\b(box|caixa|blisters?|latas?|minilatas?|boosters?|kit|baralho|deck|display|etb|treinador avancado|colecao (?:ex|premium|especial)|pacotes?)\b/;
const REJECT = [
  [/\b(usad[oa]s?|aberto|aberta|sem lacre|violad[oa]|avariad[oa]|caixa amassada|embalagem danificada)\b/, 'condição: não lacrado/usado'],
  [/\b(avulsas?|lote de cartas|cartas? aleatorias|sem repetidas|brilhantes? garantid|proxy|replica|nao original|similar|cartas? unitarias?)\b/, 'não é produto lacrado oficial'],
  // Carta avulsa com número de coleção ("Carta Pokémon TCG Alakazam ex (065/165) Coleção 151", 25/10/2026): caía na caixa
  // sv3_5-colecao_ex-alakazam (R$ 47,41 virou o menor preço da caixa) e criava produtos de caixa falsos (Golem, Venusaur, Wigglytuff).
  // Regra (T5-C): o anúncio COMEÇA por "carta"/"card" (depois de "Pokémon"/"TCG"), tem número de carta (65/165, 065/165) e não
  // fala de embalagem lacrada. "Box … com carta promo 065/165" e "Carta Pokemon Box Zacian EX" (loja que chama box de carta)
  // continuam sendo caixa; o código de loja "15606/36932" não é número de carta.
  [{ test: (t) => CARTA_INICIO.test(t) && NUMERO_CARTA.test(t) && !EMBALAGEM.test(t) }, 'carta avulsa, não é produto lacrado'],
  [/\b(sleeves?|shields?|protetor(es)? de cartas|binder avulso|pasta avulsa|deck ?box avulsa|playmat|tapete|porta ?cards?|toploader|case vazi[oa]|caixa vazi[oa]|vazi[oa]s?|pelucia|chaveiro|camiseta|caneca)\b/, 'acessório ou item não-TCG'],
];
// "Pasta Fichário Pokémon ...": fichário/pasta avulso. O produto lacrado é a "Coleção com Fichário" (box/coleção com boosters).
const DECK_BOX = /\b(deck ?box(es)?|porta ?deck|caixa (para|de) deck)\b/;
const SEALED_WITH_ACCESSORY = /\b(boosters?|blister|treinador avancado|elite trainer|etb|box|display|colecao|lata|minilata|baralho de batalha|deck de batalha|kit treinador)\b/;
const LOOSE_BINDER = (t) => /\b(pasta|fichario|binder)\b/.test(t) && !/\b(colecao|box|caixa|boosters?|pacotes?)\b/.test(t);
// Várias unidades no mesmo anúncio: "10 unidades", "2 Box ...", "Kit 3 Blister ...", "Kit 2". "Kit 6 Boosters" segue sendo combo.
const MULTI_UNIT = /^([2-9]|1\d) ?x? (box|boxes|caixas?|blisters?|latas?|minilatas?|baralhos?|colecoes|treinadore?s?|etbs?)\b|\bkit (de )?([2-9]|1\d)\b(?! ?(boosters?|pacotes?|envelopes?|cartas|cards))/;
// "Bundle" é lote, exceto no combo com a contagem de boosters escrita no título: "Combo de Booster / Bundle (18 Boosters)".
const BUNDLE = /\bbundle\b/;
const bundleIsCombo = (d) => d.type === 'combo' && d.boosters > 0 && !d.inferred;
// "Box + Fichário", "Box ... + Poster": o acessório depois do "+" é parte da própria coleção com fichário/pôster.
const OWN_ACCESSORY = { colecao_fichario: /^(com )?(fichario|binder)\b/, colecao_poster: /^(com )?poster\b/ };
const UNITS = /\b(\d{1,3}) ?(unidades|unidade|unids?|unds?|un)\b/;

// Idioma só por evidência explícita no título (palavra ou abreviação). Nunca pelo nome/domínio da loja
// nem por nome de coleção em inglês. Sem evidência: code null ("não informado"), sem presumir PT.
const LANG_TOKENS = {
  pt: ['portugues', 'portuguesa', 'pt', 'ptbr', 'pt-br'],
  en: ['ingles', 'inglesa', 'english', 'eng', 'en', 'ing'],
  ja: ['japones', 'japonesa', 'japanese', 'japao', 'japan', 'jpn', 'jap', 'jp'],
  ko: ['coreano', 'coreana', 'korean', 'kor', 'kr'],
  zh: ['chines', 'chinesa', 'chinese', 'cn'],
  es: ['espanhol', 'espanhola', 'spanish', 'espanol', 'espanola', 'castellano', 'es-es'],
  fr: ['frances', 'francesa', 'french', 'francais', 'francaise', 'fr', 'fr-fr'],
  de: ['alemao', 'alema', 'german', 'deutsch', 'deutsche', 'de-de'],
  it: ['italiano', 'italiana', 'italian', 'ita', 'it-it'],
};
// "es", "de" e "it" soltos são ambíguos ("Coleção de ...", "it" do inglês): só valem como último token do título
// ("Booster Box ... 36 boosters ES").
const LANG_TAIL = { es: ['es'], de: ['de'], it: ['it'] };
// Hífen é fronteira (como o \b da regra antiga): "EN-US" -> en, "JP-JA" -> ja, "Inglês-EN" -> en.
// Token mais longo primeiro, para "pt-br" sair como evidência inteira em vez de só "pt".
const alt = (v) => [...v].sort((a, b) => b.length - a.length).map(esc).join('|');
const LANG_RE = new Map(Object.entries(LANG_TOKENS).map(([k, v]) => [k, new RegExp('(?:^|[^a-z0-9])(' + alt(v) + ')(?![a-z0-9])'
  + (LANG_TAIL[k] ? '|(?:^|[^a-z0-9])(' + alt(LANG_TAIL[k]) + ')[^a-z0-9]*$' : ''))]));
/** t normalizado -> { code, evidence, conflict, found }. code só quando UM idioma aparece; conflict quando aparecem dois ou mais. */
export function detectLanguage(t) {
  const found = [];
  for (const [code, re] of LANG_RE) { const m = re.exec(t); if (m) found.push({ code, evidence: m[1] || m[2] }); }
  if (!found.length) return { code: null, evidence: null, conflict: false, found: [] };
  if (found.length > 1) return { code: null, evidence: null, conflict: true, found };
  return { code: found[0].code, evidence: found[0].evidence, conflict: false, found };
}


export const TYPE_LABEL = {
  booster_box: 'Booster Box', combo: 'Combo de Booster', etb: 'Treinador Avançado (ETB)', booster_pack: 'Booster unitário',
  blister_1: 'Blister Unitário', blister_2: 'Blister Duplo', blister_3: 'Blister Triplo', blister_4: 'Blister Quádruplo',
  minilata: 'Minilata', lata: 'Lata', deck: 'Baralho de Batalha', desafio: 'Desafio Estratégico',
  colecao: 'Box Coleção', colecao_premium: 'Coleção Premium', colecao_especial: 'Coleção Especial', colecao_ex: 'Box Pokémon ex',
  colecao_poster: 'Coleção com Pôster', colecao_fichario: 'Coleção com Fichário', colecao_miniatura: 'Coleção com Miniatura',
  colecao_porta_retrato: 'Coleção Premium Porta-Retrato', colecao_ilustracao: 'Coleção Ilustração', kit_treinador: 'Kit Treinador',
};
export const TYPE_GROUP = {
  booster_box: 'Boosters', combo: 'Boosters', booster_pack: 'Boosters', etb: 'ETB',
  blister_1: 'Blisters', blister_2: 'Blisters', blister_3: 'Blisters', blister_4: 'Blisters',
  minilata: 'Latas', lata: 'Latas', deck: 'Baralhos', desafio: 'Baralhos', kit_treinador: 'Baralhos',
};
export const groupOf = (type) => TYPE_GROUP[type] || 'Coleções';

// Coleções lançadas (ou anunciadas) que ainda NÃO estão em config/catalog.json. Lista fechada e explícita, sem similaridade
// textual: o nome no título normalizado (acento já removido; espaço, hífen ou nada entre as palavras) impede o fallback para a
// coleção base da série, como o código de expansão. Não cria produto: o anúncio fica sem coleção até o catálogo ganhar a
// coleção (aí o alias dela casa antes, em `hits`, e esta lista deixa de ter efeito para ela). Retire a entrada nessa hora.
export const FORA_DO_CATALOGO = Object.freeze([
  { id: 'me06', nome: 'Reinado Delta', serie: 'Megaevolução', re: /\breinado[\s/.-]{0,3}delta\b/ },
]);
const CODIGO_SERIE = /\b(?:me|sv|swsh)\s?0*\d+(?:[.,]\d+)?\b/;
export function detectCollection(t, collections) {
  // langAliases: nome da coleção em outro idioma ({ en: ['surging sparks'], ja: [...] }). Casar só por ele dá a pista
  // do idioma (langHint), usada quando o título não diz o idioma.
  const viaPt = (c) => (c.aliases || []).some((a) => wordRe(a).test(t));
  const viaLang = (c) => Object.entries(c.langAliases || {}).find(([, v]) => v.some((a) => wordRe(a).test(t)))?.[0] || null;
  const hits = collections.filter((c) => viaPt(c) || viaLang(c));
  if (hits.length === 1) return viaPt(hits[0]) ? { id: hits[0].id } : { id: hits[0].id, langHint: viaLang(hits[0]) };
  if (hits.length > 1) {
    // Produto conjunto (ex.: "Fogo Branco e Raio Preto"): só quando o título cita exatamente as coleções combinadas.
    const ids = hits.map((h) => h.id).sort().join('|');
    const combo = collections.find((c) => c.combines && [...c.combines].sort().join('|') === ids);
    if (combo) return { id: combo.id };
    return { id: null, ambiguous: hits.map((h) => h.id) };
  }
  // Alias de fallback seguido de número ("Mega Evolução 99") é coleção numerada fora dos aliases: não cai no fallback.
  // Código de expansão no título (ME06, SV10, SWSH12) que nenhum alias reconheceu = coleção fora do catálogo: o nome
  // da série ("Megaevolução - Reinado Delta (ME06)") não pode jogar a oferta na coleção base da série (ME01).
  if (CODIGO_SERIE.test(t)) return { id: null };
  // Mesmo efeito pelo NOME de uma coleção conhecida que está fora do catálogo (E6-M, 25/10/2026): "Combo de Boosters -
  // Megaevolução Reinado Delta" (moxland, sem o código ME06) caía em me01-combo pelo fallbackAlias "megaevolucao".
  if (FORA_DO_CATALOGO.some((c) => c.re.test(t))) return { id: null };
  const fb =collections.filter((c) => (c.fallbackAliases || []).some((a) => wordRe(a).test(t) && !new RegExp(esc(a).replace(/ /g, '\\s?') + '\\s?0*\\d+(?!\\d|\\s?(?:cartas?|cards?|boosters?|pacotes?|envelopes?|packs?|un|unidades?|blisters?|x)\\b)').test(t)));
  return fb.length === 1 ? { id: fb[0].id, fallback: true } : { id: null };
}

export function detectBoosters(t) {
  // "36 boosters", "c/36", "36 pacotes", "36un". NUNCA "36 cartas".
  let m = t.match(/\b(\d{1,2})\s*(boosters?|pacotes?( de booster)?|envelopes?|packs?)\b/) || t.match(/\bc\/\s?(\d{1,2})\b(?!\s*cart)/)
    || (/\bbooster/.test(t) && t.match(/\b(\d{2})\s?(un|unid|unidades)\b/));
  if (m) return { count: Number(m[1]), inferred: false };
  const words = { seis: 6, dez: 10, doze: 12, dezoito: 18, vinte: 20 };
  m = t.match(/\b(seis|dez|doze|dezoito|vinte) (boosters?|pacotes?)\b/);
  if (m) return { count: words[m[1]], inferred: false };
  // Nomenclatura Copag: "Box Display" / "Booster Display" / "Caixa de Booster" = 36 boosters
  if (/\b(box display|booster display|display de booster|caixa de boosters?|expositor de pacotes)\b/.test(t)) return { count: 36, inferred: true };
  m = t.match(/\b(108|144|216)\s*(cartas|cards)\b/);
  const map = { 108: 18, 144: 24, 216: 36 };
  if (m && has(t, /\b(box|display|caixa|combo|kit)\b/)) return { count: map[m[1]], inferred: true };
  return { count: null, inferred: false };
}

// 'lendas' (24/10/2026): "Coleção Ex Lendas Azuis" sem o Pokémon virava avulsos-colecao_ex-lendas (linha, não Pokémon).
const VARIANT_STOP = new Set(['lendas', 'box', 'colecao', 'pokemon', 'de', 'da', 'do', 'com', 'e', 'tcg', 'mega', 'cartas', 'copag', 'booster', 'premium', 'especial', 'estampas', 'ilustradas', 'sortidas', 'sortidos', 'sortida', 'sortido', 'modelos', 'variados', 'brilhante', 'brilhantes', 'jumbo']);
// Baralho/Deck de Batalha (24/10/2026): "Baralho de Batalha ex Melmetal" pegava "batalha" como Pokémon (padrão "<nome> ex")
// e juntava baralhos diferentes num produto só (…-deck-batalha). Só para esses títulos: o nome vem depois de "ex" (com ou sem
// hífen) ou no fim depois de " - "; kit com dois baralhos ("Melmetal e
// Houndoom") é outro produto e fica sem variante.
const DECK_BATALHA = /\b(baralho|deck) (de )?batalha\b/;
const DECK_STOP = new Set([...VARIANT_STOP, 'batalha', 'baralho', 'deck', 'ex', 'cartas', 'card', 'cards', 'unidade', 'un', 'amazonia', 'original', 'lacrado', 'pt', 'br', 'ptbr', 'ref', 'kit', 'liga', 'rivais', 'deluxe', 'ultra', 'rara', 'oficial', 'jgs', 'carta', 'jogo']);
const nomeOk = (w) => w && /^[a-z]{3,}$/.test(w) && !DECK_STOP.has(w);
function deckVariant(t) {
  if (/\bex (?:- )?[a-z][a-z-]{2,} e [a-z][a-z-]{2,}\b/.test(t) || /\b[a-z]{3,} e [a-z]{3,} ex\b/.test(t)) return null; // dois baralhos no mesmo anúncio
  // Uma palavra, sem hífen, como a variante sempre foi gerada ("Chien-Pao" → pao): muda o produto, nunca o id existente.
  const pega = (a) => (nomeOk(a) ? a : null);
  const mega = /\bmega\b(?! evolu)/.test(t) ? 'mega-' : '';
  // 1º o padrão antigo "<nome> ex" ("Melmetal Ex", "Mega Lucario EX"), agora sem "batalha"/"liga" como nome
  for (const x of t.matchAll(/\b(?:mega )?([a-z]{3,}) ex\b/g)) if (nomeOk(x[1])) return mega + x[1];
  for (const m of t.matchAll(/\bex (?:- )?(?:mega )?([a-z]+)/g)) { const v = pega(m[1]); if (v) return mega + v; }
  const fim = t.match(/ - (?:mega )?([a-z]+)(?: [a-z]+)?(?: ex)?\s*$/); if (fim && pega(fim[1])) return mega + fim[1];
  return null;
}
// Grafias erradas de nome de Pokémon vistas em anúncios reais (24/10/2026: "Xarneas EX" na tavernadorei criava o produto
// avulsos-colecao_ex-xarneas, duplicado do Xerneas). A variante vai para a grafia certa; o produto antigo guarda o histórico.
const GRAFIA = Object.freeze({ xarneas: 'xerneas' });
const grafia = (v) => (v ? v.replace(/(^|-)([a-z]+)$/, (m, p, w) => p + (GRAFIA[w] || w)) : v);
function detectVariant(t) { return grafia(detectVariant0(t)); }
// "Coleção Ex Destinos Paradoxais" (25/10/2026): "destinos"/"paradoxais" (nome da linha) viravam a variante e juntavam caixas
// diferentes (avulsos-colecao_ex-destinos: Fogo Corrosão + Chifres Férreos + kit; -paradoxais: "Destinos Paradoxais EX Rocha
// Férrea"). A v2 pegava a última palavra do título, frágil a sufixo de loja ("- Copag", "(PT-BR)", "| Loja") e criava
// avulsos-colecao_ex-kit. Lista fechada das 4 caixas (T5-C), com as variantes que já são ids do catálogo automático
// (avulsos-colecao_ex-furia/-ferreos/-corrosao/-ferrea). Nenhuma ou mais de uma caixa no título: sem variante (sem produto).
const DESTINOS_PARADOXAIS = /\bdestinos paradoxais\b/;
const CAIXAS_PARADOXAIS = [[/\braio (?:de )?furia\b/, 'furia'], [/\bchifres? f(?:e| )?rreos?\b/, 'ferreos'],
  [/\bfogo (?:de )?corros(?:ao| o)\b/, 'corrosao'], [/\brocha f(?:e| )?rrea\b/, 'ferrea']];
function caixaParadoxais(t) { const v = CAIXAS_PARADOXAIS.filter(([re]) => re.test(t)).map(([, x]) => x); return v.length === 1 ? v[0] : null; }
function detectVariant0(t) {
  if (DECK_BATALHA.test(t)) return deckVariant(t);
  if (DESTINOS_PARADOXAIS.test(t)) return caixaParadoxais(t);
  if (/\bou\b/.test(t) && /\bex\b/.test(t) || /\bsortid/.test(t)) return null; // "Zapdos ex ou Alakazam ex": a loja escolhe qual vem
  const mega = /\bmega\b(?! evolu)/.test(t) ? 'mega-' : ''; // "mega" em qualquer posição ("Greninja ex mega")
  // Todo "<nome> ex" do título, o primeiro que não é palavra genérica ("Coleção EX Lendas Azuis - Xerneas EX" → xerneas).
  for (const x of t.matchAll(/\b(?:mega )?([a-z]{3,}) ex\b/g)) if (!VARIANT_STOP.has(x[1])) return mega + x[1];
  // "Coleção Ex Lendas Implacáveis - Zacian" (24/10/2026): "lendas" virava o nome e juntava Zacian e Koraidon num produto
  // só (avulsos-colecao_ex-lendas). Linha "Lendas Implacáveis": o nome vem logo depois (com ou sem ":" e " - ").
  // Hífen no lugar do espaço ("Lendas-Implacáveis Zacian") é a mesma linha (25/10/2026, revisão da v2).
  const li = t.match(/\blendas[ -]implacaveis:? (?:- )?(?:ex )?([a-z]{3,})\b/);
  if (li) return VARIANT_STOP.has(li[1]) || li[1] === 'ex' ? null : mega + li[1];
  let m = t.match(/\bex (?:mega )?([a-z]{3,})\b/); // "Box Pokémon Ex Greninja"
  if (m && !VARIANT_STOP.has(m[1])) return mega + m[1];
  return null;
}

const GENERIC_OK = new Set(['pokemon', 'tcg', 'copag', 'box', 'colecao', 'caixa', 'de', 'da', 'do', 'das', 'dos', 'com', 'e', 'original', 'originais', 'lacrado', 'lacrada', 'br', 'pt', 'ptbr', 'pt-br', 'cartas', 'carta', 'cards', 'card', 'booster', 'boosters', 'pacote', 'pacotes', 'escarlate', 'violeta', 'megaevolucao', 'mega', 'evolucao', 'estampas', 'ilustradas', 'jogo', 'game', 'trading', 'oficial', 'novo', 'nova', '-', 'tcg.', 'colecionavel', 'em', 'portugues']);
/** -> { type, boosters, inferred, variant } ou { type: null } */
export function detectType(t) {
  const b = detectBoosters(t);
  const r = (type, boosters = null, inferred = false, variant = null) => ({ type, boosters, inferred, variant });
  if (has(t, /\b(treinador avancado|elite trainer|etb)\b/)) return r('etb', b.count, b.inferred);
  if (has(t, /\bblister (plast\.? |plastico )?(unitario|simples)\b|\bpacote unico\b/)) return r('blister_1', 1);
  if (has(t, /\b(blister|pacote) (duplo|dupla)\b|\b2 ?pack\b|\bdouble pack\b/)) return r('blister_2', 2);
  if (has(t, /\b(blister|pacote) (triplo|tripla)\b|\btriple blister\b|\b3 ?pack\b/)) return r('blister_3', 3);
  if (has(t, /\b(blister|pacote) (quadruplo|quadrupla)\b|\b4 ?pack\b/)) return r('blister_4', 4);
  // Padrão de varejo (Arena Games e outras): "Booster Escuridão Absoluta (216 Cartas) (36 Boosters)", "Blister … (6 Cartas)
  // (01 Blister Sortido)", "Booster … (6 Cartas) (01 Booster)". Contagem de cartas fecha com a de boosters (6 por pacote).
  // Só 36: caixa de 18 boosters ainda não tem formato no catálogo (decisão pendente da revisão humana).
  if (has(t, /\bbooster/) && b.count === 36 && !b.inferred && has(t, new RegExp(`\\b${b.count * 6} (cartas|cards)\\b`)) && !has(t, /\b(combo|kit|blister|treinador|etb)\b/)) return r('booster_box', b.count);
  if (has(t, /\bblister\b/) && has(t, /\b(6 (cartas|cards)|0?1 blister)\b/) && !has(t, /\b(duplo|dupla|triplo|tripla|quadruplo|quadrupla|\d{2} (cartas|cards))\b/)) return r('blister_1', 1);
  if (has(t, /\bbooster\b/) && has(t, /\b(6 (cartas|cards)|0?1 booster)\b/) && !has(t, /\b(box|display|caixa|combo|kit|blister|\d+ boosters)\b/)) return r('booster_pack', 1);
  if (has(t, /\bmini ?latas?\b/)) return r('minilata');
  if (has(t, /\blatas?\b/)) return r('lata');
  // "Batalha de Liga" é linha de baralho (League Battle Deck): "Jogo de Cartas Copag Pokémon Batalha de Liga Mewtwo ex" não diz "baralho".
  if (has(t, /\b(baralho|deck) (de )?batalha\b|\bbaralho batalha\b|\bbatalha de liga\b/)) return r('deck', null, false, detectVariant(t));
  if (has(t, /\bdesafio estrategico\b/)) return r('desafio');
  if (has(t, /\bkit (do |de )?treinador\b/)) return r('kit_treinador');
  if (has(t, /\bcombo\b/)) return r('combo', b.count, b.inferred);
  // "Pokémon TCG Triplo Megaevolução Drifloon": triplo/quadruplo sozinho, sem box/coleção no título = blister
  if (!has(t, /\b(box|caixa|colecao|kit|lata|deck|baralho)\b/)) {
    if (has(t, /\b(triplo|tripla)\b/)) return r('blister_3', 3);
    if (has(t, /\b(quadruplo|quadrupla)\b/)) return r('blister_4', 4);
  }
  if (b.count >= 24 && has(t, /\b(booster box|display|caixa|kit|box|expositor)\b/)) return r('booster_box', b.count, b.inferred);
  // "Kit/caixa com N boosters" só vira combo se nada no título indicar outro formato (box ex, coleção, blister, fichário...).
  if (b.count >= 6 && has(t, /\b(kit|caixa|combo)\b/) && !has(t, /\b(box|colecao|blister|blisters|fichario|binder|poster|miniatura|lata|latas|ex|deck|baralho)\b/)) return r('combo', b.count, b.inferred);
  if (has(t, /\bbooster box\b/)) return r('booster_box', b.count, b.inferred); // sem contagem: não casa (18 ou 36?)
  if (has(t, /\b(booster unitario|pacote de booster|booster avulso|1 booster|booster com embalagem especial)\b/) || /^(pokemon )?(tcg )?booster\b/.test(t)) return r('booster_pack', 1);
  if (has(t, /\bposter\b/)) return r('colecao_poster', b.count);
  if (has(t, /\b(fichario|binder)\b/)) return r('colecao_fichario', b.count);
  if (has(t, /\bminiatura\b/)) return r('colecao_miniatura', b.count, false, detectVariant(t));
  if (has(t, /\bporta ?retrato\b/)) return r('colecao_porta_retrato', b.count);
  if (has(t, /\b(colecao|box) (de |pokemon )?ilustracao\b/)) return r('colecao_ilustracao', b.count, false, detectVariant(t));
  if (has(t, /\b(colecao|box) premium\b|\bultra ?premium\b/)) return r('colecao_premium', b.count, false, detectVariant(t));
  const v = detectVariant(t);
  if (v && has(t, /\b(box|colecao|caixa)\b/)) return r('colecao_ex', b.count, false, v);
  if (has(t, /\b(colecao|box) especial\b/)) return r('colecao_especial', b.count);
  if (has(t, /\b(box|caixa)( de)? colecao\b|\bcolecao\b.*\b(box|caixa)\b|\bbox\b.*\bcolecao\b|^colecao\b/)) {
    // "Coleção" genérica só casa quando o título não traz nenhum nome que diferencie a caixa
    // (ex.: "Coleção Dia de Pokémon", "Parceiros Iniciais", "Promo Eevee" são produtos diferentes).
    const extra = t.split(' ').filter((w) => !GENERIC_OK.has(w) && !/^\d{1,3}$/.test(w) && !/^(ev|sv|me|swsh|sm)\d/.test(w) && w.length > 1);
    if (extra.length) return r(null);
    return r('colecao', b.count);
  }
  return r(null);
}

// "Reservado" não é pré-venda: "reserva" só casa a palavra inteira.
export function detectStock(t) {
  if (has(t, /\b(pre ?venda|pre-venda|pre[- ]?order|pre[- ]?lancamento|encomenda|lancamento previsto|reserva)\b/)) return 'PRE_ORDER';
  return null;
}

const SHORT = { booster_box: (n) => `box${n}`, combo: (n) => (n ? `combo${n}` : 'combo'), etb: () => 'etb', booster_pack: () => 'booster',
  blister_1: () => 'blister1', blister_2: () => 'blister2', blister_3: () => 'blister3', blister_4: () => 'blister4' };
/** Idiomas importados aceitos: código → rótulo. Produto importado = id do produto PT + "-<código>". */
export const IMPORT_LANGS = { en: 'Inglês', ja: 'Japonês', zh: 'Chinês', ko: 'Coreano' };
export const LANG_LABEL = { pt: 'Português', ...IMPORT_LANGS };
/** Idioma de um id de produto: o sufixo de importado, ou 'pt'. */
export const langOfId = (id) => { const m = String(id || '').match(/-(en|ja|zh|ko)$/); return m ? m[1] : 'pt'; };
export function productIdOf(collection, type, boosters, variant, lang = null) {
  const base = SHORT[type] ? SHORT[type](boosters) : type;
  return `${collection}-${base}${variant ? '-' + variant : ''}${lang && IMPORT_LANGS[lang] ? '-' + lang : ''}`;
}
/** Chaves para herdar o preço Copag: a variante (Sylveon ex / Greninja ex) e o combo sem contagem custam o mesmo. */
// Importado não herda preço Copag (não existe preço sugerido no Brasil para ele).
export const msrpKeys = (p) => langOfId(p.id) !== 'pt' ? [] : [...new Set([p.id, productIdOf(p.collection, p.type, p.boosters, null), p.type === 'combo' && !p.boosters ? productIdOf(p.collection, 'combo', null, null) : p.id])];

export function parseListing(title, catalog) {
  const t = normalize(title);
  const reasons = [];
  for (const [re, why] of REJECT) if (re.test(t)) reasons.push(why);
  if ((TOY.test(t) || TOY_BALL(t)) && !reasons.includes('acessório ou item não-TCG')) reasons.push('brinquedo, não é carta');
  // Deck box / porta-deck é acessório: "Deck Box Pokémon Mewtwo ex" casava com "Box Pokémon ex" (lacrado). Mesma regra do
  // classificador de acessórios (api/_lib/acessorios.mjs): com produto lacrado no nome ("Coleção ... com Deck Box") continua lacrado.
  if (DECK_BOX.test(t) && !SEALED_WITH_ACCESSORY.test(t.replace(/\bdeck ?box(es)?\b/g, ' ')) && !reasons.includes('acessório ou item não-TCG')) reasons.push('acessório ou item não-TCG');
  // Qualquer idioma que não seja PT (ou idiomas em conflito) nunca casa com o produto em português.
  const language = detectLanguage(t);
  // Importados (inglês, japonês, chinês, coreano) viram produto próprio, com sufixo de idioma e sem referência Copag.
  // Os demais idiomas e títulos com dois idiomas continuam recusados.
  if (language.conflict || (language.code && language.code !== 'pt' && !IMPORT_LANGS[language.code])) reasons.push('idioma diferente de PT');
  let lang = language.code && IMPORT_LANGS[language.code] ? language.code : null;
  // "Dados Treinador Avançado", "Moeda ... Celebração": acessório vendido à parte, não o produto lacrado.
  // Kit montado pela loja ("Kit ... + 6 Booster", "Kit 4 Booster Box ... Case Fechada"): não é o produto Copag.
  // "Kit com N <embalagem>" (N ≥ 2: box, blister, lata, baralho...) é kit de várias unidades, nunca a unidade (T5-C, 25/10/2026:
  // "Kit com 2 Blister Triplo … Charmeleon" casava com me04-blister3 a R$ 81,68). "Kit com 92 Cartas"/"Kit com 10 Boosters" não.
  // Mesmas variantes de escrita (rodada 2): "Kit c/ 2", "Kit com 02", "Kit 2x", "Kit de 2", "Kit com Duas Box".
  if ((/\bkit\b/.test(t) && /\b(fichario|binder|poster|pasta)\b/.test(t)) || /\bcase fechad[ao]\b|\bkit \d+ (booster box|box|displays?)\b|\bkit (?:com |c\/ ?|de )?(?:0?[2-9]|[1-9]\d|dois|duas|tres) ?x? (box(es)?|caixas?|blisters?|latas?|minilatas?|baralhos?|decks?|colecoes|etbs?|treinadore?s? avancados?)\b|\b\d+ (booster boxes|displays)\b/.test(t)) reasons.push('kit montado pela loja ou caixa com várias unidades');
  // "Case" (caixa master com várias boxes/ETBs) e "6x Booster Box" nunca são a unidade do catálogo.
  // "Case vazio/vazia" continua só como acessório (regra REJECT acima), sem esse segundo motivo.
  else if (/\bcase\b(?! vazi[oa]\b)|\b(caixa|box) master\b|\bmaster (case|box)\b|\b([2-9]|1\d) ?x? (booster box(es)?|box(es)? display|displays?|treinadore?s? avancados?|etbs?)\b/.test(t)) reasons.push('kit montado pela loja ou caixa com várias unidades');
  if (/\b(dados?|moedas?|marcadores?|contadores? de dano)\b/.test(t) && !/\b(boosters?|pacotes?|blister|colecao|box|treinador avancado com|etb com)\b/.test(t.replace(/\btreinador avancado\b/, ''))) reasons.push('acessório avulso (dados, moeda, marcador)');
  const col = detectCollection(t, catalog.collections);
  // Nome da coleção em outro idioma sem idioma no título ("Surging Sparks Booster Box"): vale o idioma do nome.
  // Título que diz português com nome em outro idioma é contraditório: recusa.
  if (col.langHint && !language.conflict) { if (language.code === 'pt') reasons.push('idioma diferente de PT'); else if (!language.code) lang = col.langHint; }
  if (!/\bpokemon\b/.test(t) && !/\bcopag\b/.test(t) && !col.id) reasons.push('não menciona Pokémon');
  if (col.ambiguous) reasons.push('mais de uma coleção no título: ' + col.ambiguous.join(', '));
  const colDef = catalog.collections.find((c) => c.id === col.id);
  let tt = t;
  for (const a of [...(colDef?.aliases || []), ...(colDef?.fallbackAliases || []), ...Object.values(colDef?.langAliases || {}).flat()].sort((x, y) => y.length - x.length)) tt = tt.replace(new RegExp(wordRe(a).source, 'g'), ' ');
  tt = tt.replace(/\s+/g, ' ').trim();
  const d = detectType(tt);
  if (LOOSE_BINDER(t)) reasons.push('acessório ou item não-TCG');
  // "N unidades" só é a contagem de boosters quando é o próprio conteúdo ("Booster Box 36 unidades"); senão é lote.
  const units = Number(t.match(UNITS)?.[1] || 0);
  const isContent = (d.type === 'booster_box' || d.type === 'combo') && (d.boosters === units || (d.boosters == null && units >= 6));
  if (!reasons.some((r) => /várias unidades/.test(r)) && (MULTI_UNIT.test(t) || (BUNDLE.test(t) && !bundleIsCombo(d)) || (units >= 2 && !isContent) || (d.type === 'booster_pack' && (detectBoosters(tt).count || 1) > 1)))
    reasons.push('kit montado pela loja ou caixa com várias unidades');
  // "Booster Box ... + Box Treinador Avançado": dois produtos no mesmo anúncio ("+" some na normalização, por isso o título original).
  if (String(title).split('+').slice(1).some((s) => { const n = normalize(s); return detectType(n).type && !OWN_ACCESSORY[d.type]?.test(n); })) reasons.push('mais de um produto no mesmo anúncio');
  return { normalized: t, collection: col.id, collectionFallback: !!col.fallback, type: d.type, boosters: d.boosters, boostersInferred: d.inferred, variant: d.variant, language, lang, preorder: detectStock(t) === 'PRE_ORDER', rejects: reasons };
}

export function describeProduct(catalog, collection, type, boosters, variant, lang = null) {
  const col = catalog.collections.find((c) => c.id === collection);
  const language = lang && IMPORT_LANGS[lang] ? lang : 'pt';
  const id = productIdOf(collection, type, boosters, variant, language === 'pt' ? null : language);
  const fixed = (catalog.products || []).find((p) => p.id === id) || {};
  const vName = variant ? variant.replace('mega-', 'Mega ').replace(/^./, (c) => c.toUpperCase()).replace(/ (.)/, (m) => m.toUpperCase()) + ' ex' : null;
  return {
    id, collection, collectionName: col?.name || (collection === 'avulsos' ? 'Box Pokémon' : collection), series: col?.series || null, type, typeLabel: TYPE_LABEL[type] || type, group: groupOf(type),
    boosters: boosters ?? fixed.boosters ?? null, variant: vName,
    name: `${col?.name || (collection === 'avulsos' ? 'Box Pokémon' : collection)} - ${TYPE_LABEL[type] || type}${boosters && (type === 'booster_box' || type === 'combo') ? ` ${boosters}` : ''}${vName ? ` ${vName}` : ''}${language !== 'pt' ? ` (${IMPORT_LANGS[language]})` : ''}`,
    ean: fixed.ean || null, language,
  };
}

export const normEan = (v) => String(v || '').replace(/\D/g, '').replace(/^0+/, '');

const REF_COPAG = /(?<!\d)(3\d{4})(?!\d)/g;
function porRef(listing, catalog, p) {
  const refs = catalog?.refs; if (!refs) return null;
  const achados = [...new Set(String(`${listing.title || ''} ${listing.sku || ''}`).match(REF_COPAG) || [])].map((c) => refs[c]).filter(Boolean);
  const ids = [...new Set(achados.map((r) => r.productId))]; if (ids.length !== 1) return null;
  const r = achados[0];
  if ((p.collection && p.collection !== r.collection) || (p.type && p.type !== r.type)) return null;
  if (!catalog.collections?.some((c) => c.id === r.collection)) return null;
  const prod = describeProduct(catalog, r.collection, r.type, r.boosters ?? null, null);
  if (prod.id !== r.productId) return null;
  return { productId: prod.id, product: prod, confidence: 0.75, parsed: p, why: [], via: 'ref-copag' };
}

export const AVULSOS = 'avulsos';
const AVULSO_TYPES = new Set(['colecao_ex', 'colecao_premium', 'colecao_ilustracao', 'colecao_miniatura', 'deck', 'colecao_especial']);
// Produtos especiais da Copag sem coleção no título (24/10/2026): nome próprio → tipo + variante. Só com o nome que
// separa uma edição da outra (Ferramentas de Treinador precisa do Pokémon ex; Parceiro Inicial precisa da série).
const NOME = '([a-z]{3,})';
const ESPECIAIS = [
  [/\b(ferramentas de treinador|trainer'?s? toolkit)\b/, (t) => { const v = detectVariant(t); return v && { type: 'colecao_especial', variant: 'ferramentas-de-treinador-' + v.replace(/^mega-/, '') }; }],
  [/\b(parceiro inicial|first partner)\b/, (t) => { const m = t.match(/\b(serie|series) (\d)\b/); return m && { type: 'colecao_ilustracao', variant: 'parceiro-inicial-serie-' + m[2] }; }],
  [/\bcolecao de torneios?\b/, (t) => { const m = t.match(new RegExp('\\bcolecao de torneios? ' + NOME + '\\b')); return m && { type: 'colecao_especial', variant: 'torneio-' + m[1] }; }],
  [/\bmega luar\b/, (t) => { const m = t.match(new RegExp('\\bmega luar (?:- )?(?:mega )?' + NOME + '\\b')); return m && { type: 'colecao_especial', variant: 'mega-luar-' + m[1] }; }],
  [/\bdia de pokemon\b/, (t) => { const m = t.match(/\bdia de pokemon (20\d\d)\b/); return m && { type: 'colecao_especial', variant: 'dia-de-pokemon-' + m[1] }; }],
  [/\bdeck de batalha\b.*\bdeluxe\b|\bdeluxe\b.*\bdeck de batalha\b/, (t) => { const m = t.match(new RegExp('\\bdeluxe ' + NOME + '\\b')); return m && { type: 'deck', variant: 'deluxe-' + m[1] }; }],
  [/\b(colecao|box) (de |pokemon )?ilustracao\b/, (t) => { const m = t.match(new RegExp('\\bilustracao (?:- )?' + NOME + '\\b')); return m && !VARIANT_STOP.has(m[1]) && { type: 'colecao_ilustracao', variant: m[1] }; }],
];
export function especial(t) { for (const [re, f] of ESPECIAIS) if (re.test(t)) { const r = f(t); if (r) return r; } return null; }
/** Mapa "tipo|variante" → coleção, a partir dos ids do catálogo automático (data/products.json): só quando é única. */
export function variantesDe(ids = []) {
  const by = new Map();
  for (const id of ids) { const m = String(id).match(/^([a-z0-9_]+)-(colecao_ex|colecao_premium|colecao_ilustracao|colecao_miniatura|deck)-([a-z-]+)$/); if (!m || m[1] === AVULSOS) continue;
    const k = `${m[2]}|${m[3]}`; const s = by.get(k) || new Set(); s.add(m[1]); by.set(k, s); }
  return Object.fromEntries([...by].filter(([, s]) => s.size === 1).map(([k, s]) => [k, [...s][0]]));
}

// Variante conhecida (catalog.variantes) vale para título sem coleção, mas algumas linhas Copag têm o mesmo Pokémon em outra
// caixa (25/10/2026, auditoria do ramo data):
// - "Lendas de Paldea": nunca herda.
// - "Lendas Implacáveis" (35239, Koraidon/Zacian, 38 cartas): só o Koraidon herda (sv10-colecao_ex-koraidon já é essa caixa).
//   sv9-colecao_ex-zacian é a "Zacian ex do Lupo" (35263, Amigos de Jornada, 40 cartas): a Zacian Implacáveis fica no avulso.
// - "Coleção (EX) Equipe Rocket <Pokémon> Ex" (35880, Mewtwo/Nidoking/Persian, 49 cartas) não é a "Mewtwo ex da Equipe Rocket"
//   (35579, 40 cartas) de sv10-colecao_ex-mewtwo: fica no avulso, como as irmãs Nidoking e Persian.
// "Implac?veis" (facilshopping, acento perdido na loja), "Lendas-Implacáveis" (hífen sobrevive à normalização) e o código
// Copag da caixa (35239) sem o nome da linha: "Box Zacian ex 35239" caía no Lupo (35263) pela variante conhecida.
const LENDAS_IMPLACAVEIS = /\blendas[ -]implac(?:a| )?veis\b|(?<!\d)35239(?!\d)/;
// "Lendas de Paldea", também sem o "de" ("Lendas Paldea Koraidon") e com hífen ("Lendas-de-Paldea"), e o código Copag da
// Miraidon Paldea (33017, título real "Box Pokémon Lendas de Paldea - Miraidon EX - 33017 Copag"): sem o nome da linha, o código
// basta para nunca herdar uma futura caixa Miraidon de coleção (T5-C rodada 2). O 33016 não entra: sem evidência.
const LENDAS_DE_PALDEA = /\blendas[ -](?:de[ -])?paldea\b|(?<!\d)33017(?!\d)/;
const IMPLACAVEIS_HERDA = new Set(['koraidon']);
const PALDEA_NO_AVULSO = new Set(['miraidon']);
// Também com hífen ("Coleção Equipe Rocket - Mewtwo Ex") e pelo código Copag sem o formato do nome ("Equipe Rocket Mewtwo Ex 35880").
const EQUIPE_ROCKET_35880 = /\bcolecao (?:ex )?equipe rocket (?:- )?(?:mega )?[a-z]{3,} ex\b|(?<!\d)35880(?!\d)/;
// Caixa 35880 cujo Pokémon tem OUTRA caixa conhecida (Mewtwo: sv10-colecao_ex-mewtwo é a 35579). A 35880 já tem produto no
// catálogo automático, colecao_ex-equipe (sv10-colecao_ex-equipe: "Coleção Ex Equipe Rocket Copag 35880", "… - MewTwo"):
// vai para ele, sem criar avulso novo (T5-C). Sem esse produto no catálogo: sem produto, para revisão (nunca a 35579).
// Nidoking/Persian (sem outra caixa) continuam no avulso de sempre (avulsos-colecao_ex-nidoking/-persian, ids existentes).
const EQUIPE = 'equipe';
const IMPORTADO_SEM_PRODUTO = 'importado sem produto identificado no idioma';
function caixa35880(p, n, catalog) {
  if (p.type !== 'colecao_ex' || !p.variant || p.variant === EQUIPE || !EQUIPE_ROCKET_35880.test(n)) return undefined;
  const outra = catalog?.variantes?.[`colecao_ex|${p.variant}`];
  if (!outra || (p.collection && p.collection !== outra)) return undefined;
  if (p.lang) return { productId: null, confidence: 0, parsed: p, why: [IMPORTADO_SEM_PRODUTO] };
  const col = catalog?.variantes?.[`colecao_ex|${EQUIPE}`];
  if (!col || (p.collection && p.collection !== col)) return { productId: null, confidence: 0, parsed: p, why: ['coleção não identificada'] };
  const prod = describeProduct(catalog, col, 'colecao_ex', p.boosters, EQUIPE, null);
  return { productId: prod.id, product: prod, confidence: 0.7, parsed: p, why: [], via: 'caixa-35880' };
}
function herdaColecao(n, variant) {
  if (LENDAS_DE_PALDEA.test(n) || (EQUIPE_ROCKET_35880.test(n) && variant !== EQUIPE)) return false;
  if (LENDAS_IMPLACAVEIS.test(n)) return IMPLACAVEIS_HERDA.has(variant);
  return true;
}
// Código Copag de cada caixa que mora num id herdado por variante conhecida (títulos reais do ramo data: "Lendas Implacáveis
// Koraidon … 35239", "Zacian Ex Do Lupo Copag 35263", "Mewtwo EX da Equipe Rocket 35579"). Título com código Copag (3xxxx) e
// nenhum deles igual ao da caixa herdada não herda.
const CODIGO_DA_CAIXA = Object.freeze({ 'colecao_ex|koraidon': '35239', 'colecao_ex|zacian': '35263', 'colecao_ex|mewtwo': '35579' });
function codigoDiverge(listing, chave) {
  const esperado = CODIGO_DA_CAIXA[chave]; if (!esperado) return false;
  const cods = String(listing.title || '').match(/(?<![\d/-])3\d{4}(?![\d/])/g);
  return !!cods && !cods.includes(esperado);
}
const BRILHANTE_COL = 'sv4_5';
const BRILHANTE_SV4_5 = new Set(['charizard']);
const semAcento = (s = '') => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
// Duas caixas num anúncio só, ligadas por "&", "+" ou "/" (T5-C). Os símbolos somem na normalização: lê o título original.
// - "&": "<A> ex & <B>" ou "<A> & <B> ex" ("Greninja & Kingdra Ex", "Mega Lucario Ex & Mega Gardevoir").
// - "+" e "/": só com "ex" do lado direito ("Greninja ex + Kingdra ex", "Greninja/Kingdra ex"); "<A> ex + Brinde/Envio..." não.
// Não são duas caixas: treinador + Pokémon ("Lillie & Clefairy ex", "Iono & Bellibolt ex", "Ash & Pikachu ex"), "Pikachu ex &
// Amigos", "Scarlet & Violet", entidade HTML (&amp;, &#8211;). Vale com ou sem coleção no título ("Fábulas Nebulosas Greninja &
// Kingdra ex" caía em sv6_5-colecao_ex-kingdra).
const TREINADORES = new Set(['lillie', 'lilian', 'iono', 'kissera', 'ash', 'cynthia', 'cintia', 'hop', 'lupo', 'marnie', 'steven', 'ethan',
  'arven', 'giovanni', 'misty', 'brock', 'erika', 'lauro', 'nemona', 'penny', 'larry', 'equipe', 'team', 'rocket']);
const NAO_POKEMON = new Set([...VARIANT_STOP, 'ex', 'amigos', 'amigo', 'friends', 'cia', 'brinde', 'brindes', 'promo', 'carta', 'card', 'cards',
  'boosters', 'pacotes', 'sleeves', 'shield', 'sword', 'scarlet', 'violet', 'escarlate', 'violeta', 'deck', 'baralho', 'moeda', 'pin', 'frete',
  'envio', 'oferta', 'presente', 'lacrado', 'original', 'oficial', 'jogo', 'kit', 'lata', 'blister', 'treinador', 'jumbo', 'mais', 'outros',
  // brinde/acessório do lado direito do "&" (rodada 2: "Charizard ex & Broche" ficava sem produto). Lista fechada: palavra fora dela
  // conta como Pokémon e o anúncio fica sem produto ("Kieran & Ogerpon ex": treinador fora de TREINADORES; lado seguro).
  'broche', 'broches', 'pins', 'moeda', 'moedas', 'marcador', 'marcadores', 'dado', 'dados', 'sleeve', 'adesivo', 'adesivos', 'poster',
  'chaveiro', 'caneca', 'camiseta', 'pelucia', 'figura', 'miniatura', 'bonus', 'extra', 'extras', 'pacote', 'protetor', 'protetores',
  'playmat', 'tapete', 'colecionador', 'colecionadores', 'surpresa']);
const PARES = [/\b([a-z]{3,}) ex ?& ?(?:mega )?([a-z]{3,})\b/g, /\b([a-z]{3,}) ?[&+/] ?(?:mega )?([a-z]{3,}) ex\b/g,
  /\b([a-z]{3,}) ex ?[&+/] ?(?:mega )?([a-z]{3,}) ex\b/g];
const pokemonDoPar = (w) => !NAO_POKEMON.has(w) && !TREINADORES.has(w);
function duasCaixas(title) {
  const s = semAcento(title).replace(/&(?:amp;)+/g, '&').replace(/&#?\w+;/g, ' ');
  return PARES.some((re) => [...s.matchAll(re)].some((x) => pokemonDoPar(x[1]) && pokemonDoPar(x[2])));
}

export function matchProduct(listing, catalog) {
  const p = parseListing(listing.title, catalog);
  // EAN cadastrado vence o título.
  const byEan = !p.lang && listing.ean && (catalog.products || []).find((x) => x.ean && normEan(x.ean) === normEan(listing.ean));
  if (p.rejects.length) return { productId: null, confidence: 0, parsed: p, why: p.rejects };
  if (byEan) {
    const prod = describeProduct(catalog, byEan.collection, byEan.type, byEan.boosters, null);
    return { productId: byEan.id, product: { ...prod, id: byEan.id }, confidence: 0.99, parsed: p, why: [] };
  }
  // Código de referência da Copag (config/refs-copag.json) quando o título não basta: só completa o que falta, nunca
  // contradiz coleção ou tipo lidos no título, e só com um produto possível.
  if (!p.lang && (!p.collection || !p.type || (p.type === 'booster_box' && !p.boosters))) { const r = porRef(listing, catalog, p); if (r) return r; }
  // Box/coleção com Pokémon em destaque ("Box Mega Zygarde ex") sem coleção no título: produto avulso da Copag. Se a
  // mesma caixa já existe numa coleção (catalog.variantes, montado do catálogo automático), vai para ela; senão, para a
  // pseudo-coleção "avulsos". Antes, 153 de 200 anúncios não casados (17/10) eram "coleção não identificada", muitos assim.
  // Duas caixas num anúncio só ("Box Greninja & Kingdra Ex", "Box Coleção Mega Lucario Ex & Mega Gardevoir", 25/10/2026): a
  // "<nome> ex" levava para a caixa de um Pokémon só e o preço dela (R$ 229,99) virava o menor da Kingdra. Ver duasCaixas.
  if (p.variant && AVULSO_TYPES.has(p.type) && duasCaixas(listing.title)) return { productId: null, confidence: 0, parsed: p, why: ['mais de um produto no mesmo anúncio'] };
  const c35880 = caixa35880(p, p.normalized, catalog); if (c35880) return c35880;
  if (!p.collection && p.variant && AVULSO_TYPES.has(p.type)) {
    const n = p.normalized;
    // "<Pokémon> ex Brilhante" é a linha de caixas da Destinos de Paldea (sv4_5): sem a coleção no título, "Charizard ex
    // Brilhante" juntava com a "Charizard ex em Dobro" em avulsos-colecao_ex-charizard (base) e a v2 a deixava sem produto.
    // T5-C: vai para a caixa sv4_5 quando a variante conhecida já é sv4_5 (Trilho Férreo, Presa Grande) ou está em
    // BRILHANTE_SV4_5 (Charizard: variante ambígua sv4_5/sv9; os 7 títulos com coleção e "Charizard ex Brilhante" do ramo data
    // estão todos em sv4_5-colecao_ex-charizard). Outro Pokémon "ex Brilhante" sem coleção: sem produto, para revisão.
    if (p.type === 'colecao_ex' && /\bex brilhante\b/.test(n)) {
      const col = catalog?.variantes?.[`colecao_ex|${p.variant}`] === BRILHANTE_COL || BRILHANTE_SV4_5.has(p.variant) ? BRILHANTE_COL : null;
      if (!col || p.lang) return { productId: null, confidence: 0, parsed: p, why: ['coleção não identificada'] };
      const prod = describeProduct(catalog, col, p.type, p.boosters, p.variant, null);
      return { productId: prod.id, product: prod, confidence: 0.7, parsed: p, why: [], via: 'brilhante-sv4_5' };
    }
    // "Lendas de Paldea" (Koraidon ex / Miraidon ex, Copag) é outra caixa, não a da "Lendas Implacáveis": não herda a coleção
    // de catalog.variantes (25/10/2026: 3 Koraidon Paldea caíam em sv10-colecao_ex-koraidon). Fica no avulso com a mesma
    // variante de sempre, então avulsos-colecao_ex-miraidon (que já é a Paldea) não muda de id nem perde histórico.
    // Outras linhas com o mesmo Pokémon em outra caixa: ver herdaColecao.
    const herda = herdaColecao(n, p.variant);
    const conhecida = (herda && catalog?.variantes?.[`${p.type}|${p.variant}`]) || null;
    // Importado ("Inglês", "EN"...) de uma caixa que NÃO herda a coleção conhecida (Paldea, Implacáveis, 35880): a regra de idioma
    // do projeto é id do produto PT + sufixo, e aqui o produto PT da caixa não está identificado. Sem produto, em vez de criar um
    // id novo (T5-C rodada 2: "Coleção Equipe Rocket Mewtwo Ex Inglês" criava avulsos-colecao_ex-mewtwo-en).
    if (!herda && p.lang && catalog?.variantes?.[`${p.type}|${p.variant}`]) return { productId: null, confidence: 0, parsed: p, why: [IMPORTADO_SEM_PRODUTO] };
    // Código Copag no título que não é o da caixa herdada: é outra caixa do mesmo Pokémon (T5-C rodada 2: "Box Koraidon ex 33016"
    // caía em sv10-colecao_ex-koraidon, que é a 35239). Sem produto, para revisão (não presume a qual caixa o código pertence).
    if (conhecida && codigoDiverge(listing, `${p.type}|${p.variant}`)) return { productId: null, confidence: 0, parsed: p, why: ['código Copag diverge da caixa conhecida'] };
    // Lendas Implacáveis sem coleção conhecida nunca cai no avulso de uma caixa Lendas de Paldea (risco: "Lendas Implacáveis
    // Miraidon" juntaria com avulsos-colecao_ex-miraidon). Fica sem produto, para revisão.
    if (!conhecida && LENDAS_IMPLACAVEIS.test(n) && PALDEA_NO_AVULSO.has(p.variant)) return { productId: null, confidence: 0, parsed: p, why: ['coleção não identificada'] };
    const prod = describeProduct(catalog, conhecida || AVULSOS, p.type, p.boosters, p.variant, p.lang);
    return { productId: prod.id, product: prod, confidence: conhecida ? 0.7 : 0.65, parsed: p, why: [], via: conhecida ? 'variante-conhecida' : 'avulso' };
  }
  if (!p.collection) {
    const e = especial(p.normalized);
    if (e) { const prod = describeProduct(catalog, AVULSOS, e.type, p.boosters, e.variant, p.lang); return { productId: prod.id, product: prod, confidence: 0.65, parsed: { ...p, type: e.type, variant: e.variant }, why: [], via: 'especial' }; }
    return { productId: null, confidence: 0, parsed: p, why: ['coleção não identificada'] };
  }
  if (!p.type) return { productId: null, confidence: 0, parsed: p, why: ['tipo de produto não identificado'] };
  if (p.type === 'booster_box' && !p.boosters) return { productId: null, confidence: 0, parsed: p, why: ['quantidade de boosters não informada'] };
  const prod = describeProduct(catalog, p.collection, p.type, p.boosters, p.variant, p.lang);
  const fixed = (catalog.products || []).find((x) => x.id === prod.id);
  if (fixed?.ean && listing.ean && normEan(fixed.ean) !== normEan(listing.ean)) return { productId: null, confidence: 0, parsed: p, why: ['EAN diverge do catálogo'] };
  let confidence = 0.8;
  if (p.boostersInferred) confidence -= 0.1;
  if (p.collectionFallback) confidence -= 0.1;
  if (/\b(lacrad[oa]|original|copag)\b/.test(p.normalized)) confidence += 0.05;
  if (p.preorder && p.collectionFallback) confidence = Math.min(confidence, 0.65);
  return { productId: prod.id, product: prod, confidence: Math.min(0.99, +confidence.toFixed(2)), parsed: p, why: [] };
}

/** Página canônica: host sem www + caminho, sem query/hash. Chave de revisão e de override. */
export function canonicalUrl(u) {
  try { const x = new URL(u); return `${x.hostname.toLowerCase().replace(/^www\./, '')}${x.pathname.replace(/\/+$/, '')}`; }
  catch { return String(u || '').trim().toLowerCase(); }
}

// Overrides de revisão humana (config/matching-overrides.json, gerado por tools/review.mjs export).
// Só valem com "enabled": true. Só resolvem dúvidas específicas: não passam por cima de idioma,
// acessório, kit, EAN divergente nem coleção diferente da que o título traz. A trava linkAgrees
// da rodada continua valendo depois.
const OVERRIDABLE = /^(tipo de produto não identificado|quantidade de boosters não informada|mais de uma coleção no título: .*)$/;
export function overridesIndex(file) {
  const idx = new Map();
  if (file?.enabled !== true || !Array.isArray(file.overrides)) return idx;
  for (const o of file.overrides) if (o?.store && o?.url && o?.productId) idx.set(`${o.store}|${o.url}`, o);
  return idx;
}
export function applyOverride(listing, storeId, m, catalog, idx) {
  if (!idx?.size) return m;
  const ov = idx.get(`${storeId}|${canonicalUrl(listing.url)}`);
  if (!ov || m.productId === ov.productId) return m;
  if (!m.productId && !(m.why?.length === 1 && OVERRIDABLE.test(m.why[0]))) return m;
  if (m.parsed?.collection && m.parsed.collection !== ov.collection) return m;
  // Override é cadastro de produto PT: anúncio importado nunca vira o produto PT por override.
  if (m.parsed?.lang || langOfId(m.productId) !== 'pt') return m;
  if (!catalog.collections.some((c) => c.id === ov.collection)) return m;
  const prod = describeProduct(catalog, ov.collection, ov.type, ov.boosters ?? null, ov.variant ?? null);
  if (prod.id !== ov.productId) return m;
  const fixed = (catalog.products || []).find((x) => x.id === prod.id);
  if (fixed?.ean && listing.ean && normEan(fixed.ean) !== normEan(listing.ean)) return m;
  return { productId: prod.id, product: prod, confidence: 0.8, parsed: m.parsed, why: [], override: ov.reviewId };
}
