// Garante a partição mensal de price_history antes de inserir (Postgres puro, sem plpgsql).
const made = new Set();
const ym = (d) => d.toISOString().slice(0, 7);
export async function ensureMonth(client, date) {
  const d = new Date(date); const key = ym(d);
  if (made.has(key)) return;
  const s = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const e = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  const name = `price_history_${key.replace('-', '_')}`;
  const r = await client.query('SELECT to_regclass($1) AS t', [`hunter.${name}`]);
  if (!r.rows[0].t) await client.query(`CREATE TABLE IF NOT EXISTS hunter.${name} PARTITION OF hunter.price_history FOR VALUES FROM ('${s.toISOString().slice(0, 10)}') TO ('${e.toISOString().slice(0, 10)}')`);
  made.add(key);
}
