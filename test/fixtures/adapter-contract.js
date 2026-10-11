// Fixtures de contrato dos adaptadores por loja (dados sintéticos, sem rede).
// Cada fábrica devolve o corpo que a loja simulada responde para um cenário.
export const brl = (v) => Number(v).toFixed(2).replace('.', ',');

// ---- Shopify (/search/suggest.json)
export const shopifyProduct = ({ title = 'Pokémon Box Caos Ascendente Copag', handle = 'box-caos', price = '359.90', available = true } = {}) => ({
  title, handle, url: `/products/${handle}?_pos=1`,
  variants: [{ id: 11, title: 'Default Title', price, available, sku: 'SH-1', barcode: null }],
});
export const shopifySuggest = (...products) => ({ resources: { results: { products } } });
// Produto sem preço nem estoque informados: o adaptador deve devolver preço nulo e estoque desconhecido.
export const shopifyNoPrice = () => ({ title: 'Pokémon Blister Triplo Copag', handle: 'blister-sem-preco' });

// ---- VTEX (/api/catalog_system/pub/products/search)
export const vtexProduct = ({ name = 'Box Display Pokémon ME05 Escuridão Absoluta 36 Boosters Copag', link = 'https://vt.test/me05-display/p', id = '1', price = 449.9, qty = 5 } = {}) => ({
  productName: name, link,
  items: [{ itemId: id, name: 'u', ean: '7891234567890', sellers: [{ sellerId: '1', sellerName: 'Loja VTEX', commertialOffer: { Price: price, ListPrice: price, AvailableQuantity: qty } }] }],
});

// ---- JSON-LD (página de produto)
export const productPage = (name, price, availability = 'InStock') => `<html><head><script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org', '@type': 'Product', name,
  offers: { '@type': 'Offer', price, priceCurrency: 'BRL', availability: `https://schema.org/${availability}` },
})}</script></head><body><h1>${name}</h1><p>R$ ${brl(price)}</p></body></html>`;
export const emptyPage = '<html><head><title>Em breve</title></head><body><p>Página em construção</p></body></html>';

// ---- Mercado Livre (/sites/MLB/search)
export const mlResult = ({ id = 'MLB1', price = 299.9, qty = 3 } = {}) => ({
  id, title: 'Pokémon Box Treinador Avançado Copag', permalink: `https://produto.mercadolivre.com.br/${id}-pokemon`,
  price, condition: 'new', available_quantity: qty, thumbnail: 'http://http2.mlstatic.com/D_1.jpg', seller: { id: 7, nickname: 'LOJA_TCG' },
});
