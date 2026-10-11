// Eventos de estoque × guarda de last_seen_at (#154), sem banco: o syncState roda contra um cliente falso que
// responde só às consultas usadas no caminho das ofertas. Prova que leitura descartada pela guarda (fora de
// `applied`) não gera stock_event, tanto com estoque anterior conhecido quanto pelo caminho do último estoque
// conhecido no histórico (needKnown/lastKnown). O comportamento real no PostgreSQL está em stock-events-db-tests.js e db-tests.js.
import assert from 'node:assert/strict';
import { syncState } from '../src/core/sync.js';

const catalog = { collections: [{ id: 'me05', name: 'Escuridão Absoluta', series: 'Megaevolução' }] };
const prod = { id: 'me05-etb', collection: 'me05', collectionName: 'Escuridão Absoluta', type: 'etb', typeLabel: 'Treinador Avançado (ETB)', group: 'ETB', boosters: 9, offerCount: 1, copagConfirmed: false, copag: {} };
const offer = (id, stock, t) => ({ id, productId: 'me05-etb', storeId: 'loja', title: 'ETB', url: 'https://loja/' + id, price: 350, total: 350, shipping: null, shippingKnown: false, stock, matchConfidence: 0.9, firstSeen: '2026-10-08T10:00:00Z', source_timestamp: t });
const state = (offers) => ({ collections: [], products: [prod], sources: [{ id: 'loja', name: 'Loja', url: 'https://loja.com.br', status: 'ACTIVE' }], reputation: {}, offers });

// Banco em memória só com o necessário: tabela offer, histórico de estoque e os stock_event gravados.
function fakeDb({ offers, history = [] }) {
  const db = { offers: new Map(offers.map((o) => [o.legacy_id, { ...o }])), history, events: [], historyQueries: [] };
  let nextId = 100;
  db.c = { query: async (sql, a = []) => {
    if (/SELECT legacy_id, id FROM product/.test(sql)) return { rows: [{ legacy_id: 'me05-etb', id: 1 }] };
    if (/SELECT legacy_id, id, stock_status(, status)? FROM offer/.test(sql)) return { rows: [...db.offers.values()].map(({ legacy_id, id, stock_status, status }) => ({ legacy_id, id, stock_status, status })) };
    if (/^\s*INSERT INTO offer \(legacy_id, product_id, store_id, marketplace_id, seller_id/.test(sql)) {
      const applied = [];
      for (const r of JSON.parse(a[0])) { // mesma regra da guarda: WHERE offer.last_seen_at IS NULL OR offer.last_seen_at <= EXCLUDED.last_seen_at
        const cur = db.offers.get(r.legacy_id); const seen = r.last_seen_at || new Date().toISOString();
        if (cur && cur.last_seen_at && Date.parse(cur.last_seen_at) > Date.parse(seen)) continue;
        db.offers.set(r.legacy_id, { ...(cur || { id: nextId++ }), legacy_id: r.legacy_id, stock_status: r.stock_status, status: r.status, last_seen_at: seen });
        applied.push({ legacy_id: r.legacy_id });
      }
      return { rows: applied, rowCount: applied.length };
    }
    if (/SELECT legacy_id, id FROM offer WHERE legacy_id IS NOT NULL/.test(sql)) return { rows: [...db.offers.values()].map(({ legacy_id, id }) => ({ legacy_id, id })) };
    if (/FROM price_history\s+WHERE offer_id = ANY/.test(sql)) {
      db.historyQueries.push(a[0]);
      const rows = [];
      for (const id of a[0]) { const h = db.history.filter((x) => x.offer_id === Number(id) && x.stock_status !== 'unknown').sort((x, y) => Date.parse(y.observed_at) - Date.parse(x.observed_at))[0]; if (h) rows.push({ offer_id: id, stock_status: h.stock_status }); }
      return { rows };
    }
    if (/INSERT INTO stock_event/.test(sql)) { const ev = JSON.parse(a[0]); db.events.push(...ev); return { rows: [], rowCount: ev.length }; }
    if (/SELECT max\(observed_at\)/.test(sql)) return { rows: [{ m: null }] };
    return { rows: [], rowCount: 0 };
  } };
  return db;
}
const sync = (db, offers) => syncState(db.c, { state: state(offers), catalog, historyLines: [] });
const ev = (db) => db.events.map((e) => [e.from_status, e.to_status]);
let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };

await t('leitura mais antiga que a gravada (descartada pela guarda) não gera stock_event', async () => {
  const db = fakeDb({ offers: [{ legacy_id: 'x', id: 1, stock_status: 'in_stock', status: 'active', last_seen_at: '2026-10-09T12:00:00Z' }] });
  const s = await sync(db, [offer('x', 'OUT_OF_STOCK', '2026-10-09T10:00:00Z')]);
  assert.equal(s.offersStale, 1); assert.equal(s.stockEvents, 0); assert.deepEqual(ev(db), []);
  assert.equal(db.offers.get('x').stock_status, 'in_stock', 'a leitura antiga não sobrescreve');
});

await t('controle: a mesma mudança com leitura mais nova gera o evento', async () => {
  const db = fakeDb({ offers: [{ legacy_id: 'x', id: 1, stock_status: 'in_stock', status: 'active', last_seen_at: '2026-10-09T12:00:00Z' }] });
  const s = await sync(db, [offer('x', 'OUT_OF_STOCK', '2026-10-09T13:00:00Z')]);
  assert.equal(s.offersStale, 0); assert.deepEqual(ev(db), [['in_stock', 'out_of_stock']]);
});

await t('anterior unknown + leitura descartada: nem consulta o último estoque conhecido, nem gera evento', async () => {
  const db = fakeDb({ offers: [{ legacy_id: 'y', id: 2, stock_status: 'unknown', status: 'pending', last_seen_at: '2026-10-09T12:00:00Z' }],
    history: [{ offer_id: 2, stock_status: 'out_of_stock', observed_at: '2026-10-09T09:00:00Z' }] });
  const s = await sync(db, [offer('y', 'IN_STOCK', '2026-10-09T10:00:00Z')]);
  assert.equal(s.offersStale, 1); assert.deepEqual(ev(db), []); assert.deepEqual(db.historyQueries, []);
});

await t('controle: anterior unknown + leitura nova usa o último estoque conhecido (restock real)', async () => {
  const db = fakeDb({ offers: [{ legacy_id: 'y', id: 2, stock_status: 'unknown', status: 'pending', last_seen_at: '2026-10-09T12:00:00Z' }],
    history: [{ offer_id: 2, stock_status: 'out_of_stock', observed_at: '2026-10-09T09:00:00Z' }] });
  await sync(db, [offer('y', 'IN_STOCK', '2026-10-09T13:00:00Z')]);
  assert.deepEqual(ev(db), [['out_of_stock', 'in_stock']]);
});

await t('mesmo carimbo (retry) continua aplicado; sem mudança de estoque, sem evento', async () => {
  const db = fakeDb({ offers: [{ legacy_id: 'z', id: 3, stock_status: 'in_stock', status: 'active', last_seen_at: '2026-10-09T12:00:00Z' }] });
  const s = await sync(db, [offer('z', 'IN_STOCK', '2026-10-09T12:00:00Z')]);
  assert.equal(s.offersStale, 0); assert.deepEqual(ev(db), []);
});

console.log(`✓ Eventos de estoque × guarda de last_seen_at (sem banco): ${n} grupos passaram`);
