// Cotação de frete no PostgreSQL: frete reaproveitado (simulação falhou) não renova shipping_quote.checked_at.
// Só roda com TEST_DATABASE_URL (banco descartável); sem ele, pula como os demais testes de banco.
import assert from 'node:assert/strict';
if (!process.env.TEST_DATABASE_URL) { console.log('— testes de banco da cotação de frete pulados (sem TEST_DATABASE_URL)'); process.exit(0); }
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const { pool, tx, close } = await import('../src/db/pg.js');
const { syncState } = await import('../src/core/sync.js');
const { execFileSync } = await import('node:child_process');
const p = await pool();
await p.query('DROP SCHEMA IF EXISTS hunter CASCADE');
execFileSync('node', ['tools/db-migrate.mjs'], { env: process.env, stdio: 'pipe' });

const catalog = { collections: [{ id: 'me05', name: 'Escuridão Absoluta', series: 'Megaevolução' }] };
const prod = { id: 'me05-etb', collection: 'me05', collectionName: 'Escuridão Absoluta', type: 'etb', typeLabel: 'Treinador Avançado (ETB)', group: 'ETB', boosters: 9, offerCount: 1, copagConfirmed: false, copag: {} };
const offer = (t, extra) => ({ id: 'c', productId: 'me05-etb', storeId: 'loja', title: 'ETB', url: 'https://loja/c', price: 350, stock: 'IN_STOCK', matchConfidence: 0.9, firstSeen: '2026-10-08T10:00:00Z', source_timestamp: t, ...extra });
const state = (offers) => ({ collections: [], products: [prod], sources: [{ id: 'loja', name: 'Loja', url: 'https://loja.com.br', status: 'ACTIVE' }], reputation: {}, offers });
const quote = async () => (await p.query("SELECT price, checked_at FROM hunter.shipping_quote WHERE offer_id = (SELECT id FROM hunter.offer WHERE legacy_id = 'c')")).rows[0] || null;
const sync = (o) => tx((c) => syncState(c, { state: state([o]), catalog, historyLines: [] }));
const pause = () => new Promise((r) => setTimeout(r, 25));
let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };

const fresh = { shipping: 19.9, shippingKnown: true, total: 369.9, shippingAt: '2026-10-08T10:00:00Z', shippingSource: 'simulacao' };
let first;
await t('cotação simulada é gravada', async () => {
  await sync(offer('2026-10-08T10:00:00Z', fresh));
  first = await quote(); assert.equal(Number(first.price), 19.9);
});
await t('frete reaproveitado não renova checked_at nem o preço gravado', async () => {
  await pause();
  await sync(offer('2026-10-08T10:15:00Z', { ...fresh, shippingSource: 'anterior' }));
  const q = await quote();
  assert.equal(q.checked_at.getTime(), first.checked_at.getTime());
  assert.equal(Number(q.price), 19.9);
});
await t('frete desconhecido (cotação vencida) não grava nem apaga a cotação', async () => {
  await pause();
  await sync(offer('2026-10-09T11:00:00Z', { shipping: null, shippingKnown: false, total: 350 }));
  const q = await quote(); assert.equal(q.checked_at.getTime(), first.checked_at.getTime());
  const [o] = (await p.query("SELECT shipping_status, total_price FROM hunter.offer WHERE legacy_id = 'c'")).rows;
  assert.deepEqual([o.shipping_status, o.total_price], ['unknown', null], 'oferta sem frete conhecido: total não é inventado');
});
await t('nova simulação renova a cotação', async () => {
  await pause();
  await sync(offer('2026-10-09T11:15:00Z', { ...fresh, shipping: 21.9, total: 371.9, shippingAt: '2026-10-09T11:15:00Z' }));
  const q = await quote();
  assert.ok(q.checked_at.getTime() > first.checked_at.getTime()); assert.equal(Number(q.price), 21.9);
});

await close();
console.log(`✓ Cotação de frete (PostgreSQL): ${n} grupos passaram`);
