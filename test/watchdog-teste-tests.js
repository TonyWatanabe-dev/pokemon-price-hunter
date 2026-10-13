// Vigia, modo --test (observabilidade T1): envia a mensagem de teste pelos canais simulados, informa delivered
// true/false e nunca grava o --ledger. Sem rede e sem segredo real: fetch é injetado em main().
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-teste-'));
// watchdog.mjs lê process.argv ao ser carregado: cada conjunto de flags importa uma instância nova do módulo
let k = 0;
async function load(argv) {
  const saved = process.argv; process.argv = [saved[0], saved[1], ...argv];
  try { return await import(pathToFileURL(path.join(root, 'tools/watchdog.mjs')).href + '?teste=' + (++k)); } finally { process.argv = saved; }
}
const ENV = { TELEGRAM_BOT_TOKEN: '123456:SEGREDO-telegram', TELEGRAM_CHAT_ID: '987654', NTFY_TOPIC: 'topico-secreto' };
const fetchOf = (status, calls) => async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: status < 400, status }; };

await t('1. --test com canais aceitando: delivered true, mensagem de teste nos dois canais, livro não criado', async () => {
  const ledger = path.join(tmp, 'novo.json');
  const m = await load(['--test', '--ledger', ledger]);
  const calls = []; const logs = [];
  const r = await m.main({ env: ENV, fetchImpl: fetchOf(200, calls), log: (s) => logs.push(s) });
  assert.equal(r.test, true); assert.equal(r.delivered, true);
  assert.deepEqual(r.channels, [{ name: 'telegram', ok: true }, { name: 'ntfy', ok: true }]);
  assert.equal(calls.length, 2); assert.match(calls[0].body.text, /Teste do vigia/); assert.match(calls[1].body.message, /Teste do vigia/);
  assert.equal(fs.existsSync(ledger), false, '--test não grava o livro');
  assert.deepEqual(JSON.parse(logs[0]), { test: true, delivered: true, channels: r.channels });
  assert.ok(!logs.join('\n').includes('SEGREDO') && !logs.join('\n').includes('topico-secreto'), 'saída sem segredo');
});

await t('2. --test com canais recusando: delivered false, erro mascarado, livro existente intacto', async () => {
  const ledger = path.join(tmp, 'existente.json');
  const before = JSON.stringify({ notifiedStatus: 'parado', notifiedCodes: ['dados_parados'], notifiedAt: '2026-10-09T11:00:00.000Z' });
  fs.writeFileSync(ledger, before);
  const m = await load(['--test', '--ledger', ledger]);
  const calls = []; const logs = [];
  const r = await m.main({ env: ENV, fetchImpl: fetchOf(403, calls), log: (s) => logs.push(s) });
  assert.equal(r.test, true); assert.equal(r.delivered, false);
  assert.ok(r.channels.every((c) => c.ok === false && /HTTP 403/.test(c.error)), JSON.stringify(r.channels));
  assert.equal(calls.length, 2, '4xx não repete');
  assert.equal(fs.readFileSync(ledger, 'utf8'), before, '--test não mexe no livro');
  assert.equal(JSON.parse(logs[0]).delivered, false);
  assert.ok(!logs.join('\n').includes('SEGREDO') && !logs.join('\n').includes('topico-secreto'), 'saída sem segredo');
});

await t('3. --test sem nenhum canal configurado: delivered false, nada enviado, livro intacto', async () => {
  const ledger = path.join(tmp, 'existente.json'); const before = fs.readFileSync(ledger, 'utf8');
  const m = await load(['--test', '--ledger', ledger]);
  const calls = [];
  const r = await m.main({ env: {}, fetchImpl: fetchOf(200, calls), log: () => {} });
  assert.equal(r.delivered, false); assert.equal(calls.length, 0);
  assert.deepEqual(r.channels, [{ name: 'telegram', ok: false, skipped: true }, { name: 'ntfy', ok: false, skipped: true }]);
  assert.equal(fs.readFileSync(ledger, 'utf8'), before);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`✓ Vigia --test: ${n} grupos passaram`);
