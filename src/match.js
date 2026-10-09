// Catálogo automático: todo anúncio lacrado de Pokémon vira um produto
// identificado por coleção + tipo + quantidade de boosters + variante (ex.: "Sylveon ex").
// Princípio: na dúvida, NÃO casa. Falso negativo custa menos que falso positivo.

export const normalize = (s = '') => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/(\d),(\d)/g, '$1.$2').replace(/[^a-z0-9/\s.,-]/g, ' ').replace(/\s+/g, ' ').trim();

const has = (t, re) => re.test(t);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRe = (alias) => new RegExp('(^|[^a-z0-9.])' + esc(alias).replace(/ /g, '\\s?') + '($|[^a-z0-9.]|\\.(?!\\d))');

const REJECT = [
  [/\b(usad[oa]s?|aberto|aberta|sem lacre|violad[oa]|avariad[oa]|caixa amassada|embalagem danificada)\b/, 'condição: não lacrado/usado'],
  [/\b(avulsas?|lote de cartas|cartas? aleatorias|sem repetidas|brilhantes? garantid|proxy|replica|nao original|similar|cartas? unitarias?)\b/, 'não é produto lacrado oficial'],
  [/\b(sleeves?|shields?|protetor(es)? de cartas|binder avulso|pasta avulsa|deck ?box avulsa|playmat|tapete|porta ?cards?|toploader|case vazi[oa]|caixa vazi[oa]|pelucia|chaveiro|camiseta|caneca)\b/, 'acessório ou item não-TCG'],
  [/\b(ingles|inglesa|english|en|ing|japones|japonesa|japanese|jp|coreano|chines|espanhol|frances|alemao|italiano)\b/, 'idioma diferente de PT'],
];

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

export function detectCollection(t, collections) {
  const hits = collections.filter((c) => c.aliases.some((a) => wordRe(a).test(t)));
  if (hits.length === 1) return { id: hits[0].id };
  if (hits.length > 1) {
    // Produto conjunto (ex.: "Fogo Branco e Raio Preto"): só quando o título cita exatamente as coleções combinadas.
    const ids = hits.map((h) => h.id).sort().join('|');
    const combo = collections.find((c) => c.combines && [...c.combines].sort().join('|') === ids);
    if (combo) return { id: combo.id };
    return { id: null, ambiguous: hits.map((h) => h.id) };
  }
  const fb = collections.filter((c) => (c.fallbackAliases || []).some((a) => wordRe(a).test(t)));
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

const VARIANT_STOP = new Set(['box', 'colecao', 'pokemon', 'de', 'da', 'do', 'com', 'e', 'tcg', 'mega', 'cartas', 'copag', 'booster', 'premium', 'especial', 'estampas', 'ilustradas', 'sortidas', 'sortidos', 'sortida', 'sortido', 'modelos', 'variados', 'brilhante', 'brilhantes', 'jumbo']);
function detectVariant(t) {
  if (/\bou\b/.test(t) && /\bex\b/.test(t) || /\bsortid/.test(t)) return null; // "Zapdos ex ou Alakazam ex": a loja escolhe qual vem
  let m = t.match(/\b(mega )?([a-z]{3,}) ex\b/);
  if (m && !VARIANT_STOP.has(m[2])) return (m[1] ? 'mega-' : '') + m[2];
  m = t.match(/\bex (mega )?([a-z]{3,})\b/); // "Box Pokémon Ex Greninja"
  if (m && !VARIANT_STOP.has(m[2])) return (m[1] ? 'mega-' : '') + m[2];
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
  if (has(t, /\bmini ?latas?\b/)) return r('minilata');
  if (has(t, /\blatas?\b/)) return r('lata');
  if (has(t, /\b(baralho|deck) (de )?batalha\b|\bbaralho batalha\b/)) return r('deck', null, false, detectVariant(t));
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

export function detectStock(t) {
  if (has(t, /\b(pre ?venda|pre-venda|encomenda|lancamento previsto|reserva)\b/)) return 'PRE_ORDER';
  return null;
}

const SHORT = { booster_box: (n) => `box${n}`, combo: (n) => (n ? `combo${n}` : 'combo'), etb: () => 'etb', booster_pack: () => 'booster',
  blister_1: () => 'blister1', blister_2: () => 'blister2', blister_3: () => 'blister3', blister_4: () => 'blister4' };
export function productIdOf(collection, type, boosters, variant) {
  const base = SHORT[type] ? SHORT[type](boosters) : type;
  return `${collection}-${base}${variant ? '-' + variant : ''}`;
}
/** Chaves para herdar o preço Copag: a variante (Sylveon ex / Greninja ex) e o combo sem contagem custam o mesmo. */
export const msrpKeys = (p) => [...new Set([p.id, productIdOf(p.collection, p.type, p.boosters, null), p.type === 'combo' && !p.boosters ? productIdOf(p.collection, 'combo', null, null) : p.id])];

export function parseListing(title, catalog) {
  const t = normalize(title);
  const reasons = [];
  for (const [re, why] of REJECT) if (re.test(t)) reasons.push(why);
  // "Dados Treinador Avançado", "Moeda ... Celebração": acessório vendido à parte, não o produto lacrado.
  // Kit montado pela loja ("Kit ... + 6 Booster", "Kit 4 Booster Box ... Case Fechada"): não é o produto Copag.
  if ((/\bkit\b/.test(t) && /\b(fichario|binder|poster|pasta)\b/.test(t)) || /\bcase fechad[ao]\b|\bkit \d+ (booster box|box|displays?)\b|\b\d+ (booster boxes|displays)\b/.test(t)) reasons.push('kit montado pela loja ou caixa com várias unidades');
  // "Case" (caixa master com várias boxes/ETBs) e "6x Booster Box" nunca são a unidade do catálogo.
  // "Case vazio/vazia" continua só como acessório (regra REJECT acima), sem esse segundo motivo.
  else if (/\bcase\b(?! vazi[oa]\b)|\b(caixa|box) master\b|\bmaster (case|box)\b|\b([2-9]|1\d) ?x? (booster box(es)?|box(es)? display|displays?|treinadore?s? avancados?|etbs?)\b/.test(t)) reasons.push('kit montado pela loja ou caixa com várias unidades');
  if (/\b(dados?|moedas?|marcadores?|contadores? de dano)\b/.test(t) && !/\b(boosters?|pacotes?|blister|colecao|box|treinador avancado com|etb com)\b/.test(t.replace(/\btreinador avancado\b/, ''))) reasons.push('acessório avulso (dados, moeda, marcador)');
  const col = detectCollection(t, catalog.collections);
  if (!/\bpokemon\b/.test(t) && !/\bcopag\b/.test(t) && !col.id) reasons.push('não menciona Pokémon');
  if (col.ambiguous) reasons.push('mais de uma coleção no título: ' + col.ambiguous.join(', '));
  const colDef = catalog.collections.find((c) => c.id === col.id);
  let tt = t;
  for (const a of [...(colDef?.aliases || []), ...(colDef?.fallbackAliases || [])].sort((x, y) => y.length - x.length)) tt = tt.replace(new RegExp(wordRe(a).source, 'g'), ' ');
  const d = detectType(tt.replace(/\s+/g, ' ').trim());
  return { normalized: t, collection: col.id, collectionFallback: !!col.fallback, type: d.type, boosters: d.boosters, boostersInferred: d.inferred, variant: d.variant, preorder: detectStock(t) === 'PRE_ORDER', rejects: reasons };
}

export function describeProduct(catalog, collection, type, boosters, variant) {
  const col = catalog.collections.find((c) => c.id === collection);
  const id = productIdOf(collection, type, boosters, variant);
  const fixed = (catalog.products || []).find((p) => p.id === id) || {};
  const vName = variant ? variant.replace('mega-', 'Mega ').replace(/^./, (c) => c.toUpperCase()).replace(/ (.)/, (m) => m.toUpperCase()) + ' ex' : null;
  return {
    id, collection, collectionName: col?.name || collection, series: col?.series || null, type, typeLabel: TYPE_LABEL[type] || type, group: groupOf(type),
    boosters: boosters ?? fixed.boosters ?? null, variant: vName,
    name: `${col?.name || collection} - ${TYPE_LABEL[type] || type}${boosters && (type === 'booster_box' || type === 'combo') ? ` ${boosters}` : ''}${vName ? ` ${vName}` : ''}`,
    ean: fixed.ean || null,
  };
}

export function matchProduct(listing, catalog) {
  const p = parseListing(listing.title, catalog);
  const ean = (v) => String(v || '').replace(/\D/g, '').replace(/^0+/, '');
  // EAN cadastrado vence o título.
  const byEan = listing.ean && (catalog.products || []).find((x) => x.ean && ean(x.ean) === ean(listing.ean));
  if (p.rejects.length) return { productId: null, confidence: 0, parsed: p, why: p.rejects };
  if (byEan) {
    const prod = describeProduct(catalog, byEan.collection, byEan.type, byEan.boosters, null);
    return { productId: byEan.id, product: { ...prod, id: byEan.id }, confidence: 0.99, parsed: p, why: [] };
  }
  if (!p.collection) return { productId: null, confidence: 0, parsed: p, why: ['coleção não identificada'] };
  if (!p.type) return { productId: null, confidence: 0, parsed: p, why: ['tipo de produto não identificado'] };
  if (p.type === 'booster_box' && !p.boosters) return { productId: null, confidence: 0, parsed: p, why: ['quantidade de boosters não informada'] };
  const prod = describeProduct(catalog, p.collection, p.type, p.boosters, p.variant);
  const fixed = (catalog.products || []).find((x) => x.id === prod.id);
  if (fixed?.ean && listing.ean && ean(fixed.ean) !== ean(listing.ean)) return { productId: null, confidence: 0, parsed: p, why: ['EAN diverge do catálogo'] };
  let confidence = 0.8;
  if (p.boostersInferred) confidence -= 0.1;
  if (p.collectionFallback) confidence -= 0.1;
  if (/\b(lacrad[oa]|original|copag)\b/.test(p.normalized)) confidence += 0.05;
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
  if (!catalog.collections.some((c) => c.id === ov.collection)) return m;
  const prod = describeProduct(catalog, ov.collection, ov.type, ov.boosters ?? null, ov.variant ?? null);
  if (prod.id !== ov.productId) return m;
  const fixed = (catalog.products || []).find((x) => x.id === prod.id);
  if (fixed?.ean && listing.ean && fixed.ean.replace(/\D/g, '').replace(/^0+/, '') !== String(listing.ean).replace(/\D/g, '').replace(/^0+/, '')) return m;
  return { productId: prod.id, product: prod, confidence: 0.8, parsed: m.parsed, why: [], override: ov.reviewId };
}
