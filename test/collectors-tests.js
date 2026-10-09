// Lote 7 — coletores: falha passageira não vira remoção, reposição ou queda falsa (offline, fetch simulado).
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
process.env.HUNTER_DOMAIN_DELAY_MS = '0';
process.env.HUNTER_TIPS = '0';
for (const k of ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_SHA', 'GITHUB_EVENT_NAME', 'HUNTER_CEP', 'HUNTER_BUDGET_MIN']) delete process.env[k];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hunter-col-'));
process.env.HUNTER_CONFIG_DIR = path.join(tmp, 'config'); process.env.HUNTER_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.HUNTER_CONFIG_DIR, { recursive: true });
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
fs.copyFileSync(path.join(root, 'config/catalog.json'), path.join(tmp, 'config/catalog.json'));
fs.writeFileSync(path.join(tmp, 'config/stores.json'), JSON.stringify({ stores: [
  { id: 'vt', name: 'Loja VTEX', url: 'https://vt.test', platform: 'vtex', kind: 'specialist', evidence: {} },
] }));
// Qualquer produto que volta ao estoque alerta; produto vigiado alerta queda.
fs.writeFileSync(path.join(tmp, 'config/watchlist.json'), JSON.stringify({ settings: { cep: null }, rules: [
  { id: 'rs', label: 'Voltou ao estoque', filter: {}, restock: true },
  { id: 'w', label: 'Vigia ME05', mode: 'target', filter: { productId: 'me05-box36' }, maxPrice: 1 },
] }));

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const html = (s, status = 200) => new Response(s, { status, headers: { 'content-type': 'text/html' } });
const http = await import('../src/http.js');

// ---- loja VTEX simulada
const vt = { down: false, a: { price: 449.9, qty: 5 }, b: { price: 289.9, qty: 0 } };
const vtItem = (name, link, id, x) => ({ productName: name, link, items: [{ itemId: id, name: 'u', sellers: [{ sellerId: '1', sellerName: 'Loja VTEX', commertialOffer: { Price: x.price, ListPrice: x.price, AvailableQuantity: x.qty } }] }] });
http.setFetch(async (url) => {
  const u = new URL(url);
  if (u.pathname === '/robots.txt') return html('', 404);
  if (u.host === 'vt.test') {
    if (vt.down) return html('erro', 503);
    if (u.pathname.startsWith('/api/catalog_system')) return json(u.searchParams.get('ft') === 'pokemon' ? [
      vtItem('Box Display Pokémon ME05 Escuridão Absoluta 36 Boosters Copag', 'https://vt.test/me05-display/p', '1', vt.a),
      vtItem('Box Treinador Avançado Caos Ascendente Copag', 'https://vt.test/me04-etb/p', '2', vt.b),
    ] : []);
  }
  return html('', 404);
});

const { runOnce } = await import('../src/run.js');
const sent = []; const send = { capture: async (m) => { sent.push(m); return true; } };
const quiet = () => {};
const readData = (f) => JSON.parse(fs.readFileSync(path.join(process.env.HUNTER_DATA_DIR, f), 'utf8'));
const histRows = () => fs.readFileSync(path.join(process.env.HUNTER_DATA_DIR, 'history.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const at = (min) => new Date(Date.parse('2026-10-06T10:00:00Z') + min * 60e3);
const offerOf = (s, pid) => s.offers.find((o) => o.storeId === 'vt' && o.productId === pid);

// ===== Item 2: reposição falsa — em estoque → falha → recuperação
let s = await runOnce({ log: quiet, send, now: at(0) });
const A = offerOf(s, 'me05-box36'); const B = offerOf(s, 'me04-etb');
assert.ok(A && A.stock === 'IN_STOCK' && B && B.stock === 'OUT_OF_STOCK', 'leitura inicial');
const sent0 = sent.length;

vt.down = true;
s = await runOnce({ log: quiet, send, now: at(15) });
assert.equal(s.sources.find((x) => x.id === 'vt').status, 'ERROR');
{ const o = readData('offers.json')[A.id];
  assert.ok(o.stale && o.stock === 'UNKNOWN', 'falha: oferta fica como estoque não confirmado');
  assert.deepEqual({ stock: o.lastValid.stock, total: o.lastValid.total }, { stock: 'IN_STOCK', total: 449.9 }, 'guarda a última leitura válida');
  assert.equal(readData('offers.json')[B.id].lastValid.stock, 'OUT_OF_STOCK'); }
// segunda falha seguida: lastValid continua o da leitura válida (não o "UNKNOWN" da falha)
s = await runOnce({ log: quiet, send, now: at(30) });
assert.equal(readData('offers.json')[A.id].lastValid.stock, 'IN_STOCK', 'falhas seguidas não sobrescrevem a última leitura válida');

vt.down = false; vt.b.qty = 3; // A segue igual; B volta de verdade ao estoque
s = await runOnce({ log: quiet, send, now: at(45) });
{ const a = offerOf(s, 'me05-box36'); const b = offerOf(s, 'me04-etb');
  assert.ok(!a.stale && a.stock === 'IN_STOCK' && !('lastValid' in a), 'recuperada: leitura nova, sem resto da falha');
  assert.ok(!b.stale && b.stock === 'IN_STOCK');
  const novos = sent.slice(sent0);
  assert.ok(!novos.some((m) => /RESTOCK/.test(m.title) && /ESCURID/i.test(m.text)), 'em estoque → falha → em estoque: nenhuma reposição falsa');
  assert.ok(!novos.some((m) => /QUEDA/.test(m.title)), 'sem queda falsa');
  assert.equal(novos.filter((m) => /RESTOCK/.test(m.title)).length, 1, 'sem estoque → falha → em estoque: a reposição real continua avisada');
  const act = s.activity.filter((e) => e.t === at(45).toISOString());
  assert.deepEqual(act.map((e) => [e.offerId, e.type]), [[b.id, 'restock']], 'atividade: só a reposição real');
  // histórico consistente: A tem uma linha só (leitura inicial), sem linha "UNKNOWN" nem repetida na volta
  const hA = histRows().filter((r) => r.offerId === a.id);
  assert.equal(hA.length, 1, 'histórico de A sem linha da falha nem duplicada: ' + JSON.stringify(hA));
  const hB = histRows().filter((r) => r.offerId === b.id).map((r) => r.stock);
  assert.deepEqual(hB, ['OUT_OF_STOCK', 'IN_STOCK'], 'histórico de B: só leituras válidas'); }

// sucesso → falha → sucesso com o mesmo preço: nenhuma queda, nenhuma linha nova
const sent1 = sent.length; const h1 = histRows().length;
vt.down = true; await runOnce({ log: quiet, send, now: at(60) });
vt.down = false; s = await runOnce({ log: quiet, send, now: at(75) });
assert.equal(sent.length, sent1, 'sucesso → falha → sucesso: nenhum alerta');
assert.equal(histRows().length, h1, 'sucesso → falha → sucesso: histórico sem linhas novas');
assert.ok(offerOf(s, 'me05-box36').confirmed !== false, 'preço igual segue confirmado');

console.log('OK — coletores (lote 7)');
