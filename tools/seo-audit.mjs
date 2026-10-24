// SEO & Content Agent — inventário técnico SOMENTE LEITURA (issue #594). Renderiza localmente o sitemap e cada página
// listada nele pelas próprias funções do site (api/sitemap.mjs, api/pagina.mjs), sem rede e sem banco, e audita com
// src/agents/seo-content.js. Não publica, não altera página nem configuração; o agente fica desativado (gate de prontidão).
// Uso: node tools/seo-audit.mjs [--state state.json] [--agora 2026-10-13T12:00:00Z] [--evidencia docs/seo-content-readiness.json] [--out relatorio.json]
//  --state: state.json local (por exemplo, baixado do ramo data); sem ele, o render simula dados indisponíveis.
//  --agora: fixa o relógio do frescor (útil para auditar um state.json antigo como se fosse da hora em que foi gerado).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readiness, auditPage, auditSitemap, auditRoutes, report } from '../src/agents/seo-content.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };

// Converte a URL do sitemap na chamada de /api/pagina pelos rewrites do vercel.json (mesma regra da Vercel: vale o
// primeiro rewrite que casa; se ele não for /api/pagina, a rota não é página SSR e volta null).
export function toQuery(pathname, rewrites) {
  for (const r of rewrites || []) {
    const names = [];
    const re = new RegExp('^' + String(r.source).replace(/:([A-Za-z_]\w*)/g, (_, n) => { names.push(n); return '([^/]+)'; }) + '$');
    const m = pathname.match(re); if (!m) continue;
    if (!String(r.destination || '').startsWith('/api/pagina')) return null;
    let d = r.destination; names.forEach((n, i) => { d = d.replace(':' + n, m[i + 1]); });
    return d;
  }
  return null;
}

export async function run({ statePath, agora, evidenciaPath = path.join(root, 'docs/seo-content-readiness.json') } = {}) {
  // Offline e só leitura: sem banco (a API cai no state.json) e sem rede (fetch local).
  delete process.env.API_DATABASE_URL;
  process.chdir(root);                                   // api/pagina.mjs lê o index.html do diretório atual
  const st = statePath ? JSON.parse(fs.readFileSync(path.resolve(statePath), 'utf8')) : null;
  globalThis.fetch = async () => { if (!st) throw new TypeError('rede desativada na auditoria offline'); return new Response(JSON.stringify(st), { status: 200 }); };
  const fresh = await import(pathToFileURL(path.join(root, 'api/_lib/freshness.mjs')).href);
  if (agora) { const t = Date.parse(agora); if (!Number.isFinite(t)) throw new Error('--agora inválido'); fresh.setFreshnessClock(() => t); }
  const { SITE } = await import(pathToFileURL(path.join(root, 'api/_seo.mjs')).href);
  const { default: pagina } = await import(pathToFileURL(path.join(root, 'api/pagina.mjs')).href);
  const { default: sitemap } = await import(pathToFileURL(path.join(root, 'api/sitemap.mjs')).href);

  const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  const robots = fs.readFileSync(path.join(root, 'robots.txt'), 'utf8');
  let evidencia = {};
  try { evidencia = JSON.parse(fs.readFileSync(evidenciaPath, 'utf8')); } catch { evidencia = {}; }   // sem arquivo: tudo bloqueado

  const res = () => ({ statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } });
  const sm = res(); await sitemap({}, sm);
  const sAudit = auditSitemap(sm.body, { site: SITE });
  const freshness = st ? fresh.classify(fresh.stateDataAt(st)) : fresh.classify(null);
  const pages = [];
  for (const u of sAudit.urls) {
    const pathname = new URL(u).pathname.replace(/(.)\/$/, '$1');
    const q = toQuery(pathname, vercel.rewrites);
    if (!q) { pages.push({ url: u, file: 'vercel.json', abstained: true, abstencoes: ['sem evidência: rota sem rewrite para /api/pagina'], indexavel: null, findings: [] }); continue; }
    const r = res(); await pagina({ url: q, headers: { host: new URL(SITE).host } }, r);
    pages.push(auditPage({ url: u, file: 'api/pagina.mjs', html: r.body, status: r.statusCode, freshness, inSitemap: true }, { site: SITE }));
  }
  const rep = report({ readiness: readiness(evidencia), pages, sitemap: sAudit, routes: auditRoutes({ vercel, robots, site: SITE }), geradoEm: new Date().toISOString() });
  return { ...rep, fonte: { render: 'local offline (api/pagina.mjs, api/sitemap.mjs)', state: statePath ? path.basename(statePath) : null, frescor: freshness.status } };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const out = await run({ statePath: arg('--state'), agora: arg('--agora'), evidenciaPath: arg('--evidencia') ? path.resolve(arg('--evidencia')) : undefined });
  const json = JSON.stringify(out, null, 2) + '\n';
  if (arg('--out')) fs.writeFileSync(path.resolve(arg('--out')), json); else process.stdout.write(json);
  process.stderr.write(`SEO & Content (somente leitura): agente ${out.enabled ? 'LIGADO' : 'desativado'}; prontidão ${out.prontidao.status} (${out.prontidao.bloqueios.length} bloqueio(s)); `
    + `${out.findings.length} achado(s): ${out.porSeveridade.alta} alta, ${out.porSeveridade.media} média, ${out.porSeveridade.baixa} baixa; frescor do render: ${out.fonte.frescor}.\n`);
}
