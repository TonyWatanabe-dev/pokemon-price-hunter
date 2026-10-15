// Decisão do proprietário (15/10/2026): as 12 referências c30-* do catálogo com fonte no Instagram são referência da
// comunidade, não "Copag confirmada", até a Copag publicar o preço no próprio site. Preço oficial lido pelo robô na loja
// Copag prevalece automaticamente. Cobre: catálogo, copagStatus, robô (state.json), SEO (pagina.mjs), espelho no banco
// (referenceRows) e leitura do banco (read-db.mjs, só com TEST_DATABASE_URL).
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cat = JSON.parse(fs.readFileSync(path.join(root, 'config/catalog.json'), 'utf8'));
const IDS = ['c30-blister2', 'c30-blister3', 'c30-colecao', 'c30-colecao_ex', 'c30-colecao_fichario', 'c30-colecao_miniatura', 'c30-colecao_porta_retrato',
  'c30-colecao_poster', 'c30-combo', 'c30-combo6', 'c30-etb', 'c30-minilata'];
let n = 0;
const t = async (name, fn) => { await fn(); n++; };

const { copagStatus } = await import('../src/score.js');
const { referenceRows } = await import('../src/core/mappers.js');

await t('catálogo: as 12 do Instagram são COMUNIDADE, nenhuma OFICIAL nem manual', () => {
  const insta = Object.entries(cat.copag).filter(([, c]) => /instagram\.com/i.test(c.source_url)).map(([k]) => k).sort();
  assert.deepEqual(insta, IDS);
  for (const id of IDS) { const c = cat.copag[id]; assert.equal(c.confidence, 'COMUNIDADE', id); assert.ok(!c.manual, id); assert.ok(c.msrp > 0, id); }
  assert.ok(!Object.values(cat.copag).some((c) => c.confidence === 'OFICIAL' && !/copag(loja)?\.com\.br/i.test(c.source_url)), 'nenhum OFICIAL fora do domínio Copag');
});

await t('copagStatus: COMUNIDADE nunca confirma, vira referência com fonte', () => {
  for (const id of IDS) {
    const c = cat.copag[id]; const st = copagStatus({ copag: c });
    assert.equal(st.confirmed, false, id); assert.equal(st.msrp, undefined, id);
    assert.equal(st.reference, c.msrp, id); assert.equal(st.referenceUrl, c.source_url, id);
    assert.match(st.reason, /comunidade/); assert.doesNotMatch(st.reason, /confirmad/);
  }
});

await t('espelho no banco: referência comunitária pendente (internet), nunca verificada nem Copag oficial', () => {
  const products = IDS.map((id) => { const st = copagStatus({ copag: cat.copag[id] }); return { id, copagConfirmed: st.confirmed, msrp: null, copagReference: st.reference, copagReferenceUrl: st.referenceUrl, copag: cat.copag[id] }; });
  const rows = referenceRows(products);
  assert.equal(rows.length, 12);
  for (const r of rows) {
    assert.equal(r.reference_kind, 'COMMUNITY_REFERENCE', r.legacy_id); assert.equal(r.verification_status, 'pending', r.legacy_id);
    assert.equal(r.source, 'internet', r.legacy_id); assert.equal(r.verified_at, null, r.legacy_id);
  }
});

// ---- robô ponta a ponta (sem rede): catálogo real; c30-etb tem preço lido na loja oficial Copag, os demais não
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hunter-c30-'));
process.env.HUNTER_CONFIG_DIR = path.join(tmp, 'config'); process.env.HUNTER_DATA_DIR = path.join(tmp, 'data');
process.env.HUNTER_TIPS = '0'; process.env.HUNTER_DOMAIN_DELAY_MS = '0';
for (const k of ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_SHA', 'GITHUB_EVENT_NAME']) delete process.env[k];
fs.mkdirSync(process.env.HUNTER_CONFIG_DIR, { recursive: true }); fs.mkdirSync(process.env.HUNTER_DATA_DIR, { recursive: true });
fs.writeFileSync(path.join(tmp, 'config/catalog.json'), JSON.stringify(cat));
fs.writeFileSync(path.join(tmp, 'config/stores.json'), JSON.stringify({ stores: [] }));
fs.copyFileSync(path.join(root, 'config/watchlist.json'), path.join(tmp, 'config/watchlist.json'));
// catálogo automático (data/products.json): os c30 do repositório + os que ainda não apareceram em loja
const repoReg = JSON.parse(fs.readFileSync(path.join(root, 'data/products.json'), 'utf8'));
const reg = Object.fromEntries(Object.entries(repoReg).filter(([k]) => k.startsWith('c30-')));
for (const id of IDS) reg[id] ||= { ...repoReg['c30-etb'], id, type: id.slice(4), typeLabel: id.slice(4), group: 'Coleções', name: `Celebração de 30 Anos - ${id.slice(4)}`, image: null };
fs.writeFileSync(path.join(tmp, 'data/products.json'), JSON.stringify(reg));
const COPAG_URL = 'https://www.copagloja.com.br/treinador-avancado-pokemon-30-anos/p';
fs.writeFileSync(path.join(tmp, 'data/copag-msrp.json'), JSON.stringify({ 'c30-etb': { msrp: 419.99, source_url: COPAG_URL, source_timestamp: '2026-10-15T10:00:00Z', confidence: 'OFICIAL', msrp_updated_at: '2026-10-15T10:00:00Z' } }));
const http = await import('../src/http.js');
http.setFetch(async () => new Response('offline', { status: 503 }));
const { runOnce } = await import('../src/run.js');
await runOnce({ log: () => {}, send: [] });
const s = JSON.parse(fs.readFileSync(path.join(tmp, 'data/state.json'), 'utf8'));
const P = Object.fromEntries(s.products.map((p) => [p.id, p]));

await t('robô: sem leitura oficial, as 11 restantes saem como referência (sem msrp, sem "Copag confirmada")', () => {
  for (const id of IDS.filter((x) => x !== 'c30-etb')) {
    const p = P[id]; assert.ok(p, id);
    assert.equal(p.copagConfirmed, false, id); assert.equal(p.msrp, null, id);
    assert.equal(p.copagReference, cat.copag[id].msrp, id); assert.match(p.copagReferenceUrl, /instagram\.com/, id);
    assert.match(p.copagReason, /comunidade/, id);
  }
});

await t('robô: preço oficial lido na loja Copag prevalece sobre a referência da comunidade', () => {
  const p = P['c30-etb'];
  assert.equal(p.copagConfirmed, true); assert.equal(p.msrp, 419.99); assert.equal(p.copag.source_url, COPAG_URL);
  assert.equal(p.copagReference, null);
  const [row] = referenceRows([p]);
  assert.equal(row.reference_kind, 'COPAG_OFFICIAL_CURRENT'); assert.equal(row.source, 'copag_loja'); assert.equal(row.verification_status, 'verified');
});

await t('SEO (pagina.mjs): /precos, coleção e produto não mostram as 11 como preço sugerido Copag; a oficial sim', async () => {
  const { colSlug, slugs } = await import('../api/_seo.mjs');
  // páginas só listam produto com oferta; o state.json vem do GitHub raw (fetch global), aqui simulado sem rede
  const fresh = { ...s, dataAt: new Date().toISOString(), generatedAt: new Date().toISOString(), products: s.products.map((p) => ({ ...p, offerCount: 1 })) };
  delete process.env.API_DATABASE_URL;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u) => (/state\.json/.test(String(u)) ? new Response(JSON.stringify(fresh), { status: 200, headers: { 'content-type': 'application/json' } }) : new Response('offline', { status: 503 }));
  const { default: pagina } = await import('../api/pagina.mjs');
  const get = async (qs) => { let body = ''; const res = { statusCode: 200, setHeader() {}, end(b) { body = String(b ?? ''); return this; } };
    await pagina({ url: `/api/pagina?${qs}`, headers: {} }, res); return { status: res.statusCode, body }; };
  const brl = (v) => `R\\$\\s?${v.toFixed(2).replace('.', ',')}`;
  const outros = IDS.filter((x) => x !== 'c30-etb');
  const precos = await get('t=precos');
  assert.equal(precos.status, 200); assert.match(precos.body, /Preço sugerido Copag \(oficial\)/, 'a oficial (c30-etb) aparece em /precos');
  const { of } = slugs(fresh.products);
  assert.ok(precos.body.includes(`<tr><td><a href="/produto/${of['c30-etb']}">`), 'c30-etb na tabela de /precos');
  for (const id of outros) assert.ok(!precos.body.includes(`<tr><td><a href="/produto/${of[id]}">`), `${id} não entra na tabela do preço sugerido Copag`);
  assert.doesNotMatch(precos.body, /<td>[^<]*<\/td><td><a href="https:\/\/www\.instagram\.com/, '/precos não cita o Instagram como fonte de preço');
  const c30 = s.collections.find((c) => c.id === 'c30');
  const col = await get(`t=colecao&slug=${encodeURIComponent(colSlug(c30))}`);
  assert.equal(col.status, 200);
  assert.match(col.body, new RegExp(`Copag ${brl(419.99)}`), 'c30-etb com a Copag oficial na página da coleção');
  for (const id of outros) assert.doesNotMatch(col.body, new RegExp(`Copag ${brl(cat.copag[id].msrp)}`), id);
  for (const id of outros) {
    const pg = await get(`t=produto&slug=${encodeURIComponent(of[id])}`);
    assert.equal(pg.status, 200, id);
    assert.doesNotMatch(pg.body, new RegExp(`Preço sugerido Copag: ${brl(cat.copag[id].msrp)}|preço sugerido Copag ${brl(cat.copag[id].msrp)}`), id);
  }
  const etb = await get(`t=produto&slug=${encodeURIComponent(of['c30-etb'])}`);
  assert.match(etb.body, new RegExp(`Preço sugerido Copag: ${brl(419.99)}`));
  globalThis.fetch = realFetch;
});

// ---- leitura do banco (read-db.mjs): paridade, inclusive com a linha antiga 'manual' verificada que já está no banco
if (!process.env.TEST_DATABASE_URL) console.log('— parte de banco da referência comunitária c30 pulada (sem TEST_DATABASE_URL)');
else {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL; process.env.API_DATABASE_URL = process.env.TEST_DATABASE_URL;
  const { pool, tx, close } = await import('../src/db/pg.js');
  const { syncState } = await import('../src/core/sync.js');
  const { execFileSync } = await import('node:child_process');
  const pg = await pool();
  await pg.query('DROP SCHEMA IF EXISTS hunter CASCADE');
  execFileSync('node', ['tools/db-migrate.mjs'], { env: process.env, stdio: 'pipe', cwd: root });
  const catalog = { collections: [{ id: 'c30', name: 'Celebração de 30 Anos', series: 'Especial' }] };
  const base = (id) => ({ id, collection: 'c30', collectionName: 'Celebração de 30 Anos', type: 'etb', typeLabel: 'ETB', group: 'ETB', boosters: 9 });
  const sync = (products) => tx((c) => syncState(c, { state: { collections: [], products, offers: [], sources: [], reputation: {} }, catalog, historyLines: [] }));
  // 1) histórico de produção: antes da decisão o robô gravava a tabela como 'manual' verificada
  await sync([{ ...base('c30-etb'), copagConfirmed: true, msrp: 399.99, copag: { source_url: 'https://www.instagram.com/voltztcg/', confidence: 'OFICIAL', source_timestamp: '2026-10-07', manual: true } },
    { ...base('c30-blister2'), copagConfirmed: true, msrp: 69.99, copag: { source_url: 'https://www.instagram.com/voltztcg/', confidence: 'OFICIAL', source_timestamp: '2026-10-07', manual: true } }]);
  // 2) depois da decisão: referência pendente
  await sync(['c30-etb', 'c30-blister2'].map((id) => ({ ...base(id), copagConfirmed: false, msrp: null, copagReference: cat.copag[id].msrp, copagReferenceUrl: cat.copag[id].source_url })));
  const { stateLikeFromDb } = await import('../api/_lib/read-db.mjs');
  let db = Object.fromEntries((await stateLikeFromDb({ products: [], offers: [] })).products.map((p) => [p.id, p]));
  for (const id of ['c30-etb', 'c30-blister2']) {
    assert.equal(db[id].copagConfirmed, false, id); assert.equal(db[id].msrp, null, id); assert.equal(db[id].copag, null, id);
    assert.equal(db[id].copagReference, cat.copag[id].msrp, id); assert.match(db[id].copagReferenceUrl, /instagram\.com/, id);
  }
  // 3) o robô lê o preço oficial na loja Copag: vence no banco também
  await sync([{ ...base('c30-etb'), copagConfirmed: true, msrp: 419.99, copag: { source_url: COPAG_URL, confidence: 'OFICIAL', source_timestamp: new Date().toISOString() } }]);
  db = Object.fromEntries((await stateLikeFromDb({ products: [], offers: [] })).products.map((p) => [p.id, p]));
  assert.equal(db['c30-etb'].copagConfirmed, true); assert.equal(db['c30-etb'].msrp, 419.99); assert.equal(db['c30-etb'].copag.source_url, COPAG_URL);
  assert.equal(db['c30-blister2'].copagConfirmed, false);
  const { closeApiPool } = await import('../api/_lib/db.mjs'); await closeApiPool(); await close(); n++;
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`✓ Referência da comunidade c30 (decisão de 15/10/2026): ${n} grupos passaram`);
