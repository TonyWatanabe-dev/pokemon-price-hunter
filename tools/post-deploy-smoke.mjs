// Smoke pós-deploy público e somente leitura (Fase 8): busca, detalhe de produto, API/dados, links internos e assets
// com cache imutável no domínio canônico (Vercel). Só faz GET no próprio domínio; nunca segue links para lojas.
// As checagens ficam em runPostDeploySmoke(get) para o teste offline (test/post-deploy-smoke-tests.js) rodar o mesmo
// contrato contra os handlers locais; executado direto (workflow seo-public-smoke.yml), consulta o site público.
// Frescor: o smoke confere o deploy, não o robô. Dados velhos (status fora de atual/atrasado) não reprovam; nesse caso
// a página de produto sai sem conteúdo pré-renderizado e só se exige HTTP 200 (o burn-in #271 cuida do frescor).
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { SITE, fetchPublic } from './seo-public-smoke.mjs';

export const SITE_PAGES = Object.freeze(['copag', 'pistas', 'prevenda', 'lojas']);
export const MAX_LINKS = 25;
const FRESH = new Set(['atual', 'atrasado']);
const KNOWN = new Set(['atual', 'atrasado', 'desatualizado']);

const json = (r, what) => {
  assert.equal(r.response.status, 200, `${what} precisa responder HTTP 200 (veio ${r.response.status})`);
  assert.match(r.response.headers.get('content-type') || '', /application\/json/i, `${what} precisa responder JSON`);
  try { return JSON.parse(r.body); } catch { assert.fail(`${what} devolveu JSON inválido`); }
};
const html = (r, what) => {
  assert.equal(r.response.status, 200, `${what} precisa responder HTTP 200 (veio ${r.response.status})`);
  assert.match(r.response.headers.get('content-type') || '', /text\/html/i, `${what} precisa responder HTML`);
  return r.body;
};
// Links internos de uma página: href="/..." do próprio site, sem API, Firebase, âncoras e query.
export function internalLinks(body) {
  const out = new Set();
  for (const m of String(body).matchAll(/href=["'](\/[^"'#?\s]*)["']/gi)) {
    const p = m[1];
    if (p.startsWith('//') || /^\/(api|__|_vercel|data)\//.test(p) || /^\/assets\//.test(p) || /\.(css|js|png|jpg|webp|woff2?|ico|json|xml|txt)$/i.test(p)) continue;
    out.add(p);
  }
  return [...out];
}
// Amostra dos links: todas as páginas de primeiro nível (menu e rodapé) e até 2 de cada família (/colecao/, /tipo/,
// /produto/...), na ordem da página, até o teto. Cobre cada tipo de rota sem varrer o catálogo inteiro.
export function sampleLinks(links, max = MAX_LINKS) {
  const top = links.filter((l) => l.split('/').filter(Boolean).length <= 1);
  const per = new Map(); const deep = [];
  for (const l of links) {
    if (top.includes(l)) continue;
    const fam = l.split('/')[1]; const n = per.get(fam) || 0;
    if (n < 2) { per.set(fam, n + 1); deep.push(l); }
  }
  return [...top, ...deep].slice(0, max);
}
export const assetRefs =(body) => [...new Set([...String(body).matchAll(/["'](\/assets\/web\/[^"'?#\s]+)["']/g)].map((m) => m[1]))];

export async function runPostDeploySmoke(get = fetchPublic, { maxLinks = MAX_LINKS } = {}) {
  const report = {};

  // 1) API/dados: Home da API com frescor declarado no corpo e no cabeçalho.
  const homeApi = await get('/api/v1/home');
  const home = json(homeApi, '/api/v1/home');
  const fresh = home.freshness?.status;
  assert.ok(KNOWN.has(fresh), `/api/v1/home precisa declarar freshness.status (veio ${fresh})`);
  assert.equal(homeApi.response.headers.get('x-data-freshness'), fresh, '/api/v1/home precisa enviar X-Data-Freshness igual ao corpo');
  report.freshness = fresh;

  // 2) Dados das páginas /precos, /pistas, /pre-vendas e /lojas.
  for (const p of SITE_PAGES) {
    const d = json(await get('/api/v1/site/pagina/' + p), '/api/v1/site/pagina/' + p);
    assert.equal(d.v, 1, `/api/v1/site/pagina/${p} precisa trazer v: 1`);
  }

  // 3) Um produto com estoque, pela API pública de listagem.
  const list = json(await get('/api/v1/produtos?limite=1&estoque=1'), '/api/v1/produtos');
  const prod = list.data?.[0];
  assert.ok(prod?.id && prod?.slug && prod?.name, '/api/v1/produtos precisa listar ao menos um produto com estoque (id, slug, nome)');
  report.produto = prod.slug;

  // 4) Busca: a mesma do site (lista filtrada por nome + ofertas candidatas do produto achado).
  const term = String(prod.name).split(/\s+/).find((w) => w.length >= 4) || String(prod.name).split(/\s+/)[0];
  const found = json(await get('/api/v1/produtos?limite=50&busca=' + encodeURIComponent(term)), '/api/v1/produtos?busca');
  assert.ok((found.data || []).some((x) => x.id === prod.id), `busca por "${term}" precisa achar ${prod.id}`);
  const offers = json(await get(`/api/v1/site/ofertas?busca=${encodeURIComponent(term)}&produtos=${encodeURIComponent(prod.id)}`), '/api/v1/site/ofertas?busca');
  assert.ok((offers.products || []).some((x) => x.id === prod.id), '/api/v1/site/ofertas precisa devolver o produto buscado');
  assert.ok(Array.isArray(offers.offers), '/api/v1/site/ofertas precisa devolver a lista de ofertas');
  report.busca = term;

  // 5) Detalhe: dados da página do produto e a página em si.
  const det = json(await get('/api/v1/site/produto/' + encodeURIComponent(prod.slug)), '/api/v1/site/produto/:slug');
  assert.equal(det.v, 1, '/api/v1/site/produto/:slug precisa trazer v: 1');
  const page = html(await get('/produto/' + prod.slug), '/produto/:slug');
  if (FRESH.has(fresh)) {
    const canon = SITE + '/produto/' + prod.slug;
    assert.ok(page.includes(`<link rel="canonical" href="${canon}">`), `/produto/${prod.slug} precisa declarar canonical ${canon}`);
    assert.match(page, /<div class="ssr">/, `/produto/${prod.slug} precisa trazer o conteúdo pré-renderizado`);
  }

  // 6) Assets da casca (/assets/web): HTTP 200 e Cache-Control imutável de 1 ano.
  const homePage = html(await get('/'), 'Home');
  const assets = assetRefs(homePage);
  assert.ok(assets.some((a) => /\/app-[0-9a-f]{12}\.(css|js)$/.test(a)), 'Home precisa referenciar CSS/JS da casca em /assets/web com hash');
  for (const a of assets) {
    const r = await get(a);
    assert.equal(r.response.status, 200, `${a} precisa responder HTTP 200`);
    const cc = r.response.headers.get('cache-control') || '';
    assert.match(cc, /\bimmutable\b/, `${a} precisa ter Cache-Control immutable (veio "${cc}")`);
    assert.match(cc, /\bmax-age=31536000\b/, `${a} precisa ter max-age=31536000 (veio "${cc}")`);
  }
  report.assets = assets.length;

  // 7) Links internos da Home e da página de produto (amostra por família de rota): todos abrem (200).
  const links = sampleLinks([...new Set([...internalLinks(homePage), ...internalLinks(page)])], maxLinks);
  assert.ok(links.length >= 3, 'Home precisa ter links internos de navegação');
  for (const l of links) {
    const r = await get(l);
    assert.equal(r.response.status, 200, `link interno ${l} precisa responder HTTP 200 (veio ${r.response.status})`);
  }
  report.links = links.length;
  return report;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const r = await runPostDeploySmoke();
  console.log(`Post-deploy smoke OK: ${SITE} | freshness=${r.freshness} produto=${r.produto} busca="${r.busca}" assets=${r.assets} links=${r.links}`);
}
