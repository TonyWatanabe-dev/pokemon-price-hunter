// Conexão PostgreSQL (Supabase ou qualquer Postgres) só pelo driver padrão `pg`.
// DATABASE_URL ausente = banco desligado: todo o resto do sistema continua funcionando.
// TLS: src/db/ssl.js (CA verificada com PG_CA_CERT; ver docs/tls.md).
import { pgConnectionConfig } from './ssl.js';
let _pool = null;
export const dbEnabled = () => !!process.env.DATABASE_URL;

export async function pool() {
  if (_pool) return _pool;
  if (!dbEnabled()) throw new Error('DATABASE_URL não definido');
  const { default: pg } = await import('pg');
  const url = process.env.DATABASE_URL;
  const { connectionString, ssl } = pgConnectionConfig(url);
  _pool = new pg.Pool({ connectionString, max: 4, ssl, options: '-c search_path=hunter,public' });
  return _pool;
}

export async function tx(fn) {
  const c = await (await pool()).connect();
  try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; }
  catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
  finally { c.release(); }
}

export async function close() { if (_pool) { await _pool.end(); _pool = null; } }
