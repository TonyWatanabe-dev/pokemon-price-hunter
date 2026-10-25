#!/usr/bin/env node
// Benchmark offline e reproduzível das funções do site (sem rede, sem banco real):
//   • api/pagina.mjs (home, produto, coleção, oportunidades) e api/sitemap.mjs com o state.json real e com um sintético N× maior;
//   • api/v1.mjs, rotas principais, com a fonte state.json e com o banco SIMULADO (pool.query trocado por respostas montadas
//     a partir do próprio state.json; SQL não simulado responde [] e aparece em "sqlNaoSimulado");
//   • tamanho do HTML/CSS/JS gerados pelo slim (api/_lib/slim.mjs) e das respostas (bytes e gzip).
// Cada conjunto roda num processo separado (os módulos guardam cache de state); relógio do frescor fixado em dataAt + 5 min,
// então o resultado não depende da hora em que roda. fetch é simulado: qualquer URL fora do state.json falha.
// Tempo é linha de base, não critério: varia com a máquina. Uso:
//   node tools/bench-site.mjs [--state arquivo.json | --ramo data] [--n 30] [--escala 5] [--latencia-db 0] [--saida bench.json] [--json]
// Sem --state, tenta o ramo data local (git archive origin/data; rode antes git fetch origin data) e cai no data/state.json.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const SELF = fileURLToPath(import.meta.url);
export const ROOT = path.resolve(path.dirname(SELF), '..');
const href = (rel) => pathToFileURL(path.join(ROOT, rel)).href;

// ---------------------------------------------------------------- utilitários puros (exportados para os testes)
export function estatisticas(ms) {
  const s = [...ms].sort((a, b) => a - b); const n = s.length;
  if (!n) return { n: 0, media: null, mediana: null, p95: null, min: null, max: null };
  const r = (x) => Math.round(x * 1000) / 1000;
  const q = (p) => s[Math.min(n - 1, Math.max(0, Math.ceil(p * n) - 1))];
  return { n, media: r(s.reduce((a, x) => a + x, 0) / n), mediana: r(q(0.5)), p95: r(q(0.95)), min: r(s[0]), max: r(s[n - 1]) };
}
export const gz = (s) => zlib.gzipSync(Buffer.from(s ?? '')).length;
export const bytes = (s) => Buffer.byteLength(s ?? '');

/** State sintético `escala`× maior: cada coleção, produto e oferta ganha cópias com ids e nomes distintos (slugs únicos).
 *  A cópia 1 é o original. Mantém dataAt/generatedAt (mesmo frescor) e as demais chaves como estão. */
export function sintetico(st, escala = 5) {
  const k = Math.max(1, Math.floor(escala));
  if (k === 1) return st;
  const sufId = (id, i) => (i === 1 ? id : `${id}-r${i}`.replace(/-(en|ja|zh|ko)-r(\d+)$/, '-r$2-$1'));   // idioma continua no fim do id
  const colId = (id, i) => (i === 1 ? id : `${id}r${i}`);
  const colName = (n, i) => (i === 1 ? n : `${n} R${i}`);
  const out = { ...st, collections: [], products: [], offers: [] };
  for (let i = 1; i <= k; i++) {
    for (const c of st.collections || []) out.collections.push({ ...c, id: colId(c.id, i), name: colName(c.name, i), aliases: i === 1 ? c.aliases : [] });
    for (const p of st.products || []) out.products.push({ ...p, id: sufId(p.id, i), collection: colId(p.collection, i), collectionName: colName(p.collectionName, i) });
    for (const o of st.offers || []) out.offers.push({ ...o, id: i === 1 ? o.id : `${o.id}~r${i}`, productId: sufId(o.productId, i), url: i === 1 ? o.url : `${o.url}${String(o.url || '').includes('?') ? '&' : '?'}r=${i}` });
  }
  return out;
}

// ---------------------------------------------------------------- banco simulado (linhas montadas do state.json)
export function bancoSimulado(st, { latenciaMs = 0 } = {}) {
  const dataAt = st.dataAt ?? st.generatedAt;
  const prods = (st.products || []).map((p, i) => ({ ...p, _n: i + 1 }));
  const PN = new Map(prods.map((p) => [p.id, p]));
  const ship = (o) => (!o.shippingKnown ? 'unknown' : Number(o.shipping) === 0 ? 'free' : 'known');
  const stock = { IN_STOCK: 'in_stock', OUT_OF_STOCK: 'out_of_stock', PRE_ORDER: 'preorder' };
  const productRows = prods.map((p) => ({
    id: p._n, legacy_id: p.id, units: p.boosters ?? null, variant: p.variant ?? null, image_url: p.image ?? null,
    attrs: { type: p.type, typeLabel: p.typeLabel, group: p.group }, col_code: p.collection, col_name: p.collectionName,
    ref_value: p.copagConfirmed ? p.msrp : p.copagReference ?? null, ref_status: p.copagConfirmed ? 'verified' : p.copagReference ? 'pending' : null,
    ref_url: p.copagConfirmed ? p.copag?.source_url ?? null : p.copagReferenceUrl ?? null, ref_source: 'copag_loja', ref_verified_at: p.copag?.source_timestamp ?? null,
    ref_kind: p.copagConfirmed ? 'COPAG_OFFICIAL_CURRENT' : null, ean: p.ean ?? null,
  }));
  const offerRows = (st.offers || []).filter((o) => PN.has(o.productId)).map((o, i) => ({
    _n: i + 1, legacy_id: o.id, product_legacy: o.productId, store_id: o.storeId, store_name: o.storeName, seller_name: o.seller ?? null, url: o.url, image_url: o.image ?? null,
    price: o.price, price_kind: o.priceKind ?? null, shipping_price: o.shippingKnown ? o.shipping : null, shipping_status: ship(o), total_price: o.shippingKnown ? o.total : null,
    stock_status: stock[o.stock] || 'unknown', quantity: o.quantity ?? null, confirmed: o.confirmed !== false, anomalous: !!o.anomalous, status: o.stale ? 'pending' : 'active',
    first_seen_at: o.firstSeen ?? null, last_seen_at: o.source_timestamp ?? dataAt, opp_score: o.dealScore ?? null, opp_band: null, opp_conf: null,
  }));
  // Opportunity Engine simulado: melhor oferta com estoque de cada produto, nota = dealScore do robô (só para ter volume realista).
  const best = new Map();
  for (const r of offerRows) {
    if (r.stock_status !== 'in_stock' || r.anomalous || r.status !== 'active' || !(r.price > 0)) continue;
    const b = best.get(r.product_legacy); if (!b || r.price < b.price) best.set(r.product_legacy, r);
  }
  const oppRows = [...best.values()].map((r) => { const p = PN.get(r.product_legacy); const ref = p.copagConfirmed ? p.msrp : null;
    return { offer_id: r._n, legacy_id: p.id, slug: null, canonical_name: `${p.collectionName} - ${p.typeLabel}`, attrs: { type: p.type, typeLabel: p.typeLabel, group: p.group },
      product_image: p.image ?? null, col_code: p.collection, col_name: p.collectionName, offer_legacy: r.legacy_id, url: r.url, title_raw: r.legacy_id, offer_image: r.image_url,
      first_seen_at: r.first_seen_at, price_kind: r.price_kind, total_price: r.total_price, shipping_status: r.shipping_status, stock_status: r.stock_status, store_id: r.store_id,
      store_name: r.store_name, marketplace_id: r.store_id === 'mercadolivre' ? 'mercadolivre' : 'direct', last_seen_at: r.last_seen_at, offer_status: r.status, price: r.price,
      opportunity_score: Math.max(0, Math.min(100, Math.round(r.opp_score ?? 50))), opportunity_band: 'normal', confidence: 0.8, reasons: [], warnings: [], caps: [],
      engine_version: 'bench', calculated_at: dataAt, engine_run_at: dataAt, opp_reference_kind: ref ? 'COPAG_OFFICIAL_CURRENT' : 'NONE', opp_reference_value: ref,
      opp_reference_gap: ref ? (ref - r.price) / ref : null, variation_7d: null, reference_kind: ref ? 'COPAG_OFFICIAL_CURRENT' : 'NONE', reference_price: ref,
      reference_confidence: ref ? 0.95 : null, reference_reason: null, market_sources: null, market_composition: 'NONE', historical: [], community: null }; })
    .sort((a, b) => b.opportunity_score - a.opportunity_score || a.offer_id - b.offer_id);
  const colRows = (st.collections || []).map((c) => ({ id: c.id, name: c.name, series: c.series ?? null, aliases: c.aliases || [] })).sort((a, b) => a.id.localeCompare(b.id));
  const naoSimulado = new Map();
  const responder = (sql, params = []) => {
    if (/max\(last_seen_at\)/.test(sql)) return [{ at: dataAt }];
    if (/total_rows/.test(sql) && /opportunity/.test(sql)) {
      const lim = Number(params[3]) || 24; const off = Number(params[4]) || 0; const sel = oppRows.slice(off, off + lim);
      return sel.map((r) => ({ ...r, total_rows: oppRows.length }));
    }
    if (/hunter\.price_history/.test(sql)) return [];
    if (/op\.opportunity_score AS opp_score/.test(sql)) return offerRows;
    if (/FROM hunter\.product p\s+LEFT JOIN hunter\.collection/.test(sql) && /WHERE p\.legacy_id IS NOT NULL\s*$/.test(sql)) return productRows;
    if (/FROM hunter\.collection ORDER BY code/.test(sql)) return colRows;
    const chave = sql.replace(/\s+/g, ' ').trim().slice(0, 90); naoSimulado.set(chave, (naoSimulado.get(chave) || 0) + 1);
    return [];
  };
  const query = async (sql, params) => { if (latenciaMs > 0) await new Promise((ok) => setTimeout(ok, latenciaMs)); return { rows: responder(String(sql), params) }; };
  return { query, naoSimulado, contagem: { produtos: productRows.length, ofertas: offerRows.length, oportunidades: oppRows.length } };
}

// ---------------------------------------------------------------- tamanhos do slim (sem state)
export async function tamanhosSlim(root = ROOT) {
  const { slim } = await import(pathToFileURL(path.join(root, 'api/_lib/slim.mjs')).href);
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const r = slim(html);
  const f = (tipo) => r.arquivos.find((a) => a.tipo === tipo)?.conteudo ?? '';
  const br = (s) => zlib.brotliCompressSync(Buffer.from(s)).length;
  const lin = (s) => ({ bytes: bytes(s), gzip: gz(s), brotli: br(s) });
  return { indexHtml: lin(html), appHtml: lin(r.html), css: lin(f('text/css')), js: lin(f('text/javascript')), arquivos: r.arquivos.map((a) => a.nome) };
}

// ---------------------------------------------------------------- processo filho: um conjunto de dados
const mkRes = () => ({ statusCode: 200, headers: {}, setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; }, end(b) { this.body = b ?? ''; } });

async function filho({ arquivo, escala, n, latenciaDb }) {
  const base = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  const st = sintetico(base, escala);
  const texto = JSON.stringify(st);
  const dataAt = st.dataAt ?? st.generatedAt; const NOW = Date.parse(dataAt) + 5 * 6e4;
  if (!Number.isFinite(NOW)) throw new Error('state sem dataAt/generatedAt válido');
  const FR = await import(href('api/_lib/freshness.mjs')); FR.setFreshnessClock(() => NOW);
  let fetches = 0;
  globalThis.fetch = async (url) => { fetches++; if (String(url).endsWith('/state.json')) return new Response(texto, { status: 200, headers: { 'content-type': 'application/json' } }); throw new Error('rede bloqueada no benchmark: ' + url); };
  delete process.env.API_DATABASE_URL;
  const mem = () => { const m = process.memoryUsage(); return { heapMB: +(m.heapUsed / 2 ** 20).toFixed(1), rssMB: +(m.rss / 2 ** 20).toFixed(1) }; };
  const out = { escala, produtos: st.products?.length ?? 0, ofertas: st.offers?.length ?? 0, colecoes: st.collections?.length ?? 0, stateBytes: bytes(texto), stateGzip: gz(texto), memoria: { inicio: mem() } };
  const t0 = performance.now(); JSON.parse(texto); out.parseStateMs = +(performance.now() - t0).toFixed(3);

  const { default: pagina } = await import(href('api/pagina.mjs'));
  const { default: sitemap } = await import(href('api/sitemap.mjs'));
  const v1mod = await import(href('api/v1.mjs')); const v1 = v1mod.default;
  const SEO = await import(href('api/_seo.mjs'));
  // slugs reais: produto com mais ofertas com estoque, coleção com mais produtos
  const { of } = SEO.slugs(st.products || []); const { n: inStock } = SEO.bestBy(st);
  const prod = [...(st.products || [])].sort((a, b) => (inStock[b.id] || 0) - (inStock[a.id] || 0) || a.id.localeCompare(b.id))[0];
  const cnt = {}; for (const p of st.products || []) cnt[p.collection] = (cnt[p.collection] || 0) + 1;
  const col = [...(st.collections || [])].sort((a, b) => (cnt[b.id] || 0) - (cnt[a.id] || 0) || a.id.localeCompare(b.id))[0];
  const alvo = { produto: prod ? of[prod.id] : 'nenhum', produtoId: prod?.id ?? null, colecao: col ? SEO.colSlug(col) : 'nenhuma' };
  out.alvos = alvo;

  const rodar = async (nome, fn) => {
    const a = performance.now(); const r0 = await fn(); const frio = performance.now() - a;
    const ms = []; let r = r0;
    for (let i = 0; i < n; i++) { const t = performance.now(); r = await fn(); ms.push(performance.now() - t); }
    return [nome, { status: r.statusCode, frioMs: +frio.toFixed(3), ...estatisticas(ms), bytes: bytes(r.body), gzip: gz(r.body), cacheControl: r.headers['cache-control'] ?? null,
      noindex: /<meta name="robots" content="noindex">/.test(r.body || '') || undefined, fonte: r.headers['x-data-source'] ?? undefined }];
  };
  const pg = (qs) => async () => { const res = mkRes(); await pagina({ url: '/api/pagina?' + qs, headers: { host: 'tcgpricehunter.com.br' } }, res); return res; };
  const sm = async () => { const res = mkRes(); await sitemap({}, res); return res; };
  const api = (u) => async () => { v1mod._cache.clear(); const res = mkRes(); await v1({ url: u, method: 'GET' }, res, { now: NOW }); return res; };

  const P = encodeURIComponent;
  const paginas = [['home', 't=home'], ['produto', `t=produto&slug=${P(alvo.produto)}`], ['colecao', `t=colecao&slug=${P(alvo.colecao)}`], ['oportunidades', 't=oportunidades']];
  const rotasV1 = [['home', '/api/v1/home'], ['site-produtos', '/api/v1/site/produtos'], ['site-lojas', '/api/v1/site/lojas'], ['site-pagina-copag', '/api/v1/site/pagina/copag'],
    ['produtos', '/api/v1/produtos?limite=24'], ['produto', `/api/v1/produtos/${alvo.produto}`], ['ofertas', `/api/v1/produtos/${alvo.produto}/ofertas?limite=24`],
    ['site-produto', `/api/v1/site/produto/${alvo.produto}`], ['oportunidades', '/api/v1/oportunidades?limite=24']];

  out.pagina = {}; for (const [k, qs] of paginas) { const [nm, r] = await rodar(k, pg(qs)); out.pagina[nm] = r; }
  { const [, r] = await rodar('sitemap', sm); r.urls = null; out.sitemap = r; const res = await sm(); out.sitemap.urls = (res.body.match(/<loc>/g) || []).length; }
  out.memoria.aposPaginas = mem();
  out.v1State = {}; for (const [k, u] of rotasV1) { const [nm, r] = await rodar(k, api(u)); out.v1State[nm] = r; }
  out.memoria.aposV1State = mem();

  // banco simulado: pool real do módulo (sem conectar) com query trocado
  process.env.API_DATABASE_URL = 'postgres://bench:bench@127.0.0.1:1/bench';
  const DBM = await import(href('api/_lib/db.mjs')); await DBM.closeApiPool(); const pool = await DBM.apiPool();
  const sim = bancoSimulado(st, { latenciaMs: latenciaDb }); pool.query = sim.query;
  const { clearCatalogCache } = await import(href('api/_lib/catalog.mjs'));
  FR.clearFreshnessCache(); clearCatalogCache();
  out.banco = { simulado: sim.contagem, latenciaMs: latenciaDb };
  out.paginaBanco = {}; for (const [k, qs] of [['home', 't=home'], ['oportunidades', 't=oportunidades']]) { const [nm, r] = await rodar(k, pg(qs)); out.paginaBanco[nm] = r; }
  out.v1Banco = {}; for (const [k, u] of rotasV1.filter(([k]) => ['home', 'site-produtos', 'site-lojas', 'site-pagina-copag', 'oportunidades'].includes(k))) { const [nm, r] = await rodar(k, api(u)); out.v1Banco[nm] = r; }
  out.banco.sqlNaoSimulado = Object.fromEntries(sim.naoSimulado);
  await DBM.closeApiPool().catch(() => {});
  out.memoria.fim = mem();
  out.memoria.maxRssMB = +(process.resourceUsage().maxRSS / 1024).toFixed(1);
  out.fetchesState = fetches;
  return out;
}

// ---------------------------------------------------------------- orquestração
function args(argv) {
  const a = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
  return { state: a('--state', null), ramo: a('--ramo', null), n: Math.max(1, Number(a('--n', 30)) || 30), escala: Math.max(1, Number(a('--escala', 5)) || 5),
    latenciaDb: Math.max(0, Number(a('--latencia-db', 0)) || 0), saida: a('--saida', null), json: argv.includes('--json'), so: a('--so', null) };
}

/** Resolve o arquivo do state: --state, ramo local (git archive, sem rede) ou data/state.json do repositório. */
export function resolverState({ state = null, ramo = null } = {}, root = ROOT) {
  if (state) return { arquivo: path.resolve(state), fonte: `arquivo ${state}` };
  for (const r of ramo ? [ramo] : ['data']) {
    try {
      const txt = execFileSync('git', ['archive', `origin/${r}`, 'data/state.json'], { cwd: root, maxBuffer: 512 * 2 ** 20 });
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-site-'));
      execFileSync('tar', ['-x', '-C', dir], { input: txt });
      const commit = execFileSync('git', ['rev-parse', '--short', `origin/${r}`], { cwd: root, encoding: 'utf8' }).trim();
      return { arquivo: path.join(dir, 'data/state.json'), fonte: `git archive origin/${r} (${commit})`, temp: dir };
    } catch { if (ramo) throw new Error(`ramo origin/${ramo} indisponível localmente (git fetch origin "+refs/heads/${ramo}:refs/remotes/origin/${ramo}")`); }
  }
  return { arquivo: path.join(root, 'data/state.json'), fonte: 'data/state.json do repositório' };
}

export function rodarConjunto({ arquivo, escala, n, latenciaDb = 0 }, root = ROOT) {
  const r = spawnSync(process.execPath, [SELF, '--filho', JSON.stringify({ arquivo, escala, n, latenciaDb })],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 2 ** 20, env: { ...process.env, API_DATABASE_URL: '', NODE_ENV: 'production' } });
  if (r.status !== 0) throw new Error(`conjunto escala ${escala} falhou: ${(r.stderr || '').slice(-2000)}`);
  const linha = r.stdout.trim().split('\n').pop();
  return JSON.parse(linha);
}

function tabela(res) {
  const L = [];
  const fmt = (x) => (x == null ? '-' : String(x));
  for (const [nome, c] of Object.entries(res.conjuntos)) {
    L.push(`\n== ${nome}: ${c.produtos} produtos, ${c.ofertas} ofertas, state ${(c.stateBytes / 2 ** 20).toFixed(1)} MB (parse ${c.parseStateMs} ms), maxRSS ${c.memoria.maxRssMB} MB`);
    L.push('grupo/rota'.padEnd(34) + 'status  frio ms   média    p95     max    bytes    gzip');
    for (const g of ['pagina', 'v1State', 'paginaBanco', 'v1Banco']) for (const [k, v] of Object.entries(c[g] || {}))
      L.push(`${g}/${k}`.padEnd(34) + [v.status, v.frioMs, v.media, v.p95, v.max, v.bytes, v.gzip].map(fmt).map((x, i) => (i ? x.padStart(8) : x.padEnd(6))).join(''));
    const s = c.sitemap; L.push('sitemap'.padEnd(34) + [s.status, s.frioMs, s.media, s.p95, s.max, s.bytes, s.gzip].map(fmt).map((x, i) => (i ? x.padStart(8) : x.padEnd(6))).join('') + `  (${s.urls} URLs)`);
    if (Object.keys(c.banco.sqlNaoSimulado || {}).length) L.push(`SQL não simulado: ${Object.keys(c.banco.sqlNaoSimulado).length}`);
  }
  const t = res.tamanhos; L.push(`\n== slim: index.html ${t.indexHtml.bytes} B → app.html ${t.appHtml.bytes} B (gzip ${t.appHtml.gzip}); css ${t.css.bytes} B (gzip ${t.css.gzip}); js ${t.js.bytes} B (gzip ${t.js.gzip})`);
  return L.join('\n');
}

export async function main(argv = process.argv.slice(2), log = console.log) {
  if (argv[0] === '--filho') { process.stdout.write(JSON.stringify(await filho(JSON.parse(argv[1]))) + '\n'); return 0; }
  const o = args(argv);
  const src = resolverState(o);
  const st = JSON.parse(fs.readFileSync(src.arquivo, 'utf8'));
  const res = {
    meta: { ferramenta: 'tools/bench-site.mjs', quando: new Date().toISOString(), node: process.version, plataforma: `${os.platform()} ${os.arch()}`, cpu: os.cpus()[0]?.model ?? null, nucleos: os.cpus().length,
      n: o.n, escala: o.escala, latenciaDbMs: o.latenciaDb, state: { fonte: src.fonte, generatedAt: st.generatedAt ?? null, dataAt: st.dataAt ?? null } },
    conjuntos: {}, tamanhos: await tamanhosSlim(),
  };
  const conj = o.so === 'real' ? [['real', 1]] : o.so === 'sintetico' ? [[`sintetico${o.escala}x`, o.escala]] : [['real', 1], [`sintetico${o.escala}x`, o.escala]];
  for (const [nome, escala] of conj) res.conjuntos[nome] = rodarConjunto({ arquivo: src.arquivo, escala, n: o.n, latenciaDb: o.latenciaDb });
  if (src.temp) fs.rmSync(src.temp, { recursive: true, force: true });
  if (o.saida) fs.writeFileSync(o.saida, JSON.stringify(res, null, 2) + '\n');
  log(o.json ? JSON.stringify(res, null, 2) : tabela(res));
  return 0;
}
if (process.argv[1] && path.resolve(process.argv[1]) === SELF) main().then((c) => { process.exitCode = c; }, (e) => { console.error(e?.message || e); process.exitCode = 1; });
