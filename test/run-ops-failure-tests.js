// Estado operacional na rodada: com meta.json ilegível ou não gravável, runOnce ainda devolve o state e loga [estado operacional].
// Offline: coletores simulados (setFetch), sem rede.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
process.env.HUNTER_DOMAIN_DELAY_MS ??= '0';
const http = await import('../src/http.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = (s, status = 200) => new Response(s, { status, headers: { 'content-type': 'text/html' } });
http.setFetch(async (url) => { const u = new URL(url); return u.pathname === '/products.json' ? new Response('{"products":[]}', { status: 200, headers: { 'content-type': 'application/json' } }) : html('', 404); });
const keep = Object.fromEntries(['HUNTER_CONFIG_DIR', 'HUNTER_DATA_DIR', 'HUNTER_TIPS', 'HUNTER_CEP', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_SHA', 'GITHUB_EVENT_NAME'].map((k) => [k, process.env[k]]));
const realRename = fs.renameSync;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hunter-wf-'));
try {
  for (const k of ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_SHA', 'GITHUB_EVENT_NAME', 'HUNTER_CEP']) delete process.env[k];
  process.env.HUNTER_CONFIG_DIR = path.join(tmp, 'config'); process.env.HUNTER_DATA_DIR = path.join(tmp, 'data'); process.env.HUNTER_TIPS = '0';
  fs.mkdirSync(process.env.HUNTER_CONFIG_DIR, { recursive: true });
  fs.copyFileSync(path.join(root, 'config/catalog.json'), path.join(tmp, 'config/catalog.json'));
  fs.writeFileSync(path.join(tmp, 'config/stores.json'), JSON.stringify({ stores: [{ id: 'f1', name: 'f1', url: 'https://f1-wf.test', platform: 'shopify', kind: 'specialist', evidence: {} }] }));
  fs.writeFileSync(path.join(tmp, 'config/watchlist.json'), JSON.stringify({ settings: { cep: null }, rules: [] }));
  const { runOnce } = await import('../src/run.js');
  const D = process.env.HUNTER_DATA_DIR;
  const logs = []; const opts = { log: (m) => logs.push(String(m)), send: { capture: async () => true }, now: new Date('2026-10-06T10:00:00Z') };
  // (a) meta.json ilegível na hora de registrar a rodada: a leitura lança e a rodada segue com o state
  const realRead = fs.readFileSync; let reading = false;
  fs.readFileSync = (f, ...r) => { if (reading && path.basename(String(f)) === 'meta.json') throw Object.assign(new Error('EACCES leitura simulada'), { code: 'EACCES' }); return realRead(f, ...r); };
  fs.renameSync = (from, to) => { if (path.basename(String(to)) === 'state.json') reading = true; return realRename(from, to); }; // só depois de gravar o state.json
  let s;
  try { s = await runOnce(opts); } finally { fs.readFileSync = realRead; fs.renameSync = realRename; }
  assert.ok(s && s.generatedAt && Array.isArray(s.offers), 'runOnce devolve o state mesmo com meta.json ilegível');
  assert.ok(fs.existsSync(path.join(D, 'state.json')), 'state.json gravado normalmente');
  // (b) meta.json não gravável: o rename de meta.json falha
  logs.length = 0;
  const runsAntes = JSON.parse(fs.readFileSync(path.join(D, 'meta.json'), 'utf8')).ops?.runs?.length;
  fs.renameSync = (from, to) => { if (path.basename(String(to)) === 'meta.json' && !String(from).endsWith('meta.json.tmp')) throw Object.assign(new Error('EACCES simulado'), { code: 'EACCES' }); return realRename(from, to); };
  s = await runOnce(opts);
  fs.renameSync = realRename;
  assert.ok(s && s.generatedAt, 'runOnce devolve o state com meta.json não gravável');
  assert.ok(logs.some((l) => /^\[estado operacional\] .*EACCES simulado/.test(l)), 'loga [estado operacional] com o motivo');
  assert.equal(JSON.parse(fs.readFileSync(path.join(D, 'meta.json'), 'utf8')).ops?.runs?.length, runsAntes, 'nenhum registro novo em ops.runs');
  assert.ok(logs.some((l) => /^Fontes ativas/.test(l)), 'a rodada segue até o resumo final');
  console.log('run-ops-failure-tests ok');
} finally {
  fs.renameSync = realRename;
  for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  fs.rmSync(tmp, { recursive: true, force: true });
}
