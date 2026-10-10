// Cliente HTTP: retry limitado com jitter, Retry-After, timeout e isolamento por loja (offline, sem espera real).
import assert from 'node:assert/strict';
process.env.HUNTER_DOMAIN_DELAY_MS = '0';
process.env.HUNTER_RETRY_BASE_MS = '1000';
process.env.HUNTER_RETRY_MAX_MS = '30000';
process.env.HUNTER_HTTP_RETRIES = '2';
const http = await import('../src/http.js');

const sleeps = [];
http.setSleep(async (ms) => { sleeps.push(ms); });
http.setRandom(() => 1); // jitter no máximo: espera = teto da tentativa
const reset = () => { sleeps.length = 0; };
const resp = (status, headers = {}) => new Response('{"ok":true}', { status, headers: { 'content-type': 'application/json', ...headers } });
const scripted = (steps) => { let n = 0; const f = async () => { const s = steps[Math.min(n++, steps.length - 1)]; if (s instanceof Error) throw s; return s(); }; f.calls = () => n; return f; };
const abort = () => Object.assign(new Error('aborted'), { name: 'AbortError' });

// funções puras
assert.equal(http.parseRetryAfter('5'), 5000);
assert.equal(http.parseRetryAfter(null), null);
assert.equal(http.parseRetryAfter('lixo'), null);
assert.equal(http.parseRetryAfter(new Date(10_000).toUTCString(), 4000), 6000);
assert.equal(http.backoffDelay(0, 1000, 30000, () => 1), 1000);
assert.equal(http.backoffDelay(2, 1000, 30000, () => 0), 2000); // 4000 * 0,5
assert.equal(http.backoffDelay(10, 1000, 30000, () => 1), 30000); // teto

// 429 com Retry-After curto: espera o que o servidor pediu e tem sucesso no retry
let f = scripted([() => resp(429, { 'retry-after': '3' }), () => resp(200)]);
http.setFetch(f); reset();
let r = await http.getJson('https://a.test/x');
assert.deepEqual(r, { ok: true });
assert.equal(f.calls(), 2);
assert.ok(sleeps.includes(3000), 'respeitou o Retry-After');

// 429 sem Retry-After: não insiste (bloqueio é só reportado)
f = scripted([() => resp(429)]); http.setFetch(f); reset();
await assert.rejects(http.get('https://a.test/x'), (e) => e.blocked && e.status === 429);
assert.equal(f.calls(), 1);

// 429 com Retry-After acima do teto: não insiste
f = scripted([() => resp(429, { 'retry-after': '3600' })]); http.setFetch(f); reset();
await assert.rejects(http.get('https://b.test/x'), (e) => e.blocked && e.status === 429);
assert.equal(f.calls(), 1);

// 403 nunca é repetido
f = scripted([() => resp(403)]); http.setFetch(f); reset();
await assert.rejects(http.get('https://c.test/x'), (e) => e.blocked && e.status === 403);
assert.equal(f.calls(), 1);

// timeout: repete com backoff e se recupera
f = scripted([abort(), () => resp(200)]); http.setFetch(f); reset();
r = await http.getJson('https://d.test/x');
assert.deepEqual(r, { ok: true });
assert.equal(f.calls(), 2);
assert.deepEqual(sleeps.filter((s) => s > 0), [1000]);

// 5xx persistente: limitado a 1 + HUNTER_HTTP_RETRIES tentativas, com espera crescente
f = scripted([() => resp(503)]); http.setFetch(f); reset();
await assert.rejects(http.get('https://e.test/x'), (e) => e.status === 503);
assert.equal(f.calls(), 3);
assert.deepEqual(sleeps.filter((s) => s > 0), [1000, 2000]);

// POST não é repetido
f = scripted([() => resp(503)]); http.setFetch(f); reset();
await assert.rejects(http.request('https://e.test/y', { method: 'POST', body: '{}' }), (e) => e.status === 503);
assert.equal(f.calls(), 1);

// falha de uma loja não paraliza outra: em paralelo, a loja saudável responde mesmo com a outra em 429
http.setFetch(async (url) => (new URL(url).host === 'ruim.test' ? resp(429) : resp(200))); reset();
const [bad, good] = await Promise.allSettled([http.get('https://ruim.test/x'), http.get('https://boa.test/x')]);
assert.equal(bad.status, 'rejected');
assert.equal(good.status, 'fulfilled');

console.log('http-retry-tests: ok');
