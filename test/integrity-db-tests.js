// Integridade referencial produto ↔ oferta ↔ histórico (issue #113).
// Só roda com TEST_DATABASE_URL (banco descartável). Nunca toca em dados reais: o schema de teste é recriado do zero.
// Mostra (1) o que o schema já impede, (2) o que ele NÃO impede (órfãos/duplicações possíveis) e (3) as queries de
// detecção, somente leitura, que servem de base para o plano em docs/integridade-referencial.md.
import assert from 'node:assert/strict';
if (!process.env.TEST_DATABASE_URL) { console.log('— testes de integridade pulados (sem TEST_DATABASE_URL)'); process.exit(0); }
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const { pool, close } = await import('../src/db/pg.js');
const { execFileSync } = await import('node:child_process');
const p = await pool();
await p.query('DROP SCHEMA IF EXISTS hunter CASCADE');
execFileSync('node', ['tools/db-migrate.mjs'], { env: process.env, stdio: 'pipe' });
const q = async (sql, a = []) => (await p.query(sql, a)).rows;
const n = async (sql, a = []) => Number((await q(sql, a))[0].n);

// Queries de detecção (somente SELECT). Cada uma conta linhas problemáticas.
const DETECT = {
  historyWithoutOffer: 'SELECT count(*) n FROM hunter.price_history h WHERE NOT EXISTS (SELECT 1 FROM hunter.offer o WHERE o.id = h.offer_id)',
  historyWithoutProduct: 'SELECT count(*) n FROM hunter.price_history h WHERE NOT EXISTS (SELECT 1 FROM hunter.product x WHERE x.id = h.product_id)',
  historyProductMismatch: 'SELECT count(*) n FROM hunter.price_history h JOIN hunter.offer o ON o.id = h.offer_id WHERE o.product_id <> h.product_id',
  clickWithoutOffer: 'SELECT count(*) n FROM hunter.affiliate_click c WHERE c.offer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM hunter.offer o WHERE o.id = c.offer_id)',
  duplicateLiveOffers: `SELECT count(*) n FROM (SELECT 1 FROM hunter.offer WHERE status <> 'removed' GROUP BY marketplace_id, store_id, url, coalesce(seller_id, 0) HAVING count(*) > 1) d`,
  duplicateProducts: `SELECT count(*) n FROM (SELECT 1 FROM hunter.product GROUP BY collection_id, category_id, coalesce(variant, ''), language, condition HAVING count(*) > 1) d`,
};
const detect = async () => Object.fromEntries(await Promise.all(Object.entries(DETECT).map(async ([k, sql]) => [k, await n(sql)])));
const zero = Object.fromEntries(Object.keys(DETECT).map((k) => [k, 0]));

// ---------- fixtures ----------
const cat = (await q(`SELECT id FROM hunter.category WHERE kind = 'type' ORDER BY id LIMIT 1`))[0].id;
await p.query(`INSERT INTO hunter.store (id, name) VALUES ('loja-int', 'Loja Integridade')`);
const prod = async (legacy, slug, variant = null) => Number((await q(
  `INSERT INTO hunter.product (legacy_id, slug, category_id, canonical_name, variant) VALUES ($1, $2, $3, $1, $4) RETURNING id`, [legacy, slug, cat, variant]))[0].id);
const offer = async (legacy, productId, url) => Number((await q(
  `INSERT INTO hunter.offer (legacy_id, product_id, store_id, marketplace_id, title_raw, url) VALUES ($1, $2, 'loja-int', 'direct', 't', $3) RETURNING id`, [legacy, productId, url]))[0].id);
const hist = (offerId, productId, t) => p.query(
  `INSERT INTO hunter.price_history (offer_id, product_id, price, stock_status, observed_at) VALUES ($1, $2, 100, 'in_stock', $3)`, [offerId, productId, t]);
const P1 = await prod('int-a', 'int-a'), P2 = await prod('int-b', 'int-b', 'v2');
const O1 = await offer('o-int-1', P1, 'https://loja/a');
await hist(O1, P1, '2026-10-08T10:00:00Z');
assert.deepEqual(await detect(), zero, 'fixture limpa: nenhuma query de detecção acha problema');

// ---------- 1) o que o schema JÁ impede ----------
const fk = { code: '23503' }, uq = { code: '23505' };
await assert.rejects(offer('o-sem-produto', 999999, 'https://loja/x'), fk, 'oferta exige produto existente');
await assert.rejects(p.query(`INSERT INTO hunter.offer (product_id, store_id, marketplace_id, title_raw, url) VALUES ($1, 'loja-inexistente', 'direct', 't', 'u')`, [P1]), fk, 'oferta exige loja existente');
await assert.rejects(p.query(`DELETE FROM hunter.product WHERE id = $1`, [P1]), fk, 'produto com oferta não pode ser apagado');
const O1b = await offer('o-int-1b', P1, 'https://loja/a2');
await hist(O1b, P1, '2026-10-08T11:00:00Z');
await assert.rejects(offer('o-int-1', P1, 'https://loja/dup'), uq, 'legacy_id de oferta único');
await assert.rejects(hist(O1b, P1, '2026-10-08T11:00:00Z'), uq, 'histórico único por (oferta, instante)');
await assert.rejects(p.query(`INSERT INTO hunter.product (legacy_id, slug, category_id, canonical_name) VALUES ('int-a', 'outro', $1, 'x')`, [cat]), uq, 'legacy_id de produto único');
await assert.rejects(p.query(`INSERT INTO hunter.product (slug, category_id, canonical_name) VALUES ('int-a', $1, 'x')`, [cat]), uq, 'slug único');
await p.query(`INSERT INTO hunter.product_identifier (product_id, kind, value) VALUES ($1, 'ean', '789')`, [P1]);
await assert.rejects(p.query(`INSERT INTO hunter.product_identifier (product_id, kind, value) VALUES ($1, 'ean', '789')`, [P2]), uq, 'o mesmo EAN não aponta para dois produtos');
await assert.rejects(p.query(`INSERT INTO hunter.stock_event (offer_id, to_status, observed_at) VALUES (999999, 'in_stock', now())`), fk, 'evento de estoque exige oferta');

// ---------- 2) lacunas: o schema aceita, as queries detectam (nada é limpo aqui) ----------
// 2a) histórico de oferta inexistente (price_history não tem FK: tabela particionada, só INSERT)
await hist(999999, P1, '2026-10-08T12:00:00Z');
assert.equal((await detect()).historyWithoutOffer, 1);
// 2b) histórico de produto inexistente
await p.query(`INSERT INTO hunter.price_history (offer_id, product_id, stock_status, observed_at) VALUES ($1, 888888, 'in_stock', '2026-10-08T13:00:00Z')`, [O1b]);
assert.equal((await detect()).historyWithoutProduct, 1);
// 2c) produto do histórico diferente do produto atual da oferta (oferta reclassificada pelo sync)
await p.query(`UPDATE hunter.offer SET product_id = $1 WHERE id = $2`, [P2, O1b]);
assert.ok((await detect()).historyProductMismatch >= 2, 'linhas antigas ficam com o produto antigo');
await p.query(`UPDATE hunter.offer SET product_id = $1 WHERE id = $2`, [P1, O1b]);
// 2d) clique de afiliado sem FK para a oferta
await p.query(`INSERT INTO hunter.affiliate_click (offer_id) VALUES (777777)`);
assert.equal((await detect()).clickWithoutOffer, 1);
// 2e) duas ofertas vivas para o mesmo (marketplace, loja, URL): só legacy_id é único
await offer('o-int-dup', P1, 'https://loja/a2');
assert.equal((await detect()).duplicateLiveOffers, 1);
// 2f) dois produtos canônicos iguais (slug/legacy_id diferentes)
await prod('int-a-copia', 'int-a-copia');
assert.equal((await detect()).duplicateProducts, 1);

// as queries são somente leitura: rodar de novo não muda nada
const before = await n('SELECT count(*) n FROM hunter.price_history');
await detect();
assert.equal(await n('SELECT count(*) n FROM hunter.price_history'), before);

await close();
console.log('OK — integridade referencial produto/oferta/histórico');
