// K5 do "Monte seu kit" (docs/monte-seu-kit.md §3): classificação de ACESSÓRIOS de carta pelo título, nas categorias que o
// banco já tem (db/migrations/002_seed.sql: protection.*, organization.*, gameplay.*). Função pura, ainda NÃO ligada ao
// robô nem ao ranking: lacrado nunca vira acessório e acessório nunca entra na nota/ranking de lacrados.
// "oficial" só com evidência no próprio título (marca licenciada + Pokémon); genérico nunca é marcado oficial. Nada de SKU
// inventado: código/EAN só se vier do anúncio (quem chama passa).
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

// Produto lacrado com acessório no nome ("Coleção com Fichário", "ETB com dados") continua lacrado.
// Conservador: "box" (fora "deck box") e "coleção" contam como lacrado ("Box + Fichário 30 Anos", "Coleção Fichário").
const LACRADO = /\b(boosters?|blister|treinador avancado|elite trainer|etb|box|display|colecao|lata|minilata|baralho de batalha|deck de batalha|kit treinador)\b/;
// Página avulsa de fichário: o título começa por página/folha ou diz "páginas para fichário". "Fichário … 9 bolsos" e "Pasta …
// 4 bolsos c/ 10 folhas" são o fichário (com páginas), não páginas avulsas.
const PAG = /^(paginas?|folhas?)\b|\b(paginas?|folhas?) (avulsas? )?(para|de) (fichario|pasta|binder)\b/;
// Ordem importa: o mais específico primeiro.
const REGRAS = [
  ['protection.top_loader', /\b(top ?loaders?|toploaders?)\b/],
  ['protection.magnetic_holder', /\b(magnetic|magnetico|one touch)\b/],
  ['protection.semi_rigid', /\b(card ?saver|semi ?rigido)\b/],
  ['protection.acrylic_case', /\b(case|caixa) (de )?acrilico\b|\bacrilico\b.*\bcarta\b/],
  ['protection.inner_sleeve', /\b(inner sleeves?|perfect fit)\b/],
  ['protection.sleeve', /\b(sleeves?|shields?|protetor(es)? de cartas?|capas? (protetoras?|para cartas))\b/],
  ['organization.pages_9', new RegExp(PAG.source + String.raw`.*9 (bolsos|divisorias)`)],
  ['organization.pages_4', new RegExp(PAG.source + String.raw`.*4 (bolsos|divisorias)`)],
  ['organization.pages_12', new RegExp(PAG.source + String.raw`.*12 (bolsos|divisorias)`)],
  ['organization.deck_box', /\b(deck ?box(es)?|porta ?deck|caixa (para|de) deck)\b/],
  ['organization.binder', /\b(fichario|binder|pasta (para |de )?(cartas|fichario|colecionador|album)|album (para |de )?cartas)\b|\b(pasta|album)\b.*\b\d{1,2} bolsos\b/],
  ['gameplay.playmat', /\b(playmat|play mat|tapete (de jogo|para jogo|pokemon))\b/],
  ['gameplay.damage_counter', /\b(contadores? de dano|marcadores? de dano)\b/],
  ['gameplay.condition_marker', /\bmarcadores? de condicao\b/],
  ['gameplay.coin', /\bmoeda\b/],
  ['gameplay.dice', /\bdados?\b/],
];
// Categoria do banco → chave usada pelos modelos do kit (api/_lib/kit.mjs ACESSORIO_NOME).
export const KIT_DE = { 'protection.sleeve': 'sleeve', 'protection.inner_sleeve': 'sleeve', 'organization.binder': 'fichario', 'organization.pages_4': 'paginas', 'organization.pages_9': 'paginas',
  'organization.pages_12': 'paginas', 'organization.deck_box': 'deck_box', 'protection.top_loader': 'toploader', 'protection.semi_rigid': 'toploader', 'protection.magnetic_holder': 'toploader',
  'protection.acrylic_case': 'toploader', 'gameplay.playmat': 'playmat', 'gameplay.dice': 'dados', 'gameplay.damage_counter': 'dados', 'gameplay.condition_marker': 'dados', 'gameplay.coin': 'dados' };
const MARCAS = [['copag', /\bcopag\b/], ['Ultra PRO', /\bultra ?pro\b/], ['Dragon Shield', /\bdragon ?shield\b/], ['KMC', /\bkmc\b/], ['Pokémon Center', /\bpokemon center\b/]];

/** título → { categoria, kit, marca, oficial, quantidade } ou null (não é acessório de carta, ou é lacrado). */
export function classificarAcessorio(titulo) {
  const t = norm(titulo);
  if (!t || LACRADO.test(t.replace(/\bdeck ?box(es)?\b/g, ' '))) return null;
  const hit = REGRAS.find(([, re]) => re.test(t)); if (!hit) return null;
  const categoria = hit[0];
  const marcaHit = MARCAS.find(([, re]) => re.test(t)); const marca = marcaHit ? (marcaHit[0] === 'copag' ? 'Copag' : marcaHit[0]) : null;
  const pokemon = /\bpokemon\b/.test(t);
  // Oficial: Copag (distribuidora oficial) ou Ultra PRO/Pokémon Center com "Pokémon" no título. Sem isso, não afirma.
  const oficial = pokemon && marca === 'Copag' ? 'copag' : pokemon && (marca === 'Ultra PRO' || marca === 'Pokémon Center') ? 'licenciado' : null;
  const q = t.match(/\b(\d{1,4}) ?(unidades|unids?|un|sleeves|protetores|shields|capas|cartas|bolsos|paginas|folhas|dados)\b/);
  return { categoria, kit: KIT_DE[categoria], marca, oficial, quantidade: q ? { valor: Number(q[1]), unidade: q[2] } : null };
}
export const CATEGORIAS_ACESSORIO = [...new Set(REGRAS.map(([c]) => c))];
