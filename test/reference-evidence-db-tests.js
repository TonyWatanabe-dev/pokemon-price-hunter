// Migration 010 (evidência e validade da Copag oficial na view do motor) no PostgreSQL real.
// Só roda com TEST_DATABASE_URL (banco descartável; o CI usa o PostgreSQL de serviço). Nunca o banco de produção.
// Sem TEST_DATABASE_URL, pula SEM encerrar o processo (é importado no fim de test/price-db-tests.js).
// Cobre: banco limpo com 001..009, cenários antes/depois da 010 (fonte copag_loja/manual, domínio Copag, janela de
// 30 dias medida contra hunter.as_of, value > 0), nada apagado, 010 reaplicada (idempotência), Price Engine com o asOf
// da rodada e o rollback pronto (db/rollback/010_reference_evidence.down.sql) devolvendo a view da 006.
// A política Copag em JS (site/API/robô) fica fora daqui: é a PR-B, separada.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';

if (!process.env.TEST_DATABASE_URL) {
  console.log('— testes de banco da migration 010 (evidência Copag) pulados (sem TEST_DATABASE_URL)');
} else {
  await run();
}

async function run() {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { pool, tx, close } = await import('../src/db/pg.js');
  const { syncState } = await import('../src/core/sync.js');
  const { runPriceEngine } = await import('../src/core/price-stats.js');
  const { COPAG_MAX_AGE_DAYS } = await import('../api/_lib/references.mjs');
  const { execFileSync } = await import('node:child_process');

  const MIG = '010_reference_evidence.sql';
  const migDir = path.join(root, 'db/migrations');
  const migSql = fs.readFileSync(path.join(migDir, MIG), 'utf8');
  const downSql = fs.readFileSync(path.join(root, 'db/rollback/010_reference_evidence.down.sql'), 'utf8');
  const p = await pool();
  const q = async (sql, a = []) => (await p.query(sql, a)).rows;
  let n = 0;
  const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };
  const migrate = () => execFileSync('node', ['tools/db-migrate.mjs'], { env: process.env, cwd: root, encoding: 'utf8' });

  // ---------------------------------------------------------------- banco limpo com 001..009 (mesmo protocolo de tools/db-migrate.mjs)
  await p.query('DROP SCHEMA IF EXISTS hunter CASCADE');
  await p.query('CREATE SCHEMA IF NOT EXISTS hunter; CREATE TABLE IF NOT EXISTS hunter.schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const before010 = fs.readdirSync(migDir).filter((f) => f.endsWith('.sql') && f < MIG).sort();
  assert.ok(before010.length >= 9 && before010[0].startsWith('001_') && before010.at(-1).startsWith('009_'), `001..009 antes da 010: ${before010.join(', ')}`);
  for (const f of before010) {
    const c = await p.connect();
    try { await c.query('BEGIN'); await c.query(fs.readFileSync(path.join(migDir, f), 'utf8')); await c.query('INSERT INTO hunter.schema_migrations (version) VALUES ($1)', [f]); await c.query('COMMIT'); }
    catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  }

  // ---------------------------------------------------------------- produtos e referências (um produto por cenário)
  const NOW = new Date();
  const DAY = 864e5;
  const ago = (d) => new Date(NOW.getTime() - d * DAY).toISOString();
  const LOJA = (slug) => `https://www.copagloja.com.br/${slug}/p`;
  const catalog = { collections: ['me04', 'me05', 'sv3', 'sv8', 'sv9', 'sv10', 'c30'].map((id) => ({ id, name: id, series: 'x' })) };
  const Pr = (id, col, type = 'etb', extra = {}) => ({ id, collection: col, collectionName: col, type, typeLabel: type, group: 'ETB', boosters: 9, ...extra });
  const ids = ['me05-etb', 'me04-etb', 'sv3-etb', 'c30-etb', 'sv8-etb', 'me05-blister3', 'sv9-etb', 'me04-box36', 'sv10-etb', 'me04-combo', 'c30-blister2'];
  const TYPE = { etb: 'etb', blister3: 'blister_3', box36: 'booster_box', combo: 'combo', blister2: 'blister_2' };
  const products = ids.map((id) => Pr(id, id.split('-')[0], TYPE[id.split('-')[1]]));
  await tx((c) => syncState(c, { state: { collections: [], products, sources: [{ id: 'a', name: 'a', url: 'https://a.com.br', status: 'ACTIVE' }], reputation: {}, offers: [] }, catalog, historyLines: [] }));
  const pid = Object.fromEntries((await q(`SELECT legacy_id, id FROM hunter.product`)).map((r) => [r.legacy_id, r.id]));
  const ins = async (legacy, r) => (await q(`INSERT INTO hunter.reference_price (product_id, value, source, source_url, verification_status, verified_at, confidence, reference_kind, observed_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $6) RETURNING id`, [pid[legacy], r.value, r.source, r.url, r.status || 'verified', r.verified_at, r.confidence ?? 95, r.kind || 'COPAG_OFFICIAL_CURRENT']))[0].id;

  // cenários (esperado DEPOIS da 010: entra = é a Copag atual do motor)
  await ins('me05-etb', { value: 399.99, source: 'copag_loja', url: LOJA('etb-me05'), verified_at: ago(2) });                       // oficial verificada recente → entra
  await ins('me04-etb', { value: 399.99, source: 'copag_loja', url: LOJA('etb-me04'), verified_at: ago(31) });                      // > 30 dias → não entra
  await ins('sv3-etb', { value: 349.99, source: 'copag_loja', url: LOJA('etb-sv3'), verified_at: ago(COPAG_MAX_AGE_DAYS - 0.01) }); // dentro do limite → entra
  await ins('c30-etb', { value: 399.99, source: 'manual', url: 'https://www.instagram.com/voltztcg/', verified_at: ago(1), kind: 'COMMUNITY_REFERENCE' }); // Instagram → não entra
  await ins('sv8-etb', { value: 299.99, source: 'internet', url: LOJA('etb-sv8'), verified_at: ago(1) });                           // fonte não oficial (internet) com URL Copag → não entra
  await ins('me05-blister3', { value: 42.99, source: 'copag_loja_catalog', url: LOJA('blister-triplo-me05'), verified_at: ago(1), confidence: 90 }); // só auditoria → não entra
  await ins('sv9-etb', { value: 349.99, source: 'copag_loja', url: LOJA('etb-sv9'), verified_at: new Date(NOW.getTime() + 3 * DAY).toISOString() }); // data no futuro → não entra
  // me04-box36: a auditoria (captura automática do catálogo público) não entra
  await ins('me04-box36', { value: 449.99, source: 'copag_loja_catalog', url: LOJA('box-display-pokemon-me04-caos-ascendente'), verified_at: ago(1), confidence: 90 });
  // vencida + recente no mesmo produto: a recente vence
  await ins('sv10-etb', { value: 379.99, source: 'copag_loja', url: LOJA('etb-sv10'), verified_at: ago(45) });
  await ins('sv10-etb', { value: 389.99, source: 'copag_loja', url: LOJA('etb-sv10'), verified_at: ago(3) });
  // mercado atual não é afetado pela 010
  await ins('me04-combo', { value: 260, source: 'market_test', url: 'https://exemplo.test/mercado', verified_at: ago(40), kind: 'MARKET_CURRENT', confidence: 70 });

  const view = async () => Object.fromEntries((await q(`SELECT p.legacy_id, c.reference_kind, c.source, c.value::float8 v FROM hunter.reference_price_current c
    JOIN hunter.product p ON p.id = c.product_id ORDER BY 1`)).map((r) => [r.legacy_id, r]));
  const copagIn = (v) => Object.keys(v).filter((k) => v[k].reference_kind === 'COPAG_OFFICIAL_CURRENT').sort();
  const snap = async () => ({
    products: (await q(`SELECT id, legacy_id, slug FROM hunter.product ORDER BY id`)),
    refs: (await q(`SELECT md5(string_agg(r::text, '|' ORDER BY r.id)) h, count(*)::int n FROM hunter.reference_price r`))[0],
  });
  const viewDef = async () => (await q(`SELECT pg_get_viewdef('hunter.reference_price_current'::regclass, true) d`))[0].d;
  const viewCols = async () => (await q(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'hunter' AND table_name = 'reference_price_current' ORDER BY ordinal_position`));
  const viewComment = async () => (await q(`SELECT obj_description('hunter.reference_price_current'::regclass, 'pg_class') c`))[0].c;

  let viewBefore; let dataBefore; let defBefore; let colsBefore; let commentBefore;
  await t('1. antes da 010 (view da 006): vencida, futura, internet e auditoria entram como Copag', async () => {
    viewBefore = await view(); dataBefore = await snap();
    defBefore = await viewDef(); colsBefore = await viewCols(); commentBefore = await viewComment();
    assert.deepEqual(copagIn(viewBefore), ['me04-box36', 'me04-etb', 'me05-blister3', 'me05-etb', 'sv10-etb', 'sv3-etb', 'sv8-etb', 'sv9-etb']);
    assert.equal(viewBefore['me04-box36'].v, 449.99); assert.equal(viewBefore['me04-box36'].source, 'copag_loja_catalog');
    assert.equal(viewBefore['me04-combo'].reference_kind, 'MARKET_CURRENT');
    assert.equal(viewBefore['c30-etb'], undefined, 'Instagram (comunitária) nunca entrou');
  });

  await t('2. valor 0 e Copag oficial fora do domínio: o banco recusa a linha', async () => {
    await assert.rejects(ins('c30-blister2', { value: 0, source: 'copag_loja', url: LOJA('blister-duplo-com-moeda'), verified_at: ago(1) }), /check/i);
    await assert.rejects(ins('c30-blister2', { value: 69.99, source: 'manual', url: 'https://www.instagram.com/voltztcg/', verified_at: ago(1) }), /copag_domain/);
    // e a view da 010 exige value > 0 explicitamente (defesa em profundidade, além do CHECK da tabela)
    assert.match(migSql, /r\.value > 0/);
  });

  await t('3. aplica a 010 pelo migrador real: só a 010 roda', async () => {
    const out = migrate();
    assert.match(out, new RegExp(`aplicada ${MIG}`)); assert.equal(out.match(/aplicada/g).length, 1, out);
    assert.equal((await q(`SELECT count(*)::int n FROM hunter.schema_migrations WHERE version = $1`, [MIG]))[0].n, 1);
  });

  let viewAfter;
  await t('4. depois da 010: só Copag com evidência (fonte copag_loja/manual, URL Copag, ≤ 30 dias)', async () => {
    viewAfter = await view();
    assert.deepEqual(copagIn(viewAfter), ['me05-etb', 'sv10-etb', 'sv3-etb']);
    assert.equal(viewAfter['sv10-etb'].v, 389.99, 'a verificação recente vence a vencida');
    for (const k of ['me04-etb', 'sv8-etb', 'me05-blister3', 'sv9-etb', 'me04-box36', 'c30-etb']) assert.equal(viewAfter[k], undefined, `${k} sem Copag atual`);
    assert.deepEqual(viewAfter['me04-combo'], viewBefore['me04-combo'], 'mercado atual intacto');
    // as colunas da view não mudaram (CREATE OR REPLACE), e nada foi apagado ou alterado
    assert.deepEqual(await viewCols(), colsBefore, 'mesmas colunas, mesma ordem e tipos');
    assert.equal(colsBefore.at(-1).column_name, 'priority');
    assert.deepEqual(await snap(), dataBefore, 'nenhuma linha de product/reference_price apagada ou alterada');
  });

  await t('5. 010 reaplicada (idempotente): mesmo resultado, nada muda', async () => {
    await p.query(migSql); await p.query(migSql);
    assert.deepEqual(await view(), viewAfter); assert.deepEqual(await snap(), dataBefore);
    assert.doesNotMatch(migrate(), /aplicada/, 'migrador não reaplica');
  });

  await t('6. fonte manual com URL oficial da Copag, verificada, entra; o produto nunca sai do catálogo', async () => {
    assert.equal((await view())['me04-box36'], undefined);
    await ins('me04-box36', { value: 449.99, source: 'manual', url: 'https://www.copag.com.br/pokemon/tabela-oficial', verified_at: ago(1) });
    const v = await view();
    assert.equal(v['me04-box36'].reference_kind, 'COPAG_OFFICIAL_CURRENT'); assert.equal(v['me04-box36'].source, 'manual'); assert.equal(v['me04-box36'].v, 449.99);
    assert.equal((await q(`SELECT status FROM hunter.product WHERE legacy_id = 'me04-box36'`))[0].status, 'active');
    // a lista de fontes oficiais e a janela batem com a regra documentada (copag_loja/manual, COPAG_MAX_AGE_DAYS)
    const srcs = migSql.match(/r\.source IN \(([^)]+)\)/)[1].split(',').map((s) => s.trim().replace(/'/g, ''));
    assert.deepEqual(srcs, ['copag_loja', 'manual']);
    assert.match(migSql, new RegExp(`interval '${COPAG_MAX_AGE_DAYS} days'`));
  });

  await t('7. Price Engine lê a view: só os produtos com evidência têm Copag atual', async () => {
    await tx((c) => runPriceEngine(c));
    const st = (await q(`SELECT p.legacy_id FROM hunter.product_stats s JOIN hunter.product p ON p.id = s.product_id WHERE s.reference_kind = 'COPAG_OFFICIAL_CURRENT' ORDER BY 1`)).map((r) => r.legacy_id);
    assert.deepEqual(st, ['me04-box36', 'me05-etb', 'sv10-etb', 'sv3-etb']);
  });

  await t('8. a validade é medida contra o asOf da rodada (hunter.as_of), o mesmo do Price Engine', async () => {
    // 20 dias atrás: me04-etb (verificada há 31 dias) tinha 11 dias e valia; me05-etb (há 2 dias) estaria 18 dias no futuro
    const at20 = await tx(async (c) => {
      await c.query(`SELECT set_config('hunter.as_of', $1, true)`, [ago(20)]);
      return (await c.query(`SELECT p.legacy_id FROM hunter.reference_price_current v JOIN hunter.product p ON p.id = v.product_id WHERE v.reference_kind = 'COPAG_OFFICIAL_CURRENT' ORDER BY 1`)).rows.map((r) => r.legacy_id);
    });
    assert.ok(at20.includes('me04-etb') && !at20.includes('me05-etb'), at20.join(','));
    // fora da transação a configuração some e a view volta a usar now()
    assert.deepEqual(copagIn(await view()), ['me04-box36', 'me05-etb', 'sv10-etb', 'sv3-etb']);
    // o Price Engine grava o asOf da rodada na transação
    const asOf = new Date(ago(5));
    const seen = await tx(async (c) => { await runPriceEngine(c, { asOf }); return (await c.query(`SELECT current_setting('hunter.as_of', true) v`)).rows[0].v; });
    assert.equal(new Date(seen).getTime(), asOf.getTime());
  });

  await t('9. rollback pronto (db/rollback, fora de db/migrations): volta a view da 006 sem tocar nos dados', async () => {
    assert.ok(!fs.readdirSync(migDir).some((f) => /down|rollback/i.test(f)), 'o migrador nunca vê o rollback');
    const dataNow = await snap();
    await p.query(downSql);
    assert.equal(await viewDef(), defBefore, 'mesma definição da view de antes da 010 (pg_get_viewdef)');
    assert.deepEqual(await viewCols(), colsBefore); assert.equal(await viewComment(), commentBefore);
    assert.deepEqual(copagIn(await view()), ['me04-box36', 'me04-etb', 'me05-blister3', 'me05-etb', 'sv10-etb', 'sv3-etb', 'sv8-etb', 'sv9-etb']);
    assert.deepEqual(await snap(), dataNow, 'rollback não apaga nem altera linhas');
    // o rollback não mexe em schema_migrations: sem o DELETE documentado, o migrador NÃO reaplica a 010
    assert.doesNotMatch(migrate(), /aplicada/);
    await p.query(downSql); assert.equal(await viewDef(), defBefore, 'rollback também é reaplicável');
    // com o DELETE documentado no arquivo de rollback, o migrador volta a aplicar a 010
    assert.match(downSql, /DELETE FROM hunter\.schema_migrations WHERE version\s*=\s*'010_reference_evidence\.sql'/);
    await p.query(`DELETE FROM hunter.schema_migrations WHERE version = $1`, [MIG]);
    assert.match(migrate(), new RegExp(`aplicada ${MIG}`));
    assert.deepEqual(copagIn(await view()), ['me04-box36', 'me05-etb', 'sv10-etb', 'sv3-etb']);
  });

  await close();
  console.log(`✓ Migration 010 (evidência Copag na view do motor): ${n} grupos de testes passaram (PostgreSQL)`);
}
