// Alertas de preço por usuário (tabela price_alert): toda leitura/escrita filtra por user_id, então um usuário
// nunca lê, edita nem apaga alerta de outro. `c` opcional permite rodar dentro de tx(); sem ele usa o pool.
import { pool } from './pg.js';

export class UserAlertError extends Error {}
const bad = (m) => { throw new UserAlertError(m); };
const MAX_PRICE = 9999999999.99; // numeric(12, 2)
const isId = (v) => Number.isSafeInteger(v) && v > 0;

// Pura: valida e normaliza a entrada de um alerta. active ausente = true (default da tabela).
export function validateUserAlert(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) bad('alerta precisa ser um objeto');
  const { productId, targetPrice, active = true } = input;
  if (!isId(productId)) bad('productId precisa ser inteiro maior que 0');
  if (typeof targetPrice !== 'number' || !Number.isFinite(targetPrice) || targetPrice <= 0 || targetPrice > MAX_PRICE) bad('targetPrice precisa ser número maior que 0');
  if (typeof active !== 'boolean') bad('active precisa ser booleano');
  return { productId, targetPrice, active };
}

const checkUser = (userId) => { if (typeof userId !== 'string' || !userId) bad('userId obrigatório'); };
const checkAlert = (alertId) => { if (!isId(Number(alertId)) || !/^\d+$/.test(String(alertId))) bad('alertId precisa ser inteiro maior que 0'); };
const COLS = 'id::text AS id, product_id::text AS "productId", target_price::float8 AS "targetPrice", active, created_at AS "createdAt"';
const run = async (c, sql, args) => (c || await pool()).query(sql, args);

export async function listAlerts(userId, c) {
  checkUser(userId);
  return (await run(c, `SELECT ${COLS} FROM price_alert WHERE user_id = $1 ORDER BY id`, [userId])).rows;
}

export async function createAlert(userId, input, c) {
  checkUser(userId);
  const a = validateUserAlert(input);
  return (await run(c, `INSERT INTO price_alert (user_id, product_id, target_price, active) VALUES ($1, $2, $3, $4) RETURNING ${COLS}`,
    [userId, a.productId, a.targetPrice, a.active])).rows[0];
}

// Retorna o alerta atualizado, ou null se não existe ou é de outro usuário.
export async function setActive(userId, alertId, active, c) {
  checkUser(userId); checkAlert(alertId);
  if (typeof active !== 'boolean') bad('active precisa ser booleano');
  return (await run(c, `UPDATE price_alert SET active = $3 WHERE id = $1 AND user_id = $2 RETURNING ${COLS}`, [String(alertId), userId, active])).rows[0] || null;
}

// true se apagou; false se não existe ou é de outro usuário.
export async function deleteAlert(userId, alertId, c) {
  checkUser(userId); checkAlert(alertId);
  return (await run(c, `DELETE FROM price_alert WHERE id = $1 AND user_id = $2`, [String(alertId), userId])).rowCount === 1;
}
