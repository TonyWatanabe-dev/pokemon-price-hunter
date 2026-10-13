// SEO & Content Agent — endurecimento do MVP somente leitura (issue #607). Complementa test/seo-content-agent-tests.js:
// frescor stale/indisponível/desconhecido (com classify() real), canonical, robots/sitemap, abstenção sem evidência,
// rastreabilidade de todo achado, entradas congeladas (o auditor não escreve nada), gate que falha fechado e a CLI sem
// escrita fora de --out e sem ligar o agente. Sem rede e sem banco: a CLI roda num processo separado e offline.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as agente from '../src/agents/seo-content.js';
import { classify, LIMITS } from '../api/_lib/freshness.mjs';

const { readiness, PREREQUISITOS, SEVERIDADES, auditPage, auditSitemap, auditRoutes, report, sourceRegex } = agente;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0;
function t(name, fn) { try { fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } }
const SITE = 'https://tcg-price-hunter.vercel.app';
const FRESH = { status: 'atual', ageMin: 5 };
const html = ({ title = 'Produto X | TCG Price Hunter', desc = 'Produto X a partir de R$ 10,00.', canonical = `${SITE}/produto/x`, noindex = false, ssr = '<h1>Produto X</h1><p>R$ 10,00 em Loja A.</p>', ld = ['{"@type":"Product"}'] } = {}) =>
  `<html><head>${title != null ? `<title>${title}</title>` : ''}${desc != null ? `<meta name="description" content="${desc}">` : ''}${canonical ? `<link rel="canonical" href="${canonical}">` : ''}${ld.map((j) => `<script type="application/ld+json">${j}</script>`).join('')}${noindex ? '<meta name="robots" content="noindex">' : ''}</head>`
  + `<body><div id="view">${ssr != null ? `<div class="ssr">${ssr}</div>` : ''}</div></body></html>`;
const rules = (r) => r.findings.map((f) => f.regra).sort();
const audit = (o = {}, page = {}, opts = { site: SITE }) => auditPage({ url: '/produto/x', file: 'api/pagina.mjs', html: html(o), freshness: FRESH, ...page }, opts);
const deepFreeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); } return o; };
const CAMPOS = ['evidencia', 'file', 'recomendacao', 'regra', 'severidade', 'url'];
function rastreavel(f) {
  assert.deepEqual(Object.keys(f).sort(), CAMPOS, `achado ${f.regra} com campos fora do contrato`);
  assert.match(f.regra, /^SEO-[A-Z-]+$/); assert.ok(SEVERIDADES.includes(f.severidade), f.regra);
  assert.ok(f.url || f.file, `${f.regra} sem URL nem arquivo`);
  assert.ok(typeof f.evidencia === 'string' && f.evidencia.trim(), `${f.regra} sem evidência`);
  assert.ok(typeof f.recomendacao === 'string' && f.recomendacao.trim(), `${f.regra} sem recomendação`);
  assert.ok(!/\b(undefined|null|NaN)\b/.test(f.evidencia), `${f.regra}: evidência com valor ausente: ${f.evidencia}`);
}

// ---- Frescor: stale, indisponível e desconhecido ----
t('frescor real (classify): atual/atrasado sem achado; desatualizado/indisponível com preço indexável = alta', () => {
  const now = Date.parse('2026-10-13T12:00:00Z'); const at = (min) => new Date(now - min * 6e4).toISOString();
  const casos = [[at(5), 'atual', false], [at(LIMITS.ATUAL_MIN), 'atual', false], [at(LIMITS.ATRASADO_MIN), 'atrasado', false],
    [at(LIMITS.ATRASADO_MIN + 1), 'desatualizado', true], [at(LIMITS.EXPIRA_MIN + 1), 'indisponivel', true],
    [null, 'indisponivel', true], ['lixo', 'indisponivel', true], [new Date(now + 10 * 6e4).toISOString(), 'indisponivel', true]];
  for (const [ts, status, achou] of casos) {
    const fr = classify(ts, now); assert.equal(fr.status, status, String(ts));
    const r = audit({}, { freshness: fr });
    assert.deepEqual(rules(r), achou ? ['SEO-DADOS-DESATUALIZADOS'] : [], `${ts} → ${status}`);
    assert.ok(!r.abstencoes.includes('frescor: sem evidência'));
    if (achou) { assert.equal(r.findings[0].severidade, 'alta'); assert.match(r.findings[0].evidencia, new RegExp(`frescor=${status}`)); rastreavel(r.findings[0]); }
  }
  const ind = audit({}, { freshness: classify(null, now) }).findings[0];
  assert.equal(ind.evidencia.includes(' min)'), false, 'sem idade conhecida a evidência não inventa minutos');
});
t('frescor sem estado conhecido não é evidência: abstém-se e não recomenda', () => {
  for (const fr of [{}, { status: 'xyz' }, { status: null, ageMin: 900 }, { status: 'ATUAL' }, [], 'desatualizado', 0, false]) {
    const r = audit({}, { freshness: fr });
    assert.deepEqual(r.findings, [], JSON.stringify(fr)); assert.ok(r.abstencoes.includes('frescor: sem evidência'), JSON.stringify(fr));
  }
});
t('stale não vira achado onde não há dado indexável nem pune a casca vazia prevista', () => {
  const STALE = { status: 'desatualizado', ageMin: 300 }, IND = { status: 'indisponivel', ageMin: null };
  for (const fr of [STALE, IND]) {
    assert.deepEqual(rules(audit({ noindex: true, canonical: null }, { freshness: fr })), [], 'noindex');
    assert.deepEqual(rules(audit({}, { freshness: fr, status: 404 })), [], '404');
    assert.deepEqual(rules(audit({}, { freshness: fr, status: 503 })), [], '503');
    for (const ssr of [null, '', '<p> </p>']) assert.deepEqual(rules(audit({ ssr }, { freshness: fr })), [], 'sem SSR com dado velho é o previsto');
  }
  assert.deepEqual(rules(audit({ ssr: null }, { freshness: null })), ['SEO-CONTEUDO-VAZIO'], 'frescor desconhecido não esconde página vazia');
  assert.deepEqual(rules(audit({ ssr: null }, { freshness: { status: 'atrasado', ageMin: 60 } })), ['SEO-CONTEUDO-VAZIO']);
});

// ---- Canonical ----
t('canonical: esquema, barra final, query e âncora diferentes da própria URL', () => {
  for (const c of [`http://tcg-price-hunter.vercel.app/produto/x`, `${SITE}/produto/x/`, `${SITE}/produto/x?ref=1`, `${SITE}/produto/X`]) {
    const r = audit({ canonical: c }); assert.deepEqual(rules(r), ['SEO-CANONICAL-URL'], c); assert.ok(r.findings[0].evidencia.includes(c)); rastreavel(r.findings[0]);
  }
  assert.deepEqual(rules(audit({ canonical: `${SITE}/busca?q=a&amp;b=1` }, { url: '/busca?q=a&b=1' })), [], 'entidade HTML decodificada = mesma URL');
  assert.deepEqual(rules(audit({ canonical: `${SITE}/produto/x` }, { url: `${SITE}/produto/x` })), [], 'URL absoluta auditada');
});
t('canonical: relativo, subdomínio e porta contam como host errado, com a evidência lida', () => {
  for (const c of ['/produto/x', 'https://www.tcg-price-hunter.vercel.app/produto/x', 'https://tcg-price-hunter.vercel.app:8443/produto/x']) {
    const r = audit({ canonical: c }); assert.deepEqual(rules(r), ['SEO-CANONICAL-HOST'], c);
    assert.ok(r.findings[0].evidencia.startsWith(`canonical=${c} `)); assert.match(r.findings[0].evidencia, /host esperado tcg-price-hunter\.vercel\.app/); rastreavel(r.findings[0]);
  }
});
t('canonical: site ausente ou inválido = abstenção, nunca achado contra host desconhecido', () => {
  for (const opts of [{}, { site: '' }, { site: 'nao-e-url' }, { site: 42 }]) {
    const r = audit({ canonical: 'https://outro.github.io/produto/x' }, {}, opts);
    assert.deepEqual(r.findings, [], JSON.stringify(opts)); assert.ok(r.abstencoes.includes('canonical: host do site não informado'), JSON.stringify(opts));
  }
  assert.deepEqual(rules(audit({ canonical: null }, {}, { site: 'nao-e-url' })), ['SEO-CANONICAL-AUSENTE'], 'ausência é observada sem precisar do host');
});
t('canonical em página não indexável: só o host é cobrado', () => {
  assert.deepEqual(rules(audit({ noindex: true, canonical: `${SITE}/outra` })), []);
  assert.deepEqual(rules(audit({ canonical: `${SITE}/outra` }, { status: 404 })), []);
  assert.deepEqual(rules(audit({ noindex: true, canonical: 'https://outro.github.io/x' })), ['SEO-CANONICAL-HOST']);
  assert.deepEqual(rules(audit({ canonical: `${SITE}/outra` }, { url: '' })), [], 'sem URL auditada não há o que comparar');
});

// ---- robots.txt e vercel.json ----
const V = (headers = [], rewrites = [{ source: '/', destination: '/api/pagina?t=home' }, { source: '/produto/:slug', destination: '/api/pagina?t=produto&slug=:slug' }, { source: '/api/:path*', destination: '/api/:path*' }]) => ({ rewrites, headers });
const NOIDX = (source) => ({ source, headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] });
t('robots: Disallow amplo aparece no inventário das rotas públicas (evidência para o revisor)', () => {
  const r = auditRoutes({ vercel: V(), robots: `User-agent: *\nDisallow: /\nSitemap: ${SITE}/sitemap.xml\n`, site: SITE });
  assert.deepEqual(r.rotas.map((x) => x.rota), ['/', '/produto/:slug'], 'só rewrites para /api/pagina');
  assert.ok(r.rotas.every((x) => x.robotsDisallow === true && x.noindexHeader === false));
  const livre = auditRoutes({ vercel: V(), robots: `User-agent: *\nDisallow:\nSitemap: ${SITE}/sitemap.xml\n`, site: SITE });
  assert.ok(livre.rotas.every((x) => !x.robotsDisallow), '"Disallow:" vazio libera tudo'); assert.deepEqual(livre.findings, []);
});
t('robots × noindex: Disallow em caminho com X-Robots-Tag noindex vira proposta baixa, citando os dois arquivos', () => {
  const r = auditRoutes({ vercel: V([NOIDX('/(conta|favoritos)')]), robots: `user-agent: *\nDISALLOW: /conta/\ndisallow: /lojas\nSITEMAP: ${SITE}/sitemap.xml\n`, site: SITE });
  assert.deepEqual(rules(r), ['SEO-ROBOTS-BLOQUEIA-NOINDEX']);
  const [f] = r.findings; assert.equal(f.severidade, 'baixa'); assert.equal(f.url, '/conta/'); assert.equal(f.file, 'robots.txt; vercel.json');
  assert.match(f.evidencia, /Disallow: \/conta\/.*\/\(conta\|favoritos\)/); assert.match(f.recomendacao, /^Proposta:/); rastreavel(f);
  assert.ok(r.rotas.every((x) => !x.noindexHeader));
  const pub = auditRoutes({ vercel: V([NOIDX('/produto/:slug')]), robots: `Sitemap: ${SITE}/sitemap.xml\n`, site: SITE });
  assert.equal(pub.rotas.find((x) => x.rota === '/produto/:slug').noindexHeader, true, 'rota pública com noindex aparece no inventário');
});
t('robots: fonte de rota que não dá para interpretar é ignorada (abstém-se), sem achado', () => {
  assert.equal(sourceRegex('/(conta'), null);
  assert.ok(sourceRegex('/api/:path*').test('/api/a/b')); assert.ok(sourceRegex('/produto/:slug').test('/produto/a')); assert.ok(!sourceRegex('/produto/:slug').test('/produto/a/b'));
  const r = auditRoutes({ vercel: V([NOIDX('/(conta')]), robots: `Disallow: /conta\nSitemap: ${SITE}/sitemap.xml\n`, site: SITE });
  assert.deepEqual(r.findings, []);
});
t('robots: Sitemap noutro host só é achado quando o host do site é conhecido', () => {
  const robots = 'Sitemap: https://x.github.io/sitemap.xml\n';
  assert.deepEqual(rules(auditRoutes({ vercel: V(), robots, site: SITE })), ['SEO-ROBOTS-SITEMAP-HOST']);
  for (const site of [undefined, '', 'nao-e-url']) {
    const r = auditRoutes({ vercel: V(), robots, site });
    assert.deepEqual(r.findings, [], String(site)); assert.equal(r.abstained, false); assert.deepEqual(r.abstencoes, ['host do site não informado']);
  }
  assert.deepEqual(rules(auditRoutes({ vercel: V(), robots: 'User-agent: *\n# Sitemap: comentado\n', site: SITE })), ['SEO-ROBOTS-SEM-SITEMAP'], 'linha comentada não declara sitemap');
  for (const [vercel, robots] of [[null, ''], [V(), null], ['{}', ''], [V(), 42]]) assert.equal(auditRoutes({ vercel, robots, site: SITE }).abstained, true);
});

// ---- Sitemap ----
t('sitemap: vazio, entidades, lastmod W3C e host desconhecido', () => {
  const vazio = auditSitemap('<?xml version="1.0"?><urlset></urlset>', { site: SITE });
  assert.deepEqual([vazio.abstained, vazio.urls, vazio.findings], [false, [], []]);
  const xml = `<urlset><url><loc>${SITE}/busca?a=1&amp;b=2</loc><lastmod>2026-10-13T15:30:26Z</lastmod></url><url><loc>${SITE}/x</loc><lastmod>2026-10-13T15:30:26+00:00</lastmod></url>`
    + `<url><loc>${SITE}/y</loc><lastmod>2026-13-45</lastmod></url><url><loc>${SITE}/z</loc><lastmod>13/10/2026</lastmod></url><url><loc>${SITE}/w</loc><lastmod></lastmod></url></urlset>`;
  const r = auditSitemap(xml, { site: SITE });
  assert.equal(r.urls[0], `${SITE}/busca?a=1&b=2`);
  assert.deepEqual(r.findings.map((f) => [f.regra, f.url]), [['SEO-SITEMAP-LASTMOD', `${SITE}/y`], ['SEO-SITEMAP-LASTMOD', `${SITE}/z`], ['SEO-SITEMAP-LASTMOD', `${SITE}/w`]], 'lastmod vazio também é inválido');
  r.findings.forEach(rastreavel);
  for (const site of [undefined, 'nao-e-url']) {
    const s = auditSitemap(`<urlset><url><loc>https://x.github.io/a</loc></url></urlset>`, { site });
    assert.deepEqual(s.findings, [], 'sem host conhecido não acusa host errado'); assert.deepEqual(s.abstencoes, ['host do site não informado']);
  }
});
t('sitemap: ausência de evidência em várias formas', () => {
  for (const x of [undefined, null, '', 42, {}, '<html></html>', '<sitemapindex></sitemapindex>']) {
    const r = auditSitemap(x, { site: SITE }); assert.equal(r.abstained, true); assert.deepEqual(r.findings, []); assert.match(r.abstencoes[0], /sem evidência/);
  }
});

// ---- Rastreabilidade: toda regra tem evidência; nenhuma recomendação sem evidência ----
t('todas as regras do módulo são exercitadas e todo achado é rastreável', () => {
  const src = fs.readFileSync(path.join(root, 'src/agents/seo-content.js'), 'utf8');
  const doModulo = [...new Set([...src.matchAll(/achado\('(SEO-[A-Z-]+)'/g)].map((m) => m[1]))].sort();
  const sm = `<urlset><url><loc>${SITE}/a</loc><lastmod>ontem</lastmod></url><url><loc>${SITE}/a</loc></url><url><loc>https://x.io/b</loc></url></urlset>`;
  const pages = [audit({ title: null, desc: null, canonical: null, ld: ['{x'] }), audit({ desc: 'a'.repeat(200) }), audit({ canonical: 'https://x.io/p' }),
    audit({ canonical: `${SITE}/outra` }), audit({}, { freshness: { status: 'desatualizado', ageMin: 120 } }), audit({ ssr: null }), audit({ noindex: true }, { inSitemap: true })];
  const routes = [auditRoutes({ vercel: V([NOIDX('/conta')]), robots: 'Disallow: /conta\n', site: SITE }), auditRoutes({ vercel: V(), robots: 'Sitemap: https://x.io/s.xml', site: SITE })];
  const all = [...pages, auditSitemap(sm, { site: SITE }), ...routes].flatMap((r) => r.findings);
  assert.deepEqual([...new Set(all.map((f) => f.regra))].sort(), doModulo, 'regra nova no módulo precisa de caso aqui');
  all.forEach(rastreavel);
  const doc = fs.readFileSync(path.join(root, 'docs/seo-content-agent.md'), 'utf8');
  for (const regra of doModulo) assert.ok(doc.includes(regra) || doc.includes('`-' + regra.split('-').slice(2).join('-') + '`'), `regra ${regra} sem documentação`);
});
t('abstenção total: relatório sem achados nem recomendações, com as abstenções rastreadas por origem', () => {
  const pages = [auditPage({ url: '/a', html: '' }), auditPage({ url: '/b' }), auditPage()];
  const r = report({ pages, sitemap: auditSitemap(null), routes: auditRoutes({}) });
  assert.deepEqual(r.findings, []); assert.deepEqual(r.porSeveridade, { alta: 0, media: 0, baixa: 0 });
  assert.ok(r.abstencoes.includes('rotas: sem evidência: vercel.json ou robots.txt não informado'));
  assert.ok(r.abstencoes.includes('sitemap: sem evidência: sitemap não informado'));
  assert.ok(r.abstencoes.includes('/a: sem evidência: HTML não informado') && r.abstencoes.includes('/b: sem evidência: HTML não informado'));
  assert.ok(r.inventario.paginas.every((p) => p.abstained === true && p.indexavel === null));
  const parcial = report({ sitemap: auditSitemap(`<urlset><url><loc>${SITE}/</loc></url></urlset>`), routes: auditRoutes({ vercel: V(), robots: 'Sitemap: x' }) });
  assert.ok(parcial.abstencoes.includes('sitemap: host do site não informado') && parcial.abstencoes.includes('rotas: host do site não informado'), 'abstenção parcial não some do relatório');
});

// ---- Limite de escrita e gate ----
const allOk = () => Object.fromEntries(PREREQUISITOS.map((p) => [p.id, { ok: true, ref: ['docs/x.md'] }]));
t('entradas congeladas: o auditor não altera HTML, frescor, vercel.json, evidências nem achados recebidos', () => {
  const vercel = deepFreeze(JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8')));
  const robots = fs.readFileSync(path.join(root, 'robots.txt'), 'utf8');
  const pg = deepFreeze({ url: '/produto/x', file: 'api/pagina.mjs', html: html({ title: null, desc: 'a'.repeat(200) }), freshness: { status: 'desatualizado', ageMin: 400 }, inSitemap: true });
  const ev = deepFreeze(allOk()); const opts = deepFreeze({ site: SITE });
  const run = () => {
    const pages = deepFreeze([auditPage(pg, opts), auditPage(deepFreeze({ url: '/v', html: '' }), opts)]);
    const sitemap = deepFreeze(auditSitemap(`<urlset><url><loc>${SITE}/a</loc></url><url><loc>${SITE}/a</loc></url></urlset>`, opts));
    const routes = deepFreeze(auditRoutes(deepFreeze({ vercel, robots, site: SITE })));
    return report(deepFreeze({ readiness: deepFreeze(readiness(ev, deepFreeze({ authorized: false }))), pages, sitemap, routes, geradoEm: '2026-10-13T00:00:00Z' }));
  };
  const a = run(); const b = run();
  assert.deepEqual(a, b, 'determinístico para a mesma entrada');
  assert.ok(a.findings.length >= 3); assert.equal(a.enabled, false); assert.equal(a.publica, false); assert.equal(a.modo, 'somente-leitura');
});
t('gate falha fechado: report não liga com prontidão forjada, incompleta ou sem autorização', () => {
  for (const rd of [{ enabled: true }, { enabled: 'true', status: 'pronto', bloqueios: [] }, { enabled: true, status: 'pronto', bloqueios: ['search-console'] },
    { enabled: true, status: 'bloqueado', bloqueios: [] }, { enabled: true, status: 'pronto' }, readiness(allOk()), readiness(allOk(), { authorized: 1 }), readiness({}, { authorized: true }), null]) {
    assert.equal(report({ readiness: rd }).enabled, false, JSON.stringify(rd));
  }
  assert.equal(report({ readiness: readiness(allOk(), { authorized: true }) }).enabled, true, 'só o gate pronto + autorização explícita liga');
  const ev = allOk(); ev.authorized = true; ev.enabled = true; ev['search-console'] = { ok: true, ref: [42, null, {}] };
  const r = readiness(ev);
  assert.equal(r.enabled, false); assert.deepEqual(r.bloqueios, ['search-console'], 'campos extras não autorizam e referência não textual não comprova');
});
t('superfície do módulo: só leitura/auditoria, nada que publique ou escreva', () => {
  assert.deepEqual(Object.keys(agente).sort(), ['DESC_MAX', 'PREREQUISITOS', 'SEO_AGENT_ENABLED_DEFAULT', 'SEVERIDADES', 'auditPage', 'auditRoutes', 'auditSitemap', 'parsePage', 'readiness', 'report', 'sourceRegex'],
    'export novo no agente exige revisão do limite de escrita (issue #607)');
  assert.ok(Object.isFrozen(PREREQUISITOS));
  const src = fs.readFileSync(path.join(root, 'src/agents/seo-content.js'), 'utf8');
  assert.ok(!/\b(process|globalThis|localStorage|document|window|XMLHttpRequest|WebSocket|eval|Function)\b\s*[.(\[]/.test(src), 'sem ambiente, rede ou eval');
});

// ---- CLI: offline, sem escrita fora de --out e sem ligar o agente ----
const hash = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex');
const VIGIADOS = ['index.html', 'robots.txt', 'vercel.json', 'docs/seo-content-readiness.json', 'docs/seo-content-agent.md', 'api/pagina.mjs', 'api/sitemap.mjs', 'api/_seo.mjs', 'src/agents/seo-content.js'];
function cli(args, env = {}) {
  const r = spawnSync(process.execPath, [path.join(root, 'tools/seo-audit.mjs'), ...args], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, API_DATABASE_URL: '', ...env } });
  if (r.status !== 0) throw new Error(`seo-audit falhou (${r.status}): ${r.stderr}`);
  return r;
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-hardening-'));
try {
  t('CLI: evidência completa não liga o agente; sem arquivo de evidência tudo bloqueado; só escreve em --out', () => {
    const antes = Object.fromEntries(VIGIADOS.map((f) => [f, hash(f)])); const raiz = fs.readdirSync(root).sort();
    const evPath = path.join(tmp, 'ev.json'); fs.writeFileSync(evPath, JSON.stringify(allOk()));
    const out = path.join(tmp, 'rel.json');
    const r1 = cli(['--evidencia', evPath, '--out', out], { API_DATABASE_URL: 'postgres://seo-audit@127.0.0.1:1/nao-usar' });
    assert.equal(r1.stdout, '', 'com --out nada vai para o stdout'); assert.match(r1.stderr, /agente desativado; prontidão pronto \(0 bloqueio/);
    const rep = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(rep.prontidao.status, 'pronto'); assert.equal(rep.enabled, false, 'a CLI nunca passa authorized'); assert.equal(rep.publica, false);
    assert.notEqual(rep.fonte.frescor, 'atual'); rep.findings.forEach(rastreavel);
    const r2 = JSON.parse(cli(['--evidencia', path.join(tmp, 'nao-existe.json')]).stdout);
    assert.equal(r2.enabled, false); assert.equal(r2.prontidao.bloqueios.length, PREREQUISITOS.length);
    assert.deepEqual(fs.readdirSync(tmp).sort(), ['ev.json', 'rel.json']);
    assert.deepEqual(Object.fromEntries(VIGIADOS.map((f) => [f, hash(f)])), antes, 'a CLI não altera páginas, configuração nem evidências');
    assert.deepEqual(fs.readdirSync(root).sort(), raiz, 'a CLI não cria arquivo no repositório');
  });
  t('CLI: a única escrita em disco é a do --out', () => {
    const src = fs.readFileSync(path.join(root, 'tools/seo-audit.mjs'), 'utf8');
    const escritas = src.match(/\b(writeFileSync|appendFileSync|writeFile|appendFile|createWriteStream|rmSync|unlinkSync|renameSync|mkdirSync|copyFileSync)\b/g) || [];
    assert.deepEqual(escritas, ['writeFileSync']); assert.match(src, /if \(arg\('--out'\)\) fs\.writeFileSync\(path\.resolve\(arg\('--out'\)\)/);
  });
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }

console.log(`seo-content-hardening: ${n} testes ok`);
