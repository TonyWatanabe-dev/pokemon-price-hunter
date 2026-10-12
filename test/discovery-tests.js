// Discovery Intelligence Engine (src/discovery/): conectores, consultas, ledger adaptativo, pipeline, flag e hand-off.
// Tudo offline: fetch simulado por host via http.setFetch; config/ e data/ temporários.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
process.env.HUNTER_DOMAIN_DELAY_MS = '0';
for (const k of ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_SHA', 'GITHUB_EVENT_NAME', 'BRAVE_API_KEY', 'BING_SEARCH_KEY', 'SERPER_API_KEY', 'HUNTER_DISCOVERY', 'DISCOVERY_BUDGET']) delete process.env[k];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'die-'));
process.env.HUNTER_CONFIG_DIR = path.join(tmp, 'config'); process.env.HUNTER_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(path.join(tmp, 'config/lojas'), { recursive: true }); fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = (f) => path.join(process.env.HUNTER_CONFIG_DIR, f); const dat = (f) => path.join(process.env.HUNTER_DATA_DIR, f);
const rd = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

const catalog = { collections: [
  { id: 'sv1', name: 'Escarlate e Violeta', series: 'Escarlate e Violeta', aliases: [] },
  { id: 'me04', name: 'Caos Ascendente', series: 'Megaevolução', aliases: [] },
  { id: 'me05', name: 'Escuridão Absoluta', series: 'Megaevolução', aliases: [] },
], products: [{ id: 'me04-box36', collection: 'me04', type: 'booster_box', boosters: 36, ean: '0196214156098' }, { id: 'x', collection: 'me05', type: 'etb' }], copag: {} };
fs.writeFileSync(cfg('catalog.json'), JSON.stringify(catalog));
fs.writeFileSync(cfg('stores.json'), JSON.stringify({ stores: [
  { id: 'ld', name: 'Loja Nuvem', url: 'https://ld.test', platform: 'auto', kind: 'specialist', evidence: {} },
  { id: 'shop', name: 'Loja Shopify', url: 'https://shop.test', platform: 'shopify', kind: 'specialist', evidence: {} },
] }));
fs.writeFileSync(cfg('lojas/varredura.txt'), '# lista\nlista.test\n');
fs.writeFileSync(cfg('lojas/removidas.txt'), '# histórico\n# morta.test | 2026-10-12 | DNS não resolve | 0 ok\n');
fs.writeFileSync(dat('state.json'), JSON.stringify({ offers: [{ productId: 'me04-box36', storeId: 'ld', url: 'https://ld.test/produtos/pokemon-booster-box-ja-visto', stale: false, stock: 'IN_STOCK' }] }));
fs.writeFileSync(dat('url-cache.json'), JSON.stringify({ ld: { at: null, candidates: ['https://ld.test/produtos/pokemon-etb-no-cache'], visited: [], relevant: [] } }));
fs.writeFileSync(dat('sources.json'), JSON.stringify({ ld: { url: 'https://ld.test', platform: 'jsonld' }, shop: { url: 'https://shop.test', platform: 'shopify' } }));

const http = await import('../src/http.js');
const { registry } = await import('../src/discovery/connectors/index.js');
const { generateQueries, CITIES } = await import('../src/discovery/queries.js');
const L = await import('../src/discovery/ledger.js');
const { inventory, listedHosts, idFromHost } = await import('../src/discovery/hosts.js');
const { createPipeline } = await import('../src/discovery/pipeline.js');
const { runDiscovery, enabled } = await import('../src/discovery/index.js');
const { loadHandoff } = await import('../src/discovery/handoff.js');

const json = (o, status = 200, headers = {}) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', ...headers } });
const html = (s, status = 200) => new Response(s, { status, headers: { 'content-type': 'text/html' } });
const requested = [];
let braveStatus = 200;
const braveResults = (q) => /lacrado|caos/i.test(q) ? [
  { url: 'https://www.mercadolivre.com.br/box-caos', title: 'ML' },
  { url: 'https://ld.test/produtos/pokemon-booster-box-caos-ascendente', title: 'LD produto novo' },
  { url: 'https://ld.test/produtos/pokemon-booster-box-ja-visto', title: 'LD já visto' },
  { url: 'https://ld.test/produtos/pokemon-etb-no-cache', title: 'LD no cache' },
  { url: 'https://ld.test/blog/novidades', title: 'LD blog' },
  { url: 'https://shop.test/products/pokemon-box', title: 'Shopify (ignora productUrls)' },
  { url: 'https://morta.test/produtos/pokemon-box', title: 'removida' },
  { url: 'https://nova.test/produtos/pokemon-booster-box', title: 'loja nova boa' },
  { url: 'https://meio.test/', title: 'candidata' },
  { url: 'https://semreal.test/', title: 'jogo digital sem R$' },
  { url: 'https://empresas.atacado-tcg.test/', title: 'portal B2B' },
  { url: 'https://gringa.test/pokemon', title: 'sem sinal BR' },
  { url: 'https://fechada.test/', title: 'robots proíbe' },
  { url: 'http://127.0.0.1/pokemon', title: 'insegura' },
] : [];
const fake = async (url, opt = {}) => {
  const u = new URL(url); requested.push(url);
  if (u.host === 'api.search.brave.com') {
    assert.equal(opt.headers['user-agent'], http.userAgent, 'Brave chamado com o UA identificado do projeto');
    assert.ok(opt.headers['x-subscription-token'], 'token enviado');
    if (braveStatus === 429) return json({}, 429, { 'retry-after': '60' });
    return json({ web: { results: braveResults(u.searchParams.get('q')).map((r) => ({ ...r, description: 'd' })) } });
  }
  if (u.host === 'api.bing.microsoft.com') return json({ webPages: { value: [{ url: 'https://nova.test/', name: 'n', snippet: 's' }] } });
  if (u.host === 'google.serper.dev') { assert.equal(opt.method, 'POST'); return json({ organic: [{ link: 'https://nova.test/', title: 'n', snippet: 's' }] }); }
  if (u.pathname === '/robots.txt') return u.host === 'fechada.test' ? html('User-agent: *\nDisallow: /') : html('', 404);
  if (u.host === 'nova.test') {
    if (u.pathname === '/products.json') return json({ products: [{ title: 'Pokémon Booster Box', variants: [] }] });
    if (u.pathname === '/') return html('<html lang="pt-BR"><body>Pokémon TCG Booster Box Caos Ascendente R$ 399,90</body></html>');
  }
  if (u.host === 'meio.test') {
    if (u.pathname === '/') return html('<html><body>Loja de brinquedos. Pelúcia Pokémon por R$ 59,90</body></html>');
    return html('', 404);
  }
  if (u.host === 'semreal.test') {
    if (u.pathname === '/products.json') return json({ products: [{ title: 'Pokémon TCG Pocket pack', variants: [] }] });
    if (u.pathname === '/') return html('<html lang="pt-BR"><body>Pokémon TCG Pocket: compre booster com moedas do jogo</body></html>');
  }
  if (u.host === 'gringa.test') return html('<html lang="en"><body>Pokemon TCG booster box $ 120</body></html>');
  return html('', 404);
};
http.setFetch(fake);
const quiet = () => {};

// 1. Registro de conectores: sem chave = indisponível ("sem chave"); com chave = disponível; nunca inventa resultado.
{
  const r = registry({});
  assert.deepEqual(r.all.map((c) => c.id), ['brave', 'bing', 'serper']);
  assert.ok(r.all.every((c) => !c.available() && c.reason === 'sem chave'), 'sem chave: todos indisponíveis');
  assert.equal(r.pick(), null);
  await assert.rejects(() => r.byId('brave').search('x'), /sem chave/);
  const b = registry({ BRAVE_API_KEY: 'k' });
  assert.ok(b.byId('brave').available() && !b.byId('bing').available() && !b.byId('serper').available());
  assert.equal(b.pick().id, 'brave');
  assert.equal(b.status().bing.reason, 'sem chave');
  const res = await b.byId('brave').search('caos', { count: 20 });
  assert.equal(res.length, 14); assert.ok(res.every((x) => x.url && 'title' in x && 'snippet' in x));
  // bing/serper: implementações reais atrás da chave (chamadas simuladas aqui)
  const all = registry({ BING_SEARCH_KEY: 'k', SERPER_API_KEY: 'k' });
  assert.equal((await all.byId('bing').search('q'))[0].url, 'https://nova.test/');
  assert.equal((await all.byId('serper').search('q'))[0].url, 'https://nova.test/');
  assert.equal(all.pick().id, 'bing', 'ordem do registro'); assert.equal(all.pick('serper').id, 'serper', 'DISCOVERY_CONNECTOR');
  // 429 com Retry-After: conector esgotado nesta rodada
  braveStatus = 429;
  await assert.rejects(() => b.byId('brave').search('caos'), (e) => e.exhausted === true);
  assert.ok(!b.byId('brave').available()); assert.match(b.byId('brave').reason, /esgotado.*60 s/);
  braveStatus = 200;
}

// 2. Consultas determinísticas pelo catálogo: contagens, EAN, dedupe, mais novas primeiro.
{
  const qs = generateQueries(catalog);
  assert.deepEqual(qs, generateQueries(catalog), 'determinístico');
  assert.equal(new Set(qs.map((q) => q.id)).size, qs.length, 'ids únicos');
  assert.equal(new Set(qs.map((q) => q.q.toLowerCase())).size, qs.length, 'sem consulta repetida');
  const ean = qs.filter((q) => q.kind === 'ean'); assert.equal(ean.length, 1); assert.equal(ean[0].q, '"0196214156098"'); assert.equal(ean[0].product, 'me04-box36');
  for (const c of CITIES) assert.ok(qs.some((q) => q.kind === 'store' && q.q === `loja de card game ${c}`));
  const cols = qs.filter((q) => q.collection).map((q) => q.collection);
  assert.equal(cols[0], 'me05', 'coleção mais nova primeiro'); assert.ok(cols.indexOf('me04') < cols.lastIndexOf('sv1'));
  assert.ok(qs.some((q) => q.kind === 'product' && q.collection === 'me05' && q.type === 'etb' && /Treinador Avançado/.test(q.q) && !/\(/.test(q.q)), 'rótulo do tipo sem parênteses');
  assert.ok(qs.filter((q) => q.kind === 'store').length >= 16 + 9 && qs.filter((q) => q.kind === 'product').length >= 3 * 7);
}

// 3. Ledger: seleção adaptativa aprende e reserva vagas de exploração.
{
  const qs = generateQueries(catalog);
  const led = L.loadLedger(path.join(tmp, 'nao-existe.json'));
  assert.equal(L.selectQueries(led, qs, 6).length, 6);
  assert.deepEqual(L.selectQueries(led, qs, 6).map((q) => q.id), qs.slice(0, 6).map((q) => q.id), 'ledger vazio: ordem de geração');
  const now = Date.parse('2026-10-12T12:00:00Z');
  const a = qs[5], b = qs[6], c = qs[7], d = qs[8];
  Object.assign(L.queryStats(led, d), { runs: 2, hits: 0, acceptedStores: 0, lastRun: new Date(now).toISOString() });
  Object.assign(L.queryStats(led, a), { runs: 1, hits: 10, acceptedStores: 1, lastRun: new Date(now).toISOString() });
  Object.assign(L.queryStats(led, b), { runs: 1, hits: 10, acceptedStores: 0, lastRun: new Date(now).toISOString() });
  Object.assign(L.queryStats(led, c), { runs: 1, hits: 0, acceptedStores: 0, lastRun: new Date(now - 10 * 864e5).toISOString() });
  assert.ok(L.scoreOf(led.queries[a.id], now) > L.scoreOf(led.queries[b.id], now), 'loja aceita pontua acima de 0 aceitas');
  assert.equal(L.scoreOf(led.queries[a.id], now), (1 + 10 / 20) / 2);
  assert.equal(L.scoreOf(led.queries[c.id], now), L.RECENCY, 'consulta esquecida há >7 dias recupera bônus');
  assert.equal(L.scoreOf(undefined, now), L.EXPLORATION, 'nunca rodada: bônus de exploração');
  const sel = L.selectQueries(led, qs, 6, now);
  const unrun = sel.filter((q) => !led.queries[q.id]?.runs);
  assert.equal(unrun.length, 2, 'no máximo 1/3 de nunca rodadas quando há rodadas suficientes');
  assert.ok(sel.includes(a) && sel.includes(b) && sel.includes(c) && sel.includes(d));
  assert.ok(sel.indexOf(a) < sel.indexOf(b), 'ordenado por score');
  // poucas já rodadas: as vagas sobram para as nunca rodadas
  assert.equal(L.selectQueries(led, qs, 40, now).length, 40);
  L.saveLedger(led, path.join(tmp, 'l.json')); assert.equal(L.loadLedger(path.join(tmp, 'l.json')).queries[a.id].acceptedStores, 1);
}

// 4. Inventário de hosts: stores.json, .txt (id como run.js), removidas.txt, sources, ofertas, url-cache.
{
  const inv = inventory();
  assert.equal(inv.byHost.get('ld.test').id, 'ld'); assert.equal(inv.byHost.get('ld.test').detected, 'jsonld');
  assert.equal(inv.byHost.get('lista.test').id, idFromHost('lista.test')); assert.equal(idFromHost('loja-x.com.br'), 'lojaxcombr');
  assert.ok(inv.removed.has('morta.test')); assert.ok(!inv.byHost.has('morta.test'));
  assert.ok(inv.urls.has('https://ld.test/produtos/pokemon-booster-box-ja-visto') && inv.urls.has('https://ld.test/produtos/pokemon-etb-no-cache'));
  assert.deepEqual([...listedHosts().active.keys()], ['lista.test']);
}

// 5. HUNTER_DISCOVERY=0: sem rede, sem escrita.
{
  requested.length = 0;
  const r = await runDiscovery({ log: quiet, env: { HUNTER_DISCOVERY: '0', BRAVE_API_KEY: 'k' } });
  assert.deepEqual([r.ok, r.skipped], [true, 'desligado']); assert.equal(requested.length, 0);
  assert.ok(!fs.existsSync(dat('discovery.json')) && !fs.existsSync(dat('discovery-stores.txt')));
  assert.equal(enabled({ HUNTER_DISCOVERY: '0' }), false); assert.equal(enabled({}), true);
  const n = await runDiscovery({ log: quiet, env: {} });
  assert.deepEqual([n.ok, n.skipped], [true, 'sem conector']); assert.equal(requested.length, 0);
  const lg = JSON.parse(fs.readFileSync(dat('discovery.json'), 'utf8')); const last = lg.runs.at(-1); assert.equal(last.skipped, 'sem conector'); assert.ok(last.connectors.brave && last.connectors.brave.available === false, 'ledger registra por que pulou, sem valores de segredo'); assert.ok(!JSON.stringify(lg).includes('"k"'), 'sem valor de chave no ledger');
}

// 6. Rodada completa com o Brave simulado: classificação, descobertas.txt, discovery-urls.json, ledger, meta.json.
{
  requested.length = 0;
  const logs = [];
  const r = await runDiscovery({ log: (m) => logs.push(m), env: { BRAVE_API_KEY: 'k', DISCOVERY_BUDGET: '5' }, now: new Date('2026-10-12T09:17:00Z') });
  assert.equal(r.ok, true); assert.equal(r.run.connector, 'brave'); assert.equal(r.run.queriesRun, 5);
  assert.ok(r.connectors.bing.reason === 'sem chave' && r.connectors.serper.reason === 'sem chave');
  assert.ok(logs.some((m) => /bing indisponível: sem chave/.test(m)), 'conector sem chave reportado');
  assert.ok(!requested.some((u) => /mercadolivre|morta\.test|127\.0\.0\.1/.test(u)), 'marketplace, removida e URL insegura: nenhuma requisição');
  const txt = fs.readFileSync(dat('discovery-stores.txt'), 'utf8');
  assert.match(txt, /^https:\/\/nova\.test  # DIE brave store:\S+ 2026-10-12$/m, 'loja aceita = linha ATIVA');
  assert.match(txt, /^# candidata https:\/\/meio\.test  # menciona Pokémon, mas sem sinal de TCG lacrado \(DIE brave /m, 'candidata = linha comentada');
  assert.ok(!/gringa\.test|fechada\.test|morta\.test|shop\.test/.test(txt), 'rejeitadas, removidas e conhecidas não entram no arquivo');
  assert.match(txt, /^# candidata https:\/\/semreal\.test  # sem preço em R\$ na página inicial/m, 'Pokémon + lacrado + plataforma, mas sem R$: só candidata (falso positivo da 1ª rodada real)');
  assert.ok(!requested.some((u) => /empresas\.atacado-tcg\.test/.test(u)) && !/atacado-tcg/.test(txt), 'subdomínio B2B ignorado sem requisição');
  assert.ok(!fs.existsSync(cfg('lojas/descobertas.txt')), 'descoberta não escreve na config (main protegida)');
  const urls = rd(dat('discovery-urls.json'));
  assert.deepEqual(urls.ld.map((x) => x.url), ['https://ld.test/produtos/pokemon-booster-box-caos-ascendente'], 'só a URL de produto nova da loja jsonld conhecida');
  assert.ok(!urls.shop, 'loja Shopify não recebe productUrls');
  const led = rd(dat('discovery.json'));
  assert.equal(led.hosts['nova.test'].verdict, 'accepted'); assert.deepEqual(led.hosts['nova.test'].why.signals, ['robots ok', 'R$', 'pt-BR', 'pokémon', 'lacrado', 'plataforma:shopify']);
  assert.equal(led.hosts['gringa.test'].verdict, 'rejected'); assert.equal(led.hosts['gringa.test'].reason, 'sem sinal de loja brasileira');
  assert.equal(led.hosts['fechada.test'].reason, 'robots.txt proíbe'); assert.equal(led.hosts['meio.test'].verdict, 'candidate');
  assert.ok(led.hosts['morta.test'] && !led.hosts['morta.test'].verdict, 'removida fica só anotada no ledger');
  assert.equal(led.runs.length, 2, "a rodada pulada (sem conector) também fica registrada"); assert.equal(led.runs[1].storesAccepted, 1); assert.equal(led.runs[1].urlsAccepted, 1); assert.equal(led.runs[1].cost.queries, 5);
  assert.deepEqual(led.runs[1].baseline, { knownHosts: 3, offers: 1, liveOffers: 1, productsWithOffers: 1 });
  assert.equal(led.connectors.brave.calls, 5);
  const caos = Object.values(led.queries).find((q) => q.acceptedStores === 1); assert.ok(caos && /lacrado|caos/i.test(caos.q) && caos.acceptedUrls === 1 && caos.lastNewAt);
  assert.equal(rd(dat('meta.json')).discovery.last.storesAccepted, 1);
  // segunda rodada: nada reproposto (loja aceita virou conhecida; candidata e vereditos recentes não revalidam), ledger aprende
  const n1 = requested.length;
  const r2 = await runDiscovery({ log: quiet, env: { BRAVE_API_KEY: 'k', DISCOVERY_BUDGET: '5' }, now: new Date('2026-10-13T09:17:00Z') });
  assert.equal(r2.ok, true);
  assert.equal(fs.readFileSync(dat('discovery-stores.txt'), 'utf8'), txt, 'nenhuma linha repetida');
  assert.ok(!requested.slice(n1).some((u) => /nova\.test|meio\.test|gringa\.test|fechada\.test/.test(u)), 'hosts com veredito recente não são revalidados');
  assert.equal(rd(dat('discovery-urls.json')).ld.length, 1, 'URL já na fila não duplica');
  const sel = L.selectQueries(L.loadLedger(), generateQueries(catalog), 5, Date.parse('2026-10-14T00:00:00Z'));
  assert.ok(/lacrado|caos/i.test(sel[0].q), 'a consulta que rendeu loja lidera a seleção seguinte');
  // removidas.txt: host nunca reproposto mesmo sem veredito
  assert.ok(!Object.values(rd(dat('discovery.json')).hosts['morta.test']).includes('accepted'));
}

// 7. Conector que lança: rodada devolve { ok: false } sem lançar; esgotado (429) para a rodada.
{
  const boom = { all: [], status: () => ({ x: { available: true, reason: 'ok', keyName: 'X' } }), pick: () => ({ id: 'x', cost: { unit: 'query', estimate: 1 }, search: async () => { throw new Error('quebrou'); } }) };
  const r = await runDiscovery({ log: quiet, env: { HUNTER_DISCOVERY: '1' }, connectors: boom });
  assert.equal(r.ok, false); assert.match(r.error, /falhou/); assert.equal(r.run.errors, 3, 'para depois de 3 erros seguidos');
  braveStatus = 429;
  const r429 = await runDiscovery({ log: quiet, env: { BRAVE_API_KEY: 'k', DISCOVERY_BUDGET: '5' } });
  assert.equal(r429.ok, false); assert.equal(r429.run.stopped, 'conector esgotado'); assert.equal(r429.run.errors, 1, 'um 429 basta: não insiste');
  braveStatus = 200;
}

// 8. Pipeline isolado: limites por rodada e validação injetável.
{
  process.env.DISCOVERY_MAX_NEW_STORES = '1';
  const inv = inventory(); const led = L.loadLedger(path.join(tmp, 'x.json')); let calls = 0;
  const pipe = createPipeline({ inv, ledger: led, now: new Date('2026-10-12T00:00:00Z'), connector: 't', validate: async () => { calls++; return { verdict: 'accepted', reason: 'teste', signals: ['x'], platform: 'vtex' }; } });
  const q = { id: 'store:t' };
  assert.equal(await pipe.processResult({ url: 'https://a1.test/' }, q), 'accepted');
  assert.equal(await pipe.processResult({ url: 'https://a1.test/outra' }, q), 'known', 'loja aceita vira conhecida na mesma rodada (validação única)');
  assert.equal(await pipe.processResult({ url: 'https://a2.test/' }, q), 'skipped', 'teto de lojas novas por rodada');
  assert.equal(await pipe.processResult({ url: 'https://www.amazon.com.br/x' }, q), 'ignored');
  assert.equal(await pipe.processResult({ url: 'ftp://a3.test/' }, q), 'unsafe');
  assert.equal(calls, 1);
  delete process.env.DISCOVERY_MAX_NEW_STORES;
}

// 9. Hand-off ao src/run.js: productUrls só em lojas jsonld/auto do mesmo host; consumo e limite de tentativas.
{
  const file = path.join(tmp, 'handoff.json');
  fs.writeFileSync(file, JSON.stringify({ ld: [{ url: 'https://ld.test/produtos/a', q: 'q1', at: 'x', tries: 0 }, { url: 'https://outra.test/produtos/b', q: 'q1', at: 'x' }], shop: [{ url: 'https://shop.test/products/c', q: 'q1', at: 'x' }] }));
  const stores = [{ id: 'ld', url: 'https://ld.test', platform: 'auto', productUrls: ['https://ld.test/fixa'] }, { id: 'shop', url: 'https://shop.test', platform: 'shopify' }];
  let h = loadHandoff(stores, { file });
  assert.deepEqual(stores[0].productUrls, ['https://ld.test/fixa', 'https://ld.test/produtos/a'], 'junta sem duplicar e só do mesmo host');
  assert.equal(stores[1].productUrls, undefined, 'Shopify não recebe');
  h.seen('ld', Object.assign([{ url: 'https://ld.test/fixa' }], { failed: [] })); h.save();
  let j = rd(file); assert.equal(j.ld[0].tries, 1, 'não apareceu em anúncio: conta tentativa'); assert.equal(j.ld.length, 2); assert.equal(j.shop.length, 1, 'fila de outra loja intacta');
  h = loadHandoff(stores, { file }); h.seen('ld', [{ url: 'https://ld.test/produtos/a' }]); h.save();
  j = rd(file); assert.ok(!j.ld.some((x) => x.url === 'https://ld.test/produtos/a'), 'URL vista em anúncio é consumida');
  fs.writeFileSync(file, JSON.stringify({ ld: [{ url: 'https://ld.test/produtos/z', tries: 2 }] }));
  h = loadHandoff([{ id: 'ld', url: 'https://ld.test', platform: 'jsonld' }], { file }); h.seen('ld', []); h.save();
  assert.deepEqual(rd(file), {}, 'terceira tentativa sem anúncio: sai da fila');
  // ponta a ponta com o run.js: a URL descoberta é lida na rodada (vai para plannedUrls) e some da fila quando vira anúncio
  fs.writeFileSync(cfg('stores.json'), JSON.stringify({ stores: [{ id: 'ld', name: 'Loja Nuvem', url: 'https://ld.test', platform: 'auto', kind: 'specialist', evidence: {} }] }));
  fs.rmSync(cfg('lojas'), { recursive: true }); fs.mkdirSync(cfg('lojas'));
  fs.copyFileSync(path.join(root, 'config/watchlist.json'), cfg('watchlist.json'));
  fs.copyFileSync(path.join(root, 'config/catalog.json'), cfg('catalog.json')); // catálogo real: o matching precisa dos apelidos
  for (const f of ['state.json', 'url-cache.json', 'sources.json', 'meta.json']) fs.rmSync(dat(f), { force: true });
  fs.writeFileSync(dat('discovery-urls.json'), JSON.stringify({ ld: [{ url: 'https://ld.test/produtos/pokemon-booster-box-caos-ascendente', q: 'q', at: 'x', tries: 0 }] }));
  const page = (name, price) => html(`<html><head><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', name, offers: { '@type': 'Offer', price, priceCurrency: 'BRL', availability: 'https://schema.org/InStock' } })}</script></head><body><h1>${name}</h1><p>R$ 339,90</p>${'x'.repeat(40000)}</body></html>`);
  http.setFetch(async (url) => {
    const u = new URL(url); requested.push(url);
    if (u.host !== 'ld.test') return html('', 404);
    if (u.pathname === '/') return html('<title>Loja Pokémon</title>');
    if (u.pathname === '/sitemap.xml') return html('<urlset></urlset>');
    if (u.pathname === '/produtos/pokemon-booster-box-caos-ascendente') return page('Pokémon Booster Box Caos Ascendente 36 Boosters Copag', '339.90');
    return html('', 404);
  });
  const { runOnce } = await import('../src/run.js');
  requested.length = 0;
  const s = await runOnce({ log: quiet, send: {}, now: new Date('2026-10-12T10:00:00Z') });
  assert.ok(requested.includes('https://ld.test/produtos/pokemon-booster-box-caos-ascendente'), 'URL descoberta foi lida na rodada');
  assert.ok(s.offers.some((o) => o.storeId === 'ld' && o.productId === 'me04-box36'), 'virou oferta');
  assert.deepEqual(rd(dat('discovery-urls.json')), {}, 'consumida: saiu da fila');
  assert.ok(rd(dat('url-cache.json')).ld.relevant.includes('https://ld.test/produtos/pokemon-booster-box-caos-ascendente'), 'agora vive no url-cache');
}

console.log('✓ discovery-tests: conectores, consultas, ledger, pipeline, flag, hand-off');
