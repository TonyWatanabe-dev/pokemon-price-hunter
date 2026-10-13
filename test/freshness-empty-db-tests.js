// Banco sem ofertas ativas/pendentes: max(last_seen_at) volta [{at:null}], dbDataAt é null e o banco fica
// "indisponivel" (sem horário). A API não serve o banco como atual: cai para o state.json com fallback marcado.
// Sem banco real: o Pool é criado sem conectar e o query é trocado por um simulado.
import assert from 'node:assert/strict';
import { dbDataAt, setFreshnessClock, clearFreshnessCache } from '../api/_lib/freshness.mjs';
import { apiPool, closeApiPool } from '../api/_lib/db.mjs';
import { setLegacyLoader } from '../api/_lib/legacy.mjs';
import { clearCatalogCache } from '../api/_lib/catalog.mjs';

let n = 0;
async function t(name, fn) { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } }
const NOW = Date.parse('2026-10-09T18:00:00.000Z');
const ago = (min) => new Date(NOW - min * 6e4).toISOString();
setFreshnessClock(() => NOW);

// estado mínimo do robô (mesmo formato do state.json)
const fx = (generatedAt) => ({
  generatedAt, coverage: { found: 1 }, totals: { offers: 1 }, collections: [{ id: 'me05', name: 'Escuridão Absoluta', series: 'Megaevolução', aliases: [], products: 1 }],
  types: [{ id: 'etb', label: 'Treinador Avançado (ETB)', group: 'ETB', products: 1 }],
  products: [{ id: 'me05-etb', collection: 'me05', collectionName: 'Escuridão Absoluta', type: 'etb', typeLabel: 'Treinador Avançado (ETB)', group: 'ETB', boosters: 9,
    copagConfirmed: true, msrp: 400, copag: { source_url: 'https://www.copagloja.com.br/etb/p', confidence: 'OFICIAL', source_timestamp: ago(600) }, offerCount: 1 }],
  offers: [{ id: 'oa', productId: 'me05-etb', storeId: 'a', storeName: 'a', title: 'ETB', url: 'https://a.com.br/etb', price: 300, total: 300, shipping: null, shippingKnown: false,
    stock: 'IN_STOCK', matchConfidence: 0.95, confirmed: true, source_timestamp: generatedAt, firstSeen: ago(5000) }],
  sources: [{ id: 'a', name: 'a', url: 'https://a.com.br', status: 'ACTIVE' }], activity: [], tips: [], bestDeals: [],
});

const env0 = process.env.API_DATABASE_URL;
process.env.API_DATABASE_URL = 'postgres://x:y@127.0.0.1:1/nada';
await closeApiPool();
const pool = await apiPool();
// só a consulta do frescor responde (banco vazio); qualquer outra consulta de dados é registrada e falha
let freshCalls = 0; const otherSql = [];
pool.query = async (sql) => {
  if (/max\(last_seen_at\)/.test(sql)) { freshCalls++; return { rows: [{ at: null }] }; }
  otherSql.push(sql); throw Object.assign(new Error('consulta inesperada no teste'), { code: 'TESTE' });
};

const { default: api, _cache } = await import('../api/v1.mjs');
const reset = () => { _cache.clear(); clearCatalogCache(); clearFreshnessCache(); freshCalls = 0; otherSql.length = 0; };
const call = async (url) => { const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  await api({ url, method: 'GET' }, res, { now: NOW }); return { status: res.statusCode, h: res.headers, json: JSON.parse(res.body) }; };
const fr = (r) => r.json.meta?.freshness ?? r.json.freshness;

try {
  await t('1. q devolvendo [{at:null}] → dbDataAt é null (e o null também fica no cache)', async () => {
    reset();
    assert.equal(await dbDataAt(), null);
    assert.equal(await dbDataAt(), null);
    assert.equal(freshCalls, 1, 'null é valor de cache, não "sem cache"');
  });

  await t('2. /home: banco sem horário → servido pelo state.json com fallback banco-desatualizado', async () => {
    setLegacyLoader(async () => fx(ago(10))); reset();
    const r = await call('/api/v1/home');
    assert.equal(r.status, 200);
    assert.equal(r.h['X-Data-Source'], 'state');
    assert.equal(r.h['X-Fallback'], 'banco-desatualizado');
    assert.equal(r.h['X-Fallback-Reason'], 'banco-sem-horario');
    assert.equal(r.h['Cache-Control'], 'no-store', 'fallback nunca fica no cache da CDN');
    assert.equal(fr(r).status, 'atual'); assert.equal(fr(r).source, 'state'); assert.equal(fr(r).dataAt, ago(10)); assert.equal(fr(r).ageMin, 10);
    assert.deepEqual(fr(r).fallback, { from: 'db', reason: 'banco-desatualizado' }, 'sem dbDataAt/dbAgeMin: o banco não tem horário');
    assert.equal(r.json.generatedAt, ago(10), 'o horário mostrado é o do state.json servido');
    assert.equal(r.h['X-Data-Freshness'], 'atual'); assert.equal(r.h['X-Data-At'], ago(10));
    assert.deepEqual(otherSql, [], 'nenhuma consulta de dados ao banco vazio');
  });

  await t('3. produto: mesmo fallback, com a oferta do state.json', async () => {
    setLegacyLoader(async () => fx(ago(60))); reset();
    const r = await call('/api/v1/produtos/me05-etb');
    assert.equal(r.status, 200);
    assert.equal(r.h['X-Data-Source'], 'state'); assert.equal(r.h['X-Fallback'], 'banco-desatualizado'); assert.equal(r.h['X-Fallback-Reason'], 'banco-sem-horario');
    assert.equal(fr(r).status, 'atrasado'); assert.equal(fr(r).source, 'state');
    assert.equal(fr(r).fallback.reason, 'banco-desatualizado');
    assert.deepEqual(otherSql, []);
  });
} finally {
  setLegacyLoader(null);
  await closeApiPool();
  if (env0 === undefined) delete process.env.API_DATABASE_URL; else process.env.API_DATABASE_URL = env0;
}
console.log(`freshness-empty-db-tests: ${n} ok`);
