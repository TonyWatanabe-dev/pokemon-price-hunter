// Lote 2 — frescor dos dados e fallback seguro: a API e o site nunca apresentam preço antigo como atual.
// Puro (classificação, site, fallback pelo state.json) + PostgreSQL descartável quando TEST_DATABASE_URL existe.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path'; import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { classify, usable, LIMITS, setFreshnessClock, clearFreshnessCache } from '../api/_lib/freshness.mjs';
import { setLegacyLoader } from '../api/_lib/legacy.mjs';
import { clearCatalogCache } from '../api/_lib/catalog.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0;
async function t(name, fn) { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } }
const NOW = Date.parse('2026-10-09T18:00:00.000Z');
const ago = (min) => new Date(NOW - min * 6e4).toISOString();
setFreshnessClock(() => NOW);

// estado mínimo do robô (mesmo formato do state.json)
const fx = (generatedAt, offerTs = generatedAt) => ({
  generatedAt, coverage: { found: 3 }, totals: { offers: 3 }, collections: [{ id: 'me05', name: 'Escuridão Absoluta', series: 'Megaevolução', aliases: [], products: 1 }],
  types: [{ id: 'etb', label: 'Treinador Avançado (ETB)', group: 'ETB', products: 1 }],
  products: [{ id: 'me05-etb', collection: 'me05', collectionName: 'Escuridão Absoluta', type: 'etb', typeLabel: 'Treinador Avançado (ETB)', group: 'ETB', boosters: 9,
    copagConfirmed: true, msrp: 400, copag: { source_url: 'https://www.copagloja.com.br/etb/p', confidence: 'OFICIAL', source_timestamp: ago(600) }, offerCount: 3 }],
  offers: [['oa', 'a', 300], ['ob', 'b', 340], ['oc', 'c', 395]].map(([id, storeId, price]) => ({ id, productId: 'me05-etb', storeId, storeName: storeId, title: 'ETB', url: `https://${storeId}.com.br/etb`,
    price, total: price, shipping: null, shippingKnown: false, stock: 'IN_STOCK', matchConfidence: 0.95, confirmed: true, source_timestamp: offerTs, firstSeen: ago(5000) })),
  sources: ['a', 'b', 'c'].map((id) => ({ id, name: id, url: `https://${id}.com.br`, status: 'ACTIVE' })), activity: [], tips: [], bestDeals: [],
});

const { default: api, _cache } = await import('../api/v1.mjs');
const reset = () => { _cache.clear(); clearCatalogCache(); clearFreshnessCache(); };
const call = async (url) => { const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  await api({ url, method: 'GET' }, res); return { status: res.statusCode, h: res.headers, json: JSON.parse(res.body) }; };
const fr = (r) => r.json.meta?.freshness ?? r.json.freshness;

// ------------------------------------------------------------------ 1) limites
await t('1. classificação: limites de 30 / 90 min / 24 h, horário ausente, inválido ou no futuro', () => {
  assert.deepEqual(LIMITS, { ATUAL_MIN: 30, ATRASADO_MIN: 90, EXPIRA_MIN: 1440 });
  const st = (m) => classify(ago(m), NOW).status;
  assert.equal(st(0), 'atual'); assert.equal(st(30), 'atual'); assert.equal(st(31), 'atrasado'); assert.equal(st(90), 'atrasado');
  assert.equal(st(91), 'desatualizado'); assert.equal(st(1440), 'desatualizado'); assert.equal(st(1441), 'indisponivel');
  for (const bad of [null, undefined, '', 'lixo', '2026-13-45']) assert.equal(classify(bad, NOW).status, 'indisponivel', String(bad));
  assert.equal(classify(new Date(NOW + 10 * 6e4).toISOString(), NOW).status, 'indisponivel', 'horário no futuro (relógio errado) não vale');
  assert.equal(classify(new Date(NOW + 2 * 6e4).toISOString(), NOW).status, 'atual', 'tolerância de relógio de 5 min');
  assert.equal(classify(ago(45), NOW).ageMin, 45);
  assert.ok(usable(classify(ago(90), NOW)) && !usable(classify(ago(91), NOW)));
});

// ------------------------------------------------------------------ 2) só state.json (sem banco)
delete process.env.API_DATABASE_URL;
await t('2. state.json: atual e atrasado são servidos com o horário; antigo vai marcado e sem cache; vencido ou sem horário = 503', async () => {
  for (const [min, status] of [[10, 'atual'], [60, 'atrasado']]) {
    setLegacyLoader(async () => fx(ago(min))); reset();
    const r = await call('/api/v1/home');
    assert.equal(r.status, 200); assert.equal(fr(r).status, status); assert.equal(fr(r).source, 'state'); assert.equal(fr(r).ageMin, min);
    assert.equal(r.json.generatedAt, ago(min)); assert.equal(r.h['X-Data-Freshness'], status); assert.equal(r.h['X-Data-At'], ago(min));
    assert.match(r.h['Cache-Control'], /s-maxage/, 'dado em dia: cache normal');
  }
  setLegacyLoader(async () => fx(ago(180))); reset();
  let r = await call('/api/v1/home');
  assert.equal(r.status, 200); assert.equal(fr(r).status, 'desatualizado'); assert.equal(r.h['Cache-Control'], 'no-store', 'dado antigo nunca fica em cache');
  r = await call('/api/v1/produtos/me05-etb'); assert.equal(fr(r).status, 'desatualizado');
  for (const g of [ago(2 * 1440), undefined, 'lixo']) {
    setLegacyLoader(async () => fx(g)); reset();
    r = await call('/api/v1/site/produtos'); assert.equal(r.status, 503, String(g)); assert.equal(r.h['Cache-Control'], 'no-store'); assert.equal(fr(r).status, 'indisponivel');
    assert.equal(r.json.items, undefined, 'nenhum preço servido');
  }
  // sem banco, /oportunidades segue "requires_db" (nenhuma nota) — com o frescor do state junto
  setLegacyLoader(async () => fx(ago(5))); reset();
  r = await call('/api/v1/oportunidades'); assert.equal(r.json.meta.status, 'requires_db'); assert.equal(r.json.meta.freshness.status, 'atual');
});

await t('3. fallback pelo GitHub: ramo data fora → main com state de 2 dias não é servido (503), nunca como atual', async () => {
  setLegacyLoader(null); reset();
  const realFetch = globalThis.fetch; let calls = [];
  globalThis.fetch = async (url) => { calls.push(String(url));
    if (String(url).includes('/data/data/')) return new Response('erro', { status: 500 });
    return new Response(JSON.stringify(fx(ago(2 * 1440))), { status: 200, headers: { 'content-type': 'application/json' } }); };
  try {
    const r = await call('/api/v1/home');
    assert.ok(calls.some((u) => u.includes('/main/')), 'caiu no main'); assert.equal(r.status, 503); assert.equal(fr(r).status, 'indisponivel');
    // main dentro do limite (raro, mas válido): servido, com o horário real
    globalThis.fetch = async (url) => String(url).includes('/data/data/') ? new Response('x', { status: 500 }) : new Response(JSON.stringify(fx(ago(20))), { status: 200 });
    setLegacyLoader(null); reset();
    const r2 = await call('/api/v1/home'); assert.equal(r2.status, 200); assert.equal(fr(r2).status, 'atual'); assert.equal(fr(r2).ageMin, 20);
  } finally { globalThis.fetch = realFetch; }
});

// ------------------------------------------------------------------ 3) site: mesmo cálculo e mesmo texto
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const cut = (a, b) => { const i = html.indexOf(a); const j = html.indexOf(b, i); assert.ok(i > 0 && j > i, a); return html.slice(i, j); };
const freshCode = cut('const FRESH_LIM=', 'setInterval(fresh,30e3);');
function siteFresh(S, now = NOW) {
  const el = { className: '', dataset: {} }; const slots = { '#fresh': el, '#mini-t': { innerHTML: '' }, '#fresh-t': { innerHTML: '' } };
  const ctx = { S, $: (s) => slots[s], Date: class extends Date { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } }, Math, Number };
  vm.runInNewContext(freshCode + '\nfresh(); this.st = freshState(S);', ctx);
  return { cls: el.className, status: el.dataset.freshness, mini: slots['#mini-t'].innerHTML, full: slots['#fresh-t'].innerHTML, st: ctx.st };
}

await t('4. site: indicador usa os mesmos limites e textos claros (nunca "Ao vivo" com dado antigo ou sem horário)', () => {
  let s = siteFresh({ generatedAt: ago(10) }); assert.equal(s.status, 'atual'); assert.equal(s.cls, 'fresh'); assert.match(s.full, /Ao vivo/);
  s = siteFresh({ generatedAt: ago(45) }); assert.equal(s.status, 'atrasado'); assert.equal(s.cls, 'fresh warn'); assert.match(s.full, /Atualizado há 45 min/); assert.doesNotMatch(s.full, /Ao vivo/);
  s = siteFresh({ generatedAt: ago(200) }); assert.equal(s.status, 'desatualizado'); assert.equal(s.cls, 'fresh bad'); assert.match(s.full, /Preços desatualizados.*Última atualização: 09\/10/);
  for (const g of [undefined, null, 'lixo']) { s = siteFresh({ generatedAt: g }); assert.equal(s.status, 'indisponivel'); assert.equal(s.cls, 'fresh bad'); assert.doesNotMatch(s.full + s.mini, /Ao vivo/); }
  // freshness da API tem prioridade sobre generatedAt; e o tempo passando é recalculado (o site atualiza a cada 30 s)
  s = siteFresh({ generatedAt: ago(1), freshness: { dataAt: ago(100) } }); assert.equal(s.status, 'desatualizado');
  assert.equal(siteFresh({ generatedAt: ago(25) }, NOW + 20 * 6e4).status, 'atrasado');
  for (const m of [0, 30, 31, 90, 91, 1440, 1441]) assert.equal(siteFresh({ generatedAt: ago(m) }).status, classify(ago(m), NOW).status, `site = API em ${m} min`);
});

await t('5. site: oportunidades pausadas (stale_db) na Home e em /oportunidades, sem nota antiga', () => {
  assert.match(html, /a\.meta\?\.status==="stale_db"\)Object\.assign\(HOMEOPP,\{status:"stale",top:\[\]\}\)/);
  assert.match(html, /d\.meta\?\.status==="stale_db"\)Object\.assign\(OPP,\{status:"stale",total:0\}\)/);
  assert.match(html, /HOMEOPP\.status==="stale"\)return`<p class="stage-empty">Oportunidades pausadas/);
  assert.match(html, /OPP\.status==="stale"\)return`<div class="empty"><h3>Oportunidades pausadas<\/h3>/);
});

// ------------------------------------------------------------------ 4) banco (PostgreSQL descartável)
const DB = process.env.TEST_DATABASE_URL;
if (DB) {
  const { default: pg } = await import('pg');
  const name = 'fresh_' + process.pid; const admin = new pg.Client(DB); await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${name}`); await admin.query(`CREATE DATABASE ${name}`);
  const u = new URL(DB); u.pathname = '/' + name; const url = u.toString();
  process.env.DATABASE_URL = url;
  const { tx, close } = await import('../src/db/pg.js');
  const { syncState } = await import('../src/core/sync.js'); const { runPriceEngine } = await import('../src/core/price-stats.js');
  const { runOpportunityEngine } = await import('../src/core/opportunity-run.js');
  spawnSync('node', ['tools/db-migrate.mjs'], { env: { ...process.env, DATABASE_URL: url }, cwd: root, stdio: 'pipe' });
  const sync = async (st) => { await tx((c) => syncState(c, { state: st, catalog: { collections: st.collections }, historyLines: [] }));
    await tx((c) => runPriceEngine(c, { asOf: new Date(NOW) })); await tx((c) => runOpportunityEngine(c, { now: new Date(NOW) })); };
  const ENDPOINTS = ['/api/v1/home', '/api/v1/site/produtos', '/api/v1/site/produto/me05-etb', '/api/v1/produtos', '/api/v1/produtos/me05-etb', '/api/v1/produtos/me05-etb/ofertas', '/api/v1/oportunidades'];
  try {
    await sync(fx(ago(10)));          // última rodada sincronizada: há 10 min
    process.env.API_DATABASE_URL = url;

    await t('6. banco atualizado: todos os endpoints dizem "banco, atual" com o MESMO horário (o do banco, não o do state.json)', async () => {
      setLegacyLoader(async () => fx(ago(2))); reset();            // state.json mais novo que o banco (sincronização em andamento)
      for (const e of ENDPOINTS) {
        const r = await call(e); assert.equal(r.status, 200, e); const f = fr(r);
        assert.equal(r.h['X-Data-Source'], 'db', e); assert.equal(f.source, 'db', e); assert.equal(f.status, 'atual', e); assert.equal(f.dataAt, ago(10), e);
        assert.equal(r.h['X-Data-At'], ago(10), e); assert.equal(f.fallback, undefined, e);
      }
      const h = await call('/api/v1/home'); assert.equal(h.json.generatedAt, ago(10), 'Home mostra o horário dos preços do banco');
      assert.equal(siteFresh(h.json).status, 'atual', 'site = API');
      const o = await call('/api/v1/oportunidades'); assert.ok(o.json.data.length > 0, 'oportunidades servidas');
    });

    await t('7. banco sem sincronizar há 3 h e robô em dia: serve o state.json (mais novo), marcado; oportunidades pausadas', async () => {
      setFreshnessClock(() => NOW + 170 * 6e4); const N2 = NOW + 170 * 6e4;    // banco com 180 min
      setLegacyLoader(async () => fx(new Date(N2 - 5 * 6e4).toISOString())); reset();
      for (const e of ENDPOINTS.filter((x) => !x.includes('oportunidades'))) {
        const r = await call(e); assert.equal(r.status, 200, e); const f = fr(r);
        assert.equal(r.h['X-Data-Source'], 'state', e); assert.equal(r.h['X-Fallback'], 'banco-desatualizado', e); assert.equal(f.source, 'state', e); assert.equal(f.status, 'atual', e);
        assert.equal(f.fallback.reason, 'banco-desatualizado'); assert.equal(f.fallback.dbAgeMin, 180); assert.equal(f.fallback.dbDataAt, ago(10)); assert.equal(r.h['Cache-Control'], 'no-store', e);
      }
      const o = await call('/api/v1/oportunidades');
      assert.equal(o.status, 200); assert.equal(o.json.meta.status, 'stale_db'); assert.deepEqual(o.json.data, [], 'nenhuma nota antiga'); assert.match(o.json.meta.message, /180 min/);
      assert.equal(o.json.meta.freshness.status, 'desatualizado'); assert.equal(o.h['Cache-Control'], 'no-store');
    });

    await t('8. banco e state.json parados há 3 h: serve o banco marcado "desatualizado" (sem cache); site mostra "Preços desatualizados"', async () => {
      const N2 = NOW + 170 * 6e4; setLegacyLoader(async () => fx(ago(15))); reset();      // state.json ainda mais velho que o banco
      const r = await call('/api/v1/home'); assert.equal(r.status, 200); assert.equal(fr(r).source, 'db'); assert.equal(fr(r).status, 'desatualizado'); assert.equal(r.h['Cache-Control'], 'no-store');
      const s = siteFresh(r.json, N2); assert.equal(s.status, 'desatualizado'); assert.match(s.full, /Preços desatualizados/);
      // mais de 24 h: indisponível → 503 em tudo que tem preço; oportunidades seguem pausadas (sem dado)
      setFreshnessClock(() => NOW + 1500 * 6e4); reset();
      for (const e of ENDPOINTS.filter((x) => !x.includes('oportunidades'))) { const x = await call(e); assert.equal(x.status, 503, e); assert.equal(fr(x).status, 'indisponivel', e); }
      const o = await call('/api/v1/oportunidades'); assert.equal(o.status, 200); assert.equal(o.json.meta.status, 'stale_db');
      setFreshnessClock(() => NOW);
    });

    await t('9. falha de conexão: state.json em dia é servido como fallback (com origem e idade); state antigo vai marcado', async () => {
      process.env.API_DATABASE_URL = 'postgres://x:SENHA@127.0.0.1:1/nada';
      const { closeApiPool } = await import('../api/_lib/db.mjs'); await closeApiPool();
      setLegacyLoader(async () => fx(ago(20))); reset();
      const err = console.error; console.error = () => {};
      try {
        let r = await call('/api/v1/home');
        assert.equal(r.status, 200); assert.equal(r.h['X-Fallback'], 'db-indisponivel'); assert.equal(fr(r).source, 'state'); assert.equal(fr(r).status, 'atual'); assert.equal(fr(r).ageMin, 20);
        assert.equal(fr(r).fallback.reason, 'db-indisponivel'); assert.ok(!JSON.stringify(r).includes('SENHA'));
        r = await call('/api/v1/oportunidades'); assert.equal(r.json.meta.status, 'requires_db');
        setLegacyLoader(async () => fx(ago(300))); reset();
        r = await call('/api/v1/site/produtos'); assert.equal(r.status, 200); assert.equal(fr(r).status, 'desatualizado'); assert.equal(r.h['Cache-Control'], 'no-store');
        setLegacyLoader(async () => fx(ago(3000))); reset();
        r = await call('/api/v1/site/produtos'); assert.equal(r.status, 503, 'fallback expirado não é servido');
      } finally { console.error = err; await closeApiPool(); process.env.API_DATABASE_URL = url; }
    });

    await t('10. banco sem horário válido (sem ofertas ativas): nunca "atual"; usa state.json em dia ou responde 503', async () => {
      await tx((c) => c.query(`UPDATE hunter.offer SET status = 'removed'`));
      setLegacyLoader(async () => fx(ago(5))); reset();
      let r = await call('/api/v1/home'); assert.equal(r.h['X-Fallback'], 'banco-desatualizado'); assert.equal(fr(r).source, 'state'); assert.equal(fr(r).fallback.dbDataAt, undefined);
      r = await call('/api/v1/oportunidades'); assert.equal(r.json.meta.status, 'stale_db');
      setLegacyLoader(async () => fx(undefined)); reset();
      r = await call('/api/v1/home'); assert.equal(r.status, 503); assert.equal(fr(r).status, 'indisponivel');
    });
  } finally {
    const { closeApiPool } = await import('../api/_lib/db.mjs'); await closeApiPool(); await close();
    await admin.query(`DROP DATABASE IF EXISTS ${name}`); await admin.end(); delete process.env.API_DATABASE_URL;
  }
} else console.log('(sem TEST_DATABASE_URL: testes 6–10, de banco, pulados)');

// ------------------------------------------------------------------ 5) páginas renderizadas no servidor
await t('11. páginas do servidor: preços no HTML só com dados em dia; antigo vai sem o conteúdo pré-renderizado', () => {
  const script = `import { setFreshnessClock } from ${JSON.stringify(path.join(root, 'api/_lib/freshness.mjs'))};
    setFreshnessClock(() => ${NOW}); const st = JSON.parse(process.argv[1]);
    globalThis.fetch = async () => new Response(JSON.stringify(st), { status: 200 });
    const { default: h } = await import(${JSON.stringify(path.join(root, 'api/pagina.mjs'))});
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
    await h({ url: '/api/pagina?t=produto&slug=escuridao-absoluta-treinador-avancado-etb', headers: { host: 'x' } }, res);
    console.log(JSON.stringify({ status: res.statusCode, ssr: res.body.includes('class="ssr"'), price: res.body.includes('R$ 300,00') }));`;
  const run = (st) => JSON.parse(spawnSync(process.execPath, ['--input-type=module', '-e', script, JSON.stringify(st)], { cwd: root, encoding: 'utf8', env: { ...process.env, API_DATABASE_URL: '' } }).stdout.trim().split('\n').pop());
  const ok = run(fx(ago(10))); assert.deepEqual(ok, { status: 200, ssr: true, price: true }, 'em dia: HTML com preço');
  const old = run(fx(ago(200))); assert.deepEqual(old, { status: 200, ssr: false, price: false }, 'antigo: página sem preço pré-renderizado');
  const bad = run(fx('lixo')); assert.deepEqual(bad, { status: 200, ssr: false, price: false });
});

setLegacyLoader(null);
console.log(`✓ Frescor dos dados (Lote 2): ${n} grupos de testes passaram${DB ? ' (puro + banco)' : ' (puro)'}`);
