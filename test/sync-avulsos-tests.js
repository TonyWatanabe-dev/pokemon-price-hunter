// Produtos "avulsos" (box, baralho e coleção especial sem coleção no título, #797) entram no banco (04/11/2026). Antes, o
// sync os tratava como código de coleção antigo: iam para a revisão e ficavam fora do site e do Opportunity Engine.
import assert from 'node:assert/strict';
import { syncState } from '../src/core/sync.js';

const NOW = Date.parse('2026-11-04T02:00:00.000Z');
const catalog = { collections: [{ id: 'me05', name: 'Escuridão Absoluta', series: 'Megaevolução' }] };
const prod = (id, collection, collectionName, type) => ({ id, collection, collectionName, type, typeLabel: 'X', group: 'X', boosters: null, offerCount: 1, copagConfirmed: false, copag: {} });
function fakeDb() {
  const db = { produtos: [], colecoes: [], revisao: [] };
  db.c = { query: async (sql, a = []) => {
    if (/^SELECT now\(\)/.test(sql)) return { rows: [{ now: new Date(NOW) }] };
    if (/INSERT INTO collection/.test(sql)) { db.colecoes.push(...JSON.parse(a[0]).map((c) => c.code)); return { rows: [], rowCount: 1 }; }
    if (/INSERT INTO product \(legacy_id/.test(sql)) { db.produtos.push(...JSON.parse(a[0]).map((p) => p.legacy_id)); return { rows: [], rowCount: 1 }; }
    if (/INSERT INTO review_item/.test(sql)) { db.revisao.push(...JSON.parse(a[0]).map((x) => x.id)); return { rows: [], rowCount: 1 }; }
    if (/SELECT max\(observed_at\)/.test(sql)) return { rows: [{ m: null }] };
    return { rows: [], rowCount: 0 };
  } };
  return db;
}
const state = { collections: [], sources: [], reputation: {}, offers: [], products: [
  prod('me05-etb', 'me05', 'Escuridão Absoluta', 'etb'),
  prod('avulsos-deck-mewtwo', 'avulsos', 'Box Pokémon', 'deck'),
  prod('xx9-etb', 'xx9', 'Coleção Inexistente', 'etb'),   // código antigo de verdade continua indo para a revisão
] };
const db = fakeDb();
await syncState(db.c, { state, catalog, historyLines: [] });
assert.ok(db.colecoes.includes('avulsos'), 'pseudo-coleção gravada');
assert.ok(db.produtos.includes('avulsos-deck-mewtwo'), 'produto avulso entra no banco');
assert.ok(!db.revisao.includes('avulsos-deck-mewtwo'), 'produto avulso não vai para a revisão de duplicado');
assert.ok(db.revisao.includes('xx9-etb') && !db.produtos.includes('xx9-etb'), 'código de coleção desconhecido segue para a revisão');
console.log('✓ sync: produtos avulsos entram no banco');
