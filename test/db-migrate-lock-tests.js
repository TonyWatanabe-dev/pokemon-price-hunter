// Trava do migrador (#481): tools/db-migrate.mjs pega pg_advisory_lock numa conexão dedicada antes de ler
// hunter.schema_migrations e libera no finally. Parte estática roda sempre; a corrida real (dois migradores em
// paralelo sobre schema limpo) só com TEST_DATABASE_URL (banco descartável).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'tools/db-migrate.mjs'), 'utf8');

const iLock = src.indexOf('pg_advisory_lock(');
const iRead = src.indexOf('SELECT version FROM hunter.schema_migrations');
const iCreate = src.indexOf('CREATE TABLE IF NOT EXISTS hunter.schema_migrations');
assert.ok(iLock > 0, 'migrador deve usar pg_advisory_lock');
assert.ok(iLock < iCreate && iLock < iRead, 'a trava vem antes de criar/ler schema_migrations');
assert.match(src, /finally\s*\{[^}]*pg_advisory_unlock\(/, 'a trava é liberada no finally');
assert.match(src, /const lock = await p\.connect\(\)/, 'a trava usa uma conexão dedicada');

if (!process.env.TEST_DATABASE_URL) { console.log('db-migrate-lock: estático ok — corrida pulada (sem TEST_DATABASE_URL)'); process.exit(0); }
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const { pool, close } = await import('../src/db/pg.js');
const p = await pool();

function migrate() {
  return new Promise((resolve, reject) => {
    const c = spawn('node', ['tools/db-migrate.mjs'], { cwd: root, env: process.env });
    let err = '';
    c.stderr.on('data', (b) => { err += b; });
    const timer = setTimeout(() => { c.kill(); reject(new Error('db-migrate não terminou em 60 s')); }, 60000);
    c.on('close', (code) => { clearTimeout(timer); resolve({ code, err }); });
  });
}

const files = fs.readdirSync(path.join(root, 'db/migrations')).filter((f) => f.endsWith('.sql')).sort();
await p.query('DROP SCHEMA IF EXISTS hunter CASCADE');
const [a, b] = await Promise.all([migrate(), migrate()]);
assert.equal(a.code, 0, `1º migrador falhou: ${a.err}`);
assert.equal(b.code, 0, `2º migrador falhou: ${b.err}`);
const rows = (await p.query('SELECT version, count(*)::int n FROM hunter.schema_migrations GROUP BY version ORDER BY version')).rows;
assert.deepEqual(rows.map((r) => r.version), files, 'cada migration registrada');
assert.ok(rows.every((r) => r.n === 1), 'cada versão uma única vez');
const held = (await p.query("SELECT count(*)::int n FROM pg_locks WHERE locktype = 'advisory' AND objid = 4810001")).rows[0].n;
assert.equal(held, 0, 'nenhuma trava sobrando');
await close();
console.log('db-migrate-lock: estático + corrida paralela ok');
