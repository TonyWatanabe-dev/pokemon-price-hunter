// Testes offline: fetch simulado com lojas Shopify, VTEX, JSON-LD e uma bloqueada.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
process.env.HUNTER_DOMAIN_DELAY_MS = '0';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hunter-'));
process.env.HUNTER_CONFIG_DIR = path.join(tmp, 'config'); process.env.HUNTER_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.HUNTER_CONFIG_DIR, { recursive: true });
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const cat = JSON.parse(fs.readFileSync(path.join(root, 'config/catalog.json')));
cat.products.find((p) => p.id === 'me04-box36').copag = { msrp: 449.99, source_url: 'https://www.copag.com.br/exemplo-teste', confidence: 'OFICIAL', source_timestamp: '2026-10-01' };
cat.products.find((p) => p.id === 'me05-box36').copag = { msrp: 449.99, source_url: 'https://www.mercadolivre.com.br/loja/copag', confidence: 'OFICIAL' };
fs.writeFileSync(path.join(tmp, 'config/catalog.json'), JSON.stringify(cat));
fs.writeFileSync(path.join(tmp, 'config/stores.json'), JSON.stringify({ stores: [
  { id: 'shop', name: 'Loja Shopify', url: 'https://shop.test', platform: 'auto', kind: 'specialist', evidence: { cnpj: '00.000.000/0001-00', rating: 4.8, reviewCount: 900, foundedYear: 2018, returnPolicyUrl: 'x', contact: 'x' } },
  { id: 'vtex', name: 'Loja VTEX', url: 'https://vtex.test', platform: 'auto', kind: 'specialist', evidence: {} },
  { id: 'ld', name: 'Loja Nuvem', url: 'https://ld.test', platform: 'auto', kind: 'specialist', evidence: {} },
  { id: 'blk', name: 'Bloqueada', url: 'https://blk.test', platform: 'auto', kind: 'specialist', evidence: {} },
  { id: 'nope', name: 'Sem domínio', url: null, platform: 'auto', kind: 'specialist', evidence: {} },
  { id: 'cop', name: 'Loja Copag (oficial)', url: 'https://cop.test', platform: 'vtex', kind: 'official', copagSource: true, evidence: { officialStore: true, cnpj: 'x' } },
] }));
fs.copyFileSync(path.join(root, 'config/watchlist.json'), path.join(tmp, 'config/watchlist.json'));

let shopPrice = '339.00'; let vtexQty = 0;
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const html = (s, status = 200) => new Response(s, { status, headers: { 'content-type': 'text/html' } });
const page = (name, price, avail, extra = '') => html(`<html><head><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', name, offers: { '@type': 'Offer', price, priceCurrency: 'BRL', availability: 'https://schema.org/' + avail } })}</script></head><body>${extra}${'x'.repeat(40000)}</body></html>`);
const http = await import('../src/http.js');
http.setFetch(async (url, opt) => {
  const u = new URL(url);
  if (u.host === 'blk.test') return html('Just a moment...', 403);
  if (u.pathname === '/robots.txt') return u.host === 'ld.test' ? html('User-agent: *\nDisallow: /admin\nDisallow: /*bloqueado') : html('', 404);
  if (u.host === 'shop.test') {
    if (u.pathname === '/products.json') return json({ products: [] });
    if (u.pathname === '/search/suggest.json') return json({ resources: { results: { products: /caos/i.test(u.searchParams.get('q')) ? [
      { title: 'Pokémon TCG Booster Box c/36 - Caos Ascendente - Copag Lacrado', url: '/products/box-caos', price: shopPrice, available: true, variants: [{ id: 1, title: 'Default Title', price: shopPrice, available: true }] },
      { title: 'Pokémon Chaos Rising Booster Box 36 Packs EN', url: '/products/en', price: '300.00', available: true },
      { title: 'Box Treinador Avançado Caos Ascendente Copag', url: '/products/etb', price: '289.90', available: true },
      { title: 'Pokémon Booster Box Caos Ascendente 36 boosters', url: '/products/suspeito', price: '99.00', available: true },
    ] : [] } } });
  }
  if (u.host === 'vtex.test') {
    if (u.pathname === '/products.json') return html('', 404);
    if (u.pathname.startsWith('/api/catalog_system')) return json(/pokemon$|caos/i.test(u.searchParams.get('ft')) ? [{ productName: 'Caixa Pokémon Caos Ascendente 36 Boosters Copag', link: 'https://vtex.test/caos-36/p', items: [{ itemId: '77', ean: '196214156098', name: 'u', sellers: [{ sellerId: '1', sellerName: 'Loja VTEX', commertialOffer: { Price: 379.9, ListPrice: 449.99, AvailableQuantity: vtexQty } }] }] }] : []);
    if (u.pathname.includes('simulation')) return json({ logisticsInfo: [{ slas: [{ price: 1990 }, { price: 2590 }] }] });
  }
  if (u.host === 'cop.test') {
    if (u.pathname.startsWith('/api/catalog_system')) return json(/escuridao|Escuridão/i.test(u.searchParams.get('ft')) ? [{ productName: 'Box Display Pokémon ME05 Escuridão Absoluta', link: 'https://cop.test/box-display-me05/p', items: [{ itemId: '9', ean: null, name: 'u', sellers: [{ sellerId: '1', sellerName: 'Copag', commertialOffer: { Price: 449.99, ListPrice: 449.99, AvailableQuantity: 3 } }] }] }] : []);
  }
  if (u.host === 'ld.test') {
    if (u.pathname === '/products.json' || u.pathname.startsWith('/api/')) return html('', 404);
    if (u.pathname === '/') return html('<title>Loja Pokémon</title>');
    if (u.pathname === '/sitemap.xml') return html('<urlset><url><loc>https://ld.test/pokemon-booster-box-escuridao-absoluta-36</loc></url><url><loc>https://ld.test/pokemon-box-caos-ascendente-pre-venda</loc></url><url><loc>https://ld.test/pokemon-box-bloqueado</loc></url><url><loc>https://ld.test/camiseta</loc></url></urlset>');
    if (u.pathname === '/pokemon-booster-box-escuridao-absoluta-36') return page('Pokémon Booster Box Escuridão Absoluta 36 Pacotes Copag', '389.90', 'InStock', '<span>R$ 369,90 no Pix</span>');
    if (u.pathname === '/pokemon-box-caos-ascendente-pre-venda') return page('Pré-venda Pokémon Booster Box Caos Ascendente 36 boosters', '359.90', 'PreOrder');
    if (u.pathname === '/pokemon-box-bloqueado') throw new Error('robots deveria ter barrado');
  }
  return html('', 404);
});

const { runOnce } = await import('../src/run.js');
const sentMsgs = []; const send = { capture: async (m) => { sentMsgs.push(m); return true; } };
const quiet = () => {};

// Rodada 1
let s = await runOnce({ log: quiet, send, now: new Date('2026-10-06T10:00:00Z') });
const by = (fn) => s.offers.find(fn);
const shopBox = by((o) => o.storeId === 'shop' && o.productId === 'me04-box36' && o.price === 339);
assert.ok(shopBox, 'box Shopify casada');
assert.equal(shopBox.discount, 0.2466); assert.equal(shopBox.perBooster, 9.42); assert.equal(shopBox.priceKind, 'base');
assert.ok(shopBox.dealScore >= 80 && shopBox.storeValidated && shopBox.opportunity, 'oportunidade com loja validada');
assert.ok(!s.offers.some((o) => /EN$/.test(o.title)), 'inglês rejeitado');
assert.ok(s.unmatched.some((u) => /EN$/.test(u.title)), 'inglês listado para revisão');
const susp = by((o) => o.price === 99); assert.ok(susp.anomalous && susp.dealScore == null && !s.bestDeals.includes(susp.id), 'preço anormal fora do ranking');
const etb = by((o) => o.productId === 'me04-etb'); assert.equal(etb.discount, null); assert.equal(etb.dealScore, null, 'sem Copag: sem desconto nem score');
const vtexOff = by((o) => o.storeId === 'vtex'); assert.equal(vtexOff.stock, 'OUT_OF_STOCK'); assert.ok(!s.bestDeals.includes(vtexOff.id));
const ldBox = by((o) => o.productId === 'me05-box36'); assert.equal(ldBox.price, 369.9); assert.equal(ldBox.priceKind, 'pix', 'Pix tem prioridade');
const me05 = s.products.find((p) => p.id === 'me05-box36');
assert.equal(me05.copagConfirmed, true, 'MSRP capturado na loja oficial substitui o de marketplace');
assert.equal(me05.msrp, 449.99); assert.match(me05.copag.source_url, /cop\.test/);
assert.equal(ldBox.discount, +(1 - 369.9 / 449.99).toFixed(4), 'desconto calculado com o MSRP oficial');
assert.equal(by((o) => /pre-venda|Pré-venda/i.test(o.title)).stock, 'PRE_ORDER');
assert.equal(s.sources.find((x) => x.id === 'blk').status, 'BLOCKED');
assert.equal(s.sources.find((x) => x.id === 'nope').status, 'PENDING');
assert.equal(s.coverage.found, 6);
const r1 = sentMsgs.length; assert.ok(sentMsgs.some((m) => m.title.includes('PREÇO-ALVO')), 'alvo R$350 atingido');
assert.ok(sentMsgs.every((m) => !/99,00/.test(m.text)), 'anomalia não alerta');

// Rodada 2: nada muda -> sem repetição
s = await runOnce({ log: quiet, send, now: new Date('2026-10-06T10:10:00Z') });
assert.equal(sentMsgs.length, r1, 'anti-spam');

// Rodada 3: queda na Shopify e restock na VTEX (com frete por CEP)
shopPrice = '329.00'; vtexQty = 4; process.env.HUNTER_CEP = '01310-100';
s = await runOnce({ log: quiet, send, now: new Date('2026-10-06T10:20:00Z') });
const v = s.offers.find((o) => o.storeId === 'vtex'); assert.equal(v.stock, 'IN_STOCK'); assert.equal(v.matchConfidence, 0.99, 'EAN oficial confirma o produto'); assert.equal(v.shipping, 19.9); assert.equal(v.total, 399.8); assert.equal(v.quantity, 4);
const novos = sentMsgs.slice(r1);
assert.ok(novos.some((m) => m.title.includes('QUEDA')), 'alerta de queda');
assert.ok(novos.some((m) => m.title.includes('PREÇO-ALVO') && /329,00/.test(m.text)), 'novo alvo com preço menor');
const hist = fs.readFileSync(path.join(tmp, 'data/history.jsonl'), 'utf8').trim().split('\n');
assert.ok(hist.length >= 8, 'histórico registra mudanças');
assert.equal(s.products.find((p) => p.id === 'me04-box36').lowestHistorical.total, 329);

fs.copyFileSync(path.join(tmp, 'data/state.json'), path.join(root, 'test/.demo-state.json'));

// Rodada 4: loja Shopify cai -> ofertas viram estoque desconhecido, saem do ranking
http.setFetch(async () => new Response('', { status: 503 }));
s = await runOnce({ log: quiet, send, now: new Date('2026-10-06T10:30:00Z') });
const stale = s.offers.find((o) => o.storeId === 'shop' && o.productId === 'me04-box36');
assert.equal(stale.stock, 'UNKNOWN'); assert.ok(stale.stale && !s.bestDeals.includes(stale.id));

console.log(`OK — todos os testes passaram (${sentMsgs.length} alertas). Exemplo:\n\n${sentMsgs[0].text}`);
