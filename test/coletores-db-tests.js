// Lote 7 no PostgreSQL: evento de estoque só entre estados lidos de verdade. Só roda com TEST_DATABASE_URL (banco descartável).
import assert from 'node:assert/strict';
if (!process.env.TEST_DATABASE_URL) { console.log('— testes de banco do Lote 7 pulados (sem TEST_DATABASE_URL)'); process.exit(0); }
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const { pool, tx, close } = await import('../src/db/pg.js');
const { syncState } = await import('../src/core/sync.js');
const { execFileSync } = await import('node:child_process');
const p = await pool();
await p.query('DROP SCHEMA IF EXISTS hunter CASCADE');
execFileSync('node', ['tools/db-migrate.mjs'], { env: process.env, stdio: 'pipe' });

const catalog = { collections: [{ id: 'me05', name: 'Escuridão Absoluta', series: 'Megaevolução' }] };
const prod = { id: 'me05-etb', collection: 'me05', collectionName: 'Escuridão Absoluta', type: 'etb', typeLabel: 'Treinador Avançado (ETB)', group: 'ETB', boosters: 9, offerCount: 2, copagConfirmed: false, copag: {} };
const offer = (id, stock, t, extra = {}) => ({ id, productId: 'me05-etb', storeId: 'loja', title: 'ETB', url: 'https://loja/' + id, price: 350, total: 350, shipping: null, shippingKnown: false, stock, matchConfidence: 0.9, firstSeen: '2026-10-08T10:00:00Z', source_timestamp: t, ...extra });
const stale = (o) => ({ ...o, stale: true, stock: 'UNKNOWN', lastKnownStock: o.stock });
const state = (offers) => ({ collections: [], products: [prod], sources: [{ id: 'loja', name: 'Loja', url: 'https://loja.com.br', status: 'ACTIVE' }], reputation: {}, offers });
const H = (id, t, stock) => ({ t, offerId: id, productId: 'me05-etb', storeId: 'loja', price: 350, total: 350, shipping: null, stock });
const q = async (sql, a = []) => (await p.query(sql, a)).rows;
const events = async (id) => q('SELECT from_status, to_status FROM hunter.stock_event WHERE offer_id = (SELECT id FROM hunter.offer WHERE legacy_id = $1) ORDER BY observed_at', [id]);

// a: em estoque → loja falha (stale) → volta em estoque. b: esgotado → falha → volta em estoque (restock real).
const t1 = '2026-10-08T10:00:00Z'; const t2 = '2026-10-08T10:15:00Z'; const t3 = '2026-10-08T10:30:00Z';
const a1 = offer('a', 'IN_STOCK', t1); const b1 = offer('b', 'OUT_OF_STOCK', t1);
const hist = [H('a', t1, 'IN_STOCK'), H('b', t1, 'OUT_OF_STOCK')];
await tx((c) => syncState(c, { state: state([a1, b1]), catalog, historyLines: hist }));
await tx((c) => syncState(c, { state: state([stale(a1), stale(b1)]), catalog, historyLines: hist })); // rodada sem leitura: robô não grava histórico
assert.deepEqual(await events('a'), [], 'oferta desatualizada não gera evento de estoque');
const a3 = offer('a', 'IN_STOCK', t3); const b3 = offer('b', 'IN_STOCK', t3);
const hist3 = [...hist, H('a', t3, 'IN_STOCK'), H('b', t3, 'IN_STOCK')];
await tx((c) => syncState(c, { state: state([a3, b3]), catalog, historyLines: hist3 }));
assert.deepEqual(await events('a'), [], 'em estoque → falha → em estoque: zero eventos');
assert.deepEqual(await events('b'), [{ from_status: 'out_of_stock', to_status: 'in_stock' }], 'restock real continua registrado, a partir do último estado conhecido');

// mudança real sem falha no meio continua igual
await tx((c) => syncState(c, { state: state([offer('a', 'OUT_OF_STOCK', '2026-10-08T10:45:00Z'), b3]), catalog, historyLines: [...hist3, H('a', '2026-10-08T10:45:00Z', 'OUT_OF_STOCK')] }));
assert.deepEqual(await events('a'), [{ from_status: 'in_stock', to_status: 'out_of_stock' }]);

// frete reaproveitado (simulação falhou nesta rodada) não renova a cotação gravada
const c1 = offer('c', 'IN_STOCK', t1, { shipping: 19.9, shippingKnown: true, total: 369.9, shippingSource: 'simulacao', shippingAt: t1 });
await tx((c) => syncState(c, { state: state([a3, b3, c1]), catalog, historyLines: [] }));
const before = (await q("SELECT checked_at FROM hunter.shipping_quote WHERE offer_id = (SELECT id FROM hunter.offer WHERE legacy_id = 'c')"))[0].checked_at;
await new Promise((r) => setTimeout(r, 20));
await tx((c) => syncState(c, { state: state([a3, b3, { ...c1, source_timestamp: t2, shippingSource: 'anterior' }]), catalog, historyLines: [] }));
const after = (await q("SELECT checked_at FROM hunter.shipping_quote WHERE offer_id = (SELECT id FROM hunter.offer WHERE legacy_id = 'c')"))[0].checked_at;
assert.equal(after.getTime(), before.getTime(), 'cotação reaproveitada não muda a data da cotação');

await close();
console.log('✓ Integridade dos coletores (Lote 7): 4 grupos de banco passaram');
