// Colisão de id de loja (docs/auditorias/cobertura-lojas.md §3/§4.5): hoje o id de uma loja vinda de config/lojas.txt é o
// host sem pontuação (src/run.js), então hosts que diferem só por hífen/ponto geram o MESMO id e dividem registro em
// sources.json. Este teste só FIXA o comportamento atual, para uma decisão posterior; se o id mudar, ele deve ser revisto.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';

for (const k of ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_SHA', 'GITHUB_EVENT_NAME', 'DATABASE_URL', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'HUNTER_CEP']) delete process.env[k];
process.env.HUNTER_TIPS = '0';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hunter-idcol-'));
process.env.HUNTER_CONFIG_DIR = path.join(tmp, 'config'); process.env.HUNTER_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.HUNTER_CONFIG_DIR, { recursive: true });
fs.copyFileSync(path.join(root, 'config/catalog.json'), path.join(tmp, 'config/catalog.json'));
fs.writeFileSync(path.join(tmp, 'config/watchlist.json'), JSON.stringify({ settings: {}, rules: [] }));
fs.writeFileSync(path.join(tmp, 'config/stores.json'), JSON.stringify({ stores: [] }));
fs.writeFileSync(path.join(tmp, 'config/lojas.txt'), 'loja-x.com.br\nlojax.com.br\n');

const { adapters } = await import('../src/adapters/index.js');
const { runOnce } = await import('../src/run.js');
const readData = (f, fb) => { try { return JSON.parse(fs.readFileSync(path.join(tmp, 'data', f), 'utf8')); } catch { return fb; } };
// Offline: a plataforma "auto" não deve sair para a rede; qualquer adaptador devolve vazio.
const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('offline'); };
for (const k of Object.keys(adapters)) adapters[k] = { ...adapters[k], search: async () => [] };

try {
  await runOnce({ log: () => {}, send: {}, now: new Date('2026-10-10T12:00:00Z') });
  const ids = Object.keys(readData('sources.json', {}));
  assert.deepEqual(ids, ['lojaxcombr'], 'loja-x.com.br e lojax.com.br colidem no mesmo id hoje (um único registro)');
  console.log('✓ Colisão de id de loja documentada: hosts que diferem só por hífen geram o mesmo id');
} finally {
  globalThis.fetch = realFetch;
}
