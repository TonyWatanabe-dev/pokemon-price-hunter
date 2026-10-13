// sources.json/url-cache.json gravados logo após a coleta (#548): com readOfficial simulado lançando, runOnce rejeita, mas
// o sources.json da rodada fica com os checks atualizados. Offline: coletores simulados (setFetch) e opportunity-read
// trocado por um hook de módulo (module.register), sem rede nem banco.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { register } from 'node:module'; import { fileURLToPath } from 'node:url';
process.env.HUNTER_DOMAIN_DELAY_MS ??= '0';
const stub = 'export const MAX_AGE_MIN = 60; export const officialFor = () => null; export const officialLine = () => null;'
  + ' export async function readOfficial() { throw new Error("readOfficial simulado"); }';
const hooks = `export async function load(url, ctx, next) {
  if (url.endsWith('/src/opportunity-read.js')) return { format: 'module', source: ${JSON.stringify(stub)}, shortCircuit: true };
  return next(url, ctx);
}`;
register('data:text/javascript,' + encodeURIComponent(hooks));
const http = await import('../src/http.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
http.setFetch(async (url) => new URL(url).pathname === '/products.json'
  ? new Response('{"products":[]}', { status: 200, headers: { 'content-type': 'application/json' } })
  : new Response('', { status: 404, headers: { 'content-type': 'text/html' } }));
const keep = Object.fromEntries(['HUNTER_CONFIG_DIR', 'HUNTER_DATA_DIR', 'HUNTER_TIPS', 'HUNTER_CEP', 'DATABASE_URL', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_SHA', 'GITHUB_EVENT_NAME'].map((k) => [k, process.env[k]]));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hunter-sp-'));
try {
  for (const k of ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_SHA', 'GITHUB_EVENT_NAME', 'HUNTER_CEP', 'DATABASE_URL']) delete process.env[k];
  process.env.HUNTER_CONFIG_DIR = path.join(tmp, 'config'); process.env.HUNTER_DATA_DIR = path.join(tmp, 'data'); process.env.HUNTER_TIPS = '0';
  const D = process.env.HUNTER_DATA_DIR;
  fs.mkdirSync(process.env.HUNTER_CONFIG_DIR, { recursive: true }); fs.mkdirSync(D, { recursive: true });
  fs.copyFileSync(path.join(root, 'config/catalog.json'), path.join(tmp, 'config/catalog.json'));
  fs.writeFileSync(path.join(tmp, 'config/stores.json'), JSON.stringify({ stores: [{ id: 'f1', name: 'f1', url: 'https://f1-sp.test', platform: 'shopify', kind: 'specialist', evidence: {} }] }));
  fs.writeFileSync(path.join(tmp, 'config/watchlist.json'), JSON.stringify({ settings: { cep: null }, rules: [] }));
  // Rodada anterior: 2 checks, lida há 1 h
  fs.writeFileSync(path.join(D, 'sources.json'), JSON.stringify({ f1: { checks: 2, ok: 2, status: 'ACTIVE', lastCheck: '2026-10-06T09:00:00.000Z' } }));
  const { runOnce } = await import('../src/run.js');
  const T = '2026-10-06T10:00:00.000Z';
  const logs = []; const opts = { log: (m) => logs.push(String(m)), send: { capture: async () => true }, now: new Date(T) };
  await assert.rejects(() => runOnce(opts), /readOfficial simulado/, 'readOfficial lançando derruba a pós-coleta');
  const read = (f) => JSON.parse(fs.readFileSync(path.join(D, f), 'utf8'));
  const src = read('sources.json').f1;
  assert.equal(src.checks, 3, 'checks da rodada gravado mesmo com a pós-coleta caindo');
  assert.equal(src.lastCheck, T, 'lastCheck da rodada gravado');
  assert.ok(fs.existsSync(path.join(D, 'url-cache.json')), 'url-cache.json gravado após a coleta');
  assert.ok(!fs.existsSync(path.join(D, 'state.json')), 'state.json não é gravado (a rodada caiu antes)');
  assert.ok(!logs.some((l) => /^Fontes ativas/.test(l)), 'a rodada não chega ao resumo final');
  console.log('run-sources-persist-tests ok');
} finally {
  for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  fs.rmSync(tmp, { recursive: true, force: true });
}
