// Grava o estado atual do robô no banco (Marketplace Core). Idempotente: rodar de novo não duplica.
// Não altera nada do que o site lê hoje (arquivos do ramo data).
import { collectionsRows, productsRows, referenceRows, storesRows, offersRows, historyRows, distrustRows } from './mappers.js';
import { ensureMonth } from '../db/partitions.js';

const J = (v) => JSON.stringify(v);

export async function syncState(c, { state, catalog = null, historyLines = [], log = () => {} }) {
  const stats = {};
  // Coleções: catálogo de configuração + o que o robô viu
  const colSrc = [...new Map([...(catalog?.collections || []), ...(state.collections || [])].map((x) => [x.id, x])).values()];
  const colIds = new Set(colSrc.map((x) => x.id));
  const byName = new Map(colSrc.map((x) => [x.name, x.id]));
  // Produto com código de coleção antigo: aponta para a coleção atual pelo nome; se já existe o mesmo produto, é duplicado → fila de revisão
  const keyOf = (p) => `${p.collection}|${p.type}|${p.variant || ''}`;
  const seen = new Set((state.products || []).filter((p) => colIds.has(p.collection)).map(keyOf));
  const dups = [];
  state = { ...state, products: (state.products || []).flatMap((p) => {
    if (colIds.has(p.collection)) return [p];
    const target = byName.get(p.collectionName);
    const fixed = target ? { ...p, collection: target } : null;
    if (!fixed || seen.has(keyOf(fixed))) { dups.push({ p, target }); return []; }
    seen.add(keyOf(fixed)); return [fixed];
  }) };
  if (dups.length) await c.query(`INSERT INTO review_item (category, entity_type, entity_id, proposal, confidence, dedupe_key)
    SELECT 'duplicate_product', 'legacy_product', id, proposal, 90, 'dup:' || id FROM jsonb_to_recordset($1::jsonb) AS x(id text, proposal jsonb) ON CONFLICT (dedupe_key) DO NOTHING`,
    [J(dups.map(({ p, target }) => ({ id: p.id, proposal: { reason: 'código de coleção antigo; já existe o produto na coleção atual', collection_code: p.collection, current_collection: target || null, offers: p.offerCount || 0 } })))]);
  stats.duplicatesToReview = dups.length;

  // 1) Coleções
  const cols = collectionsRows(colSrc);
  await c.query(`INSERT INTO collection (id, tcg_id, code, name, series, language, aliases, logo_path)
    SELECT id, tcg_id, code, name, series, language, aliases, logo_path FROM jsonb_to_recordset($1::jsonb)
      AS x(id text, tcg_id text, code text, name text, series text, language text, aliases text[], logo_path text)
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, series = EXCLUDED.series, aliases = EXCLUDED.aliases, updated_at = now()`, [J(cols)]);
  stats.collections = cols.length;

  // 2) Produtos (slug fixo: só na criação; colisão ganha sufixo)
  const prods = productsRows(state.products || []);
  const known = new Map((await c.query('SELECT legacy_id, slug FROM product WHERE legacy_id IS NOT NULL')).rows.map((r) => [r.legacy_id, r.slug]));
  const taken = new Set((await c.query('SELECT slug FROM product')).rows.map((r) => r.slug));
  for (const p of prods) {
    if (known.has(p.legacy_id)) { p.slug = known.get(p.legacy_id); continue; }
    let s = p.slug, i = 2; while (taken.has(s)) s = `${p.slug}-${i++}`; p.slug = s; taken.add(s);
  }
  await c.query(`INSERT INTO product (legacy_id, slug, tcg_id, collection_id, category_id, brand, canonical_name, language, units, variant, image_url, status, attrs)
    SELECT legacy_id, slug, tcg_id, collection_id, category_id, brand, canonical_name, language, units, variant, image_url, status, attrs FROM jsonb_to_recordset($1::jsonb)
      AS x(legacy_id text, slug text, tcg_id text, collection_id text, category_id text, brand text, canonical_name text, language text, units int, variant text, image_url text, status text, attrs jsonb)
    ON CONFLICT (legacy_id) DO UPDATE SET collection_id = EXCLUDED.collection_id, category_id = EXCLUDED.category_id, canonical_name = EXCLUDED.canonical_name,
      units = EXCLUDED.units, variant = EXCLUDED.variant, image_url = coalesce(EXCLUDED.image_url, product.image_url), attrs = EXCLUDED.attrs, updated_at = now()`, [J(prods)]);
  const pid = new Map((await c.query('SELECT legacy_id, id FROM product WHERE legacy_id IS NOT NULL')).rows.map((r) => [r.legacy_id, Number(r.id)]));
  const eans = prods.filter((p) => p.ean).map((p) => ({ product_id: pid.get(p.legacy_id), value: String(p.ean) }));
  if (eans.length) await c.query(`INSERT INTO product_identifier (product_id, kind, value, source) SELECT product_id, 'ean', value, 'robot' FROM jsonb_to_recordset($1::jsonb) AS x(product_id bigint, value text) ON CONFLICT DO NOTHING`, [J(eans)]);
  stats.products = prods.length;

  // 3) Referência Copag (nova linha só quando muda o valor ou a fonte)
  const refs = referenceRows(state.products || []).map((r) => ({ ...r, product_id: pid.get(r.legacy_id) })).filter((r) => r.product_id);
  const rr = await c.query(`INSERT INTO reference_price (product_id, value, source, source_url, verification_status, verified_at, confidence, notes, reference_kind, observed_at)
    SELECT product_id, value, source, source_url, verification_status, verified_at, confidence, notes, reference_kind, observed_at FROM jsonb_to_recordset($1::jsonb)
      AS x(product_id bigint, value numeric, source text, source_url text, verification_status text, verified_at timestamptz, confidence smallint, notes text,
           reference_kind text, observed_at timestamptz)
    ON CONFLICT (product_id, source, value) DO UPDATE SET verified_at = greatest(reference_price.verified_at, EXCLUDED.verified_at),
      observed_at = greatest(reference_price.observed_at, EXCLUDED.observed_at)`, [J(refs)]);
  stats.references = rr.rowCount;

  // 4) Lojas + saúde da fonte + canal (site próprio ou marketplace)
  const stores = storesRows(state.sources || [], state.reputation || {});
  await c.query(`INSERT INTO store (id, name, domain, platform, kind, status, ra_status, ra_score, ra_url)
    SELECT id, name, domain, platform, kind, status, ra_status, ra_score, ra_url FROM jsonb_to_recordset($1::jsonb)
      AS x(id text, name text, domain text, platform text, kind text, status text, ra_status text, ra_score numeric, ra_url text)
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, domain = coalesce(EXCLUDED.domain, store.domain), platform = coalesce(EXCLUDED.platform, store.platform),
      kind = EXCLUDED.kind, status = EXCLUDED.status, ra_status = EXCLUDED.ra_status, ra_score = EXCLUDED.ra_score, ra_url = EXCLUDED.ra_url, updated_at = now()`, [J(stores)]);
  await c.query(`INSERT INTO source_health (store_id, status, fails, reason, last_check_at, last_success_at)
    SELECT id, (health->>'status'), coalesce((health->>'fails')::int, 0), health->>'reason', (health->>'last_check_at')::timestamptz, (health->>'last_success_at')::timestamptz
    FROM jsonb_to_recordset($1::jsonb) AS x(id text, health jsonb)
    ON CONFLICT (store_id) DO UPDATE SET status = EXCLUDED.status, fails = EXCLUDED.fails, reason = EXCLUDED.reason,
      last_check_at = EXCLUDED.last_check_at, last_success_at = coalesce(EXCLUDED.last_success_at, source_health.last_success_at), updated_at = now()`, [J(stores)]);
  await c.query(`INSERT INTO store_channel (store_id, marketplace_id, url)
    SELECT id, CASE WHEN id = 'mercadolivre' THEN 'mercadolivre' ELSE 'direct' END, NULL FROM jsonb_to_recordset($1::jsonb) AS x(id text) ON CONFLICT DO NOTHING`, [J(stores)]);
  stats.stores = stores.length;

  // 5) Vendedores de marketplace
  const offers = offersRows(state.offers || []).filter((o) => pid.has(o.product_legacy_id));
  const sellers = [...new Map(offers.filter((o) => o.seller).map((o) => [o.marketplace_id + '|' + o.seller.external_id, { marketplace_id: o.marketplace_id, ...o.seller }])).values()];
  if (sellers.length) await c.query(`INSERT INTO seller (marketplace_id, external_id, name, is_official, checked_at)
    SELECT marketplace_id, external_id, name, is_official, now() FROM jsonb_to_recordset($1::jsonb) AS x(marketplace_id text, external_id text, name text, is_official boolean)
    ON CONFLICT (marketplace_id, external_id) DO UPDATE SET name = EXCLUDED.name, is_official = EXCLUDED.is_official, checked_at = now()`, [J(sellers)]);
  const sid = new Map((await c.query('SELECT marketplace_id, external_id, id FROM seller')).rows.map((r) => [r.marketplace_id + '|' + r.external_id, Number(r.id)]));

  // 6) Ofertas (+ mudança de estoque registrada, + frete conhecido)
  const prev = new Map((await c.query('SELECT legacy_id, id, stock_status FROM offer WHERE legacy_id IS NOT NULL')).rows.map((r) => [r.legacy_id, r]));
  const rows = offers.map((o) => ({ ...o, product_id: pid.get(o.product_legacy_id), seller_id: o.seller ? sid.get(o.marketplace_id + '|' + o.seller.external_id) : null }));
  await c.query(`INSERT INTO offer (legacy_id, product_id, store_id, marketplace_id, seller_id, external_offer_id, title_raw, url, image_url, price, price_kind, list_price, pix_price,
      shipping_status, shipping_price, total_price, stock_status, quantity, match_confidence, confirmed, anomalous, status, source_type, first_seen_at, last_seen_at)
    SELECT legacy_id, product_id, store_id, marketplace_id, seller_id, external_offer_id, title_raw, url, image_url, price, price_kind, list_price, pix_price,
      shipping_status, shipping_price, total_price, stock_status, quantity, match_confidence, confirmed, anomalous, status, source_type, coalesce(first_seen_at, now()), coalesce(last_seen_at, now())
    FROM jsonb_to_recordset($1::jsonb) AS x(legacy_id text, product_id bigint, store_id text, marketplace_id text, seller_id bigint, external_offer_id text, title_raw text, url text, image_url text,
      price numeric, price_kind text, list_price numeric, pix_price numeric, shipping_status text, shipping_price numeric, total_price numeric, stock_status text, quantity int,
      match_confidence smallint, confirmed boolean, anomalous boolean, status text, source_type text, first_seen_at timestamptz, last_seen_at timestamptz)
    ON CONFLICT (legacy_id) DO UPDATE SET product_id = EXCLUDED.product_id, seller_id = EXCLUDED.seller_id, title_raw = EXCLUDED.title_raw, url = EXCLUDED.url,
      image_url = coalesce(EXCLUDED.image_url, offer.image_url), price = EXCLUDED.price, price_kind = EXCLUDED.price_kind, list_price = EXCLUDED.list_price, pix_price = EXCLUDED.pix_price,
      shipping_status = EXCLUDED.shipping_status, shipping_price = EXCLUDED.shipping_price, total_price = EXCLUDED.total_price, stock_status = EXCLUDED.stock_status,
      quantity = EXCLUDED.quantity, match_confidence = EXCLUDED.match_confidence, confirmed = EXCLUDED.confirmed, anomalous = EXCLUDED.anomalous, status = EXCLUDED.status,
      last_seen_at = EXCLUDED.last_seen_at, updated_at = now()`, [J(rows)]);
  const oid = new Map((await c.query('SELECT legacy_id, id FROM offer WHERE legacy_id IS NOT NULL')).rows.map((r) => [r.legacy_id, Number(r.id)]));
  const live = new Set(rows.map((r) => r.legacy_id));
  const gone = await c.query(`UPDATE offer SET status = 'removed', stock_status = 'unknown', updated_at = now() WHERE status <> 'removed' AND legacy_id IS NOT NULL AND NOT (legacy_id = ANY($1::text[]))`, [[...live]]);
  const stockEv = rows.filter((r) => prev.has(r.legacy_id) && prev.get(r.legacy_id).stock_status !== r.stock_status)
    .map((r) => ({ offer_id: oid.get(r.legacy_id), from_status: prev.get(r.legacy_id).stock_status, to_status: r.stock_status, quantity: r.quantity, observed_at: r.last_seen_at }));
  if (stockEv.length) await c.query(`INSERT INTO stock_event (offer_id, from_status, to_status, quantity, observed_at)
    SELECT offer_id, from_status, to_status, quantity, coalesce(observed_at, now()) FROM jsonb_to_recordset($1::jsonb) AS x(offer_id bigint, from_status text, to_status text, quantity int, observed_at timestamptz)
    ON CONFLICT DO NOTHING`, [J(stockEv)]);
  const ship = rows.filter((r) => r.shipping_status !== 'unknown' && !r.shipping_reused).map((r) => ({ offer_id: oid.get(r.legacy_id), price: r.shipping_price }));
  if (ship.length) await c.query(`INSERT INTO shipping_quote (offer_id, cep_prefix, method, price) SELECT offer_id, '00000', 'padrao', price FROM jsonb_to_recordset($1::jsonb) AS x(offer_id bigint, price numeric)
    ON CONFLICT (offer_id, cep_prefix, method) DO UPDATE SET price = EXCLUDED.price, checked_at = now()`, [J(ship)]);
  Object.assign(stats, { offers: rows.length, offersRemoved: gone.rowCount, stockEvents: stockEv.length, shippingQuotes: ship.length });

  // 7a) Ofertas que só existem no histórico (já sumiram das lojas): entram como 'removed' para o histórico não se perder
  const hrows = historyRows(historyLines);
  const ghosts = [...new Map(historyLines.filter((h) => h.offerId && !oid.has(h.offerId) && pid.has(h.productId))
    .map((h) => [h.offerId, { legacy_id: h.offerId, product_id: pid.get(h.productId), store_id: h.storeId, marketplace_id: h.storeId === 'mercadolivre' ? 'mercadolivre' : 'direct', t: h.t }])).values()]
    .filter((g) => stores.some((x) => x.id === g.store_id));
  if (ghosts.length) {
    await c.query(`INSERT INTO offer (legacy_id, product_id, store_id, marketplace_id, title_raw, url, status, stock_status, first_seen_at, last_seen_at)
      SELECT legacy_id, product_id, store_id, marketplace_id, '(oferta antiga, só no histórico)', '', 'removed', 'unknown', t, t
      FROM jsonb_to_recordset($1::jsonb) AS x(legacy_id text, product_id bigint, store_id text, marketplace_id text, t timestamptz) ON CONFLICT (legacy_id) DO NOTHING`, [J(ghosts)]);
    for (const r of (await c.query('SELECT legacy_id, id FROM offer WHERE legacy_id = ANY($1::text[])', [ghosts.map((g) => g.legacy_id)])).rows) oid.set(r.legacy_id, Number(r.id));
  }
  stats.historicOffers = ghosts.length;
  // 7b) Saída de oferta (evento 'removed' do robô) vira registro de estoque
  const removedEv = hrows.filter((h) => h.event === 'removed' && oid.get(h.offer_legacy_id)).map((h) => ({ offer_id: oid.get(h.offer_legacy_id), observed_at: h.observed_at }));
  if (removedEv.length) await c.query(`INSERT INTO stock_event (offer_id, from_status, to_status, observed_at) SELECT offer_id, NULL, 'removed', observed_at
    FROM jsonb_to_recordset($1::jsonb) AS x(offer_id bigint, observed_at timestamptz) ON CONFLICT DO NOTHING`, [J(removedEv)]);
  // 7) Histórico: só o que é mais novo que o último registro do robô
  const last = (await c.query(`SELECT max(observed_at) AS m FROM price_history WHERE source = 'robot'`)).rows[0].m;
  const hist = hrows.filter((h) => !last || new Date(h.observed_at) > last)
    .map((h) => ({ ...h, offer_id: oid.get(h.offer_legacy_id), product_id: pid.get(h.product_legacy_id) }))
    .filter((h) => h.offer_id && h.product_id && h.event !== 'removed');
  for (const m of new Set(hist.map((h) => h.observed_at.slice(0, 7)))) await ensureMonth(c, m + '-01T00:00:00Z');
  const hr = hist.length ? await c.query(`INSERT INTO price_history (offer_id, product_id, price, shipping_price, total_price, stock_status, observed_at, source)
    SELECT offer_id, product_id, price, shipping_price, total_price, stock_status, observed_at, 'robot' FROM jsonb_to_recordset($1::jsonb)
      AS x(offer_id bigint, product_id bigint, price numeric, shipping_price numeric, total_price numeric, stock_status text, observed_at timestamptz)
    ON CONFLICT (offer_id, observed_at) DO NOTHING`, [J(hist)]) : { rowCount: 0 };
  stats.history = hr.rowCount;
  // 8) Janelas de leitura não confiável (usadas pelo Price Engine)
  const dist = distrustRows(state.distrust);
  if (dist.length) await c.query(`INSERT INTO source_distrust (store_id, until_day, reason) SELECT store_id, until_day, reason
    FROM jsonb_to_recordset($1::jsonb) AS x(store_id text, until_day date, reason text)
    ON CONFLICT (store_id) DO UPDATE SET until_day = EXCLUDED.until_day, reason = EXCLUDED.reason, updated_at = now()
    WHERE (source_distrust.until_day, source_distrust.reason) IS DISTINCT FROM (EXCLUDED.until_day, EXCLUDED.reason)`, [J(dist)]);
  stats.distrustStores = dist.length;
  stats.historySkipped = hrows.filter((h) => !oid.get(h.offer_legacy_id)).length;
  log(stats);
  return stats;
}
