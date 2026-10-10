// C2 da Fase 3 (#177): o contrato comum do anúncio (validateListing, #47) está ligado no coletor (src/run.js).
// Rodada simulada, offline, com um adaptador falso: o anúncio inválido não vira oferta, o motivo é contado por loja
// (sources.json e meta.json → ops) e os válidos da mesma loja seguem. Oferta que já existia e cujo anúncio passou a
// sair inválido fica como leitura que falhou (stale + lastValid), nunca como "removida".
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';

for (const k of ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_SHA', 'GITHUB_EVENT_NAME', 'DATABASE_URL', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'HUNTER_CEP']) delete process.env[k];
process.env.HUNTER_TIPS = '0';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hunter-c2-'));
const saved = { cfg: process.env.HUNTER_CONFIG_DIR, data: process.env.HUNTER_DATA_DIR };
process.env.HUNTER_CONFIG_DIR = path.join(tmp, 'config'); process.env.HUNTER_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.HUNTER_CONFIG_DIR, { recursive: true });
fs.copyFileSync(path.join(root, 'config/catalog.json'), path.join(tmp, 'config/catalog.json'));
fs.writeFileSync(path.join(tmp, 'config/watchlist.json'), JSON.stringify({ settings: {}, rules: [] }));
fs.writeFileSync(path.join(tmp, 'config/stores.json'), JSON.stringify({ stores: [
  { id: 'fake', name: 'Loja Falsa', url: 'https://fake.test', platform: 'fake', kind: 'specialist', evidence: {} },
] }));

const { adapters } = await import('../src/adapters/index.js');
const { runOnce } = await import('../src/run.js');
const readData = (f, fb) => { try { return JSON.parse(fs.readFileSync(path.join(tmp, 'data', f), 'utf8')); } catch { return fb; } };
const A = { title: 'Pokémon TCG Booster Box c/36 - Caos Ascendente - Copag Lacrado', url: 'https://fake.test/products/box-caos', price: { base: 339 }, listPrice: null, stock: 'IN_STOCK', quantity: null, sku: null, ean: null, seller: null, image: null, sourceType: 'store_json' };
const B = { title: 'Box Treinador Avançado Caos Ascendente Copag', url: 'https://fake.test/products/etb', price: { base: 289.9 }, listPrice: null, stock: 'IN_STOCK', quantity: null, sku: null, ean: null, seller: null, image: null, sourceType: 'store_json' };
const X = { ...A, title: 'Pokémon Booster Box Caos Ascendente 36 boosters', url: 'javascript:alert(1)' };
let listings = [];
adapters.fake = { search: async () => listings };
const quiet = () => {};
let n = 0;
try {
  // Rodada 1: dois válidos + um com link javascript:.
  listings = [A, B, X];
  await runOnce({ log: quiet, send: {}, now: new Date('2026-10-10T12:00:00Z') });
  let offers = Object.values(readData('offers.json', {}));
  let src = readData('sources.json', {}).fake;
  assert.equal(src.status, 'ACTIVE', 'um anúncio ruim não derruba a loja');
  assert.ok(offers.some((o) => o.url === A.url) && offers.some((o) => o.url === B.url), 'válidos viram oferta');
  assert.ok(!offers.some((o) => !/^https?:/.test(o.url)), 'anúncio com link javascript: não vira oferta');
  assert.deepEqual(src.rejected, { total: 1, reasons: { 'link com protocolo não permitido': 1 } }, 'motivo contado por loja');
  assert.equal(src.listings, 3, 'sources.listings continua contando o que o adaptador entregou');
  let ops = readData('meta.json', {}).ops;
  assert.deepEqual(ops.last.listingsRejected, { total: 1, byStore: { fake: { 'link com protocolo não permitido': 1 } } }, 'contagem no relatório da rodada (ops)');
  n++;

  // Rodada 2: o anúncio B passa a vir com preço em texto. Não vira oferta nova (nem preço null): a oferta anterior fica
  // stale, com a última leitura válida; nenhum evento "removed" no histórico.
  const bId = offers.find((o) => o.url === B.url).id;
  listings = [A, { ...B, price: { base: '289,90' } }];
  await runOnce({ log: quiet, send: {}, now: new Date('2026-10-10T12:15:00Z') });
  offers = readData('offers.json', {});
  src = readData('sources.json', {}).fake;
  const b = offers[bId];
  assert.ok(b, 'oferta anterior preservada');
  assert.equal(b.stale, true); assert.equal(b.stock, 'UNKNOWN', 'estoque desconhecido, não "esgotado"');
  assert.equal(b.lastValid?.stock, 'IN_STOCK'); assert.equal(b.lastValid?.total, 289.9, 'lastValid guarda a última leitura válida');
  assert.equal(b.prices.base, 289.9, 'preço em texto não entra na oferta');
  assert.equal(Object.values(offers).find((o) => o.url === A.url)?.stale, false, 'válido da mesma loja segue');
  assert.deepEqual(src.rejected, { total: 1, reasons: { 'preço base não é número': 1, 'sem preço válido para estoque IN_STOCK': 1 } });
  const hist = fs.readFileSync(path.join(tmp, 'data/history.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(!hist.some((h) => h.offerId === bId && h.event === 'removed'), 'anúncio recusado não vira "removido"');
  n++;

  // Rodada 3: tudo válido de novo → a contagem some da loja e o ops registra zero.
  listings = [A, B];
  await runOnce({ log: quiet, send: {}, now: new Date('2026-10-10T12:30:00Z') });
  src = readData('sources.json', {}).fake;
  assert.equal(src.rejected, undefined);
  assert.deepEqual(readData('meta.json', {}).ops.last.listingsRejected, { total: 0, byStore: {} });
  assert.equal(readData('offers.json', {})[bId].stale, false);
  n++;
} finally {
  delete adapters.fake;
  if (saved.cfg == null) delete process.env.HUNTER_CONFIG_DIR; else process.env.HUNTER_CONFIG_DIR = saved.cfg;
  if (saved.data == null) delete process.env.HUNTER_DATA_DIR; else process.env.HUNTER_DATA_DIR = saved.data;
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`✓ Contrato do anúncio no coletor (C2/#177): ${n} rodadas simuladas passaram`);
