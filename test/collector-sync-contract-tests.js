// Issue #614 — sincronização do frescor entre etapas: coletor (sources.json/offers.json) → normalização para o banco
// (offersRows/storesRows) → API (state.json/stateProductOffers + classify) → UI (index.html). Rodadas reais de runOnce
// com fetch simulado: sucesso, falha parcial, falha total, horário ausente/no futuro e recuperação. Nenhuma etapa pode
// usar o horário de outra como prova de frescor. Matriz em docs/frescor.md ("Sincronização entre etapas").
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import vm from 'node:vm'; import { fileURLToPath } from 'node:url';
process.env.HUNTER_DOMAIN_DELAY_MS = '0';
process.env.HUNTER_TIPS = '0';
for (const k of ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_SHA', 'GITHUB_EVENT_NAME', 'HUNTER_CEP', 'HUNTER_BUDGET_MIN']) delete process.env[k];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hunter-sync-'));
process.env.HUNTER_CONFIG_DIR = path.join(tmp, 'config'); process.env.HUNTER_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.HUNTER_CONFIG_DIR, { recursive: true });
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
fs.copyFileSync(path.join(root, 'config/catalog.json'), path.join(tmp, 'config/catalog.json'));
fs.writeFileSync(path.join(tmp, 'config/stores.json'), JSON.stringify({ stores: [
  { id: 'vt', name: 'Loja VTEX', url: 'https://vt.test', platform: 'vtex', kind: 'specialist', evidence: {} },
  { id: 'ld', name: 'Loja JSON-LD', url: 'https://ld.test', platform: 'jsonld', kind: 'specialist', evidence: {} },
] }));
fs.writeFileSync(path.join(tmp, 'config/watchlist.json'), JSON.stringify({ settings: { cep: null }, rules: [] }));

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const html = (s, status = 200) => new Response(s, { status, headers: { 'content-type': 'text/html' } });
const http = await import('../src/http.js');
// VTEX: um anúncio (me05-box36). JSON-LD: uma página de produto (me04-box36).
const vt = { down: false }; const ld = { down: false, page: 'ok' };
const P1 = '/pokemon-booster-box-caos-ascendente-36';
const page = (name, price) => html(`<html><head><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', name, offers: { '@type': 'Offer', price, priceCurrency: 'BRL', availability: 'https://schema.org/InStock' } })}</script></head><body><h1>${name}</h1><p>R$ ${price.replace('.', ',')}</p>${'x'.repeat(40000)}</body></html>`);
http.setFetch(async (url) => {
  const u = new URL(url);
  if (u.pathname === '/robots.txt') return html('', 404);
  if (u.host === 'ld.test') {
    if (ld.down) return html('erro', 503);
    if (u.pathname === '/sitemap.xml') return html(`<urlset><url><loc>https://ld.test${P1}</loc></url></urlset>`);
    if (u.pathname === P1) return ld.page === '503' ? html('erro', 503) : page('Pokémon Booster Box Caos Ascendente 36 boosters Copag', '359.90');
  }
  if (u.host === 'vt.test') {
    if (vt.down) return html('erro', 503);
    if (u.pathname.startsWith('/api/catalog_system')) return json(u.searchParams.get('ft') === 'pokemon' ? [{ productName: 'Box Display Pokémon ME05 Escuridão Absoluta 36 Boosters Copag', link: 'https://vt.test/me05-display/p',
      items: [{ itemId: '1', name: 'u', sellers: [{ sellerId: '1', sellerName: 'Loja VTEX', commertialOffer: { Price: 449.9, ListPrice: 449.9, AvailableQuantity: 5 } }] }] }] : []);
  }
  return html('', 404);
});

const { runOnce, recentRead, rankBestDeals, liveForScore } = await import('../src/run.js');
const { offersRows, storesRows } = await import('../src/core/mappers.js');
const { classify, stateDataAt } = await import('../api/_lib/freshness.mjs');
const { stateProductOffers } = await import('../api/_lib/read-state.mjs');

// UI: código real de index.html num sandbox (como test/trust-ux-tests.js).
const page0 = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const line = (a) => { const i = page0.indexOf(a); assert.ok(i > 0, `trecho ${a}`); return page0.slice(i, page0.indexOf('\n', i)); };
const cut = (a, b) => { const i = page0.indexOf(a); const j = page0.indexOf(b, i); assert.ok(i > 0 && j > i, `trecho ${a}`); return page0.slice(i, j); };
const ui = { Date, Number, Math, String };
vm.createContext(ui);
vm.runInContext(line('const ago=') + '\n' + cut('/* Última leitura da oferta', 'const shipNote=') + '\n' + cut('const FRESH_LIM=', 'const freshAt=') +
  '\n;globalThis.__t={readKnown,readNote,staleNote,freshState};', ui);
const { readKnown, readNote, staleNote, freshState } = ui.__t;

const quiet = () => {}; const send = { capture: async () => true };
const base = Date.parse('2026-10-13T10:00:00Z');
const at = (min) => new Date(base + min * 60e3); const iso = (min) => at(min).toISOString();
const dataFile = (f) => path.join(process.env.HUNTER_DATA_DIR, f);
const readData = (f) => JSON.parse(fs.readFileSync(dataFile(f), 'utf8'));
const round = (min) => runOnce({ log: quiet, send, now: at(min) });
// Rodada no relógio do teste: o backoff e o prazo da rodada usam Date.now, então fixa-o no horário da rodada.
const realNow = Date.now;
const roundAt = async (min) => { Date.now = () => base + min * 60e3; try { return await round(min); } finally { Date.now = realNow; } };
const vtOf = (s) => s.offers.find((o) => o.storeId === 'vt'); const ldOf = (s) => s.offers.find((o) => o.storeId === 'ld');
const src = (s, id) => s.sources.find((x) => x.id === id);
const health = (s, id) => storesRows(s.sources).find((r) => r.id === id).health;
const rowOf = (o) => offersRows([o])[0];
// Espelho do frescor do banco (DB_AT_SQL em api/_lib/freshness.mjs): max(last_seen_at) das ofertas ativas/pendentes.
const dbAt = (s) => { const t = offersRows(s.offers).filter((r) => ['active', 'pending'].includes(r.status) && r.last_seen_at).map((r) => r.last_seen_at).sort().at(-1); return t ?? null; };
const apiItem = (s, o) => stateProductOffers(s, o.productId, { page: 1, limit: 10 }).items.find((i) => i.id === o.id);
let n = 0;
const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };

let s;
await t('1. rodada bem-sucedida: o mesmo horário em todas as etapas', async () => {
  s = await roundAt(0);
  for (const o of [vtOf(s), ldOf(s)]) {
    assert.ok(o, 'as duas lojas trazem oferta'); assert.equal(o.stale, false); assert.equal(o.source_timestamp, iso(0));
    const r = rowOf(o); assert.deepEqual([r.status, r.last_seen_at], ['active', iso(0)]);
    const a = apiItem(s, o); assert.deepEqual([a.status, a.last_seen_at], ['active', iso(0)]);
    Date.now = () => base + 5 * 60e3; try { assert.equal(readKnown(o), true); assert.equal(readNote(o), 'Atualizado há 5 min'); } finally { Date.now = realNow; }
  }
  for (const id of ['vt', 'ld']) { assert.equal(src(s, id).status, 'ACTIVE'); assert.deepEqual([health(s, id).last_check_at, health(s, id).last_success_at], [iso(0), iso(0)]); }
  assert.equal(s.generatedAt, iso(0)); assert.equal(s.dataAt, iso(0)); assert.equal(dbAt(s), iso(0));
});

await t('2. erro parcial: loja que falhou e página que falhou ficam stale com o horário antigo; a fonte diz o que houve', async () => {
  vt.down = true; ld.page = '503';
  s = await roundAt(15);
  const v = vtOf(s); const l = ldOf(s);
  // VTEX caiu: status ERROR, conferida agora, último sucesso não avança.
  assert.equal(src(s, 'vt').status, 'ERROR');
  assert.deepEqual([health(s, 'vt').last_check_at, health(s, 'vt').last_success_at], [iso(15), iso(0)]);
  assert.equal(storesRows(s.sources).find((r) => r.id === 'vt').health.status, 'ERROR', 'falha da fonte chega ao banco em source_health');
  // JSON-LD respondeu, mas a página do produto falhou: a loja é ACTIVE (lastSuccess avança) e a oferta é stale.
  assert.equal(src(s, 'ld').status, 'ACTIVE'); assert.equal(src(s, 'ld').pageFailures, 1);
  assert.equal(health(s, 'ld').last_success_at, iso(15), 'sucesso da loja ≠ oferta lida: last_success_at não prova frescor da oferta');
  for (const o of [v, l]) {
    assert.deepEqual([o.stale, o.stock, o.source_timestamp, o.lastValid.at], [true, 'UNKNOWN', iso(0), iso(0)], `${o.storeId}: horário não renovado`);
    const r = rowOf(o); assert.deepEqual([r.status, r.stock_status, r.last_seen_at], ['pending', 'unknown', iso(0)]);
    const a = apiItem(s, o); assert.deepEqual([a.status, a.stock, a.last_seen_at], ['pending', 'unknown', iso(0)]);
    assert.equal(recentRead(o, at(15)), false); assert.equal(liveForScore(o), false);
  }
  assert.deepEqual(rankBestDeals(s.offers), [], 'nenhuma oferta parada no ranking');
  assert.equal(dbAt(s), iso(0), 'o banco não avança sem leitura nova');
  assert.deepEqual([s.generatedAt, s.dataAt], [iso(15), iso(0)], 'state.json: rodada nova, última leitura antiga');
});

await t('3. falha total: horário por oferta envelhece; generatedAt avança, mas o frescor do state.json é o da última leitura (#621)', async () => {
  ld.down = true; // vt continua fora do ar
  s = await roundAt(120);
  for (const o of [vtOf(s), ldOf(s)]) {
    assert.deepEqual([o.stale, o.source_timestamp], [true, iso(0)]);
    assert.equal(classify(apiItem(s, o).last_seen_at, base + 120 * 60e3).status, 'desatualizado', 'idade real da oferta na API');
    Date.now = () => base + 120 * 60e3; try { assert.equal(staleNote(o), 'Última leitura há 2 h'); } finally { Date.now = realNow; }
  }
  assert.equal(classify(dbAt(s), base + 120 * 60e3).status, 'desatualizado', 'frescor do banco: só leituras reais contam');
  // #621 (antes, lacuna 4): generatedAt é o horário da rodada e avança; o frescor do state.json (fallback da API,
  // páginas e barra da UI) vem de dataAt, a última leitura real, e envelhece como as ofertas.
  assert.equal(s.generatedAt, iso(120));
  assert.equal(s.dataAt, iso(0));
  assert.equal(classify(stateDataAt(s), base + 120 * 60e3).status, 'desatualizado');
  assert.equal(freshState(s, base + 120 * 60e3).status, 'desatualizado', 'a barra não diz "atual" sem leitura nova');
  assert.equal(freshState(s, base + 120 * 60e3).ageMin, 120);
  assert.equal(src(s, 'ld').status, 'ACTIVE', 'JSON-LD com todas as páginas fora do ar ainda conta como ACTIVE (lacuna 5)');
  assert.equal(src(s, 'ld').pageFailures, 1);
});

await t('4. horário ausente ou no futuro na leitura anterior: nada inventa horário na falha', async () => {
  const off = readData('offers.json'); const v = Object.values(off).find((o) => o.storeId === 'vt'); const l = Object.values(off).find((o) => o.storeId === 'ld');
  delete v.source_timestamp; v.lastValid = { ...v.lastValid, at: null };            // legado sem horário
  l.source_timestamp = l.lastValid.at = iso(24 * 60);                              // relógio adiantado (1 dia no futuro)
  fs.writeFileSync(dataFile('offers.json'), JSON.stringify(off));
  s = await roundAt(135);
  const sv = vtOf(s); const sl = ldOf(s);
  assert.equal(sv.stale, true); assert.equal(sv.source_timestamp, undefined, 'ausente continua ausente');
  assert.equal(rowOf(sv).last_seen_at, null, 'banco recebe nulo (o sync usa now(): lacuna 2)'); assert.equal(apiItem(s, sv).last_seen_at, null);
  assert.equal(classify(apiItem(s, sv).last_seen_at, base + 135 * 60e3).status, 'indisponivel');
  assert.equal(readKnown(sv), false); assert.equal(readNote(sv), 'Data da leitura desconhecida'); assert.equal(staleNote(sv), 'Última leitura em data desconhecida');
  assert.equal(sl.stale, true); assert.equal(sl.source_timestamp, iso(24 * 60), 'horário no futuro não é corrigido nem renovado');
  assert.equal(classify(apiItem(s, sl).last_seen_at, base + 135 * 60e3).status, 'indisponivel', 'API: no futuro = sem horário confiável');
  Date.now = () => base + 135 * 60e3;
  try {
    assert.equal(readKnown(sl), false, 'UI: no futuro (> 5 min) não é "Atualizado agora"');
    assert.equal(readNote(sl), 'Data da leitura desconhecida');
    assert.equal(readKnown({ source_timestamp: iso(139) }), true, 'folga de relógio de até 5 min, como classify');
  } finally { Date.now = realNow; }
  assert.equal(recentRead(sv, at(135)), false); assert.equal(recentRead(sl, at(135)), false);
  assert.equal(s.dataAt, null, 'sem horário ausente nem no futuro como "última leitura"');
  assert.equal(freshState(s, base + 135 * 60e3).status, 'indisponivel');
});

await t('5. recuperação: a primeira rodada bem-sucedida renova tudo, em todas as etapas', async () => {
  vt.down = false; ld.down = false; ld.page = 'ok';
  s = await roundAt(24 * 60 + 30); // depois do backoff da VTEX e do horário "no futuro" da rodada anterior
  const T = iso(24 * 60 + 30); const now = base + (24 * 60 + 30) * 60e3;
  for (const o of [vtOf(s), ldOf(s)]) {
    assert.deepEqual([o.stale, o.stock, o.source_timestamp, 'lastValid' in o], [false, 'IN_STOCK', T, false], `${o.storeId}: sem resto da falha`);
    const r = rowOf(o); assert.deepEqual([r.status, r.stock_status, r.last_seen_at], ['active', 'in_stock', T]);
    const a = apiItem(s, o); assert.deepEqual([a.status, a.last_seen_at], ['active', T]);
    assert.equal(classify(a.last_seen_at, now).status, 'atual'); assert.equal(recentRead(o, at(24 * 60 + 30)), true);
    Date.now = () => now; try { assert.equal(readNote(o), 'Atualizado agora'); } finally { Date.now = realNow; }
  }
  for (const id of ['vt', 'ld']) { assert.equal(src(s, id).status, 'ACTIVE'); assert.equal(src(s, id).fails, 0); assert.equal(health(s, id).last_success_at, T); }
  assert.equal(src(s, 'ld').pageFailures, 0);
  assert.equal(dbAt(s), T); assert.equal(classify(dbAt(s), now).status, 'atual');
  for (const o of [vtOf(s), ldOf(s)]) assert.equal(liveForScore(o), true, `${o.storeId}: lida de novo, volta a concorrer`);
  assert.deepEqual([s.generatedAt, s.dataAt], [T, T]); assert.equal(freshState(s, now).status, 'atual', 'recuperação: a barra volta a "atual"');
});

await t('6. sucesso parcial depois da recuperação: uma loja lida basta para o state.json estar em dia (#621)', async () => {
  vt.down = true;
  s = await roundAt(24 * 60 + 45);
  const T = iso(24 * 60 + 45); const now = base + (24 * 60 + 45) * 60e3;
  assert.deepEqual([vtOf(s).stale, vtOf(s).source_timestamp], [true, iso(24 * 60 + 30)], 'a loja fora do ar fica stale com o horário dela');
  assert.deepEqual([ldOf(s).stale, ldOf(s).source_timestamp], [false, T]);
  assert.deepEqual([s.generatedAt, s.dataAt], [T, T]);
  assert.equal(classify(stateDataAt(s), now).status, 'atual'); assert.equal(freshState(s, now).status, 'atual');
});

console.log(`collector-sync-contract-tests: ${n} testes ok`);
