// 6C.3 — Alertas e bestDeals pela nota oficial do Opportunity Engine (sem Deal Score legado).
// Parte A roda sempre (puro + falhas de conexão). Parte B roda com TEST_DATABASE_URL (banco descartável).
import assert from 'node:assert/strict';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';
process.env.HUNTER_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'opp-cfg-')); process.env.HUNTER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'opp-data-'));
const { readOfficial, officialFor, officialLine, MAX_AGE_MIN } = await import('../src/opportunity-read.js');
const { evaluate, dedupe, compose } = await import('../src/alerts.js');
const { rankBestDeals } = await import('../src/run.js');
const ENG = await import('../src/core/opportunity-engine.js');
let n = 0; const t = async (name, fn) => { await fn(); n++; };

const NOW = Date.parse('2026-10-09T12:00:00Z');
const row = (o = {}) => ({ legacy_id: 'o1', score: 80, band: 'boa', confidence: 0.51, price: 39.9, calculated_at: new Date(NOW - 10 * 60e3), ...o });
const offer = (o = {}) => ({ id: 'o1', productId: 'p1', stock: 'IN_STOCK', matchConfidence: 0.95, anomalous: false, stale: false, confirmed: true, price: 39.9, total: 39.9,
  discount: 0.2, perBooster: null, storeName: 'Loja', priceKindLabel: 'Pix', shipping: null, url: 'https://loja/o1', ...o });
const prod = { p1: { id: 'p1', type: 'blister_4', collection: 'me04', collectionName: 'Caos Ascendente', typeLabel: 'Blister Quádruplo', copagConfirmed: true, msrp: 55.99 },
  p2: { id: 'p2', type: 'etb', collection: 'me05', collectionName: 'Escuridão Absoluta', typeLabel: 'ETB', copagConfirmed: false, msrp: null } };

// ------------------------------------------------------------------ A) puro
await t('2. fronteiras das faixas: lidas do próprio motor (BANDS), regra minOpportunityScore usa ≥ e nunca recalcula a faixa', () => {
  const mins = ENG.BANDS.map(([min]) => min).filter((m) => m > 0);
  assert.ok(mins.length >= 3, 'faixas do motor');
  for (const m of mins) {
    for (const [score, fire] of [[m - 1, false], [m, true]]) {
      const o = offer(); const x = officialFor(o, row({ score, band: ENG.bandOf(score) }), NOW);
      assert.equal(x.band, ENG.bandOf(score), 'faixa vem da linha gravada pelo motor');
      const hits = evaluate([{ id: 'r', filter: {}, minOpportunityScore: m }], [o], [], prod, { opp: new Map([[o.id, x]]) });
      assert.equal(hits.length, fire ? 1 : 0, `nota ${score} com mínimo ${m}`);
      if (fire) assert.match(compose(hits[0]).text, new RegExp(`Opportunity Score: ${score}/100 · ${ENG.BAND_LABEL[ENG.bandOf(score)]}`));
    }
  }
});
await t('3. sem nota oficial: regra de nota não dispara e a mensagem não tem linha de nota; confiança baixa aparece como baixa', () => {
  const o = offer();
  assert.equal(evaluate([{ id: 'r', filter: {}, minOpportunityScore: 1 }], [o], [], prod, { opp: new Map() }).length, 0, 'sem nota não dispara');
  const h = evaluate([{ id: 'r', filter: {}, maxPrice: 100 }], [o], [], prod, { opp: new Map() });
  assert.equal(h.length, 1); assert.doesNotMatch(compose(h[0]).text, /Score/i, 'sem nota: nenhuma linha de nota');
  assert.equal(officialFor(o, row({ score: null }), NOW), null); assert.equal(officialFor(o, null, NOW), null); assert.equal(officialFor(o, row({ band: null }), NOW), null);
  const low = officialFor(o, row({ confidence: 0.3 }), NOW);
  assert.equal(low.level, ENG.confidenceLevel(0.3)); assert.equal(low.level, 'baixa');
  assert.equal(officialLine(low), `Opportunity Score: 80/100 · ${ENG.BAND_LABEL.boa} · confiança baixa`);
  assert.equal(officialLine(officialFor(o, row({ confidence: null }), NOW)), `Opportunity Score: 80/100 · ${ENG.BAND_LABEL.boa}`, 'confiança ausente: não inventa nível');
});
await t('4. nota com mais de 60 min, do futuro ou de preço diferente: tratada como sem nota', () => {
  const o = offer();
  assert.equal(MAX_AGE_MIN, 60);
  assert.ok(officialFor(o, row({ calculated_at: new Date(NOW - 60 * 60e3) }), NOW), 'exatamente 60 min ainda vale');
  assert.equal(officialFor(o, row({ calculated_at: new Date(NOW - 61 * 60e3) }), NOW), null, '61 min não vale');
  assert.equal(officialFor(o, row({ calculated_at: new Date(NOW + 30 * 60e3) }), NOW), null, 'cálculo no futuro não vale');
  assert.equal(officialFor(o, row({ calculated_at: 'lixo' }), NOW), null);
  // linha sem mudança há horas continua valendo se o motor rodou há pouco (o motor só regrava o que muda)
  assert.equal(officialFor(o, row({ calculated_at: new Date(NOW - 180 * 60e3), engine_at: new Date(NOW - 5 * 60e3) }), NOW)?.score, 80, 'linha antiga + motor recente vale');
  assert.equal(officialFor(o, row({ calculated_at: new Date(NOW - 180 * 60e3), engine_at: new Date(NOW - 61 * 60e3) }), NOW), null, 'motor parado há 61 min não vale');
  assert.equal(officialFor(o, row({ calculated_at: new Date(NOW - 10 * 60e3), engine_at: new Date(NOW + 30 * 60e3) }), NOW), null, 'motor no futuro não vale');
  assert.equal(officialFor(o, row({ price: 41.9 }), NOW), null, 'preço avaliado diferente do lido agora');
  assert.equal(officialFor(offer({ price: 39.9001 }), row(), NOW)?.score, 80, 'mesmo valor em centavos vale');
  assert.equal(officialFor(offer({ price: null }), row(), NOW), null);
});
await t('5. banco: sem variável, recusado, sem resposta (timeout) e módulo ausente — nunca lança, nunca vaza a senha', async () => {
  const off = await readOfficial(['o1'], { env: {} });
  assert.deepEqual([off.status, off.rows.size, off.reason], ['off', 0, 'sem DATABASE_URL']);
  const secret = 'senhaSuperSecreta123';
  let t0 = Date.now(); const refused = await readOfficial(['o1'], { env: { DATABASE_URL: `postgres://u:${secret}@127.0.0.1:1/x` }, timeoutMs: 1500 });
  assert.equal(refused.status, 'error'); assert.equal(refused.rows.size, 0); assert.ok(Date.now() - t0 < 2500, 'conexão recusada responde rápido');
  assert.ok(!refused.reason.includes(secret) && !/postgres:\/\//.test(refused.reason), 'motivo sem a URL nem a senha: ' + refused.reason);
  // servidor que aceita a conexão e nunca responde
  const socks = []; const srv = net.createServer((s) => socks.push(s)); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  t0 = Date.now(); const hung = await readOfficial(['o1'], { env: { DATABASE_URL: `postgres://u:${secret}@127.0.0.1:${srv.address().port}/x` }, timeoutMs: 800 });
  const took = Date.now() - t0; socks.forEach((s) => s.destroy()); srv.close();
  assert.equal(hung.status, 'error'); assert.ok(took < 2500, `desiste no prazo (${took} ms)`); assert.ok(!hung.reason.includes(secret));
  const noPg = await readOfficial(['o1'], { env: { DATABASE_URL: 'postgres://u:x@127.0.0.1:5/x' }, loadPg: async () => { throw new Error('Cannot find package pg'); } });
  assert.equal(noPg.status, 'error');
  assert.equal((await readOfficial([], { env: { DATABASE_URL: 'postgres://u:x@127.0.0.1:1/x' } })).status, 'ok', 'nada a ler: nem conecta');
});
await t('6. sem nota (banco fora): preço-alvo, desconto, por booster, reposição e queda disparam normalmente', () => {
  const o = offer({ total: 39.9, perBooster: 9.9 }); const sem = { opp: new Map() };
  const rules = [{ id: 'alvo', mode: 'target', filter: { productId: 'p1' }, maxPrice: 40 }, { id: 'desc', filter: {}, minDiscount: 0.15 },
    { id: 'ppb', filter: {}, maxPerBooster: 10 }, { id: 'rep', filter: { productId: 'p1' }, restock: true }];
  const hits = evaluate(rules, [o], [{ offerId: 'o1', event: 'restock' }, { offerId: 'o1', event: 'drop', from: 45 }], prod, sem);
  assert.deepEqual(hits.map((h) => h.kind).sort(), ['deal', 'deal', 'drop', 'restock', 'target']);
  assert.ok(hits.every((h) => h.opp === null && !/Score/i.test(compose(h).text)));
  // desconto continua exigindo Copag oficial; preço-alvo em R$ não
  const o2 = offer({ id: 'o2', productId: 'p2', total: 200, price: 200, discount: null });
  assert.deepEqual(evaluate([{ id: 'd', filter: {}, minDiscount: 0.1 }, { id: 'a', mode: 'target', filter: {}, maxPrice: 250 }], [o2], [], prod, sem).map((h) => h.rule.id), ['a']);
});
await t('regra antiga com minDealScore: não dispara (nunca vira filtro mais fraco) e avisa no log', () => {
  const logs = []; const o = offer(); const x = officialFor(o, row({ score: 95, band: 'excelente' }), NOW);
  const hits = evaluate([{ id: 'velha', filter: {}, minDealScore: 50 }, { id: 'velha-alvo', filter: {}, minDealScore: 10, maxPrice: 999 }], [o], [], prod, { opp: new Map([[o.id, x]]), log: (m) => logs.push(m) });
  assert.equal(hits.length, 0); assert.equal(logs.length, 2); assert.match(logs[0], /minDealScore.*não dispara.*minOpportunityScore/);
  // produto vigiado só pela regra antiga continua recebendo a queda de preço (independe de nota), com ou sem nota oficial
  const drop = [{ offerId: 'o1', event: 'drop', from: 45 }]; const velha = [{ id: 'velha', filter: { productId: 'p1' }, minDealScore: 70 }];
  for (const op of [new Map(), new Map([[o.id, x]])]) {
    const hs = evaluate(velha, [o], drop, prod, { opp: op });
    assert.deepEqual(hs.map((h) => [h.kind, h.rule.id]), [['drop', 'drop']], 'queda preservada; a regra antiga em si não dispara');
  }
  // sem queda, nada: minDealScore nunca é lido como minOpportunityScore (nota 95 ≥ 70 não faz a regra disparar)
  assert.equal(evaluate(velha, [o], [], prod, { opp: new Map([[o.id, x]]) }).length, 0);
});
await t('7. deduplicação: mesma oferta não reenvia; mudar só a nota não reenvia; queda real de preço reenvia', () => {
  const o = offer(); const now = NOW; const x = officialFor(o, row(), NOW);
  const h1 = evaluate([{ id: 'r', filter: {}, minOpportunityScore: 70 }], [o], [], prod, { opp: new Map([[o.id, x]]) });
  const sent = { [h1[0].key]: { at: new Date(now - 60e3).toISOString(), total: 39.9, discount: 0.2, offerId: 'o1' } };
  assert.equal(dedupe(h1, sent, {}, now, { o1: o }).length, 0, 'já enviado');
  const x2 = officialFor(o, row({ score: 92, band: 'excelente' }), NOW);
  const h2 = evaluate([{ id: 'r', filter: {}, minOpportunityScore: 70 }], [o], [], prod, { opp: new Map([[o.id, x2]]) });
  assert.equal(dedupe(h2, sent, {}, now, { o1: o }).length, 0, 'nota maior, mesmo preço: não reenvia');
  const cheaper = offer({ total: 35, price: 35 }); const x3 = officialFor(cheaper, row({ price: 35 }), NOW);
  assert.equal(dedupe(evaluate([{ id: 'r', filter: {}, minOpportunityScore: 70 }], [cheaper], [], prod, { opp: new Map([[cheaper.id, x3]]) }), sent, {}, now, { o1: cheaper }).length, 1, 'preço caiu: reenvia');
});
await t('8. bestDeals: nota oficial primeiro; sem nota, desconto; depois total e id; sem nota e sem desconto fica fora', () => {
  const O = [offer({ id: 'a', discount: 0.30, total: 50 }), offer({ id: 'b', discount: 0.10, total: 40 }), offer({ id: 'c', discount: null, total: 30 }),
    offer({ id: 'd', discount: 0.30, total: 45 }), offer({ id: 'e', discount: null, total: 99 }), offer({ id: 'f', discount: 0.5, stale: true }),
    offer({ id: 'g', discount: 0.5, confirmed: false }), offer({ id: 'h', discount: 0.5, anomalous: true }), offer({ id: 'i', discount: 0.5, stock: 'OUT_OF_STOCK' })];
  const opp = new Map([['b', { score: 88 }], ['c', { score: 70 }]]);
  assert.deepEqual(rankBestDeals(O, opp).map((o) => o.id), ['b', 'c', 'd', 'a'], 'nota 88, nota 70, depois desconto 30% (total menor primeiro)');
  assert.deepEqual(rankBestDeals(O, new Map()).map((o) => o.id), ['d', 'a', 'b'], 'sem banco: só desconto');
});
await t('9. nenhuma referência ativa ao Deal Score legado no robô, nos alertas e no workflow', () => {
  const rd = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
  for (const f of ['src/run.js', 'src/score.js', 'src/opportunity-read.js', 'src/server.js']) assert.doesNotMatch(rd(f), /dealScore|Deal Score|scoreParts|opportunityBadge|classify\(/, f);
  const al = rd('src/alerts.js');
  assert.doesNotMatch(al, /o\.dealScore|Deal Score:|scoreParts/, 'alerts.js sem Deal Score em mensagem ou regra');
  assert.ok((al.match(/minDealScore/g) || []).length <= 3, 'minDealScore só no tratamento de regra antiga');
  const wf = rd('.github/workflows/hunter.yml');
  assert.match(wf, /Instalar dependências \(leitura da nota oficial\)[\s\S]*?continue-on-error: true[\s\S]*?- name: Caçar preços[\s\S]*?DATABASE_URL: \$\{\{ secrets\.DATABASE_URL \}\}/, 'caça com dependências e DATABASE_URL');
  assert.doesNotMatch(wf, /(echo|printf)[^\n]*(\$\{?DATABASE_URL|secrets\.DATABASE_URL)/, 'workflow nunca imprime o valor do secret');
  assert.doesNotMatch(rd('src/opportunity-read.js'), /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE)\b/, 'leitura apenas');
});

// Cobertura de partições (src/db/partitions.js) e do callback do ML (api/ml-callback.mjs): sem banco e sem rede.
await import('./partitions-mlcallback-tests.js');

// ------------------------------------------------------------------ B) banco real: Telegram = API para a mesma oferta
if (!process.env.TEST_DATABASE_URL) { console.log(`✓ Alertas pela nota oficial (6C.3): ${n} grupos puros passaram; banco pulado (sem TEST_DATABASE_URL)`); process.exit(0); }
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const { pool, tx, close } = await import('../src/db/pg.js');
const { syncState } = await import('../src/core/sync.js');
const { runPriceEngine } = await import('../src/core/price-stats.js');
const { runOpportunityEngine } = await import('../src/core/opportunity-run.js');
const { execFileSync } = await import('node:child_process');
const p = await pool();
await p.query('DROP SCHEMA IF EXISTS hunter CASCADE');
execFileSync('node', ['tools/db-migrate.mjs'], { env: process.env, stdio: 'pipe' });
const now = new Date(); const day = (k) => new Date(now.getTime() - k * 864e5).toISOString();
const catalog = { collections: [{ id: 'me05', name: 'Escuridão Absoluta', series: 'Megaevolução' }] };
const P = { id: 'me05-etb', collection: 'me05', collectionName: 'Escuridão Absoluta', type: 'etb', typeLabel: 'Treinador Avançado (ETB)', group: 'ETB', boosters: 9,
  copagConfirmed: true, msrp: 400, copag: { source_url: 'https://www.copagloja.com.br/etb/p', confidence: 'OFICIAL', source_timestamp: day(1) } };
const mk = (id, storeId, price, extra = {}) => ({ id, productId: 'me05-etb', storeId, title: 'ETB', url: `https://${storeId}/etb`, price, total: price, shipping: null, shippingKnown: false,
  stock: 'IN_STOCK', matchConfidence: 0.95, confirmed: true, source_timestamp: now.toISOString(), firstSeen: day(5), ...extra });
const OFFERS = [mk('oa', 'a', 300), mk('ob', 'b', 340, { shipping: 0, shippingKnown: true }), mk('oc', 'c', 395)];
const H = [5, 4, 3, 2, 1].map((k, i) => ({ t: day(k), offerId: 'oa', productId: 'me05-etb', storeId: 'a', price: 380 - i * 10, total: 380 - i * 10, stock: 'IN_STOCK' }));
await tx((c) => syncState(c, { state: { collections: [], products: [P], sources: ['a', 'b', 'c'].map((id) => ({ id, name: id, url: `https://${id}.com.br`, status: 'ACTIVE' })), offers: OFFERS }, catalog, historyLines: H }));
await tx((c) => runPriceEngine(c, { asOf: now }));
await tx((c) => runOpportunityEngine(c, { now }));

await t('1. consistência: a nota da mensagem do Telegram é a mesma que a API oficial devolve para a mesma oferta', async () => {
  const off = await readOfficial(OFFERS.map((o) => o.id), { env: { DATABASE_URL: process.env.TEST_DATABASE_URL } });
  assert.equal(off.status, 'ok'); assert.ok(off.rows.size >= 2, 'linhas oficiais lidas');
  process.env.API_DATABASE_URL = process.env.TEST_DATABASE_URL;
  const { default: api } = await import('../api/v1.mjs');
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  await api({ url: '/api/v1/oportunidades?produto=me05-etb&ofertas=todas&limite=50', method: 'GET' }, res);
  const items = JSON.parse(res.body).data; assert.ok(items.length >= 2, 'API devolve as ofertas avaliadas');
  let checked = 0;
  for (const it of items) {
    const o = OFFERS.find((x) => x.id === it.offer.id); const x = officialFor(o, off.rows.get(o.id), Date.now());
    assert.ok(x, `nota válida para ${o.id}`);
    assert.equal(x.score, it.opportunity_score); assert.equal(x.band, it.opportunity_band); assert.equal(x.confidence, it.confidence);
    const h = evaluate([{ id: 'r', filter: {}, minOpportunityScore: 0 }], [o], [], { 'me05-etb': P }, { opp: new Map([[o.id, x]]) })[0];
    assert.ok(compose(h).text.includes(`Opportunity Score: ${it.opportunity_score}/100 · ${ENG.BAND_LABEL[it.opportunity_band]}`), 'linha do Telegram = API');
    checked++;
  }
  assert.equal(checked, items.length);
  // preço mudou depois do cálculo: a linha oficial não vale para a leitura nova
  assert.equal(officialFor({ ...OFFERS[0], price: 299 }, off.rows.get('oa'), Date.now()), null);
  // a consulta abriu transação só de leitura e não escreveu nada
  const before = (await p.query('SELECT count(*)::int AS n, max(calculated_at) AS m FROM hunter.opportunity')).rows[0];
  await readOfficial(['oa'], { env: { DATABASE_URL: process.env.TEST_DATABASE_URL } });
  assert.deepEqual((await p.query('SELECT count(*)::int AS n, max(calculated_at) AS m FROM hunter.opportunity')).rows[0], before);
  const { closeApiPool } = await import('../api/_lib/db.mjs'); await closeApiPool();
});
await close();
console.log(`✓ Alertas pela nota oficial (6C.3): ${n} grupos passaram (puro + banco)`);
