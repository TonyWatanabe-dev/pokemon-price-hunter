// Fotografia do Opportunity Engine (somente leitura): por oferta avaliada, referência atual, mercado, fontes, sinais, score,
// faixa, confiança e avisos. Serve de linha de base imutável para comparar versões do motor (ex.: v2 → v2.1).
// Uso: DATABASE_URL=... node tools/opportunity-snapshot.mjs <saida.json> [rótulo]
import fs from 'node:fs';
import { pool, close } from '../src/db/pg.js';

const [out = 'opportunity-snapshot.json', label = 'snapshot'] = process.argv.slice(2);
if (!process.env.DATABASE_URL) { console.log('Sem banco: nada a fotografar.'); process.exit(0); }
const p = await pool();
const rows = (await p.query(`
  SELECT pr.legacy_id AS product, f.legacy_id AS offer, f.store_id AS store, f.marketplace_id AS marketplace,
         se.external_id AS seller, f.stock_status AS stock, o.price::float8 AS price,
         s.reference_kind AS ref_kind, s.reference_price::float8 AS ref_price, s.reference_reason AS ref_reason, s.reference_confidence::float8 AS ref_confidence,
         s.quality->'market_reference' AS market_reference, s.number_of_in_stock_offers AS in_stock, s.number_of_stores AS stores,
         o.opportunity_score AS score, o.opportunity_band AS band, o.confidence::float8 AS confidence,
         o.reference_signal::float8 AS s_reference, o.market_signal::float8 AS s_market, o.price_signal::float8 AS s_price,
         o.historical_signal::float8 AS s_historical, o.freight_signal::float8 AS s_freight, o.reliability_signal::float8 AS s_reliability,
         o.reference_kind AS opp_ref_kind, o.reference_value::float8 AS opp_ref_value, o.reference_gap::float8 AS opp_ref_gap,
         o.raw_score::float8 AS raw, o.coverage::float8 AS coverage, o.caps, o.is_anomaly AS anomaly,
         (SELECT jsonb_agg(x->>'code') FROM jsonb_array_elements(o.warnings) x) AS warnings,
         (SELECT jsonb_agg(x->>'code') FROM jsonb_array_elements(o.reasons) x) AS reasons,
         (po.offer_id IS NOT NULL) AS is_best, o.engine_version AS engine, o.calculated_at
    FROM hunter.opportunity o
    JOIN hunter.offer f ON f.id = o.offer_id JOIN hunter.product pr ON pr.id = o.product_id
    LEFT JOIN hunter.seller se ON se.id = f.seller_id
    LEFT JOIN hunter.product_stats s ON s.product_id = o.product_id
    LEFT JOIN hunter.product_opportunity po ON po.offer_id = o.offer_id
   ORDER BY pr.legacy_id, f.legacy_id`)).rows;
await close();
const engines = [...new Set(rows.map((r) => r.engine))];
const doc = { label, taken_at: new Date().toISOString(), engines, offers: rows.length, products: new Set(rows.map((r) => r.product)).size,
  note: 'Fotografia imutável: não editar. Gerada por tools/opportunity-snapshot.mjs.', rows };
fs.writeFileSync(out, JSON.stringify(doc));
console.log(JSON.stringify({ label, offers: rows.length, products: doc.products, engines }));
