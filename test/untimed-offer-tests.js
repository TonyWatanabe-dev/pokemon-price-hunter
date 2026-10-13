// Oferta legada sem source_timestamp (#626, lacuna 2 de docs/frescor.md), sem banco: o syncState roda contra um cliente
// falso que imita o upsert de offer (linha candidata com coalesce(last_seen_at, now()), CASE do last_seen_at para as
// ofertas sem horário em $3 e a guarda WHERE). Prova que ausência de horário não é leitura nova: oferta já gravada mantém
// o last_seen_at (o resto atualiza), oferta nova sem horário não é gravada com now(), o max(last_seen_at) do frescor não
// avança e não há evento de estoque sem horário. A leitura real com horário segue avançando normalmente.
// O comportamento real no PostgreSQL está em db-tests.js.
import assert from 'node:assert/strict';
import { syncState } from '../src/core/sync.js';
import { offersRows } from '../src/core/mappers.js';
import { classify, offerFreshness } from '../api/_lib/freshness.mjs';

const NOW = Date.parse('2026-10-13T12:00:00.000Z');
const at = (min) => new Date(NOW + min * 60e3).toISOString();
const catalog = { collections: [{ id: 'me05', name: 'Escuridão Absoluta', series: 'Megaevolução' }] };
const prod = { id: 'me05-etb', collection: 'me05', collectionName: 'Escuridão Absoluta', type: 'etb', typeLabel: 'Treinador Avançado (ETB)', group: 'ETB', boosters: 9, offerCount: 1, copagConfirmed: false, copag: {} };
const offer = (id, t, extra = {}) => ({ id, productId: 'me05-etb', storeId: 'loja', title: 'ETB', url: 'https://loja/' + id, price: 350, total: 350, shipping: null, shippingKnown: false, stock: 'IN_STOCK', matchConfidence: 0.9, firstSeen: '2026-10-08T10:00:00Z', source_timestamp: t, ...extra });
// Legado: staleCopy de uma oferta sem horário (o robô atual sempre grava o horário da rodada).
const legacyStale = (id) => { const o = offer(id, undefined, { stale: true, stock: 'UNKNOWN', lastValid: { stock: 'IN_STOCK', at: null } }); delete o.source_timestamp; return o; };
const state = (offers) => ({ collections: [], products: [prod], sources: [{ id: 'loja', name: 'Loja', url: 'https://loja.com.br', status: 'ACTIVE' }], reputation: {}, offers });

function fakeDb({ offers = [], dbNow = NOW } = {}) {
  const db = { offers: new Map(offers.map((o) => [o.legacy_id, { ...o }])), stockEvents: [], offerSql: '', offerParams: null };
  let nextId = 100;
  db.c = { query: async (sql, a = []) => {
    if (/^SELECT now\(\) AS now$/.test(sql)) return { rows: [{ now: new Date(dbNow) }] };
    if (/SELECT legacy_id, id FROM product/.test(sql)) return { rows: [{ legacy_id: 'me05-etb', id: 1 }] };
    if (/SELECT legacy_id, id, stock_status(, status)? FROM offer/.test(sql)) return { rows: [...db.offers.values()].map(({ legacy_id, id, stock_status, status }) => ({ legacy_id, id, stock_status, status })) };
    if (/^\s*INSERT INTO offer \(legacy_id, product_id, store_id, marketplace_id, seller_id/.test(sql)) {
      db.offerSql = sql; db.offerParams = a;
      const bound = Date.parse(a[1]); const untimed = a[2] || [];
      const applied = [];
      for (const r of JSON.parse(a[0])) {
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
const sync = (db, offers) => syncState(db.c, { state: state(offers), catalog, historyLines: [] });
const rowOf = (db, id) => db.offers.get(id) ?? null;
// Espelho de DB_AT_SQL: max(last_seen_at) das ativas/pendentes, sem horário além de now + 5 min.
const dbAt = (db) => { const xs = [...db.offers.values()].filter((o) => ['active', 'pending'].includes(o.status) && o.last_seen_at && Date.parse(o.last_seen_at) <= NOW + 5 * 60e3).map((o) => o.last_seen_at).sort(); return xs.at(-1) ?? null; };
const OLD = at(-48 * 60); // última leitura real, há 2 dias
let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };

await t('1. mapeamento: sem source_timestamp o banco recebe nulo (nada inventado no mapper)', () => {
  const [r] = offersRows([legacyStale('x')]);
  assert.equal(r.last_seen_at, null); assert.equal(r.status, 'pending'); assert.equal(r.stock_status, 'unknown');
});

await t('2. oferta stale legada sem horário: last_seen_at gravado não vira now(); o resto atualiza', async () => {
  const db = fakeDb({ offers: [{ legacy_id: 'x', id: 1, price: 350, stock_status: 'in_stock', status: 'active', last_seen_at: OLD }] });
  const s = await sync(db, [legacyStale('x')]);
  assert.equal(rowOf(db, 'x').last_seen_at, OLD, 'ausência de horário não é leitura nova');
  assert.equal(rowOf(db, 'x').status, 'pending'); assert.equal(rowOf(db, 'x').stock_status, 'unknown', 'o estado da oferta não congela');
  assert.equal(s.offersStale, 0); assert.equal(s.offersNoTimestamp, 0); assert.equal(s.offersRemoved, 0);
  assert.equal(dbAt(db), OLD, 'o max(last_seen_at) do frescor não avança');
  assert.equal(classify(dbAt(db), NOW).status, 'indisponivel');
  assert.deepEqual(offerFreshness(rowOf(db, 'x').last_seen_at, NOW), { status: 'indisponivel', ageMin: 48 * 60 }, 'idade real da última leitura');
  assert.match(db.offerSql, /last_seen_at = CASE WHEN EXCLUDED\.legacy_id = ANY\(\$3::text\[\]\) THEN offer\.last_seen_at ELSE EXCLUDED\.last_seen_at END/);
  assert.deepEqual(db.offerParams[2], ['x']);
});

await t('3. leitura real com horário: avança last_seen_at e o frescor normalmente', async () => {
  const db = fakeDb({ offers: [{ legacy_id: 'x', id: 1, price: 350, stock_status: 'unknown', status: 'pending', last_seen_at: OLD }] });
  const s = await sync(db, [offer('x', at(0), { price: 330 })]);
  assert.equal(rowOf(db, 'x').last_seen_at, at(0)); assert.equal(rowOf(db, 'x').status, 'active'); assert.equal(rowOf(db, 'x').price, 330);
  assert.equal(s.offersStale, 0); assert.deepEqual(db.offerParams[2], []);
  assert.equal(classify(dbAt(db), NOW).status, 'atual');
  // e a guarda de corrida continua: leitura mais antiga que a gravada é descartada
  assert.equal((await sync(db, [offer('x', at(-10), { price: 999 })])).offersStale, 1); assert.equal(rowOf(db, 'x').price, 330);
});

await t('4. oferta nova sem horário não é gravada (NOT NULL sem horário real); continua viva e as demais entram', async () => {
  const db = fakeDb({ offers: [{ legacy_id: 'x', id: 1, price: 350, stock_status: 'in_stock', status: 'active', last_seen_at: OLD }] });
  const s = await sync(db, [legacyStale('nova'), offer('x', at(-5))]);
  assert.equal(rowOf(db, 'nova'), null, 'não ganha now() como "leitura"');
  assert.equal(s.offersNoTimestamp, 1); assert.equal(s.offers, 1); assert.equal(s.offersRemoved, 0);
  assert.equal(rowOf(db, 'x').last_seen_at, at(-5)); assert.equal(dbAt(db), at(-5));
});

await t('5. sem horário, mesmo não stale: atualiza o preço, mas não gera evento de estoque nem renova o horário', async () => {
  const db = fakeDb({ offers: [{ legacy_id: 'x', id: 1, price: 350, stock_status: 'in_stock', status: 'active', last_seen_at: OLD }] });
  const o = offer('x', undefined, { price: 300, stock: 'OUT_OF_STOCK' }); delete o.source_timestamp;
  const s = await sync(db, [o]);
  assert.equal(rowOf(db, 'x').price, 300); assert.equal(rowOf(db, 'x').stock_status, 'out_of_stock');
  assert.equal(rowOf(db, 'x').last_seen_at, OLD);
  assert.equal(s.stockEvents, 0); assert.equal(db.stockEvents.length, 0, 'sem horário real não há evento');
  // com horário, a mesma mudança gera o evento com o horário da leitura
  const db2 = fakeDb({ offers: [{ legacy_id: 'x', id: 1, price: 350, stock_status: 'in_stock', status: 'active', last_seen_at: OLD }] });
  assert.equal((await sync(db2, [offer('x', at(0), { stock: 'OUT_OF_STOCK' })])).stockEvents, 1);
  assert.equal(db2.stockEvents[0].observed_at, at(0));
});

console.log(`OK — oferta sem horário não vira leitura nova (${n} casos)`);
