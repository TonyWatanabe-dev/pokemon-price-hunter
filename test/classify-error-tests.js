// classifyError: robots.txt inacessível vira rede/timeout (não bloqueio) e credencial ausente vira auth (issue #405).
// A decisão de não rastrear não muda: o erro continua BlockedError (status BLOCKED na rodada).
import assert from 'node:assert/strict';
import http from 'node:http';
import { classifyError } from '../src/opstate.js';
import { BlockedError } from '../src/http.js';
import { guard } from '../src/adapters/common.js';

let n = 0;
async function t(name, fn) { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } }
const unreachable = (what, extra) => new BlockedError(`loja.test fora do ar ou lento para responder (robots.txt: ${what})`, 'unreachable', extra);

await t('1. inacessível: DNS/rede → rede; timeout → timeout', () => {
  assert.equal(classifyError(unreachable('erro de rede ENOTFOUND', { code: 'ENOTFOUND' })), 'rede');
  assert.equal(classifyError(unreachable('erro de rede ECONNREFUSED', { code: 'ECONNREFUSED' })), 'rede');
  assert.equal(classifyError(unreachable('erro de rede', { code: null })), 'rede');
  assert.equal(classifyError(unreachable('HTTP 503', { httpStatus: 503 })), 'rede');
  assert.equal(classifyError(unreachable('tempo esgotado, TIMEOUT', { code: 'TIMEOUT' })), 'timeout');
  assert.ok(unreachable('x').blocked, 'continua bloqueado (não rastrear)');
});

await t('2. credencial ausente (BlockedError auth) → auth', () => {
  assert.equal(classifyError(new BlockedError('Mercado Livre ainda não autorizado', 'auth')), 'auth');
  assert.equal(classifyError(new BlockedError('Mercado Livre: não foi possível renovar o acesso (HTTP 400)', 'auth')), 'auth');
});

await t('3. 403, 429, desafio e robots continuam bloqueio', () => {
  assert.equal(classifyError(new BlockedError('Acesso bloqueado em loja.test (HTTP 403)', 403, { httpStatus: 403 })), 'bloqueio');
  assert.equal(classifyError(new BlockedError('Limite de requisições (429) em loja.test', 429, { httpStatus: 429 })), 'bloqueio');
  assert.equal(classifyError(new BlockedError('Acesso bloqueado em loja.test (desafio anti-robô com HTTP 200)', 403, { httpStatus: 200 })), 'bloqueio');
  assert.equal(classifyError(new BlockedError('robots.txt não permite /x', 'robots')), 'bloqueio');
  assert.equal(classifyError(new BlockedError('Timeout atrás de bloqueio', 403)), 'bloqueio', 'bloqueio vem antes de timeout');
});

await t('4. demais casos não mudam', () => {
  assert.equal(classifyError(null), null);
  assert.equal(classifyError(Object.assign(new Error('Timeout em loja.com'), { status: 0 })), 'timeout');
  assert.equal(classifyError(Object.assign(new Error('HTTP 503'), { status: 503 })), 'http_5xx');
  assert.equal(classifyError(Object.assign(new Error('HTTP 404'), { status: 404 })), 'http_4xx');
  assert.equal(classifyError(Object.assign(new Error('HTTP 401'), { status: 401 })), 'http_4xx', 'auth só para BlockedError');
  assert.equal(classifyError(Object.assign(new Error('x'), { status: 'auth' })), 'outro', 'auth só para BlockedError');
  assert.equal(classifyError(Object.assign(new Error('plataforma não reconhecida'), { status: 'platform' })), 'plataforma');
  assert.equal(classifyError(Object.assign(new Error('fetch failed'), { code: 'ENOTFOUND' })), 'rede');
  assert.equal(classifyError(new SyntaxError('Unexpected token < in JSON')), 'parse');
  assert.equal(classifyError(new Error('???')), 'outro');
});

await t('5. guard real: robots.txt 503 → BlockedError unreachable → rede', async () => {
  const srv = http.createServer((req, res) => { res.writeHead(503); res.end('fora'); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const url = `http://127.0.0.1:${srv.address().port}/produto`;
    const e = await guard(url).then(() => null, (err) => err);
    assert.ok(e && e.blocked && e.status === 'unreachable', `esperava unreachable: ${e && e.message}`);
    assert.equal(classifyError(e), 'rede');
  } finally { srv.close(); }
});

console.log(`classify-error: ${n} testes ok`);
