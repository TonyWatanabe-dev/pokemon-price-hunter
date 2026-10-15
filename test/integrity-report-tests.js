// Relatório de integridade somente leitura banco × arquivos (Fase 5 / issue #113): src/core/integrity-report.js e tools/db-integrity-report.mjs.
// Puro + cliente falso; com TEST_DATABASE_URL, também num banco PostgreSQL descartável criado e apagado aqui (nunca dados reais).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DETECT, READS, REVIEW_ONLY, fileExpectations, reconcile, integrityReport } from '../src/core/integrity-report.js';

let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const root = new URL('../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), 'utf8');
const WRITE = /\b(INSERT|UPDATE|DELETE|MERGE|UPSERT|ALTER|DROP|TRUNCATE|CREATE|GRANT|REVOKE|COPY|VACUUM|REINDEX|CLUSTER|LOCK|CALL|DO)\b/i;

await t('todas as queries são SELECT, sem nenhuma palavra de escrita', () => {
  for (const [k, sql] of Object.entries({ ...DETECT, ...READS })) {
    assert.match(sql.trim(), /^SELECT\b/i, k); assert.doesNotMatch(sql, WRITE, k); assert.ok(!sql.includes(';'), `${k}: uma instrução só`);
  }
  assert.ok(REVIEW_ONLY.has('historyProductMismatch'), 'caso 3 é revisão (pode ser legítimo), não erro');
  // a ferramenta não abre transação de escrita nem importa o sync
  const tool = read('tools/db-integrity-report.mjs');
  assert.doesNotMatch(tool, /\btx\(|syncState|INSERT|UPDATE|DELETE/);
  const mod = read('src/core/integrity-report.js');
  assert.match(mod, /BEGIN TRANSACTION READ ONLY/); assert.match(mod, /ROLLBACK/); assert.doesNotMatch(mod, /COMMIT/);
  // o teste de integridade do schema usa a mesma lista de detecção
  assert.match(read('test/integrity-db-tests.js'), /import \{ DETECT \} from '\.\.\/src\/core\/integrity-report\.js'/);
});

const state = {
  products: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3', copag: { msrp: 50, source_url: 'https://www.instagram.com/x/', confidence: 'OFICIAL', manual: true } }],
  offers: [{ id: 'o1', productId: 'p1' }, { id: 'o2', productId: 'p2' }, { id: 'o3', productId: 'p3' }, { id: 'o-orfa', productId: 'p-fora' }],
};
const catalog = { copag: { p1: { msrp: 10, source_url: 'https://www.copagloja.com.br/a/p', confidence: 'OFICIAL' }, p9: { msrp: 9, source_url: 'https://mestrepull.com.br/', confidence: 'CATALOGO_COPAG' } } };

await t('arquivos: chaves legacy_id; oferta de produto fora dos arquivos não é esperada; Copag fora do domínio listada', () => {
  const f = fileExpectations({ state, catalog });
  assert.deepEqual([...f.products].sort(), ['p1', 'p2', 'p3']);
  assert.deepEqual([...f.offers].sort(), ['o1', 'o2', 'o3']);
  assert.deepEqual(f.copagOffDomain, ['p3'], 'Copag (domínio) e catálogo de terceiros não entram; Instagram "OFICIAL" entra');
  const real = fileExpectations({ state: { products: [] }, catalog: JSON.parse(read('config/catalog.json')) });
  assert.ok(real.copagOffDomain.every((id) => id.startsWith('c30-')), real.copagOffDomain.join(','));
  assert.deepEqual(fileExpectations(), { products: new Set(), offers: new Set(), copagOffDomain: [] });
});

await t('reconciliação pura: faltas e sobras nos dois sentidos, com amostra limitada', () => {
  const f = fileExpectations({ state, catalog });
  const db = { products: new Set(['p1', 'p2', 'p-velho']), liveOffers: new Set(['o1', 'o-zumbi']),
    officialRefs: [{ legacy_id: 'p1', source_url: 'https://www.copagloja.com.br/a/p' }, { legacy_id: 'p2', source_url: 'https://www.instagram.com/x/' }] };
  const by = Object.fromEntries(reconcile(f, db).map((c) => [c.name, c]));
  assert.deepEqual(by['produto nos arquivos e ausente no banco'].sample, ['p3']);
  assert.deepEqual(by['produto no banco e ausente nos arquivos'].sample, ['p-velho']); assert.equal(by['produto no banco e ausente nos arquivos'].review, true);
  assert.deepEqual(by['oferta viva nos arquivos e não ativa no banco'].sample, ['o2', 'o3']);
  assert.deepEqual(by['oferta ativa no banco e ausente nos arquivos'].sample, ['o-zumbi']);
  assert.deepEqual(by['referência COPAG_OFFICIAL no banco com fonte fora do domínio Copag'].sample, ['p2']);
  assert.equal(by['Copag confirmada no site com fonte fora do domínio Copag (arquivos)'].review, true);
  const many = reconcile({ products: new Set(Array.from({ length: 50 }, (_, i) => `x${String(i).padStart(2, '0')}`)), offers: new Set(), copagOffDomain: [] },
    { products: new Set(), liveOffers: new Set(), officialRefs: [] }, { sampleSize: 5 });
  assert.equal(many[0].count, 50); assert.deepEqual(many[0].sample, ['x00', 'x01', 'x02', 'x03', 'x04']);
  const clean = reconcile({ products: new Set(['a']), offers: new Set(['b']), copagOffDomain: [] }, { products: new Set(['a']), liveOffers: new Set(['b']), officialRefs: [] });
  assert.ok(clean.every((c) => c.ok && c.count === 0));
});

await t('cliente falso: READ ONLY primeiro, só SELECT no meio, ROLLBACK sempre (inclusive em erro)', async () => {
  const fake = (failOn = null) => { const log = []; return { log, query: async (sql) => {
    log.push(sql.trim().split(/\s+/).slice(0, 3).join(' '));
    if (failOn && sql.includes(failOn)) throw new Error('falha simulada');
    if (/count\(\*\)/.test(sql)) return { rows: [{ n: '0' }] };
    if (sql.includes('reference_price')) return { rows: [] };
    if (sql.includes('hunter.product WHERE')) return { rows: [{ legacy_id: 'p1' }, { legacy_id: 'p2' }, { legacy_id: 'p3' }] };
    if (sql.includes('hunter.offer WHERE')) return { rows: [{ legacy_id: 'o1' }, { legacy_id: 'o2' }, { legacy_id: 'o3' }] };
    return { rows: [] }; } }; };
  const c = fake();
  const rep = await integrityReport(c, { state, catalog, at: new Date('2026-10-15T12:00:00Z') });
  assert.equal(c.log[0], 'BEGIN TRANSACTION READ'); assert.equal(c.log.at(-1), 'ROLLBACK');
  for (const q of c.log.slice(1, -1)) assert.match(q, /^SELECT/);
  assert.equal(rep.read_only, true); assert.equal(rep.at, '2026-10-15T12:00:00.000Z'); assert.equal(rep.failing, 0);
  assert.equal(rep.to_review, 1, 'só a Copag fora do domínio (p3) fica para revisar');
  assert.deepEqual(rep.totals, { files_products: 3, files_offers: 3, db_products: 3, db_live_offers: 3 });
  const e = fake('hunter.offer WHERE');
  await assert.rejects(integrityReport(e, { state, catalog }), /falha simulada/);
  assert.equal(e.log.at(-1), 'ROLLBACK');
});

await t('ferramenta sem DATABASE_URL: não faz nada e sai com 0', () => {
  const env = { ...process.env }; delete env.DATABASE_URL;
  const outp = execFileSync('node', ['tools/db-integrity-report.mjs'], { cwd: new URL('.', root), env, encoding: 'utf8' });
  assert.match(outp, /Banco desligado/);
});

const DBURL = process.env.TEST_DATABASE_URL;
if (DBURL) {
  await t('PostgreSQL descartável: detecta órfão/sobras, escrita é recusada no READ ONLY e o banco fica igual', async () => {
    const { default: pg } = await import('pg');
    const name = 'integ_rep_' + process.pid;
    const admin = new pg.Client(DBURL); await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${name}`); await admin.query(`CREATE DATABASE ${name}`);
    const u = new URL(DBURL); u.pathname = '/' + name; const url = u.toString();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'integ-rep-'));
    const c = new pg.Client(url);
    try {
      const env = { ...process.env, DATABASE_URL: url };
      execFileSync('node', ['tools/db-migrate.mjs'], { cwd: new URL('.', root), env, stdio: 'pipe' });
      await c.connect();
      const q = async (sql, a = []) => (await c.query(sql, a)).rows;
      const cat = (await q(`SELECT id FROM hunter.category WHERE kind = 'type' ORDER BY id LIMIT 1`))[0].id;
      await q(`INSERT INTO hunter.store (id, name) VALUES ('loja-rep', 'Loja')`);
      const prod = async (legacy) => Number((await q(`INSERT INTO hunter.product (legacy_id, slug, category_id, canonical_name, variant) VALUES ($1, $1, $2, $1, $1) RETURNING id`, [legacy, cat]))[0].id);
      const offer = async (legacy, pid) => Number((await q(`INSERT INTO hunter.offer (legacy_id, product_id, store_id, marketplace_id, title_raw, url) VALUES ($1, $2, 'loja-rep', 'direct', 't', $1) RETURNING id`, [legacy, pid]))[0].id);
      const P1 = await prod('p1'); await prod('p2'); await prod('p-velho');
      const O1 = await offer('o1', P1); await offer('o-zumbi', P1);
      await q(`INSERT INTO hunter.price_history (offer_id, product_id, price, stock_status, observed_at) VALUES ($1, $2, 100, 'in_stock', '2026-10-08T10:00:00Z')`, [O1, P1]);
      await q(`INSERT INTO hunter.price_history (offer_id, product_id, price, stock_status, observed_at) VALUES (999999, $1, 100, 'in_stock', '2026-10-08T11:00:00Z')`, [P1]);
      const counts = async () => (await q(`SELECT (SELECT count(*) FROM hunter.product) p, (SELECT count(*) FROM hunter.offer) o, (SELECT count(*) FROM hunter.price_history) h,
        (SELECT count(*) FROM hunter.offer WHERE status = 'removed') r`))[0];
      const before = await counts();
      // o mecanismo: dentro de READ ONLY o PostgreSQL recusa escrita (25006)
      await q('BEGIN TRANSACTION READ ONLY');
      await assert.rejects(c.query(`UPDATE hunter.offer SET status = 'removed'`), { code: '25006' });
      await q('ROLLBACK');
      // a ferramenta, como no uso real
      fs.mkdirSync(path.join(tmp, 'data'));
      fs.writeFileSync(path.join(tmp, 'data', 'state.json'), JSON.stringify({ products: [{ id: 'p1' }, { id: 'p2' }, { id: 'p-novo' }], offers: [{ id: 'o1', productId: 'p1' }, { id: 'o2', productId: 'p2' }] }));
      const outFile = path.join(tmp, 'rep.json');
      const stdout = execFileSync('node', ['tools/db-integrity-report.mjs', path.join(tmp, 'data'), outFile], { cwd: new URL('.', root), env, encoding: 'utf8' });
      assert.ok(!stdout.includes(url) && !stdout.includes(u.password || '\u0000'), 'nunca imprime a URL');
      const rep = JSON.parse(fs.readFileSync(outFile, 'utf8'));
      const by = Object.fromEntries(rep.checks.map((x) => [x.name, x]));
      assert.equal(by['detecção: historyWithoutOffer'].count, 1);
      assert.deepEqual(by['produto nos arquivos e ausente no banco'].sample, ['p-novo']);
      assert.deepEqual(by['produto no banco e ausente nos arquivos'].sample, ['p-velho']);
      assert.deepEqual(by['oferta viva nos arquivos e não ativa no banco'].sample, ['o2']);
      assert.deepEqual(by['oferta ativa no banco e ausente nos arquivos'].sample, ['o-zumbi']);
      assert.ok(rep.failing >= 3 && rep.read_only === true);
      // --estrito: código 2 com falhas
      let code = 0;
      try { execFileSync('node', ['tools/db-integrity-report.mjs', path.join(tmp, 'data'), outFile, '--estrito'], { cwd: new URL('.', root), env, stdio: 'pipe' }); } catch (e) { code = e.status; }
      assert.equal(code, 2);
      assert.deepEqual(await counts(), before, 'nada foi corrigido nem alterado');
    } finally {
      await c.end().catch(() => {}); await admin.query(`DROP DATABASE IF EXISTS ${name}`); await admin.end();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
} else console.log('  (sem TEST_DATABASE_URL: parte em PostgreSQL pulada)');

console.log(`✓ Relatório de integridade somente leitura (Fase 5 / #113): ${n} grupos`);
