// Isolamento entre usuários no PostgreSQL real (favoritos, alertas, entregas): só roda com TEST_DATABASE_URL (banco descartável).
// Nunca usa banco ou credencial de produção. Cobre: A não lê/edita/apaga recurso de B, rollback e cascata na limpeza.
import assert from 'node:assert/strict';
if (!process.env.TEST_DATABASE_URL) { console.log('— testes de isolamento entre usuários pulados (sem TEST_DATABASE_URL)'); process.exit(0); }
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const { pool, tx, close } = await import('../src/db/pg.js');
const { execFileSync } = await import('node:child_process');
const p = await pool();
const q = async (sql, a = []) => (await p.query(sql, a)).rows;
await p.query('DROP SCHEMA IF EXISTS hunter CASCADE');
execFileSync('node', ['tools/db-migrate.mjs'], { env: process.env, stdio: 'pipe' });

let n = 0;
const t = async (name, fn) => { await fn(); n++; };
const mkUser = async (uid) => (await q(`INSERT INTO app_user (external_uid, email) VALUES ($1, $2) RETURNING id`, [uid, `${uid}@teste.local`]))[0].id;
const mkProduct = async (slug) => (await q(`INSERT INTO product (slug, category_id, canonical_name) VALUES ($1, 'other', $1) RETURNING id`, [slug]))[0].id;

// operações "do app": sempre filtradas pelo dono, como o código de produção deve fazer
const favsOf = async (u) => (await q(`SELECT product_id::text AS p FROM favorite WHERE user_id = $1 ORDER BY product_id`, [u])).map((r) => r.p);
const alertsOf = async (u) => q(`SELECT id::text, product_id::text AS p, target_price::float AS price, active FROM price_alert WHERE user_id = $1 ORDER BY id`, [u]);
const guardedCounts = async () => JSON.stringify(await Promise.all(['product', 'offer', 'price_history'].map((tb) => q(`SELECT count(*)::int c FROM ${tb}`))));

const A = await mkUser('iso-a'); const B = await mkUser('iso-b');
const p1 = await mkProduct('iso-p1'); const p2 = await mkProduct('iso-p2'); const p3 = await mkProduct('iso-p3');
const before = await guardedCounts();

await t('favoritos: cada usuário lê só os seus; o mesmo produto pode ser favorito dos dois', async () => {
  await q(`INSERT INTO favorite (user_id, product_id) VALUES ($1, $2), ($1, $3), ($4, $3)`, [A, p1, p2, B]);
  assert.deepEqual(await favsOf(A), [String(p1), String(p2)]);
  assert.deepEqual(await favsOf(B), [String(p2)]);
});

await t('favoritos: duplicado do mesmo usuário é recusado; A não apaga favorito de B', async () => {
  await assert.rejects(q(`INSERT INTO favorite (user_id, product_id) VALUES ($1, $2)`, [A, p1]), (e) => e.code === '23505');
  const del = await p.query(`DELETE FROM favorite WHERE user_id = $1 AND product_id = $2`, [A, p3]); // p3 nunca foi de A
  assert.equal(del.rowCount, 0);
  const own = await p.query(`DELETE FROM favorite WHERE user_id = $1 AND product_id = $2`, [A, p2]);
  assert.equal(own.rowCount, 1);
  assert.deepEqual(await favsOf(B), [String(p2)], 'favorito de B intacto');
  assert.deepEqual(await favsOf(A), [String(p1)]);
});

await t('favoritos: usuário e produto inexistentes são recusados (FK)', async () => {
  await assert.rejects(q(`INSERT INTO favorite (user_id, product_id) VALUES ($1, $2)`, [A, 999999]), (e) => e.code === '23503');
  await assert.rejects(q(`INSERT INTO favorite (user_id, product_id) VALUES (gen_random_uuid(), $1)`, [p1]), (e) => e.code === '23503');
});

let alertA; let alertB;
await t('alertas: A não lê, edita nem apaga alerta de B', async () => {
  alertA = (await q(`INSERT INTO price_alert (user_id, product_id, target_price) VALUES ($1, $2, 100) RETURNING id`, [A, p1]))[0].id;
  alertB = (await q(`INSERT INTO price_alert (user_id, product_id, target_price) VALUES ($1, $2, 55.5) RETURNING id`, [B, p1]))[0].id;
  assert.deepEqual((await alertsOf(A)).map((r) => r.id), [String(alertA)]);
  assert.deepEqual((await alertsOf(B)).map((r) => r.id), [String(alertB)]);
  const upd = await p.query(`UPDATE price_alert SET target_price = 1, active = false WHERE id = $1 AND user_id = $2`, [alertB, A]);
  assert.equal(upd.rowCount, 0);
  const del = await p.query(`DELETE FROM price_alert WHERE id = $1 AND user_id = $2`, [alertB, A]);
  assert.equal(del.rowCount, 0);
  const b = (await alertsOf(B))[0];
  assert.equal(b.price, 55.5); assert.equal(b.active, true);
  const mine = await p.query(`UPDATE price_alert SET target_price = 90 WHERE id = $1 AND user_id = $2`, [alertA, A]);
  assert.equal(mine.rowCount, 1);
  assert.equal((await alertsOf(B))[0].price, 55.5, 'editar o meu não mexe no de B');
});

await t('entregas: o histórico de avisos de A só traz entregas de alertas de A; sem repetir no mesmo dia', async () => {
  await q(`INSERT INTO alert_delivery (alert_id, channel) VALUES ($1, 'email'), ($2, 'email')`, [alertA, alertB]);
  const own = await q(`SELECT d.alert_id::text AS a FROM alert_delivery d JOIN price_alert a ON a.id = d.alert_id WHERE a.user_id = $1`, [A]);
  assert.deepEqual(own.map((r) => r.a), [String(alertA)]);
  await assert.rejects(q(`INSERT INTO alert_delivery (alert_id, channel) VALUES ($1, 'email')`, [alertA]), (e) => e.code === '23505');
});

await t('rollback: falha no meio de uma gravação em lote não deixa nada para trás', async () => {
  const favs = (await q(`SELECT count(*)::int c FROM favorite`))[0].c; const als = (await q(`SELECT count(*)::int c FROM price_alert`))[0].c;
  await assert.rejects(tx(async (c) => {
    await c.query(`INSERT INTO favorite (user_id, product_id) VALUES ($1, $2)`, [B, p1]);
    await c.query(`INSERT INTO price_alert (user_id, product_id, target_price) VALUES ($1, $2, 10)`, [B, p3]);
    await c.query(`INSERT INTO price_alert (user_id, product_id, target_price) VALUES ($1, $2, 10)`, [B, 999999]); // FK falha
  }), (e) => e.code === '23503');
  assert.equal((await q(`SELECT count(*)::int c FROM favorite`))[0].c, favs);
  assert.equal((await q(`SELECT count(*)::int c FROM price_alert`))[0].c, als);
});

await t('rollback: um único comando com linha inválida é atômico (nenhuma linha entra)', async () => {
  const favs = await favsOf(B);
  await assert.rejects(q(`INSERT INTO favorite (user_id, product_id) VALUES ($1, $2), ($1, 999999)`, [B, p3]), (e) => e.code === '23503');
  assert.deepEqual(await favsOf(B), favs);
});

await t('limpeza: apagar A leva em cascata só os dados de A; B e o catálogo ficam intactos', async () => {
  await q(`INSERT INTO user_role (user_id, role_id) VALUES ($1, 'VIEWER')`, [A]);
  await q(`DELETE FROM app_user WHERE id = $1`, [A]);
  for (const tb of ['favorite', 'price_alert', 'user_role']) assert.equal((await q(`SELECT count(*)::int c FROM ${tb} WHERE user_id = $1`, [A]))[0].c, 0, tb);
  assert.equal((await q(`SELECT count(*)::int c FROM alert_delivery WHERE alert_id = $1`, [alertA]))[0].c, 0);
  assert.deepEqual((await alertsOf(B)).map((r) => r.id), [String(alertB)]);
  assert.equal((await q(`SELECT count(*)::int c FROM alert_delivery WHERE alert_id = $1`, [alertB]))[0].c, 1);
  assert.deepEqual(await favsOf(B), [String(p2)]);
  assert.equal(await guardedCounts(), before, 'catálogo/ofertas/histórico não mudam');
});

await close();
console.log(`✓ Isolamento entre usuários no banco: ${n} grupos passaram`);
