// Consistência estática dos rollbacks manuais (sem banco): db/rollback/ fica fora do migrador e nunca roda sozinho.
// Cada arquivo segue NNN_descricao.down.sql, corresponde a uma migration existente e é citado em docs/migrations.md.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const dir = path.join(root, 'db', 'rollback');
const migrations = new Set(fs.readdirSync(path.join(root, 'db', 'migrations')));
const files = fs.readdirSync(dir).sort();
const doc = fs.readFileSync(path.join(root, 'docs', 'migrations.md'), 'utf8');

for (const f of files) {
  assert.match(f, /^\d{3}_[a-z0-9_]+\.down\.sql$/, `db/rollback/${f}: nome fora do padrão NNN_descricao.down.sql`);
  const migration = f.replace(/\.down\.sql$/, '.sql');
  assert.ok(migrations.has(migration), `db/rollback/${f}: não existe db/migrations/${migration}`);
  const raw = fs.readFileSync(path.join(dir, f), 'utf8');
  const sql = raw.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n'); // sem comentários
  assert.ok(/^\s*SET\s+search_path\s*=\s*hunter\s*;/im.test(sql), `db/rollback/${f}: falta SET search_path = hunter`);
  // a transação fica com quem aplica (psql -1); BEGIN/COMMIT/ROLLBACK no arquivo quebraria isso
  assert.ok(!/\b(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION)\b/i.test(sql), `db/rollback/${f}: não use controle de transação`);
  assert.ok(doc.includes(f), `docs/migrations.md não cita db/rollback/${f}`);
}

console.log(`OK — rollbacks estáticos: ${files.length} arquivos, nome, migration, schema, transação e doc conferidos`);
