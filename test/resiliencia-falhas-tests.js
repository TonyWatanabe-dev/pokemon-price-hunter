// Resiliência (fault injection) de api/pagina.mjs, api/sitemap.mjs e api/v1.mjs, sem alterar os handlers e sem rede:
// state.json indisponível, corrompido, vazio, com tipos errados, lento ou atrasado (frescor); banco simulado fora, lento ou
// com resposta inválida; app.html indisponível; slug malformado ou gigante; paginação fora do limite.
// Esperado: resposta degradada segura — status coerente, noindex quando não há dados, sem stack trace/segredo no corpo,
// cache curto. Cada cenário roda num processo separado (os módulos guardam cache de state e de banco).
// Não repete o que já está coberto em paginas-servidor-cache/-escape/-log, sitemap-falha/-stale, api-tests,
// freshness-tests e freshness-empty-db (lá: 500/rede no sitemap, dado velho, slug %E0%A4%A, prazo com loader pendurado,
// erro de banco com senha na mensagem, banco vazio).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const href = (rel) => pathToFileURL(path.join(root, rel)).href;
const NOW = Date.parse('2026-10-12T18:00:00.000Z');
const ago = (min) => new Date(NOW - min * 6e4).toISOString();

const fx = (at = ago(5), extra = {}) => ({
  generatedAt: at, dataAt: at, coverage: { found: 1 }, totals: { offers: 1 },
  collections: [{ id: 'c1', name: 'Alfa', series: 'S', aliases: [], products: 1 }],
  types: [{ id: 'etb', label: 'Treinador Avançado (ETB)', group: 'ETB', products: 1 }],
  products: [{ id: 'p1', collection: 'c1', collectionName: 'Alfa', type: 'etb', typeLabel: 'Treinador Avançado (ETB)', group: 'ETB', boosters: 9, offerCount: 1,
    copagConfirmed: true, msrp: 400, copag: { source_url: 'https://www.copagloja.com.br/etb/p', source_timestamp: at } }],
  offers: [{ id: 'o1', productId: 'p1', storeId: 's1', storeName: 'Loja Um', title: 'ETB Alfa', url: 'https://loja.com.br/etb', price: 300, priceKind: 'base', shipping: 0,
    shippingKnown: true, total: 300, stock: 'IN_STOCK', confirmed: true, anomalous: false, stale: false, firstSeen: ago(600), source_timestamp: at }],
  sources: [{ id: 's1', name: 'Loja Um', url: 'https://loja.com.br', status: 'ACTIVE' }], activity: [], tips: [], bestDeals: [], ...extra,
});
const SLUG_PROD = 'alfa-treinador-avancado-etb'; const SLUG_COL = 'alfa';
const SEGREDO = 'postgres://hunter_api:senha-secreta-xyz@host-interno.exemplo:6543/postgres';

// Respostas do "GitHub raw" simulado. state: objeto (vira JSON) | { status } | { texto } | 'rede' | { atrasoMs, state }.
// Processo filho: relógio fixo, fetch simulado, handler real; devolve status, cabeçalhos, corpo e o stderr.
const CHILD = `
  const spec = JSON.parse((await import('node:fs')).readFileSync(0, 'utf8'));
  const FR = await import(${JSON.stringify(href('api/_lib/freshness.mjs'))}); FR.setFreshnessClock(() => spec.now);
  const realNow = Date.now; Date.now = () => spec.now;
  const responder = async (r) => {
    if (r === 'rede') throw new TypeError('fetch failed');
    if (r && r.atrasoMs) { await new Promise((ok) => setTimeout(ok, r.atrasoMs)); return responder(r.state); }
    if (r && r.status) return new Response('erro do upstream', { status: r.status });
    if (r && 'texto' in r) return new Response(r.texto, { status: 200 });
    return new Response(JSON.stringify(r), { status: 200 });
  };
  let urls = [];
  globalThis.fetch = async (u) => { u = String(u); urls.push(u);
    if (u.endsWith('/app.html')) return spec.app === 'rede' ? responder('rede') : spec.app === 'lixo' ? new Response('<html><body>Bad gateway</body></html>', { status: 200 })
      : spec.app && spec.app.status ? new Response('x', { status: spec.app.status }) : new Response(spec.appHtmlArquivo ? (await import('node:fs')).readFileSync(spec.appHtmlArquivo, 'utf8') : '', { status: 200 });
    if (u.endsWith('/state.json')) { const list = spec.porUrl; return responder(list ? (u.includes('/data/data/') ? list[0] : list[1]) : spec.state); }
    throw new Error('rede bloqueada no teste: ' + u); };
  if (spec.db) {
    process.env.API_DATABASE_URL = spec.db.url;
    const DB = await import(${JSON.stringify(href('api/_lib/db.mjs'))}); const pool = await DB.apiPool();
    pool.query = async (sql) => {
      if (spec.db.atrasoMs) await new Promise((ok) => setTimeout(ok, spec.db.atrasoMs));
      if (spec.db.modo === 'erro') throw Object.assign(new Error('connect ECONNREFUSED ' + spec.db.url), { code: 'ECONNREFUSED' });
      if (spec.db.modo === 'lixo' && /max\\(last_seen_at\\)/.test(sql)) return { rows: [{ at: 'não é data' }] };
      throw Object.assign(new Error('relation does not exist'), { code: '42P01' });
    };
  } else delete process.env.API_DATABASE_URL;
  const { default: h } = await import(${JSON.stringify(pathToFileURL(root).href)} + '/api/' + spec.handler + '.mjs');
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[String(k).toLowerCase()] = String(v); }, end(b) { this.body = b ?? ''; } };
  const t0 = realNow();
  await h({ url: spec.url, method: 'GET', headers: { host: 'tcgpricehunter.com.br' } }, res, spec.opts ? { now: spec.now, ...spec.opts } : undefined);
  process.stdout.write('\\n@@' + JSON.stringify({ status: res.statusCode, headers: res.headers, body: res.body, ms: realNow() - t0, urls }));
  process.exit(0);`;

function run(spec, { cwd = root, timeout = 20_000 } = {}) {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', CHILD], {
    cwd, encoding: 'utf8', timeout, maxBuffer: 32 * 2 ** 20, input: JSON.stringify({ now: NOW, ...spec }), env: { ...process.env, API_DATABASE_URL: '' } });
  if (r.error) throw new Error(`cenário não terminou (${r.error.code}): ${JSON.stringify(spec).slice(0, 200)}`);
  const i = r.stdout.lastIndexOf('\n@@');
  if (r.status !== 0 || i < 0) throw new Error(`filho falhou (${r.status}): ${r.stderr.slice(-1500)}`);
  return { ...JSON.parse(r.stdout.slice(i + 3)), stderr: r.stderr };
}

let n = 0;
function t(nome, fn) { try { fn(); n++; } catch (e) { console.error('✗ ' + nome); throw e; } }
const VAZA = /\bat (?:async )?\S*\.m?js:\d+|\n\s+at |postgres:\/\/|senha-secreta|host-interno|ECONNREFUSED|42P01|SyntaxError|TypeError|RangeError|raw\.githubusercontent\.com\/[^"]*state\.json/;
const semVazamento = (r, ctx) => { assert.doesNotMatch(r.body, VAZA, `${ctx}: corpo sem stack/segredo/erro interno`);
  for (const [k, v] of Object.entries(r.headers)) assert.doesNotMatch(v, /senha-secreta|host-interno|postgres:\/\//, `${ctx}: cabeçalho ${k} sem segredo`); };
const NOINDEX = '<meta name="robots" content="noindex">';
const CURTO = 'public, max-age=0, s-maxage=30';
const LONGO = 'public, max-age=0, s-maxage=600, stale-while-revalidate=3600';
const pg = (q) => '/api/pagina?' + q;
const ROTAS = [['home', 't=home'], ['produto', `t=produto&slug=${SLUG_PROD}`], ['colecao', `t=colecao&slug=${SLUG_COL}`], ['oportunidades', 't=oportunidades']];

// Casca degradada: 200, sem conteúdo pré-renderizado, noindex fora da Home, cache curto, nada vazado.
function casca(r, t, ctx) {
  assert.equal(r.status, 200, ctx); assert.match(r.headers['content-type'], /^text\/html/, ctx);
  assert.equal(r.headers['cache-control'], CURTO, `${ctx}: cache curto`);
  assert.ok(!r.body.includes('<div class="ssr">'), `${ctx}: sem SSR com dado inválido`);
  assert.ok(r.body.includes('<div id="view"></div>'), `${ctx}: casca do app intacta`);
  if (t === 'home') { assert.ok(!r.body.includes(NOINDEX), `${ctx}: Home mantém indexação`); assert.match(r.body, /<link rel="canonical"/); }
  else { assert.ok(r.body.includes(NOINDEX), `${ctx}: noindex sem dados`); assert.doesNotMatch(r.body, /<link rel="canonical"/, `${ctx}: sem canonical da Home`); }
  semVazamento(r, ctx);
}

// ---------------------------------------------------------------- 1) state.json do site (api/pagina.mjs)
t('1. referência: com state.json válido e em dia, as quatro rotas saem com SSR e cache longo', () => {
  for (const [k, q] of ROTAS) {
    const r = run({ handler: 'pagina', url: pg(q), state: fx() });
    assert.equal(r.status, 200, k); assert.equal(r.headers['cache-control'], LONGO, k); assert.ok(r.body.includes('<div class="ssr">'), k);
  }
});

const FALHAS = {
  '500': { status: 500 }, '429': { status: 429 }, corrompido: { texto: '{"generatedAt": "2026-10-12T17:55:00.000Z", "products": [' }, vazio: { texto: '' },
  html: { texto: '<!doctype html><title>GitHub</title>' }, objetoVazio: {}, null: null, lista: [],
  tiposErrados: fx(ago(5), { products: 'x', offers: { a: 1 }, collections: 7, types: null }),
  produtosSemId: fx(ago(5), { products: [{ collection: 'c1' }, null, 3] }),
};
t('2. state.json indisponível, corrompido, vazio, não-JSON ou com tipos errados: casca segura em todas as rotas', () => {
  for (const [nome, state] of Object.entries(FALHAS)) for (const [k, q] of ROTAS) casca(run({ handler: 'pagina', url: pg(q), state }), k, `${nome}/${k}`);
});

t('3. tipos errados com data em dia: a exceção vai para o log (console.error), nunca para o corpo', () => {
  const r = run({ handler: 'pagina', url: pg(`t=produto&slug=${SLUG_PROD}`), state: FALHAS.tiposErrados });
  casca(r, 'produto', 'tiposErrados');
  assert.match(r.stderr, /pagina: erro inesperado em build \(t=produto\)/);
});

t('4. frescor: atrasado (60 min) ainda serve SSR; 91 min, data no futuro ou dataAt nulo viram casca', () => {
  const atrasado = run({ handler: 'pagina', url: pg(`t=produto&slug=${SLUG_PROD}`), state: fx(ago(60)) });
  assert.equal(atrasado.status, 200); assert.ok(atrasado.body.includes('<div class="ssr">')); assert.equal(atrasado.headers['cache-control'], LONGO);
  const casos = { '91min': fx(ago(91)), futuro: fx(ago(-10)), dataAtNulo: { ...fx(ago(5)), dataAt: null }, dataInvalida: fx('ontem') };
  for (const [nome, state] of Object.entries(casos)) for (const [k, q] of ROTAS) casca(run({ handler: 'pagina', url: pg(q), state }), k, `${nome}/${k}`);
});

t('5. state.json lento (400 ms) ainda responde com SSR; o atraso não vira erro', () => {
  const r = run({ handler: 'pagina', url: pg(`t=produto&slug=${SLUG_PROD}`), state: { atrasoMs: 400, state: fx() } });
  assert.equal(r.status, 200); assert.ok(r.body.includes('<div class="ssr">')); assert.ok(r.ms >= 350, `esperou o upstream (${r.ms} ms)`);
});

// ---------------------------------------------------------------- 2) banco simulado na página (Home/oportunidades)
t('6. banco fora do ar, lento ou com horário inválido: Home e oportunidades seguem pelo state.json, sem vazar a URL do banco', () => {
  for (const db of [{ modo: 'erro' }, { modo: 'erro', atrasoMs: 300 }, { modo: 'lixo' }, { modo: 'tabela' }]) for (const [k, q] of [ROTAS[0], ROTAS[3]]) {
    const r = run({ handler: 'pagina', url: pg(q), state: fx(), db: { url: SEGREDO, ...db } });
    const ctx = `${JSON.stringify(db)}/${k}`;
    assert.equal(r.status, 200, ctx); assert.ok(r.body.includes('<div class="ssr">'), `${ctx}: SSR pelo state`);
    semVazamento(r, ctx);
  }
});

// ---------------------------------------------------------------- 3) app.html indisponível (sem index.html no disco)
t('7. sem index.html no disco e app.html falhando ou inválido: 302 para /app.html sem cache; app.html válido serve a página', () => {
  const vazio = fs.mkdtempSync(path.join(os.tmpdir(), 'resil-'));
  try {
    for (const app of ['rede', 'lixo', { status: 502 }]) {
      const r = run({ handler: 'pagina', url: pg('t=home'), state: fx(), app }, { cwd: vazio });
      assert.equal(r.status, 302, JSON.stringify(app)); assert.equal(r.headers.location, '/app.html'); assert.equal(r.headers['cache-control'], 'no-store');
      assert.ok(r.urls.some((u) => u === 'https://tcgpricehunter.com.br/app.html'), 'busca no host do SITE');
      semVazamento(r, 'app ' + JSON.stringify(app));
    }
    const ok = run({ handler: 'pagina', url: pg(`t=produto&slug=${SLUG_PROD}`), state: fx(), appHtmlArquivo: path.join(root, 'index.html') }, { cwd: vazio });
    assert.equal(ok.status, 200); assert.ok(ok.body.includes('<div class="ssr">'));
  } finally { fs.rmSync(vazio, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- 4) slug e query malformados/gigantes
t('8. slug gigante, com markup ou tipo de página desconhecido: 404 + noindex + cache curto, sem refletir a entrada', () => {
  const casos = [['t=produto&slug=' + 'a'.repeat(60_000), 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'], ['t=colecao&slug=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E', '<img src=x'],
    ['t=%3Cscript%3Ealert(1)%3C%2Fscript%3E', '<script>alert(1)'], ['t=' + 'x'.repeat(30_000), 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'], ['t=produto&slug=%00%2F..%2F..%2Fetc%2Fpasswd', 'etc/passwd'],
    ['t=tipo&slug=%F0%9F%8E%B4'.repeat(1), '🎴']];
  for (const [q, eco] of casos) {
    const r = run({ handler: 'pagina', url: pg(q), state: fx() });
    const ctx = q.slice(0, 50);
    assert.equal(r.status, 404, ctx); assert.ok(r.body.includes(NOINDEX), ctx); assert.equal(r.headers['cache-control'], CURTO, ctx);
    assert.ok(!r.body.includes(eco), `${ctx}: entrada não refletida`); semVazamento(r, ctx);
  }
});

// ---------------------------------------------------------------- 5) sitemap
const locs = (b) => [...String(b).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const xmlValido = (b, ctx) => { assert.match(b, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">\n/, ctx);
  assert.equal((b.match(/<urlset/g) || []).length, 1, ctx); assert.match(b, /<\/urlset>\n$/, ctx);
  assert.equal((b.match(/<url>/g) || []).length, (b.match(/<\/url>/g) || []).length, ctx); };
t('9. sitemap com state corrompido, vazio, nulo, não-JSON ou sem data: só a Home, XML válido, nada vazado', () => {
  for (const nome of ['corrompido', 'vazio', 'html', 'objetoVazio', 'null', 'lista']) {
    const r = run({ handler: 'sitemap', url: '/sitemap.xml', state: FALHAS[nome] });
    assert.equal(r.status, 200, nome); assert.match(r.headers['content-type'], /^application\/xml/, nome); xmlValido(r.body, nome);
    assert.deepEqual(locs(r.body), ['https://tcgpricehunter.com.br/'], nome); semVazamento(r, nome);
  }
});
t('10. sitemap com tipos errados e data em dia: nenhuma URL de produto/coleção/formato, erro só no log', () => {
  for (const nome of ['tiposErrados', 'produtosSemId']) {
    const r = run({ handler: 'sitemap', url: '/sitemap.xml', state: FALHAS[nome] });
    xmlValido(r.body, nome); assert.ok(!locs(r.body).some((u) => /\/(produto|colecao|tipo)\//.test(u)), nome); semVazamento(r, nome);
    assert.match(r.stderr, /sitemap: erro inesperado/, nome);
  }
});

// ---------------------------------------------------------------- 6) API v1 (fetch real do legado, sem loader injetado)
const API = (u) => '/api/v1/' + u;
const json503 = (r, ctx) => { assert.equal(r.status, 503, ctx); assert.equal(r.headers['cache-control'], 'no-store', ctx); assert.equal(r.headers['x-data-source'], 'none', ctx);
  assert.deepEqual(Object.keys(JSON.parse(r.body)), ['error'], ctx); semVazamento(r, ctx); };
t('11. API sem banco e state.json inválido nas duas URLs: 503 genérico sem cache em home, listas e produto', () => {
  for (const nome of ['500', 'corrompido', 'vazio', 'html', 'objetoVazio', 'null', 'tiposErrados'])
    for (const u of ['home', 'produtos', `produtos/${SLUG_PROD}`, 'site/produtos', 'referencias']) json503(run({ handler: 'v1', url: API(u), state: FALHAS[nome] }), `${nome}/${u}`);
});
t('12. API: state.json do ramo data corrompido e o do ramo main bom → 200 pelo segundo endereço', () => {
  const r = run({ handler: 'v1', url: API(`produtos/${SLUG_PROD}`), porUrl: [FALHAS.corrompido, fx()] });
  assert.equal(r.status, 200); assert.equal(JSON.parse(r.body).data.id, 'p1');
  assert.ok(r.urls.some((u) => u.includes('/data/data/state.json')) && r.urls.some((u) => u.includes('/main/data/state.json')));
});
t('13. API: state.json atrasado 60 min serve marcado; 25 h vira 503 sem cache', () => {
  const r = run({ handler: 'v1', url: API('produtos?limite=5'), state: fx(ago(60)) });
  assert.equal(r.status, 200); assert.equal(r.headers['x-data-freshness'], 'atrasado'); assert.equal(JSON.parse(r.body).meta.freshness.status, 'atrasado');
  const velho = run({ handler: 'v1', url: API('produtos?limite=5'), state: fx(ago(25 * 60)) });
  assert.equal(velho.status, 503); assert.equal(velho.headers['cache-control'], 'no-store'); semVazamento(velho, '25h');
});

// ---------------------------------------------------------------- 7) API v1 com banco simulado
t('14. banco lento além do prazo do pedido: 503 curto com Retry-After, sem esperar o banco', () => {
  const r = run({ handler: 'v1', url: API('produtos'), state: fx(), db: { url: SEGREDO, modo: 'erro', atrasoMs: 3000 }, opts: { deadlineMs: 150 } });
  assert.equal(r.status, 503); assert.equal(r.headers['retry-after'], '5'); assert.equal(r.headers['cache-control'], 'no-store');
  assert.ok(r.ms < 2500, `respondeu no prazo (${r.ms} ms)`); semVazamento(r, 'banco lento');
});
t('15. banco fora + state.json corrompido: 503 genérico sem cache e sem a URL/senha do banco (corpo, cabeçalhos e log)', () => {
  for (const u of ['home', 'produtos', `site/produto/${SLUG_PROD}`]) {
    const r = run({ handler: 'v1', url: API(u), state: FALHAS.corrompido, db: { url: SEGREDO, modo: 'erro' } });
    json503(r, u); assert.doesNotMatch(r.stderr, /senha-secreta/, `${u}: log sem a senha`);
  }
  // /oportunidades não lê o state.json: sem banco, lista vazia "requires_db" (nada estimado), frescor indisponível, sem cache
  const r = run({ handler: 'v1', url: API('oportunidades'), state: FALHAS.corrompido, db: { url: SEGREDO, modo: 'erro' } }); const b = JSON.parse(r.body);
  assert.equal(r.status, 200); assert.deepEqual(b.data, []); assert.equal(b.meta.status, 'requires_db'); assert.equal(b.meta.freshness.status, 'indisponivel');
  assert.equal(r.headers['cache-control'], 'no-store'); assert.equal(r.headers['x-fallback'], 'db-indisponivel'); semVazamento(r, 'oportunidades');
  assert.doesNotMatch(r.stderr, /senha-secreta/);
});
t('16. banco com horário inválido ou tabela ausente: cai para o state.json marcado como fallback, sem cache de CDN', () => {
  for (const modo of ['lixo', 'tabela']) {
    const r = run({ handler: 'v1', url: API(`produtos/${SLUG_PROD}`), state: fx(), db: { url: SEGREDO, modo } });
    assert.equal(r.status, 200, modo); assert.equal(r.headers['x-data-source'], 'state', modo); assert.ok(r.headers['x-fallback'], modo);
    assert.equal(r.headers['cache-control'], 'no-store', modo); semVazamento(r, modo);
  }
});

// ---------------------------------------------------------------- 8) API v1: paginação fora do limite e query gigante
t('17. paginação além do total: 200 com lista vazia e total/páginas coerentes; acima do teto: 400 com cache curto', () => {
  for (const u of ['produtos?pagina=500&limite=10', 'referencias?pagina=400', `produtos/${SLUG_PROD}/ofertas?pagina=100&limite=50`, 'site/produtos?pagina=1000']) {
    const r = run({ handler: 'v1', url: API(u), state: fx() }); const b = JSON.parse(r.body);
    assert.equal(r.status, 200, u); assert.deepEqual(b.data ?? b.items ?? [], [], u);
    if (b.meta) { assert.ok(b.meta.total <= 1 && b.meta.pages >= 1, u); }
  }
  for (const u of ['produtos?pagina=10000&limite=50', 'referencias?pagina=201&limite=50', 'produtos?pagina=-5&limite=0x10&ordem=' + 'z'.repeat(5000)]) {
    const r = run({ handler: 'v1', url: API(u), state: fx() });
    assert.equal(r.status, 400, u.slice(0, 40)); assert.equal(r.headers['cache-control'], 'public, max-age=60'); assert.ok(r.body.length < 300, 'mensagem curta'); semVazamento(r, u.slice(0, 40));
  }
});
t('18. query gigante (filtros de 50 KB e 2 000 parâmetros): resposta rápida, corpo pequeno, entrada não refletida', () => {
  const muitos = Array.from({ length: 2000 }, (_, i) => `x${i}=${i}`).join('&');
  const casos = [`oportunidades?colecao=${'a'.repeat(50_000)}`, `produtos?busca=${'%3Cb%3E'.repeat(8000)}`, `site/produtos?colecao=${'c'.repeat(50_000)}&loja=${'l'.repeat(50_000)}`, `produtos?${muitos}`];
  for (const u of casos) {
    const r = run({ handler: 'v1', url: API(u), state: fx() });
    assert.ok([200, 400].includes(r.status), `${u.slice(0, 30)}: ${r.status}`); assert.ok(r.body.length < 20_000, 'corpo pequeno');
    assert.ok(!r.body.includes('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), 'sem eco da entrada'); assert.ok(!r.body.includes('<b>'), 'sem markup refletido');
    semVazamento(r, u.slice(0, 30));
  }
});

console.log(`resiliencia-falhas-tests: ${n} testes ok`);
