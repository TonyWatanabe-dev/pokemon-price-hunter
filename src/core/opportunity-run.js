// Opportunity Engine → banco. Lê product_stats (fatos do Price Engine) e o contexto das ofertas, avalia cada oferta
// e grava em opportunity de forma idempotente (só escreve o que mudou). Eventos de transição vão para system_event.
// Não lê afiliado. Não recalcula estatística de preço.
import { productOpportunity, eventsFor, OPP_VERSION } from './opportunity-engine.js';

const J = (v) => JSON.stringify(v);
const COLS = { product_id: 'bigint', opportunity_score: 'smallint', opportunity_band: 'text', confidence: 'numeric', price: 'numeric',
  price_signal: 'numeric', historical_signal: 'numeric', reference_signal: 'numeric', stock_signal: 'numeric', freight_signal: 'numeric',
  market_signal: 'numeric', reliability_signal: 'numeric', raw_score: 'numeric', coverage: 'numeric', caps: 'jsonb', reasons: 'jsonb', warnings: 'jsonb',
  is_anomaly: 'boolean', engine_version: 'text' };

export async function loadOpportunityInputs(c) {
  const q = async (sql) => (await c.query(sql)).rows;
  const stats = await q(`SELECT s.*, p.legacy_id FROM product_stats s JOIN product p ON p.id = s.product_id`);
  const offers = await q(`
    SELECT o.id, o.product_id, o.price::float8 AS price, o.total_price::float8 AS total_price, o.shipping_status, o.shipping_price::float8 AS shipping_price,
           o.stock_status, o.status, o.confirmed, o.anomalous, st.ra_status, se.is_official
      FROM offer o JOIN product p ON p.id = o.product_id
      LEFT JOIN store st ON st.id = o.store_id LEFT JOIN seller se ON se.id = o.seller_id
     WHERE o.status IN ('active', 'pending') AND o.condition = p.condition`);
  const prevBest = await q(`SELECT product_id, offer_id, opportunity_score, opportunity_band, price::float8 AS price FROM product_opportunity`);
  const prevAnom = await q(`SELECT offer_id FROM opportunity WHERE is_anomaly`);
  return { stats, offers, prevBest, prevAnom };
}

export function computeOpportunities({ stats, offers }, { now = new Date() } = {}) {
  const byP = new Map();
  for (const o of offers) { const k = String(o.product_id); if (!byP.has(k)) byP.set(k, []); byP.get(k).push(o); }
  const out = [];
  for (const s of stats) {
    const list = (byP.get(String(s.product_id)) || []).map((o) => ({ id: String(o.id), price: o.price, total_price: o.total_price, shipping_status: o.shipping_status,
      shipping_price: o.shipping_price, stock_status: o.stock_status, status: o.status, confirmed: o.confirmed, anomalous: o.anomalous,
      store: { ra_status: o.ra_status }, seller: { is_official: !!o.is_official } }));
    const r = productOpportunity(s, list, { now });
    out.push({ product_id: String(s.product_id), legacy_id: s.legacy_id, ...r });
  }
  return out;
}

export async function runOpportunityEngine(c, { now = new Date(), emitEvents = true } = {}) {
  const t0 = Date.now();
  const inp = await loadOpportunityInputs(c);
  const res = computeOpportunities(inp, { now });
  const rows = res.flatMap((r) => r.offers.filter((o) => o.opportunity_score != null).map((o) => ({ offer_id: o.offer_id, product_id: r.product_id, ...o,
    caps: o.caps || [], reasons: o.reasons, warnings: o.warnings })));
  const cols = Object.keys(COLS);
  const up = rows.length ? await c.query(`INSERT INTO opportunity (offer_id, ${cols.join(', ')}, calculated_at)
    SELECT offer_id, ${cols.join(', ')}, $2 FROM jsonb_to_recordset($1::jsonb) AS x(offer_id bigint, ${cols.map((k) => `${k} ${COLS[k]}`).join(', ')})
    ON CONFLICT (offer_id) DO UPDATE SET ${cols.map((k) => `${k} = EXCLUDED.${k}`).join(', ')}, calculated_at = EXCLUDED.calculated_at
    WHERE (${cols.map((k) => `opportunity.${k}`).join(', ')}) IS DISTINCT FROM (${cols.map((k) => `EXCLUDED.${k}`).join(', ')})`, [J(rows), new Date(now).toISOString()]) : { rowCount: 0 };
  // oferta que saiu (removida/sem preço) deixa de ter avaliação
  const gone = await c.query(`DELETE FROM opportunity o WHERE NOT (o.offer_id = ANY($1::bigint[]))`, [rows.map((r) => r.offer_id)]);

  // eventos de transição (por produto)
  let events = [];
  if (emitEvents) {
    const prev = new Map(inp.prevBest.map((x) => [String(x.product_id), x]));
    const wasAnom = new Set(inp.prevAnom.map((x) => String(x.offer_id)));
    for (const r of res) {
      const newAnoms = r.offers.filter((o) => o.is_anomaly && !wasAnom.has(String(o.offer_id)));
      events.push(...eventsFor(r.legacy_id, prev.get(r.product_id) || null, r.best, { newAnomalies: newAnoms }));
    }
    if (events.length) await c.query(`INSERT INTO system_event (type, entity_type, entity_id, payload)
      SELECT type, 'product', product_id, payload || jsonb_build_object('engine_version', $2::text) FROM jsonb_to_recordset($1::jsonb) AS x(type text, product_id text, payload jsonb)`, [J(events), OPP_VERSION]);
  }
  const bands = {}; for (const r of rows) bands[r.opportunity_band] = (bands[r.opportunity_band] || 0) + 1;
  const ev = {}; for (const e of events) ev[e.type] = (ev[e.type] || 0) + 1;
  return { products: res.length, offersEvaluated: rows.length, written: up.rowCount, removed: gone.rowCount, withBest: res.filter((r) => r.best).length,
    bands, events: ev, seconds: (Date.now() - t0) / 1000 };
}
