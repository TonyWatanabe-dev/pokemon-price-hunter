// Quarentena do sync (23/10/2026): uma linha recusada pelo banco ou um produto com tipo sem categoria não derruba mais a
// sincronização inteira (incidentes de 19/10 e 22/10). Cliente falso que recusa o lote que contém a oferta 'ruim'.
import assert from 'node:assert/strict';
import { syncState, QUARENTENA_MAX } from '../src/core/sync.js';

const NOW = Date.parse('2026-10-23T12:00:00.000Z');
const catalog = { collections: [{ id: 'me05', name: 'Escuridão Absoluta', series: 'Megaevolução' }] };
const prod = (id, type = 'etb') => ({ id, collection: 'me05', collectionName: 'Escuridão Absoluta', type, typeLabel: 'X', group: 'X', boosters: 9, offerCount: 1, copagConfirmed: false, copag: {} });
const offer = (id) => ({ id, productId: 'me05-etb', storeId: 'loja', title: 'ETB', url: 'https://loja/' + id, price: 350, total: 350, shipping: null, shippingKnown: false, stock: 'IN_STOCK', matchConfidence: 0.9, firstSeen: '2026-10-08T10:00:00Z', source_timestamp: '2026-10-23T11:50:00Z' });

function fakeDb(ruins) {
  const db = { gravadas: new Set(), produtos: [], sp: 0, removidas: [] };
  db.c = { query: async (sql, a = []) => {
    if (/^SAVEPOINT|^RELEASE|^ROLLBACK TO/.test(sql)) { db.sp++; return { rows: [] }; }
    if (/^SELECT now\(\)/.test(sql)) return { rows: [{ now: new Date(NOW) }] };
    if (/INSERT INTO product \(legacy_id/.test(sql)) { db.produtos.push(...JSON.parse(a[0]).map((p) => p.legacy_id)); return { rows: [], rowCount: 1 }; }
    if (/SELECT legacy_id, id FROM product/.test(sql)) return { rows: [{ legacy_id: 'me05-etb', id: 1 }] };
    if (/^\s*INSERT INTO offer \(legacy_id, product_id, store_id, marketplace_id, seller_id/.test(sql)) {
      const rows = JSON.parse(a[0]);
      if (rows.some((r) => ruins.includes(r.legacy_id))) throw new Error('duplicate key value violates unique constraint "offer_external_uq"');
      rows.forEach((r) => db.gravadas.add(r.legacy_id));
      return { rows: rows.map((r) => ({ legacy_id: r.legacy_id })), rowCount: rows.length };
    }
    if (/UPDATE offer SET status = 'removed'/.test(sql)) { db.vivas = a[0]; return { rows: [], rowCount: 0 }; }
    if (/SELECT max\(observed_at\)/.test(sql)) return { rows: [{ m: null }] };
    return { rows: [], rowCount: 0 };
  } };
  return db;
}
const st = (offers, products = [prod('me05-etb')]) => ({ collections: [], products, sources: [{ id: 'loja', name: 'Loja', url: 'https://loja.com.br', status: 'ACTIVE' }], reputation: {}, offers });

// 1. uma oferta ruim entre 20: as outras 19 entram, a ruim fica na quarentena e continua viva (não vira 'removed')
{
  const ids = Array.from({ length: 20 }, (_, i) => 'o' + i); ids[7] = 'ruim';
  const db = fakeDb(['ruim']);
  const s = await syncState(db.c, { state: st(ids.map(offer)), catalog, historyLines: [] });
  assert.equal(db.gravadas.size, 19); assert.ok(!db.gravadas.has('ruim'));
  assert.equal(s.quarantined, 1); assert.equal(s.quarantine[0].etapa, 'oferta'); assert.equal(s.quarantine[0].id, 'ruim');
  assert.match(s.quarantine[0].motivo, /offer_external_uq/);
  assert.ok(db.vivas.includes('ruim'), 'oferta em quarentena não é marcada como removida');
  assert.equal(s.offersStale, 0);
}
// 2. erro sistêmico (todas recusadas) continua derrubando a rodada
{
  const ids = Array.from({ length: 20 }, (_, i) => 'o' + i);
  await assert.rejects(syncState(fakeDb(ids).c, { state: st(ids.map(offer)), catalog, historyLines: [] }));
  assert.ok(QUARENTENA_MAX.frac <= 0.1 && QUARENTENA_MAX.abs <= 50);
}
// 3. produto com tipo sem categoria (19/10): fica de fora, o resto segue
{
  const db = fakeDb([]);
  const s = await syncState(db.c, { state: st([offer('a')], [prod('me05-etb'), prod('me05-novo', 'tipo_inventado')]), catalog, historyLines: [] });
  assert.deepEqual(db.produtos, ['me05-etb']);
  assert.equal(s.quarantine.find((x) => x.etapa === 'produto').id, 'me05-novo');
  assert.ok(db.gravadas.has('a'));
}
// 4. sem problema: nenhuma quarentena e um único lote
{
  const db = fakeDb([]);
  const s = await syncState(db.c, { state: st(['a', 'b'].map(offer)), catalog, historyLines: [] });
  assert.equal(s.quarantined, 0); assert.equal(db.gravadas.size, 2);
}
console.log('✓ sync-quarentena: linha ruim isolada, erro sistêmico ainda para, tipo sem categoria isolado');
