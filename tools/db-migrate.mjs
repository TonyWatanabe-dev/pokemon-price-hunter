// Aplica db/migrations/*.sql em ordem, uma vez cada (tabela hunter.schema_migrations).
// Uso: DATABASE_URL=... node tools/db-migrate.mjs
import fs from 'node:fs';
import path from 'node:path';
import { pool, close } from '../src/db/pg.js';

const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '../db/migrations');
const p = await pool();
await p.query('CREATE SCHEMA IF NOT EXISTS hunter; CREATE TABLE IF NOT EXISTS hunter.schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
const done = new Set((await p.query('SELECT version FROM hunter.schema_migrations')).rows.map((r) => r.version));
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
  if (done.has(f)) continue;
  const sql = fs.readFileSync(path.join(dir, f), 'utf8');
  const c = await p.connect();
  try {
    await c.query('BEGIN'); await c.query(sql);
    await c.query('INSERT INTO hunter.schema_migrations (version) VALUES ($1)', [f]);
    await c.query('COMMIT'); console.log('aplicada', f);
  } catch (e) { await c.query('ROLLBACK'); console.error('FALHOU', f, e.message); process.exitCode = 1; break; }
  finally { c.release(); }
}
await close();
