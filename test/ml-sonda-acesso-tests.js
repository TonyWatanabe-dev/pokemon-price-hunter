// Renovação do ML testa o acesso de verdade: 403 PolicyAgent vira aviso claro (sem rede).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.HUNTER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-sonda-'));
process.env.ML_CLIENT_ID = '123';
process.env.ML_CLIENT_SECRET = 'segredo-de-teste';
process.env.HUNTER_DOMAIN_DELAY_MS = '0';
const { probe } = await import('../src/mlauth.js');
const http = await import('../src/http.js');
const setFetch = (f) => http.setFetch(f);
const json = (status, body) => new Response(JSON.stringify(body), { status });
const policy = { message: 'At least one policy returned UNAUTHORIZED.', status: 403, blocked_by: 'PolicyAgent' };

// tudo aceito
setFetch(async (url) => (url.includes('/users/me') ? json(200, { id: 9 }) : json(200, { results: [] })));
let p = await probe('AT');
assert.equal(p.ok, true); assert.equal(p.reason, null);

// app barrado pelo ML (caso real de 23/11/2026): conta responde 403 PolicyAgent
const calls = [];
setFetch(async (url, opt) => { calls.push(url); assert.match(JSON.stringify(opt.headers), /Bearer AT/); return json(403, policy); });
p = await probe('AT');
assert.equal(p.ok, false); assert.equal(p.policy, true); assert.equal(p.me, 403);
assert.match(p.reason, /PolicyAgent/);
assert.equal(calls.length, 1, 'com a conta recusada, não insiste no catálogo');
assert.ok(!p.reason.includes('AT'), 'nunca expõe o token');

// conta ok, catálogo barrado
setFetch(async (url) => (url.includes('/users/me') ? json(200, { id: 9 }) : json(403, policy)));
p = await probe('AT');
assert.equal(p.ok, false); assert.equal(p.catalog, 403); assert.match(p.reason, /catálogo respondeu 403/);

// sem rede
setFetch(async () => { throw new Error('ECONNRESET'); });
p = await probe('AT');
assert.equal(p.ok, false); assert.match(p.reason, /sem resposta/);
console.log('ml-sonda-acesso: ok');
