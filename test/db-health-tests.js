// Sync parcial por loja (docs/auditorias/frescor-sync.md, proposta 6): max(last_seen_at) por loja ativa e
// storeSyncStatus marcando `atrasado` quando uma loja ativa fica mais de 90 min atrás da mais recente. Banco simulado.
import assert from 'node:assert/strict';
import { readStoreSeen, storeSyncStatus, SQL_SEEN_BY_STORE, STORE_LAG_MAX_MIN } from '../src/db-health.js';

let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };
const iso = (base, min) => new Date(Date.parse(base) + min * 6e4).toISOString();
const G = '2026-10-12T12:00:00.000Z';
const row = (storeId, min) => ({ storeId, lastSeenAt: iso(G, min) });
const fakeClient = (rows) => { const calls = []; return { calls, query: async (sql) => { calls.push(sql); return { rows }; } }; };

await t('consulta: max(last_seen_at) por loja, só lojas e ofertas ativas, só leitura', () => {
  assert.match(SQL_SEEN_BY_STORE, /max\(o\.last_seen_at\)/);
  assert.match(SQL_SEEN_BY_STORE, /GROUP BY o\.store_id/);
  assert.match(SQL_SEEN_BY_STORE, /s\.status = 'active'/);
  assert.match(SQL_SEEN_BY_STORE, /o\.status = 'active'/);
  assert.doesNotMatch(SQL_SEEN_BY_STORE, /\b(INSERT|UPDATE|DELETE|DROP|ALTER)\b/i);
  assert.equal(STORE_LAG_MAX_MIN, 90);
});

await t('readStoreSeen: normaliza as linhas do banco simulado (Date → ISO, data inválida → null)', async () => {
  const c = fakeClient([{ store_id: 'loja-a', last_seen_at: new Date(G) }, { store_id: 'loja-b', last_seen_at: 'lixo' }]);
  const r = await readStoreSeen(c);
  assert.deepEqual(c.calls, [SQL_SEEN_BY_STORE]);
  assert.deepEqual(r, [{ storeId: 'loja-a', lastSeenAt: G }, { storeId: 'loja-b', lastSeenAt: null }]);
});

await t('todas as lojas no mesmo sync: ok', () => {
  const s = storeSyncStatus([row('loja-a', 0), row('loja-b', 0), row('loja-c', -1)]);
  assert.equal(s.status, 'ok'); assert.equal(s.refAt, G); assert.equal(s.stores, 3); assert.deepEqual(s.late, []);
});

await t('sync parcial: loja ativa mais de 90 min atrás fica atrasada, mesmo com as outras em dia', () => {
  const s = storeSyncStatus([row('loja-a', 0), row('loja-b', -91), row('loja-c', -15)]);
  assert.equal(s.status, 'atrasado'); assert.equal(s.refAt, G); assert.equal(s.maxLagMin, 90);
  assert.deepEqual(s.late, [{ storeId: 'loja-b', lastSeenAt: iso(G, -91), lagMin: 91 }]);
});

await t('limite: exatamente 90 min atrás ainda é ok; 90 min e 1 s já é atrasado', () => {
  assert.equal(storeSyncStatus([row('loja-a', 0), row('loja-b', -90)]).status, 'ok');
  const s = storeSyncStatus([row('loja-a', 0), { storeId: 'loja-b', lastSeenAt: new Date(Date.parse(G) - 90 * 6e4 - 1000).toISOString() }]);
  assert.equal(s.status, 'atrasado'); assert.equal(s.late[0].storeId, 'loja-b');
});

await t('várias lojas atrasadas: ordenadas da mais atrasada para a menos', () => {
  const s = storeSyncStatus([row('loja-c', -120), row('loja-a', 0), row('loja-b', -300), row('loja-d', -120)]);
  assert.deepEqual(s.late.map((l) => [l.storeId, l.lagMin]), [['loja-b', 300], ['loja-c', 120], ['loja-d', 120]]);
});

await t('limite configurável', () => {
  assert.equal(storeSyncStatus([row('loja-a', 0), row('loja-b', -45)], { maxLagMin: 30 }).status, 'atrasado');
  assert.equal(storeSyncStatus([row('loja-a', 0), row('loja-b', -45)], { maxLagMin: 60 }).status, 'ok');
});

await t('sem medida: sem_referencia (nunca lança); linhas sem data são ignoradas', () => {
  for (const v of [undefined, null, [], [{ storeId: 'loja-a', lastSeenAt: null }], [null], 'x']) {
    const s = storeSyncStatus(v);
    assert.equal(s.status, 'sem_referencia'); assert.equal(s.refAt, null); assert.deepEqual(s.late, []);
  }
  const s = storeSyncStatus([row('loja-a', 0), { storeId: 'loja-b', lastSeenAt: null }]);
  assert.equal(s.status, 'ok'); assert.equal(s.stores, 1);
});

console.log(`✓ Sync por loja (db-health): ${n} grupos passaram`);
