// Repositório de alertas por usuário (src/db/user-alerts.js, issue #458). Validação pura sempre roda; a parte de banco
// só roda com TEST_DATABASE_URL (banco descartável) e prova, pela função, que A não lê/edita/apaga alerta de B.
import assert from 'node:assert/strict';
import { validateUserAlert, UserAlertError, listAlerts, createAlert, setActive, deleteAlert } from '../src/db/user-alerts.js';

const rejects = (input) => assert.throws(() => validateUserAlert(input), UserAlertError, JSON.stringify(input));
assert.deepEqual(validateUserAlert({ productId: 7, targetPrice: 199.9 }), { productId: 7, targetPrice: 199.9, active: true });
assert.deepEqual(validateUserAlert({ productId: 7, targetPrice: 0.01, active: false }), { productId: 7, targetPrice: 0.01, active: false });
for (const targetPrice of [-1, 0, 'barato', '10', NaN, Infinity, null, undefined, 1e11]) rejects({ productId: 7, targetPrice });
for (const productId of [0, -3, 1.5, '7', null, undefined, Number.MAX_SAFE_INTEGER + 1]) rejects({ productId, targetPrice: 10 });
for (const active of ['true', 1, null]) rejects({ productId: 7, targetPrice: 10, active });
for (const input of [null, undefined, [], 'x', 5]) rejects(input);
// entrada inválida falha antes de tocar no banco (sem DATABASE_URL não há pool)
await assert.rejects(createAlert('', { productId: 1, targetPrice: 1 }), UserAlertError);
await assert.rejects(setActive('u', 'abc', true), UserAlertError);
await assert.rejects(setActive('u', 1, 'sim'), UserAlertError);
await assert.rejects(deleteAlert('u', '1.5'), UserAlertError);
await assert.rejects(listAlerts(undefined), UserAlertError);
console.log('✓ validateUserAlert: alvo > 0, productId inteiro, active booleano');

if (!process.env.TEST_DATABASE_URL) { console.log('— testes de banco de alertas por usuário pulados (sem TEST_DATABASE_URL)'); process.exit(0); }
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const { pool, tx, close } = await import('../src/db/pg.js');
const { execFileSync } = await import('node:child_process');
const p = await pool();
const q = async (sql, a = []) => (await p.query(sql, a)).rows;
await p.query('DROP SCHEMA IF EXISTS hunter CASCADE');
execFileSync('node', ['tools/db-migrate.mjs'], { env: process.env, stdio: 'pipe' });

const mkUser = async (uid) => (await q(`INSERT INTO app_user (external_uid, email) VALUES ($1, $2) RETURNING id`, [uid, `${uid}@teste.local`]))[0].id;
const mkProduct = async (slug) => Number((await q(`INSERT INTO product (slug, category_id, canonical_name) VALUES ($1, 'other', $1) RETURNING id`, [slug]))[0].id);
const A = await mkUser('ua-a'); const B = await mkUser('ua-b');
const p1 = await mkProduct('ua-p1'); const p2 = await mkProduct('ua-p2');

const a1 = await createAlert(A, { productId: p1, targetPrice: 100 });
const b1 = await createAlert(B, { productId: p1, targetPrice: 55.5 });
assert.deepEqual({ ...a1, createdAt: undefined }, { id: a1.id, productId: String(p1), targetPrice: 100, active: true, createdAt: undefined });
assert.deepEqual((await listAlerts(A)).map((r) => r.id), [a1.id]);
assert.deepEqual((await listAlerts(B)).map((r) => r.id), [b1.id]);

// A tenta desativar e apagar o alerta de B: nada acontece
assert.equal(await setActive(A, b1.id, false), null);
assert.equal(await deleteAlert(A, b1.id), false);
assert.deepEqual(await listAlerts(B), [b1]);

// A mexe só no seu
assert.equal((await setActive(A, a1.id, false)).active, false);
assert.equal((await listAlerts(B))[0].active, true);
assert.equal(await deleteAlert(A, a1.id), true);
assert.deepEqual(await listAlerts(A), []);
assert.deepEqual(await listAlerts(B), [b1]);
assert.equal(await deleteAlert(A, 999999999), false);

// dentro de tx(): falha no meio desfaz a criação
await assert.rejects(tx(async (c) => {
  await createAlert(B, { productId: p2, targetPrice: 10 }, c);
  await createAlert(B, { productId: 999999999, targetPrice: 10 }, c); // FK falha
}), (e) => e.code === '23503');
assert.deepEqual(await listAlerts(B), [b1]);

await close();
console.log('✓ Alertas por usuário no banco: A não lê, edita nem apaga alerta de B');
