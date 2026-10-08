// Leituras da API v1 no Marketplace Core + Price Engine (PostgreSQL). Todas parametrizadas, com schema explícito,
// paginadas e devolvendo só campos públicos (sem ids internos, confiança de matching, ids externos de vendedor,
// dados de afiliado, fila de revisão etc.).
import { q } from './db.mjs';
import { historicalContext, LABEL, confidenceLabel, currentReferenceView, contextReferenceView } from './references.mjs';

const num = (v) => (v == null ? null : Number(v));
const iso = (v) => (v == null ? null : new Date(v).toISOString());
const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
const STOCK_OUT = { in_stock: 'IN_STOCK', out_of_stock: 'OUT_OF_STOCK', preorder: 'PRE_ORDER', unknown: 'UNKNOWN' };

// ---------------------------------------------------------------- Home (formato do state.json, só o necessário)
const PRODUCTS_SQL = `
  SELECT p.id, p.legacy_id, p.units, p.variant, p.image_url, p.attrs, c.code AS col_code, c.name AS col_name,
         r.value AS ref_value, r.verification_status AS ref_status, r.source_url AS ref_url, r.source AS ref_source, r.verified_at AS ref_verified_at,
         (SELECT i.value FROM hunter.product_identifier i WHERE i.product_id = p.id AND i.kind = 'ean' ORDER BY i.value LIMIT 1) AS ean
    FROM hunter.product p
    LEFT JOIN hunter.collection c ON c.id = p.collection_id
    -- paridade com o site de hoje (robô/catalog.json): só as referências que o robô publica; preço de lançamento (histórico)
    -- e importações da auditoria NÃO aparecem como "preço Copag" até a fase que decidir a apresentação (6A)
    LEFT JOIN LATERAL (SELECT value, verification_status, source_url, source, verified_at FROM hunter.reference_price r
                        WHERE r.product_id = p.id AND r.verification_status IN ('verified', 'pending')
                          AND r.reference_scope <> 'historical' AND r.source IN ('copag_loja', 'manual', 'internet')
                        ORDER BY (r.verification_status = 'verified') DESC, r.verified_at DESC NULLS LAST, r.confidence DESC, r.id DESC LIMIT 1) r ON true
   WHERE p.legacy_id IS NOT NULL`;
const OFFERS_SQL = `
  SELECT o.legacy_id, p.legacy_id AS product_legacy, o.store_id, st.name AS store_name, se.name AS seller_name, o.url, o.image_url,
         o.price, o.price_kind, o.shipping_price, o.shipping_status, o.total_price, o.stock_status, o.quantity, o.confirmed, o.anomalous,
         o.status, o.first_seen_at, o.last_seen_at
    FROM hunter.offer o
    JOIN hunter.product p ON p.id = o.product_id
    LEFT JOIN hunter.store st ON st.id = o.store_id
    LEFT JOIN hunter.seller se ON se.id = o.seller_id
   WHERE o.status IN ('active', 'pending') AND o.legacy_id IS NOT NULL`;
const COLLECTIONS_SQL = `SELECT code AS id, name, series, aliases FROM hunter.collection ORDER BY code`;

/**
 * Monta um estado no formato do state.json a partir do banco. Preços, estoque, frete, lojas, vendedores e referências
 * vêm do banco; o que ainda só existe no robô (Deal Score, atividade, pistas, reputação, menor preço já visto,
 * data de lançamento de pré-venda, validação da loja) é sobreposto a partir do state.json, por id de oferta/produto.
 */
export async function stateLikeFromDb(legacy) {
  const [prows, orows, crows] = [await q(PRODUCTS_SQL), await q(OFFERS_SQL), await q(COLLECTIONS_SQL)];
  const LP = new Map((legacy.products || []).map((p) => [p.id, p]));
  const LO = new Map((legacy.offers || []).map((o) => [o.id, o]));
  const products = prows.map((r) => {
    const a = r.attrs || {}; const l = LP.get(r.legacy_id) || {}; const verified = r.ref_status === 'verified';
    return {
      id: r.legacy_id, collection: r.col_code, collectionName: r.col_name, type: a.type, typeLabel: a.typeLabel, group: a.group,
      boosters: r.units ?? null, variant: r.variant ?? null, ean: r.ean ?? null, image: r.image_url ?? null,
      copagConfirmed: verified, msrp: verified ? num(r.ref_value) : null,
      copagReference: !verified && r.ref_value != null ? num(r.ref_value) : null, copagReferenceUrl: !verified ? r.ref_url ?? null : null,
      copag: verified ? { source_url: r.ref_url, source_timestamp: iso(r.ref_verified_at), manual: r.ref_source === 'manual' } : null,
      firstSeen: l.firstSeen ?? null, lowestHistorical: l.lowestHistorical ?? null,   // ainda do robô (Price Engine sem histórico suficiente)
      marketAverage: l.marketAverage ?? null, hist: l.hist ?? null,                    // trocados pelo Price Engine na página do produto
    };
  });
  const PB = new Map(products.map((p) => [p.id, p]));
  const offers = orows.filter((r) => PB.has(r.product_legacy)).map((r) => {
    const p = PB.get(r.product_legacy); const l = LO.get(r.legacy_id) || {};
    const known = r.shipping_status !== 'unknown'; const price = num(r.price);
    // compatibilidade com o site atual: "total" = preço + frete quando o frete é conhecido, senão o preço (como no robô).
    // A API nova (ofertas/estatísticas) nunca faz isso: lá total sem frete conhecido é nulo.
    const total = known && r.total_price != null ? num(r.total_price) : price;
    return {
      id: r.legacy_id, productId: r.product_legacy, storeId: r.store_id, storeName: r.store_name, seller: r.seller_name ?? null,
      url: r.url, image: r.image_url ?? null, price, priceKind: r.price_kind ?? null,
      shipping: known ? (r.shipping_status === 'free' ? 0 : num(r.shipping_price)) : null, shippingKnown: known, total,
      // preço por booster: o do robô quando existe (entra no Deal Score e no modo "Para abrir"; comportamento atual
      // preservado até o Opportunity Engine); senão, calculado do produto
      perBooster: l.perBooster !== undefined ? l.perBooster : p.boosters && total ? round2(total / p.boosters) : null,
      stock: STOCK_OUT[r.stock_status] || 'UNKNOWN', quantity: r.quantity ?? null, firstSeen: iso(r.first_seen_at),
      stale: r.status === 'pending', confirmed: r.confirmed, anomalous: r.anomalous,
      discount: p.msrp && total ? +(1 - total / p.msrp).toFixed(4) : null, savings: p.msrp && total ? round2(p.msrp - total) : null,
      // ainda do robô:
      dealScore: l.dealScore ?? null, scoreParts: l.scoreParts ?? null, storeValidated: l.storeValidated ?? false, releaseDate: l.releaseDate ?? null,
      sku: l.sku ?? null, ean: l.ean ?? null, source_timestamp: iso(r.last_seen_at),
      priceKindLabel: l.priceKindLabel ?? null, storeKind: l.storeKind ?? null, sellerKind: l.sellerKind ?? null,
    };
  });
  // mesma ordem do state.json (o banco não garante ordem): empates nas listas do site saem iguais aos de hoje
  const pPos = new Map((legacy.products || []).map((p, i) => [p.id, i])); const oPos = new Map((legacy.offers || []).map((o, i) => [o.id, i]));
  products.sort((a, b) => (pPos.get(a.id) ?? 1e9) - (pPos.get(b.id) ?? 1e9) || String(a.id).localeCompare(String(b.id)));
  offers.sort((a, b) => (oPos.get(a.id) ?? 1e9) - (oPos.get(b.id) ?? 1e9) || String(a.id).localeCompare(String(b.id)));
  const count = {}; for (const o of offers) count[o.productId] = (count[o.productId] || 0) + 1;
  for (const p of products) p.offerCount = count[p.id] || 0;
  // ordem das coleções = a do robô (o mural da Home depende dela); nomes e apelidos do banco
  const pos = new Map((legacy.collections || []).map((c, i) => [c.id, i]));
  const nByCol = {}; for (const p of products) nByCol[p.collection] = (nByCol[p.collection] || 0) + 1;
  const collections = crows.map((c) => ({ id: c.id, name: c.name, series: c.series, aliases: c.aliases || [], products: nByCol[c.id] || 0 }))
    .sort((a, b) => (pos.get(a.id) ?? 1e6) - (pos.get(b.id) ?? 1e6) || a.id.localeCompare(b.id));
  return {
    generatedAt: legacy.generatedAt, coverage: legacy.coverage, totals: legacy.totals, types: legacy.types,
    collections, products, offers,
    activity: legacy.activity, tips: legacy.tips, sources: legacy.sources, reputation: legacy.reputation, distrust: legacy.distrust ?? null,
  };
}

// ---------------------------------------------------------------- Produtos (lista paginada)
const SORTS = {
  relevancia: 's.number_of_in_stock_offers DESC NULLS LAST, p.canonical_name',
  preco: 's.current_price ASC NULLS LAST, p.canonical_name',
  desconto: 's.discount_vs_reference DESC NULLS LAST, p.canonical_name',
  nome: 'p.canonical_name',
  ofertas: 's.number_of_active_offers DESC NULLS LAST, p.canonical_name',
};
export const PRODUCT_SORTS = Object.keys(SORTS);

const productCard = (r) => ({
  id: r.legacy_id, slug: r.slug, name: r.canonical_name, collection: { code: r.col_code, name: r.col_name }, category: r.category_id,
  type: r.attrs?.type ?? null, boosters: r.units ?? null, image: r.image_url ?? null,
  price: { current: num(r.current_price), current_total: num(r.current_total_price), median: num(r.median_price) },
  reference: r.reference_price != null ? { value: num(r.reference_price), status: r.reference_status, kind: r.reference_kind ?? null } : null,
  discount_vs_reference: num(r.discount_vs_reference),
  offers: { active: r.number_of_active_offers ?? 0, in_stock: r.number_of_in_stock_offers ?? 0, stores: r.number_of_stores ?? 0 },
  status: r.data_status ?? 'no_offers',
});

export async function listProducts({ page, limit, colecao = null, tipo = null, categoria = null, estoque = false, busca = null, ordem = 'relevancia' }) {
  const order = SORTS[ordem] || SORTS.relevancia;
  const rows = await q(`
    SELECT p.legacy_id, p.slug, p.canonical_name, p.category_id, p.attrs, p.units, p.image_url, c.code AS col_code, c.name AS col_name,
           s.data_status, s.current_price, s.current_total_price, s.median_price, s.reference_price, s.reference_status, s.reference_kind, s.discount_vs_reference,
           s.number_of_active_offers, s.number_of_in_stock_offers, s.number_of_stores, count(*) OVER () AS total_rows
      FROM hunter.product p
      LEFT JOIN hunter.collection c ON c.id = p.collection_id
      LEFT JOIN hunter.product_stats s ON s.product_id = p.id
     WHERE p.legacy_id IS NOT NULL
       AND ($1::text IS NULL OR c.code = $1) AND ($2::text IS NULL OR p.attrs->>'type' = $2) AND ($3::text IS NULL OR p.category_id = $3)
       AND (NOT $4::boolean OR s.data_status = 'ok')
       AND ($5::text IS NULL OR position(lower($5) IN lower(p.canonical_name)) > 0)
     ORDER BY ${order}, p.legacy_id
     LIMIT $6 OFFSET $7`, [colecao, tipo, categoria, !!estoque, busca, limit, (page - 1) * limit]);
  const total = rows.length ? Number(rows[0].total_rows) : (page > 1 ? await countProducts({ colecao, tipo, categoria, estoque, busca }) : 0);
  return { items: rows.map(productCard), total };
}
async function countProducts({ colecao, tipo, categoria, estoque, busca }) {
  const r = await q(`SELECT count(*)::int n FROM hunter.product p LEFT JOIN hunter.collection c ON c.id = p.collection_id LEFT JOIN hunter.product_stats s ON s.product_id = p.id
    WHERE p.legacy_id IS NOT NULL AND ($1::text IS NULL OR c.code = $1) AND ($2::text IS NULL OR p.attrs->>'type' = $2) AND ($3::text IS NULL OR p.category_id = $3)
      AND (NOT $4::boolean OR s.data_status = 'ok') AND ($5::text IS NULL OR position(lower($5) IN lower(p.canonical_name)) > 0)`, [colecao, tipo, categoria, !!estoque, busca]);
  return r[0].n;
}

// ---------------------------------------------------------------- Produto individual
async function productRow(key) {
  const r = await q(`
    SELECT p.id, p.legacy_id, p.slug, p.canonical_name, p.category_id, p.attrs, p.units, p.variant, p.language, p.condition, p.image_url, p.status,
           c.code AS col_code, c.name AS col_name, c.series AS col_series, p.tcg_id
      FROM hunter.product p LEFT JOIN hunter.collection c ON c.id = p.collection_id
     WHERE p.legacy_id = $1 OR p.slug = $1
     ORDER BY (p.legacy_id = $1) DESC LIMIT 1`, [key]);
  return r[0] || null;
}
const STATS_PUBLIC = `as_of_day, data_status, current_price, current_total_price, lowest_current_price, highest_current_price, average_price, median_price,
  history_days, history_from, history_status, historical_min, historical_max, historical_average, historical_median,
  variation_24h, variation_7d, variation_30d, distance_from_historical_average, distance_from_historical_min,
  reference_price, reference_status, reference_source, reference_kind, reference_verified_at, reference_confidence, reference_reason, discount_vs_reference,
  number_of_active_offers, number_of_in_stock_offers, number_of_stores, number_of_marketplaces, shipping_coverage, engine_version, computed_at,
  (quality->'market_reference'->>'sources')::int AS market_sources, coalesce(quality->'market_reference'->>'composition', 'NONE') AS market_composition`;
const statsOut = (s) => (s ? {
  as_of_day: s.as_of_day ? iso(s.as_of_day).slice(0, 10) : null, status: s.data_status,
  market: { current_price: num(s.current_price), current_total_price: num(s.current_total_price), lowest: num(s.lowest_current_price), highest: num(s.highest_current_price),
    average: num(s.average_price), median: num(s.median_price) },
  history: { days: s.history_days, from: s.history_from ? iso(s.history_from).slice(0, 10) : null, status: s.history_status,
    min: num(s.historical_min), max: num(s.historical_max), average: num(s.historical_average), median: num(s.historical_median),
    variation_24h: num(s.variation_24h), variation_7d: num(s.variation_7d), variation_30d: num(s.variation_30d),
    distance_from_average: num(s.distance_from_historical_average), distance_from_min: num(s.distance_from_historical_min) },
  // referência ATUAL resolvida pelo Price Engine (Copag atual > mercado robusto); null = NONE
  reference: s.reference_price != null ? { value: num(s.reference_price), status: s.reference_status, source: s.reference_source, kind: s.reference_kind ?? null,
    confidence: num(s.reference_confidence), reason: s.reference_reason ?? null, verified_at: iso(s.reference_verified_at) } : null,
  discount_vs_reference: num(s.discount_vs_reference),
  coverage: { active_offers: s.number_of_active_offers, in_stock_offers: s.number_of_in_stock_offers, stores: s.number_of_stores,
    marketplaces: s.number_of_marketplaces, shipping_coverage: num(s.shipping_coverage) },
  engine_version: s.engine_version, computed_at: iso(s.computed_at),
} : null);

export async function getProduct(key) {
  const p = await productRow(key); if (!p) return null;
  const [stats, refs, ids] = [
    (await q(`SELECT ${STATS_PUBLIC} FROM hunter.product_stats WHERE product_id = $1`, [p.id]))[0],
    await q(`SELECT ${REF_COLS} FROM hunter.reference_price WHERE product_id = $1 ORDER BY ${REF_ORDER}`, [p.id]),
    await q(`SELECT kind, value FROM hunter.product_identifier WHERE product_id = $1 AND kind IN ('ean', 'gtin') ORDER BY kind, value`, [p.id]),
  ];
  return {
    id: p.legacy_id, slug: p.slug, name: p.canonical_name, tcg: p.tcg_id, category: p.category_id, type: p.attrs?.type ?? null, type_label: p.attrs?.typeLabel ?? null,
    collection: { code: p.col_code, name: p.col_name, series: p.col_series }, boosters: p.units ?? null, variant: p.variant ?? null,
    language: p.language, condition: p.condition, image: p.image_url ?? null, status: p.status,
    identifiers: ids.map((i) => ({ kind: i.kind, value: i.value })),
    // respostas separadas: referência ATUAL (resolvida no Price Engine; kind NONE = nenhuma), CONTEXTO histórico
    // (preço sugerido de lançamento etc.) e referência COMUNITÁRIA (só alerta, não oficial)
    ...referenceBlocks(stats, refs),
    references: refs.map(refOut), stats: statsOut(stats),
  };
}
function referenceBlocks(stats, refs) {
  const comm = refs.filter((r) => r.reference_scope === 'community');
  return {
    current_reference: currentReferenceView(stats ? { kind: stats.reference_kind, price: stats.reference_price, confidence: stats.reference_confidence, reason: stats.reference_reason, market_sources: stats.market_sources, market_composition: stats.market_composition } : null),
    // composição do mercado atual (qualidade da evidência): MARKET_STORES | MARKET_MIXED | MARKETPLACE_ONLY | NONE — não substitui a Copag atual
    market_composition: stats?.market_composition ?? 'NONE',
    historical_context: historicalContext(refs).map(contextReferenceView),
    community_reference: comm.length ? contextReferenceView(comm[0]) : null,
  };
}
const REF_COLS = `id, value, verification_status, source, source_url, verified_at, reference_kind, reference_scope, confidence,
  published_at, effective_date, observed_at, page_title, evidence_text`;
const REF_ORDER = `CASE reference_scope WHEN 'current' THEN 0 WHEN 'historical' THEN 1 ELSE 2 END, (verification_status = 'verified') DESC,
  CASE reference_kind WHEN 'COPAG_OFFICIAL_CURRENT' THEN 1 WHEN 'MARKET_CURRENT' THEN 2 ELSE 3 END, verified_at DESC NULLS LAST, id DESC`;
const refOut = (r) => ({ value: num(r.value), status: r.verification_status, source: r.source, source_url: r.source_url, verified_at: iso(r.verified_at),
  kind: r.reference_kind ?? null, scope: r.reference_scope ?? null, label: LABEL[r.reference_kind] ?? null,
  confidence: r.confidence ?? null, confidence_label: confidenceLabel(r.confidence), published_at: r.published_at ?? null, effective_date: r.effective_date ?? null,
  observed_at: iso(r.observed_at), page_title: r.page_title ?? null, evidence: r.evidence_text ?? null });

// ---------------------------------------------------------------- Ofertas de um produto
const offerOut = (r) => ({
  id: r.legacy_id, store: { id: r.store_id, name: r.store_name }, marketplace: r.marketplace_id, seller: r.seller_name ?? null,
  title: r.title_raw, url: r.url, image: r.image_url ?? null,
  price: num(r.price), price_kind: r.price_kind ?? null, pix_price: num(r.pix_price), list_price: num(r.list_price),
  shipping: { status: r.shipping_status, price: r.shipping_status === 'unknown' ? null : r.shipping_status === 'free' ? 0 : num(r.shipping_price) },
  total_price: num(r.total_price),                      // nulo quando o frete é desconhecido (nunca inventado)
  stock: r.stock_status, quantity: r.quantity ?? null, status: r.status, confirmed: r.confirmed, anomalous: r.anomalous,
  first_seen_at: iso(r.first_seen_at), last_seen_at: iso(r.last_seen_at),
});
export async function productOffers(key, { page, limit, todas = false }) {
  const p = await productRow(key); if (!p) return null;
  const rows = await q(`
    SELECT o.legacy_id, o.store_id, st.name AS store_name, o.marketplace_id, se.name AS seller_name, o.title_raw, o.url, o.image_url, o.price, o.price_kind,
           o.pix_price, o.list_price, o.shipping_status, o.shipping_price, o.total_price, o.stock_status, o.quantity, o.status, o.confirmed, o.anomalous,
           o.first_seen_at, o.last_seen_at, count(*) OVER () AS total_rows
      FROM hunter.offer o LEFT JOIN hunter.store st ON st.id = o.store_id LEFT JOIN hunter.seller se ON se.id = o.seller_id
     WHERE o.product_id = $1 AND ($2::boolean OR o.status IN ('active', 'pending'))
     ORDER BY (o.status = 'active') DESC, (o.stock_status = 'in_stock') DESC, o.price ASC NULLS LAST, o.legacy_id
     LIMIT $3 OFFSET $4`, [p.id, !!todas, limit, (page - 1) * limit]);
  return { product: { id: p.legacy_id, slug: p.slug, name: p.canonical_name }, items: rows.map(offerOut), total: rows.length ? Number(rows[0].total_rows) : 0 };
}

// ---------------------------------------------------------------- Histórico (série diária do Price Engine)
export async function productHistory(key, { dias, lojas = false }) {
  const p = await productRow(key); if (!p) return null;
  const rows = await q(`SELECT d.store_id, s.name AS store_name, d.day, d.min_price, d.max_price, d.avg_price, d.close_price, d.offers FROM hunter.price_daily d
     LEFT JOIN hunter.store s ON s.id = d.store_id
     WHERE d.product_id = $1 AND ($3::boolean OR d.store_id = '') AND d.day >= (current_date - $2::int) ORDER BY d.store_id, d.day`, [p.id, dias, !!lojas]);
  const pt = (r) => ({ day: iso(r.day).slice(0, 10), min: num(r.min_price), max: num(r.max_price), avg: num(r.avg_price), close: num(r.close_price), offers: r.offers });
  const out = { product: { id: p.legacy_id, slug: p.slug, name: p.canonical_name }, days: dias, series: rows.filter((r) => r.store_id === '').map(pt) };
  if (lojas) { out.stores = {}; for (const r of rows) if (r.store_id) (out.stores[r.store_id] ||= { name: r.store_name || r.store_id, series: [] }).series.push(pt(r)); }
  return out;
}
/** dia do menor preço da série do produto (para "menor já visto" com data) */
export async function productMinDay(key) {
  const r = await q(`SELECT d.day FROM hunter.price_daily d JOIN hunter.product p ON p.id = d.product_id
     WHERE (p.legacy_id = $1 OR p.slug = $1) AND d.store_id = '' ORDER BY d.min_price, d.day LIMIT 1`, [key]);
  return r[0] ? iso(r[0].day).slice(0, 10) : null;
}

// ---------------------------------------------------------------- Estatísticas
export async function productStats(key) {
  const p = await productRow(key); if (!p) return null;
  const s = (await q(`SELECT ${STATS_PUBLIC} FROM hunter.product_stats WHERE product_id = $1`, [p.id]))[0];
  return { product: { id: p.legacy_id, slug: p.slug, name: p.canonical_name }, stats: statsOut(s) };
}

// ---------------------------------------------------------------- Referências Copag
export async function listReferences({ page, limit, status = null }) {
  const rows = await q(`
    SELECT p.legacy_id, p.slug, p.canonical_name, r.id, r.value, r.verification_status, r.source, r.source_url, r.verified_at, r.reference_kind, r.reference_scope,
           r.confidence, r.published_at, r.effective_date, r.observed_at, r.page_title, r.evidence_text, count(*) OVER () AS total_rows
      FROM hunter.reference_price r JOIN hunter.product p ON p.id = r.product_id
     WHERE ($1::text IS NULL OR r.verification_status = $1)
     ORDER BY CASE r.reference_scope WHEN 'current' THEN 0 WHEN 'historical' THEN 1 ELSE 2 END, (r.verification_status = 'verified') DESC, p.canonical_name, r.id
     LIMIT $2 OFFSET $3`, [status, limit, (page - 1) * limit]);
  return { items: rows.map((r) => ({ product: { id: r.legacy_id, slug: r.slug, name: r.canonical_name }, ...refOut(r) })), total: rows.length ? Number(rows[0].total_rows) : 0 };
}

// ---------------------------------------------------------------- Oportunidades (Opportunity Engine, resultado persistido)
// Lê o que o pipeline já calculou (opportunity + view product_opportunity + product_stats + reference_price). Uma consulta,
// sem N+1, sem recalcular nada no request. Padrão: a melhor oferta comprável de cada produto; ofertas=todas lista todas as avaliadas.
export const OPP_SORTS = { score: 'o.opportunity_score DESC, o.confidence DESC, o.price ASC, o.offer_id', preco: 'o.price ASC, o.opportunity_score DESC, o.offer_id',
  confianca: 'o.confidence DESC, o.opportunity_score DESC, o.offer_id' };
export async function listOpportunities({ page, limit, faixa = null, colecao = null, minimo = null, todas = false, ordem = 'score' }) {
  const from = todas ? 'hunter.opportunity o' : 'hunter.product_opportunity o';
  const rows = await q(`
    SELECT p.legacy_id, p.slug, p.canonical_name, p.attrs, c.code AS col_code, c.name AS col_name,
           f.legacy_id AS offer_legacy, f.url, f.title_raw, f.total_price, f.shipping_status, f.stock_status, f.store_id, st.name AS store_name, f.marketplace_id,
           o.price, o.opportunity_score, o.opportunity_band, o.confidence, o.reasons, o.warnings, o.engine_version, o.calculated_at,
           s.reference_kind, s.reference_price, s.reference_confidence, s.reference_reason, (s.quality->'market_reference'->>'sources')::int AS market_sources, coalesce(s.quality->'market_reference'->>'composition', 'NONE') AS market_composition,
           (SELECT coalesce(jsonb_agg(jsonb_build_object('reference_kind', r.reference_kind, 'value', r.value, 'published_at', r.published_at, 'effective_date', r.effective_date,
               'confidence', r.confidence, 'source_url', r.source_url, 'source', r.source, 'verification_status', r.verification_status)
               ORDER BY r.published_at DESC NULLS LAST, r.id DESC), '[]') FROM hunter.reference_price r WHERE r.product_id = o.product_id AND r.reference_scope = 'historical') AS historical,
           (SELECT jsonb_build_object('reference_kind', r.reference_kind, 'value', r.value, 'confidence', r.confidence, 'source_url', r.source_url, 'source', r.source,
               'verification_status', r.verification_status)
              FROM hunter.reference_price r WHERE r.product_id = o.product_id AND r.reference_scope = 'community' ORDER BY r.verified_at DESC NULLS LAST, r.id DESC LIMIT 1) AS community,
           count(*) OVER () AS total_rows
      FROM ${from}
      JOIN hunter.product p ON p.id = o.product_id
      LEFT JOIN hunter.collection c ON c.id = p.collection_id
      JOIN hunter.offer f ON f.id = o.offer_id
      LEFT JOIN hunter.store st ON st.id = f.store_id
      LEFT JOIN hunter.product_stats s ON s.product_id = o.product_id
     WHERE ($1::text IS NULL OR o.opportunity_band = $1) AND ($2::text IS NULL OR c.code = $2) AND ($3::int IS NULL OR o.opportunity_score >= $3)
     ORDER BY ${OPP_SORTS[ordem] || OPP_SORTS.score}
     LIMIT $4 OFFSET $5`, [faixa, colecao, minimo, limit, (page - 1) * limit]);
  return { items: rows.map(opportunityOut), total: rows.length ? Number(rows[0].total_rows) : 0 };
}
const opportunityOut = (r) => ({
  product: { id: r.legacy_id, slug: r.slug, name: r.canonical_name, type: r.attrs?.type ?? null, collection: { code: r.col_code, name: r.col_name } },
  offer: { id: r.offer_legacy, title: r.title_raw, url: r.url },
  price: num(r.price), total: r.shipping_status === 'unknown' ? null : num(r.total_price), shipping: r.shipping_status, stock: r.stock_status,
  store: { id: r.store_id, name: r.store_name }, marketplace: r.marketplace_id,
  opportunity_score: r.opportunity_score, opportunity_band: r.opportunity_band, confidence: num(r.confidence),
  current_reference: currentReferenceView({ kind: r.reference_kind, price: r.reference_price, confidence: r.reference_confidence, reason: r.reference_reason, market_sources: r.market_sources, market_composition: r.market_composition }),
  market_composition: r.market_composition ?? 'NONE',
  historical_context: (r.historical || []).map(contextReferenceView),
  community_reference: r.community ? contextReferenceView(r.community) : null,
  warnings: r.warnings || [], reasons: r.reasons || [],
  engine_version: r.engine_version, updated_at: iso(r.calculated_at),
});
