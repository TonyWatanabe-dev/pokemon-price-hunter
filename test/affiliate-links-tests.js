// Links de afiliado do Mercado Livre (docs/afiliados.md): config central (config/affiliates.json, lida só por
// api/_lib/affiliates.mjs), destino trocado só na saída (outUrl em index.html) e só para anúncio do ML com link próprio.
// Prova também que ranking, melhor oferta e Opportunity Score são idênticos com e sem afiliado. Sem rede e sem banco.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { mlListingId, validDestination, parseAffiliates, loadAffiliates, resolveOutbound, publicAffiliates, DESTINATION_HOSTS } from '../api/_lib/affiliates.mjs';
import { productOpportunity, calculateOpportunity, oppOrder } from '../src/core/opportunity-engine.js';
import { byComparableTotal, bestComparable } from '../api/_lib/offer-rank.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
let n = 0;
const t = async (name, fn) => { try { await fn(); } catch (e) { e.message = `${name}: ${e.message}`; throw e; } n++; };

// URLs reais de anúncio do ML no formato que o coletor publica (src/adapters/mercadolivre.js) e de outras lojas
const ML_PDP = 'https://www.mercadolivre.com.br/p/MLB19876543?pdp_filters=item_id%3AMLB4455667788';   // catálogo + vendedor escolhido
const ML_ITEM = 'https://produto.mercadolivre.com.br/MLB-1234567890-booster-box-escarlate-_JM#position=1&search_layout=grid';
const ML_SEM_MAPA = 'https://produto.mercadolivre.com.br/MLB-9999999999-etb-_JM';
const ML_CATALOGO = 'https://www.mercadolivre.com.br/p/MLB19876543';                                 // sem vendedor: não é anúncio
const OUTRA = 'https://www.lojadotcg.com.br/produto/etb-caos?skuId=987#avaliacoes';
const OUTRA_COM_MLB = 'https://www.lojadotcg.com.br/MLB-1234567890-booster';                         // id parecido em outra loja
const AFIL_ITEM = 'https://meli.la/2AbCdEf';
const AFIL_PDP = 'https://mercadolivre.com.br/sec/1xYz9Q';
const CFG_RAW = { mercadolivre: { anuncios: { MLB1234567890: AFIL_ITEM, 'MLB-4455667788': AFIL_PDP,
  MLB1111111111: 'https://evil.example.com/x', MLB2222222222: 'http://meli.la/abc', MLB3333333333: 'javascript:alert(1)',
  MLB4444444444: 'https://meli.la.evil.com/x', MLB5555555555: 'https://user:pw@meli.la/x', MLB6666666666: 'https://meli.la:444/x',
  MLB7777777777: ' https://meli.la/x', MLB8888888888: 'https://meli.la/x"onmouseover=1', XYZ: 'https://meli.la/ok', MLB9: 'https://meli.la/ok' },
geral: { url: 'https://meli.la/1BzQ4PU', ativo: true, destinoConfirmado: true, rotulo: 'Ver mais no Mercado Livre' } } };
const CFG = parseAffiliates(CFG_RAW);

// ------------------------------------------------------------------ 1. módulo do servidor
await t('id do anúncio: só URL de anúncio do Mercado Livre', () => {
  assert.equal(mlListingId(ML_PDP), 'MLB4455667788');
  assert.equal(mlListingId(ML_ITEM), 'MLB1234567890');
  assert.equal(mlListingId('https://produto.mercadolivre.com.br/MLB1234567890'), 'MLB1234567890');
  assert.equal(mlListingId(ML_CATALOGO), null, 'página de catálogo sem vendedor não é anúncio');
  for (const u of [OUTRA, OUTRA_COM_MLB, 'https://mercadolivre.com.br.evil.com/MLB-1234567890-x', 'javascript:alert(1)', '', null, undefined, 123, 'MLB-1234567890'])
    assert.equal(mlListingId(u), null, String(u));
});

await t('destino validado: https, domínio do ML, sem credencial/porta/espaço/aspas', () => {
  for (const ok of ['https://meli.la/1BzQ4PU', AFIL_PDP, 'https://produto.mercadolivre.com.br/MLB-1-x']) assert.equal(validDestination(ok), ok);
  for (const bad of ['http://meli.la/x', 'https://meli.la', 'https://evil.com/x', 'https://meli.la.evil.com/x', 'https://user:pw@meli.la/x', 'https://meli.la:444/x',
    ' https://meli.la/x', 'https://meli.la/x y', 'https://meli.la/x"y', 'javascript:alert(1)', 'data:text/html,x', '//meli.la/x', '', null, 1, {}])
    assert.equal(validDestination(bad), null, String(bad));
  assert.deepEqual([...DESTINATION_HOSTS].sort(), ['meli.la', 'mercadolivre.com.br', 'produto.mercadolivre.com.br', 'www.mercadolivre.com.br']);
});

await t('config: só entradas válidas entram; inválidas ficam de fora sem quebrar', () => {
  assert.deepEqual(CFG.anuncios, { MLB1234567890: AFIL_ITEM, MLB4455667788: AFIL_PDP });
  assert.deepEqual(CFG.rejeitados, ['MLB1111111111', 'MLB2222222222', 'MLB3333333333', 'MLB4444444444', 'MLB5555555555', 'MLB6666666666', 'MLB7777777777', 'MLB8888888888', 'XYZ', 'MLB9']);
  assert.deepEqual(CFG.geral, { url: 'https://meli.la/1BzQ4PU', rotulo: 'Ver mais no Mercado Livre' });
  // link geral só aparece com ativo E destino confirmado
  for (const g of [{ ativo: true }, { destinoConfirmado: true }, { ativo: 'sim', destinoConfirmado: true }, {}])
    assert.equal(parseAffiliates({ mercadolivre: { geral: { url: 'https://meli.la/1BzQ4PU', ...g } } }).geral, null, JSON.stringify(g));
  assert.equal(parseAffiliates({ mercadolivre: { geral: { url: 'https://evil.com/x', ativo: true, destinoConfirmado: true } } }).geral, null);
});

await t('config ausente, vazia ou quebrada: tudo como hoje (URL original)', () => {
  for (const raw of [null, undefined, {}, [], 'x', { mercadolivre: null }, { mercadolivre: { anuncios: [] } }, { mercadolivre: { anuncios: 'x' } }]) {
    const c = parseAffiliates(raw); assert.deepEqual(c.anuncios, {}); assert.equal(c.geral, null);
    for (const u of [ML_PDP, ML_ITEM, OUTRA]) assert.equal(resolveOutbound(u, c), u);
  }
  const missing = loadAffiliates({ file: path.join(ROOT, 'config', 'nao-existe.json'), fresh: true });
  assert.deepEqual(missing.anuncios, {}); assert.equal(missing.geral, null);
  loadAffiliates({ fresh: true });   // volta ao arquivo real
});

await t('config do repositório: mapa vazio, link geral guardado mas desligado (destino não confirmado)', () => {
  const raw = JSON.parse(read('config/affiliates.json'));
  assert.deepEqual(raw.mercadolivre.anuncios, {}, 'nenhum anúncio recebe link sem link gerado para ele');
  assert.equal(raw.mercadolivre.geral.url, 'https://meli.la/1BzQ4PU', 'link do dono guardado sem alteração');
  assert.equal(raw.mercadolivre.geral.ativo, false); assert.equal(raw.mercadolivre.geral.destinoConfirmado, false);
  const c = loadAffiliates({ fresh: true });
  assert.deepEqual(publicAffiliates(c), { v: 1, anuncios: {}, geral: null });
  for (const u of [ML_PDP, ML_ITEM, OUTRA]) assert.equal(resolveOutbound(u), u, 'sem associação: URL original');
});

await t('resolvedor: ML com link próprio -> afiliado; ML sem link, outra loja e destino inválido -> URL original intacta', () => {
  assert.equal(resolveOutbound(ML_ITEM, CFG), AFIL_ITEM);
  assert.equal(resolveOutbound(ML_PDP, CFG), AFIL_PDP);
  assert.equal(resolveOutbound(ML_SEM_MAPA, CFG), ML_SEM_MAPA);
  assert.equal(resolveOutbound(ML_CATALOGO, CFG), ML_CATALOGO);
  assert.equal(resolveOutbound(OUTRA, CFG), OUTRA, 'outra loja nunca vira link do ML');
  assert.equal(resolveOutbound(OUTRA_COM_MLB, CFG), OUTRA_COM_MLB, 'id parecido em outra loja não troca');
  assert.equal(resolveOutbound('https://produto.mercadolivre.com.br/MLB-1111111111-x', CFG), 'https://produto.mercadolivre.com.br/MLB-1111111111-x', 'destino não permitido: URL original');
  assert.equal(resolveOutbound('https://produto.mercadolivre.com.br/MLB-2222222222-x', CFG), 'https://produto.mercadolivre.com.br/MLB-2222222222-x');
  // link geral nunca vai para anúncio
  assert.ok(!Object.values(CFG.anuncios).includes(CFG.geral.url));
  for (const u of [ML_SEM_MAPA, ML_CATALOGO, OUTRA]) assert.notEqual(resolveOutbound(u, CFG), CFG.geral.url);
  // o destino é o link do painel inteiro: nada anexado à URL da loja, nada montado
  for (const u of [ML_ITEM, ML_PDP]) { const out = resolveOutbound(u, CFG); assert.ok(Object.values(CFG.anuncios).includes(out)); assert.ok(!out.includes(u)); }
});

// ------------------------------------------------------------------ 2. API: GET /api/v1/afiliados (sem banco)
await t('GET /api/v1/afiliados devolve só a config validada, sem banco nem state.json', async () => {
  const { default: api } = await import('../api/v1.mjs');
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  await api({ url: '/api/v1/afiliados', method: 'GET' }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { v: 1, anuncios: {}, geral: null });
  assert.match(res.headers['Cache-Control'], /s-maxage/);
  assert.equal(res.headers['X-Data-Source'], undefined, 'não passa pela leitura de dados');
  const vj = JSON.parse(read('vercel.json'));
  assert.match(vj.functions['api/v1.mjs'].includeFiles, /config\/affiliates\.json/, 'a função leva a config junto');
});

// ------------------------------------------------------------------ 3. página: outUrl real de index.html
const html = read('index.html');
const line = (name) => { const m = html.match(new RegExp(`^(?:const|let) ${name}\\s*=.*$`, 'm')); assert.ok(m, `index.html: ${name} não encontrado`); return m[0]; };
const page = (anuncios = {}) => {
  const ctx = { String, RegExp, URL, Object }; vm.createContext(ctx);
  vm.runInContext(`${line('esc')}\n${line('safeUrl')}\n${line('AFIL')}\n${line('AFIL_OK')}\n${line('mlItem')}\n${line('outUrl')}\n${line('outRel')}\n;AFIL.anuncios=${JSON.stringify(anuncios)};globalThis.__t={esc,safeUrl,outUrl,outRel,mlItem,AFIL};`, ctx);
  return ctx.__t;
};

await t('página: sem config (padrão), todo link de oferta sai exatamente igual', () => {
  const { outUrl, esc, safeUrl, AFIL } = page();
  assert.deepEqual(JSON.parse(JSON.stringify(AFIL)), { anuncios: {}, geral: null });
  for (const u of [ML_PDP, ML_ITEM, ML_SEM_MAPA, OUTRA, 'javascript:alert(1)', '', null, undefined]) {
    assert.equal(outUrl(u), u);
    assert.equal(esc(safeUrl(outUrl(u))), esc(safeUrl(u)), 'o href final é o mesmo de antes');
  }
});

await t('página: mesmos destinos que o servidor, com o mapa que o servidor publica', () => {
  const { outUrl, mlItem } = page(publicAffiliates(CFG).anuncios);
  for (const u of [ML_PDP, ML_ITEM, ML_SEM_MAPA, ML_CATALOGO, OUTRA, OUTRA_COM_MLB, 'javascript:alert(1)', 'https://mercadolivre.com.br.evil.com/MLB-1234567890-x']) {
    assert.equal(outUrl(u), resolveOutbound(u, CFG), u);
    assert.equal(mlItem(u), mlListingId(u), u);
  }
  assert.equal(outUrl(ML_ITEM), AFIL_ITEM); assert.equal(outUrl(OUTRA), OUTRA);
});

await t('página: mapa adulterado no navegador não leva a destino fora do ML', () => {
  const { outUrl, safeUrl } = page({ MLB1234567890: 'https://evil.com/x', MLB4455667788: 'javascript:alert(1)', MLB9999999999: 'https://meli.la/ok"><img src=x>' });
  for (const u of [ML_ITEM, ML_PDP, ML_SEM_MAPA]) assert.equal(outUrl(u), u, 'fallback seguro: URL original');
  const { outUrl: o2 } = page({ toString: 'https://meli.la/x', __proto__: 'x', constructor: 'https://meli.la/y' });
  assert.equal(o2(ML_ITEM), ML_ITEM); assert.equal(safeUrl(o2('x')), '#');
});

await t('página: link de afiliado sai com rel sponsored (como os da Amazon); URL original da loja só com noopener', () => {
  const { outRel } = page(publicAffiliates(CFG).anuncios);
  for (const u of [ML_ITEM, ML_PDP]) assert.equal(` rel="noopener${outRel(u)}"`, ' rel="noopener nofollow sponsored"', u);
  for (const u of [ML_SEM_MAPA, ML_CATALOGO, OUTRA, OUTRA_COM_MLB, 'javascript:alert(1)', '', null, undefined]) assert.equal(outRel(u), '', String(u));
  const { outRel: semConfig } = page();
  for (const u of [ML_PDP, ML_ITEM, OUTRA]) assert.equal(semConfig(u), '', 'sem config: nada muda no rel');
  // mesmo marcador do bloco "Também na Amazon" (#194)
  assert.match(html, /rel="noopener nofollow sponsored">Ver na Amazon/);
});

await t('página: só os botões de oferta passam por outUrl, sempre dentro de safeUrl, com nova aba, noopener e texto .sr', () => {
  const uses = [...html.matchAll(/outUrl\(/g)].length;
  const inHref = [...html.matchAll(/href="\$\{esc\(safeUrl\(outUrl\((o|of|best)\.url\)\)\)\}" target="_blank" rel="noopener\$\{outRel\(\1\.url\)\}"/g)].length;
  assert.equal(inHref, 6, 'botões "Ver oferta" (cartões, pódio, página do produto, oportunidade), cada um com rel do mesmo destino');
  assert.equal([...html.matchAll(/\boutRel\(/g)].length, inHref, 'outRel só nos botões de oferta');
  assert.equal(uses, inHref + 1, 'outUrl só é chamado dentro de safeUrl nos hrefs (mais o uso em outRel)');
  assert.equal([...html.matchAll(/\boutUrl\b/g)].length, inHref + 2, 'mais a definição e o uso em outRel; nenhum outro uso');
  for (const m of html.matchAll(/<a [^>]*href="\$\{esc\(safeUrl\(outUrl\([^"]*"[\s\S]{0,400}?<\/a>/g)) assert.match(m[0], /<span class="sr">[^<]*abre em nova aba\)<\/span>/, m[0].slice(0, 120));
  // link geral: só no rodapé, rotulado como afiliado e só com destino confirmado (geral != null)
  assert.match(html, /function footAfil\(\)\{[^\n]*if\(!f\|\|!AFIL\.geral/);
  assert.match(html, /href="\$\{esc\(safeUrl\(AFIL\.geral\.url\)\)\}" target="_blank" rel="noopener nofollow sponsored" data-afil>\$\{esc\(AFIL\.geral\.rotulo\)\}<span class="sr"> \(link de afiliado, abre em nova aba\)<\/span>/);
  assert.match(html, /Alguns links do Mercado Livre são links de afiliado/, 'aviso nos Termos quando houver link ativo');
});

await t('página: o carregador aceita só entradas válidas e não bloqueia a página', () => {
  const fn = html.match(/async function loadAfil\(\)\{[\s\S]*?\n {2}AFIL=\{anuncios:a,geral:g\};[^\n]*\}catch\{\}\}/);
  assert.ok(fn, 'loadAfil não encontrado');
  assert.match(fn[0], /fetch\("\/api\/v1\/afiliados"\)/); assert.match(fn[0], /AFIL_OK\.test\(v\)/); assert.match(fn[0], /AFIL_OK\.test\(j\.geral\.url\)/);
  assert.match(html, /\nloadAfil\(\);/, 'chamado sem await: a página não espera a config');
});

// ------------------------------------------------------------------ 4. ranking, melhor oferta e score idênticos
await t('afiliado nunca entra em ranking, melhor oferta, preço, frete, estoque ou score', () => {
  const now = new Date('2026-10-10T12:00:00Z');
  const S = { reference_price: 400, reference_status: 'verified', reference_kind: 'COPAG_OFFICIAL_CURRENT', history_status: 'ok', history_days: 20, historical_min: 330, historical_average: 380,
    variation_7d: -0.05, variation_30d: null, number_of_in_stock_offers: 4, median_price: 390, lowest_current_price: 330, quality: { anchor: 380 } };
  const O = (x) => ({ price: 300, total_price: 300, shipping_status: 'free', shipping_price: 0, stock_status: 'in_stock', status: 'active', confirmed: true, anomalous: false,
    store: { ra_status: 'OTIMO' }, seller: { is_official: false }, ...x });
  const offers = [O({ id: 'ml1', url: ML_ITEM, price: 360, total_price: 360 }), O({ id: 'ml2', url: ML_PDP, price: 345, total_price: 352, shipping_status: 'paid', shipping_price: 7 }),
    O({ id: 'ml3', url: ML_SEM_MAPA, price: 330, total_price: 330 }), O({ id: 'lj', url: OUTRA, price: 340, total_price: 340, stock_status: 'unknown' })];
  const site = offers.map((o) => ({ id: o.id, url: o.url, total: o.total_price, shippingKnown: o.shipping_status !== 'unknown' }));
  const snap = JSON.stringify({ offers, site });
  const run = () => ({
    product: productOpportunity(S, offers.map((o) => ({ ...o })), { now }),
    each: offers.map((o) => calculateOpportunity(S, { ...o }, { now })).sort(oppOrder).map((r) => [r.opportunity_score, r.opportunity_band, r.confidence]),
    order: [...site].sort(byComparableTotal).map((o) => o.id), best: bestComparable(site)?.id,
  });
  const sem = run();
  // "com afiliado": todos os anúncios do ML mapeados e a saída resolvida (como a página faz ao desenhar os botões)
  const com = parseAffiliates({ mercadolivre: { anuncios: { MLB1234567890: AFIL_ITEM, MLB4455667788: AFIL_PDP, MLB9999999999: 'https://meli.la/zzz' } } });
  const hrefs = offers.map((o) => resolveOutbound(o.url, com));
  assert.deepEqual(hrefs, [AFIL_ITEM, AFIL_PDP, 'https://meli.la/zzz', OUTRA], 'os destinos de fato mudaram neste cenário');
  const { outUrl } = page(com.anuncios); assert.deepEqual(offers.map((o) => outUrl(o.url)), hrefs);
  assert.equal(JSON.stringify({ offers, site }), snap, 'a oferta continua com a URL original (o resolvedor não altera dados)');
  assert.deepEqual(run(), sem, 'mesma nota, faixa, confiança, ordem e melhor oferta com e sem afiliado');
  assert.equal(sem.best, 'ml3'); assert.deepEqual(sem.order, ['ml3', 'lj', 'ml2', 'ml1']);
});

await t('motores e ranking não conhecem afiliado (nem importam o módulo)', () => {
  const files = ['api/_lib/offer-rank.mjs', 'api/_lib/site.mjs', 'api/_lib/home.mjs', 'api/_lib/read-db.mjs', 'api/_lib/read-state.mjs', 'src/score.js',
    ...fs.readdirSync(path.join(ROOT, 'src/core')).filter((f) => f.endsWith('.js')).map((f) => `src/core/${f}`)];
  for (const f of files) assert.doesNotMatch(read(f), /affiliates\.(?:mjs|json)|resolveOutbound|publicAffiliates|parseAffiliates|outUrl|\bAFIL\b/, f);
  const importers = [...fs.readdirSync(path.join(ROOT, 'api')), ...fs.readdirSync(path.join(ROOT, 'api/_lib')).map((f) => `_lib/${f}`)]
    .filter((f) => /\.mjs$/.test(f) && /affiliates\.mjs/.test(read(`api/${f}`)));
  assert.deepEqual(importers, ['v1.mjs'], 'só a rota /api/v1/afiliados lê a config');
  // na página, as funções de ordem/melhor oferta/nota não tocam em AFIL/outUrl
  for (const name of ['bestLive', 'oppOrder', 'oppTotal']) {
    const m = html.match(new RegExp(`(?:function ${name}\\(|const ${name}=)[^\\n]*`)); if (m) assert.doesNotMatch(m[0], /outUrl|AFIL/, name);
  }
});

console.log(`✓ Links de afiliado (ML): ${n} grupos passaram (config central, só destino do clique, ranking/score idênticos)`);
