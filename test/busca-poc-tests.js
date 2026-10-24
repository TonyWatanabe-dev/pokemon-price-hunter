// Prova de conceito do leitor pela página de busca (src/adapters/busca.js, Kalunga). Fixtures SINTÉTICAS no formato
// observado na busca da Kalunga em 24/10/2026 (links /prod/<slug>/<id>) e fetch simulado: nenhuma requisição real.
// Cobre: caminho feliz, robots.txt que não permite a busca, estrutura mudada (sem links), 5xx/rede (falha passageira),
// 404 (página que não serve), página sem preço e link de outro site ou sem Pokémon no caminho.
import assert from 'node:assert/strict';
process.env.HUNTER_DOMAIN_DELAY_MS = '0';
const http = await import('../src/http.js');
const busca = await import('../src/adapters/busca.js');
const { adapters } = await import('../src/adapters/index.js');

assert.equal(adapters.busca, undefined, 'prova de conceito: fora do robô diário (não registrado em index.js)');

const html = (s, status = 200) => new Response(s, { status, headers: { 'content-type': 'text/html' } });
const produto = (nome, preco, { estoque = 'InStock', mostra = true, path } = {}) => `<!doctype html><html><head><title>${nome} - Loja</title>
<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', name: nome, url: path, sku: '154766',
  offers: { '@type': 'Offer', price: preco, priceCurrency: 'BRL', availability: `https://schema.org/${estoque}` } })}</script></head>
<body><h1>${nome}</h1>${mostra ? `<span class="preco">R$ ${preco.toFixed(2).replace('.', ',')}</span>` : '<span>Consulte</span>'}<button>Comprar</button></body></html>`;
const BUSCA = `<html><body><div class="lista">
<a href="/prod/booster-pokemon-tcg-escuridao-absoluta-copag-pt-1-un/154766">Booster Pokémon TCG Escuridão Absoluta</a>
<a href="/prod/booster-pokemon-tcg-escuridao-absoluta-copag-pt-1-un/154766?utm=x">repetido com rastreio</a>
<a href="/prod/booster-pokemon-tcg-caos-ascendente-copag-pt-1-un/154761">Caos Ascendente</a>
<a href="/prod/caderno-universitario-10-materias/99999">vitrine sem Pokémon</a>
<a href="https://outra.test/prod/pokemon-booster/1">outro site</a>
<a href="/busca/2?q=pokemon">página 2</a></div></body></html>`;

let rotas = {}; let robots = () => html('', 404); let erroRede = new Set();
http.setFetch(async (url) => {
  const u = new URL(url);
  if (u.pathname === '/robots.txt') return robots();
  if (erroRede.has(u.pathname)) throw new TypeError('fetch failed');
  const f = rotas[u.pathname]; return f ? f(u) : html('não achei', 404);
});
const store = { id: 'kalungacombr', url: 'https://www.kalunga.test', buscaTpl: '/busca/1?q={q}' };
const P1 = '/prod/booster-pokemon-tcg-escuridao-absoluta-copag-pt-1-un/154766';
const P2 = '/prod/booster-pokemon-tcg-caos-ascendente-copag-pt-1-un/154761';
const reset = () => { robots = () => html('', 404); erroRede = new Set(); rotas = {
  '/busca/1': () => html(BUSCA),
  [P1]: () => html(produto('Booster Pokémon TCG Escuridão Absoluta Copag PT 1 UN', 13.9, { path: P1 })),
  [P2]: () => html(produto('Booster Pokémon TCG Caos Ascendente Copag PT 1 UN', 13.9, { estoque: 'OutOfStock', path: P2 })),
}; };

// links: mesmo site, caminho de produto com Pokémon, sem repetição e sem parâmetros
assert.deepEqual(busca.linksDaBusca(BUSCA, 'https://www.kalunga.test/busca/1?q=pokemon'), [`https://www.kalunga.test${P1}`, `https://www.kalunga.test${P2}`]);
assert.deepEqual(busca.linksDaBusca('<a href="https://kalunga.test/prod/pokemon-lata/7">x</a>', 'https://www.kalunga.test/'), ['https://kalunga.test/prod/pokemon-lata/7'], 'link absoluto do mesmo site (com ou sem www)');
assert.deepEqual(busca.linksDaBusca('<html>nada</html>', 'https://www.kalunga.test/'), []);
assert.equal(busca.linksDaBusca(BUSCA, 'https://www.kalunga.test/', 1).length, 1, 'respeita o máximo');
assert.equal(busca.urlDaBusca('https://www.kalunga.test/', '/busca/1?q={q}', 'pokemon tcg'), 'https://www.kalunga.test/busca/1?q=pokemon%20tcg');

// caminho feliz: título, URL, preço, estoque e identificador vindos da página do produto
reset();
{
  const out = await busca.search(store);
  assert.equal(out.length, 2);
  const [a, b] = out;
  assert.equal(a.title, 'Booster Pokémon TCG Escuridão Absoluta Copag PT 1 UN');
  assert.equal(a.url, `https://www.kalunga.test${P1}`);
  assert.equal(a.price.base, 13.9); assert.equal(a.stock, 'IN_STOCK'); assert.equal(a.sku, '154766'); assert.equal(a.sourceType, 'json_ld');
  assert.equal(b.stock, 'OUT_OF_STOCK');
  assert.deepEqual(out.failed, []); assert.deepEqual(out.diag, { buscas: 1, links: 2, semLinks: [] });
}

// robots.txt não permite a busca: para antes de abrir qualquer página
reset(); robots = () => html('User-agent: *\nDisallow: /busca/\n');
await assert.rejects(busca.search({ ...store, url: 'https://robots.kalunga.test' }), (e) => e.status === 'robots');

// estrutura mudou (busca sem link de produto): nada é inventado e o diagnóstico registra o termo
reset(); rotas['/busca/1'] = () => html('<html><div id="app"></div></html>');
{ const out = await busca.search({ ...store, url: 'https://vazio.kalunga.test' }); assert.equal(out.length, 0); assert.deepEqual(out.diag.semLinks, ['pokemon']); }

// 5xx e erro de rede: falha passageira (a oferta anterior seria preservada); 404: página que não serve, sem falha
reset(); rotas[P1] = () => html('erro', 503); erroRede.add(P2);
{ const out = await busca.search({ ...store, url: 'https://falha.kalunga.test' }); assert.equal(out.length, 0); assert.equal(out.failed.length, 2); assert.ok(Object.keys(out.failReasons).length === 2); }
reset(); delete rotas[P1];
{ const out = await busca.search({ ...store, url: 'https://sumiu.kalunga.test' }); assert.equal(out.length, 1); assert.deepEqual(out.failed, []); }

// página que não escreve o preço: não publica
reset(); rotas[P1] = () => html(produto('Booster Pokémon TCG Escuridão Absoluta Copag PT 1 UN', 13.9, { mostra: false, path: P1 }));
{ const out = await busca.search({ ...store, url: 'https://semprecosite.kalunga.test' }); assert.equal(out.length, 1); assert.equal(out[0].title, 'Booster Pokémon TCG Caos Ascendente Copag PT 1 UN'); }

// loja sem modelo de busca: erro claro
await assert.rejects(busca.search({ id: 'x', url: 'https://x.test' }), /modelo de busca/);
console.log('busca-poc-tests: ok');
