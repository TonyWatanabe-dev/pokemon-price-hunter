// Conexão de LEITURA para as funções da Vercel (API v1). Driver `pg` padrão, PostgreSQL puro.
// Variável API_DATABASE_URL (usuário só-leitura hunter_api, pooler em modo transação); sem ela, a API usa o state.json.
// Consultas sempre com o schema escrito (hunter.tabela): o pooler em modo transação não guarda search_path.
// TLS: api/_lib/ssl.mjs (cópia idêntica de src/db/ssl.js; CA verificada com PG_CA_CERT; ver docs/tls.md).
import { pgConnectionConfig } from './ssl.mjs';
let _pool = null;
export const apiDbUrl = () => process.env.API_DATABASE_URL || null;
export const apiDbEnabled = () => !!apiDbUrl();

export async function apiPool() {
  if (_pool) return _pool;
  const url = apiDbUrl(); if (!url) throw new Error('API_DATABASE_URL não definido');
  const { default: pg } = await import('pg');
  const { connectionString, ssl } = pgConnectionConfig(url);
  _pool = new pg.Pool({
    connectionString, ssl, max: 2, idleTimeoutMillis: 10000, connectionTimeoutMillis: 4000,
    statement_timeout: 5000, query_timeout: 6000,
    application_name: 'tcgph-api',
  });
  _pool.on('error', () => { _pool = null; });          // conexão caída: a próxima chamada recria
  return _pool;
}
export async function q(sql, params = []) { return (await (await apiPool()).query(sql, params)).rows; }
export async function closeApiPool() { if (_pool) { const p = _pool; _pool = null; await p.end().catch(() => {}); } }
