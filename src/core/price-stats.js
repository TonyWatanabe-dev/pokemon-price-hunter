// Price Engine → banco. Carrega as entradas (product, offer, price_history, stock_event, reference_price,
// source_distrust), chama o motor puro e grava price_daily e product_stats de forma idempotente:
// só escreve linha que mudou (IS DISTINCT FROM). Não lê nada de afiliado. Não altera price_history.
import { computeProductStats, ENGINE_VERSION } from './price-engine.js';

const J = (v) => JSON.stringify(v);
export const STATS_COLS = {
  as_of_day: 'date', data_status: 'text', current_price: 'numeric', current_offer_id: 'bigint', current_total_price: 'numeric', current_total_offer_id: 'bigint',
  lowest_current_price: 'numeric', highest_current_price: 'numeric', average_price: 'numeric', median_price: 'numeric',
  history_days: 'int', history_from: 'date', history_status: 'text', historical_min: 'numeric', historical_max: 'numeric', historical_average: 'numeric', historical_median: 'numeric',
  variation_24h: 'numeric', variation_7d: 'numeric', variation_30d: 'numeric', distance_from_historical_average: 'numeric', distance_from_historical_min: 'numeric',
  reference_price: 'numeric', reference_status: 'text', reference_source: 'text', reference_kind: 'text', reference_verified_at: 'timestamptz', discount_vs_reference: 'numeric',
  number_of_active_offers: 'int', number_of_in_stock_offers: 'int', number_of_stores: 'int', number_of_marketplaces: 'int', shipping_coverage: 'numeric',
  quality: 'jsonb', engine_version: 'text',
};

export async function loadInputs(c) {
  const q = async (sql) => (await c.query(sql)).rows;
  const sqls = [
    `SELECT id, condition FROM product ORDER BY id`,
    `SELECT id, product_id, store_id, marketplace_id, status, condition, confirmed, price::float8 AS price, stock_status, shipping_status,
         total_price::float8 AS total_price, last_seen_at FROM offer`,
    `SELECT offer_id, observed_at AS t, price::float8 AS price, stock_status FROM price_history`,
    `SELECT offer_id, observed_at AS t FROM stock_event WHERE to_status = 'removed'`,
    // referência ATUAL (Fase 5.6): só tipos atuais (Copag atual > mercado atual). Histórico (preço de lançamento) e comunitária
    // NUNCA entram aqui. Verificada primeiro (mesma ordem da view reference_price_current); sem verificada, a pendente é só exibida.
    `SELECT DISTINCT ON (product_id) product_id, value::float8 AS value, verification_status AS status, source, verified_at, reference_kind AS kind
         FROM reference_price WHERE reference_scope = 'current'
        ORDER BY product_id, (verification_status = 'verified') DESC, CASE reference_kind WHEN 'COPAG_OFFICIAL_CURRENT' THEN 1 ELSE 2 END,
                 confidence DESC, verified_at DESC NULLS LAST, id DESC`,
    `SELECT store_id, until_day::text AS until FROM source_distrust`,
  ];
  const out = []; for (const sql of sqls) out.push(await q(sql));   // um cliente = uma consulta por vez
  return { products: out[0], offers: out[1], hist: out[2], removed: out[3], refs: out[4], dist: out[5] };
}

export function computeAll({ products, offers, hist, removed, refs, dist }, asOf) {
  const distrust = new Map(dist.map((d) => [d.store_id, d.until]));
  const ev = new Map();
  for (const h of hist) { const k = String(h.offer_id); if (!ev.has(k)) ev.set(k, []); ev.get(k).push({ t: h.t, price: h.price, stock_status: h.stock_status }); }
  for (const r of removed) { const k = String(r.offer_id); if (!ev.has(k)) ev.set(k, []); ev.get(k).push({ t: r.t, removed: true }); }
  const byProduct = new Map();
  for (const o of offers) { const k = String(o.product_id); if (!byProduct.has(k)) byProduct.set(k, []); byProduct.get(k).push({ ...o, id: String(o.id), events: ev.get(String(o.id)) || [] }); }
  const refBy = new Map(refs.map((r) => [String(r.product_id), r]));
  return products.map((p) => {
    const { stats, series, storeSeries } = computeProductStats({ product: p, offers: byProduct.get(String(p.id)) || [], reference: refBy.get(String(p.id)) || null, distrust, asOf });
    return { product_id: String(p.id), stats, series, storeSeries };
  });
}

/** Calcula e grava. Retorna contagens do que mudou. */
export async function runPriceEngine(c, { asOf = new Date() } = {}) {
  const t0 = Date.now();
  const inputs = await loadInputs(c);
  const all = computeAll(inputs, asOf);
  const cols = Object.keys(STATS_COLS);
  const rows = all.map((r) => ({ product_id: r.product_id, ...r.stats, reference_verified_at: r.stats.reference_verified_at ? new Date(r.stats.reference_verified_at).toISOString() : null }));
  const st = await c.query(`INSERT INTO product_stats (product_id, ${cols.join(', ')})
    SELECT product_id, ${cols.join(', ')} FROM jsonb_to_recordset($1::jsonb) AS x(product_id bigint, ${cols.map((k) => `${k} ${STATS_COLS[k]}`).join(', ')})
    ON CONFLICT (product_id) DO UPDATE SET ${cols.map((k) => `${k} = EXCLUDED.${k}`).join(', ')}, computed_at = now()
    WHERE (${cols.map((k) => `product_stats.${k}`).join(', ')}) IS DISTINCT FROM (${cols.map((k) => `EXCLUDED.${k}`).join(', ')})`, [J(rows)]);
  const row = (r, store, d) => ({ product_id: r.product_id, store_id: store, day: d.day, min_price: d.min, max_price: d.max, avg_price: d.avg, close_price: d.close, offers: d.offers });
  // store_id '' = produto (todas as lojas); demais = uma série por loja
  const daily = all.flatMap((r) => [...r.series.map((d) => row(r, '', d)), ...Object.entries(r.storeSeries || {}).flatMap(([sid, ss]) => ss.map((d) => row(r, sid, d)))]);
  const dd = await c.query(`INSERT INTO price_daily (product_id, store_id, day, min_price, max_price, avg_price, close_price, offers, engine_version)
    SELECT product_id, store_id, day, min_price, max_price, avg_price, close_price, offers, $2 FROM jsonb_to_recordset($1::jsonb)
      AS x(product_id bigint, store_id text, day date, min_price numeric, max_price numeric, avg_price numeric, close_price numeric, offers int)
    ON CONFLICT (product_id, store_id, day) DO UPDATE SET min_price = EXCLUDED.min_price, max_price = EXCLUDED.max_price, avg_price = EXCLUDED.avg_price,
      close_price = EXCLUDED.close_price, offers = EXCLUDED.offers, engine_version = EXCLUDED.engine_version
    WHERE (price_daily.min_price, price_daily.max_price, price_daily.avg_price, price_daily.close_price, price_daily.offers, price_daily.engine_version)
      IS DISTINCT FROM (EXCLUDED.min_price, EXCLUDED.max_price, EXCLUDED.avg_price, EXCLUDED.close_price, EXCLUDED.offers, EXCLUDED.engine_version)`, [J(daily), ENGINE_VERSION]);
  // dia que deixou de existir na série (ex.: nova janela de desconfiança) sai da tabela derivada
  const gone = await c.query(`DELETE FROM price_daily p WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_to_recordset($1::jsonb) AS x(product_id bigint, store_id text, day date) WHERE x.product_id = p.product_id AND x.store_id = p.store_id AND x.day = p.day)`,
    [J(daily.map((d) => ({ product_id: d.product_id, store_id: d.store_id, day: d.day })))]);
  return { products: rows.length, statsWritten: st.rowCount, dailyRows: daily.length, dailyWritten: dd.rowCount, dailyDeleted: gone.rowCount, seconds: (Date.now() - t0) / 1000 };
}
