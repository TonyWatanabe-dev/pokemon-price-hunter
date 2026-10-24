// Prova de conceito do leitor Tray (src/adapters/tray-poc.js). Fixtures SINTÉTICAS no formato observado nas sondas de
// 24/10/2026 (FN Games: JSON-LD Product + dataLayer { idProduct, nameProduct, … }; Universal Geek / Virtual Gift: GA4
// view_item { currency, value, items }). Nenhuma requisição real. O preço só vale com segunda fonte igual na página;
// zero, ausente, divergente ou nome que não bate com o título não publica.
import assert from 'node:assert/strict';
process.env.HUNTER_DOMAIN_DELAY_MS = '0';
const http = await import('../src/http.js');
const tray = await import('../src/adapters/tray-poc.js');
const { adapters } = await import('../src/adapters/index.js');
assert.equal(adapters.tray, undefined, 'prova de conceito: fora do robô diário');

const ld = (o) => `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', ...o })}</script>`;
const pagina = ({ nome = 'Tcg Pokemon Blister Triplo Fogo Fantasmagorico', preco = '67.80', disp = 'InStock', dl = { idProduct: '2621', nameProduct: nome, price: preco }, vi = null, corpo = '', h1 = nome, extra = '' } = {}) =>
  `<html><head><title>${h1} com 19 Cartas - Loja</title>${ld({ name: nome, sku: '2621', image: '/img/2621.jpg', offers: { '@type': 'Offer', price: preco, priceCurrency: 'BRL', availability: `https://schema.org/${disp}` } })}${extra}
<script>${dl ? `dataLayer = [${JSON.stringify(dl)}];` : ''}${vi ? `gtag('event', 'view_item', ${JSON.stringify(vi)});` : ''}</script></head>
<body><h1>${h1}</h1><div>Meu Carrinho 0 itens R$ 0,00</div>${corpo}</body></html>`;
const U = 'https://fn.test/jogos/cartas-pokemon/tcg-pokemon-blister-triplo';

// confirmado pelo dataLayer: título, URL, preço, estoque, identificador, imagem
{
  const l = tray.lerPaginaTray(pagina(), U);
  assert.equal(l.motivo, undefined);
  assert.equal(l.title, 'Tcg Pokemon Blister Triplo Fogo Fantasmagorico'); assert.equal(l.url, U);
  assert.equal(l.price.base, 67.8); assert.equal(l.stock, 'IN_STOCK'); assert.equal(l.sku, '2621'); assert.equal(l.image, 'https://fn.test/img/2621.jpg');
}
// confirmado pelo GA4 view_item (sem dataLayer da Tray)
assert.equal(tray.lerPaginaTray(pagina({ dl: null, vi: { currency: 'BRL', value: 67.8, items: [{ item_id: '2621', price: 67.8 }] } }), U).price.base, 67.8);
// recusas
const motivo = (o) => tray.lerPaginaTray(pagina(o), U).motivo;
assert.equal(motivo({ preco: '0.00', dl: { price: '0.00' } }), 'preço ausente ou zero');
assert.equal(motivo({ dl: null }), 'sem segunda fonte de preço na página');
assert.match(motivo({ dl: { idProduct: '2621', price: '59.90' } }), /^preço não confirmado/);
assert.equal(motivo({ h1: 'Deck Box Pokebola' }), 'nome do Product não bate com o título da página');
assert.equal(motivo({ extra: ld({ name: 'Outro', offers: { price: '10.00' } }) }), 'mais de um Product na página');
assert.equal(tray.lerPaginaTray('<html><h1>x</h1></html>', U).motivo, 'sem Product no JSON-LD');
// estoque: esgotado declarado vale; "em estoque" contradito pelo texto vira desconhecido (não afirma estoque)
assert.equal(tray.lerPaginaTray(pagina({ disp: 'OutOfStock' }), U).stock, 'OUT_OF_STOCK');
assert.equal(tray.lerPaginaTray(pagina({ corpo: '<p>Produto esgotado</p>' }), U).stock, 'UNKNOWN');
// preços secundários: dataLayer e view_item; formato quebrado não confirma nada
assert.deepEqual(tray.precosSecundarios('<script>dataLayer = [{"idProduct":"1","price":"24.90"}];</script>'), [24.9]);
assert.deepEqual(tray.precosSecundarios('<script>dataLayer = [{price: 24.90'), []);
assert.equal(tray.nomeConfere('Booster', 'Booster Fogo'), false, 'nome de uma palavra não basta');

// busca: mapa do site → páginas; robots, 503/rede (falha passageira) e 404 (não serve)
let rotas = {}; let erroRede = new Set();
http.setFetch(async (url) => {
  const u = new URL(url);
  if (u.pathname === '/robots.txt') return new Response('', { status: 404 });
  if (erroRede.has(u.pathname)) throw new TypeError('fetch failed');
  const f = rotas[u.pathname]; return f ? f() : new Response('não achei', { status: 404 });
});
const xml = (locs) => new Response(`<urlset>${locs.map((l) => `<url><loc>${l}</loc></url>`).join('')}</urlset>`, { status: 200, headers: { 'content-type': 'application/xml' } });
const P = ['/produto/tcg-pokemon-blister-triplo', '/produto/tcg-pokemon-booster-box', '/produto/tcg-pokemon-lata-sumida', '/produto/tcg-pokemon-etb-rede'];
rotas = {
  '/sitemap.xml': () => xml(P.map((p) => 'https://fn.test' + p)),
  [P[0]]: () => new Response(pagina(), { status: 200 }),
  [P[1]]: () => new Response(pagina({ dl: null }), { status: 200 }),
  [P[3]]: () => new Response('erro', { status: 503 }),
};
erroRede.add('/never');
{
  const out = await tray.search({ url: 'https://fn.test' });
  assert.equal(out.paginas, 4); assert.equal(out.length, 1); assert.equal(out[0].price.base, 67.8);
  assert.deepEqual(out.motivos, { 'sem segunda fonte de preço na página': 1 });
  assert.deepEqual(out.failed, ['https://fn.test' + P[3]], '503 é falha passageira; 404 não é');
}
console.log('tray-poc-tests: ok');
