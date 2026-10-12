// Geração determinística de consultas a partir do catálogo (config/catalog.json). Sem rede, sem aleatoriedade: a mesma
// entrada gera a mesma lista, na mesma ordem (coleções mais novas primeiro = ordem inversa do catálogo).
// Cada consulta: { id, q, kind: 'store' | 'product' | 'ean', collection?, type? }. Strings iguais (normalizadas) viram uma só.
import { normalize, TYPE_LABEL } from '../match.js';

// Intenções de descoberta de loja (independentes de coleção).
const STORE_INTENTS = [
  'loja pokémon tcg lacrado', 'booster box pokémon comprar', 'pokémon tcg copag loja online', 'card game pokémon loja',
  'elite trainer box pokémon comprar', 'blister pokémon tcg comprar', 'box pokémon lacrado copag', 'pokémon estampas ilustradas loja',
];
export const CITIES = ['São Paulo', 'Rio de Janeiro', 'Belo Horizonte', 'Curitiba', 'Porto Alegre', 'Brasília', 'Salvador', 'Recife'];
// Formatos com mais procura (TYPE_LABEL de src/match.js, sem o complemento entre parênteses).
export const PRODUCT_TYPES = ['booster_box', 'etb', 'blister_4', 'blister_3', 'blister_2', 'lata', 'colecao', 'deck'];
const label = (type) => (TYPE_LABEL[type] || type).replace(/\s*\(.*\)\s*$/, '');

const idOf = (q) => normalize(q).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Coleções do catálogo, mais novas primeiro (posição inversa no catálogo; a série é só informativa). */
export function newestFirst(collections = []) { return [...collections].reverse(); }

export function generateQueries(catalog) {
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
  for (const p of catalog?.products || []) if (p.ean) push(`"${String(p.ean).trim()}"`, 'ean', { collection: p.collection, type: p.type, product: p.id });
  return out;
}
