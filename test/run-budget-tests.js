// Prazo da rodada (HUNTER_BUDGET_MIN): com orçamento ínfimo, as lojas que começam depois do prazo vão para `skipped`,
// não são coletadas e o log "ficaram para a próxima rodada" sai. Offline: fetch simulado (setFetch), sem rede.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
process.env.HUNTER_DOMAIN_DELAY_MS ??= '0'; // antes de carregar o cliente HTTP (o intervalo é lido na importação)
const http = await import('../src/http.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const html = (s, status = 200) => new Response(s, { status, headers: { 'content-type': 'text/html' } });
const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const calls = {};
http.setFetch(async (url) => {
  const u = new URL(url);
  (calls[u.host] ||= []).push(u.pathname);
  if (u.pathname === '/robots.txt') return html('', 404);
  await sleep(25); // a 1ª loja consome o prazo ínfimo; as seguintes começam depois dele
  if (u.pathname === '/products.json') return json({ products: [] });
  return html('', 404);
});

const keep = Object.fromEntries(['HUNTER_CONFIG_DIR', 'HUNTER_DATA_DIR', 'HUNTER_TIPS', 'HUNTER_CEP', 'HUNTER_BUDGET_MIN', 'HUNTER_CONCURRENCY'].map((k) => [k, process.env[k]]));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hunter-budget-'));
try {
  process.env.HUNTER_CONFIG_DIR = path.join(tmp, 'config'); process.env.HUNTER_DATA_DIR = path.join(tmp, 'data'); process.env.HUNTER_TIPS = '0';
  delete process.env.HUNTER_CEP;
  process.env.HUNTER_BUDGET_MIN = '0.000001'; // ~60 µs
  process.env.HUNTER_CONCURRENCY = '1'; // uma loja por vez: a ordem do prazo fica determinística
  fs.mkdirSync(process.env.HUNTER_CONFIG_DIR, { recursive: true });
  fs.copyFileSync(path.join(root, 'config/catalog.json'), path.join(tmp, 'config/catalog.json'));
  const ids = ['b1', 'b2', 'b3', 'b4'];
  const S = (id) => ({ id, name: id, url: `https://${id}-budget.test`, platform: 'shopify', kind: 'specialist', evidence: {} });
  fs.writeFileSync(path.join(tmp, 'config/stores.json'), JSON.stringify({ stores: ids.map(S) }));
  fs.writeFileSync(path.join(tmp, 'config/watchlist.json'), JSON.stringify({ settings: { cep: null }, rules: [] }));
  const { runOnce } = await import('../src/run.js');
  const logs = [];
  await runOnce({ log: (m) => logs.push(String(m)), send: { capture: async () => true }, now: new Date() });
  const src = JSON.parse(fs.readFileSync(path.join(tmp, 'data/sources.json'), 'utf8'));
  const coletadas = ids.filter((id) => src[id]?.checks > 0);
  const puladas = ids.filter((id) => !src[id]?.checks);
  assert.ok(coletadas.length <= 1, `só a loja que começou antes do prazo coleta: ${coletadas}`);
  assert.ok(puladas.length >= 3, `as demais vão para skipped: ${puladas}`);
  for (const id of puladas) assert.equal((calls[`${id}-budget.test`] || []).length, 0, `${id} pulada não faz requisição`);
  const linha = logs.find((l) => /ficaram para a próxima rodada/.test(l));
  assert.ok(linha, 'log do prazo da rodada');
  assert.match(linha, new RegExp(`^${puladas.length} lojas ficaram para a próxima rodada`));
  console.log('run-budget-tests ok');
} finally {
  for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  fs.rmSync(tmp, { recursive: true, force: true });
}
