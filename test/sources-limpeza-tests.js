// Limpeza do sources.json: loja retirada (config/lojas/removidas.txt) ou tirada de config/stores.json some do arquivo na
// próxima rodada; ativas, bloqueadas por robots.txt, pausadas e lojas das listas .txt continuam com status e motivo.
// O histórico de preços (data/hist, por storeId) não é tocado.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
process.env.HUNTER_DOMAIN_DELAY_MS ??= '0';
process.env.HUNTER_BUDGET_MIN = '0.000001'; // prazo da rodada já vencido: nenhuma loja é lida, o status anterior fica
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const http = await import('../src/http.js');
http.setFetch(async () => new Response('', { status: 404, headers: { 'content-type': 'text/html' } }));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pph-limpeza-'));
for (const d of ['config/lojas', 'data/hist']) fs.mkdirSync(path.join(tmp, d), { recursive: true });
for (const f of ['catalog.json', 'pistas.json', 'watchlist.json']) { try { fs.copyFileSync(path.join(root, 'config', f), path.join(tmp, 'config', f)); } catch { /* opcional */ } }
fs.writeFileSync(path.join(tmp, 'config/stores.json'), JSON.stringify({ stores: [
  { id: 'viva', name: 'Viva', url: 'https://viva.test', platform: 'jsonld', kind: 'specialist', evidence: {} },
  { id: 'robo', name: 'Robo', url: 'https://robo.test', platform: 'jsonld', kind: 'specialist', evidence: {} },
  { id: 'pausa', name: 'Pausa', url: 'https://pausa.test', platform: 'shopify', kind: 'specialist', evidence: {}, enabled: false },
] }));
fs.writeFileSync(path.join(tmp, 'config/lojas/varredura.txt'), 'https://lista.com.br\n');
fs.writeFileSync(path.join(tmp, 'config/lojas/removidas.txt'), '# morta.com.br | 2026-10-12 | DNS não resolve (ENOTFOUND) | teste\n');
fs.writeFileSync(path.join(tmp, 'data/discovery-stores.txt'), 'https://achada.com.br  # DIE\n');

const recent = new Date().toISOString(); // backoff conta pelo relógio real: BLOCKED recente não é tentada de novo
const robots = 'robots.txt proíbe /products.json';
fs.writeFileSync(path.join(tmp, 'data/sources.json'), JSON.stringify({
  viva: { checks: 9, ok: 9, status: 'ACTIVE', reason: 'ok', listings: 5 },
  robo: { checks: 4, ok: 0, status: 'BLOCKED', reason: robots, fails: 1, lastCheck: recent },
  pausa: { checks: 2, ok: 2, status: 'PAUSED', reason: 'pausada manualmente' },
  listacombr: { checks: 3, ok: 3, status: 'ACTIVE', reason: 'ok', listings: 2 },
  achadacombr: { checks: 1, ok: 1, status: 'ACTIVE', reason: 'ok' },
  mortacombr: { checks: 204, ok: 0, status: 'BLOCKED', reason: 'getaddrinfo ENOTFOUND', url: 'https://morta.com.br', fails: 30, lastCheck: recent },
  antigapendente: { checks: 0, ok: 0, status: 'PENDING', reason: 'domínio ainda não confirmado' },
}));
const hist = { productId: 'p1', stores: { mortacombr: { pts: [['2026-10-01', 199.9]] } } };
fs.writeFileSync(path.join(tmp, 'data/hist/p1.json'), JSON.stringify(hist));
process.env.HUNTER_DATA_DIR = path.join(tmp, 'data'); process.env.HUNTER_CONFIG_DIR = path.join(tmp, 'config');

const { runOnce, pruneSources } = await import('../src/run.js');

// Unidade: remove só o que não está na configuração e devolve os ids, em ordem.
const s = { a: { status: 'ACTIVE' }, z: { status: 'PENDING' }, b: { status: 'BLOCKED' } };
assert.deepEqual(pruneSources(s, [{ id: 'a' }]), ['b', 'z']);
assert.deepEqual(Object.keys(s), ['a']);

const logs = [];
await runOnce({ log: (m) => logs.push(String(m)), send: { capture: async () => true }, now: new Date('2026-10-15T10:00:00Z') });
const src = JSON.parse(fs.readFileSync(path.join(tmp, 'data/sources.json'), 'utf8'));
const state = JSON.parse(fs.readFileSync(path.join(tmp, 'data/state.json'), 'utf8'));

assert.deepEqual(Object.keys(src).sort(), ['achadacombr', 'listacombr', 'pausa', 'robo', 'viva'], 'retirada e pendente antiga saem; configuradas ficam');
assert.equal(src.viva.status, 'ACTIVE'); assert.equal(src.viva.listings, 5);
assert.equal(src.robo.status, 'BLOCKED'); assert.equal(src.robo.reason, robots, 'motivo do bloqueio por robots preservado');
assert.equal(src.pausa.status, 'PAUSED'); assert.equal(src.pausa.reason, 'pausada manualmente');
assert.equal(src.listacombr.status, 'ACTIVE'); assert.equal(src.achadacombr.status, 'ACTIVE');
assert.equal(state.coverage.found, 5);
assert.deepEqual(state.sources.map((x) => x.id).sort(), Object.keys(src).sort(), 'state.sources e sources.json coincidem');
assert.ok(logs.some((m) => /2 lojas fora da configuração.*antigapendente, mortacombr/.test(m)), 'a rodada registra quem saiu');
// Histórico de preços da loja retirada fica intacto.
assert.deepEqual(JSON.parse(fs.readFileSync(path.join(tmp, 'data/hist/p1.json'), 'utf8')).stores.mortacombr, hist.stores.mortacombr);

fs.rmSync(tmp, { recursive: true, force: true });
console.log('sources-limpeza: OK');
