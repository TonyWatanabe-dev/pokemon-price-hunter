// Marketplace Core no PostgreSQL: só roda com TEST_DATABASE_URL (banco descartável).
import assert from 'node:assert/strict';
if (!process.env.TEST_DATABASE_URL) { console.log('— testes de banco pulados (sem TEST_DATABASE_URL)'); process.exit(0); }
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const { pool, tx, close } = await import('../src/db/pg.js');
const { syncState } = await import('../src/core/sync.js');
const { execFileSync } = await import('node:child_process');
const p = await pool();
await p.query('DROP SCHEMA IF EXISTS hunter CASCADE');
execFileSync('node', ['tools/db-migrate.mjs'], { env: process.env, stdio: 'pipe' });
execFileSync('node', ['tools/db-migrate.mjs'], { env: process.env, stdio: 'pipe' }); // 2ª vez não faz nada

const catalog = { collections: [{ id: 'me05', name: 'Escuridão Absoluta', series: 'Megaevolução' }] };
// Copag verificada ontem (relativo ao relógio): a view do motor só aceita verificação de até 30 dias (migration 010)
const COPAG_SEEN = new Date(Date.now() - 864e5).toISOString();
const prod = { id: 'me05-etb', collection: 'me05', collectionName: 'Escuridão Absoluta', type: 'etb', typeLabel: 'Treinador Avançado (ETB)', group: 'ETB', boosters: 9, offerCount: 1,
  copagConfirmed: true, msrp: 399.99, copag: { source_url: 'https://www.copagloja.com.br/etb/p', confidence: 'OFICIAL', source_timestamp: COPAG_SEEN } };
const dup = { ...prod, id: 'ev05-etb', collection: 'ev05', copagConfirmed: false, offerCount: 0 };
const offer = (price, stock, t) => ({ id: 'o1', productId: 'me05-etb', storeId: 'loja', title: 'ETB', url: 'https://loja/etb', price, total: price, shipping: null, shippingKnown: false, stock, matchConfidence: 0.9, firstSeen: '2026-10-08T10:00:00Z', source_timestamp: t });
const state = (o) => ({ collections: [], products: [prod, dup], sources: [{ id: 'loja', name: 'Loja', url: 'https://loja.com.br', status: 'ACTIVE' }], reputation: {}, offers: [o] });
const H1 = { t: '2026-10-08T10:00:00Z', offerId: 'o1', productId: 'me05-etb', price: 350, total: 350, shipping: null, stock: 'IN_STOCK' };
const H0 = { t: '2026-09-30T10:00:00Z', offerId: 'velha', productId: 'me05-etb', storeId: 'loja', price: 380, total: 380, shipping: null, stock: 'IN_STOCK' };

const s1 = await tx((c) => syncState(c, { state: state(offer(350, 'IN_STOCK', '2026-10-08T10:00:00Z')), catalog, historyLines: [H0, H1] }));
assert.equal(s1.products, 1); assert.equal(s1.duplicatesToReview, 1); assert.equal(s1.history, 2); assert.equal(s1.historicOffers, 1);
const again = await tx((c) => syncState(c, { state: state(offer(350, 'IN_STOCK', '2026-10-08T10:00:00Z')), catalog, historyLines: [H0, H1] }));
assert.equal(again.history, 0, 'repetir não duplica histórico');
const q = async (sql, a = []) => (await p.query(sql, a)).rows;
assert.equal((await q('SELECT count(*)::int n FROM hunter.product'))[0].n, 1);
const slug = (await q('SELECT slug FROM hunter.product'))[0].slug;

// nova leitura: preço cai e esgota → histórico cresce, estoque registra a mudança, slug não muda
const H2 = { t: '2026-10-09T10:00:00Z', offerId: 'o1', productId: 'me05-etb', price: 320, total: 320, shipping: null, stock: 'OUT_OF_STOCK' };
await tx((c) => syncState(c, { state: state(offer(320, 'OUT_OF_STOCK', '2026-10-09T10:00:00Z')), catalog, historyLines: [H0, H1, H2] }));
assert.deepEqual((await q('SELECT price::float FROM hunter.price_history WHERE offer_id = (SELECT id FROM hunter.offer WHERE legacy_id = $1) ORDER BY observed_at', ['o1'])).map((r) => r.price), [350, 320]);
assert.equal((await q("SELECT to_status FROM hunter.stock_event"))[0].to_status, 'out_of_stock');
assert.equal((await q('SELECT slug FROM hunter.product'))[0].slug, slug);
assert.equal((await q('SELECT total_price FROM hunter.offer WHERE legacy_id = $1', ['o1']))[0].total_price, null, 'frete desconhecido: sem total');
assert.equal((await q("SELECT count(*)::int n FROM hunter.reference_price_current"))[0].n, 1);
assert.equal((await q("SELECT status FROM hunter.offer WHERE legacy_id = 'velha'"))[0].status, 'removed');

// corrida/retry: resposta antiga não sobrescreve observação mais nova; mesma leitura repetida é idempotente
const cur = async () => (await q('SELECT price::float, stock_status, last_seen_at FROM hunter.offer WHERE legacy_id = $1', ['o1']))[0];
const stale = await tx((c) => syncState(c, { state: state(offer(999, 'IN_STOCK', '2026-10-08T12:00:00Z')), catalog, historyLines: [] }));
assert.equal(stale.offersStale, 1); assert.equal(stale.stockEvents, 0);
assert.deepEqual([(await cur()).price, (await cur()).stock_status], [320, 'out_of_stock'], 'leitura antiga descartada');
const retry = await tx((c) => syncState(c, { state: state(offer(320, 'OUT_OF_STOCK', '2026-10-09T10:00:00Z')), catalog, historyLines: [] }));
assert.equal(retry.offersStale, 0, 'mesmo carimbo é aceito (retry idempotente)');
await Promise.all([ // dois syncs concorrentes, o mais novo vence qualquer que seja a ordem
  tx((c) => syncState(c, { state: state(offer(310, 'IN_STOCK', '2026-10-09T11:00:00Z')), catalog, historyLines: [] })),
  tx((c) => syncState(c, { state: state(offer(305, 'IN_STOCK', '2026-10-09T12:00:00Z')), catalog, historyLines: [] }))]);
assert.equal((await cur()).price, 305, 'observação mais recente prevalece na concorrência');
// sem carimbo da fonte: vale como leitura de agora (não congela a oferta)
await tx((c) => syncState(c, { state: state({ ...offer(300, 'IN_STOCK', null), source_timestamp: undefined }), catalog, historyLines: [] }));
assert.equal((await cur()).price, 300);

// oferta some da loja → removida, histórico intacto
await tx((c) => syncState(c, { state: { ...state(offer(320, 'OUT_OF_STOCK', '2026-10-09T10:00:00Z')), offers: [] }, catalog, historyLines: [] }));
assert.equal((await q("SELECT status FROM hunter.offer WHERE legacy_id = 'o1'"))[0].status, 'removed');
assert.equal((await q('SELECT count(*)::int n FROM hunter.price_history'))[0].n, 3);

// banco recusa total inventado
await assert.rejects(p.query(`INSERT INTO hunter.offer (product_id, marketplace_id, title_raw, url, total_price, shipping_status) SELECT id, 'direct', 'x', 'y', 10, 'unknown' FROM hunter.product LIMIT 1`));
await close();
console.log('OK — Marketplace Core (PostgreSQL)');
