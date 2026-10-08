// Permissões do usuário SÓ-LEITURA da API (hunter_api). Quem cria o usuário (com senha) é o dono do projeto no
// SQL Editor do Supabase; este script, rodando como dono das tabelas (hunter_app), só concede leitura.
// Idempotente; se o usuário ainda não existir, não faz nada. Uso: DATABASE_URL=... node tools/db-grants.mjs
import { pool, close } from '../src/db/pg.js';
const ROLE = process.env.API_DB_ROLE || 'hunter_api';
if (!/^[a-z_][a-z0-9_]{1,40}$/.test(ROLE)) { console.error('nome de usuário inválido'); process.exit(1); }
const p = await pool();
try {
  const exists = (await p.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [ROLE])).rowCount > 0;
  if (!exists) { console.log(`Usuário ${ROLE} ainda não existe: API continua no state.json até ele ser criado.`); }
  else {
    await p.query(`GRANT USAGE ON SCHEMA hunter TO ${ROLE}`);
    await p.query(`GRANT SELECT ON ALL TABLES IN SCHEMA hunter TO ${ROLE}`);
    await p.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA hunter GRANT SELECT ON TABLES TO ${ROLE}`);   // tabelas futuras
    // nada de escrita, sequências ou funções
    console.log(`Leitura concedida a ${ROLE} no schema hunter.`);
  }
} catch (e) { console.error('Permissões da API falharam (o robô não é afetado):', e.message); process.exitCode = 1; }
finally { await close(); }
