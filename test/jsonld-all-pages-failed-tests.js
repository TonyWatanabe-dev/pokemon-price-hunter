// Issue #619 (lacuna 5 de docs/frescor.md): loja JSON-LD em que todas as páginas planejadas falham não é sucesso. Fica
// ERROR, lastSuccess não avança e entra no backoff; pageFailures/pageFailReason continuam registrando a falha. Falha
// parcial e recuperação seguem ACTIVE. Rodadas reais de runOnce, fetch simulado (sem rede).
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
process.env.HUNTER_DOMAIN_DELAY_MS = '0';
process.env.HUNTER_TIPS = '0';
for (const k of ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_SHA', 'GITHUB_EVENT_NAME', 'HUNTER_CEP', 'HUNTER_BUDGET_MIN', 'HUNTER_JSONLD_RETRY_MAX', 'HUNTER_JSONLD_RETRY_H']) delete process.env[k];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hunter-ld-allfail-'));
process.env.HUNTER_CONFIG_DIR = path.join(tmp, 'config'); process.env.HUNTER_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.HUNTER_CONFIG_DIR, { recursive: true });
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
fs.copyFileSync(path.join(root, 'config/catalog.json'), path.join(tmp, 'config/catalog.json'));
fs.writeFileSync(path.join(tmp, 'config/stores.json'), JSON.stringify({ stores: [
  { id: 'ld', name: 'Loja JSON-LD', url: 'https://ld.test', platform: 'jsonld', kind: 'specialist', evidence: {} },
] }));
fs.writeFileSync(path.join(tmp, 'config/watchlist.json'), JSON.stringify({ settings: { cep: null }, rules: [] }));

const html = (s, status = 200) => new Response(s, { status, headers: { 'content-type': 'text/html' } });
const page = (name, price) => html(`<html><head><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', name, offers: { '@type': 'Offer', price, priceCurrency: 'BRL', availability: 'https://schema.org/InStock' } })}</script></head><body><h1>${name}</h1><p>R$ ${price.replace('.', ',')}</p>${'x'.repeat(40000)}</body></html>`);
// Duas páginas de produto. O sitemap só é lido na 1ª rodada (cache de 24 h): depois, só as páginas contam.
const P = { A: '/pokemon-booster-box-caos-ascendente-36', B: '/pokemon-blister-triplo-escuridao' };
const NAMES = { A: ['Pokémon Booster Box Caos Ascendente 36 boosters Copag', '359.90'], B: ['Pokémon Blister Triplo Escuridão Absoluta Copag', '39.90'] };
const mode = { A: 'ok', B: 'ok' }; const hits = {};
const http = await import('../src/http.js');
http.setFetch(async (url) => {
  const u = new URL(url);
  if (u.pathname === '/robots.txt') return html('', 404);
  if (u.host !== 'ld.test') return html('', 404);
  if (u.pathname === '/sitemap.xml') return html('<urlset>' + Object.values(P).map((p) => `<url><loc>https://ld.test${p}</loc></url>`).join('') + '</urlset>');
  hits[u.pathname] = (hits[u.pathname] || 0) + 1;
  const k = Object.keys(P).find((x) => P[x] === u.pathname);
  if (!k) return html('<title>Outra página</title>');
  if (mode[k] === 'timeout') throw Object.assign(new Error('aborted'), { name: 'AbortError' });
  if (/^\d+$/.test(mode[k])) return html('erro', Number(mode[k]));
  return page(...NAMES[k]);
});

const { runOnce } = await import('../src/run.js');
const { storesRows } = await import('../src/core/mappers.js');
const { collectorsSummary } = await import('../src/opstate.js');
const quiet = () => {}; const send = { capture: async () => true };
const base = Date.parse('2026-10-13T10:00:00Z');
const iso = (min) => new Date(base + min * 60e3).toISOString();
// O backoff usa Date.now: fixa o relógio no horário da rodada.
const realNow = Date.now;
const roundAt = async (min) => { Date.now = () => base + min * 60e3; try { return await runOnce({ log: quiet, send, now: new Date(base + min * 60e3) }); } finally { Date.now = realNow; } };
const readData = (f) => JSON.parse(fs.readFileSync(path.join(process.env.HUNTER_DATA_DIR, f), 'utf8'));
const src = (s) => s.sources.find((x) => x.id === 'ld');
const health = (s) => storesRows(s.sources).find((r) => r.id === 'ld').health;
const off = (s, k) => s.offers.find((o) => o.storeId === 'ld' && o.url === 'https://ld.test' + P[k]);
let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };

let s;
await t('sucesso: ACTIVE, lastSuccess da rodada, sem falha de página', async () => {
  s = await roundAt(0);
  assert.deepEqual([src(s).status, src(s).lastSuccess, src(s).pageFailures, src(s).fails], ['ACTIVE', iso(0), 0, 0]);
  for (const k of ['A', 'B']) assert.deepEqual([off(s, k)?.stale, off(s, k)?.source_timestamp], [false, iso(0)], k);
});

await t('falha parcial: uma página fora do ar mantém a loja ACTIVE e lastSuccess avança; a oferta dela fica stale', async () => {
  mode.A = '503';
  s = await roundAt(15);
  assert.deepEqual([src(s).status, src(s).lastSuccess, src(s).fails, src(s).pageFailures], ['ACTIVE', iso(15), 0, 1]);
  assert.match(src(s).pageFailReason, /HTTP 503/);
  assert.deepEqual([off(s, 'A').stale, off(s, 'A').stock, off(s, 'A').source_timestamp], [true, 'UNKNOWN', iso(0)]);
  assert.deepEqual([off(s, 'B').stale, off(s, 'B').source_timestamp], [false, iso(15)]);
  assert.equal(health(s).last_success_at, iso(15));
});

await t('todas as páginas falham: ERROR, lastSuccess parado, falha observável e ofertas preservadas como stale', async () => {
  mode.A = '503'; mode.B = '503'; // as duas com 503: a classe vem da 1ª página, independe da ordem
  s = await roundAt(30);
  const x = src(s);
  assert.deepEqual([x.status, x.lastCheck, x.lastSuccess, x.fails], ['ERROR', iso(30), iso(15), 1]);
  assert.deepEqual([x.pageFailures, x.httpStatus, x.errorClass], [2, 503, 'http_5xx'], 'telemetria da falha preservada');
  assert.match(x.pageFailReason, /HTTP 503/);
  assert.match(x.reason, /todas as 2 página\(s\) planejadas falharam: HTTP 503/);
  assert.equal(x.lastFailure?.at, iso(30));
  assert.deepEqual([health(s).status, health(s).last_check_at, health(s).last_success_at], ['ERROR', iso(30), iso(15)], 'o banco não vê a loja como saudável');
  for (const [k, at] of [['A', iso(0)], ['B', iso(15)]]) {
    assert.ok(off(s, k), `${k}: oferta não removida`);
    assert.deepEqual([off(s, k).stale, off(s, k).stock, off(s, k).source_timestamp], [true, 'UNKNOWN', at], `${k}: stale com o horário da última leitura`);
  }
  const c = collectorsSummary(s.sources, iso(30));
  assert.deepEqual([c.ok, c.failed, c.errors.http_5xx], [0, 1, 1], 'collectorsSummary conta a loja como falha');
  const cache = readData('url-cache.json').ld;
  assert.deepEqual(cache.relevant.slice().sort(), Object.values(P).map((p) => 'https://ld.test' + p).sort(), 'páginas continuam relevantes');
});

await t('todas falhando por timeout: classe timeout; backoff segura a próxima tentativa', async () => {
  const h = { ...hits };
  s = await roundAt(40); // 10 min depois de 1 falha (backoff de 15 min): não tenta
  assert.deepEqual([src(s).status, src(s).lastCheck, src(s).fails], ['ERROR', iso(30), 1]);
  assert.deepEqual([hits[P.A], hits[P.B]], [h[P.A], h[P.B]], 'nenhuma página lida durante o backoff');
  assert.ok(off(s, 'A')?.stale && off(s, 'B')?.stale);
  mode.A = 'timeout'; mode.B = 'timeout';
  s = await roundAt(46);
  assert.deepEqual([src(s).status, src(s).lastCheck, src(s).lastSuccess, src(s).fails, src(s).errorClass], ['ERROR', iso(46), iso(15), 2, 'timeout']);
  assert.equal(src(s).httpStatus, null); assert.equal(src(s).pageFailures, 2);
});

await t('recuperação: páginas de volta, ACTIVE, contadores e erro limpos, ofertas renovadas', async () => {
  mode.A = 'ok'; mode.B = 'ok';
  s = await roundAt(80); // depois do backoff de 30 min (2 falhas)
  const x = src(s);
  assert.deepEqual([x.status, x.lastSuccess, x.fails, x.pageFailures, x.pageFailReason, x.errorClass, x.reason], ['ACTIVE', iso(80), 0, 0, null, null, null]);
  assert.equal('lastFailure' in x || 'httpStatus' in x, false);
  assert.equal(health(s).last_success_at, iso(80));
  for (const k of ['A', 'B']) assert.deepEqual([off(s, k).stale, off(s, k).source_timestamp], [false, iso(80)], k);
  assert.equal(collectorsSummary(s.sources, iso(80)).ok, 1);
});

console.log(`✓ JSON-LD com todas as páginas fora do ar: ${n} grupos passaram`);
