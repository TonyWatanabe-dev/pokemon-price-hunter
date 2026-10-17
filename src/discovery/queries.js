// Geração determinística de consultas a partir do catálogo (config/catalog.json). Sem rede, sem aleatoriedade: a mesma
// entrada gera a mesma lista, na mesma ordem (coleções mais novas primeiro = ordem inversa do catálogo).
// Cada consulta: { id, q, kind: 'store' | 'product' | 'ean', collection?, type? }. Strings iguais (normalizadas) viram uma só.
import { normalize, TYPE_LABEL } from '../match.js';

// Intenções de descoberta de loja (independentes de coleção).
const STORE_INTENTS = [
  'loja pokémon tcg lacrado', 'booster box pokémon comprar', 'pokémon tcg copag loja online', 'card game pokémon loja',
  'elite trainer box pokémon comprar', 'blister pokémon tcg comprar', 'box pokémon lacrado copag', 'pokémon estampas ilustradas loja',
  // Varredura de 17/10: brinquedos, papelarias e varejo regional também vendem lacrado (MP Brinquedos, Ciatoy, Havan…).
  'loja de brinquedos cartas pokémon copag', 'papelaria cartas pokémon blister', 'treinador avançado pokémon loja de brinquedos',
];
export const CITIES = ['São Paulo', 'Rio de Janeiro', 'Belo Horizonte', 'Curitiba', 'Porto Alegre', 'Brasília', 'Salvador', 'Recife', 'Fortaleza', 'Belém', 'Goiânia', 'Manaus', 'Florianópolis', 'Campinas'];
// Formatos com mais procura (TYPE_LABEL de src/match.js, sem o complemento entre parênteses).
export const PRODUCT_TYPES = ['booster_box', 'etb', 'blister_4', 'blister_3', 'blister_2', 'lata', 'colecao', 'deck'];
const label = (type) => (TYPE_LABEL[type] || type).replace(/\s*\(.*\)\s*$/, '');

const idOf = (q) => normalize(q).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Coleções do catálogo, mais novas primeiro (posição inversa no catálogo; a série é só informativa). */
export function newestFirst(collections = []) { return [...collections].reverse(); }

/** Código de referência da Copag (config/refs-copag.json): na varredura de 17/10, buscar pelo código achou loja pequena
 *  muito melhor que pelo nome. Ordem: coleções mais novas primeiro (lançamentos). */
export function refQueries(refs = {}, collections = []) {
  const ordem = new Map(newestFirst(collections).map((c, i) => [c.id, i]));
  return Object.entries(refs || {}).filter(([code]) => /^3\d{4}$/.test(code))
    .sort(([a, x], [b, y]) => (ordem.get(x.collection) ?? 999) - (ordem.get(y.collection) ?? 999) || a.localeCompare(b));
}

export function generateQueries(catalog, refs = {}) {
  const out = []; const seen = new Set();
  const push = (q, kind, extra = {}) => {
    const key = normalize(q).replace(/\s+/g, ' ').trim(); if (!key || seen.has(key)) return; seen.add(key);
    out.push({ id: `${kind}:${idOf(q)}`, q: q.trim(), kind, ...extra });
  };
  for (const q of STORE_INTENTS) push(q, 'store');
  for (const c of CITIES) push(`loja de card game ${c}`, 'store');
  const cols = newestFirst(catalog?.collections || []);
  for (const c of cols) {
    push(`pokémon tcg ${c.name} booster box`, 'store', { collection: c.id });
    push(`blister pokémon ${c.name}`, 'store', { collection: c.id });
    push(`elite trainer box ${c.name} comprar`, 'store', { collection: c.id });
  }
  for (const c of cols) for (const t of PRODUCT_TYPES) push(`pokémon tcg ${c.name} ${label(t)}`, 'product', { collection: c.id, type: t });
  for (const [code, r] of refQueries(refs, catalog?.collections)) push(`"${code}" pokémon copag`, 'ref', { collection: r.collection, type: r.type, product: r.productId });
  for (const p of catalog?.products || []) if (p.ean) push(`"${String(p.ean).trim()}"`, 'ean', { collection: p.collection, type: p.type, product: p.id });
  return out;
}
