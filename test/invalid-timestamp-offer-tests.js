// Oferta com horário inválido (#627, lacuna 3 de docs/frescor.md), sem banco: o syncState roda contra um cliente falso
// que imita o upsert de offer (linha candidata com coalesce(last_seen_at, now()), CASE das ofertas sem horário em $3 e a
// guarda WHERE). Prova que um source_timestamp/firstSeen não interpretável não derruba a sincronização inteira: o
// mapeamento continua recusando (nada inventado), a oferta ruim é isolada e contada, as válidas são gravadas, a oferta
// isolada não vira 'removed' nem renova o horário, e a próxima leitura válida a recupera.
import assert from 'node:assert/strict';
import { syncState } from '../src/core/sync.js';
import { offersRows } from '../src/core/mappers.js';
import { classify } from '../api/_lib/freshness.mjs';

const NOW = Date.parse('2026-10-13T12:00:00.000Z');
const at = (min) => new Date(NOW + min * 60e3).toISOString();
const catalog = { collections: [{ id: 'me05', name: 'Escuridão Absoluta', series: 'Megaevolução' }] };
const prod = { id: 'me05-etb', collection: 'me05', collectionName: 'Escuridão Absoluta', type: 'etb', typeLabel: 'Treinador Avançado (ETB)', group: 'ETB', boosters: 9, offerCount: 1, copagConfirmed: false, copag: {} };
const offer = (id, t, extra = {}) => ({ id, productId: 'me05-etb', storeId: 'loja', title: 'ETB', url: 'https://loja/' + id, price: 350, total: 350, shipping: null, shippingKnown: false, stock: 'IN_STOCK', matchConfidence: 0.9, firstSeen: '2026-10-08T10:00:00Z', source_timestamp: t, ...extra });
const state = (offers) => ({ collections: [], products: [prod], sources: [{ id: 'loja', name: 'Loja', url: 'https://loja.com.br', status: 'ACTIVE' }], reputation: {}, offers });

function fakeDb({ offers = [], dbNow = NOW } = {}) {
  const db = { offers: new Map(offers.map((o) => [o.legacy_id, { ...o }])), stockEvents: [], offerRows: null };
  let nextId = 100;
  db.c = { query: async (sql, a = []) => {
    if (/^SELECT now\(\) AS now$/.test(sql)) return { rows: [{ now: new Date(dbNow) }] };
    if (/SELECT legacy_id, id FROM product/.test(sql)) return { rows: [{ legacy_id: 'me05-etb', id: 1 }] };
    if (/SELECT legacy_id, id, stock_status(, status)? FROM offer/.test(sql)) return { rows: [...db.offers.values()].map(({ legacy_id, id, stock_status, status }) => ({ legacy_id, id, stock_status, status })) };
    if (/^\s*INSERT INTO offer \(legacy_id, product_id, store_id, marketplace_id, seller_id/.test(sql)) {
      const bound = Date.parse(a[1]); const untimed = a[2] || [];
      db.offerRows = JSON.parse(a[0]);
      const applied = [];
      for (const r of db.offerRows) {
        const cur = db.offers.get(r.legacy_id);
        const cand = r.last_seen_at || new Date(dbNow).toISOString(); // coalesce(last_seen_at, now()) da linha candidata
        if (!cur) { db.offers.set(r.legacy_id, { id: nextId++, legacy_id: r.legacy_id, price: r.price, stock_status: r.stock_status, status: r.status, last_seen_at: cand }); applied.push({ legacy_id: r.legacy_id }); continue; }
        const noTs = untimed.includes(r.legacy_id); const curT = cur.last_seen_at ? Date.parse(cur.last_seen_at) : null;
        if (!(noTs || curT == null || curT <= Date.parse(cand) || curT > bound)) continue;
        Object.assign(cur, { price: r.price, stock_status: r.stock_status, status: r.status, last_seen_at: noTs ? cur.last_seen_at : cand });
        applied.push({ legacy_id: r.legacy_id });
      }
      return { rows: applied, rowCount: applied.length };
    }
    if (/SELECT legacy_id, id FROM offer WHERE legacy_id IS NOT NULL/.test(sql)) return { rows: [...db.offers.values()].map(({ legacy_id, id }) => ({ legacy_id, id })) };
    if (/UPDATE offer SET status = 'removed'/.test(sql)) {
      let n = 0;
      for (const o of db.offers.values()) if (o.status !== 'removed' && !a[0].includes(o.legacy_id)) { o.status = 'removed'; n++; }
      return { rows: [], rowCount: n };
    }
    if (/INSERT INTO stock_event/.test(sql)) { const rows = JSON.parse(a[0]); db.stockEvents.push(...rows); return { rows: [], rowCount: rows.length }; }
    if (/SELECT max\(observed_at\)/.test(sql)) return { rows: [{ m: null }] };
    return { rows: [], rowCount: 0 };
  } };
  return db;
}
const sync = (db, offers, log) => syncState(db.c, { state: state(offers), catalog, historyLines: [], log });
const rowOf = (db, id) => db.offers.get(id) ?? null;
// Espelho de DB_AT_SQL: max(last_seen_at) das ativas/pendentes, sem horário além de now + 5 min.
const dbAt = (db) => { const xs = [...db.offers.values()].filter((o) => ['active', 'pending'].includes(o.status) && o.last_seen_at && Date.parse(o.last_seen_at) <= NOW + 5 * 60e3).map((o) => o.last_seen_at).sort(); return xs.at(-1) ?? null; };
const OLD = at(-48 * 60); // última leitura válida, há 2 dias
const saved = (id, extra = {}) => ({ legacy_id: id, id: id === 'x' ? 1 : 2, price: 350, stock_status: 'in_stock', status: 'active', last_seen_at: OLD, ...extra });
let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };

await t('1. reprodução: o mapeamento continua recusando horário não interpretável (não inventa horário)', () => {
  assert.throws(() => offersRows([offer('x', 'ontem à noite')]), RangeError);
  assert.throws(() => offersRows([offer('x', at(0), { firstSeen: '32/13/2026' })]), RangeError);
});

await t('2. lote com oferta válida + inválida: a sync não falha, a válida é gravada e a inválida fica isolada e observável', async () => {
  const db = fakeDb({ offers: [saved('x'), saved('y')] });
  const logged = [];
  const s = await sync(db, [offer('x', at(0), { price: 330 }), offer('y', 'não é data', { price: 1 })], (st) => logged.push(st));
  assert.equal(rowOf(db, 'x').last_seen_at, at(0)); assert.equal(rowOf(db, 'x').price, 330, 'a válida é publicada');
  assert.equal(rowOf(db, 'y').last_seen_at, OLD, 'a inválida não ganha horário'); assert.equal(rowOf(db, 'y').price, 350, 'nem preço novo sem horário real');
  assert.equal(rowOf(db, 'y').status, 'active', 'continua viva: não vira removed');
  assert.deepEqual(db.offerRows.map((r) => r.legacy_id), ['x'], 'só a válida chega ao upsert');
  assert.equal(s.offersInvalidTimestamp, 1); assert.deepEqual(s.offersInvalidTimestampIds, ['y']);
  assert.equal(s.offers, 1); assert.equal(s.offersRemoved, 0); assert.equal(s.offersStale, 0);
  assert.equal(logged.length, 1); assert.equal(logged[0].offersInvalidTimestamp, 1, 'a falha aparece no log da sync');
  assert.equal(classify(dbAt(db), NOW).status, 'atual');
});

await t('3. todas inválidas: nada é gravado, nada vira removed, o frescor do banco não avança', async () => {
  const db = fakeDb({ offers: [saved('x'), saved('y')] });
  const s = await sync(db, [offer('x', 'NaN'), offer('y', '2026-13-45T99:00:00Z')]);
  assert.deepEqual(db.offerRows, []);
  assert.equal(s.offersInvalidTimestamp, 2); assert.deepEqual(s.offersInvalidTimestampIds, ['x', 'y']);
  assert.equal(s.offers, 0); assert.equal(s.offersRemoved, 0); assert.equal(s.stockEvents, 0);
  assert.equal(rowOf(db, 'x').last_seen_at, OLD); assert.equal(rowOf(db, 'y').last_seen_at, OLD);
  assert.equal(dbAt(db), OLD); assert.equal(classify(dbAt(db), NOW).status, 'indisponivel');
});

await t('4. oferta nova com horário inválido não é gravada; firstSeen inválido também isola', async () => {
  const db = fakeDb({ offers: [saved('x')] });
  const s = await sync(db, [offer('x', at(-5)), offer('nova', 'amanhã'), offer('outra', at(-5), { firstSeen: 'sempre' })]);
  assert.equal(rowOf(db, 'nova'), null); assert.equal(rowOf(db, 'outra'), null, 'first_seen_at não é inventado');
  assert.equal(s.offersInvalidTimestamp, 2); assert.deepEqual(s.offersInvalidTimestampIds, ['nova', 'outra']);
  assert.equal(rowOf(db, 'x').last_seen_at, at(-5));
});

await t('5. horário ausente não é inválido: segue o contrato da #626 (mantém o gravado, sem isolar)', async () => {
  const db = fakeDb({ offers: [saved('x')] });
  const o = offer('x', undefined, { stale: true, stock: 'UNKNOWN' }); delete o.source_timestamp;
  const s = await sync(db, [o, offer('y', 'inválido')]);
  assert.equal(s.offersInvalidTimestamp, 1); assert.deepEqual(s.offersInvalidTimestampIds, ['y']);
  assert.equal(rowOf(db, 'x').status, 'pending'); assert.equal(rowOf(db, 'x').last_seen_at, OLD);
  assert.equal(s.offers, 1); assert.equal(s.offersNoTimestamp, 0);
});

await t('6. recuperação: leitura válida posterior volta a gravar a oferta isolada, com evento de estoque real', async () => {
  const db = fakeDb({ offers: [saved('x'), saved('y')] });
  await sync(db, [offer('x', at(-10)), offer('y', 'lixo', { stock: 'OUT_OF_STOCK' })]);
  assert.equal(rowOf(db, 'y').last_seen_at, OLD); assert.equal(db.stockEvents.length, 0, 'sem horário real não há evento');
  const s = await sync(db, [offer('x', at(0)), offer('y', at(0), { price: 320, stock: 'OUT_OF_STOCK' })]);
  assert.equal(s.offersInvalidTimestamp, 0); assert.deepEqual(s.offersInvalidTimestampIds, []);
  assert.equal(rowOf(db, 'y').last_seen_at, at(0)); assert.equal(rowOf(db, 'y').price, 320); assert.equal(rowOf(db, 'y').stock_status, 'out_of_stock');
  assert.equal(s.stockEvents, 1); assert.equal(db.stockEvents[0].observed_at, at(0));
  assert.equal(classify(dbAt(db), NOW).status, 'atual');
});

await t('7. muitas inválidas: a contagem é completa e a lista de ids é limitada', async () => {
  const db = fakeDb();
  const s = await sync(db, Array.from({ length: 25 }, (_, i) => offer('b' + i, 'x' + i)));
  assert.equal(s.offersInvalidTimestamp, 25); assert.equal(s.offersInvalidTimestampIds.length, 20);
});

console.log(`OK — oferta com horário inválido isolada na sync (${n} casos)`);
