// Cache da API v1: limite de 300 entradas e remoção FIFO (docs/auditorias/desempenho.md §4).
// Acerto no cache não renova a posição; só regravar a chave (MISS) a move para o fim.
import assert from 'node:assert/strict';
import { setLegacyLoader } from '../api/_lib/legacy.mjs';

const now = Date.now();
setLegacyLoader(async () => ({
  generatedAt: new Date(now).toISOString(), coverage: { stores: 1 }, totals: { offers: 0 },
  collections: [], types: [], products: [], offers: [], activity: [], tips: [], sources: [],
}));
delete process.env.API_DATABASE_URL;
const { default: api, _cache } = await import('../api/v1.mjs');
const call = async (url) => { const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } }; await api({ url, method: 'GET' }, res); return res; };
const url = (i) => `/api/v1/produtos?busca=k${i}`;
const keyOf = (i) => [..._cache.keys()].find((k) => k.endsWith(`busca=k${i}`));

_cache.clear();
await call(url(0));
const primeira = keyOf(0);
assert.ok(primeira, 'primeira chave gravada');
for (let i = 1; i < 300; i++) await call(url(i));
assert.equal(_cache.size, 300, 'cache enche até o limite de 300');
assert.equal((await call(url(0))).headers['X-Cache'], 'HIT', 'acerto não renova a posição');
assert.equal(_cache.keys().next().value, primeira, 'a chave mais antiga continua a primeira após o acerto');

await call(url(300));
assert.equal(_cache.size, 300, 'a 301ª chave distinta não passa do limite');
assert.ok(!_cache.has(primeira), 'a chave mais antiga saiu (FIFO)');
assert.ok(keyOf(1) && keyOf(300), 'as demais e a nova permanecem');
assert.equal((await call(url(0))).headers['X-Cache'], 'MISS', 'chave removida volta a ser MISS');
assert.equal(_cache.size, 300);
assert.ok(!keyOf(1), 'a próxima mais antiga saiu ao regravar a removida');

console.log('OK — cache da API v1: limite de 300 e remoção FIFO');
