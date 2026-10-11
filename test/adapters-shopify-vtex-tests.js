// Adaptadores Shopify e VTEX chamados direto, com fixtures locais e fetch simulado (nenhuma requisição real às lojas).
// Cobre: resposta válida, resposta incompleta, preço inválido, produto indisponível, JSON inválido/HTML inesperado,
// bloqueio (429/403) sem nova tentativa e URL que não é http(s).
// Complementa test/run-tests.js e test/collectors-tests.js, que exercitam os dois adaptadores só pelo caminho feliz do coletor.
import assert from 'node:assert/strict';
process.env.HUNTER_DOMAIN_DELAY_MS = '0'; // antes de carregar o cliente HTTP (o intervalo é lido na importação)
const http = await import('../src/http.js');
const shopify = await import('../src/adapters/shopify.js');
const vtex = await import('../src/adapters/vtex.js');

let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { e.message = `[${name}] ${e.message}`; throw e; } };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const html = (s, status = 200) => new Response(s, { status, headers: { 'content-type': 'text/html' } });
const catalog = { collections: [{ name: 'Caos Ascendente' }] }; // um termo de busca: "pokemon Caos Ascendente"

// Cada cenário usa um host próprio; o robots.txt responde 404 (liberado) salvo indicação contrária.
let routes = {}; let calls = [];
http.setFetch(async (url) => {
  const u = new URL(url);
  if (u.pathname === '/robots.txt') return (routes[u.host]?.robots || (() => html('', 404)))();
  calls.push(u.host + u.pathname);
  const r = routes[u.host]; if (!r) return html('', 404);
  return r.handle(u);
});
const store = (host, handle, robots) => { routes[host] = { handle, robots }; calls = []; return { id: host, url: `https://${host}/` }; };
const failure = async (p) => { try { await p; } catch (e) { return e; } return assert.fail('devia falhar'); };
const isHttp = (u) => /^https?:\/\/[^\s]+$/.test(u);

// ---------- fixtures Shopify (/products.json e /search/suggest.json). shSearch serve o corpo no formato da busca
// preditiva em todas as rotas: /products.json sem "products" cai para a busca, e o anúncio extraído é o mesmo.
const shVariant = (x = {}) => ({ id: 11, title: 'Default Title', price: '359.90', compare_at_price: '449.90', available: true, sku: 'SH-1', barcode: '7891234567890', ...x });
const shProduct = (x = {}) => ({ title: 'Pokémon Booster Box Caos Ascendente 36 Boosters Copag', handle: 'box-caos', url: '/products/box-caos?_pos=1&_sid=abc', variants: [shVariant()], ...x });
const suggest = (...products) => ({ resources: { results: { products } } });
const shSearch = (host, body) => shopify.search(store(host, () => json(body)), catalog);

await t('Shopify: resposta válida', async () => {
  const [l, ...rest] = await shSearch('sh-ok.test', suggest(shProduct({ featured_image: { url: '//cdn.shopify.test/box.jpg' } })));
  assert.equal(rest.length, 0);
  assert.equal(l.title, 'Pokémon Booster Box Caos Ascendente 36 Boosters Copag');
  assert.equal(l.url, 'https://sh-ok.test/products/box-caos', 'URL canônica: absoluta, sem parâmetros de rastreio da busca');
  assert.ok(isHttp(l.url));
  // Shopify não informa a moeda na busca: a loja é brasileira e o preço é lido como reais, em número (nunca texto)
  assert.equal(l.price.base, 359.9); assert.equal(typeof l.price.base, 'number'); assert.equal(l.listPrice, 449.9);
  assert.equal(l.stock, 'IN_STOCK'); assert.equal(l.quantity, null, 'Shopify não informa quantidade: não inventa');
  assert.deepEqual([l.sku, l.ean, l.sourceType, l.image], ['SH-1', '7891234567890', 'store_json', 'https://cdn.shopify.test/box.jpg']);
  // preço no formato brasileiro também vira número em reais
  const [br] = await shSearch('sh-br.test', suggest(shProduct({ variants: [shVariant({ price: 'R$ 1.234,56' })] })));
  assert.equal(br.price.base, 1234.56);
  // várias variantes: uma oferta por variante, com o nome e o link da variante
  const L = await shSearch('sh-var.test', suggest(shProduct({ variants: [shVariant({ id: 1, title: 'Lacrada' }), shVariant({ id: 2, title: 'Avariada', price: '299.90' })] })));
  assert.deepEqual(L.map((x) => [x.title.endsWith('Lacrada') || x.title.endsWith('Avariada'), x.url, x.price.base]),
    [[true, 'https://sh-var.test/products/box-caos?variant=1', 359.9], [true, 'https://sh-var.test/products/box-caos?variant=2', 299.9]]);
  // sem "url" no produto: o link é montado pelo handle
  const [h] = await shSearch('sh-handle.test', suggest(shProduct({ url: undefined })));
  assert.equal(h.url, 'https://sh-handle.test/products/box-caos');
});

await t('Shopify: resposta incompleta', async () => {
  assert.deepEqual(await shSearch('sh-vazio.test', suggest()), [], 'busca sem produtos');
  assert.deepEqual(await shSearch('sh-sem-results.test', { resources: {} }), [], 'sem resources.results');
  const [l] = await shSearch('sh-sem-var.test', suggest({ title: 'Pokémon Blister Triplo Copag', handle: 'blister' }));
  assert.deepEqual([l.price.base, l.listPrice, l.stock, l.sku, l.ean], [null, null, 'UNKNOWN', null, null], 'sem variantes nem preço: nulo e estoque desconhecido');
  assert.equal(l.url, 'https://sh-sem-var.test/products/blister');
  // variantes vazias usam preço e disponibilidade do próprio produto
  const [p] = await shSearch('sh-var-vazia.test', suggest({ title: 'Pokémon ETB Copag', handle: 'etb', variants: [], price: '289.90', available: true }));
  assert.deepEqual([p.price.base, p.stock], [289.9, 'IN_STOCK']);
});

await t('Shopify: preço inválido não vira preço', async () => {
  for (const price of ['0.00', '0', '-10.00', 'R$ -5,00', 'abc', '', 'sob consulta']) {
    const [l] = await shSearch('sh-preco.test', suggest(shProduct({ variants: [shVariant({ price, compare_at_price: null })] })));
    assert.equal(l.price.base, null, `preço ${JSON.stringify(price)}`);
    assert.equal(l.listPrice, null);
  }
});

await t('Shopify: produto indisponível', async () => {
  const [l] = await shSearch('sh-esgotado.test', suggest(shProduct({ variants: [shVariant({ available: false })] })));
  assert.deepEqual([l.stock, l.price.base], ['OUT_OF_STOCK', 359.9], 'esgotado mantém o preço lido, com estoque explícito');
  const [u] = await shSearch('sh-sem-disp.test', suggest(shProduct({ variants: [shVariant({ available: undefined })] })));
  assert.equal(u.stock, 'UNKNOWN', 'sem o campo de disponibilidade: desconhecido, nunca "em estoque"');
});

await t('Shopify: JSON inválido ou HTML inesperado', async () => {
  // /products.json é a rota principal (1 a MAX_PAGES = 8 páginas); a busca preditiva nem é chamada quando ele responde
  const fallback = { products: [{ title: 'Pokémon Box Caos Ascendente Copag', handle: 'box-caos', variants: [shVariant()] }, { title: 'Camiseta', handle: 'camiseta', variants: [shVariant({ price: '50' })] }] };
  const s1 = store('sh-html.test', (u) => (u.pathname === '/search/suggest.json' ? html('<html><body>Loja</body></html>') : u.searchParams.get('page') === '1' ? json(fallback) : json({ products: [] })));
  const L = await shopify.search(s1, catalog);
  assert.deepEqual(L.map((l) => [l.url, l.price.base]), [['https://sh-html.test/products/box-caos', 359.9]], 'só o produto Pokémon do catálogo completo');
  assert.deepEqual(calls, ['sh-html.test/products.json'], 'página menor que 250: uma requisição, sem pedir a página vazia');
  // /products.json devolve HTML: cai para a busca preditiva, que traz o produto
  const s3 = store('sh-html2.test', (u) => (u.pathname === '/products.json' ? html('<html><body>Loja</body></html>') : json(suggest(shProduct()))));
  assert.deepEqual((await shopify.search(s3, catalog)).map((l) => l.url), ['https://sh-html2.test/products/box-caos']);
  assert.deepEqual(calls, ['sh-html2.test/products.json', 'sh-html2.test/search/suggest.json']);
  // as duas rotas devolvem HTML/JSON quebrado: falha explícita (não é bloqueio), sem oferta parcial e sem repetir
  const s2 = store('sh-lixo.test', (u) => (u.pathname === '/search/suggest.json' ? html('{"resources": [quebrado') : html('<html>manutenção</html>')));
  const e = await failure(shopify.search(s2, catalog));
  assert.ok(e instanceof SyntaxError && !e.blocked, `falha de leitura, não bloqueio (${e.name})`);
  assert.equal(calls.length, 2, 'uma tentativa por rota');
  // JSON válido com formato inesperado: nenhuma oferta
  assert.deepEqual(await shSearch('sh-formato.test', [1, 2, 3]), []);
});

await t('Shopify: bloqueio vira erro explícito, sem nova tentativa', async () => {
  for (const status of [429, 403]) {
    const host = `sh-${status}.test`;
    const e = await failure(shopify.search(store(host, () => html('Too Many Requests', status)), catalog));
    assert.ok(e instanceof http.BlockedError && e.blocked && e.status === status, `${status}: BlockedError`);
    assert.deepEqual(calls, [host + '/products.json'], `${status}: uma requisição, sem cair para a busca preditiva`);
  }
  // bloqueio na busca preditiva (após o catálogo completo falhar) também para na hora
  const e = await failure(shopify.search(store('sh-429-fallback.test', (u) => (u.pathname === '/products.json' ? html('erro', 500) : html('', 429))), catalog));
  assert.ok(e.blocked && e.status === 429); assert.equal(calls.length, 2);
  // robots.txt barrado (403): nenhuma busca é feita
  const r = await failure(shopify.search(store('sh-robots.test', () => json(suggest(shProduct())), () => html('Forbidden', 403)), catalog));
  assert.ok(r.blocked && r.status === 403); assert.equal(calls.length, 0);
  // página de desafio anti-robô com 403: bloqueio, não "HTML inesperado"
  const c = await failure(shopify.search(store('sh-desafio.test', () => html('<title>Just a moment...</title>', 403)), catalog));
  assert.ok(c.blocked && c.status === 403);
});

await t('Shopify: link que não é http(s) não vira link', async () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,oi', 'mailto:x@y.z']) {
    const [l] = await shSearch('sh-link.test', suggest(shProduct({ url })));
    assert.equal(l.url, 'https://sh-link.test/products/box-caos', `${url}: usa o handle da própria loja`);
  }
  assert.deepEqual(await shSearch('sh-sem-link.test', suggest(shProduct({ url: 'javascript:alert(1)', handle: undefined }))), [], 'sem link válido nem handle: descartado');
});

// ---------- fixtures VTEX (/api/catalog_system/pub/products/search)
const offer = (x = {}) => ({ Price: 449.9, ListPrice: 499.9, AvailableQuantity: 5, ...x });
const vtItem = (x = {}, o = {}) => ({ itemId: '1', name: 'Unidade', ean: '7890000000001', images: [{ imageUrl: 'https://vt.test/img/1.jpg' }], sellers: [{ sellerId: '1', sellerName: 'Loja VTEX', sellerDefault: true, commertialOffer: offer(o) }], ...x });
const vtProduct = (x = {}, o = {}) => ({ productName: 'Box Display Pokémon ME05 Escuridão Absoluta 36 Boosters Copag', link: 'https://vt.test/me05-display/p', linkText: 'me05-display', items: [vtItem({}, o)], ...x });
const vtSearch = (host, body) => vtex.search(store(host, () => json(body)), catalog);

await t('VTEX: resposta válida', async () => {
  const L = await vtSearch('vt-ok.test', [vtProduct()]);
  assert.equal(L.length, 1, 'o mesmo produto nas duas buscas ("pokemon" e o termo do catálogo) vira uma oferta');
  assert.deepEqual(calls, ['vt-ok.test/api/catalog_system/pub/products/search', 'vt-ok.test/api/catalog_system/pub/products/search']);
  const [l] = L;
  assert.equal(l.title, 'Box Display Pokémon ME05 Escuridão Absoluta 36 Boosters Copag');
  assert.equal(l.url, 'https://vt.test/me05-display/p'); assert.ok(isHttp(l.url));
  // API de catálogo brasileira: preço em reais, número
  assert.equal(l.price.base, 449.9); assert.equal(typeof l.price.base, 'number'); assert.equal(l.listPrice, 499.9);
  assert.deepEqual([l.stock, l.quantity, l.sku, l.ean, l.seller, l.sellerId, l.sourceType, l.image], ['IN_STOCK', 5, '1', '7890000000001', 'Loja VTEX', '1', 'store_api', 'https://vt.test/img/1.jpg']);
  assert.deepEqual(l._vtex, { base: 'https://vt-ok.test', itemId: '1', sellerId: '1' });
  // vendedor secundário do marketplace fica de fora: só o vendedor padrão (o preço que a página mostra)
  const two = vtProduct({ items: [vtItem({ sellers: [
    { sellerId: '9', sellerName: 'Parceiro', sellerDefault: false, commertialOffer: offer({ Price: 399 }) },
    { sellerId: '1', sellerName: 'Loja VTEX', sellerDefault: true, commertialOffer: offer() }] })] });
  assert.deepEqual((await vtSearch('vt-sellers.test', [two])).map((x) => [x.sellerId, x.price.base]), [['1', 449.9]]);
  // vários SKUs: uma oferta por SKU, com link do SKU
  const multi = vtProduct({ items: [vtItem({ itemId: '1', name: 'Display' }), vtItem({ itemId: '2', name: 'Booster avulso' }, { Price: 24.9 })] });
  assert.deepEqual((await vtSearch('vt-multi.test', [multi])).map((x) => [x.title.split(' ').at(-1), x.url, x.price.base]),
    [['Display', 'https://vt.test/me05-display/p?skuId=1', 449.9], ['avulso', 'https://vt.test/me05-display/p?skuId=2', 24.9]]);
  // sem "link": montado pelo linkText na própria loja
  const [lt] = await vtSearch('vt-linktext.test', [vtProduct({ link: undefined })]);
  assert.equal(lt.url, 'https://vt-linktext.test/me05-display/p');
});

await t('VTEX: resposta incompleta', async () => {
  assert.deepEqual(await vtSearch('vt-vazio.test', []), []);
  assert.deepEqual(await vtSearch('vt-sem-itens.test', [{ productName: 'Sem itens', link: 'https://vt.test/x/p' }, vtProduct({ items: [{ itemId: '9' }] })]), [], 'sem itens ou sem vendedor: ignorado');
  const [l] = await vtSearch('vt-sem-oferta.test', [vtProduct({ items: [vtItem({ sellers: [{ sellerId: '1', sellerName: 'Loja VTEX' }] })] })]);
  assert.deepEqual([l.price.base, l.listPrice, l.stock, l.quantity], [null, null, 'OUT_OF_STOCK', null], 'sem commertialOffer: sem preço e sem estoque confirmado');
  assert.deepEqual(await vtSearch('vt-objeto.test', { erro: 'formato novo' }), [], 'resposta que não é lista');
});

await t('VTEX: preço inválido não vira preço', async () => {
  for (const Price of [0, -5, '359.9', 'abc', null]) {
    const [l] = await vtSearch('vt-preco.test', [vtProduct({}, { Price, ListPrice: '999' })]);
    assert.equal(l.price.base, null, `preço ${JSON.stringify(Price)}`);
    assert.equal(l.listPrice, null, `preço "de" com preço ${JSON.stringify(Price)}`);
    assert.equal(l.stock, 'OUT_OF_STOCK', `sem preço válido não é oferta em estoque (${JSON.stringify(Price)})`);
  }
  const [lp] = await vtSearch('vt-preco-de.test', [vtProduct({}, { ListPrice: '999' })]);
  assert.deepEqual([lp.price.base, lp.listPrice], [449.9, null], 'preço "de" em texto é ignorado');
});

await t('VTEX: produto indisponível', async () => {
  const [z] = await vtSearch('vt-zero.test', [vtProduct({}, { AvailableQuantity: 0 })]);
  assert.deepEqual([z.stock, z.quantity, z.price.base], ['OUT_OF_STOCK', null, 449.9]);
  const [f] = await vtSearch('vt-indisp.test', [vtProduct({}, { IsAvailable: false })]);
  assert.equal(f.stock, 'OUT_OF_STOCK', 'IsAvailable=false vence a quantidade');
  const [big] = await vtSearch('vt-infinito.test', [vtProduct({}, { AvailableQuantity: 99999 })]);
  assert.deepEqual([big.stock, big.quantity], ['IN_STOCK', null], 'estoque "infinito" da VTEX não vira quantidade');
});

await t('VTEX: JSON inválido ou HTML inesperado', async () => {
  for (const body of ['<html><body>Manutenção</body></html>', '[{"productName": quebrado']) {
    const e = await failure(vtex.search(store('vt-lixo.test', () => html(body)), catalog));
    assert.ok(e instanceof SyntaxError && !e.blocked, 'falha de leitura explícita, não bloqueio');
    assert.equal(calls.length, 1, 'para na primeira resposta ilegível, sem repetir');
  }
});

await t('VTEX: bloqueio vira erro explícito, sem nova tentativa', async () => {
  for (const status of [429, 403]) {
    const e = await failure(vtex.search(store(`vt-${status}.test`, () => html('bloqueado', status)), catalog));
    assert.ok(e instanceof http.BlockedError && e.blocked && e.status === status, `${status}: BlockedError`);
    assert.equal(calls.length, 1, `${status}: uma requisição só`);
  }
  const e = await failure(vtex.search(store('vt-503.test', () => html('erro', 503)), catalog));
  assert.ok(!e.blocked && e.status === 503 && calls.length === 1, '5xx: erro HTTP com status, sem repetir');
  const r = await failure(vtex.search(store('vt-robots.test', () => json([vtProduct()]), () => html('Forbidden', 403)), catalog));
  assert.ok(r.blocked && r.status === 403 && calls.length === 0, 'robots.txt barrado: nenhuma busca');
});

await t('VTEX: link que não é http(s) não vira link', async () => {
  const [l] = await vtSearch('vt-link.test', [vtProduct({ link: 'javascript:alert(1)' })]);
  assert.equal(l.url, 'https://vt-link.test/me05-display/p', 'usa o linkText na própria loja');
  assert.deepEqual(await vtSearch('vt-sem-link.test', [vtProduct({ link: 'javascript:alert(1)', linkText: undefined })]), [], 'sem link válido nem linkText: descartado');
});

await t('sem título/nome do produto: não vira oferta "undefined"', async () => {
  for (const [i, title] of [undefined, null, '', '   ', 42].entries()) {
    assert.deepEqual(await shSearch(`sh-sem-titulo-${i}.test`, suggest(shProduct({ title }))), [], `Shopify title=${JSON.stringify(title)}: descartado`);
    assert.deepEqual(await vtSearch(`vt-sem-nome-${i}.test`, [vtProduct({ productName: title })]), [], `VTEX productName=${JSON.stringify(title)}: descartado`);
  }
});

http.setFetch(globalThis.fetch);
console.log(`✓ Adaptadores Shopify e VTEX (fixtures locais): ${n} grupos de testes passaram`);
await import('./store-blocking-tests.js');
