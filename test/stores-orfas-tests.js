// Lojas órfãs (em sources.json, fora de stores.json) não entram em coverage.found nem em state.sources e saem do arquivo
// na rodada (pruneSources; ver test/sources-limpeza-tests.js).
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
process.env.HUNTER_DOMAIN_DELAY_MS ??= '0';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const http = await import('../src/http.js');
http.setFetch(async () => new Response('', { status: 404, headers: { 'content-type': 'text/html' } }));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pph-orfas-'));
fs.mkdirSync(path.join(tmp, 'config/lojas'), { recursive: true }); fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
for (const f of ['catalog.json', 'pistas.json', 'watchlist.json']) { try { fs.copyFileSync(path.join(root, 'config', f), path.join(tmp, 'config', f)); } catch { /* opcional */ } }
fs.writeFileSync(path.join(tmp, 'config/stores.json'), JSON.stringify({ stores: [
  { id: 'viva', name: 'Viva', url: 'https://viva.test', platform: 'jsonld', kind: 'specialist', evidence: {} },
] }));
fs.writeFileSync(path.join(tmp, 'data/sources.json'), JSON.stringify({ orfa: { checks: 3, ok: 3, status: 'ACTIVE', listings: 5 } }));
process.env.HUNTER_DATA_DIR = path.join(tmp, 'data'); process.env.HUNTER_CONFIG_DIR = path.join(tmp, 'config');

const { runOnce } = await import('../src/run.js');
await runOnce({ log: () => {}, send: { capture: async () => true }, now: new Date('2026-10-12T10:00:00Z') });

const state = JSON.parse(fs.readFileSync(path.join(tmp, 'data/state.json'), 'utf8'));
const src = JSON.parse(fs.readFileSync(path.join(tmp, 'data/sources.json'), 'utf8'));
assert.equal(state.coverage.found, 1, 'só a loja da lista conta');
assert.equal(state.coverage.active, state.sources.filter((s) => s.status === 'ACTIVE').length, 'cobertura coerente com state.sources');
assert.deepEqual(state.sources.map((s) => s.id), ['viva']);
assert.equal(src.orfa, undefined, 'órfã sai de sources.json');
assert.ok(src.viva, 'loja da lista segue registrada');
fs.rmSync(tmp, { recursive: true, force: true });
console.log('stores-orfas: OK');
