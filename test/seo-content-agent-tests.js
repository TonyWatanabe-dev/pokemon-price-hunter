// SEO & Content Agent — MVP somente leitura (issue #594): gate de prontidão desativado por padrão, casos dourados de
// página (conteúdo vazio, dado desatualizado, canonical/metadados, ausência de evidência), sitemap, robots × noindex
// e a CLI tools/seo-audit.mjs de ponta a ponta. Sem rede e sem banco: a CLI roda num processo separado com fetch local.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readiness, PREREQUISITOS, SEO_AGENT_ENABLED_DEFAULT, auditPage, auditSitemap, auditRoutes, report, parsePage, DESC_MAX } from '../src/agents/seo-content.js';
import { toQuery } from '../tools/seo-audit.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0;
function t(name, fn) { try { fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } }
const SITE = 'https://tcg-price-hunter.vercel.app';
const FRESH = { status: 'atual', ageMin: 5 }, STALE = { status: 'desatualizado', ageMin: 300 };
const html = ({ title = 'Produto X | TCG Price Hunter', desc = 'Produto X a partir de R$ 10,00.', canonical = `${SITE}/produto/x`, noindex = false, ssr = '<h1>Produto X</h1><p>R$ 10,00 em Loja A.</p>', ld = ['{"@type":"Product"}'] } = {}) =>
  `<html><head>${title != null ? `<title>${title}</title>` : ''}${desc != null ? `<meta name="description" content="${desc}">` : ''}${canonical ? `<link rel="canonical" href="${canonical}">` : ''}${ld.map((j) => `<script type="application/ld+json">${j}</script>`).join('')}${noindex ? '<meta name="robots" content="noindex">' : ''}</head>`
  + `<body><div id="view">${ssr != null ? `<div class="ssr">${ssr}</div>` : ''}</div></body></html>`;
const rules = (r) => r.findings.map((f) => f.regra).sort();
const audit = (o = {}, page = {}) => auditPage({ url: '/produto/x', file: 'api/pagina.mjs', html: html(o), freshness: FRESH, ...page }, { site: SITE });

// ---- Gate de prontidão ----
t('sem evidência: tudo bloqueado e agente desligado', () => {
  assert.equal(SEO_AGENT_ENABLED_DEFAULT, false);
  for (const ev of [undefined, null, {}, 'x']) {
    const r = readiness(ev);
    assert.equal(r.status, 'bloqueado'); assert.equal(r.enabled, false);
    assert.equal(r.bloqueios.length, PREREQUISITOS.length);
    assert.ok(r.items.every((i) => i.motivo === 'sem evidência'));
  }
});
const allOk = () => Object.fromEntries(PREREQUISITOS.map((p) => [p.id, { ok: true, ref: ['docs/x.md'] }]));
t('tudo comprovado ainda exige autorização explícita para ligar', () => {
  assert.deepEqual([readiness(allOk()).status, readiness(allOk()).enabled], ['pronto', false]);
  assert.equal(readiness(allOk(), { authorized: 'sim' }).enabled, false);
  assert.equal(readiness(allOk(), { authorized: true }).enabled, true);
});
t('ok sem referência, referência vazia ou ok não booleano não comprovam', () => {
  const ev = allOk();
  ev['search-console'] = { ok: true };
  ev['politica-conteudo'] = { ok: true, ref: ['  ', ''] };
  ev['fonte-canonica'] = { ok: 'true', ref: 'api/_seo.mjs' };
  const r = readiness(ev, { authorized: true });
  assert.equal(r.enabled, false); assert.deepEqual([...r.bloqueios].sort(), ['fonte-canonica', 'politica-conteudo', 'search-console']);
  assert.equal(r.items.find((i) => i.id === 'search-console').motivo, 'sem evidência');
  assert.equal(r.items.find((i) => i.id === 'fonte-canonica').motivo, 'evidência negativa');
});
t('evidências versionadas: bloqueado, desligado e toda referência local existe', () => {
  const ev = JSON.parse(fs.readFileSync(path.join(root, 'docs/seo-content-readiness.json'), 'utf8'));
  const r = readiness(ev);
  assert.equal(r.status, 'bloqueado'); assert.equal(r.enabled, false);
  assert.ok(r.bloqueios.includes('search-console') && r.bloqueios.includes('politica-conteudo'), 'sem Search Console nem política de conteúdo comprovados');
  for (const p of PREREQUISITOS) assert.ok(ev[p.id] && typeof ev[p.id].nota === 'string' && ev[p.id].nota.length > 0, `pré-requisito ${p.id} sem nota`);
  for (const i of r.items) for (const ref of i.ref) if (!/^https?:\/\//.test(ref)) assert.ok(fs.existsSync(path.join(root, ref)), `referência inexistente: ${ref}`);
  for (const i of r.items.filter((x) => x.status === 'comprovado')) assert.ok(i.ref.length > 0);
});

// ---- Página: casos dourados ----
t('ausência de evidência: abstém-se, sem recomendação', () => {
  for (const h of [undefined, '', '   ', 42]) {
    const r = auditPage({ url: '/x', html: h, freshness: FRESH }, { site: SITE });
    assert.equal(r.abstained, true); assert.deepEqual(r.findings, []); assert.match(r.abstencoes[0], /sem evidência/);
  }
});
t('página indexável completa e em dia: nenhum achado', () => {
  const r = audit(); assert.equal(r.indexavel, true); assert.deepEqual(r.findings, []); assert.deepEqual(r.abstencoes, []);
});
t('metadados ausentes', () => {
  assert.deepEqual(rules(audit({ title: null, desc: null, canonical: null })), ['SEO-CANONICAL-AUSENTE', 'SEO-DESCRICAO', 'SEO-TITULO']);
  assert.deepEqual(rules(audit({ title: '  ', desc: '' })), ['SEO-DESCRICAO', 'SEO-TITULO']);
  const long = audit({ desc: 'a'.repeat(DESC_MAX + 1) });
  assert.deepEqual(rules(long), ['SEO-DESCRICAO-LONGA']); assert.equal(long.findings[0].severidade, 'baixa');
  assert.deepEqual(rules(audit({ desc: 'a'.repeat(DESC_MAX) })), []);
});
t('canonical: outro host, outra URL e entidades HTML', () => {
  assert.deepEqual(rules(audit({ canonical: 'https://outro.github.io/produto/x' })), ['SEO-CANONICAL-HOST']);
  const r = audit({ canonical: `${SITE}/produto/y` });
  assert.deepEqual(rules(r), ['SEO-CANONICAL-URL']); assert.match(r.findings[0].evidencia, /produto\/y/);
  assert.deepEqual(rules(audit({ canonical: `${SITE}/` }, { url: SITE })), [], 'home com e sem barra final é a mesma URL');
  assert.equal(parsePage(html({ canonical: `${SITE}/busca?q=a&amp;b=1` })).canonical, `${SITE}/busca?q=a&b=1`);
  const sem = auditPage({ url: '/produto/x', html: html(), freshness: FRESH });
  assert.deepEqual(sem.findings, []); assert.ok(sem.abstencoes.some((a) => /host do site/.test(a)));
});
t('noindex: sem cobrança de metadados; no sitemap vira achado', () => {
  assert.deepEqual(rules(audit({ noindex: true, title: null, canonical: null, ssr: null })), []);
  const r = audit({ noindex: true, canonical: null, ssr: null }, { inSitemap: true });
  assert.deepEqual(rules(r), ['SEO-NOINDEX-NO-SITEMAP']); assert.equal(r.indexavel, false);
  assert.deepEqual(rules(audit({}, { status: 404, inSitemap: false })), []);
});
t('dado desatualizado indexável com preço no HTML: alta', () => {
  const r = audit({}, { freshness: STALE });
  assert.deepEqual(rules(r), ['SEO-DADOS-DESATUALIZADOS']); assert.equal(r.findings[0].severidade, 'alta'); assert.match(r.findings[0].evidencia, /desatualizado \(300 min\)/);
  assert.deepEqual(rules(audit({}, { freshness: { status: 'indisponivel', ageMin: null } })), ['SEO-DADOS-DESATUALIZADOS']);
  assert.deepEqual(rules(audit({}, { freshness: { status: 'atrasado', ageMin: 60 } })), []);
  assert.deepEqual(rules(audit({ noindex: true, canonical: null }, { freshness: STALE })), [], 'desatualizado mas noindex: ok');
});
t('frescor sem evidência: abstém-se das regras de frescor', () => {
  const r = audit({}, { freshness: null });
  assert.deepEqual(r.findings, []); assert.ok(r.abstencoes.includes('frescor: sem evidência'));
});
t('conteúdo vazio indexável', () => {
  for (const ssr of [null, '', '<p>  </p>']) assert.deepEqual(rules(audit({ ssr })), ['SEO-CONTEUDO-VAZIO']);
  assert.deepEqual(rules(audit({ ssr: null }, { freshness: STALE })), [], 'sem dados em dia, a casca sem SSR é o comportamento previsto');
});
t('JSON-LD inválido', () => {
  const r = audit({ ld: ['{"@type":"Product"}', '{quebrado'] });
  assert.deepEqual(rules(r), ['SEO-JSONLD-INVALIDO']); assert.match(r.findings[0].evidencia, /#2/);
});

// ---- Sitemap ----
t('sitemap: ausência, host, duplicata e lastmod', () => {
  assert.equal(auditSitemap(undefined).abstained, true); assert.equal(auditSitemap('<html></html>').abstained, true);
  const xml = `<?xml version="1.0"?><urlset><url><loc>${SITE}/</loc><lastmod>2026-10-13</lastmod></url><url><loc>${SITE}/</loc><lastmod>2026-10-13</lastmod></url>`
    + `<url><loc>https://x.github.io/a</loc><lastmod>ontem</lastmod></url><url><loc>${SITE}/b</loc></url></urlset>`;
  const r = auditSitemap(xml, { site: SITE });
  assert.deepEqual(r.urls, [`${SITE}/`, `${SITE}/`, 'https://x.github.io/a', `${SITE}/b`]);
  assert.deepEqual(rules(r), ['SEO-SITEMAP-DUPLICADA', 'SEO-SITEMAP-HOST', 'SEO-SITEMAP-LASTMOD']);
});

// ---- Rotas: vercel.json × robots.txt do próprio repositório ----
const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const robots = fs.readFileSync(path.join(root, 'robots.txt'), 'utf8');
t('rotas reais: rotas privadas rastreáveis para que buscadores leiam o noindex', () => {
  assert.equal(auditRoutes({}).abstained, true); assert.equal(auditRoutes({ vercel }).abstained, true);
  const r = auditRoutes({ vercel, robots, site: SITE });
  for (const rota of ['/', '/produto/:slug', '/colecao/:slug', '/tipo/:slug', '/lojas', '/termos']) assert.ok(r.rotas.some((x) => x.rota === rota), rota);
  assert.ok(r.rotas.every((x) => !x.noindexHeader && !x.robotsDisallow), 'nenhuma rota pública com noindex/Disallow');
  assert.deepEqual(r.findings, [], 'robots não deve bloquear rotas privadas que precisam comunicar noindex');
  assert.deepEqual(rules(auditRoutes({ vercel, robots: 'User-agent: *\nAllow: /\n', site: SITE })), ['SEO-ROBOTS-SEM-SITEMAP']);
  assert.deepEqual(rules(auditRoutes({ vercel, robots: 'Sitemap: https://x.github.io/sitemap.xml\n', site: SITE })), ['SEO-ROBOTS-SITEMAP-HOST']);
});
t('rota do sitemap → chamada de /api/pagina pelos rewrites', () => {
  assert.equal(toQuery('/', vercel.rewrites), '/api/pagina?t=home');
  assert.equal(toQuery('/produto/abc-1', vercel.rewrites), '/api/pagina?t=produto&slug=abc-1');
  assert.equal(toQuery('/guia/glossario', vercel.rewrites), '/api/pagina?t=glossario');
  assert.equal(toQuery('/busca', vercel.rewrites), null);
});

// ---- Relatório ----
t('relatório: somente leitura, sem publicar, ordenado por severidade, todo achado rastreável', () => {
  const pages = [audit({ desc: 'a'.repeat(200) }), audit({ title: null, canonical: `${SITE}/produto/z` }, { url: '/produto/z' }), auditPage({ url: '/v', html: '' })];
  const r = report({ pages, routes: auditRoutes({ vercel, robots, site: SITE }), sitemap: auditSitemap(undefined) });
  assert.equal(r.modo, 'somente-leitura'); assert.equal(r.publica, false); assert.equal(r.enabled, false); assert.equal(r.prontidao.status, 'bloqueado');
  assert.deepEqual(r.findings.map((f) => f.severidade), [...r.findings.map((f) => f.severidade)].sort((a, b) => ['alta', 'media', 'baixa'].indexOf(a) - ['alta', 'media', 'baixa'].indexOf(b)));
  assert.equal(r.findings[0].regra, 'SEO-TITULO');
  assert.deepEqual(r.porSeveridade, { alta: 1, media: 0, baixa: 1 });
  for (const f of r.findings) { assert.ok(f.url || f.file); assert.ok(f.evidencia); assert.ok(f.recomendacao); assert.ok(['alta', 'media', 'baixa'].includes(f.severidade)); }
  assert.ok(r.abstencoes.some((a) => /sitemap não informado/.test(a)) && r.abstencoes.some((a) => a.startsWith('/v: sem evidência')));
  assert.equal(r.inventario.paginas.length, 3);
});
t('o módulo não importa nada (sem rede, banco ou disco) e não está registrado como handler', () => {
  const src = fs.readFileSync(path.join(root, 'src/agents/seo-content.js'), 'utf8');
  assert.ok(!/^\s*import\s/m.test(src) && !/\bimport\(/.test(src) && !/\bfetch\(/.test(src) && !/\brequire\(/.test(src));
  for (const f of fs.readdirSync(path.join(root, 'src/agents'), { recursive: true })) {
    const p = path.join(root, 'src/agents', String(f)); if (!p.endsWith('.js') || p.endsWith('seo-content.js')) continue;
    assert.ok(!fs.readFileSync(p, 'utf8').includes('seo-content'), `${f} não deve carregar o agente de SEO`);
  }
});

// ---- CLI de ponta a ponta (processo separado, offline) ----
function cli(args) {
  const r = spawnSync(process.execPath, [path.join(root, 'tools/seo-audit.mjs'), ...args], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, API_DATABASE_URL: '' } });
  if (r.status !== 0) throw new Error(`seo-audit falhou (${r.status}): ${r.stderr}`);
  return { rep: JSON.parse(r.stdout), err: r.stderr };
}
const NOW = '2026-10-09T18:00:00.000Z'; const T = new Date(Date.parse(NOW) - 5 * 6e4).toISOString();
const off = (id, productId, total) => ({ id, productId, storeId: 's-' + id, storeName: 'Loja ' + id, title: 'x', url: 'https://x.com.br/' + id, price: total, priceKind: 'base', shipping: 0, shippingKnown: true, total,
  stock: 'IN_STOCK', confirmed: true, anomalous: false, stale: false, discount: null, matchConfidence: 0.95, firstSeen: T, source_timestamp: T });
const prod = (id, type, typeLabel) => ({ id, collection: 'c1', collectionName: 'Alfa', type, typeLabel, group: typeLabel, boosters: null, copagConfirmed: false, msrp: null, offerCount: 1 });
const state = { generatedAt: T, coverage: { found: 2 }, totals: { offers: 2 }, products: [prod('p1', 'etb', 'Treinador Avançado (ETB)'), prod('p2', 'booster_box', 'Booster Box')],
  offers: [off('a', 'p1', 320), off('b', 'p2', 800)], collections: [{ id: 'c1', name: 'Alfa', series: 'S', aliases: [], products: 2 }],
  types: [{ id: 'etb', label: 'Treinador Avançado (ETB)', group: 'ETB', products: 1 }, { id: 'booster_box', label: 'Booster Box', group: 'Box', products: 1 }], sources: [], activity: [], tips: [], bestDeals: [] };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-audit-'));
const statePath = path.join(tmp, 'state.json'); fs.writeFileSync(statePath, JSON.stringify(state));

t('CLI com dados em dia: produtos auditados, só os achados de rotas, agente desligado', () => {
  const { rep, err } = cli(['--state', statePath, '--agora', NOW]);
  assert.equal(rep.enabled, false); assert.equal(rep.publica, false); assert.equal(rep.fonte.frescor, 'atual'); assert.match(err, /agente desativado/);
  assert.ok(rep.inventario.sitemap.includes(`${SITE}/produto/alfa-treinador-avancado-etb`) && rep.inventario.sitemap.includes(`${SITE}/colecao/alfa`));
  assert.ok(rep.inventario.paginas.length >= 12 && rep.inventario.paginas.every((p) => p.indexavel === true && !p.abstained));
  assert.deepEqual([...new Set(rep.findings.map((f) => f.regra))], []);
});
t('CLI sem dados (ou desatualizados): sitemap mantém somente a Home indexável e descriptions válidas', () => {
  for (const args of [[], ['--state', statePath, '--agora', '2026-10-10T18:00:00.000Z']]) {
    const { rep } = cli(args);
    assert.equal(rep.enabled, false); assert.notEqual(rep.fonte.frescor, 'atual');
    assert.ok(!rep.inventario.sitemap.some((u) => u.includes('/produto/')), 'sem produto no sitemap com dado velho');
    const noidx = rep.findings.filter((f) => f.regra === 'SEO-NOINDEX-NO-SITEMAP').map((f) => new URL(f.url).pathname).sort();
    assert.deepEqual(noidx, [], 'páginas noindex não devem estar no sitemap quando os dados estão stale');
    assert.ok(!rep.findings.some((f) => f.regra === 'SEO-DADOS-DESATUALIZADOS' || f.regra === 'SEO-CONTEUDO-VAZIO'));
    assert.ok(!rep.findings.some((f) => f.regra === 'SEO-DESCRICAO-LONGA' && f.url === `${SITE}/`), 'description estática da Home deve ter até 160 caracteres');
  }
});
fs.rmSync(tmp, { recursive: true, force: true });

console.log(`seo-content-agent: ${n} testes ok`);
