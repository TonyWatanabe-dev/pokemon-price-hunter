// Issue #621 — lacuna 4 de docs/frescor.md: generatedAt do state.json avança em toda rodada, mesmo quando todos os
// coletores falham. O frescor do state.json (fallback da API, páginas e barra da UI) usa dataAt, a última leitura real
// (maior source_timestamp das ofertas, que reaproveitar não renova). Falha total, parcial e recuperação; state.json antigo sem dataAt segue no generatedAt.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path'; import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { classify, stateDataAt, setFreshnessClock, clearFreshnessCache } from '../api/_lib/freshness.mjs';
import { setLegacyLoader } from '../api/_lib/legacy.mjs';
import { clearCatalogCache } from '../api/_lib/catalog.mjs';
import { lastReadAt } from '../src/run.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0;
async function t(name, fn) { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } }
const NOW = Date.parse('2026-10-13T12:00:00.000Z');
const ago = (min) => new Date(NOW - min * 6e4).toISOString();
setFreshnessClock(() => NOW);

const offer = (id, ts, stale = false) => ({ id, productId: 'me05-etb', storeId: id, storeName: id, title: 'ETB', url: `https://${id}.com.br/etb`,
  price: 300, total: 300, shipping: null, shippingKnown: false, stock: stale ? 'UNKNOWN' : 'IN_STOCK', matchConfidence: 0.95, confirmed: true,
  stale, ...(ts !== undefined ? { source_timestamp: ts } : {}), ...(stale ? { lastValid: { at: ts } } : {}), firstSeen: ago(5000) });
// state.json mínimo como o robô grava: generatedAt = rodada; dataAt = lastReadAt das ofertas publicadas.
const fx = (offers, { generatedAt = ago(0), legacy = false } = {}) => ({
  generatedAt, ...(legacy ? {} : { dataAt: lastReadAt(offers, generatedAt) }), coverage: { found: offers.length }, totals: { offers: offers.length },
  collections: [{ id: 'me05', name: 'Escuridão Absoluta', series: 'Megaevolução', aliases: [], products: 1 }],
  types: [{ id: 'etb', label: 'Treinador Avançado (ETB)', group: 'ETB', products: 1 }],
  products: [{ id: 'me05-etb', collection: 'me05', collectionName: 'Escuridão Absoluta', type: 'etb', typeLabel: 'Treinador Avançado (ETB)', group: 'ETB', boosters: 9,
    copagConfirmed: true, msrp: 400, offerCount: offers.length }],
  offers, sources: offers.map((o) => ({ id: o.storeId, name: o.storeId, url: o.url, status: o.stale ? 'ERROR' : 'ACTIVE' })), activity: [], tips: [], bestDeals: [],
});
const total = () => [offer('a', ago(120), true), offer('b', ago(150), true)];
const partial = () => [offer('a', ago(0)), offer('b', ago(150), true)];
const recovered = () => [offer('a', ago(0)), offer('b', ago(0))];

await t('1. lastReadAt: só leitura real conta; falha total fica na última leitura; parcial e recuperação usam a rodada', () => {
  assert.equal(lastReadAt(total(), ago(0)), ago(120), 'falha total: a leitura mais recente é a antiga, não a rodada');
  assert.equal(lastReadAt([offer('a', undefined, true), offer('b', 'lixo', true)], ago(0)), null, 'sem horário de leitura: nenhuma evidência');
  assert.equal(lastReadAt([], ago(0)), null);
  assert.equal(lastReadAt(partial(), ago(0)), ago(0), 'falha parcial: a loja lida na rodada prova a leitura');
  assert.equal(lastReadAt(recovered(), ago(0)), ago(0));
  assert.equal(lastReadAt([offer('a', ago(200)), offer('b', ago(20))], ago(0)), ago(20), 'rodada pulada mantém o horário antigo da leitura');
  assert.equal(lastReadAt([offer('a', ago(-60)), offer('b', ago(45))], ago(0)), ago(45), 'horário depois da rodada (relógio adiantado) não vale');
  assert.equal(lastReadAt([offer('a', 'lixo'), offer('b', undefined), offer('c', ago(10))], ago(0)), ago(10), 'ausente e inválido não valem');
  assert.equal(lastReadAt(recovered(), 'lixo'), null, 'sem horário de rodada válido: nada');
});

await t('2. stateDataAt: dataAt prevalece (nulo = sem horário); state.json antigo sem o campo usa generatedAt', () => {
  assert.equal(stateDataAt(fx(total())), ago(120));
  assert.equal(stateDataAt({ generatedAt: ago(0), dataAt: null }), null);
  assert.equal(classify(stateDataAt({ generatedAt: ago(0), dataAt: null }), NOW).status, 'indisponivel');
  assert.equal(stateDataAt(fx(total(), { legacy: true })), ago(0), 'legado: comportamento anterior');
  for (const v of [null, undefined, 'x', 3]) assert.equal(stateDataAt(v), null);
});

// API só com o state.json (fallback; a mesma função decide o fallback do banco desatualizado em api/v1.mjs).
delete process.env.API_DATABASE_URL;
const { default: api, _cache } = await import('../api/v1.mjs');
const reset = () => { _cache.clear(); clearCatalogCache(); clearFreshnessCache(); };
const call = async (url) => { const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  await api({ url, method: 'GET' }, res); return { status: res.statusCode, h: res.headers, json: JSON.parse(res.body) }; };
const fr = (r) => r.json.meta?.freshness ?? r.json.freshness;

await t('3. API: falha total não é servida como atual (idade real); parcial e recuperação são; sem horário de leitura = 503', async () => {
  setLegacyLoader(async () => fx(total())); reset();
  let r = await call('/api/v1/home');
  assert.equal(r.status, 200); assert.equal(fr(r).status, 'desatualizado'); assert.equal(fr(r).ageMin, 120); assert.equal(fr(r).dataAt, ago(120));
  assert.equal(r.json.generatedAt, ago(120), 'Home mostra o horário da última leitura, não o da rodada');
  assert.equal(r.h['X-Data-Freshness'], 'desatualizado'); assert.equal(r.h['Cache-Control'], 'no-store');
  r = await call('/api/v1/produtos/me05-etb/ofertas');
  assert.equal(fr(r).status, 'desatualizado');
  const items = r.json.data ?? r.json.items; assert.equal(items.length, 2);
  for (const o of items) assert.equal(o.status, 'pending', 'cada oferta continua marcada');
  assert.deepEqual(items.map((o) => o.last_seen_at).sort(), [ago(150), ago(120)], 'cada oferta com a sua idade real');

  setLegacyLoader(async () => fx(total().map((o) => ({ ...o, source_timestamp: ago(1500) })))); reset();
  r = await call('/api/v1/home');
  assert.equal(r.status, 503, 'última leitura há mais de 24 h: não vai como dado, mesmo com a rodada de agora');
  setLegacyLoader(async () => fx([offer('a', undefined, true)])); reset();
  r = await call('/api/v1/home');
  assert.equal(r.status, 503, 'sem horário de leitura: não vai como dado');

  for (const [name, offers] of [['parcial', partial()], ['recuperação', recovered()]]) {
    setLegacyLoader(async () => fx(offers)); reset();
    r = await call('/api/v1/home');
    assert.equal(r.status, 200, name); assert.equal(fr(r).status, 'atual', name); assert.equal(fr(r).dataAt, ago(0), name);
    assert.match(r.h['Cache-Control'], /s-maxage/, `${name}: cache normal`);
  }

  setLegacyLoader(async () => fx(total(), { legacy: true })); reset();
  r = await call('/api/v1/home');
  assert.equal(fr(r).status, 'atual', 'state.json antigo sem dataAt: mesmo comportamento de antes');
  setLegacyLoader(null); reset();
});

// UI: freshState real de index.html num sandbox.
const page = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const cut = (a, b) => { const i = page.indexOf(a); const j = page.indexOf(b, i); assert.ok(i > 0 && j > i, `trecho ${a}`); return page.slice(i, j); };
const ui = { Date, Number, Math };
vm.createContext(ui);
vm.runInContext(cut('const FRESH_LIM=', 'const freshAt=') + '\n;globalThis.__f=freshState;', ui);
const freshState = ui.__f;

await t('4. UI: a barra usa a última leitura real do state.json; o frescor da API continua prevalecendo', () => {
  assert.deepEqual({ ...freshState(fx(total()), NOW) }, { status: 'desatualizado', ageMin: 120, dataAt: ago(120) }, 'falha total');
  assert.equal(freshState(fx([offer('a', ago(15), true)]), NOW).status, 'atual', 'falha logo após a leitura: idade real de 15 min');
  assert.equal(freshState(fx([offer('a', undefined, true)]), NOW).status, 'indisponivel', 'sem horário de leitura');
  assert.equal(freshState(fx(partial()), NOW).status, 'atual', 'parcial');
  assert.equal(freshState(fx(recovered()), NOW).status, 'atual', 'recuperação');
  assert.equal(freshState(fx(total(), { legacy: true }), NOW).status, 'atual', 'legado sem dataAt');
  assert.equal(freshState({ ...fx(total()), freshness: { dataAt: ago(10) } }, NOW).status, 'atual', 'resposta da API: freshness.dataAt');
});

console.log(`state-data-at-tests: ${n} testes ok`);
