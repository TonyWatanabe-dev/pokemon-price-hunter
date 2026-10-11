// Referências (Fase 5.6) no PostgreSQL real: só roda com TEST_DATABASE_URL (banco descartável).
import assert from 'node:assert/strict';
if (!process.env.TEST_DATABASE_URL) { console.log('— testes de banco de referências pulados (sem TEST_DATABASE_URL)'); process.exit(0); }
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const { pool, tx, close } = await import('../src/db/pg.js');
const { syncState } = await import('../src/core/sync.js');
const { runPriceEngine } = await import('../src/core/price-stats.js');
const { runOpportunityEngine } = await import('../src/core/opportunity-run.js');
const { importReferences } = await import('../src/core/reference-import.js');
const { execFileSync } = await import('node:child_process');
const p = await pool();
const q = async (sql, a = []) => (await p.query(sql, a)).rows;
const n1 = async (sql, a = []) => Number(Object.values((await q(sql, a))[0])[0]);
await p.query('DROP SCHEMA IF EXISTS hunter CASCADE');
execFileSync('node', ['tools/db-migrate.mjs'], { env: process.env, stdio: 'pipe' });

const catalog = { collections: [{ id: 'me05', name: 'Escuridão Absoluta', series: 'Megaevolução' }, { id: 'c30', name: 'Celebração de 30 Anos', series: 'Especial' }, { id: 'sv3', name: 'Obsidiana em Chamas', series: 'Escarlate e Violeta' }] };
const P = (id, col, extra = {}) => ({ id, collection: col, collectionName: col, type: 'etb', typeLabel: 'Treinador Avançado (ETB)', group: 'ETB', boosters: 9, ...extra });
// Copag verificada ontem (relativo ao relógio): a view do motor só aceita verificação de até 30 dias (migration 010)
const COPAG_SEEN = new Date(Date.now() - 864e5).toISOString();
const products = [
  P('me05-etb', 'me05', { copagConfirmed: true, msrp: 400, copag: { source_url: 'https://www.copagloja.com.br/treinador-avancado-pokemon-me05-escuridao-absoluta/p', confidence: 'OFICIAL', source_timestamp: COPAG_SEEN } }),
  P('c30-etb', 'c30', { copagConfirmed: true, msrp: 399.99, copag: { source_url: 'https://www.instagram.com/voltztcg/', confidence: 'OFICIAL', source_timestamp: '2026-10-07', manual: true, note: 'tabela de lojas' } }),
  P('sv3-etb', 'sv3'),
];
const mk = (id, prod, storeId, price) => ({ id, productId: prod, storeId, title: 'ETB', url: `https://${storeId}/${id}`, price, total: price, shipping: null, shippingKnown: false, stock: 'IN_STOCK', matchConfidence: 0.9, firstSeen: '2026-10-05T10:00:00Z', source_timestamp: '2026-10-08T12:00:00Z' });
const state = { collections: [], products, sources: ['a', 'b', 'c'].map((id) => ({ id, name: id, url: `https://${id}.com.br`, status: 'ACTIVE' })), reputation: {},
  offers: [mk('o1', 'me05-etb', 'a', 300), mk('o2', 'me05-etb', 'b', 320), mk('o3', 'c30-etb', 'a', 600), mk('o4', 'sv3-etb', 'a', 299.9), mk('o5', 'sv3-etb', 'c', 310)] };
await tx((c) => syncState(c, { state, catalog, historyLines: [] }));

// --- robô: Copag oficial só no domínio Copag; tabela do Instagram = comunitária (dados preservados)
const kinds = Object.fromEntries((await q(`SELECT p.legacy_id, r.reference_kind, r.reference_scope, r.value::float8 v FROM hunter.reference_price r JOIN hunter.product p ON p.id = r.product_id`)).map((r) => [r.legacy_id, r]));
assert.equal(kinds['me05-etb'].reference_kind, 'COPAG_OFFICIAL_CURRENT'); assert.equal(kinds['me05-etb'].reference_scope, 'current');
assert.equal(kinds['c30-etb'].reference_kind, 'COMMUNITY_REFERENCE'); assert.equal(kinds['c30-etb'].reference_scope, 'community'); assert.equal(kinds['c30-etb'].v, 399.99);

// --- importação rastreável
const file = { import_id: 'teste', excluded: ['c30-etb'], entries: [
  { legacy_id: 'sv3-etb', reference_kind: 'COPAG_OFFICIAL_HISTORICAL', value: 369.99, source: 'copag_blog', source_url: 'https://copag.com.br/pokemon/blog/detalhes/nova-colecao-obsidiana-em-chamas',
    page_title: 'Nova Coleção: Obsidiana em Chamas | Copag', published_at: '2023-08', effective_date: null, observed_at: '2026-10-08T00:00:00Z', verification_status: 'verified', verified_at: '2026-10-08T00:00:00Z',
    confidence: 90, evidence_text: 'Coleção Treinador Avançado: R$369,99', notes: 'preço de lançamento' },
  { legacy_id: 'me05-etb', reference_kind: 'COPAG_OFFICIAL_CURRENT', value: 399.99, source: 'copag_loja_catalog', source_url: 'https://www.copagloja.com.br/treinador-avancado-pokemon-me05-escuridao-absoluta/p',
    page_title: 'Treinador Avançado Pokémon ME05', published_at: null, effective_date: null, observed_at: '2026-10-08T00:00:00Z', verification_status: 'pending', verified_at: null,
    confidence: 60, evidence_text: 'Price 399.99', identifiers: [{ kind: 'mpn', value: '028D200100000BX', source: 'copag', confidence: 60 }] },
  { legacy_id: 'c30-etb', reference_kind: 'COPAG_OFFICIAL_CURRENT', value: 399.99, source: 'copag_loja_catalog', source_url: 'https://www.copagloja.com.br/x/p',
    published_at: null, effective_date: null, observed_at: '2026-10-08T00:00:00Z', verification_status: 'pending', verified_at: null, confidence: 60, evidence_text: 'x' },
] };
const refsBefore = await n1('SELECT count(*) FROM hunter.reference_price');
const i1 = await tx((c) => importReferences(c, file));
assert.equal(i1.inserted, 2); assert.equal(i1.rejected.length, 1); assert.equal(i1.rejected[0].legacy_id, 'c30-etb'); assert.equal(i1.identifiers.written, 1);
const i2 = await tx((c) => importReferences(c, file));
assert.equal(i2.inserted + i2.updated, 0, 'importação idempotente'); assert.equal(i2.unchanged, 2); assert.equal(i2.identifiers.written, 0);
assert.equal(await n1(`SELECT count(*) FROM hunter.system_event WHERE type = 'REFERENCES_IMPORTED'`), 1, 'trilha só quando algo muda');
assert.equal(await n1('SELECT count(*) FROM hunter.reference_price'), refsBefore + 2);
const h = (await q(`SELECT r.* FROM hunter.reference_price_historical r JOIN hunter.product p ON p.id = r.product_id WHERE p.legacy_id = 'sv3-etb'`))[0];
assert.equal(Number(h.value), 369.99); assert.equal(h.published_at, '2023-08'); assert.equal(h.effective_date, null); assert.equal(h.confidence, 90);
assert.equal(h.page_title, 'Nova Coleção: Obsidiana em Chamas | Copag'); assert.match(h.evidence_text, /369,99/); assert.equal(h.reference_scope, 'historical');
assert.equal((await q(`SELECT confidence, verification_status FROM hunter.reference_price WHERE source = 'copag_loja_catalog'`))[0].confidence, 60, 'confiança média não é elevada');
// identificador já usado por outro produto → recusado, não sobrescrito
const i3 = await tx((c) => importReferences(c, { import_id: 'teste2', excluded: [], entries: [{ ...file.entries[0], legacy_id: 'sv3-etb', value: 370.01, identifiers: [{ kind: 'mpn', value: '028D200100000BX', source: 'copag' }] }] }));
assert.equal(i3.identifiers.conflicts.length, 1); assert.equal(i3.identifiers.conflicts[0].already, 'me05-etb');
await p.query(`DELETE FROM hunter.reference_price WHERE value = 370.01`);   // limpa só o registro do teste de conflito

// --- banco recusa o que não presta
const bad = async (sql) => { await assert.rejects(p.query(sql)); };
const pid = await n1(`SELECT id FROM hunter.product WHERE legacy_id = 'sv3-etb'`);
await bad(`INSERT INTO hunter.reference_price (product_id, value, source, source_url, verification_status, reference_kind) VALUES (${pid}, 1, 'x', 'https://www.instagram.com/x', 'verified', 'COPAG_OFFICIAL_HISTORICAL')`);
await bad(`INSERT INTO hunter.reference_price (product_id, value, source, source_url, verification_status) VALUES (${pid}, 2, 'x', 'https://copag.com.br/a', 'verified')`);
await bad(`INSERT INTO hunter.reference_price (product_id, value, source, source_url, verification_status, reference_kind, published_at) VALUES (${pid}, 3, 'x', 'https://copag.com.br/a', 'verified', 'COPAG_OFFICIAL_HISTORICAL', '03.2023')`);
await bad(`INSERT INTO hunter.reference_price (product_id, value, source, source_url, verification_status, reference_kind) VALUES (${pid}, 4, 'x', 'https://copag.com.br/a', 'verified', 'COPAG_ADJUSTED_2026')`);
await bad(`UPDATE hunter.reference_price SET reference_scope = 'current' WHERE product_id = ${pid}`);   // escopo é derivado do tipo

// --- referência ATUAL × contexto histórico; Price Engine
await tx((c) => runPriceEngine(c));
const st = Object.fromEntries((await q(`SELECT p.legacy_id, s.reference_price::float8 rp, s.reference_status, s.reference_kind, s.discount_vs_reference::float8 d
  FROM hunter.product_stats s JOIN hunter.product p ON p.id = s.product_id`)).map((r) => [r.legacy_id, r]));
assert.equal(st['me05-etb'].reference_kind, 'COPAG_OFFICIAL_CURRENT'); assert.equal(st['me05-etb'].rp, 400); assert.equal(st['me05-etb'].d, 0.25);
assert.equal(st['sv3-etb'].rp, null, 'preço histórico NÃO vira referência atual'); assert.equal(st['sv3-etb'].d, null, 'nada de "% abaixo da Copag" com preço de 2023');
assert.equal(st['c30-etb'].rp, null, 'referência comunitária não é referência atual'); assert.equal(st['c30-etb'].d, null);
const cur = await q(`SELECT p.legacy_id, c.reference_kind, c.priority, c.value::float8 v FROM hunter.reference_price_current c JOIN hunter.product p ON p.id = c.product_id ORDER BY 1`);
assert.deepEqual(cur.map((r) => r.legacy_id), ['me05-etb']); assert.equal(cur[0].priority, 1);

// mercado atual (quando existir) entra com prioridade 2; Copag atual continua vencendo
await p.query(`INSERT INTO hunter.reference_price (product_id, value, source, source_url, verification_status, verified_at, confidence, reference_kind)
  SELECT id, 310, 'market_test', 'https://exemplo/mercado', 'verified', now(), 100, 'MARKET_CURRENT' FROM hunter.product WHERE legacy_id IN ('sv3-etb', 'me05-etb')`);
const cur2 = Object.fromEntries((await q(`SELECT p.legacy_id, c.reference_kind, c.priority FROM hunter.reference_price_current c JOIN hunter.product p ON p.id = c.product_id`)).map((r) => [r.legacy_id, r]));
assert.equal(cur2['me05-etb'].reference_kind, 'COPAG_OFFICIAL_CURRENT'); assert.equal(cur2['sv3-etb'].reference_kind, 'MARKET_CURRENT'); assert.equal(cur2['sv3-etb'].priority, 2);
await tx((c) => runPriceEngine(c));
// Fase 6A: o mercado atual é DERIVADO pelo Price Engine (mediana robusta); linha MARKET_CURRENT gravada à mão não é usada
assert.equal((await q(`SELECT s.reference_kind FROM hunter.product_stats s JOIN hunter.product p ON p.id = s.product_id WHERE p.legacy_id = 'sv3-etb'`))[0].reference_kind, 'NONE', '2 ofertas: sem mercado robusto');
await p.query(`DELETE FROM hunter.reference_price WHERE source = 'market_test'`); await tx((c) => runPriceEngine(c));

// --- Opportunity Engine (fórmula intacta): sem referência atual, sinal de referência nulo mesmo havendo preço de lançamento
await tx((c) => runOpportunityEngine(c));
const opp = (await q(`SELECT o.reference_signal, o.warnings FROM hunter.opportunity o JOIN hunter.offer f ON f.id = o.offer_id WHERE f.legacy_id = 'o4'`))[0];
assert.equal(opp.reference_signal, null); assert.ok(opp.warnings.some((w) => w.code === 'NO_CURRENT_REFERENCE') && opp.warnings.some((w) => w.code === 'HISTORICAL_REFERENCE_ONLY'));
assert.notEqual((await q(`SELECT o.reference_signal FROM hunter.opportunity o JOIN hunter.offer f ON f.id = o.offer_id WHERE f.legacy_id = 'o1'`))[0].reference_signal, null);

// --- re-sincronizar não apaga nem rebaixa nada
const cnt = await n1('SELECT count(*) FROM hunter.reference_price');
await tx((c) => syncState(c, { state, catalog, historyLines: [] }));
assert.equal(await n1('SELECT count(*) FROM hunter.reference_price'), cnt);
assert.equal(await n1(`SELECT count(*) FROM hunter.reference_price WHERE reference_kind = 'COPAG_OFFICIAL_HISTORICAL'`), 1);

// --- API: duas respostas separadas; o site continua vendo só o que o robô publica
process.env.API_DATABASE_URL = process.env.TEST_DATABASE_URL;
const DB = await import('../api/_lib/read-db.mjs');
const a = await DB.getProduct('sv3-etb');
assert.equal(a.current_reference.kind, a.stats.reference ? a.stats.reference.kind : 'NONE', 'referência atual vem do Price Engine'); assert.notEqual(a.current_reference.kind, 'COPAG_OFFICIAL_HISTORICAL');
assert.equal(a.historical_context.length, 1); assert.equal(a.historical_context[0].kind, 'COPAG_OFFICIAL_HISTORICAL');
assert.equal(a.historical_context[0].label, 'Preço sugerido de lançamento'); assert.equal(a.historical_context[0].published_at, '2023-08'); assert.equal(a.historical_context[0].price, 369.99);
assert.equal(a.stats.discount_vs_reference, null);
const b = await DB.getProduct('me05-etb');
assert.equal(b.current_reference.kind, 'COPAG_OFFICIAL_CURRENT'); assert.equal(b.current_reference.price, 400); assert.equal(b.current_reference.source, 'Copag'); assert.equal(b.stats.reference.kind, 'COPAG_OFFICIAL_CURRENT');
const c3 = await DB.getProduct('c30-etb');
assert.notEqual(c3.current_reference.kind, 'COMMUNITY_REFERENCE'); assert.equal(c3.community_reference.kind, 'COMMUNITY_REFERENCE'); assert.equal(c3.community_reference.label, 'Referência comunitária'); assert.equal(c3.community_reference.price, 399.99);
await close();
console.log('OK — Referências atual × histórico (PostgreSQL)');
