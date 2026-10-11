// Recuperação de páginas JSON-LD (offline, fetch simulado): falha transitória × resposta definitiva, oferta preservada
// quando a página falha, tentativas limitadas (HUNTER_JSONLD_RETRY_MAX) e releitura só depois de HUNTER_JSONLD_RETRY_H.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
process.env.HUNTER_DOMAIN_DELAY_MS = '0';
process.env.HUNTER_TIPS = '0';
for (const k of ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_SHA', 'GITHUB_EVENT_NAME', 'HUNTER_CEP', 'HUNTER_BUDGET_MIN', 'HUNTER_JSONLD_RETRY_MAX', 'HUNTER_JSONLD_RETRY_H']) delete process.env[k];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hunter-jsonld-'));
process.env.HUNTER_CONFIG_DIR = path.join(tmp, 'config'); process.env.HUNTER_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.HUNTER_CONFIG_DIR, { recursive: true });
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
fs.copyFileSync(path.join(root, 'config/catalog.json'), path.join(tmp, 'config/catalog.json'));
fs.writeFileSync(path.join(tmp, 'config/stores.json'), JSON.stringify({ stores: [
  { id: 'ld', name: 'Loja JSON-LD', url: 'https://ld.test', platform: 'jsonld', kind: 'specialist', evidence: {} },
] }));
fs.writeFileSync(path.join(tmp, 'config/watchlist.json'), JSON.stringify({ settings: { cep: null }, rules: [] }));

const html = (s, status = 200) => new Response(s, { status, headers: { 'content-type': 'text/html' } });
const brl = (v) => Number(v).toFixed(2).replace('.', ',');
const page = (name, price) => html(`<html><head><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', name, offers: { '@type': 'Offer', price, priceCurrency: 'BRL', availability: 'https://schema.org/InStock' } })}</script></head><body><h1>${name}</h1><p>R$ ${brl(price)}</p>${'x'.repeat(40000)}</body></html>`);
// Páginas: A e B são produtos; G (404) e H (410) são produtos que somem; N é página nova sempre fora do ar.
const P = { A: '/pokemon-booster-box-caos-ascendente-36', B: '/pokemon-blister-triplo-escuridao', G: '/pokemon-etb-caos-ascendente', H: '/pokemon-blister-quadruplo-caos', N: '/pokemon-colecao-nova' };
const NAMES = { A: ['Pokémon Booster Box Caos Ascendente 36 boosters Copag', '359.90'], B: ['Pokémon Blister Triplo Escuridão Absoluta Copag', '39.90'],
  G: ['Pokémon Treinador Avançado Caos Ascendente Copag', '329.90'], H: ['Pokémon Blister Quádruplo Caos Ascendente Copag', '54.90'] };
const mode = { A: 'ok', B: 'ok', G: 'ok', H: 'ok', N: '503' }; const hits = {}; let extra = 0;
const http = await import('../src/http.js');
http.setFetch(async (url) => {
  const u = new URL(url);
  if (u.pathname === '/robots.txt') return html('', 404);
  if (u.host !== 'ld.test') return html('', 404);
  if (u.pathname === '/sitemap.xml') return html('<urlset>' + [...Object.values(P), ...Array.from({ length: extra }, (_, i) => `/pokemon-extra-${i}`)].map((p) => `<url><loc>https://ld.test${p}</loc></url>`).join('') + '</urlset>');
  hits[u.pathname] = (hits[u.pathname] || 0) + 1;
  const k = Object.keys(P).find((x) => P[x] === u.pathname);
  if (!k) return html('<title>Outra página</title>');
  const m = mode[k];
  if (m === 'timeout') throw Object.assign(new Error('aborted'), { name: 'AbortError' });
  if (m === 'rede') throw new TypeError('fetch failed');
  if (/^\d+$/.test(m)) return html('erro', Number(m));
  return page(...NAMES[k]);
});

const { transientPageError, search } = await import('../src/adapters/jsonld.js');
const { runOnce } = await import('../src/run.js');
const quiet = () => {};
const send = { capture: async () => true };
const at = (min) => new Date(Date.parse('2026-10-06T10:00:00Z') + min * 60e3);
const ofLd = (s, pid) => s.offers.find((o) => o.storeId === 'ld' && o.productId === pid);
const readData = (f) => JSON.parse(fs.readFileSync(path.join(process.env.HUNTER_DATA_DIR, f), 'utf8'));
const src = (s) => s.sources.find((x) => x.id === 'ld');
let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };

// ---------------------------------------------------------------- classificação
await t('classificação: timeout, rede, 408 e 5xx são transitórios; 404, 410, outros 4xx e robots são definitivos', () => {
  for (const e of [{ status: 0, message: 'Timeout' }, new TypeError('fetch failed'), { status: 408 }, { status: 500 }, { status: 502 }, { status: 503 }, { status: 'unreachable' }])
    assert.equal(transientPageError(e), true, JSON.stringify(e.status ?? e.message));
  for (const e of [{ status: 404 }, { status: 410 }, { status: 400 }, { status: 451 }, { status: 'robots' }])
    assert.equal(transientPageError(e), false, String(e.status));
});
await t('adaptador: página que falha de forma transitória vai para failed com o motivo; 404/410 não', async () => {
  Object.assign(mode, { A: 'timeout', B: 'rede', G: '404', H: '410', N: '503' });
  const out = await search({ id: 'ld', url: 'https://ld.test', plannedUrls: Object.values(P).map((p) => 'https://ld.test' + p) });
  assert.deepEqual(out.failed.map((u) => new URL(u).pathname).sort(), [P.A, P.B, P.N].sort());
  assert.match(out.failReasons['https://ld.test' + P.A], /Timeout/);
  assert.match(out.failReasons['https://ld.test' + P.N], /HTTP 503/);
  assert.equal(out.length, 0);
  Object.assign(mode, { A: 'ok', B: 'ok', G: 'ok', H: 'ok', N: '503' });
});

// ---------------------------------------------------------------- rodadas
let s;
await t('rodada base: A, B, G e H lidos; N (nova) fora do ar entra como tentativa 1', async () => {
  s = await runOnce({ log: quiet, send, now: at(0) });
  for (const pid of ['me04-booster-box36', 'sv10-blister3', 'me04-etb', 'me04-blister4'].filter((p) => ofLd(s, p))) assert.ok(!ofLd(s, pid).stale);
  assert.equal(readData('url-cache.json').ld?.failCount?.['https://ld.test' + P.N] ?? readData('url-cache.json').ld?.failCount?.[`https://ld.test${P.N}`], 1);
});
const ids = () => Object.fromEntries(Object.entries(readData('offers.json')).filter(([, o]) => o.storeId === 'ld').map(([id, o]) => [o.url.replace('https://ld.test', ''), { id, stale: !!o.stale, stock: o.stock }]));
const base = ids();
await t('base tem as quatro ofertas lidas', () => { for (const k of ['A', 'B', 'G', 'H']) assert.ok(base[P[k]], 'oferta de ' + k); });

await t('timeout e erro de rede na página: oferta preservada como stale (não removida)', async () => {
  Object.assign(mode, { A: 'timeout', B: 'rede' });
  s = await runOnce({ log: quiet, send, now: at(15) });
  const o = ids();
  assert.deepEqual([o[P.A]?.stale, o[P.A]?.stock], [true, 'UNKNOWN'], 'A (timeout): stale, estoque não confirmado');
  assert.deepEqual([o[P.B]?.stale, o[P.B]?.stock], [true, 'UNKNOWN'], 'B (rede): stale');
  assert.equal(src(s).pageFailures >= 2, true, 'a fonte registra as páginas que falharam');
  assert.match(src(s).pageFailReason, /Timeout|fetch failed|HTTP 503/);
});
await t('HTTP 5xx na página: oferta continua preservada; página relevante segue sendo lida a cada rodada', async () => {
  Object.assign(mode, { A: '502', B: '500' }); const h = hits[P.A];
  s = await runOnce({ log: quiet, send, now: at(30) });
  const o = ids(); assert.ok(o[P.A]?.stale && o[P.B]?.stale);
  assert.equal(hits[P.A], h + 1, 'relevante: lida de novo (sem limite que a faça sumir)');
});
await t('página volta: oferta normal de novo, contador zerado', async () => {
  Object.assign(mode, { A: 'ok', B: 'ok' });
  s = await runOnce({ log: quiet, send, now: at(45) });
  const o = ids(); assert.ok(!o[P.A].stale && !o[P.B].stale);
  assert.equal(readData('url-cache.json').ld.failCount['https://ld.test' + P.A], undefined);
});
await t('HTTP 404 e 410: resposta definitiva, oferta removida', async () => {
  Object.assign(mode, { G: '404', H: '410' });
  s = await runOnce({ log: quiet, send, now: at(60) });
  const o = ids(); assert.equal(o[P.G], undefined, '404 remove'); assert.equal(o[P.H], undefined, '410 remove');
  assert.ok(o[P.A] && o[P.B], 'as demais continuam');
});
await t('esgotamento: página nova fora do ar para de ser tentada após HUNTER_JSONLD_RETRY_MAX (3) rodadas', async () => {
  const cache = readData('url-cache.json').ld;
  assert.equal(cache.failCount['https://ld.test' + P.N], 3, 'N já falhou em 3 rodadas (0, 15, 30; em 45 e 60 não foi tentada)');
  assert.ok(cache.visited.includes('https://ld.test' + P.N), 'esgotada: conta como lida');
  const h = hits[P.N];
  s = await runOnce({ log: quiet, send, now: at(75) }); s = await runOnce({ log: quiet, send, now: at(90) });
  assert.equal(hits[P.N], h, 'nenhuma nova tentativa nas rodadas seguintes');
});
await t('depois de HUNTER_JSONLD_RETRY_H (24 h) a página esgotada é relida uma vez; falhando, espera de novo', async () => {
  const h = hits[P.N];
  s = await runOnce({ log: quiet, send, now: at(30 + 24 * 60 + 5) });
  assert.equal(hits[P.N], h + 1, 'releitura única após 24 h');
  s = await runOnce({ log: quiet, send, now: at(30 + 24 * 60 + 20) });
  assert.equal(hits[P.N], h + 1, 'falhou de novo: não insiste na rodada seguinte');
});
await t('página esgotada que volta a responder vira produto normalmente', async () => {
  mode.N = 'ok'; NAMES.N = ['Pokémon Coleção Especial Caos Ascendente Copag', '199.90'];
  s = await runOnce({ log: quiet, send, now: at(30 + 48 * 60 + 30) });
  assert.equal(readData('url-cache.json').ld.failCount['https://ld.test' + P.N], undefined, 'leitura com sucesso zera o contador');
});
await t('HUNTER_JSONLD_RETRY_MAX configurável (1: desiste na primeira falha)', async () => {
  process.env.HUNTER_JSONLD_RETRY_MAX = '1'; P.M = '/pokemon-colecao-outra'; mode.M = '503';
  s = await runOnce({ log: quiet, send, now: at(30 + 48 * 60 + 45) });
  const h = hits[P.M]; assert.equal(h, 1);
  s = await runOnce({ log: quiet, send, now: at(30 + 48 * 60 + 60) });
  assert.equal(hits[P.M], 1, 'não tenta de novo na rodada seguinte');
  delete process.env.HUNTER_JSONLD_RETRY_MAX;
});
await t('limite por rodada: no máximo 25 páginas novas, mesmo com falhas voltando para a fila', async () => {
  extra = 60; const before = Object.keys(hits).filter((k) => k.startsWith('/pokemon-extra-')).length;
  s = await runOnce({ log: quiet, send, now: at(30 + 48 * 60 + 75) });
  const after = Object.keys(hits).filter((k) => k.startsWith('/pokemon-extra-')).length;
  assert.ok(after - before <= 25, `lidas ${after - before} novas`);
});

console.log(`✓ Recuperação de páginas JSON-LD: ${n} grupos passaram`);
