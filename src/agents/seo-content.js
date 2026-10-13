// SEO & Content Agent — MVP SOMENTE LEITURA (issue #594). Desativado por padrão.
// Não é handler do orquestrador, não publica, não escreve arquivo, não acessa rede nem banco: recebe HTML, sitemap,
// vercel.json e robots.txt já lidos e devolve achados com evidência (URL/arquivo), severidade e recomendação.
// Sem evidência, abstém-se (registra a abstenção e não recomenda nada). Ver docs/seo-content-agent.md.

export const SEO_AGENT_ENABLED_DEFAULT = false;
export const DESC_MAX = 160;                       // mesmo limite de api/pagina.mjs (fitDesc)
export const SEVERIDADES = ['alta', 'media', 'baixa'];
const PESO = { alta: 0, media: 1, baixa: 2 };
const FRESCOR = new Set(['atual', 'atrasado', 'desatualizado', 'indisponivel']);   // estados de classify() (api/_lib/freshness.mjs)

// Pré-requisitos do agente (docs/MAPA-DE-AGENTES.md §4.4, docs/PLANO-ENTREGA-TURBO.md agente 14 e Fase 8, issue #594).
export const PREREQUISITOS = Object.freeze([
  { id: 'base-tecnica-estavel', titulo: 'Base técnica estável (burn-in de 7 dias verdes)' },
  { id: 'analytics-consentido', titulo: 'Analytics legítimo/consentido com acesso autorizado aos dados' },
  { id: 'search-console', titulo: 'Search Console verificado e autorizado' },
  { id: 'politica-conteudo', titulo: 'Política de conteúdo/editorial e critérios de qualidade aprovados' },
  { id: 'fonte-canonica', titulo: 'Fonte canônica de produção documentada' },
  { id: 'seo-tecnico-base', titulo: 'Sitemap, canonical e metadados gerados pelo servidor' },
  { id: 'frescor-conteudo', titulo: 'Conteúdo real com frescor verificável' },
  { id: 'testes-indexabilidade', titulo: 'Testes de renderização/indexabilidade' },
]);

const refs = (r) => (Array.isArray(r) ? r : [r]).filter((x) => typeof x === 'string' && x.trim());
// Entrada malformada (null, array, string) equivale a ausente: o auditor se abstém em vez de lançar (issue #613).
const obj = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? o : {});
const list = (x) => (Array.isArray(x) ? x.filter((e) => e && typeof e === 'object' && !Array.isArray(e)) : []);
const str = (x) => (typeof x === 'string' ? x : '');

/** Gate de prontidão. Cada pré-requisito só é "comprovado" com ok === true E referência (arquivo/URL).
 *  Ausência de evidência é bloqueio. Mesmo com tudo comprovado, só liga com autorização explícita (authorized: true). */
export function readiness(evidencia = {}, opts = {}) {
  const { authorized = false } = obj(opts);
  const ev = evidencia && typeof evidencia === 'object' ? evidencia : {};
  const items = PREREQUISITOS.map((p) => {
    const e = ev[p.id];
    if (!e || typeof e !== 'object' || !refs(e.ref).length) return { ...p, status: 'bloqueado', motivo: 'sem evidência', ref: [], nota: e?.nota || '' };
    if (e.ok !== true) return { ...p, status: 'bloqueado', motivo: 'evidência negativa', ref: refs(e.ref), nota: e.nota || '' };
    return { ...p, status: 'comprovado', motivo: '', ref: refs(e.ref), nota: e.nota || '' };
  });
  const bloqueios = items.filter((i) => i.status !== 'comprovado').map((i) => i.id);
  const pronto = bloqueios.length === 0;
  return { status: pronto ? 'pronto' : 'bloqueado', enabled: SEO_AGENT_ENABLED_DEFAULT || (pronto && authorized === true), bloqueios, items };
}

const achado = (regra, severidade, { url = '', file = '', evidencia = '', recomendacao = '' }) => ({ regra, severidade, url, file, evidencia, recomendacao });
const pick = (h, re) => { const m = h.match(re); return m ? m[1] : null; };
const unesc = (s) => String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const cut = (s, n = 120) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const hostOf = (u) => { try { return new URL(u).host; } catch { return null; } };
const abs = (u, site) => { try { return new URL(u, site).href; } catch { return null; } };

/** Lê do HTML os sinais de SEO (mesmas marcas que api/pagina.mjs escreve). */
export function parsePage(html) {
  const h = String(html || '');
  const title = pick(h, /<title>([^<]*)<\/title>/);
  const desc = pick(h, /<meta name="description" content="([^"]*)">/);
  const canonical = pick(h, /<link rel="canonical" href="([^"]*)">/);
  const noindex = /<meta name="robots" content="[^"]*noindex[^"]*">/i.test(h);
  const ssr = pick(h, /<div class="ssr">([\s\S]*?)<\/div><\/div>/);
  const ld = [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  return { title: title == null ? null : unesc(title).trim(), desc: desc == null ? null : unesc(desc), canonical: canonical == null ? null : unesc(canonical), noindex, ssr, ld };
}

/** Audita uma página renderizada. page = { url, file, html, status, freshness, inSitemap }; opts = { site }.
 *  freshness = saída de classify() (api/_lib/freshness.mjs) ou null quando não se sabe (abstém-se das regras de frescor). */
export function auditPage(entrada, opts) {
  const page = obj(entrada); const { site } = obj(opts);
  const url = String(page.url || ''); const file = String(page.file || '');
  if (typeof page.html !== 'string' || !page.html.trim()) return { url, file, abstained: true, abstencoes: ['sem evidência: HTML não informado'], indexavel: null, findings: [] };
  const p = parsePage(page.html);
  const status = page.status ?? 200;
  const indexavel = status === 200 && !p.noindex;
  // Frescor sem um estado conhecido não é evidência: abstém-se em vez de tratá-lo como desatualizado.
  const fr = page.freshness && typeof page.freshness === 'object' && FRESCOR.has(page.freshness.status) ? page.freshness : null;
  const usable = fr ? fr.status === 'atual' || fr.status === 'atrasado' : null;
  const temSsr = !!(p.ssr && p.ssr.replace(/<[^>]*>/g, '').trim());
  const at = { url, file };
  const f = []; const abstencoes = [];
  const sh = site ? hostOf(site) : null;               // site inválido equivale a não informado: sem host, não há o que comparar
  if (!sh) abstencoes.push('canonical: host do site não informado');
  if (!fr) abstencoes.push('frescor: sem evidência');

  if (indexavel) {
    if (!p.title) f.push(achado('SEO-TITULO', 'alta', { ...at, evidencia: '<title> ausente ou vazio', recomendacao: 'Gerar título único no SSR (api/pagina.mjs build) para esta rota.' }));
    if (p.desc == null || !p.desc.trim()) f.push(achado('SEO-DESCRICAO', 'media', { ...at, evidencia: 'meta description ausente ou vazia', recomendacao: 'Gerar meta description a partir de dados reais da página (até 160 caracteres).' }));
    else if (p.desc.length > DESC_MAX) f.push(achado('SEO-DESCRICAO-LONGA', 'baixa', { ...at, evidencia: `meta description com ${p.desc.length} caracteres: "${cut(p.desc)}"`, recomendacao: `Reduzir para até ${DESC_MAX} caracteres sem cortar informação essencial (usar fitDesc).` }));
    if (!p.canonical) f.push(achado('SEO-CANONICAL-AUSENTE', 'alta', { ...at, evidencia: '<link rel="canonical"> ausente em página indexável', recomendacao: 'Emitir canonical absoluto para a própria URL ou marcar a página como noindex.' }));
  }
  if (p.canonical && sh) {
    const ch = hostOf(p.canonical);
    if (ch !== sh) f.push(achado('SEO-CANONICAL-HOST', 'alta', { ...at, evidencia: `canonical=${p.canonical} (host esperado ${sh})`, recomendacao: 'Apontar o canonical para o host canônico do site (SITE em api/_seo.mjs).' }));
    else if (url && indexavel) {
      const want = abs(url, site); const got = abs(p.canonical, site);
      if (want && got && want !== got) f.push(achado('SEO-CANONICAL-URL', 'alta', { ...at, evidencia: `canonical=${p.canonical}; URL auditada=${want}`, recomendacao: 'Canonical deve ser a própria URL (ou noindex, se for duplicata).' }));
    }
  }
  if (p.noindex && page.inSitemap === true) f.push(achado('SEO-NOINDEX-NO-SITEMAP', 'media', { ...at, evidencia: 'página com <meta name="robots" content="noindex"> listada no sitemap.xml', recomendacao: 'Alinhar sitemap e página: tirar do sitemap enquanto for noindex, ou servir a página indexável com conteúdo próprio.' }));
  if (indexavel && fr && !usable && temSsr) f.push(achado('SEO-DADOS-DESATUALIZADOS', 'alta', { ...at, evidencia: `frescor=${fr.status}${fr.ageMin != null ? ` (${fr.ageMin} min)` : ''} com conteúdo de dados no HTML indexável`, recomendacao: 'Não servir preço/estoque desatualizado como indexável: noindex ou sem conteúdo de dados até o frescor voltar.' }));
  if (indexavel && !temSsr && usable !== false) f.push(achado('SEO-CONTEUDO-VAZIO', 'media', { ...at, evidencia: 'página indexável sem conteúdo pré-renderizado (<div class="ssr"> vazio ou ausente)', recomendacao: 'Renderizar conteúdo real no servidor ou marcar noindex; não criar texto sem dado verificável.' }));
  p.ld.forEach((raw, i) => { try { JSON.parse(raw); } catch { f.push(achado('SEO-JSONLD-INVALIDO', 'media', { ...at, evidencia: `bloco JSON-LD #${i + 1} não é JSON válido`, recomendacao: 'Corrigir a serialização do JSON-LD (ld() em api/pagina.mjs).' })); } });
  return { url, file, abstained: false, abstencoes, indexavel, findings: f };
}

/** Audita o sitemap.xml. Sem XML, abstém-se. */
export function auditSitemap(xml, opts) {
  const { site, file = 'api/sitemap.mjs' } = obj(opts);
  if (typeof xml !== 'string' || !xml.includes('<urlset')) return { urls: [], abstained: true, abstencoes: ['sem evidência: sitemap não informado'], findings: [] };
  const entries = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => ({ loc: unesc(pick(m[1], /<loc>([^<]*)<\/loc>/) || ''), lastmod: pick(m[1], /<lastmod>([^<]*)<\/lastmod>/) }));
  const f = []; const seen = new Set(); const sh = site ? hostOf(site) : null;
  for (const e of entries) {
    if (sh && hostOf(e.loc) !== sh) f.push(achado('SEO-SITEMAP-HOST', 'alta', { url: e.loc, file, evidencia: `<loc>${e.loc}</loc> fora do host ${sh}`, recomendacao: 'Listar só URLs do host canônico.' }));
    if (seen.has(e.loc)) f.push(achado('SEO-SITEMAP-DUPLICADA', 'media', { url: e.loc, file, evidencia: `<loc>${e.loc}</loc> repetida`, recomendacao: 'Cada URL uma única vez no sitemap.' }));
    seen.add(e.loc);
    if (e.lastmod != null && !(/^\d{4}-\d{2}-\d{2}/.test(e.lastmod) && Number.isFinite(Date.parse(e.lastmod)))) f.push(achado('SEO-SITEMAP-LASTMOD', 'baixa', { url: e.loc, file, evidencia: `<lastmod>${e.lastmod}</lastmod> inválido`, recomendacao: 'lastmod em data W3C (AAAA-MM-DD) vinda de dado real.' }));
  }
  return { urls: entries.map((e) => e.loc), abstained: false, abstencoes: sh ? [] : ['host do site não informado'], findings: f };
}

// Fonte de rota do vercel.json ("/(a|b)", "/produto/:slug") → RegExp. Fonte que não dá para interpretar: null (abstém-se).
export function sourceRegex(src) {
  try { return new RegExp('^' + String(src).replace(/:([A-Za-z_]\w*)\*/g, '(?:.*)').replace(/:([A-Za-z_]\w*)/g, '[^/]+') + '$'); } catch { return null; }
}

/** Inventário de rotas públicas (rewrites → /api/pagina) e checagem robots.txt × X-Robots-Tag do vercel.json. */
export function auditRoutes(entrada) {
  const { vercel, robots, site } = obj(entrada);
  if (!vercel || typeof vercel !== 'object' || Array.isArray(vercel) || typeof robots !== 'string') return { rotas: [], abstained: true, abstencoes: ['sem evidência: vercel.json ou robots.txt não informado'], findings: [] };
  const f = []; const sh = site ? hostOf(site) : null;
  const noindexSrc = list(vercel.headers).filter((h) => typeof h.source === 'string' && list(h.headers).some((x) => /^x-robots-tag$/i.test(x.key) && /noindex/i.test(x.value))).map((h) => h.source);
  const noindexRe = noindexSrc.map((s) => [s, sourceRegex(s)]).filter(([, r]) => r);
  const disallow = robots.split('\n').map((l) => l.trim()).filter((l) => /^disallow:/i.test(l)).map((l) => l.slice(9).trim()).filter(Boolean);
  const sitemapLine = robots.split('\n').map((l) => l.trim()).find((l) => /^sitemap:/i.test(l));
  const rotas = list(vercel.rewrites).filter((r) => typeof r.source === 'string' && String(r.destination || '').startsWith('/api/pagina')).map((r) => ({
    rota: r.source, destino: r.destination, noindexHeader: noindexRe.some(([, re]) => re.test(r.source)), robotsDisallow: disallow.some((d) => r.source.startsWith(d)) }));
  for (const d of disallow) {
    const path = d.replace(/\/$/, '');
    const hit = noindexRe.find(([, re]) => re.test(path));
    if (hit) f.push(achado('SEO-ROBOTS-BLOQUEIA-NOINDEX', 'baixa', { url: d, file: 'robots.txt; vercel.json', evidencia: `robots.txt "Disallow: ${d}" e vercel.json X-Robots-Tag noindex em "${hit[0]}"`,
      recomendacao: 'Proposta: robô bloqueado pelo robots.txt não lê o noindex; se o objetivo for tirar a URL do índice, permitir o rastreamento e manter o noindex. Se for só poupar rastreamento, manter.' }));
  }
  if (!sitemapLine) f.push(achado('SEO-ROBOTS-SEM-SITEMAP', 'media', { url: '/robots.txt', file: 'robots.txt', evidencia: 'robots.txt sem linha Sitemap:', recomendacao: 'Declarar o sitemap.xml do host canônico.' }));
  else if (sh && hostOf(sitemapLine.slice(8).trim()) !== sh) f.push(achado('SEO-ROBOTS-SITEMAP-HOST', 'alta', { url: '/robots.txt', file: 'robots.txt', evidencia: sitemapLine, recomendacao: 'Sitemap no host canônico.' }));
  return { rotas, abstained: false, abstencoes: sh ? [] : ['host do site não informado'], findings: f };
}

// Achado só entra no relatório com regra, severidade conhecida, URL ou arquivo, evidência e recomendação (issue #613).
const rastreavel = (f) => !!(str(f.regra).trim() && SEVERIDADES.includes(f.severidade) && (str(f.url).trim() || str(f.file).trim())
  && str(f.evidencia).trim() && str(f.recomendacao).trim());

/** Relatório consolidado. Nunca liga o agente: enabled vem só do gate de prontidão, e falha fechado se o gate
 *  recebido não estiver pronto (um objeto { enabled: true } sem prontidão comprovada não liga nada).
 *  Achado sem evidência rastreável é descartado (vira abstenção); os aceitos saem só com os campos do contrato. */
export function report(entrada) {
  const { readiness: rd, sitemap: sm, routes: rt, geradoEm = null } = obj(entrada);
  const pages = list(obj(entrada).pages); const sitemap = obj(sm); const routes = obj(rt);
  const recebidos = [...list(routes.findings), ...list(sitemap.findings), ...pages.flatMap((p) => list(p.findings))];
  const descartados = recebidos.filter((f) => !rastreavel(f)).map((f) => `achado descartado sem evidência rastreável: ${cut(str(f.regra) || '(sem regra)', 60)}`);
  const findings = recebidos.filter(rastreavel).map((f) => achado(f.regra, f.severidade, { url: str(f.url), file: str(f.file), evidencia: f.evidencia, recomendacao: f.recomendacao }))
    .sort((a, b) => PESO[a.severidade] - PESO[b.severidade] || a.regra.localeCompare(b.regra) || a.url.localeCompare(b.url));
  const porSeveridade = Object.fromEntries(SEVERIDADES.map((s) => [s, findings.filter((x) => x.severidade === s).length]));
  const gateOk = rd?.enabled === true && rd.status === 'pronto' && Array.isArray(rd.bloqueios) && rd.bloqueios.length === 0;
  const textos = (x) => (Array.isArray(x) ? x.filter((a) => typeof a === 'string') : []);
  const abstencoes = [...textos(routes.abstencoes).map((a) => `rotas: ${a}`), ...textos(sitemap.abstencoes).map((a) => `sitemap: ${a}`),
    ...pages.flatMap((p) => textos(p.abstencoes).map((a) => `${p.url || p.file}: ${a}`)), ...descartados];
  return {
    agente: 'seo-content', modo: 'somente-leitura', publica: false, geradoEm,
    enabled: gateOk, prontidao: rd || readiness({}),
    inventario: { rotas: list(routes.rotas), sitemap: textos(sitemap.urls), paginas: pages.map((p) => ({ url: p.url, file: p.file, indexavel: p.indexavel, abstained: p.abstained })) },
    porSeveridade, findings, abstencoes,
  };
}
