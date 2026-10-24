// Endereço que o site não conhece responde 404 de verdade (antes saía 200 com a casca da Home: "soft 404").
// Confere: rewrites do vercel.json (rotas do app na casca, o resto no 404), resposta do handler e a tela do app.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
globalThis.fetch = async (url) => { throw new Error('rede bloqueada no teste: ' + url); };
delete process.env.DATABASE_URL;

const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const routeRe = (source) => new RegExp('^' + source.replace(/:(\w+)\*/g, '(?<$1>.*)').replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$');
const rewrite = (p) => {
  for (const r of vercel.rewrites) {
    const m = routeRe(r.source).exec(p);
    if (m) return r.destination.replace(/:(\w+)\*?/g, (_, k) => m.groups?.[k] ?? '');
  }
  return p;
};
const NF = '/api/pagina?t=nao-encontrada';

// 1) Endereços desconhecidos caem no 404.
for (const p of ['/pagina-que-nao-existe', '/produto', '/colecao', '/guia/outra-coisa', '/busca/extra', '/wp-admin', '/a/b/c'])
  assert.equal(rewrite(p), NF, p + ' deveria ir para o 404');

// 2) Rotas do app continuam na casca; rotas conhecidas não mudam.
for (const p of ['/busca', '/conta', '/favoritos', '/alertas', '/configuracoes']) assert.equal(rewrite(p), '/app.html', p);
const conhecidas = {
  '/': '/api/pagina?t=home', '/oportunidades': '/api/pagina?t=oportunidades', '/precos': '/api/pagina?t=precos',
  '/pre-vendas': '/api/pagina?t=pre-vendas', '/lojas': '/api/pagina?t=lojas', '/comunidade': '/api/pagina?t=grupos',
  '/como-funciona': '/api/pagina?t=como-funciona', '/guia/glossario': '/api/pagina?t=glossario',
  '/termos': '/api/pagina?t=termos', '/privacidade': '/api/pagina?t=privacidade',
  '/produto/abc': '/api/pagina?t=produto&slug=abc', '/colecao/abc': '/api/pagina?t=colecao&slug=abc', '/tipo/abc': '/api/pagina?t=tipo&slug=abc',
  '/monte-seu-kit': '/kit.html', '/monte-seu-kit/passo-2': '/kit.html', '/entrar': '/entrar.html', '/entrar/alerta': '/entrar.html',
  '/ir/loja/home': '/ir.html', '/sitemap.xml': '/api/sitemap', '/ml/callback': '/api/ml-callback',
};
for (const [p, d] of Object.entries(conhecidas)) assert.equal(rewrite(p), d, p);
assert.equal(rewrite('/api/v1/offers'), '/api/v1?path=offers');
// Dados, funções, Vercel e Firebase nunca caem no 404 do app.
for (const p of ['/data/state.json', '/api/qualquer', '/_vercel/insights/script.js']) assert.equal(rewrite(p), p, p);
assert.match(rewrite('/__/auth/handler'), /^https:\/\/tcg-price-hunter\.firebaseapp\.com\/__\/auth\//);
// O 404 é o último rewrite: nada depois dele fica inalcançável.
assert.equal(vercel.rewrites.at(-1).destination, NF);
// /index.html antigo vai para a Home.
assert.ok(vercel.redirects.some((r) => r.source === '/index.html' && r.destination === '/' && r.permanent), '/index.html redireciona para /');

// 3) Handler: 404, fora do índice, sem canonical da Home, com caminho de volta, sem depender dos dados.
const { default: handler, NAO_ENCONTRADA } = await import('../api/pagina.mjs');
const headers = new Map(); let body = '';
const res = { statusCode: 200, setHeader(k, v) { headers.set(k.toLowerCase(), String(v)); }, end(b) { body = String(b ?? ''); } };
await handler({ url: NF, headers: { host: 'tcgpricehunter.com.br' } }, res);
assert.equal(res.statusCode, 404);
assert.match(headers.get('content-type'), /text\/html/);
assert.match(body, /<meta name="robots" content="noindex">/);
assert.doesNotMatch(body, /<link rel="canonical"/, 'sem canonical apontando para a Home');
assert.match(body, /<title>Página não encontrada \| TCG Price Hunter<\/title>/);
assert.ok(body.includes(`<div id="view" data-notfound><div class="ssr">${NAO_ENCONTRADA}</div></div>`));
assert.match(NAO_ENCONTRADA, /<a href="\/">Ir para o início<\/a>/);
assert.doesNotMatch(headers.get('cache-control'), /s-maxage=600/, '404 não fica no cache longo');

// 4) App: com a marca do servidor, rota desconhecida vira a tela "Página não encontrada" (não a Home), sem baixar o estado completo.
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert.match(html, /return\{view:ROUTES\[seg\[0\]\]\|\|\(document\.getElementById\("view"\)\?\.hasAttribute\("data-notfound"\)\?"notfound":"deals"\)/);
assert.match(html, /if\(view==="notfound"\)return renderNotFound\(\);\n  if\(!S\)return;/);
assert.match(html, /function renderNotFound\(\)\{[^\n]*Página não encontrada[^\n]*href="\/" data-go=""/);
assert.match(html, /const API_VIEWS=new Set\(\["deals","notfound",/);
assert.match(html, /notfound:"Página não encontrada"/);

console.log('rota-desconhecida-404: ok');
