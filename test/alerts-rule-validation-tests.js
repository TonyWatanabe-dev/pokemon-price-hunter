// Validação de regra em POST /watchlist e /alerts (issue #342): inválida => 400; regras válidas existentes => 201.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { spawn } from 'node:child_process';
const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'rule-cfg-')); const data = fs.mkdtempSync(path.join(os.tmpdir(), 'rule-data-'));
const real = JSON.parse(fs.readFileSync(new URL('../config/watchlist.json', import.meta.url), 'utf8'));
fs.writeFileSync(path.join(cfg, 'watchlist.json'), JSON.stringify({ settings: {}, rules: [] }));
const port = 20000 + Math.floor(Math.random() * 20000);
const child = spawn(process.execPath, [new URL('../src/server.js', import.meta.url).pathname], { env: { ...process.env, PORT: String(port), HUNTER_CONFIG_DIR: cfg, HUNTER_DATA_DIR: data }, stdio: ['ignore', 'pipe', 'ignore'] });
try {
  await new Promise((ok, bad) => { child.stdout.on('data', ok); child.on('exit', () => bad(new Error('servidor não subiu'))); setTimeout(() => bad(new Error('timeout')), 10000); });
  const post = async (rule) => { const r = await fetch(`http://localhost:${port}/watchlist`, { method: 'POST', body: JSON.stringify(rule) }); return { status: r.status, body: await r.json() }; };
  let n = 0;
  for (const rule of real.rules) { const r = await post(rule); assert.equal(r.status, 201, `regra existente ${rule.id}`); n++; }
  const inv = [
    { id: 'a', filter: {}, maxPrice: -1 }, { id: 'a', filter: {}, maxPrice: 'barato' }, { id: 'a', filter: {}, mode: 'xyz', maxPrice: 10 },
    { id: 'a', filter: {}, minDiscount: 1.5 }, { id: 'a', filter: {}, minOpportunityScore: 101 }, { id: 'a', filter: {}, restock: 'sim' },
  ];
  for (const rule of inv) { const r = await post(rule); assert.equal(r.status, 400, JSON.stringify(rule)); n++; }
  const semCriterio = await post({ id: 'a', filter: { productType: 'etb' } });
  assert.equal(semCriterio.status, 400); assert.match(semCriterio.body.error, /critério/); n++;
  assert.equal((await post({ id: 'a', filter: {} })).status, 400); n++;
  assert.equal((await post({ filter: {}, maxPrice: 5 })).status, 400); n++;
  const saved = JSON.parse(fs.readFileSync(path.join(cfg, 'watchlist.json'), 'utf8'));
  assert.equal(saved.rules.length, real.rules.length, 'regra inválida não é gravada');
  console.log(`alerts-rule-validation-tests: ${n} ok`);
} finally { child.kill(); }
