// Consistência estática das migrations (sem banco): numeração, schema, transação e operações destrutivas conhecidas.
// A aplicação real em PostgreSQL continua em db-tests.js (só com TEST_DATABASE_URL). Ver docs/migrations.md.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const dir = path.join(root, 'db', 'migrations');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
assert.ok(files.length > 0, 'nenhuma migration encontrada');

// nome NNN_descricao.sql, sequência 001..N sem buracos nem repetição (o runner ordena pelo nome)
files.forEach((f, i) => {
  assert.match(f, /^\d{3}_[a-z0-9_]+\.sql$/, `nome fora do padrão: ${f}`);
  assert.equal(Number(f.slice(0, 3)), i + 1, `sequência quebrada em ${f} (esperado ${String(i + 1).padStart(3, '0')})`);
});

// operações destrutivas permitidas, por arquivo: qualquer outra aparição falha o teste e exige revisar docs/migrations.md
const allowed = {
  '004_price_engine.sql': ['DROP TABLE IF EXISTS price_daily', 'DROP TABLE IF EXISTS product_stats'],
  '005_opportunity_engine.sql': ['DROP TABLE IF EXISTS opportunity'],
  '006_reference_kinds.sql': ['DROP VIEW reference_price_current', 'DROP CONSTRAINT product_identifier_kind_check'],
};
const destructive = /\bDROP\s+(?:TABLE(?:\s+IF\s+EXISTS)?|VIEW(?:\s+IF\s+EXISTS)?|COLUMN|SCHEMA|CONSTRAINT|INDEX|TYPE)\s+[\w.]+|\bTRUNCATE\b|\bDELETE\s+FROM\b/gi;

for (const f of files) {
  const raw = fs.readFileSync(path.join(dir, f), 'utf8');
  const sql = raw.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n'); // sem comentários
  // o runner já envolve cada arquivo em BEGIN/COMMIT: transação própria quebraria o rollback
  assert.ok(!/^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION)\b/im.test(sql), `${f}: não use controle de transação (o runner faz)`);
  assert.ok(/^\s*SET\s+search_path\s*=\s*hunter\s*;/im.test(sql), `${f}: falta SET search_path = hunter`);
  assert.ok(!/\bDROP\s+SCHEMA\b/i.test(sql), `${f}: DROP SCHEMA não é permitido em migration`);
  const found = (sql.match(destructive) || []).map((s) => s.replace(/\s+/g, ' ').trim());
  const ok = (allowed[f] || []).map((s) => s.toLowerCase());
  const extra = found.filter((s) => !ok.includes(s.toLowerCase()));
  assert.deepEqual(extra, [], `${f}: operação destrutiva fora da lista conhecida: ${extra.join('; ')}`);
  const missing = ok.filter((s) => !found.some((x) => x.toLowerCase() === s));
  assert.deepEqual(missing, [], `${f}: lista de destrutivas desatualizada: ${missing.join('; ')}`);
}

// o inventário documentado cita todas as migrations
const doc = fs.readFileSync(path.join(root, 'docs', 'migrations.md'), 'utf8');
for (const f of files) assert.ok(doc.includes(f), `docs/migrations.md não cita ${f}`);

console.log(`OK — migrations estáticas: ${files.length} arquivos, sequência, schema e destrutivas conferidos`);
