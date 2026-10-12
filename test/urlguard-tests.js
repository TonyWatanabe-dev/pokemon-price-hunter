// SSRF: guarda de URLs externas e redirecionamentos, com fetch sintético (sem rede real).
import assert from 'node:assert/strict';
import { assertSafeUrl, isPrivateHost } from '../src/urlguard.js';
import * as http from '../src/http.js';

for (const u of ['http://127.0.0.1/', 'http://localhost:8080/x', 'http://10.0.0.5/', 'http://172.16.3.1/', 'http://192.168.1.1/', 'http://169.254.169.254/latest/meta-data', 'http://0.0.0.0/', 'http://[::1]/', 'http://[fd00::1]/', 'http://[fe80::1]/', 'http://[::ffff:127.0.0.1]/', 'http://srv.internal/', 'file:///etc/passwd', 'ftp://example.com/', 'https://user:pw@example.com/', 'not a url'])
  assert.throws(() => assertSafeUrl(u), (e) => e.unsafe === true, `deveria bloquear ${u}`);
for (const u of ['https://www.ligapokemon.com.br/x', 'http://example.com/', 'https://172.32.0.1/', 'https://8.8.8.8/'])
  assert.doesNotThrow(() => assertSafeUrl(u), `deveria permitir ${u}`);
assert.equal(isPrivateHost('LOCALHOST.'), true);
// IPv4 escondido em IPv6: NAT64 (64:ff9b::/96) e forma "compatível" (::a9fe:a9fe = 169.254.169.254)
for (const u of ['http://[64:ff9b::a9fe:a9fe]/', 'http://[::a9fe:a9fe]/', 'http://[::7f00:1]/'])
  assert.throws(() => assertSafeUrl(u), (e) => e.unsafe === true, `deveria bloquear ${u}`);
assert.doesNotThrow(() => assertSafeUrl('https://[2001:4860:4860::8888]/'), 'IPv6 público continua permitido');

// Formas alternativas de IP (decimal, hex, octal, curto), IPv4-mapeado em hex, credenciais e esquemas não-http
for (const u of ['http://2130706433/', 'http://0x7f000001/', 'http://017700000001/', 'http://0x7f.1/', 'http://127.1/', 'http://[::ffff:7f00:1]/', 'http://[::ffff:a9fe:a9fe]/', 'http://user@example.com/', 'http://:pw@example.com/', 'data:text/plain,hi', 'data://x/'])
  assert.throws(() => assertSafeUrl(u), (e) => e.unsafe === true, `deveria bloquear ${u}`);
// Limite documentado: a guarda é sintática e não resolve DNS; hostname público que resolve para IP privado (DNS rebinding) passa.
for (const u of ['http://localtest.me/', 'http://127.0.0.1.nip.io/'])
  assert.doesNotThrow(() => assertSafeUrl(u), `limite conhecido: hostname público não é resolvido (${u})`);

// api/pagina.mjs: só busca app.html no host do SITE ou do próprio deploy (nunca em outro *.vercel.app)
{
  const { pickFetchHost } = await import('../api/pagina.mjs');
  const env = { VERCEL_URL: 'meu-app-abc123.vercel.app', VERCEL_BRANCH_URL: 'meu-app-git-main.vercel.app' };
  const own = pickFetchHost({}, {});
  assert.ok(/^[a-z0-9.-]+$/.test(own), `sem Host, usa o host do SITE (${own})`);
  assert.notEqual(own, 'atacante.vercel.app');
  assert.equal(pickFetchHost({ host: own }, {}), own, 'o próprio host do SITE é aceito');
  assert.equal(pickFetchHost({ host: 'meu-app-abc123.vercel.app' }, env), 'meu-app-abc123.vercel.app', 'deploy próprio (VERCEL_URL)');
  assert.equal(pickFetchHost({ 'x-forwarded-host': 'MEU-APP-GIT-MAIN.vercel.app' }, env), 'meu-app-git-main.vercel.app', 'branch própria, sem diferenciar maiúsculas');
  for (const forged of ['atacante.vercel.app', 'evil.example', '169.254.169.254', 'meu-app-abc123.vercel.app.evil.example', ''])
    assert.equal(pickFetchHost({ host: forged }, env), own, `Host forjado "${forged}" cai no host do SITE`);
  assert.equal(pickFetchHost({ 'x-forwarded-host': 'atacante.vercel.app, meu-app-abc123.vercel.app' }, env), own, 'só o primeiro valor vale');
}

const calls = [];
const resp = (status, headers = {}, body = 'ok') => ({ status, ok: status < 400, url: '', headers: new Map(Object.entries(headers)), text: async () => body });
process.env.HUNTER_DOMAIN_DELAY_MS = '0';

http.setFetch(async (u) => { calls.push(u); return u.includes('a.example') ? resp(302, { location: 'http://169.254.169.254/x' }) : resp(200); });
await assert.rejects(http.get('https://a.example/p'), (e) => e.unsafe === true);
assert.deepEqual(calls, ['https://a.example/p'], 'o destino proibido não pode ser buscado');

calls.length = 0;
await assert.rejects(http.get('http://127.0.0.1/'), (e) => e.unsafe === true);
assert.equal(calls.length, 0, 'URL proibida não chega ao fetch');

calls.length = 0;
http.setFetch(async (u) => { calls.push(u); return u.endsWith('/b') ? resp(200, {}, 'fim') : resp(301, { location: '/b' }); });
const r = await http.get('https://b.example/a');
assert.equal(r.text, 'fim'); assert.equal(r.url, 'https://b.example/b');

http.setFetch(async () => resp(302, { location: '/loop' }));
await assert.rejects(http.get('https://c.example/loop'), /Redirecionamentos demais/);

// Credenciais (authorization/cookie) não seguem redirect para outra origem; na mesma origem, seguem.
{
  const seen = [];
  const cred = { Authorization: 'Bearer segredo', cookie: 'sid=1', 'x-outro': 'fica' };
  http.setFetch(async (u, init) => {
    seen.push({ u, h: init.headers });
    if (u === 'https://a.example/p') return resp(302, { location: '/q' });
    if (u === 'https://a.example/q') return resp(302, { location: 'https://b.example/r' });
    if (u === 'https://b.example/r') return resp(302, { location: 'https://a.example/s' });
    return resp(200, {}, 'fim');
  });
  const r2 = await http.get('https://a.example/p', { headers: cred });
  assert.equal(r2.text, 'fim');
  assert.deepEqual(seen.map((s) => s.u), ['https://a.example/p', 'https://a.example/q', 'https://b.example/r', 'https://a.example/s']);
  for (const s of seen.slice(0, 2)) {
    assert.equal(s.h.Authorization, 'Bearer segredo', `mesma origem leva authorization (${s.u})`);
    assert.equal(s.h.cookie, 'sid=1', `mesma origem leva cookie (${s.u})`);
  }
  for (const s of seen.slice(2)) {
    const names = Object.keys(s.h).map((k) => k.toLowerCase());
    assert.ok(!names.includes('authorization'), `outra origem não leva authorization (${s.u})`);
    assert.ok(!names.includes('cookie'), `outra origem não leva cookie (${s.u})`);
    assert.equal(s.h['x-outro'], 'fica', 'demais headers continuam');
    assert.equal(s.h['user-agent'], http.userAgent);
  }
  // Mesmo host com outro esquema (http → https) é outra origem.
  seen.length = 0;
  http.setFetch(async (u, init) => { seen.push({ u, h: init.headers }); return u.startsWith('http:') ? resp(301, { location: 'https://a.example/t' }) : resp(200); });
  await http.get('http://a.example/t', { headers: { authorization: 'Bearer segredo' } });
  assert.equal(seen[0].h.authorization, 'Bearer segredo');
  assert.equal(seen[1].h.authorization, undefined, 'troca de esquema remove authorization');
}

console.log('urlguard-tests: ok');
// #83: estados de erro e recuperação da UI (registrado aqui para não mexer no script test do package.json)
await import('./ui-states-tests.js');
