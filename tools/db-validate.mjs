// Validação do Marketplace Core num banco real (Supabase ou Postgres compatível).
// Sincroniza a pasta data/ duas vezes, confere contagens e invariantes e grava um relatório JSON.
// Não altera nada além do que db-sync já altera. Nunca imprime a URL do banco.
// Uso: DATABASE_URL=... node tools/db-validate.mjs <pasta-data> <saida.json> [logs-de-migration...]
import fs from 'node:fs';
import path from 'node:path';
import { pool, tx, close } from '../src/db/pg.js';
import { syncState } from '../src/core/sync.js';

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
