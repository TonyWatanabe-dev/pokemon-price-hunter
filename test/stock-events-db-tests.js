// Integridade dos eventos de estoque no PostgreSQL: stock_event só entre estados lidos de verdade.
// Só roda com TEST_DATABASE_URL (banco descartável); sem ele, pula como os demais testes de banco.
import assert from 'node:assert/strict';
if (!process.env.TEST_DATABASE_URL) { console.log('— testes de banco dos eventos de estoque pulados (sem TEST_DATABASE_URL)'); process.exit(0); }
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const { pool, tx, close } = await import('../src/db/pg.js');
const { syncState } = await import('../src/core/sync.js');
const { staleCopy } = await import('../src/run.js');
const { execFileSync } = await import('node:child_process');
const p = await pool();
await p.query('DROP SCHEMA IF EXISTS hunter CASCADE');
execFileSync('node', ['tools/db-migrate.mjs'], { env: process.env, stdio: 'pipe' });

const catalog = { collections: [{ id: 'me05', name: 'Escuridão Absoluta', series: 'Megaevolução' }] };
const prod = { id: 'me05-etb', collection: 'me05', collectionName: 'Escuridão Absoluta', type: 'etb', typeLabel: 'Treinador Avançado (ETB)', group: 'ETB', boosters: 9, offerCount: 2, copagConfirmed: false, copag: {} };
const offer = (id, stock, t) => ({ id, productId: 'me05-etb', storeId: 'loja', title: 'ETB', url: 'https://loja/' + id, price: 350, total: 350, shipping: null, shippingKnown: false, stock, matchConfidence: 0.9, firstSeen: '2026-10-08T10:00:00Z', source_timestamp: t });
const state = (offers) => ({ collections: [], products: [prod], sources: [{ id: 'loja', name: 'Loja', url: 'https://loja.com.br', status: 'ACTIVE' }], reputation: {}, offers });
const H = (id, t, stock) => ({ t, offerId: id, productId: 'me05-etb', storeId: 'loja', price: 350, total: 350, shipping: null, stock });
const q = async (sql, a = []) => (await p.query(sql, a)).rows;
const events = async (id) => q('SELECT from_status, to_status FROM hunter.stock_event WHERE offer_id = (SELECT id FROM hunter.offer WHERE legacy_id = $1) ORDER BY observed_at, id', [id]);
const sync = (offers, hist) => tx((c) => syncState(c, { state: state(offers), catalog, historyLines: hist }));
let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };

const T = (m) => new Date(Date.parse('2026-10-08T10:00:00Z') + m * 60e3).toISOString();
const hist = [];
const round = async (m, offers) => { for (const o of offers) if (!o.stale) hist.push(H(o.id, T(m), o.stock)); await sync(offers, [...hist]); };

// a: em estoque → leitura falha (oferta stale, como o robô grava) → em estoque.
// b: esgotado → falha → em estoque (restock real, a partir do último estado conhecido).
// c: em estoque → esgotado, sem falha no meio (mudança real).
// d: oferta nova cuja primeira leitura falha e depois aparece em estoque (sem evidência anterior).
const a0 = offer('a', 'IN_STOCK', T(0)); const b0 = offer('b', 'OUT_OF_STOCK', T(0)); const c0 = offer('c', 'IN_STOCK', T(0));
await round(0, [a0, b0, c0]);

await t('leitura que falha (stale) não gera stock_event', async () => {
  await round(15, [staleCopy(a0), staleCopy(b0), offer('c', 'OUT_OF_STOCK', T(15))]);
  assert.deepEqual(await events('a'), []); assert.deepEqual(await events('b'), []);
  const [ra] = await q("SELECT status, stock_status FROM hunter.offer WHERE legacy_id = 'a'");
  assert.deepEqual(ra, { status: 'pending', stock_status: 'unknown' }, 'a rodada sem leitura deixa a oferta pendente e o estoque desconhecido');
});

await t('mudança real de estoque continua registrada', async () => {
  assert.deepEqual(await events('c'), [{ from_status: 'in_stock', to_status: 'out_of_stock' }]);
});

await t('segunda falha seguida também não gera evento', async () => {
  await round(30, [staleCopy(staleCopy(a0)), staleCopy(staleCopy(b0)), offer('c', 'OUT_OF_STOCK', T(30))]);
  assert.deepEqual(await events('a'), []); assert.deepEqual(await events('b'), []);
});

await t('em estoque → falha → em estoque: nenhum evento (anterior unknown resolvido pelo histórico)', async () => {
  await round(45, [offer('a', 'IN_STOCK', T(45)), offer('b', 'IN_STOCK', T(45)), offer('c', 'OUT_OF_STOCK', T(45))]);
  assert.deepEqual(await events('a'), []);
});

await t('restock real depois de falha: esgotado → (falha) → em estoque gera um evento a partir do último estado conhecido', async () => {
  assert.deepEqual(await events('b'), [{ from_status: 'out_of_stock', to_status: 'in_stock' }]);
});

await t('restock real sem falha no meio continua registrado', async () => {
  await round(60, [offer('a', 'IN_STOCK', T(60)), offer('b', 'IN_STOCK', T(60)), offer('c', 'IN_STOCK', T(60))]);
  assert.deepEqual(await events('c'), [{ from_status: 'in_stock', to_status: 'out_of_stock' }, { from_status: 'out_of_stock', to_status: 'in_stock' }]);
});

await t('sem estoque conhecido antes, não inventa transição', async () => {
  const d0 = { ...offer('d', 'UNKNOWN', T(75)) }; // primeira leitura sem estoque informado
  await round(75, [offer('a', 'IN_STOCK', T(75)), offer('b', 'IN_STOCK', T(75)), offer('c', 'IN_STOCK', T(75)), d0]);
  await round(90, [offer('a', 'IN_STOCK', T(90)), offer('b', 'IN_STOCK', T(90)), offer('c', 'IN_STOCK', T(90)), offer('d', 'IN_STOCK', T(90))]);
  assert.deepEqual(await events('d'), []);
});

await t('ativa com estoque desconhecido não vira evento "→ unknown"', async () => {
  await round(105, [offer('a', 'UNKNOWN', T(105)), offer('b', 'IN_STOCK', T(105)), offer('c', 'IN_STOCK', T(105))]);
  assert.deepEqual(await events('a'), []);
  await round(120, [offer('a', 'IN_STOCK', T(120)), offer('b', 'IN_STOCK', T(120)), offer('c', 'IN_STOCK', T(120))]);
  assert.deepEqual(await events('a'), [], 'e a volta para em estoque também não (último conhecido já era em estoque)');
});

await t('oferta removida que reaparece em estoque: compara com o último estoque conhecido', async () => {
  await round(135, [offer('a', 'IN_STOCK', T(135)), offer('c', 'IN_STOCK', T(135))]); // b sumiu
  assert.equal((await q("SELECT status FROM hunter.offer WHERE legacy_id = 'b'"))[0].status, 'removed');
  await round(150, [offer('a', 'IN_STOCK', T(150)), offer('b', 'IN_STOCK', T(150)), offer('c', 'IN_STOCK', T(150))]);
  assert.deepEqual(await events('b'), [{ from_status: 'out_of_stock', to_status: 'in_stock' }], 'nenhum evento novo: o último conhecido era em estoque');
});

await close();
console.log(`✓ Eventos de estoque (PostgreSQL): ${n} grupos passaram`);
