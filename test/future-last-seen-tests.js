// last_seen_at no futuro (#620, lacuna 6 de docs/frescor.md), sem banco: o syncState roda contra um cliente falso que
// imita a guarda do upsert de offer (WHERE offer.last_seen_at IS NULL OR <= EXCLUDED OR > $2). Prova que horário além de
// 5 min no futuro não é gravado, que valor futuro já gravado não bloqueia a próxima leitura válida (recuperação) e que o
// max(last_seen_at) do frescor e a página de lojas não tratam horário futuro como leitura válida.
// O comportamento real no PostgreSQL da guarda está em db-tests.js e stock-events-db-tests.js.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { syncState } from '../src/core/sync.js';
import { isFutureAt } from '../src/core/mappers.js';
import { classify, DB_AT_SQL } from '../api/_lib/freshness.mjs';
import { normalizeLojas } from '../api/_lib/lojas.mjs';

const NOW = Date.parse('2026-10-13T12:00:00.000Z');
const at = (min) => new Date(NOW + min * 60e3).toISOString();
const catalog = { collections: [{ id: 'me05', name: 'Escuridão Absoluta', series: 'Megaevolução' }] };
const prod = { id: 'me05-etb', collection: 'me05', collectionName: 'Escuridão Absoluta', type: 'etb', typeLabel: 'Treinador Avançado (ETB)', group: 'ETB', boosters: 9, offerCount: 1, copagConfirmed: false, copag: {} };
const offer = (id, t, extra = {}) => ({ id, productId: 'me05-etb', storeId: 'loja', title: 'ETB', url: 'https://loja/' + id, price: 350, total: 350, shipping: null, shippingKnown: false, stock: 'IN_STOCK', matchConfidence: 0.9, firstSeen: '2026-10-08T10:00:00Z', source_timestamp: t, ...extra });
const state = (offers) => ({ collections: [], products: [prod], sources: [{ id: 'loja', name: 'Loja', url: 'https://loja.com.br', status: 'ACTIVE' }], reputation: {}, offers });

// Banco em memória com o relógio do banco em NOW (dbNow). oldGuard = guarda de antes da #620 (sem o limite $2).
function fakeDb({ offers = [], history = [], dbNow = NOW, oldGuard = false } = {}) {
  const db = { offers: new Map(offers.map((o) => [o.legacy_id, { ...o }])), history: [...history], upserts: 0, live: null, historyMaxBound: undefined, offerSql: '' };
  let nextId = 100;
  db.c = { query: async (sql, a = []) => {
    if (/^SELECT now\(\) AS now$/.test(sql)) return { rows: [{ now: new Date(dbNow) }] };
    if (/SELECT legacy_id, id FROM product/.test(sql)) return { rows: [{ legacy_id: 'me05-etb', id: 1 }] };
    if (/SELECT legacy_id, id, stock_status(, status)? FROM offer/.test(sql)) return { rows: [...db.offers.values()].map(({ legacy_id, id, stock_status, status }) => ({ legacy_id, id, stock_status, status })) };
    if (/^\s*INSERT INTO offer \(legacy_id, product_id, store_id, marketplace_id, seller_id/.test(sql)) {
      db.upserts++; db.offerSql = sql;
      const bound = oldGuard ? null : Date.parse(a[1]);
      const applied = [];
      for (const r of JSON.parse(a[0])) {
        const cur = db.offers.get(r.legacy_id); const seen = r.last_seen_at || new Date(dbNow).toISOString();
        const curT = cur?.last_seen_at ? Date.parse(cur.last_seen_at) : null;
        if (!(curT == null || curT <= Date.parse(seen) || (bound != null && curT > bound))) continue;
        db.offers.set(r.legacy_id, { ...(cur || { id: nextId++ }), legacy_id: r.legacy_id, stock_status: r.stock_status, status: r.status, last_seen_at: seen });
        applied.push({ legacy_id: r.legacy_id });
      }
      return { rows: applied, rowCount: applied.length };
    }
    if (/SELECT legacy_id, id FROM offer WHERE legacy_id IS NOT NULL/.test(sql)) return { rows: [...db.offers.values()].map(({ legacy_id, id }) => ({ legacy_id, id })) };
    if (/UPDATE offer SET status = 'removed'/.test(sql)) {
      db.live = a[0]; let n = 0;
      for (const o of db.offers.values()) if (o.status !== 'removed' && !a[0].includes(o.legacy_id)) { o.status = 'removed'; n++; }
      return { rows: [], rowCount: n };
    }
    if (/SELECT max\(observed_at\)/.test(sql)) {
      db.historyMaxBound = a[0];
      const ok = db.history.filter((h) => !a[0] || Date.parse(h.observed_at) <= Date.parse(a[0])).map((h) => Date.parse(h.observed_at));
      return { rows: [{ m: ok.length ? new Date(Math.max(...ok)) : null }] };
    }
    if (/SELECT to_regclass/.test(sql)) return { rows: [{ t: a[0] }] }; // partição mensal já existe
    if (/INSERT INTO price_history/.test(sql)) { const rows = JSON.parse(a[0]); db.history.push(...rows); return { rows: [], rowCount: rows.length }; }
    return { rows: [], rowCount: 0 };
  } };
  return db;
}
const sync = (db, offers, historyLines = []) => syncState(db.c, { state: state(offers), catalog, historyLines });
const seenOf = (db, id) => db.offers.get(id)?.last_seen_at ?? null;
// Espelho de DB_AT_SQL: max(last_seen_at) das ativas/pendentes, sem horário além de now + 5 min.
const dbAt = (db) => { const xs = [...db.offers.values()].filter((o) => ['active', 'pending'].includes(o.status) && o.last_seen_at && Date.parse(o.last_seen_at) <= NOW + 5 * 60e3).map((o) => o.last_seen_at).sort(); return xs.at(-1) ?? null; };
let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };

await t('1. isFutureAt: só passa de 5 min no futuro; ausente e inválido não são "futuro"', () => {
  assert.equal(isFutureAt(at(4), NOW), false); assert.equal(isFutureAt(at(5), NOW), false); assert.equal(isFutureAt(at(6), NOW), true);
  assert.equal(isFutureAt(at(-60), NOW), false); assert.equal(isFutureAt(null, NOW), false); assert.equal(isFutureAt('lixo', NOW), false);
});

await t('2. reproduz o bloqueio: com a guarda antiga, last_seen_at futuro gravado descarta a leitura real seguinte', async () => {
  const db = fakeDb({ offers: [{ legacy_id: 'x', id: 1, stock_status: 'in_stock', status: 'active', last_seen_at: at(120) }], oldGuard: true });
  const s = await sync(db, [offer('x', at(0))]);
  assert.equal(s.offersStale, 1, 'leitura válida descartada'); assert.equal(seenOf(db, 'x'), at(120));
  const oldMax = [...db.offers.values()].map((o) => o.last_seen_at).sort().at(-1); // max(last_seen_at) sem o limite de futuro
  assert.equal(classify(oldMax, NOW).status, 'indisponivel', 'o max envenenado deixava o frescor indisponível');
});

await t('3. recuperação: valor futuro já gravado é substituído pela próxima leitura válida', async () => {
  const db = fakeDb({ offers: [{ legacy_id: 'x', id: 1, stock_status: 'in_stock', status: 'active', last_seen_at: at(120) }] });
  assert.equal(dbAt(db), null, 'o frescor do banco ignora o valor futuro (não fica envenenado)');
  const s = await sync(db, [offer('x', at(-30))]);
  assert.equal(s.offersStale, 0); assert.equal(s.offersFuture, 0); assert.equal(seenOf(db, 'x'), at(-30));
  assert.match(db.offerSql, /offer\.last_seen_at > \$2::timestamptz/, 'a guarda aceita substituir carimbo impossível');
  assert.equal(dbAt(db), at(-30)); assert.equal(classify(dbAt(db), NOW).status, 'atual');
  // a leitura seguinte continua normal, e a guarda de corrida (mais antiga é descartada) continua valendo
  assert.equal((await sync(db, [offer('x', at(-15))])).offersStale, 0); assert.equal(seenOf(db, 'x'), at(-15));
  assert.equal((await sync(db, [offer('x', at(-20))])).offersStale, 1); assert.equal(seenOf(db, 'x'), at(-15));
});

await t('4. leitura no futuro (> 5 min) não é gravada; a leitura válida anterior fica e a oferta não vira removed', async () => {
  const db = fakeDb({ offers: [{ legacy_id: 'x', id: 1, stock_status: 'in_stock', status: 'active', last_seen_at: at(-15) }] });
  const s = await sync(db, [offer('x', at(120))]);
  assert.equal(s.offersFuture, 1); assert.equal(s.offers, 0); assert.equal(s.offersRemoved, 0);
  assert.equal(seenOf(db, 'x'), at(-15), 'mantém a última leitura válida, sem inventar horário');
  assert.equal(db.offers.get('x').status, 'active'); assert.ok(db.live.includes('x'), 'continua na lista de ofertas vivas');
  assert.equal(dbAt(db), at(-15)); assert.equal(classify(dbAt(db), NOW).status, 'atual');
  // oferta nova com horário futuro também não entra
  const s2 = await sync(db, [offer('x', at(0)), offer('nova', at(60))]);
  assert.equal(s2.offersFuture, 1); assert.equal(db.offers.has('nova'), false);
  assert.equal(seenOf(db, 'x'), at(0), 'leitura válida posterior é gravada normalmente');
});

await t('5. futuro dentro da tolerância (≤ 5 min) é leitura válida e é gravada', async () => {
  const db = fakeDb();
  const s = await sync(db, [offer('x', at(4))]);
  assert.equal(s.offersFuture, 0); assert.equal(seenOf(db, 'x'), at(4)); assert.equal(classify(dbAt(db), NOW).status, 'atual');
});

await t('6. horário ausente não vira "agora" (#626, ver untimed-offer-tests.js); inválido continua recusado sem gravar nada', async () => {
  const db = fakeDb();
  const s = await sync(db, [offer('x', null)]);
  assert.equal(s.offersFuture, 0); assert.equal(s.offersNoTimestamp, 1); assert.equal(seenOf(db, 'x'), null, 'oferta nova sem horário não é gravada com now()');
  const db2 = fakeDb();
  await assert.rejects(() => sync(db2, [offer('y', 'lixo')]), RangeError);
  assert.equal(db2.upserts, 0, 'nenhuma oferta gravada com horário inventado');
});

await t('7. o limite usa o relógio do banco: robô adiantado não consegue gravar o próprio horário', async () => {
  const real = Date.now; Date.now = () => NOW + 120 * 60e3;
  try {
    const db = fakeDb({ offers: [{ legacy_id: 'x', id: 1, stock_status: 'in_stock', status: 'active', last_seen_at: at(-15) }] });
    const s = await sync(db, [offer('x', at(120))]);
    assert.equal(s.offersFuture, 1); assert.equal(seenOf(db, 'x'), at(-15));
  } finally { Date.now = real; }
});

await t('8. histórico: ponto no futuro não entra nem barra o histórico real; o max ignora ponto futuro já gravado', async () => {
  const db = fakeDb({ offers: [{ legacy_id: 'x', id: 1, stock_status: 'in_stock', status: 'active', last_seen_at: at(-15) }],
    history: [{ offer_id: 1, observed_at: at(300) }] });
  const h = (min) => ({ t: at(min), offerId: 'x', productId: 'me05-etb', price: 350, total: 350, shipping: null, stock: 'IN_STOCK' });
  const s = await sync(db, [offer('x', at(0))], [h(-15), h(0), h(90)]);
  assert.equal(db.historyMaxBound, at(5)); assert.equal(s.history, 2, 'entram as leituras válidas, não a do futuro');
  assert.deepEqual(db.history.slice(1).map((r) => r.observed_at), [at(-15), at(0)]);
});

await t('9. frescor do banco: DB_AT_SQL não deixa last_seen_at futuro entrar no max', () => {
  assert.match(DB_AT_SQL, /max\(last_seen_at\)/); assert.match(DB_AT_SQL, /status IN \('active', 'pending'\)/);
  assert.match(DB_AT_SQL, /last_seen_at <= now\(\) \+ interval '5 minutes'/);
});

// Página de lojas: módulo e espelho do site (index.html) com o mesmo resultado.
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const a = html.indexOf('/* Frente 7: lojas (dados)'), b = html.indexOf('/* Frente 7: lojas (telas)');
const ctx = vm.createContext({ live: (o) => o.stock === 'IN_STOCK' && !o.stale && !o.anomalous && o.total > 0, URL, encodeURIComponent });
vm.runInContext(html.slice(a, b) + ';globalThis.__ = { lojasNormalize };', ctx);
const spaNormalize = ctx.__.lojasNormalize;
await t('10. lojas: horário futuro não aparece como última leitura (servidor e site iguais)', () => {
  const src = (id, extra = {}) => ({ id, name: id, kind: 'specialist', status: 'ACTIVE', url: `https://${id}.com.br`, platform: 'shopify', ...extra });
  const sources = [src('alfa', { lastSuccess: at(-30) }), src('beta', { lastSuccess: at(120) }), src('gama', { lastSuccess: at(-50) })];
  const offers = [offer('a1', at(-20), { storeId: 'alfa' }), offer('a2', at(120), { storeId: 'alfa' }), offer('b1', at(180), { storeId: 'beta' }),
    offer('g1', at(4), { storeId: 'gama' })];
  for (const [nome, fn] of [['servidor', normalizeLojas], ['site', spaNormalize]]) {
    const by = Object.fromEntries(JSON.parse(JSON.stringify(fn({ sources, offers, now: NOW }))).map((l) => [l.id, l.lastReadAt]));
    assert.equal(by.alfa, at(-20), `${nome}: ignora a oferta no futuro e usa a leitura válida`);
    assert.equal(by.beta, null, `${nome}: só horário futuro (oferta e lastSuccess) = sem leitura conhecida`);
    assert.equal(by.gama, at(4), `${nome}: dentro da tolerância de 5 min continua válido`);
  }
});

console.log(`✓ last_seen_at no futuro (#620): ${n} grupos de testes passaram`);
