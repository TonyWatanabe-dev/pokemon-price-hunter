// Normalização e matching de anúncios para PRODUCT_ID.
// Princípio: na dúvida, NÃO casa. Falso negativo custa menos que falso positivo.

export const normalize = (s = '') => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9/\s.,-]/g, ' ').replace(/\s+/g, ' ').trim();

const has = (t, re) => re.test(t);
const wordRe = (alias) => new RegExp('(^|[^a-z0-9])' + alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s?') + '($|[^a-z0-9])');

const REJECT = [
  [/\b(usad[oa]s?|aberto|aberta|sem lacre|violad[oa]|avariad[oa]|caixa amassada)\b/, 'condição: não lacrado/usado'],
  [/\b(avulsas?|lote|cartas? aleatorias|sem repetidas|brilhantes? garantid|proxy|replica|nao original|similar)\b/, 'não é produto lacrado oficial'],
  [/\b(sleeves?|shields?|protetor(es)?|binder|pasta|fichario|deck ?box|playmat|tapete|porta ?cards?|toploader|case vazi[oa]|caixa vazi[oa])\b/, 'acessório'],
  [/\b(ingles|inglesa|english|en|ing|japones|japonesa|japanese|jp|coreano|chines|espanhol)\b/, 'idioma diferente de PT'],
];

export function detectCollection(t, collections) {
  const hits = collections.filter((c) => c.aliases.some((a) => wordRe(a).test(t)));
  if (hits.length === 1) return { id: hits[0].id };
  if (hits.length > 1) return { id: null, ambiguous: hits.map((h) => h.id) };
  const fb = collections.filter((c) => (c.fallbackAliases || []).some((a) => wordRe(a).test(t)));
  return fb.length === 1 ? { id: fb[0].id, fallback: true } : { id: null };
}

export function detectBoosters(t) {
  // "36 boosters", "c/36", "36 pacotes", "36 envelopes". NUNCA "36 cartas".
  let m = t.match(/\b(\d{1,2})\s*(boosters?|pacotes?|envelopes?|packs?)\b/) || t.match(/\bc\/\s?(\d{1,2})\b(?!\s*cart)/)
    || (/\bbooster/.test(t) && t.match(/\b(\d{2})\s?(un|unid|unidades)\b/));
  if (m) return { count: Number(m[1]), inferred: false };
  // Nomenclatura Copag: "Box Display" / "Booster Display" / "Caixa de Booster" = 36 boosters
  if (/\b(box display|booster display|display de booster|caixa de boosters?)\b/.test(t)) return { count: 36, inferred: true };
  m = t.match(/\b(108|144|216)\s*(cartas|cards)\b/);
  const map = { 108: 18, 144: 24, 216: 36 };
  if (m && has(t, /\b(box|display|caixa|combo|kit)\b/)) return { count: map[m[1]], inferred: true };
  return { count: null, inferred: false };
}

export function detectType(t) {
  if (has(t, /\b(treinador avancado|elite trainer|etb)\b/)) return 'etb';
  if (has(t, /\bcolecao premium|premium collection|ultra ?premium\b/)) return 'premium_collection';
  if (has(t, /\bblister (triplo|tripla)\b|\btriple blister\b/)) return 'blister_3';
  if (has(t, /\bblister (quadruplo|quadrupla)\b/)) return 'blister_4';
  if (has(t, /\bblister\b/)) return 'blister';
  if (has(t, /\b(baralho|deck) (de )?batalha\b|\bdeck pronto\b/)) return 'deck';
  if (has(t, /\b(booster unitario|1 booster|1 pacote|pacote unico|booster avulso)\b/)) return 'booster_pack';
  if (has(t, /\b(booster box|display|caixa|combo|kit|box)\b/) && detectBoosters(t).count >= 6) return 'booster_box';
  if (has(t, /\b(box|caixa)( de)? colecao\b|\bcolecao\b.*\bbox\b/)) return 'collection_box';
  return null;
}

export function detectStock(t) {
  if (has(t, /\b(pre ?venda|pre-venda|encomenda|lancamento previsto|reserva)\b/)) return 'PRE_ORDER';
  return null;
}

export function parseListing(title, catalog) {
  const t = normalize(title);
  const reasons = [];
  for (const [re, why] of REJECT) if (re.test(t)) reasons.push(why);
  const col = detectCollection(t, catalog.collections);
  // Nome de coleção Pokémon já identifica o jogo (ex.: títulos da Meruru sem a palavra "Pokémon")
  if (!/\bpokemon\b/.test(t) && !/\bcopag\b/.test(t) && !col.id) reasons.push('não menciona Pokémon');
  if (col.ambiguous) reasons.push('mais de uma coleção no título: ' + col.ambiguous.join(', '));
  const type = detectType(t);
  const b = detectBoosters(t);
  return { normalized: t, collection: col.id, collectionFallback: !!col.fallback, type, boosters: b.count, boostersInferred: b.inferred, preorder: detectStock(t) === 'PRE_ORDER', rejects: reasons };
}

export function matchProduct(listing, catalog) {
  const p = parseListing(listing.title, catalog);
  if (p.rejects.length) return { productId: null, confidence: 0, parsed: p, why: p.rejects };
  if (!p.collection) return { productId: null, confidence: 0, parsed: p, why: ['coleção não identificada'] };
  if (!p.type) return { productId: null, confidence: 0, parsed: p, why: ['tipo de produto não identificado'] };
  const candidates = catalog.products.filter((x) => x.collection === p.collection && x.type === p.type && (x.boosters ?? null) === (p.type === 'booster_box' ? p.boosters : x.boosters ?? null));
  if (candidates.length !== 1) return { productId: null, confidence: 0, parsed: p, why: [candidates.length ? 'match ambíguo' : `fora do catálogo (${p.collection}/${p.type}${p.boosters ? '/' + p.boosters : ''})`] };
  // EAN conferido vence o título; EAN divergente derruba o match.
  const prod = candidates[0];
  const ean = (v) => String(v || '').replace(/\D/g, '').replace(/^0+/, '');
  if (prod.ean && listing.ean && ean(listing.ean) !== ean(prod.ean)) return { productId: null, confidence: 0, parsed: p, why: ['EAN diverge do catálogo'] };
  let confidence = 0.8;
  const eanOk = prod.ean && listing.ean && ean(listing.ean) === ean(prod.ean);
  if (p.boostersInferred && !eanOk) confidence -= 0.1;
  if (p.collectionFallback) confidence -= 0.1;
  if (/\b(lacrad[oa]|original|copag)\b/.test(p.normalized)) confidence += 0.05;
  if (eanOk) confidence = 0.99;
  return { productId: prod.id, confidence: Math.min(0.99, +confidence.toFixed(2)), parsed: p, why: [] };
}
