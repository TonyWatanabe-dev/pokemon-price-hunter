// Testes offline: fetch simulado com lojas Shopify, VTEX, JSON-LD e uma bloqueada.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
process.env.HUNTER_DOMAIN_DELAY_MS = '0';
// as rodadas simuladas são locais mesmo dentro do Actions: sem as variáveis de execução que o src/opstate.js lê
for (const k of ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_SHA', 'GITHUB_EVENT_NAME']) delete process.env[k];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hunter-'));
process.env.HUNTER_CONFIG_DIR = path.join(tmp, 'config'); process.env.HUNTER_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.HUNTER_CONFIG_DIR, { recursive: true });
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const cat = JSON.parse(fs.readFileSync(path.join(root, 'config/catalog.json')));
cat.copag['me04-box36'] = { msrp: 449.99, source_url: 'https://www.copag.com.br/exemplo-teste', confidence: 'OFICIAL', source_timestamp: '2026-10-01' };
cat.copag['me05-box36'] = { msrp: 449.99, source_url: 'https://www.mercadolivre.com.br/loja/copag', confidence: 'OFICIAL' };
fs.writeFileSync(path.join(tmp, 'config/catalog.json'), JSON.stringify(cat));
fs.writeFileSync(path.join(tmp, 'config/stores.json'), JSON.stringify({ stores: [
  { id: 'shop', name: 'Loja Shopify', url: 'https://shop.test', platform: 'auto', kind: 'specialist', evidence: { cnpj: '00.000.000/0001-00', rating: 4.8, reviewCount: 900, foundedYear: 2018, returnPolicyUrl: 'x', contact: 'x' } },
  { id: 'vtex', name: 'Loja VTEX', url: 'https://vtex.test', platform: 'auto', kind: 'specialist', evidence: {} },
  { id: 'ld', name: 'Loja Nuvem', url: 'https://ld.test', platform: 'auto', kind: 'specialist', evidence: {} },
  { id: 'waf', name: 'Loja com firewall nas APIs', url: 'https://waf.test', platform: 'auto', kind: 'specialist', evidence: {} },
  { id: 'blk', name: 'Bloqueada', url: 'https://blk.test', platform: 'auto', kind: 'specialist', evidence: {} },
  { id: 'nope', name: 'Sem domínio', url: null, platform: 'auto', kind: 'specialist', evidence: {} },
  { id: 'cop', name: 'Loja Copag (oficial)', url: 'https://cop.test', platform: 'vtex', kind: 'official', copagSource: true, evidence: { officialStore: true, cnpj: 'x' } },
] }));
fs.copyFileSync(path.join(root, 'config/watchlist.json'), path.join(tmp, 'config/watchlist.json'));
fs.writeFileSync(path.join(tmp, 'config/lojas.txt'), '# comentário\nnova.test\nhttps://www.shop.test/qualquer\nhttps://www.amazon.com.br/\n');
fs.writeFileSync(path.join(tmp, 'config/pistas.json'), JSON.stringify({ pelando: { buscas: ['pokemon tcg'] }, telegram: ['https://t.me/promopoke', '@grupo_privado'], descontoMinimoAlerta: 0.15 }));
fs.mkdirSync(path.join(tmp, 'config/lojas'));
fs.mkdirSync(path.join(tmp, 'config/alertas')); fs.writeFileSync(path.join(tmp, 'config/alertas/c30-blister2-abaixo-70.json'), JSON.stringify({ label: 'Blister Duplo 30 Anos até R$ 70', mode: 'target', filter: { productId: 'c30-blister2' }, maxPrice: 70 })); fs.writeFileSync(path.join(tmp, 'config/lojas/botao.test.txt'), 'https://botao.test\n');

let shopPrice = '339.00'; let vtexQty = 0;
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const html = (s, status = 200) => new Response(s, { status, headers: { 'content-type': 'text/html' } });
const page = (name, price, avail, extra = '') => html(`<html><head><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', name, offers: { '@type': 'Offer', price, priceCurrency: 'BRL', availability: 'https://schema.org/' + avail } })}</script></head><body><h1>${name}</h1><p>R$ ${Number(price).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}</p>${extra}${'x'.repeat(40000)}</body></html>`);
const http = await import('../src/http.js');
const requested = [];
const mainFetch = async (url, opt) => {
  const u = new URL(url); requested.push(url);
  if (u.host === 'blk.test') return html('Just a moment...', 403);
  if (u.host === 'waf.test') {
    if (u.pathname === '/products.json' || u.pathname.startsWith('/api/')) return html('Forbidden', 403);
    if (u.pathname === '/') return html('<title>Loja Pokémon</title>');
    if (u.pathname === '/sitemap.xml') return html('<urlset><url><loc>https://waf.test/pokemon-blister-triplo-caos-ascendente</loc></url></urlset>');
    if (u.pathname === '/pokemon-blister-triplo-caos-ascendente') return page('Pokémon Blister Triplo Caos Ascendente Copag', '39.90', 'InStock');
  }
  if (u.pathname === '/robots.txt') return u.host === 'ld.test' ? html('User-agent: *\nDisallow: /admin\nDisallow: /*bloqueado') : html('', 404);
  if (u.host === 'shop.test') {
    if (u.pathname === '/products.json') return json({ products: [] });
    if (u.pathname === '/search/suggest.json' && /30 Anos/i.test(u.searchParams.get('q'))) return json({ resources: { results: { products: [
      { title: 'Pokémon - Celebração de 30 Anos - Blister Duplo com Moeda Copag', url: '/products/c30-duplo', price: '59.90', available: true },
      { title: 'Celebração de 30 anos – Box Pokémon Ex Greninja', url: '/products/c30-greninja', price: '149.90', available: true },
    ] } } });
    if (u.pathname === '/search/suggest.json') return json({ resources: { results: { products: /caos/i.test(u.searchParams.get('q')) ? [
      { title: 'Pokémon TCG Booster Box c/36 - Caos Ascendente - Copag Lacrado', url: '/products/box-caos', price: shopPrice, available: true, image: '//cdn.shop.test/caos.jpg', variants: [{ id: 1, title: 'Default Title', price: shopPrice, available: true }] },
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
    if (u.pathname === '/pokemon-booster-box-escuridao-absoluta-36') return page('Pokémon Booster Box Escuridão Absoluta 36 Pacotes Copag', '389.90', 'InStock', '<span>R$ 389,90</span> <span>R$ 369,90 no Pix</span>');
    if (u.pathname === '/pokemon-box-caos-ascendente-pre-venda') return page('Pré-venda Pokémon Booster Box Caos Ascendente 36 boosters', '359.90', 'PreOrder');
    if (u.pathname === '/pokemon-box-bloqueado') throw new Error('robots deveria ter barrado');
  }
  if (u.host === 'www.pelando.com.br' && u.pathname === '/busca/pokemon-tcg') return html(`<main>
    <article><a href="/d/blister-triplo-pokemon-tcg-30-anos-lucario-e972"><img alt=""></a><a href="/d/blister-triplo-pokemon-tcg-30-anos-lucario-e972">Blister Triplo Pokémon TCG 30 Anos Lucario</a><span>R$129</span><a href="/cupons-de-descontos/amazon">Amazon</a></article>
    <article><a href="/d/box-pokemon-tcg-caos-ascendente-36-boosters-5c8c">Booster Box Pokémon Caos Ascendente 36 boosters Copag</a><span>R$ 319,90</span><a href="/cupons-de-descontos/mercado-livre">Mercado Livre</a></article>
    <article><a href="/d/box-velho-esgotado-aaaa">Booster Box Pokémon Caos Ascendente 36 boosters</a><span>R$ 300</span><span>Promoção expirada</span></article></main>`);
  if (u.host === 't.me' && u.pathname === '/s/promopoke') return html(`<div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message js-widget_message" data-post="promopoke/77"><div class="tgme_widget_message_text js-message_text" dir="auto">🔥 Box Treinador Avançado Escuridão Absoluta<br/>Por R$ 299,90<br/><a href="https://www.amazon.com.br/dp/B0TEST">https://www.amazon.com.br/dp/B0TEST</a></div><a class="tgme_widget_message_date" href="https://t.me/promopoke/77"><time datetime="${new Date().toISOString()}" class="time">10:00</time></a></div></div>`);
  if (u.host === 't.me' && u.pathname === '/s/grupo_privado') return html('<html>If you have Telegram, you can contact</html>');
  if (u.host === 'www.amazon.com.br') return html('blocked', 503);
  return html('', 404);
};
http.setFetch(mainFetch);

const { runOnce } = await import('../src/run.js');
const sentMsgs = []; const send = { capture: async (m) => { sentMsgs.push(m); return true; } };
const quiet = () => {};

// Rodada 1
let s = await runOnce({ log: quiet, send, now: new Date('2026-10-06T10:00:00Z') });
const by = (fn) => s.offers.find(fn);
const shopBox = by((o) => o.storeId === 'shop' && o.productId === 'me04-box36' && o.price === 339);
assert.ok(shopBox, 'box Shopify casada');
assert.equal(shopBox.image, 'https://cdn.shop.test/caos.jpg', 'foto do anúncio capturada');
assert.equal(s.products.find((p) => p.id === 'me04-box36').image, 'https://cdn.shop.test/caos.jpg', 'produto herda a foto');
{ const h = s.products.find((p) => p.id === 'me04-box36').hist; assert.ok(h && h.days >= 1 && typeof h.drop7d === 'number', 'produto traz resumo do histórico');
  assert.ok(Array.isArray(s.collections[0].aliases), 'coleções trazem apelidos para a busca'); }
assert.ok(Array.isArray(s.activity), 'estado traz a atividade do mercado');
assert.equal(shopBox.discount, 0.2466); assert.equal(shopBox.perBooster, 9.42); assert.equal(shopBox.priceKind, 'base');
assert.ok(shopBox.storeValidated, 'loja com evidências fica validada');
// 6C.3: o robô não calcula mais nota própria; nada de Deal Score, classificação, selo 🔥 ou nota oficial gravados nas ofertas
assert.ok(s.offers.every((o) => !('dealScore' in o) && !('scoreParts' in o) && !('classification' in o) && !('opportunity' in o) && !('opp' in o)), 'sem nota legada nem nota oficial no state.json');
{ const stOff = JSON.parse(fs.readFileSync(path.join(process.env.HUNTER_DATA_DIR, 'offers.json'), 'utf8'));
  assert.ok(Object.values(stOff).every((o) => !('dealScore' in o) && !('opportunity' in o) && !('opp' in o)), 'offers.json também sem nota'); }
// sem banco (este teste roda sem DATABASE_URL): bestDeals só com desconto Copag, ordenado por desconto, depois total e id
{ const O = new Map(s.offers.map((o) => [o.id, o])); const bd = s.bestDeals.map((id) => O.get(id));
  assert.ok(bd.length && bd.every((o) => o && o.discount != null && o.stock === 'IN_STOCK' && !o.stale && o.confirmed !== false), 'bestDeals: ao vivo, confirmadas, com desconto');
  assert.ok(bd.every((o, i) => i === 0 || bd[i - 1].discount > o.discount || (bd[i - 1].discount === o.discount && (bd[i - 1].total < o.total || (bd[i - 1].total === o.total && String(bd[i - 1].id) < String(o.id))))), 'bestDeals sem nota: desconto, total, id'); }
assert.ok(!s.offers.some((o) => /EN$/.test(o.title)), 'inglês rejeitado');
assert.ok(s.unmatched.some((u) => /EN$/.test(u.title)), 'inglês listado para revisão');
assert.ok(!by((o) => o.price === 99), 'preço anormal não é publicado');
{ const rv = JSON.parse(fs.readFileSync(path.join(process.env.HUNTER_DATA_DIR, 'review.json'), 'utf8')); const susp = rv.find((o) => o.total === 99);
  assert.ok(susp && !s.bestDeals.includes(susp.id) && s.totals.review >= 1, 'preço anormal vai para conferência'); }
const etb = by((o) => o.productId === 'me04-etb'); assert.equal(etb.discount, null); assert.ok(!s.bestDeals.includes(etb.id), 'sem Copag e sem nota oficial: fora do bestDeals');
const vtexOff = by((o) => o.storeId === 'vtex'); assert.equal(vtexOff.stock, 'OUT_OF_STOCK'); assert.ok(!s.bestDeals.includes(vtexOff.id));
const ldBox = by((o) => o.productId === 'me05-box36'); assert.equal(ldBox.price, 369.9); assert.equal(ldBox.priceKind, 'pix', 'Pix tem prioridade');
const me05 = s.products.find((p) => p.id === 'me05-box36');
assert.equal(me05.copagConfirmed, true, 'MSRP capturado na loja oficial substitui o de marketplace');
assert.equal(me05.msrp, 449.99); assert.match(me05.copag.source_url, /cop\.test/);
assert.equal(ldBox.discount, +(1 - 369.9 / 449.99).toFixed(4), 'desconto calculado com o MSRP oficial');
assert.equal(by((o) => /pre-venda|Pré-venda/i.test(o.title)).stock, 'PRE_ORDER');
assert.equal(s.sources.find((x) => x.id === 'blk').status, 'BLOCKED');
assert.equal(s.sources.find((x) => x.id === 'nope').status, 'PENDING');
assert.equal(s.coverage.found, 10, 'lojas.txt e config/lojas/ adicionam lojas e ignoram duplicadas');
assert.equal(s.sources.find((x) => x.id === 'amazoncombr').status, 'UNAVAILABLE', 'marketplace grande não é rastreado');
assert.ok(!requested.some((u) => /amazon/.test(u)), 'nenhuma requisição para a Amazon');
assert.ok(s.sources.find((x) => x.id === 'botaotest'), 'loja criada pelo botão monitorada');
assert.ok(s.sources.find((x) => x.id === 'novatest'), 'loja do lojas.txt monitorada');
const duplo = by((o) => o.productId === 'c30-blister2');
const pd = s.products.find((p) => p.id === 'c30-blister2');
assert.ok(duplo && duplo.discount != null && pd.copagConfirmed && pd.msrp === 69.99, 'tabela 30 anos confirmada à mão vale como oficial');
{ const { copagStatus } = await import('../src/score.js');
  const st = copagStatus({ copag: { msrp: 115.99, source_url: 'https://blog.test/x', confidence: 'CATALOGO_COPAG' } });
  assert.ok(!st.confirmed && st.reference === 115.99, 'catálogo divulgado por terceiros continua só referência'); }
const gren = by((o) => o.productId === 'c30-colecao_ex-greninja');
assert.ok(gren && s.products.find((p) => p.id === 'c30-colecao_ex-greninja').msrp === 160.99, 'variante herda o preço do Box ex');
assert.ok(s.types.some((t) => t.id === 'blister_2') && s.collections.some((c) => c.id === 'c30'), 'filtros gerados a partir dos dados');
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

// Rodada 3b: prazo esgotado -> lojas puladas mantêm a leitura recente, sem virar "estoque desconhecido"
const cache = JSON.parse(fs.readFileSync(path.join(tmp, 'data/url-cache.json'), 'utf8'));
assert.ok(cache.ld.candidates.length === 3 && cache.ld.relevant.length === 2, 'sitemap em cache e páginas relevantes guardadas');
process.env.HUNTER_BUDGET_MIN = '0';
s = await runOnce({ log: quiet, send, now: new Date('2026-10-06T10:25:00Z') });
const kept = s.offers.find((o) => o.storeId === 'shop' && o.productId === 'me04-box36' && o.price === 329);
assert.ok(kept && !kept.stale && kept.stock === 'IN_STOCK', 'oferta recente preservada quando a loja fica para a próxima rodada');
delete process.env.HUNTER_BUDGET_MIN;
fs.copyFileSync(path.join(tmp, 'data/state.json'), path.join(root, 'test/.demo-state.json'));

// Rodada 4: loja Shopify cai -> ofertas viram estoque desconhecido, saem do ranking
http.setFetch(async () => new Response('', { status: 503 }));
s = await runOnce({ log: quiet, send, now: new Date('2026-10-06T10:30:00Z') });
const stale = s.offers.find((o) => o.storeId === 'shop' && o.productId === 'me04-box36');
assert.equal(stale.stock, 'UNKNOWN'); assert.ok(stale.stale && !s.bestDeals.includes(stale.id));


// --- 403 só nas rotas de teste de plataforma não é bloqueio da loja ---
{
  const w = s.sources.find((x) => x.id === 'waf');
  assert.equal(w.status, 'ACTIVE', 'loja com 403 só em /products.json e /api fica ativa: ' + w.reason);
  assert.equal(w.platform, 'jsonld');
  assert.equal(s.sources.find((x) => x.id === 'blk').status, 'BLOCKED', 'bloqueio real na home continua bloqueio');
}
// --- alerta criado pelo site (config/alertas/*.json), sem exigir Copag oficial para preço-alvo em R$ ---
{
  assert.ok(s.rules.some((r) => r.id === 'c30-blister2-abaixo-70' && r.file === 'config/alertas/c30-blister2-abaixo-70.json'), 'regra do arquivo carregada');
  assert.ok(sentMsgs.some((m) => /Blister Duplo/i.test(m.text) && /59,90/.test(m.text)), 'preço-alvo dispara mesmo sem Copag oficial');
}
// --- página com vários Product no JSON-LD (relacionados): fica com o da própria página ---
{
  const { parseProductPage } = await import('../src/adapters/jsonld.js');
  const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
  const rel = { '@type': 'Product', name: 'Pokémon - Blister Quádruplo Megaevolução - Equilíbrio Perfeito - Chikorita (PT-BR)', url: 'https://x.test/produtos/blister-chikorita/', offers: { '@type': 'Offer', price: '55.90', priceCurrency: 'BRL', availability: 'https://schema.org/InStock' } };
  const own = { '@type': 'Product', name: 'Pokémon - Box Display Megaevolução - Equilíbrio Perfeito 36 Pacotes (PT-BR)', offers: { '@type': 'Offer', price: '449.90', priceCurrency: 'BRL', availability: 'https://schema.org/InStock' } };
  const head = '<meta property="og:title" content="Pokémon - Box Display Megaevolução - Equilíbrio Perfeito 36 Pacotes (PT-BR)">';
  const a = parseProductPage(head + ld(rel) + ld(own) + '<p>R$ 449,90</p>', 'https://x.test/produtos/box-display-equilibrio/');
  assert.match(a.title, /Box Display/); assert.equal(a.price.base, 449.9, 'preço do produto da página, não do relacionado');
  const b = parseProductPage(head + ld(rel), 'https://x.test/produtos/box-display-equilibrio/');
  assert.equal(b, null, 'só o relacionado no JSON-LD e sem preço próprio: não publica (nunca usa o preço do relacionado)');
  const c = parseProductPage('<meta property="og:title" content="Blister Chikorita - Loja X">' + ld({ ...rel, url: undefined }) + '<p>R$ 55,90</p>', 'https://x.test/produtos/blister-chikorita/');
  assert.equal(c.price.base, 55.9, 'produto único com nome compatível continua valendo');
}
// --- Nuvemshop: o produto da página vem de LS.product/LS.variants; JSON-LD só tem vitrine de outros produtos ---
{
  const { parseProductPage } = await import('../src/adapters/jsonld.js');
  const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
  const rel = { '@type': 'Product', name: 'Blister Quadrúplo Pokémon Megaevolução Escuridão Absoluta - ME05', offers: { '@type': 'Offer', price: '55', priceCurrency: 'BRL', url: 'https://g.test/produtos/blister-me05/', availability: 'https://schema.org/InStock' } };
  const vars = [{ product_id: 1, price_number: 44, price_with_payment_discount_short: 'R$41,80', compare_at_price_number: 55, stock: 8, sku: 'ME04-04', available: true, is_visible: true }, { product_id: 2, price_number: 52, available: true }];
  const htmlNs = `<meta property="og:title" content="Blister Quadrúplo Pokémon Caos Ascendente - ME04">${ld(rel)}<script>LS.product = {\n id : 1,\n name : 'Blister\\u0020Quadr\\u00FAplo\\u0020Pok\\u00E9mon\\u0020Caos\\u0020Ascendente\\u0020\\u002D\\u0020ME04'\n};\nLS.variants = ${JSON.stringify(vars)};\n</script><p>R$44,00</p><p>3 x de R$16,31</p><p>5% de desconto pagando com Pix</p>`;
  const n = parseProductPage(htmlNs, 'https://g.test/produtos/blister-me04/');
  assert.match(n.title, /Caos Ascendente/, 'título do produto da página, não da vitrine');
  assert.equal(n.price.base, 44); assert.equal(n.price.pix, 41.8, 'Pix da própria variação'); assert.equal(n.stock, 'IN_STOCK'); assert.equal(n.quantity, 8);
  // Loja Integrada esgotada: preço via microdata, estoque esgotado; Pix dos "relacionados" é ignorado
  const li = '<meta property="og:title" content="Pokemon TCG: Escuridão Absoluta - Treinador Avançado"><div itemprop="offers"><meta itemprop="price" content="399.90"/><meta itemprop="availability" content="http://schema.org/OutOfStock"/></div><p>Ops! Esse produto encontra-se indisponível.</p><h2>Produtos relacionados</h2><p>Blister Unitário R$ 13,90 ou R$ 13,20 via Pix</p>';
  const l = parseProductPage(li, 'https://d.test/pokemon-tcg-escuridao-absoluta-treinador-avancado');
  assert.equal(l.price.base, 399.9); assert.equal(l.price.pix, null, 'Pix de produto relacionado não vale'); assert.equal(l.stock, 'OUT_OF_STOCK');
  // Preço precisa estar escrito na página (loja que só mostra "Fale conosco" não entra)
  const hidden = '<meta property="og:title" content="Blister Quádruplo Caos Ascendente - Pokemon Tcg">' + ld({ '@type': 'Product', name: 'Blister Quádruplo Caos Ascendente - Pokemon Tcg', offers: { '@type': 'Offer', price: '50.44', priceCurrency: 'BRL', availability: 'https://schema.org/InStock' } }) + '<p>Fale conosco</p>';
  assert.equal(parseProductPage(hidden, 'https://s.test/blister-quadruplo-caos-ascendente-pokemon-tcg'), null, 'preço que não aparece na página não é publicado');
  // Loja Integrada / WooCommerce: o código traz o preço do Pix como se fosse o normal
  const liPix = '<meta property="og:title" content="Blister Triplo Caos Ascendente ME04 - Pokémon"><div itemprop="offers"><meta itemprop="price" content="39.90"/><meta itemprop="availability" content="http://schema.org/InStock"/></div><p>Blister Triplo Caos Ascendente ME04 - Pokémon</p><strong>R$ 42,00</strong> <span>ou <strong>R$ 39,90</strong> via Pix</span>';
  const lp = parseProductPage(liPix, 'https://l.test/blister-triplo-caos-ascendente-me04-pokemon');
  assert.equal(lp.price.pix, 39.9); assert.equal(lp.price.base, 42, 'Pix não se passa por preço normal');
  const woo = '<meta property="og:title" content="Pokémon Blister Quádruplo Caos Ascendente">' + ld({ '@type': 'Product', name: 'Pokémon Blister Quádruplo Caos Ascendente', offers: { '@type': 'Offer', price: '53.91', priceCurrency: 'BRL', availability: 'https://schema.org/InStock' } }) + '<p>&#082;&#036;&nbsp;59,90 &#082;&#036;&nbsp;53,91 no pix</p>';
  const w = parseProductPage(woo, 'https://a.test/pokemon-blister-quadruplo-caos-ascendente/');
  assert.equal(w.price.pix, 53.91); assert.equal(w.price.base, 59.9, 'WooCommerce: Pix separado do preço normal');
  // Trava do link: título de uma coleção com link de outra não publica
  const { linkAgrees } = await import('../src/gate.js'); const { matchProduct } = await import('../src/match.js');
  const cat = JSON.parse(fs.readFileSync(path.join(process.env.HUNTER_CONFIG_DIR, 'catalog.json'), 'utf8'));
  const bad = { title: 'Blister Quadrúplo Pokémon Caos Ascendente - ME04', url: 'https://g.test/produtos/blister-quadruplo-pokemon-tcg-escuridao-absoluta-me05-25-cartas/' };
  assert.equal(linkAgrees(bad, matchProduct(bad, cat), cat).ok, false, 'link de outra coleção bloqueia');
  const good = { title: 'Combo de Booster 18 Pacotes Coleção 151', url: 'https://c.test/produtos/combo-de-booster-18-pacotes-colecao-151-escarlate-e-violeta-3-5' };
  assert.equal(linkAgrees(good, matchProduct(good, cat), cat).ok, true, '"3-5" no link é 3.5');
  // Coleção genérica com nome próprio não casa com a coleção do catálogo
  assert.equal(matchProduct({ title: 'Box de 30 Anos de Pokémon - Coleção Dia de Pokémon 2026' }, cat).productId, null, 'coleção com nome diferente não casa');
  assert.notEqual(matchProduct({ title: 'Kit Colecionável Pokémon Celebração 30 Anos com Fichário + 6 Booster' }, cat).productId, 'c30-combo6', 'fichário com 6 boosters não é combo');
}
{
  const { firstPrice } = await import('../src/tips.js');
  assert.equal(firstPrice('R$ 399,99 ➡️ R$ 251,99 🟢 37% OFF\n💳 ou 12x de R$ 27,39'), 251.99, 'parcela não é preço');
  assert.equal(firstPrice('R$ 129,99 ➡️ R$ 116,99\n💳 Tem cartão Porto Bank Visa? sai por R$ 110,49'), 116.99, 'preço condicionado a cartão não vale');
}
// --- histórico por produto e loja ---
{
  const h = JSON.parse(fs.readFileSync(path.join(process.env.HUNTER_DATA_DIR, 'hist/me04-box36.json'), 'utf8'));
  assert.ok(h.stores.shop && h.stores.vtex, 'histórico por loja');
  assert.ok(Object.values(h.stores).every((x) => x.pts.every((pt) => pt[1] > 200)), 'preço suspeito (R$ 99) fora do histórico');
  assert.equal(h.stores.shop.pts.at(-1)[1], 329, 'menor preço do dia da loja');
}
// --- regressões do teste ao vivo (07/10) ---
{
  const { parseListing, msrpKeys } = await import('../src/match.js');
  const catT = JSON.parse(fs.readFileSync(new URL('../config/catalog.json', import.meta.url)));
  const P = (t) => parseListing(t, catT);
  const chk = (t, col, type) => { const p = P(t); assert.equal(p.collection, col, t); assert.equal(p.type, type, t); };
  chk('Blister Triplo EV8,5 - Evoluções Prismáticas - Pokémon', 'sv8_5', 'blister_3');
  chk('Jogo De Cartas - Pokémon - EV10.5 - Coleção Ilustração Fogo Branco E Raio Preto - Copag', 'sv10_5', 'colecao_ilustracao');
  chk('Jogo De Cartas - Pokémon - EV10.5 - Blister Triplo - Fogo Branco - Copag', 'sv10_5w', 'blister_3');
  chk('Pokémon TCG Triplo Megaevolução Drifloon Copag', 'me01', 'blister_3');
  chk('BLISTER PLAST. UNITARIO POKEMON TCG MEGAEVOLUCAO CAOS ASCENDENTE - COPAG', 'me04', 'blister_1');
  chk('Blister Triplo Heróis Excelsos ME2.5 - Pokémon', 'me02_5', 'blister_3');
  // combo com quantidade conhecida não herda o preço Copag do combo genérico
  assert.ok(!msrpKeys({ id: 'me05-combo7', collection: 'me05', type: 'combo', boosters: 7 }).includes('me05-combo'), 'combo7 não herda preço do combo');
  assert.ok(msrpKeys({ id: 'me05-combo', collection: 'me05', type: 'combo', boosters: null }).includes('me05-combo'));
}

// --- pistas (Pelando/Telegram) e bot ---
{
  const tips = s.tips || []; if (process.env.DBG) console.log(JSON.stringify({tips, src: s.tipSources}, null, 1));
  const box = tips.find((t) => /5c8c$/.test(t.url));
  assert.ok(box && box.price === 319.9 && box.store === 'Mercado Livre', 'pista do Pelando identificada');
  assert.equal(box.msrp, 449.99); assert.ok(box.discount > 0.28);
  assert.ok(tips.find((t) => /box-velho/.test(t.url))?.expired, 'promoção expirada marcada');
  const tg = tips.find((t) => t.source === 'Telegram promopoke');
  assert.ok(tg && tg.productId === 'me05-etb' && tg.price === 299.9 && tg.store === 'Amazon', 'pista do Telegram identificada');
  assert.ok(s.tipSources.some((x) => /grupo_privado/.test(x.source) && !x.ok), 'canal privado reportado');
  assert.ok(!s.offers.some((o) => /pelando|t\.me|amazon/.test(o.url)), 'pista nunca vira oferta');
  assert.ok(!s.bestDeals.some((id) => tips.some((t) => t.id === id)));
  const tipAlerts = s.recentAlerts.filter((a) => a.kind === 'tip');
  assert.equal(tipAlerts.length, 1, 'alerta de pista só para a box com desconto confirmado');
  assert.match(tipAlerts[0].text, /NÃO VERIFICADA/);
  const again = await runOnce({ log: quiet, send });
  assert.equal(again.recentAlerts.filter((a) => a.kind === 'tip').length, 1, 'pista não repete alerta');

  // Bot: mensagem encaminhada do WhatsApp com link da Amazon (bloqueado) -> usa o texto da mensagem
  http.setFetch(mainFetch);
  const { processInbox } = await import('../src/inbox.js');
  process.env.TELEGRAM_BOT_TOKEN = 'T'; process.env.TELEGRAM_CHAT_ID = '42';
  const replies = []; const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opt) => {
    if (/getUpdates/.test(url)) return json({ ok: true, result: [
      { update_id: 10, message: { message_id: 1, chat: { id: 999 }, text: 'Booster Box Caos Ascendente 36 boosters R$ 300' } },
      { update_id: 11, message: { message_id: 2, chat: { id: 42 }, text: 'CORRE!! Booster Box Pokémon Caos Ascendente 36 boosters por R$ 329,90 https://www.amazon.com.br/dp/B0X' } },
      { update_id: 12, message: { message_id: 3, chat: { id: 42 }, text: 'olha isso https://ld.test/pokemon-booster-box-escuridao-absoluta-36' } },
    ] });
    if (/sendMessage/.test(url)) { replies.push(JSON.parse(opt.body)); return json({ ok: true }); }
    throw new Error('inesperado ' + url);
  };
  const st = {}; const copagOf = (p) => (p.id === 'me04-box36' ? { msrp: 449.99 } : null);
  const r = await processInbox(st, cat, copagOf);
  if (process.env.DBG2) { console.log(replies.map((x) => x.text).join('\n-----\n')); console.log(tipAlerts[0].text); }
  globalThis.fetch = realFetch; delete process.env.TELEGRAM_BOT_TOKEN; delete process.env.TELEGRAM_CHAT_ID;
  assert.equal(r.handled, 2, 'só responde o seu chat'); assert.equal(st.offset, 13);
  assert.match(replies[0].text, /Caos Ascendente/); assert.match(replies[0].text, /Vale: 26,7% abaixo da Copag|26,7%/); assert.match(replies[0].text, /amazon\.com\.br (bloqueia|não abriu)/);
  assert.match(replies[1].text, /Escuridão Absoluta/); assert.match(replies[1].text, /Li a página \(ld\.test\)/); assert.match(replies[1].text, /369,90|389,90/); assert.match(replies[1].text, /em estoque/);
}
{ // Preço da pista: "De ... Por ..." vale o "Por"
  const { firstPrice } = await import('../src/tips.js');
  assert.equal(firstPrice('De: ❌ R$ 56,79 ❌ \nPor: R$ 46,00'), 46);
  assert.equal(firstPrice('De R$ 299,90 por R$ 249,90'), 249.9);
  assert.equal(firstPrice('Blister R$ 59,90 no Pix'), 59.9);
}
assert.ok(sentMsgs.every((m) => !/Deal Score/i.test(m.text) && !/Opportunity Score/.test(m.text)), 'sem banco: nenhum alerta com Deal Score, nem nota oficial inventada');
// Lote 1: cada rodada grava o estado operacional em data/meta.json → ops, sem apagar dataVersion/distrust
{
  const meta = JSON.parse(fs.readFileSync(path.join(process.env.HUNTER_DATA_DIR, 'meta.json'), 'utf8'));
  assert.ok(meta.dataVersion && meta.distrust, 'chaves antigas do meta.json preservadas');
  const runs = meta.ops.runs; const last = meta.ops.last;
  assert.ok(runs.length >= 5, 'um registro por rodada'); assert.equal(last.runId, 'local');
  assert.equal(last.reader.status, 'off'); assert.equal(last.dbSync.status, 'desligado'); assert.equal(last.health, 'degradado');
  assert.deepEqual(last.issues, ['leitor_desligado', 'banco_desligado']);
  assert.ok(last.stores.found > 0 && last.stores.active >= last.stores.withListings && last.stores.blocked >= 1, JSON.stringify(last.stores));
  assert.equal(last.stores.active, last.stores.withListings + last.stores.empty);
  assert.ok(Number.isFinite(last.durationSec) && last.offers > 0, 'duração e ofertas');
  const gen = runs.map((r) => r.generatedAt);
  assert.ok(runs.slice(1).some((r, i) => r.prevGeneratedAt === gen[i]), 'cada rodada aponta a anterior (base da checagem do banco)');
}
console.log(`OK — todos os testes passaram (${sentMsgs.length} alertas). Exemplo:\n\n${sentMsgs[0].text}`);
