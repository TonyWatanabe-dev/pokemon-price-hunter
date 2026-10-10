// SSRF: guarda de URLs externas e redirecionamentos, com fetch sintético (sem rede real).
import assert from 'node:assert/strict';
import { assertSafeUrl, isPrivateHost } from '../src/urlguard.js';
import * as http from '../src/http.js';

for (const u of ['http://127.0.0.1/', 'http://localhost:8080/x', 'http://10.0.0.5/', 'http://172.16.3.1/', 'http://192.168.1.1/', 'http://169.254.169.254/latest/meta-data', 'http://0.0.0.0/', 'http://[::1]/', 'http://[fd00::1]/', 'http://[fe80::1]/', 'http://[::ffff:127.0.0.1]/', 'http://srv.internal/', 'file:///etc/passwd', 'ftp://example.com/', 'https://user:pw@example.com/', 'not a url'])
  assert.throws(() => assertSafeUrl(u), (e) => e.unsafe === true, `deveria bloquear ${u}`);
for (const u of ['https://www.ligapokemon.com.br/x', 'http://example.com/', 'https://172.32.0.1/', 'https://8.8.8.8/'])
  assert.doesNotThrow(() => assertSafeUrl(u), `deveria permitir ${u}`);
assert.equal(isPrivateHost('LOCALHOST.'), true);

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

console.log('urlguard-tests: ok');
