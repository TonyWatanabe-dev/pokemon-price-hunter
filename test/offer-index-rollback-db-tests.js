// Rollback da migration 011 (índice offer_product_status_idx) no PostgreSQL real.
// Só roda com TEST_DATABASE_URL (banco descartável; o CI usa o PostgreSQL de serviço). Nunca o banco de produção.
// Cobre: o migrador cria o índice; db/rollback/011_offer_product_status_index.down.sql o remove (e é reaplicável);
// sem o DELETE em schema_migrations o migrador NÃO recria o índice; com o DELETE documentado no rollback, recria.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';

if (!process.env.TEST_DATABASE_URL) {
  console.log('— testes de banco do rollback da migration 011 (índice de ofertas) pulados (sem TEST_DATABASE_URL)');
} else {
  await run();
}

async function run() {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { pool, close } = await import('../src/db/pg.js');
  const { execFileSync } = await import('node:child_process');

  const MIG = '011_offer_product_status_index.sql';
  const IDX = 'offer_product_status_idx';
  const migDir = path.join(root, 'db/migrations');
  const downSql = fs.readFileSync(path.join(root, 'db/rollback/011_offer_product_status_index.down.sql'), 'utf8');
  const p = await pool();
  const q = async (sql, a = []) => (await p.query(sql, a)).rows;
  let n = 0;
  const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };
  const migrate = () => execFileSync('node', ['tools/db-migrate.mjs'], { env: process.env, cwd: root, encoding: 'utf8' });
  const idx = async () => (await q(`SELECT indexdef FROM pg_indexes WHERE schemaname = 'hunter' AND tablename = 'offer' AND indexname = $1`, [IDX]))[0]?.indexdef ?? null;
  const applied = async () => (await q(`SELECT 1 FROM hunter.schema_migrations WHERE version = $1`, [MIG])).length === 1;

  // banco limpo: o migrador aplica 001..011 (e as posteriores, se houver)
  await p.query('DROP SCHEMA IF EXISTS hunter CASCADE');
  migrate();

  try {
    await t('1. depois do migrador, offer_product_status_idx existe em pg_indexes (product_id, status)', async () => {
      assert.ok(fs.existsSync(path.join(migDir, MIG)), `${MIG} em db/migrations`);
      assert.ok(!fs.readdirSync(migDir).some((f) => /down|rollback/i.test(f)), 'o migrador nunca vê o rollback');
      assert.ok(await applied(), '011 registrada em schema_migrations');
      assert.match(await idx() ?? '', /ON hunter\.offer USING btree \(product_id, status\)/);
    });

    await t('2. aplicar o .down.sql remove o índice, sem mexer em schema_migrations; reaplicar é no-op', async () => {
      await p.query(downSql);
      assert.equal(await idx(), null, 'índice removido');
      assert.ok(await applied(), 'o rollback não apaga o registro da 011');
      await p.query(downSql);
      assert.equal(await idx(), null, 'rollback reaplicável (DROP INDEX IF EXISTS)');
    });

    await t('3. sem o DELETE em schema_migrations, o migrador NÃO recria o índice', async () => {
      assert.doesNotMatch(migrate(), /aplicada/);
      assert.equal(await idx(), null);
    });

    await t('4. com o DELETE documentado no rollback, o migrador recria o índice', async () => {
      assert.match(downSql, /DELETE FROM hunter\.schema_migrations WHERE version\s*=\s*'011_offer_product_status_index\.sql'/);
      await p.query(`DELETE FROM hunter.schema_migrations WHERE version = $1`, [MIG]);
      assert.match(migrate(), new RegExp(`aplicada ${MIG.replace(/\./g, '\\.')}`));
      assert.match(await idx() ?? '', /ON hunter\.offer USING btree \(product_id, status\)/);
      assert.ok(await applied(), '011 registrada de novo');
    });
  } finally {
    await close();
  }
  console.log(`✓ Rollback da migration 011 (índice offer_product_status_idx): ${n} grupos de testes passaram (PostgreSQL)`);
}
