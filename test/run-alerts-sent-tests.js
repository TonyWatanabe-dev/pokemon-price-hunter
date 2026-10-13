// alerts-sent.json gravado logo após o dispatch: com fs.renameSync lançando para state.json, runOnce rejeita e os arquivos gravados antes ficam
// documentados (a rodada não é transacional). Offline: coletores simulados (setFetch), sem rede.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
process.env.HUNTER_DOMAIN_DELAY_MS ??= '0';
const http = await import('../src/http.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = (s, status = 200) => new Response(s, { status, headers: { 'content-type': 'text/html' } });
const body = JSON.stringify({ products: [{ title: 'Pokémon Booster Box Caos Ascendente 36 Boosters Copag', handle: 'box-caos', variants: [{ id: 11, price: '359.90', available: true, sku: 'SH-1' }] }] });
http.setFetch(async (url) => { const u = new URL(url); return u.pathname === '/products.json' ? new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }) : html('', 404); });
const keep = Object.fromEntries(['HUNTER_CONFIG_DIR', 'HUNTER_DATA_DIR', 'HUNTER_TIPS', 'HUNTER_CEP', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_SHA', 'GITHUB_EVENT_NAME'].map((k) => [k, process.env[k]]));
const realRename = fs.renameSync;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hunter-wf-'));
try {
  for (const k of ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_SHA', 'GITHUB_EVENT_NAME', 'HUNTER_CEP']) delete process.env[k];
  process.env.HUNTER_CONFIG_DIR = path.join(tmp, 'config'); process.env.HUNTER_DATA_DIR = path.join(tmp, 'data'); process.env.HUNTER_TIPS = '0';
  fs.mkdirSync(process.env.HUNTER_CONFIG_DIR, { recursive: true });
  fs.copyFileSync(path.join(root, 'config/catalog.json'), path.join(tmp, 'config/catalog.json'));
  fs.writeFileSync(path.join(tmp, 'config/stores.json'), JSON.stringify({ stores: [{ id: 'f1', name: 'f1', url: 'https://f1-wf.test', platform: 'shopify', kind: 'specialist', evidence: {} }] }));
  fs.writeFileSync(path.join(tmp, 'config/watchlist.json'), JSON.stringify({ settings: { cep: null }, rules: [{ id: 'alvo', label: 'Alvo', mode: 'target', maxPrice: 100000 }] }));
  const { runOnce } = await import('../src/run.js');
  const D = process.env.HUNTER_DATA_DIR;
  const sentCalls = []; const logs = [];
  const opts = { log: (m) => logs.push(String(m)), send: { capture: async (m) => { sentCalls.push(m); return true; } }, now: new Date('2026-10-06T10:00:00Z') };
  fs.renameSync = (from, to) => { if (path.basename(String(to)) === 'state.json') throw Object.assign(new Error('EIO simulado'), { code: 'EIO' }); return realRename(from, to); };
  await assert.rejects(() => runOnce(opts), /EIO simulado/, 'falha ao gravar state.json derruba a rodada');
  fs.renameSync = realRename;
  const has = (f) => fs.existsSync(path.join(D, f));
  // Já gravados antes do state.json (não há rollback):
  for (const f of ['offers.json', 'review.json', 'sources.json', 'lowest.json', 'products.json', 'alerts-sent.json', 'tips.json', 'inbox.json']) assert.ok(has(f), `${f} já gravado antes da falha`);
  // Não gravados: state.json e tudo o que vem depois dele
  for (const f of ['state.json', 'history.jsonl', 'alerts.jsonl']) assert.ok(!has(f), `${f} não existe após a falha`);
  assert.ok(!has('meta.json') || !('ops' in JSON.parse(fs.readFileSync(path.join(D, 'meta.json'), 'utf8'))), 'estado operacional (meta.json → ops) não foi gravado');
  assert.ok(has('state.json.tmp'), 'documenta: writeJson não limpa o state.json.tmp quando o rename falha');
  assert.ok(!logs.some((l) => /^Fontes ativas/.test(l)), 'a rodada não chega ao resumo final');
  assert.ok(sentCalls.length > 0, 'a rodada enviou ao menos um alerta');
  const sentFile = JSON.parse(fs.readFileSync(path.join(D, 'alerts-sent.json'), 'utf8'));
  assert.ok(Object.keys(sentFile).length > 0, 'alerts-sent.json reflete os envios mesmo com state.json falhando');
  const before = sentCalls.length;
  await runOnce(opts);
  assert.equal(sentCalls.length, before, 'a rodada seguinte não reenvia');
  console.log('run-alerts-sent-tests ok');
} finally {
  fs.renameSync = realRename;
  for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  fs.rmSync(tmp, { recursive: true, force: true });
}
