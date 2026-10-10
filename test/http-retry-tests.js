// Cliente HTTP: fila por host e retry opcional com jitter só para GET em falha passageira (offline, sem espera real
// nos retries). Desenho da #188: 429 não é repetido dentro da requisição (interrompe a loja; a espera é por loja
// em run.js) e propaga `retryAfter`; 401/403, outros 4xx e POST também não são repetidos.
import assert from 'node:assert/strict';
process.env.HUNTER_DOMAIN_DELAY_MS = '60'; // intervalo por host pequeno e real, para medir a fila
process.env.HUNTER_RETRY_BASE_MS = '1000';
process.env.HUNTER_RETRY_MAX_MS = '30000';
const http = await import('../src/http.js');

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sleeps = [];
http.setSleep(async (ms) => { sleeps.push(ms); });
http.setRandom(() => 1); // jitter no máximo: espera = teto da tentativa
const reset = () => { sleeps.length = 0; };
const backoffs = () => sleeps.filter((s) => s >= 500); // separa as esperas do retry das do intervalo por host (<= 60 ms)
const resp = (status, headers = {}) => new Response('{"ok":true}', { status, headers: { 'content-type': 'application/json', ...headers } });
const scripted = (steps) => { let n = 0; const f = async () => { const s = steps[Math.min(n++, steps.length - 1)]; if (s instanceof Error) throw s; return s(); }; f.calls = () => n; return f; };
const abort = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
const netErr = () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });

// funções puras
assert.equal(http.backoffDelay(0, 1000, 30000, () => 1), 1000);
assert.equal(http.backoffDelay(2, 1000, 30000, () => 0), 2000); // 4000 * 0,5
assert.equal(http.backoffDelay(10, 1000, 30000, () => 1), 30000); // teto
assert.ok(http.isTransient({ status: 503, httpStatus: 503 }));
assert.ok(http.isTransient({ status: 0, code: 'TIMEOUT' }));
assert.ok(http.isTransient(netErr()));
assert.ok(!http.isTransient(new http.BlockedError('x', 429, { httpStatus: 429, retryAfter: 5 })));
assert.ok(!http.isTransient({ status: 404, httpStatus: 404 }));
assert.ok(!http.isTransient({ status: 0 }), 'resposta grande demais (status 0 sem código) não é passageira');
assert.ok(!http.isTransient(Object.assign(new Error('x'), { code: 'TOO_MANY_REDIRECTS' })));

// padrão (sem `retries`): nada é repetido, nem 5xx — preserva "5xx para na hora" dos adaptadores (#188)
let f = scripted([() => resp(503), () => resp(200)]); http.setFetch(f); reset();
await assert.rejects(http.get('https://padrao.test/x'), (e) => e.status === 503);
assert.equal(f.calls(), 1);
assert.deepEqual(backoffs(), []);

// 429: nunca repete (1 chamada), mesmo com `retries`, e propaga `retryAfter` em segundos
f = scripted([() => resp(429, { 'retry-after': '3' }), () => resp(200)]); http.setFetch(f); reset();
await assert.rejects(http.getJson('https://a.test/x', { retries: 2 }), (e) => e.blocked && e.status === 429 && e.httpStatus === 429 && e.retryAfter === 3);
assert.equal(f.calls(), 1);
assert.deepEqual(backoffs(), [], 'não espera o Retry-After dentro da requisição');
f = scripted([() => resp(429)]); http.setFetch(f); reset();
await assert.rejects(http.get('https://a2.test/x', { retries: 2 }), (e) => e.blocked && e.status === 429 && e.retryAfter === null);
assert.equal(f.calls(), 1);

// 401/403 e outros 4xx nunca são repetidos
for (const [status, blocked] of [[401, true], [403, true], [404, false], [400, false]]) {
  f = scripted([() => resp(status), () => resp(200)]); http.setFetch(f); reset();
  await assert.rejects(http.get(`https://c${status}.test/x`, { retries: 2 }), (e) => e.status === status && !!e.blocked === blocked);
  assert.equal(f.calls(), 1, `${status}: uma chamada`);
}

// timeout em GET: repete com backoff e se recupera
f = scripted([abort(), () => resp(200)]); http.setFetch(f); reset();
let r = await http.getJson('https://d.test/x', { retries: 2 });
assert.deepEqual(r, { ok: true });
assert.equal(f.calls(), 2);
assert.deepEqual(backoffs(), [1000]);

// timeout persistente: para no limite e mantém o erro de timeout
f = scripted([abort()]); http.setFetch(f); reset();
await assert.rejects(http.get('https://d2.test/x', { retries: 2 }), (e) => e.code === 'TIMEOUT' && e.status === 0);
assert.equal(f.calls(), 3);

// erro de rede em GET: repete
f = scripted([netErr(), () => resp(200)]); http.setFetch(f); reset();
r = await http.getJson('https://rede.test/x', { retries: 1 });
assert.deepEqual(r, { ok: true });
assert.equal(f.calls(), 2);

// 503 persistente em GET: limitado a 1 + retries tentativas, com espera crescente
f = scripted([() => resp(503)]); http.setFetch(f); reset();
await assert.rejects(http.get('https://e.test/x', { retries: 2 }), (e) => e.status === 503 && e.httpStatus === 503);
assert.equal(f.calls(), 3);
assert.deepEqual(backoffs(), [1000, 2000]);

// teto de 2 retries mesmo se pedirem mais
f = scripted([() => resp(503)]); http.setFetch(f); reset();
await assert.rejects(http.get('https://e2.test/x', { retries: 10 }), (e) => e.status === 503);
assert.equal(f.calls(), 3);

// POST não é repetido
f = scripted([() => resp(503)]); http.setFetch(f); reset();
await assert.rejects(http.request('https://e.test/y', { method: 'POST', body: '{}', retries: 2 }), (e) => e.status === 503);
assert.equal(f.calls(), 1);

// fila por host: requisições simultâneas ao mesmo host saem uma por vez, com o intervalo entre elas;
// hosts diferentes não esperam um pelo outro
http.setSleep(realSleep);
const starts = [];
http.setFetch(async (url) => { starts.push([new URL(url).host, Date.now()]); return resp(200); });
await Promise.all([1, 2, 3].map((i) => http.get(`https://fila.test/${i}`)));
const t = starts.filter(([h]) => h === 'fila.test').map(([, at]) => at);
assert.equal(t.length, 3);
assert.ok(t[1] - t[0] >= 50 && t[2] - t[1] >= 50, `intervalo respeitado em fila: ${t[1] - t[0]} ms, ${t[2] - t[1]} ms`);
starts.length = 0;
await Promise.all([http.get('https://h1.test/x'), http.get('https://h2.test/x')]);
assert.ok(Math.abs(starts[0][1] - starts[1][1]) < 50, 'hosts diferentes em paralelo');

// falha de uma loja não paraliza outra: em paralelo, a loja saudável responde mesmo com a outra em 429
http.setFetch(async (url) => (new URL(url).host === 'ruim.test' ? resp(429) : resp(200)));
const [bad, good] = await Promise.allSettled([http.get('https://ruim.test/x'), http.get('https://boa.test/x')]);
assert.equal(bad.status, 'rejected');
assert.equal(good.status, 'fulfilled');

http.setFetch(globalThis.fetch);
console.log('http-retry-tests: ok');
