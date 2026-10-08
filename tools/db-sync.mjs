// Sincroniza a pasta data/ (estado atual do robô) com o banco. Sem DATABASE_URL, não faz nada.
// Uso: DATABASE_URL=... node tools/db-sync.mjs [pasta-data]
import fs from 'node:fs';
import path from 'node:path';
import { dbEnabled, tx, close } from '../src/db/pg.js';
import { syncState } from '../src/core/sync.js';

if (!dbEnabled()) { console.log('Banco desligado (sem DATABASE_URL): nada a sincronizar.'); process.exit(0); }
const dir = process.argv[2] || 'data';
const state = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
const lines = fs.existsSync(path.join(dir, 'history.jsonl'))
  ? fs.readFileSync(path.join(dir, 'history.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const catalog = JSON.parse(fs.readFileSync(new URL('../config/catalog.json', import.meta.url), 'utf8'));
const t0 = Date.now();
try {
  const s = await tx((c) => syncState(c, { state, catalog, historyLines: lines }));
  console.log(`Banco sincronizado em ${((Date.now() - t0) / 1000).toFixed(1)} s:`, JSON.stringify(s));
} catch (e) {
  console.error('Sincronização com o banco falhou (o site não é afetado):', e.message);
  process.exitCode = 1;
} finally { await close(); }
