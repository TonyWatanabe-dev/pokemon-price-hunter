// Contrato do modelo de domínio (docs/modelo-de-dominio.md): coleção, produto e oferta. Sem banco.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { categoryOf, KNOWN_TYPES } from '../src/core/taxonomy.js';
import { collectionsRows, productsRows, offersRows, TCG } from '../src/core/mappers.js';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const core = read('../db/migrations/001_core.sql');

// colunas de uma tabela, lidas do CREATE TABLE da migration 001 (ignora restrições de tabela)
function columns(table) {
  const start = core.indexOf(`CREATE TABLE ${table} (`);
  assert.ok(start >= 0, `tabela ${table} não encontrada`);
  const body = core.slice(start, core.indexOf('\n);', start));
  const out = new Set();
  for (const line of body.split('\n').slice(1)) {
    const m = line.match(/^ {2}([a-z_]+)\s+\S/);
    if (m && !['check', 'unique', 'primary', 'constraint'].includes(m[1])) out.add(m[1]);
  }
  return out;
}
const product = columns('product'), offer = columns('offer'), collection = columns('collection');
assert.ok(product.has('slug') && product.has('collection_id') && offer.has('product_id') && collection.has('tcg_id'), 'leitura das colunas funciona');

// estável (produto/coleção) × volátil (oferta)
const VOLATILE = ['price', 'price_kind', 'list_price', 'pix_price', 'shipping_price', 'shipping_status', 'total_price', 'stock_status', 'quantity', 'url', 'last_seen_at'];
const STABLE = ['collection_id', 'category_id', 'units', 'variant', 'brand', 'canonical_name', 'slug'];
for (const c of VOLATILE) assert.ok(!product.has(c) && !collection.has(c), `produto/coleção não guardam ${c} (volátil, é da oferta)`);
for (const c of VOLATILE) assert.ok(offer.has(c), `oferta guarda ${c}`);
for (const c of STABLE) assert.ok(!offer.has(c), `oferta não repete ${c} (herda do produto)`);
assert.ok(core.includes('CHECK (total_price IS NULL OR shipping_status <> \'unknown\')'), 'total só com frete conhecido');

// mappers: só colunas existentes; exceções explícitas (viram outra tabela ou são resolvidas no sync)
const keys = (row) => Object.keys(row);
const only = (row, cols, extra, what) => { for (const k of keys(row)) assert.ok(cols.has(k) || extra.includes(k), `${what}: campo ${k} não existe na tabela`); };

const [col] = collectionsRows([{ id: 'me05', name: 'Escuridão Absoluta', series: 'Megaevolução' }]);
only(col, collection, [], 'collection');
assert.equal(col.tcg_id, 'pokemon'); assert.equal(col.id, 'pokemon:me05'); assert.equal(TCG, 'pokemon', 'V1 é só Pokémon');

const [p] = productsRows([{ id: 'me05-etb', collection: 'me05', collectionName: 'Escuridão Absoluta', type: 'etb', typeLabel: 'Treinador Avançado (ETB)', group: 'ETB', boosters: 9, ean: '123' }]);
only(p, product, ['ean'], 'product');         // ean vai para product_identifier
for (const k of VOLATILE) assert.ok(!(k in p), `linha de produto sem ${k}`);
assert.equal(p.collection_id, col.id, 'produto aponta para a coleção');
assert.equal(p.tcg_id, 'pokemon');

const [o] = offersRows([{ id: 'h1', productId: 'me05-etb', storeId: 'loja', title: 't', url: 'https://x', price: 100, total: 100, shipping: 0, shippingKnown: true, stock: 'IN_STOCK' }]);
only(o, offer, ['product_legacy_id', 'seller', 'shipping_reused'], 'offer');   // resolvidos para product_id / seller_id no sync; shipping_reused (#88) é consumido pelo sync e não é coluna
for (const k of STABLE) assert.ok(!(k in o), `linha de oferta sem ${k}`);
assert.equal(o.product_legacy_id, p.legacy_id, 'oferta liga ao produto pelo id antigo');

// V1: só selado, todo tipo conhecido tem categoria sealed.*
assert.ok(KNOWN_TYPES.length > 0);
for (const t of KNOWN_TYPES) assert.match(categoryOf(t), /^sealed\./, `tipo ${t} deve ser selado`);

// o slug é fixo: o upsert de produto no sync não o atualiza
const sync = read('../src/core/sync.js');
assert.ok(!/slug\s*=\s*EXCLUDED\.slug/.test(sync), 'sync não reescreve o slug do produto');

console.log('OK — contrato do modelo de domínio');
