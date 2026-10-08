// Validação do Marketplace Core num banco real (Supabase ou Postgres compatível).
// Sincroniza a pasta data/ duas vezes, confere contagens e invariantes e grava um relatório JSON.
// Não altera nada além do que db-sync já altera. Nunca imprime a URL do banco.
// Uso: DATABASE_URL=... node tools/db-validate.mjs <pasta-data> <saida.json> [logs-de-migration...]
import fs from 'node:fs';
import path from 'node:path';
import { pool, tx, close } from '../src/db/pg.js';
import { syncState } from '../src/core/sync.js';
import { runPriceEngine } from '../src/core/price-stats.js';
import { runOpportunityEngine, loadOpportunityInputs, computeOpportunities } from '../src/core/opportunity-run.js';
import { importReferences } from '../src/core/reference-import.js';

const [dir = 'data', out = 'db-validation.json', ...migLogs] = process.argv.slice(2);
const rep = { at: new Date().toISOString(), checks: [], errors: [] };
const check = (name, ok, detail) => rep.checks.push({ name, ok: !!ok, detail });
const p = await pool();
const q = async (sql, a = []) => (await p.query(sql, a)).rows;
const one = async (sql, a) => (await q(sql, a))[0];
const n = async (sql, a) => Number(Object.values(await one(sql, a))[0]);

try {
  // ---------- ambiente ----------
  rep.env = await one(`SELECT current_setting('server_version') AS server_version, current_setting('server_version_num') AS version_num,
    version() AS version, current_user AS db_user, current_setting('search_path') AS search_path,
    current_setting('TimeZone') AS timezone, current_setting('max_connections') AS max_connections,
    (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS ssl`);
  rep.env.extensions = (await q('SELECT extname, extversion FROM pg_extension ORDER BY 1')).map((r) => `${r.extname} ${r.extversion}`);
  rep.env.supabase = rep.env.extensions.some((e) => /^(supabase_vault|pg_graphql|pgsodium)/.test(e)) || (await n(`SELECT count(*) FROM pg_namespace WHERE nspname IN ('auth','storage','realtime')`)) > 0;
  rep.env.exposed_schemas_note = 'schema hunter não está em public; a API REST do Supabase só expõe os schemas configurados (padrão: public, graphql_public).';
  check('search_path aplicado na conexão (startup options)', /hunter/.test(rep.env.search_path), rep.env.search_path);
  check('gen_random_uuid disponível', (await one('SELECT gen_random_uuid() IS NOT NULL AS ok')).ok);

  // ---------- migrations ----------
  rep.migrations = await q('SELECT version, applied_at FROM hunter.schema_migrations ORDER BY version');
  rep.migrationLogs = Object.fromEntries(migLogs.filter((f) => fs.existsSync(f)).map((f) => [path.basename(f), fs.readFileSync(f, 'utf8').trim()]));
  check('migrations 001 e 002 registradas', ['001_core.sql', '002_seed.sql'].every((v) => rep.migrations.some((m) => m.version === v)));
  rep.objects = await one(`SELECT
    count(*) FILTER (WHERE c.relkind IN ('r','p') AND NOT c.relispartition) AS tables,
    count(*) FILTER (WHERE c.relkind = 'r' AND c.relispartition) AS partitions,
    count(*) FILTER (WHERE c.relkind = 'v') AS views,
    count(*) FILTER (WHERE c.relkind = 'i') AS indexes
    FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace WHERE s.nspname = 'hunter'`);
  rep.objects.constraints = await n(`SELECT count(*) FROM pg_constraint c JOIN pg_namespace s ON s.oid = c.connamespace WHERE s.nspname = 'hunter'`);

  // ---------- dados de origem ----------
  const state = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
  const hf = path.join(dir, 'history.jsonl');
  const lines = fs.existsSync(hf) ? fs.readFileSync(hf, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const catalog = JSON.parse(fs.readFileSync(new URL('../config/catalog.json', import.meta.url), 'utf8'));
  rep.source = { generatedAt: state.generatedAt || state.updatedAt || null, products: state.products?.length, offers: state.offers?.length, stale: (state.offers || []).filter((o) => o.stale).length,
    stores: state.sources?.length, historyLines: lines.length, priceLines: lines.filter((h) => h.price != null).length };

  // ---------- sincronização real, duas vezes ----------
  const snap = async () => Object.fromEntries(await Promise.all(['product', 'collection', 'store', 'seller', 'offer', 'price_history', 'stock_event', 'shipping_quote', 'reference_price', 'review_item']
    .map(async (t) => [t, await n(`SELECT count(*) FROM hunter.${t}`)])));
  const before = await snap();
  let t0 = Date.now();
  rep.sync1 = { stats: await tx((c) => syncState(c, { state, catalog, historyLines: lines })), seconds: (Date.now() - t0) / 1000 };
  const mid = await snap();
  t0 = Date.now();
  rep.sync2 = { stats: await tx((c) => syncState(c, { state, catalog, historyLines: lines })), seconds: (Date.now() - t0) / 1000 };
  const after = await snap();
  rep.snapshots = { before, afterSync1: mid, afterSync2: after };
  check('2ª sincronização não insere histórico', rep.sync2.stats.history === 0, rep.sync2.stats.history);
  check('2ª sincronização não muda contagens', JSON.stringify(mid) === JSON.stringify(after), { mid, after });

  // ---------- contagens ----------
  rep.counts = {
    tcg: await q('SELECT id, collect_enabled FROM hunter.tcg ORDER BY sort'),
    categories: await one(`SELECT count(*) FILTER (WHERE kind='group') AS groups, count(*) FILTER (WHERE kind='type') AS types FROM hunter.category`),
    collections: await n('SELECT count(*) FROM hunter.collection'),
    products: await n('SELECT count(*) FROM hunter.product'),
    productsByCategory: await q('SELECT category_id, count(*)::int n FROM hunter.product GROUP BY 1 ORDER BY 2 DESC'),
    identifiers: await n('SELECT count(*) FROM hunter.product_identifier'),
    marketplaces: await n('SELECT count(*) FROM hunter.marketplace'),
    stores: await q('SELECT status, count(*)::int n FROM hunter.store GROUP BY 1 ORDER BY 1'),
    storeChannels: await n('SELECT count(*) FROM hunter.store_channel'),
    sellers: await q('SELECT marketplace_id, count(*)::int n, count(*) FILTER (WHERE external_id ~ \'^[0-9]+$\')::int numeric_ids FROM hunter.seller GROUP BY 1'),
    offers: await q('SELECT status, count(*)::int n FROM hunter.offer GROUP BY 1 ORDER BY 1'),
    offersActive: await one(`SELECT count(*)::int total,
      count(*) FILTER (WHERE stock_status='in_stock')::int in_stock,
      count(*) FILTER (WHERE shipping_status<>'unknown')::int shipping_known,
      count(*) FILTER (WHERE total_price IS NOT NULL)::int with_total,
      count(*) FILTER (WHERE marketplace_id='mercadolivre')::int mercadolivre,
      count(*) FILTER (WHERE marketplace_id='mercadolivre' AND seller_id IS NULL)::int ml_without_seller
      FROM hunter.offer WHERE status='active'`),
    priceHistory: await n('SELECT count(*) FROM hunter.price_history'),
    historyByPartition: await q(`SELECT tableoid::regclass::text AS partition, count(*)::int n, min(observed_at) AS first, max(observed_at) AS last FROM hunter.price_history GROUP BY 1 ORDER BY 1`),
    stockEvents: await q('SELECT to_status, count(*)::int n FROM hunter.stock_event GROUP BY 1 ORDER BY 1'),
    shippingQuotes: await n('SELECT count(*) FROM hunter.shipping_quote'),
    references: await q('SELECT verification_status AS status, count(*)::int n FROM hunter.reference_price GROUP BY 1'),
    referenceCurrent: await n('SELECT count(*) FROM hunter.reference_price_current'),
    affiliatePrograms: await q('SELECT id, status FROM hunter.affiliate_program ORDER BY 1'),
    roles: await q('SELECT r.id, count(rp.permission_id)::int permissions FROM hunter.role r LEFT JOIN hunter.role_permission rp ON rp.role_id = r.id GROUP BY 1 ORDER BY 1'),
    emptyTables: (await q(`SELECT c.relname FROM pg_class c JOIN pg_namespace s ON s.oid=c.relnamespace
      WHERE s.nspname='hunter' AND c.relkind IN ('r','p') AND NOT c.relispartition ORDER BY 1`)).map((r) => r.relname),
  };
  const empties = [];
  for (const t of rep.counts.emptyTables) if ((await n(`SELECT count(*) FROM hunter.${t}`)) === 0) empties.push(t);
  rep.counts.emptyTables = empties;

  // ---------- invariantes ----------
  check('9 TCGs, só Pokémon com coleta', rep.counts.tcg.length === 9 && rep.counts.tcg.filter((t) => t.collect_enabled).map((t) => t.id).join() === 'pokemon');
  check('8 grupos e 47 tipos de categoria', Number(rep.counts.categories.groups) === 8 && Number(rep.counts.categories.types) === 47, rep.counts.categories);
  const live = await one(`SELECT count(*) FILTER (WHERE status='active')::int active, count(*) FILTER (WHERE status='pending')::int pending FROM hunter.offer`);
  check('ofertas vivas (ativas + pendentes) = ofertas do state.json', live.active + live.pending === rep.source.offers, { ...live, state: rep.source.offers, stale: rep.source.stale });
  check('pendentes = ofertas "stale" do state.json', live.pending === rep.source.stale, { pending: live.pending, stale: rep.source.stale });
  check('produtos = state.json − duplicatas', rep.counts.products === rep.source.products - rep.sync1.stats.duplicatesToReview, { db: rep.counts.products, state: rep.source.products, dups: rep.sync1.stats.duplicatesToReview });
  const removedWithHist = await one(`SELECT count(DISTINCT o.id)::int offers, count(h.*)::int rows FROM hunter.offer o JOIN hunter.price_history h ON h.offer_id = o.id WHERE o.status='removed'`);
  rep.removedOffers = removedWithHist;
  check('ofertas removidas continuam no histórico', removedWithHist.rows > 0, removedWithHist);
  const orphan = await n('SELECT count(*) FROM hunter.price_history h WHERE NOT EXISTS (SELECT 1 FROM hunter.offer o WHERE o.id = h.offer_id)');
  check('histórico sem oferta órfã', orphan === 0, orphan);
  check('histórico do banco cobre as linhas de preço (− puladas)', rep.counts.priceHistory >= rep.source.priceLines - rep.sync1.stats.historySkipped,
    { db: rep.counts.priceHistory, priceLines: rep.source.priceLines, skipped: rep.sync1.stats.historySkipped });
  const invented = await n(`SELECT count(*) FROM hunter.offer WHERE total_price IS NOT NULL AND shipping_status='unknown'`);
  check('nenhum total com frete desconhecido', invented === 0, invented);
  // o banco recusa total inventado (transação desfeita, nada fica gravado)
  const c = await p.connect();
  try {
    await c.query('BEGIN');
    let refused = false;
    try { await c.query(`INSERT INTO hunter.offer (product_id, marketplace_id, title_raw, url, total_price, shipping_status) SELECT id,'direct','validacao','validacao',10,'unknown' FROM hunter.product LIMIT 1`); }
    catch (e) { refused = /check/i.test(e.message) || e.code === '23514'; }
    check('banco recusa total inventado (CHECK)', refused);
  } finally { await c.query('ROLLBACK'); c.release(); }

  // ---------- review queue ----------
  rep.review = await q(`SELECT category, status, entity_type, entity_id, proposal, dedupe_key, created_at FROM hunter.review_item ORDER BY category, entity_id`);
  check('duplicatas na review_item', rep.review.filter((r) => r.category === 'duplicate_product').length === rep.sync1.stats.duplicatesToReview && rep.sync1.stats.duplicatesToReview > 0,
    { review: rep.review.length, dups: rep.sync1.stats.duplicatesToReview });

  // ---------- revisão: duplicatas legadas rejeitadas, com auditoria ----------
  rep.reviewDecisions = await q(`SELECT entity_id, status, decision_reason, decided_by_label, decided_at FROM hunter.review_item WHERE category = 'duplicate_product' ORDER BY entity_id`);
  rep.reviewAudit = await q(`SELECT entity_id, payload FROM hunter.system_event WHERE type = 'REVIEW_DECIDED' ORDER BY id`);
  check('7 duplicatas legadas rejeitadas com motivo (sem apagar)', rep.reviewDecisions.length === 7 && rep.reviewDecisions.every((r) => r.status === 'rejected' && /duplicate legacy/.test(r.decision_reason || '')), rep.reviewDecisions.map((r) => r.entity_id + ':' + r.status));
  check('trilha de auditoria: 7 eventos REVIEW_DECIDED', rep.reviewAudit.length === 7, rep.reviewAudit.length);
  check('nenhum item de revisão aberto após 2 sincronizações', (await n(`SELECT count(*) FROM hunter.review_item WHERE status = 'open'`)) === 0);

  // ---------- REFERENCE IMPORT + REFERENCE POLICY (Fases 5.6/6A): importação e regras da tabela ----------
  // (as regras da referência ATUAL resolvida ficam logo após o Price Engine, que é quem a resolve)
  const refsBefore = await n('SELECT count(*) FROM hunter.reference_price');
  const impFile = JSON.parse(fs.readFileSync(new URL('../db/reference-imports/2026-10-08-copag-audit.json', import.meta.url), 'utf8'));
  rep.references = { import1: await tx((c) => importReferences(c, impFile)), import2: await tx((c) => importReferences(c, impFile)) };
  const imp2 = rep.references.import2;
  check('importação de referências idempotente (2ª não escreve)', imp2.inserted === 0 && imp2.updated === 0 && imp2.identifiers.written === 0, imp2);
  check('importação: nenhuma entrada recusada', rep.references.import1.rejected.length === 0, rep.references.import1.rejected);
  check('nenhuma referência apagada', (await n('SELECT count(*) FROM hunter.reference_price')) >= refsBefore);
  check('6 matches ambíguos fora da importação', (await n(`SELECT count(*) FROM hunter.reference_price r JOIN hunter.product p ON p.id = r.product_id
    WHERE r.source IN ('copag_blog', 'copag_loja_catalog') AND p.legacy_id = ANY($1)`, [impFile.excluded])) === 0 && impFile.excluded.length === 6);
  check('toda referência tem tipo', (await n('SELECT count(*) FROM hunter.reference_price WHERE reference_kind IS NULL')) === 0);
  check('Copag oficial só com fonte no domínio Copag', (await n(`SELECT count(*) FROM hunter.reference_price WHERE reference_kind LIKE 'COPAG_OFFICIAL%'
    AND source_url !~* '^https?://([a-z0-9-]+\\.)*copag(loja)?\\.com\\.br(/|$)'`)) === 0);
  check('referência atual nunca é histórica nem comunitária (view)', (await n(`SELECT count(*) FROM hunter.reference_price_current WHERE reference_scope <> 'current'`)) === 0);
  check('referência de fora do domínio Copag não é Copag oficial (13 do Instagram)', (await n(`SELECT count(*) FROM hunter.reference_price
    WHERE source = 'manual' AND source_url ~* 'instagram' AND reference_kind <> 'COMMUNITY_REFERENCE'`)) === 0);
  check('confiança média importada continua média e pendente', (await n(`SELECT count(*) FROM hunter.reference_price WHERE source IN ('copag_blog', 'copag_loja_catalog')
    AND confidence = 60 AND verification_status <> 'pending'`)) === 0);
  check('nenhuma correção automática: preço histórico importado = preço da página', (await n(`SELECT count(*) FROM hunter.reference_price r
    JOIN jsonb_to_recordset($1::jsonb) AS x(legacy_id text, value numeric, source text) ON x.source = r.source
    JOIN hunter.product p ON p.id = r.product_id AND p.legacy_id = x.legacy_id WHERE r.value <> x.value`, [JSON.stringify(impFile.entries)])) === 0
    && (await n(`SELECT count(*) FROM hunter.reference_price WHERE source IN ('copag_blog', 'copag_loja_catalog')`)) === impFile.entries.length);
  rep.references.conflicts = await q(`SELECT p.legacy_id, array_agg(DISTINCT r.value ORDER BY r.value) AS values, array_agg(DISTINCT r.source) AS sources
    FROM hunter.reference_price r JOIN hunter.product p ON p.id = r.product_id WHERE r.reference_scope = 'current' AND r.verification_status = 'verified'
    GROUP BY 1 HAVING count(DISTINCT r.value) > 1`);
  check('sem conflito de valor entre referências atuais verificadas', rep.references.conflicts.length === 0, rep.references.conflicts);
  rep.references.byKind = await q(`SELECT reference_kind, reference_scope, verification_status, count(*)::int n FROM hunter.reference_price GROUP BY 1, 2, 3 ORDER BY 1, 3`);
  rep.references.byConfidence = await q(`SELECT CASE WHEN confidence >= 85 THEN 'alta' WHEN confidence >= 50 THEN 'média' ELSE 'baixa' END AS label, count(*)::int n
    FROM hunter.reference_price GROUP BY 1 ORDER BY 1`);
  rep.references.products = await one(`SELECT count(*)::int total,
    count(*) FILTER (WHERE EXISTS (SELECT 1 FROM hunter.reference_price_current c WHERE c.product_id = p.id))::int with_current,
    count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM hunter.reference_price_current c WHERE c.product_id = p.id)
      AND EXISTS (SELECT 1 FROM hunter.reference_price r WHERE r.product_id = p.id AND r.reference_scope = 'historical'))::int only_historical,
    count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM hunter.reference_price_current c WHERE c.product_id = p.id)
      AND EXISTS (SELECT 1 FROM hunter.reference_price r WHERE r.product_id = p.id AND r.reference_scope = 'community'))::int only_community,
    count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM hunter.reference_price_current c WHERE c.product_id = p.id))::int without_current,
    count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM hunter.reference_price r WHERE r.product_id = p.id))::int without_any
    FROM hunter.product p`);
  rep.references.total = await n('SELECT count(*) FROM hunter.reference_price');

  // ---------- Price Engine ----------
  const histRows = await n('SELECT count(*) FROM hunter.price_history');
  rep.priceEngine = { run1: await tx((c) => runPriceEngine(c)), run2: await tx((c) => runPriceEngine(c)) };
  check('Price Engine idempotente (2ª execução não escreve nada)', rep.priceEngine.run2.statsWritten === 0 && rep.priceEngine.run2.dailyWritten === 0 && rep.priceEngine.run2.dailyDeleted === 0, rep.priceEngine.run2);
  check('Price Engine não altera price_history', (await n('SELECT count(*) FROM hunter.price_history')) === histRows);
  check('product_stats: 1 linha por produto', (await n('SELECT count(*) FROM hunter.product_stats')) === (await n('SELECT count(*) FROM hunter.product')));
  rep.priceEngine.status = await q(`SELECT data_status, history_status, count(*)::int n FROM hunter.product_stats GROUP BY 1, 2 ORDER BY 1, 2`);
  rep.priceEngine.daily = await one(`SELECT count(*)::int rows, count(DISTINCT product_id)::int products, min(day)::text first, max(day)::text last FROM hunter.price_daily`);
  rep.priceEngine.coverage = await one(`SELECT count(current_price)::int with_current, count(current_total_price)::int with_total, count(discount_vs_reference)::int with_discount,
    count(variation_24h)::int with_var24h, count(variation_7d)::int with_var7d, count(variation_30d)::int with_var30d, count(historical_min)::int with_history,
    sum((quality->>'untrusted_points')::int)::int untrusted_points, sum((quality->>'implausible_points')::int)::int implausible_points,
    sum((quality->>'implausible')::int)::int implausible_offers, sum((quality->>'unconfirmed')::int)::int unconfirmed_offers FROM hunter.product_stats`);
  // regras invioláveis
  check('total atual só de oferta com frete conhecido', (await n(`SELECT count(*) FROM hunter.product_stats s JOIN hunter.offer o ON o.id = s.current_total_offer_id WHERE o.shipping_status = 'unknown' OR o.total_price IS NULL`)) === 0);
  check('preço atual só de oferta ativa, em estoque e com o mesmo preço', (await n(`SELECT count(*) FROM hunter.product_stats s JOIN hunter.offer o ON o.id = s.current_offer_id
    WHERE o.status <> 'active' OR o.stock_status <> 'in_stock' OR o.price <> s.current_price OR o.product_id <> s.product_id`)) === 0);
  // ---------- REFERENCE POLICY (Fase 6A): referência ATUAL = Copag atual > mercado robusto > NONE ----------
  check('referência atual: só COPAG_OFFICIAL_CURRENT, MARKET_CURRENT ou NONE', (await n(`SELECT count(*) FROM hunter.product_stats
    WHERE reference_kind IS NULL OR reference_kind NOT IN ('COPAG_OFFICIAL_CURRENT', 'MARKET_CURRENT', 'NONE')`)) === 0);
  check('desconto só com referência atual (NONE nunca tem desconto)', (await n(`SELECT count(*) FROM hunter.product_stats
    WHERE discount_vs_reference IS NOT NULL AND reference_kind = 'NONE'`)) === 0);
  check('Copag atual na referência ⇔ linha verificada em reference_price_current (mesmo valor)', (await n(`SELECT count(*) FROM hunter.product_stats s
    FULL JOIN (SELECT * FROM hunter.reference_price_current WHERE reference_kind = 'COPAG_OFFICIAL_CURRENT') c ON c.product_id = s.product_id
    WHERE (s.reference_kind = 'COPAG_OFFICIAL_CURRENT') <> (c.product_id IS NOT NULL) OR (c.product_id IS NOT NULL AND s.reference_price <> c.value)`)) === 0);
  check('mercado só sem Copag atual e com critério robusto (≥ 3 ofertas, ≥ 2 fontes independentes)', (await n(`SELECT count(*) FROM hunter.product_stats
    WHERE reference_kind = 'MARKET_CURRENT' AND (reference_reason <> 'robust_current_market' OR (quality->'market_reference'->>'ok')::boolean IS NOT TRUE
      OR (quality->'market_reference'->>'offers')::int < 3 OR (quality->'market_reference'->>'sources')::int < 2 OR number_of_in_stock_offers < 3)`)) === 0);
  // fontes independentes recontadas em SQL: loja tradicional = 1; vendedor de marketplace = 1 (por id estável); anúncios repetidos não somam;
  // loja em janela de desconfiança não conta. As fontes gravadas nunca podem passar dessa contagem (nem do nº de ofertas).
  const srcSql = `WITH s AS (SELECT product_id, as_of_day, (quality->>'anchor')::numeric AS anchor, (quality->'market_reference'->>'sources')::int AS src,
        (quality->'market_reference'->>'offers')::int AS offs, quality->'market_reference'->>'composition' AS comp, reference_confidence::float8 AS rconf,
        reference_kind, reference_price FROM hunter.product_stats),
      e AS (SELECT o.product_id, o.price, (o.marketplace_id <> 'direct') AS mk, CASE WHEN o.marketplace_id <> 'direct' AND se.external_id IS NOT NULL THEN o.marketplace_id || ':' || se.external_id ELSE 'store:' || o.store_id END AS k
        FROM hunter.offer o JOIN hunter.product p ON p.id = o.product_id JOIN s ON s.product_id = o.product_id LEFT JOIN hunter.seller se ON se.id = o.seller_id
       WHERE o.status = 'active' AND o.confirmed AND o.price > 0 AND o.stock_status = 'in_stock' AND o.condition = p.condition
         AND (s.anchor IS NULL OR (o.price >= round(s.anchor * 0.55, 2) AND o.price <= round(s.anchor * 3, 2)))
         AND NOT EXISTS (SELECT 1 FROM hunter.source_distrust d WHERE d.store_id = o.store_id AND d.until_day >= s.as_of_day))
    SELECT s.product_id, s.src, s.offs, s.comp, s.rconf, s.reference_kind, s.reference_price, count(DISTINCT e.k)::int AS keys, count(e.k)::int AS n,
           count(DISTINCT e.k) FILTER (WHERE NOT e.mk)::int AS direct_keys, count(DISTINCT e.k) FILTER (WHERE e.mk)::int AS mk_keys,
           round(percentile_cont(0.5) WITHIN GROUP (ORDER BY e.price)::numeric, 2) AS med
      FROM s LEFT JOIN e ON e.product_id = s.product_id GROUP BY 1, 2, 3, 4, 5, 6, 7`;
  const srcRows = await q(srcSql);
  const srcBad = srcRows.filter((r) => r.src != null && (r.src > r.keys || r.offs > r.n));
  check('fontes independentes: vendedor repetido e loja em desconfiança não contam (recontagem em SQL)', srcBad.length === 0, srcBad.slice(0, 5));
  const medBad = srcRows.filter((r) => r.reference_kind === 'MARKET_CURRENT' && (r.src !== r.keys || Math.abs(Number(r.med) - Number(r.reference_price)) > 0.005));
  check('referência de mercado = mediana das ofertas elegíveis de fontes confiáveis (SQL)', medBad.length === 0, medBad.slice(0, 5));
  // Fase 6A.2: composição recontada em SQL (loja tradicional × fonte de marketplace) e confiança coerente com ela
  const compOf = (d, m) => (!d && !m ? 'NONE' : !m ? 'MARKET_STORES' : !d ? 'MARKETPLACE_ONLY' : 'MARKET_MIXED');
  const compBad = srcRows.filter((r) => r.reference_kind === 'MARKET_CURRENT' && r.comp !== compOf(r.direct_keys, r.mk_keys));
  check('composição do mercado correta (lojas tradicionais × marketplace, recontagem em SQL)', compBad.length === 0, compBad.slice(0, 5));
  const confBad = srcRows.filter((r) => r.reference_kind === 'MARKET_CURRENT' && Math.abs(r.rconf - Math.round((0.6 + Math.min(0.15, 0.05 * (r.offs - 3)) + Math.min(0.1, 0.05 * (r.src - 2)))
    * (r.comp === 'MARKETPLACE_ONLY' ? 0.85 : 1) * 1000) / 1000) > 0.0005);
  check('confiança da referência de mercado coerente com a composição (só marketplace × 0,85)', confBad.length === 0, confBad.slice(0, 5));
  rep.referencePolicy = rep.referencePolicy || {};
  rep.referencePolicy.composition = await q(`SELECT quality->'market_reference'->>'composition' AS composition, count(*)::int n,
      round(avg(reference_confidence), 3)::float8 AS ref_conf_avg, min(reference_confidence)::float8 AS ref_conf_min, max(reference_confidence)::float8 AS ref_conf_max
    FROM hunter.product_stats WHERE reference_kind = 'MARKET_CURRENT' GROUP BY 1 ORDER BY 1`);
  rep.referencePolicy.marketSources = await q(`SELECT (quality->'market_reference'->>'sources')::int AS sources, count(*)::int n FROM hunter.product_stats
    WHERE reference_kind = 'MARKET_CURRENT' GROUP BY 1 ORDER BY 1`);
  check('COPAG_OFFICIAL_HISTORICAL nunca é referência atual', (await n(`SELECT count(*) FROM hunter.product_stats s
    WHERE s.reference_kind = 'COPAG_OFFICIAL_CURRENT' AND NOT EXISTS (SELECT 1 FROM hunter.reference_price r WHERE r.product_id = s.product_id
      AND r.reference_kind = 'COPAG_OFFICIAL_CURRENT' AND r.verification_status = 'verified' AND r.value = s.reference_price)`)) === 0);
  check('COMMUNITY_REFERENCE nunca é referência atual', (await n(`SELECT count(*) FROM hunter.product_stats s
    JOIN hunter.reference_price r ON r.product_id = s.product_id AND r.reference_scope = 'community'
    WHERE s.reference_kind = 'COPAG_OFFICIAL_CURRENT' AND NOT EXISTS (SELECT 1 FROM hunter.reference_price_current c WHERE c.product_id = s.product_id AND c.reference_kind = 'COPAG_OFFICIAL_CURRENT')`)) === 0);
  check('mercado é derivado (nenhuma linha MARKET_* gravada em reference_price)', (await n(`SELECT count(*) FROM hunter.reference_price WHERE reference_kind IN ('MARKET_CURRENT', 'MARKET_HISTORICAL')`)) === 0);
  check('confiança da referência atual: Copag = linha/100; mercado 0,51–0,85; NONE nula', (await n(`SELECT count(*) FROM hunter.product_stats s
    WHERE (s.reference_kind = 'NONE' AND s.reference_confidence IS NOT NULL) OR (s.reference_kind = 'MARKET_CURRENT' AND NOT (s.reference_confidence BETWEEN 0.51 AND 0.85))
      OR (s.reference_kind = 'COPAG_OFFICIAL_CURRENT' AND s.reference_confidence IS DISTINCT FROM (SELECT c.confidence / 100.0 FROM hunter.reference_price_current c WHERE c.product_id = s.product_id))`)) === 0);
  rep.referencePolicy = { ...(rep.referencePolicy || {}), byKind: await q(`SELECT reference_kind, count(*)::int n, count(*) FILTER (WHERE number_of_in_stock_offers > 0)::int with_stock FROM hunter.product_stats GROUP BY 1 ORDER BY 1`),
    noneReasons: await q(`SELECT reference_reason, count(*)::int n FROM hunter.product_stats WHERE reference_kind = 'NONE' GROUP BY 1 ORDER BY 2 DESC`),
    onlyHistorical: await n(`SELECT count(*) FROM hunter.product_stats s WHERE s.reference_kind = 'NONE' AND EXISTS (SELECT 1 FROM hunter.reference_price r WHERE r.product_id = s.product_id AND r.reference_scope = 'historical')`),
    onlyCommunity: await n(`SELECT count(*) FROM hunter.product_stats s WHERE s.reference_kind = 'NONE' AND EXISTS (SELECT 1 FROM hunter.reference_price r WHERE r.product_id = s.product_id AND r.reference_scope = 'community')`) };
  check('histórico só com dias suficientes', (await n(`SELECT count(*) FROM hunter.product_stats WHERE (historical_min IS NOT NULL) <> (history_status = 'ok')`)) === 0);
  // reprodução independente em SQL: preço atual (elegibilidade com a âncora gravada) e histórico (a partir de price_daily)
  const sqlCur = await q(`WITH s AS (SELECT product_id, (quality->>'anchor')::numeric AS anchor FROM hunter.product_stats),
    e AS (SELECT o.product_id, o.price, o.total_price, o.shipping_status, o.store_id FROM hunter.offer o JOIN hunter.product p ON p.id = o.product_id JOIN s ON s.product_id = o.product_id
      WHERE o.status = 'active' AND o.price > 0 AND o.confirmed AND o.condition = p.condition AND o.stock_status = 'in_stock'
        AND (s.anchor IS NULL OR (o.price >= round(s.anchor * 0.55, 2) AND o.price <= round(s.anchor * 3, 2))))
    SELECT product_id, min(price) mn, max(price) mx, round(avg(price), 2) av, round(percentile_cont(0.5) WITHIN GROUP (ORDER BY price)::numeric, 2) md, count(*)::int n,
      min(total_price) FILTER (WHERE shipping_status <> 'unknown') tot FROM e GROUP BY product_id`);
  const st = new Map((await q('SELECT * FROM hunter.product_stats')).map((r) => [String(r.product_id), r]));
  const eq = (a, b) => (a == null && b == null) || (a != null && b != null && Math.abs(Number(a) - Number(b)) < 0.005);
  const curDiff = sqlCur.filter((r) => { const x = st.get(String(r.product_id)); return !x || !eq(x.current_price, r.mn) || !eq(x.highest_current_price, r.mx) || !eq(x.average_price, r.av) || !eq(x.median_price, r.md) || x.number_of_in_stock_offers !== r.n || !eq(x.current_total_price, r.tot); });
  const okCount = [...st.values()].filter((x) => x.current_price != null).length;
  check('preço atual reproduzido em SQL (mín, máx, média, mediana, total, contagem)', curDiff.length === 0 && sqlCur.length === okCount, { sql: sqlCur.length, engine: okCount, diffs: curDiff.slice(0, 5) });
  const sqlHist = await q(`SELECT product_id, min(min_price) mn, max(min_price) mx, round(avg(min_price), 2) av, round(percentile_cont(0.5) WITHIN GROUP (ORDER BY min_price)::numeric, 2) md, count(*)::int d
    FROM hunter.price_daily WHERE store_id = '' GROUP BY product_id`);
  const histDiff = sqlHist.filter((r) => { const x = st.get(String(r.product_id)); if (!x || x.history_days !== r.d) return true; if (x.history_status !== 'ok') return x.historical_min != null;
    return !eq(x.historical_min, r.mn) || !eq(x.historical_max, r.mx) || !eq(x.historical_average, r.av) || !eq(x.historical_median, r.md); });
  check('histórico reproduzido em SQL a partir de price_daily', histDiff.length === 0, histDiff.slice(0, 5));
  rep.priceEngine.samples = await q(`SELECT p.legacy_id, s.current_price, s.current_total_price, s.lowest_current_price, s.highest_current_price, s.average_price, s.median_price,
    s.history_days, s.history_status, s.variation_24h, s.reference_price, s.discount_vs_reference, s.number_of_active_offers, s.number_of_in_stock_offers, s.number_of_stores,
    s.number_of_marketplaces, s.shipping_coverage, s.quality FROM hunter.product_stats s JOIN hunter.product p ON p.id = s.product_id
    WHERE s.data_status = 'ok' ORDER BY s.number_of_in_stock_offers DESC, p.legacy_id LIMIT 5`);

  // ---------- Opportunity Engine ----------
  const evBefore = await n(`SELECT count(*) FROM hunter.system_event WHERE type LIKE 'OPPORTUNITY_%'`);
  rep.opportunity = { run1: await tx((c) => runOpportunityEngine(c)), run2: await tx((c) => runOpportunityEngine(c)) };
  check('Opportunity Engine idempotente (2ª execução não escreve nem emite eventos)', rep.opportunity.run2.written === 0 && rep.opportunity.run2.removed === 0 && Object.keys(rep.opportunity.run2.events).length === 0, rep.opportunity.run2);
  check('oportunidade: anomalia nunca ≥ 50', (await n(`SELECT count(*) FROM hunter.opportunity WHERE is_anomaly AND opportunity_score >= 50`)) === 0);
  check('oportunidade: sem estoque nunca > 30', (await n(`SELECT count(*) FROM hunter.opportunity WHERE stock_signal = 0 AND opportunity_score > 30`)) === 0);
  check('oportunidade: sinal de referência ⇔ referência atual (nunca histórica/comunitária)', (await n(`SELECT count(*) FROM hunter.opportunity o JOIN hunter.product_stats s ON s.product_id = o.product_id
    WHERE (o.reference_signal IS NOT NULL) <> (s.reference_kind <> 'NONE')`)) === 0);
  check('oportunidade: NONE gera aviso NO_CURRENT_REFERENCE', (await n(`SELECT count(*) FROM hunter.opportunity o JOIN hunter.product_stats s ON s.product_id = o.product_id
    WHERE s.reference_kind = 'NONE' AND NOT o.warnings @> '[{"code":"NO_CURRENT_REFERENCE"}]'`)) === 0);
  check('oportunidade: referência comunitária só como aviso (todo produto com ela tem o aviso)', (await n(`SELECT count(*) FROM hunter.opportunity o
    WHERE EXISTS (SELECT 1 FROM hunter.reference_price r WHERE r.product_id = o.product_id AND r.reference_scope = 'community')
      AND NOT (o.warnings @> '[{"code":"COMMUNITY_REFERENCE"}]' OR o.warnings @> '[{"code":"COMMUNITY_REFERENCE_ONLY"}]')`)) === 0);
  check('oportunidade: com mercado como referência, o sinal de mercado não conta de novo', (await n(`SELECT count(*) FROM hunter.opportunity o JOIN hunter.product_stats s ON s.product_id = o.product_id
    WHERE s.reference_kind = 'MARKET_CURRENT' AND (o.market_signal IS NOT NULL OR o.reasons @> '[{"code":"BELOW_MARKET"}]' OR o.reasons @> '[{"code":"ABOVE_MARKET"}]')`)) === 0);
  check('oportunidade: com Copag atual, referência e mercado seguem independentes', (await n(`SELECT count(*) FROM hunter.opportunity o JOIN hunter.product_stats s ON s.product_id = o.product_id
    WHERE s.reference_kind = 'COPAG_OFFICIAL_CURRENT' AND s.number_of_in_stock_offers >= 2 AND s.median_price > 0 AND o.market_signal IS NULL`)) === 0);
  check('oportunidade: aviso MARKETPLACE_ONLY ⇔ referência de mercado só de marketplace', (await n(`SELECT count(*) FROM hunter.opportunity o JOIN hunter.product_stats s ON s.product_id = o.product_id
    WHERE (s.reference_kind = 'MARKET_CURRENT' AND s.quality->'market_reference'->>'composition' = 'MARKETPLACE_ONLY') <> (o.warnings @> '[{"code":"MARKETPLACE_ONLY"}]')`)) === 0);
  check('oportunidade: aviso de desvio histórico só com mercado como referência e histórico disponível', (await n(`SELECT count(*) FROM hunter.opportunity o JOIN hunter.product_stats s ON s.product_id = o.product_id
    WHERE o.warnings @> '[{"code":"MARKET_HIGHLY_DEVIATED_FROM_HISTORY"}]' AND (s.reference_kind <> 'MARKET_CURRENT' OR (s.history_status <> 'ok'
      AND NOT EXISTS (SELECT 1 FROM hunter.reference_price r WHERE r.product_id = o.product_id AND r.reference_kind = 'COPAG_OFFICIAL_HISTORICAL')))`)) === 0);
  { // composição e avisos não mexem no score: recalcula as ofertas "só marketplace" como se o mercado fosse misto e sem contexto
    const inp = await tx((c) => loadOpportunityInputs(c));
    const mo = inp.stats.filter((x) => x.reference_kind === 'MARKET_CURRENT' && x.quality?.market_reference?.composition === 'MARKETPLACE_ONLY');
    const asIs = computeOpportunities({ ...inp, stats: mo });
    const asMixed = computeOpportunities({ ...inp, context: [], stats: mo.map((x) => ({ ...x, quality: { ...x.quality, market_reference: { ...x.quality.market_reference, composition: 'MARKET_MIXED' } } })) });
    const diff = []; asIs.forEach((r, i) => r.offers.forEach((o, j) => { const m = asMixed[i].offers[j]; if (o.opportunity_score !== m.opportunity_score) diff.push({ product: r.legacy_id, a: o.opportunity_score, b: m.opportunity_score }); }));
    check('composição/avisos de mercado não alteram o score (recálculo como misto, sem contexto)', diff.length === 0 && mo.length >= 0, { products: mo.length, diffs: diff.slice(0, 5) });
  }
  check('oportunidade: texto nunca chama mercado de Copag', (await n(`SELECT count(*) FROM hunter.opportunity o, jsonb_array_elements(o.reasons) x
    WHERE x->>'reference_kind' = 'MARKET_CURRENT' AND x->>'text' ILIKE '%copag%'`)) === 0);
  check('oportunidade: frete desconhecido → sinal nulo (nunca R$ 0)', (await n(`SELECT count(*) FROM hunter.opportunity o JOIN hunter.offer f ON f.id = o.offer_id
    WHERE f.shipping_status = 'unknown' AND o.freight_signal IS NOT NULL`)) === 0);
  check('oportunidade: histórico só com série suficiente', (await n(`SELECT count(*) FROM hunter.opportunity o JOIN hunter.product_stats s ON s.product_id = o.product_id
    WHERE o.historical_signal IS NOT NULL AND s.history_status <> 'ok'`)) === 0);
  check('oportunidade: faixa coerente com o score', (await n(`SELECT count(*) FROM hunter.opportunity WHERE opportunity_band <> CASE WHEN opportunity_score >= 90 THEN 'excelente'
    WHEN opportunity_score >= 75 THEN 'boa' WHEN opportunity_score >= 50 THEN 'normal' ELSE 'baixa' END`)) === 0);
  const jsBest = computeOpportunities(await tx((c) => loadOpportunityInputs(c)));
  const viewBest = new Map((await q(`SELECT product_id, offer_id FROM hunter.product_opportunity`)).map((r) => [String(r.product_id), String(r.offer_id)]));
  const bestDiff = jsBest.filter((r) => (r.best ? String(r.best.offer_id) : undefined) !== viewBest.get(r.product_id)).map((r) => r.legacy_id);
  check('melhor oportunidade: view SQL = código', bestDiff.length === 0, bestDiff.slice(0, 10));
  rep.opportunity.bands = await q(`SELECT opportunity_band, count(*)::int n, round(avg(confidence), 2)::float8 conf FROM hunter.opportunity GROUP BY 1 ORDER BY 1`);
  rep.opportunity.productBands = await q(`SELECT opportunity_band, count(*)::int n FROM hunter.product_opportunity GROUP BY 1 ORDER BY 1`);
  rep.opportunity.events = await q(`SELECT type, count(*)::int n FROM hunter.system_event WHERE type LIKE 'OPPORTUNITY_%' GROUP BY 1 ORDER BY 1`);
  rep.opportunity.newEvents = (await n(`SELECT count(*) FROM hunter.system_event WHERE type LIKE 'OPPORTUNITY_%'`)) - evBefore;
  rep.opportunity.top = await q(`SELECT p.legacy_id, f.legacy_id AS offer, f.store_id, o.price::float8, o.opportunity_score, o.opportunity_band, o.confidence::float8,
    (SELECT jsonb_agg(x->>'text') FROM jsonb_array_elements(o.reasons) x) reasons, (SELECT jsonb_agg(x->>'code') FROM jsonb_array_elements(o.warnings) x) warnings
    FROM hunter.product_opportunity o JOIN hunter.product p ON p.id = o.product_id JOIN hunter.offer f ON f.id = o.offer_id ORDER BY o.opportunity_score DESC, o.confidence DESC, p.legacy_id LIMIT 10`);

  // API (leitura do resultado persistido): contrato de oportunidades e referências
  process.env.API_DATABASE_URL = process.env.DATABASE_URL;
  const API = await import('../api/_lib/read-db.mjs');
  const opps = await API.listOpportunities({ page: 1, limit: 60 });
  const need = ['product', 'offer', 'price', 'total', 'stock', 'store', 'marketplace', 'opportunity_score', 'opportunity_band', 'confidence', 'current_reference', 'historical_context', 'community_reference', 'warnings', 'reasons', 'updated_at'];
  check('API /oportunidades: contrato completo e referência atual válida', opps.items.length > 0 && opps.items.every((x) => need.every((k) => k in x)
    && ['COPAG_OFFICIAL_CURRENT', 'MARKET_CURRENT', 'NONE'].includes(x.current_reference.kind) && x.historical_context.every((h) => h.kind.endsWith('_HISTORICAL'))
    && (x.community_reference == null || x.community_reference.kind === 'COMMUNITY_REFERENCE')), opps.items.length);
  check('API /oportunidades: total = produtos com melhor oferta', opps.total === (await n('SELECT count(*) FROM hunter.product_opportunity')));
  // 6B.0: referência atual usada pelo motor, gravada por oferta (exposição; não muda score)
  const refRows = await n(`SELECT count(*) FROM hunter.opportunity o JOIN hunter.product_stats s USING (product_id)
     WHERE o.reference_kind IS DISTINCT FROM (CASE WHEN s.reference_kind = 'MARKET_CURRENT' OR (s.reference_kind = 'COPAG_OFFICIAL_CURRENT' AND s.reference_status = 'verified') THEN s.reference_kind ELSE 'NONE' END)
        OR (o.reference_kind <> 'NONE' AND o.reference_value IS DISTINCT FROM s.reference_price)`);
  check('opportunity: referência gravada = referência atual que o motor usa (product_stats), nunca histórico/comunitária', refRows === 0, refRows);
  const gapBad = await n(`SELECT count(*) FROM hunter.opportunity WHERE reference_kind <> 'NONE' AND reference_gap IS DISTINCT FROM round((reference_value - price) / reference_value, 4)`);
  check('opportunity: distância até a referência = (referência − preço) / referência', gapBad === 0, gapBad);
  const posBad = await n(`SELECT count(*) FROM hunter.opportunity o WHERE o.reference_kind <> 'NONE' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(o.reasons) x
     WHERE x->>'code' IN ('BELOW_REFERENCE', 'AT_REFERENCE', 'ABOVE_REFERENCE') AND x->>'reference_kind' = o.reference_kind)`);
  check('opportunity: toda oferta com referência atual tem a classificação do motor (abaixo/na/acima)', posBad === 0, posBad);
  const cmpBad = opps.items.filter((x) => x.reference_comparison.available !== (x.current_reference.kind !== 'NONE')
    || (x.reference_comparison.available && (x.reference_comparison.reference_value !== x.current_reference.price || x.reference_comparison.reference_kind !== x.current_reference.kind || x.reference_comparison.position == null))
    || (!x.reference_comparison.available && x.reference_comparison.percentage_below != null)).map((x) => x.product.id);
  check('API /oportunidades: reference_comparison coerente com current_reference (sem referência → sem percentual)', cmpBad.length === 0, cmpBad.slice(0, 10));
  const cat = await API.listOpportunities({ page: 1, limit: 50, categoria: 'ETB' });
  check('API /oportunidades: categoria = grupo/tipo do produto (mesma do site)', cat.total === (await n(`SELECT count(*) FROM hunter.product_opportunity o JOIN hunter.product p ON p.id = o.product_id
     WHERE p.attrs->>'group' = 'ETB' OR p.attrs->>'type' = 'ETB'`)) && cat.items.every((x) => x.product.group === 'ETB'), cat.total);
  const byGap = (await API.listOpportunities({ page: 1, limit: 50, ordem: 'abaixo' })).items.map((x) => x.reference_comparison.percentage_below);
  const firstNull = byGap.indexOf(null);
  check('API /oportunidades: ordem "abaixo" no servidor (desc, sem referência no fim)', byGap.slice(0, firstNull < 0 ? byGap.length : firstNull).every((v, i, a) => i === 0 || a[i - 1] >= v)
    && (firstNull < 0 || byGap.slice(firstNull).every((v) => v == null)), byGap.slice(0, 5));
  const fil = await API.listOpportunities({ page: 1, limit: 50, referencia: 'nenhuma' });
  check('API /oportunidades: filtro de referência atual', fil.items.every((x) => x.current_reference.kind === 'NONE' && !x.reference_comparison.available)
    && fil.total === (await n(`SELECT count(*) FROM hunter.product_opportunity WHERE reference_kind = 'NONE'`)), fil.total);
  rep.referenceComparison = { byKind: await q(`SELECT reference_kind, count(*)::int n, round(avg(reference_gap) * 100, 2)::float8 avg_pct_below, round(min(reference_gap) * 100, 2)::float8 min_pct,
      round(max(reference_gap) * 100, 2)::float8 max_pct FROM hunter.opportunity GROUP BY 1 ORDER BY 1`),
    bestByKind: await q(`SELECT reference_kind, count(*)::int n FROM hunter.product_opportunity GROUP BY 1 ORDER BY 1`) };
  rep.api = { opportunities: opps.total, sample: opps.items.slice(0, 3) };

  // ---------- comparação com o que o site mostra hoje (state.json) ----------
  const byLegacy = new Map((await q(`SELECT p.legacy_id, s.* FROM hunter.product_stats s JOIN hunter.product p ON p.id = s.product_id`)).map((r) => [r.legacy_id, r]));
  const cmp = { products: 0, bestPriceEqual: 0, bestPriceDiff: [], inStockEqual: 0, inStockDiff: [], referenceEqual: 0, referenceDiff: [], avgCompared: 0, avgWithin2pct: 0, avgDiff: [] };
  for (const sp of state.products || []) {
    const x = byLegacy.get(sp.id); if (!x) continue; cmp.products++;
    const so = (state.offers || []).filter((o) => o.productId === sp.id && o.stock === 'IN_STOCK' && !o.stale && !o.anomalous && o.confirmed !== false && o.price > 0);
    const robotBest = so.length ? Math.min(...so.map((o) => o.price)) : null;
    if (eq(robotBest, x.current_price)) cmp.bestPriceEqual++; else cmp.bestPriceDiff.push({ id: sp.id, robot: robotBest, engine: x.current_price == null ? null : Number(x.current_price) });
    if ((sp.inStockCount ?? 0) === x.number_of_in_stock_offers) cmp.inStockEqual++; else cmp.inStockDiff.push({ id: sp.id, robot: sp.inStockCount ?? 0, engine: x.number_of_in_stock_offers });
    if (eq(sp.msrp ?? null, x.reference_kind === 'COPAG_OFFICIAL_CURRENT' ? x.reference_price : null)) cmp.referenceEqual++; else cmp.referenceDiff.push({ id: sp.id, robot: sp.msrp ?? null, engine: x.reference_price, status: x.reference_status });
    if (sp.marketAverage != null && x.average_price != null) { cmp.avgCompared++; const d = Math.abs(sp.marketAverage - Number(x.average_price)) / sp.marketAverage; if (d <= 0.02) cmp.avgWithin2pct++; else cmp.avgDiff.push({ id: sp.id, robot_total_avg: sp.marketAverage, engine_price_avg: Number(x.average_price) }); }
  }
  for (const k of ['bestPriceDiff', 'inStockDiff', 'referenceDiff', 'avgDiff']) { cmp[k + 'Count'] = cmp[k].length; cmp[k] = cmp[k].slice(0, 12); }
  rep.comparison = cmp;

  rep.size = await one(`SELECT pg_size_pretty(pg_database_size(current_database())) AS database,
    pg_size_pretty(sum(pg_total_relation_size(c.oid))) AS schema_hunter
    FROM pg_class c JOIN pg_namespace s ON s.oid=c.relnamespace WHERE s.nspname='hunter' AND c.relkind IN ('r','i','t','m','p')`);
} catch (e) {
  rep.errors.push({ message: e.message, code: e.code, detail: e.detail, where: e.where });
} finally { await close(); }

rep.ok = rep.errors.length === 0 && rep.checks.every((x) => x.ok);
// o relatório vai para um ramo público: tira usuário, senha e host da conexão de qualquer texto
let txt = JSON.stringify(rep, null, 2);
try {
  const u = new URL(process.env.DATABASE_URL);
  for (const s of [u.password, decodeURIComponent(u.password), u.username, u.hostname].filter((x) => x && x.length > 3)) txt = txt.split(s).join('***');
} catch {}
fs.writeFileSync(out, txt);
for (const x of rep.checks) console.log(`${x.ok ? 'OK  ' : 'FALHA'} ${x.name}`);
for (const e of rep.errors) console.log('ERRO', e.message);
console.log(rep.ok ? 'VALIDAÇÃO OK' : 'VALIDAÇÃO COM FALHAS');
process.exitCode = rep.ok ? 0 : 1;
