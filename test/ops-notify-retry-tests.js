// Retentativa única no envio de aviso: 5xx seguido de ok = entregue; duas falhas = não entregue; sem segredo no erro.
import assert from 'node:assert/strict';
import { sendAll } from '../src/ops-notify.js';

const env = { TELEGRAM_BOT_TOKEN: '123456:SEGREDO-token', TELEGRAM_CHAT_ID: '987654321' };
const msg = { title: 't', text: 'x', kind: 'alerta' };
const seq = (...codes) => { const calls = []; const f = async (url) => { calls.push(url); return { ok: codes[calls.length - 1] < 400, status: codes[calls.length - 1] }; }; f.calls = calls; return f; };

let f = seq(503, 200);
let r = await sendAll(msg, { env, fetchImpl: f });
assert.equal(r.delivered, true); assert.equal(f.calls.length, 2);

f = seq(500, 502, 200);
r = await sendAll(msg, { env, fetchImpl: f });
assert.equal(r.delivered, false); assert.equal(f.calls.length, 2);
assert.equal(r.channels[0].error, 'HTTP 502');
assert.ok(!JSON.stringify(r).includes('SEGREDO'));

f = seq(400, 200);
r = await sendAll(msg, { env, fetchImpl: f });
assert.equal(r.delivered, false); assert.equal(f.calls.length, 1);

const boom = async (url) => { throw new Error(`falha em ${url}`); };
r = await sendAll(msg, { env, fetchImpl: boom });
assert.equal(r.delivered, false);
assert.ok(!JSON.stringify(r).includes('SEGREDO') && !JSON.stringify(r).includes('123456'));
console.log('ops-notify-retry: ok');
