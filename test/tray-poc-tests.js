// Prova de conceito do leitor Tray (src/adapters/tray-poc.js). Fixtures SINTÉTICAS no formato observado nas sondas de
// 24/10/2026 (dataLayer da Tray { pageCategory, idProduct, nameProduct, priceSell, price, availability, urlProduct… },
// GA4 view_item { currency, value, items } e JSON-LD Product). Nenhuma requisição real.
// O preço (priceSell) só vale com confirmação independente na página; zero, divergente, nome ou link que não batem e
// estoque contraditório não publicam.
import assert from 'node:assert/strict';
process.env.HUNTER_DOMAIN_DELAY_MS = '0';
const http = await import('../src/http.js');
const tray = await import('../src/adapters/tray-poc.js');
const { adapters } = await import('../src/adapters/index.js');
assert.equal(adapters.tray, undefined, 'prova de conceito: fora do robô diário');

const NOME = 'Tcg Pokemon Blister Triplo Fogo Fantasmagorico';
const U = 'https://fn.test/jogos/cartas-pokemon/tcg-pokemon-blister-triplo';
const pagina = ({ dl = {}, ld = { price: '69.90', availability: 'InStock' }, ga4 = null, h1 = NOME, sem = false, extraLd = '' } = {}) => {
  const d = { pageCategory: 'Produto', idProduct: '2621', nameProduct: NOME, priceSell: '69.90', price: '69.90', availability: 'YES', urlProduct: 'http://www.fn.test/jogos/cartas-pokemon/tcg-pokemon-blister-triplo', urlImage: 'https://img.test/2621.png', ...dl };
  return `<html><head><title>${h1} - Loja</title>${ld ? `<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: NOME, sku: '2621', offers: { '@type': 'Offer', priceCurrency: 'BRL', price: ld.price, availability: `https://schema.org/${ld.availability}` } })}</script>` : ''}${extraLd}
<script>${ga4 ? `gtag('event', 'view_item', ${JSON.stringify(ga4)});` : ''}${sem ? '' : `dataLayer = [${JSON.stringify(d)}];`}</script></head><body><h1>${h1}</h1><div>Meu Carrinho 0 itens R$ 0,00</div></body></html>`;
};
const ler = (o) => tray.lerPaginaTray(pagina(o), U);

// confirmado pelo JSON-LD igual: título, URL, preço, estoque, identificador, imagem
{
  const l = ler();
  assert.equal(l.motivo, undefined);
  assert.deepEqual([l.title, l.url, l.price.base, l.price.pix, l.stock, l.sku, l.image], [NOME, U, 69.9, null, 'IN_STOCK', '2621', 'https://img.test/2621.png']);
}
// confirmado pelo GA4 quando o JSON-LD traz outro valor (FN Games: JSON-LD 58,10 × priceSell 59,90)
assert.equal(ler({ dl: { priceSell: '59.90', price: '59.90' }, ld: { price: '58.10', availability: 'InStock' }, ga4: { currency: 'BRL', value: 59.9, items: [{ price: 59.9 }] } }).price.base, 59.9);
// recusas, com os valores no motivo para a decisão humana
assert.match(ler({ dl: { priceSell: '59.90', price: '59.90' }, ld: { price: '58.10', availability: 'InStock' } }).motivo, /^preço não confirmado \(dataLayer 59\.9 × JSON-LD 58\.1 × GA4 —\)/);
assert.equal(ler({ dl: { priceSell: '0.00', price: '0.00' } }).motivo, 'preço ausente ou zero');
assert.equal(ler({ sem: true }).motivo, 'sem dataLayer de produto da Tray');
assert.equal(ler({ dl: { pageCategory: 'Categoria' } }).motivo, 'sem dataLayer de produto da Tray');
assert.equal(ler({ dl: { nameProduct: 'Deck Box Pokebola' }, h1: 'Outra coisa' }).motivo, 'nome do produto não bate com a página');
assert.equal(ler({ dl: { urlProduct: 'https://outra.test/p/1' } }).motivo, 'link do produto de outro site');
assert.equal(ler({ extraLd: '<script type="application/ld+json">{"@type":"Product","name":"Outro"}</script>' }).motivo, 'mais de um Product na página');
// estoque: dataLayer "NO" vale; dataLayer × JSON-LD em conflito vira desconhecido
assert.equal(ler({ dl: { availability: 'NO' }, ld: { price: '69.90', availability: 'OutOfStock' } }).stock, 'OUT_OF_STOCK');
assert.equal(ler({ dl: { availability: 'YES' }, ld: { price: '69.90', availability: 'OutOfStock' } }).stock, 'UNKNOWN');
// leitores das fontes
assert.equal(tray.dataLayerTray('<script>dataLayer = [{"pageCategory":"Produto","priceSell":"1.00"}];</script>').priceSell, '1.00');
assert.equal(tray.dataLayerTray('<script>dataLayer = [{quebrado: 1}];</script>'), null);
assert.deepEqual(tray.precosGa4(`<script>gtag('event', 'view_item', {"currency":"BRL","value":159.9,"items":[{"price":159.9}]});</script>`), [159.9, 159.9]);
assert.equal(tray.nomeConfere('Booster', 'Booster Fogo'), false, 'nome de uma palavra não basta');

// busca: mapa do site → páginas; 503 é falha passageira, 404 não serve
let rotas = {};
http.setFetch(async (url) => {
  const u = new URL(url);
  if (u.pathname === '/robots.txt') return new Response('', { status: 404 });
  const f = rotas[u.pathname]; return f ? f() : new Response('não achei', { status: 404 });
});
const xml = (locs) => new Response(`<urlset>${locs.map((l) => `<url><loc>${l}</loc></url>`).join('')}</urlset>`, { status: 200, headers: { 'content-type': 'application/xml' } });
const P = ['/produto/tcg-pokemon-blister-triplo', '/produto/tcg-pokemon-booster-box', '/produto/tcg-pokemon-lata-sumida', '/produto/tcg-pokemon-etb-rede'];
rotas = {
  '/sitemap.xml': () => xml(P.map((p) => 'https://fn.test' + p)),
  [P[0]]: () => new Response(pagina({ dl: { urlProduct: 'https://fn.test' + P[0] } }), { status: 200 }),
  [P[1]]: () => new Response(pagina({ sem: true }), { status: 200 }),
  [P[3]]: () => new Response('erro', { status: 503 }),
};
{
  const out = await tray.search({ url: 'https://fn.test' });
  assert.equal(out.paginas, 4); assert.equal(out.length, 1); assert.equal(out[0].price.base, 69.9);
  assert.deepEqual(out.motivos, { 'sem dataLayer de produto da Tray': 1 });
  assert.deepEqual(out.failed, ['https://fn.test' + P[3]], '503 é falha passageira; 404 não é');
}
console.log('tray-poc-tests: ok');
