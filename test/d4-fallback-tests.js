// D4 (frentes/T4-E.md) — a cadeia de fallback do state.json no navegador (DATA_BASES = raw data, raw main, /data/) não pode
// cair na cópia congelada da main (data/state.json versionado, 07/10, que o build copia para public/data/) e mostrá-la
// como "Ao vivo". Política: a mesma da API (api/_lib/freshness.mjs, LIMITS.EXPIRA_MIN = 24 h; docs/frescor.md, regra 4):
// state.json sem produtos/ofertas, sem horário confiável (dataAt nulo, inválido, no futuro) ou com mais de 24 h é pulado.
// Entre 90 min e 24 h continua aceito (decisão do dono de 17/10, barra neutra). Histórico (hist/*.json) não muda.
// Roda os trechos reais de index.html num sandbox com fetch falso (sem rede). O teste de navegador fica em
// test/d4-fallback-browser.mjs (Playwright, fora do npm test).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { LIMITS, classify } from '../api/_lib/freshness.mjs';

let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { e.message = `${name}: ${e.message}`; throw e; } };
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const cut = (a, b) => { const i = html.indexOf(a); const j = html.indexOf(b, i); assert.ok(i > 0 && j > i, `trecho ${a}`); return html.slice(i, j); };
const code = cut('const FRESH_LIM=', 'const freshAt=') + cut('const RAWB=', '/* FASE 4');

const NOW = Date.parse('2026-10-25T12:00:00Z');
const ago = (min) => new Date(NOW - min * 6e4).toISOString();
const RAW_DATA = 'https://raw.githubusercontent.com/o/r/data/data/', RAW_MAIN = 'https://raw.githubusercontent.com/o/r/main/data/', DEPLOY = '/data/';
const st = (over = {}) => ({ products: [{ id: 'p1' }], offers: [{ id: 'o1', productId: 'p1', stock: 'IN_STOCK', total: 10 }], generatedAt: ago(5), dataAt: ago(5), ...over });
const frozen = JSON.parse(fs.readFileSync(new URL('../data/state.json', import.meta.url), 'utf8'));   // a cópia da main de verdade

/** routes: { [base]: objeto JSON | número (status HTTP) | 'lixo' (JSON inválido) | 'rede' (falha de rede) }
 *  now = relógio do servidor (vai nos cabeçalhos); client = relógio do aparelho (Date do sandbox).
 *  Cabeçalhos como no navegador: o raw do GitHub manda Date, mas o CORS só expõe Expires/Cache-Control; /data/ e a API
 *  são da mesma origem (Date legível). opts.headers(base) troca os cabeçalhos. */
const srvHeaders = (base, now) => (base === RAW_DATA || base === RAW_MAIN
  ? { expires: new Date(now + 300e3).toUTCString(), 'cache-control': 'max-age=300' }
  : { date: new Date(now).toUTCString() });
function sandbox(routes, now = NOW, opts = {}) {
  const client = opts.client ?? now; const calls = [];
  const fetch = async (u) => {
    calls.push(String(u));
    const base = [RAW_DATA, RAW_MAIN, DEPLOY, '/api/v1/'].find((b) => String(u).startsWith(b));
    const v = routes[base];
    if (v === undefined || v === 'rede') throw new Error('rede');
    const hs = Object.fromEntries(Object.entries((opts.headers || srvHeaders)(base, now) || {}).map(([k, x]) => [k.toLowerCase(), x]));
    const headers = { get: (k) => hs[String(k).toLowerCase()] ?? null };
    if (typeof v === 'number') return { ok: v >= 200 && v < 300, status: v, headers, json: async () => ({}) };
    return { ok: true, status: 200, headers, json: async () => { if (v === 'lixo') throw new SyntaxError('json'); return JSON.parse(JSON.stringify(v)); } };
  };
  const ctx = { fetch, REPO: { owner: 'o', repo: 'r' }, location: { search: '' }, URLSearchParams, AbortController, setTimeout, clearTimeout, Object, Array, Math, Number, String,
    Date: class extends Date { constructor(...a) { super(...(a.length ? a : [client])); } static now() { return client; } } };
  vm.createContext(ctx); vm.runInContext(code + '\n;globalThis.__={fetchState,fetchData,fetchHome,freshState,DATA_BASES,FRESH_LIM};', ctx);
  return { ...ctx.__, calls };
}

await t('1. política: limite do site = limite da API (24 h) e ordem das fontes preservada', () => {
  const s = sandbox({});
  assert.equal(s.FRESH_LIM.expira, LIMITS.EXPIRA_MIN);
  assert.deepEqual([...s.DATA_BASES], [RAW_DATA, RAW_MAIN, DEPLOY]);
});

await t('2. raw data fora + cópia congelada da main (raw main e /data/): nada vira dado', async () => {
  const s = sandbox({ [RAW_DATA]: 404, [RAW_MAIN]: frozen, [DEPLOY]: frozen });
  const r = await s.fetchState(); assert.ok(r === null, `aceitou a cópia de ${r?.generatedAt}`);   // sem diff do objeto inteiro (1,7 MB)
  assert.deepEqual(s.calls.map((u) => u.replace(/state\.json$/, '')), [RAW_DATA, RAW_MAIN, DEPLOY], 'tentou as três e recusou as duas cópias');
  assert.equal(s.freshState(frozen).status, 'indisponivel', 'a cópia da main (generatedAt 07/10) está vencida em 25/10');
});

await t('3. raw data em dia: usado na primeira tentativa', async () => {
  const fresh = st();
  const s = sandbox({ [RAW_DATA]: fresh, [RAW_MAIN]: frozen, [DEPLOY]: frozen });
  assert.deepEqual(await s.fetchState(), fresh); assert.equal(s.calls.length, 1);
});

await t('4. raw data vencido (robô parado > 24 h) também é recusado; /data/ recente (deploy novo) é aceito', async () => {
  const r = await sandbox({ [RAW_DATA]: st({ dataAt: ago(1441), generatedAt: ago(5) }), [RAW_MAIN]: frozen, [DEPLOY]: frozen }).fetchState();
  assert.ok(r === null, `aceitou ${r?.dataAt ?? r?.generatedAt}`);
  const dep = st({ dataAt: ago(20), generatedAt: ago(20) });
  assert.deepEqual(await sandbox({ [RAW_DATA]: 'rede', [RAW_MAIN]: 503, [DEPLOY]: dep }).fetchState(), dep);
});

await t('5. limites: 90 min–24 h aceito (decisão de 17/10); 1440 aceito, 1441 recusado; igual ao classify da API', async () => {
  for (const m of [0, 30, 91, 200, 1440, 1441, 3000]) {
    const r = await sandbox({ [RAW_DATA]: st({ dataAt: ago(m) }) }).fetchState();
    assert.equal(r !== null, classify(ago(m), NOW).status !== 'indisponivel', `${m} min`);
    assert.equal(r !== null, m <= 1440, `${m} min`);
  }
});

await t('6. sem horário confiável = não recente: dataAt nulo (mesmo com generatedAt novo), inválido, no futuro, ausente', async () => {
  for (const bad of [st({ dataAt: null }), st({ dataAt: 'lixo' }), st({ dataAt: new Date(NOW + 10 * 6e4).toISOString() }), (() => { const x = st(); delete x.dataAt; delete x.generatedAt; return x; })()]) {
    const r = await sandbox({ [RAW_DATA]: bad, [RAW_MAIN]: frozen, [DEPLOY]: frozen }).fetchState();
    assert.ok(r === null, `dataAt ${JSON.stringify(bad.dataAt)}: aceitou ${r?.dataAt ?? r?.generatedAt}`);
  }
  const legado = st(); delete legado.dataAt;   // state.json antigo, sem o campo: vale o generatedAt (#621)
  assert.deepEqual(await sandbox({ [RAW_DATA]: legado }).fetchState(), legado);
});

await t('7. ausente/inválido/parcial: 404, JSON quebrado, sem ofertas ou sem produtos passam para a próxima fonte', async () => {
  const good = st({ dataAt: ago(40) });
  for (const bad of [404, 500, 'lixo', 'rede', { generatedAt: ago(1), dataAt: ago(1) }, st({ offers: undefined }), st({ products: null }), null]) {
    const s = sandbox({ [RAW_DATA]: bad, [RAW_MAIN]: good });
    assert.deepEqual(await s.fetchState(), good, `fonte ruim: ${JSON.stringify(bad)?.slice(0, 40)}`);
  }
});

await t('8. recuperação: depois de uma falha total, a próxima busca com a fonte de volta funciona (nada fica preso)', async () => {
  const routes = { [RAW_DATA]: 503, [RAW_MAIN]: frozen, [DEPLOY]: frozen };
  const s = sandbox(routes);
  const r0 = await s.fetchState(); assert.ok(r0 === null, `aceitou ${r0?.generatedAt}`);
  routes[RAW_DATA] = st();
  assert.equal((await s.fetchState()).dataAt, ago(5));
});

await t('9. histórico (hist/*.json) segue a regra antiga: primeira resposta ok, sem filtro de idade', async () => {
  const h = { productId: 'p1', stores: {} };
  const s = sandbox({ [RAW_DATA]: 404, [RAW_MAIN]: h });
  assert.deepEqual(await s.fetchData('hist/p1.json'), h);
});

await t('10. /api/v1/home: resposta com frescor vencido ou sem horário não é usada; em dia é usada', async () => {
  const home = (fr) => ({ v: 1, slim: true, products: [{ id: 'p1', collection: 'c', type: 't' }], offers: [], counts: {}, collections: [], types: [], ...fr });
  assert.equal(await sandbox({ '/api/v1/': home({ freshness: { status: 'indisponivel', dataAt: null }, generatedAt: null }) }).fetchHome(), null);
  assert.equal(await sandbox({ '/api/v1/': home({ freshness: { status: 'indisponivel', dataAt: ago(1500) }, generatedAt: ago(1500) }) }).fetchHome(), null);
  const ok = await sandbox({ '/api/v1/': home({ freshness: { status: 'atual', dataAt: ago(3) }, generatedAt: ago(3) }) }).fetchHome();
  assert.ok(ok && ok.products.length === 1);
  assert.equal(await sandbox({ '/api/v1/': 503 }).fetchHome(), null);
});

// R1 (frentes/rev-d4.md): o relógio do aparelho não decide. A API já classifica com relógio confiável; o state.json é medido
// contra o relógio do servidor que respondeu.
await t('11. relógio do aparelho errado (−10 min, −30 min, +2 dias) não derruba fonte em dia nem salva cópia vencida', async () => {
  const home = { v: 1, slim: true, products: [{ id: 'p1', collection: 'c', type: 't' }], offers: [], counts: {}, collections: [], types: [], freshness: { status: 'atual', dataAt: ago(2) }, generatedAt: ago(2) };
  for (const off of [-10, -30, 2 * 1440]) {
    const client = NOW + off * 6e4;
    const fresh = st({ dataAt: ago(2), generatedAt: ago(2) });
    assert.deepEqual(await sandbox({ [RAW_DATA]: fresh }, NOW, { client }).fetchState(), fresh, `raw em dia, aparelho ${off} min`);
    assert.deepEqual(await sandbox({ [RAW_DATA]: 404, [RAW_MAIN]: 404, [DEPLOY]: fresh }, NOW, { client }).fetchState(), fresh, `/data/ em dia, aparelho ${off} min`);
    assert.ok(await sandbox({ '/api/v1/': home }, NOW, { client }).fetchHome(), `API em dia, aparelho ${off} min`);
    const r = await sandbox({ [RAW_DATA]: 404, [RAW_MAIN]: frozen, [DEPLOY]: frozen }, NOW, { client: Date.parse('2026-10-07T14:00:00Z') }).fetchState();
    assert.ok(r === null, 'aparelho com a data de 07/10 não ressuscita a cópia congelada');
  }
});

await t('12. referência do servidor: Date (mesma origem) tem prioridade; Expires − max-age no raw; sem referência = recusado', async () => {
  const fresh = st({ dataAt: ago(2), generatedAt: ago(2) });
  const r1 = await sandbox({ [RAW_DATA]: fresh }, NOW, { headers: () => ({}) }).fetchState();
  assert.ok(r1 === null, 'sem Date nem Expires: sem horário confiável');
  const r2 = await sandbox({ [RAW_DATA]: fresh }, NOW, { headers: () => ({ expires: new Date(NOW + 300e3).toUTCString() }) }).fetchState();
  assert.ok(r2 === null, 'Expires sem max-age não serve de referência');
  const velho = NOW + 3 * 1440 * 6e4;   // servidor diz que já se passaram 3 dias desde a leitura
  const r3 = await sandbox({ [RAW_DATA]: fresh }, NOW, { headers: () => ({ date: new Date(velho).toUTCString(), expires: new Date(NOW + 300e3).toUTCString(), 'cache-control': 'max-age=300' }) }).fetchState();
  assert.ok(r3 === null, 'Date manda (3 dias depois da leitura = vencido)');
  assert.deepEqual(await sandbox({ [RAW_DATA]: fresh }, NOW, { headers: () => ({ expires: new Date(NOW + 60e3).toUTCString(), 'cache-control': 'public, max-age=60' }) }).fetchState(), fresh);
});

console.log(`d4-fallback: ${n} grupos ok`);
