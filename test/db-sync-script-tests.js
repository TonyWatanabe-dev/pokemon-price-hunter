// tools/db-sync.mjs com arquivo corrompido (docs/auditorias/frescor-sync.md §4, item 2): state.json ou history.jsonl
// inválidos → mensagem curta sem stack, código 1 e nenhuma conexão ao banco. Sem banco real: DATABASE_URL aponta para
// um servidor TCP local que só conta conexões (e as derruba). O caso de controle (state.json válido) prova que a sonda
// enxerga a tentativa de conexão.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'db-sync-script-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };

let conexoes = 0;
const server = net.createServer((s) => { conexoes++; s.destroy(); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `postgres://u:p@127.0.0.1:${server.address().port}/x`;

function pasta(nome, files) {
  const d = path.join(tmp, nome); fs.mkdirSync(d);
  for (const [f, c] of Object.entries(files)) fs.writeFileSync(path.join(d, f), c);
  return d;
}
function run(dir) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, DATABASE_URL: url }; delete env.PG_CA_CERT; delete env.PG_CA_CERT_B64; delete env.PG_TLS_STRICT;
    const p = spawn('node', [path.join(root, 'tools/db-sync.mjs'), dir], { cwd: root, env });
    let out = '', err = '';
    p.stdout.on('data', (b) => { out += b; }); p.stderr.on('data', (b) => { err += b; });
    const timer = setTimeout(() => { p.kill(); reject(new Error('db-sync não terminou em 20 s')); }, 20000);
    p.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
  });
}
const semStack = (s) => assert.doesNotMatch(s, /^\s+at /m, 'saída não deve ter stack trace');

await t('1. state.json inválido → mensagem sem stack, código 1, banco não tocado', async () => {
  conexoes = 0;
  const r = await run(pasta('state-ruim', { 'state.json': '{"offers": [' }));
  assert.equal(r.code, 1);
  assert.match(r.err, /state\.json ilegível/);
  assert.match(r.err, /O banco não foi tocado/);
  semStack(r.err); semStack(r.out);
  assert.equal(conexoes, 0);
});

await t('2. state.json ausente → mesmo tratamento', async () => {
  conexoes = 0;
  const r = await run(pasta('sem-state', {}));
  assert.equal(r.code, 1);
  assert.match(r.err, /state\.json ilegível/);
  semStack(r.err);
  assert.equal(conexoes, 0);
});

await t('3. history.jsonl com linha inválida → mesmo tratamento', async () => {
  conexoes = 0;
  const r = await run(pasta('hist-ruim', { 'state.json': '{}', 'history.jsonl': '{"a":1}\n{quebrado\n' }));
  assert.equal(r.code, 1);
  assert.match(r.err, /history\.jsonl ilegível/);
  semStack(r.err);
  assert.equal(conexoes, 0);
});

await t('4. controle: state.json válido → tenta conectar (a sonda funciona) e falha sem afetar o site', async () => {
  conexoes = 0;
  const r = await run(pasta('state-ok', { 'state.json': '{}' }));
  assert.equal(r.code, 1);
  assert.match(r.err, /Sincronização com o banco falhou/);
  assert.ok(conexoes >= 1, 'deveria ter tentado conectar');
});

server.close();
console.log(`db-sync-script: ${n} testes ok`);
