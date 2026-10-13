// Prazo nos fetches do SSR (docs/auditorias/paginas-servidor.md §4, proposta 6; parte de api/_lib/lojas.mjs): o fetch de
// sources.json leva AbortSignal.timeout. Rede que nunca responde cai no caminho sem lojas (o mesmo de um sources.json
// com erro) dentro do prazo, em vez de segurar a função até o 504. Caminho feliz inalterado. Sem rede: fetch simulado.
import assert from 'node:assert/strict';
import { setFreshnessClock } from '../api/_lib/freshness.mjs';
import { loadSources, lojasFromState, RAW_SOURCES, SOURCES_TIMEOUT_MS } from '../api/_lib/lojas.mjs';
import { RAW } from '../api/_seo.mjs';

let n = 0;
async function t(name, fn) { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } }
const NOW = Date.parse('2026-10-12T18:00:00.000Z');
setFreshnessClock(() => NOW);
const T = new Date(NOW - 5 * 6e4).toISOString();
const SOURCES = [{ id: 'alfa', name: 'Alfa Cards', kind: 'specialist', status: 'ACTIVE', url: 'https://www.alfa.com.br', platform: 'shopify', lastSuccess: T }];
// state.json sem `sources`: a página de lojas precisa buscar sources.json.
const STATE = { generatedAt: T, products: [], offers: [], collections: [], types: [], activity: [], tips: [], bestDeals: [] };

// fetch que só termina quando o signal aborta (conexão aberta sem resposta); sem signal, falha o teste em vez de travar.
const hanging = (opt) => new Promise((_, rej) => {
  const keep = setTimeout(() => rej(new Error('prazo não aplicado')), SOURCES_TIMEOUT_MS + 5000);
  opt?.signal?.addEventListener('abort', () => { clearTimeout(keep); rej(opt.signal.reason); });
});
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
let calls = [];
let sourcesMode = 'hang';
globalThis.fetch = async (url, opt) => {
  calls.push({ url: String(url), opt });
  if (String(url) === RAW) return json(STATE);
  if (String(url) === RAW_SOURCES) return sourcesMode === 'hang' ? hanging(opt) : sourcesMode === '503' ? json({}, 503) : json(SOURCES);
  throw new Error('rede inesperada: ' + url);
};
const res = () => ({ headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } });

await t('1. sources.json que nunca responde: loadSources rejeita com TimeoutError dentro do prazo e não grava cache', async () => {
  assert.equal(SOURCES_TIMEOUT_MS, 4000);
  calls = []; sourcesMode = 'hang';
  const t0 = Date.now();
  await assert.rejects(loadSources(null, { timeoutMs: 80 }), (e) => e.name === 'TimeoutError');
  assert.ok(Date.now() - t0 < 1500, 'respeita o prazo');
  assert.equal(calls.length, 1); assert.ok(calls[0].opt.signal instanceof AbortSignal);
  await assert.rejects(loadSources(null, { timeoutMs: 80 }), (e) => e.name === 'TimeoutError');
  assert.equal(calls.length, 2, 'falha não fica em cache: a próxima chamada tenta de novo');
});

await t('2. /lojas com sources.json travado responde dentro do prazo padrão, igual à resposta com sources.json em erro', async () => {
  const { default: h } = await import('../api/pagina.mjs');
  sourcesMode = '503'; const ref = res(); await h({ url: '/api/pagina?t=lojas', headers: { host: 'x' } }, ref);
  sourcesMode = 'hang'; const r = res();
  const t0 = Date.now();
  await h({ url: '/api/pagina?t=lojas', headers: { host: 'x' } }, r);
  const dt = Date.now() - t0;
  assert.ok(dt >= SOURCES_TIMEOUT_MS - 100 && dt < SOURCES_TIMEOUT_MS + 2000, `responde no prazo (${dt} ms)`);
  assert.equal(r.statusCode, ref.statusCode); assert.equal(r.statusCode, 200);
  assert.equal(r.body, ref.body); assert.deepEqual(r.headers, ref.headers);
});

await t('3. caminho feliz inalterado: mesmos dados, signal ainda não abortado, cache de 10 min e sources do state.json sem rede', async () => {
  calls = []; sourcesMode = 'ok';
  assert.deepEqual(await loadSources(), SOURCES);
  assert.equal(calls.length, 1); assert.equal(calls[0].url, RAW_SOURCES);
  assert.ok(calls[0].opt.signal instanceof AbortSignal); assert.equal(calls[0].opt.signal.aborted, false);
  assert.deepEqual(await loadSources(), SOURCES); assert.equal(calls.length, 1, 'segunda chamada vem do cache');
  const own = [{ ...SOURCES[0], id: 'beta' }];
  assert.equal(await loadSources({ sources: own }), own); assert.equal(calls.length, 1);
  const lojas = await lojasFromState(STATE);
  assert.ok(lojas.some((l) => l.id === 'alfa' && l.status === 'monitorada'));
});

console.log(`ssr-timeout-tests ok (${n})`);
