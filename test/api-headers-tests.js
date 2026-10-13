// Cabeçalhos das funções (res sintético, sem rede): sitemap, v1 (405) e ml-callback.
import assert from 'node:assert/strict';
import { setLegacyLoader } from '../api/_lib/legacy.mjs';

setLegacyLoader(async () => ({ generatedAt: new Date().toISOString(), coverage: { stores: 1 }, totals: { offers: 0 }, collections: [], types: [], products: [], offers: [], activity: [], tips: [], sources: [] }));
delete process.env.API_DATABASE_URL;
globalThis.fetch = async () => { throw new Error('sem rede nos testes'); };

const mkRes = () => ({ headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = b; } });

const { default: sitemap } = await import('../api/sitemap.mjs');
let res = mkRes();
await sitemap({ url: '/api/sitemap', method: 'GET' }, res);
assert.equal(res.headers['content-type'], 'application/xml; charset=utf-8');
assert.match(res.headers['cache-control'], /s-maxage=3600/);

const { default: v1 } = await import('../api/v1.mjs');
res = mkRes();
await v1({ url: '/api/v1/produtos', method: 'POST' }, res);
assert.equal(res.statusCode, 405);
assert.equal(res.headers.allow, 'GET, HEAD');
assert.equal(res.headers['cache-control'], 'no-store');
assert.match(res.headers['content-type'], /^application\/json/);

const { default: ml } = await import('../api/ml-callback.mjs');
res = mkRes();
ml({ url: '/ml/callback?code=TG-abcdef123' }, res);
assert.equal(res.headers['cache-control'], 'no-store');
assert.match(res.headers['content-type'], /^text\/html/);
assert.equal(res.headers['x-robots-tag'], 'noindex');

console.log('OK — cabeçalhos das funções');
