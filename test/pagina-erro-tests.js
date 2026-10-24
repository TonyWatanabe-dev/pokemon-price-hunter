// Produto removido em página que responde HTTP 200 ("soft 404", src/pagina-erro.js) — 24/10/2026.
// Caso real: as 29 páginas das ofertas da BQD abriam o tema de erro da Nuvemshop (h1 "Erro - 404", sem título, JSON-LD só
// com produtos de vitrine) com HTTP 200. Fixture SANITIZADA no mesmo formato; nenhuma requisição real.
// Cobre os 10 casos do brief: erro com HTTP 200, 404/410 reais, produto válido, esgotado, sem preço e sem aviso,
// timeout/rede, 403/429, "404" só em script ou link, página de erro com layout de produto, e casos ambíguos.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
process.env.HUNTER_DOMAIN_DELAY_MS ??= '0';
const http = await import('../src/http.js');
http.setSleep(async () => {}); // tentativas de rede sem espera real
const { paginaRemovida, atualizarRemocoes, remocoesConfirmadas, RODADAS_REMOCAO } = await import('../src/pagina-erro.js');
const jsonld = await import('../src/adapters/jsonld.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const NOME = 'Box Display Pokémon ME05 Escuridão Absoluta 36 Boosters Copag';
const ld = (o) => `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', ...o })}</script>`;
const produto = ({ preco = 449.9, disp = 'InStock', mostra = true, path = '/produtos/box-me05/', extra = '' } = {}) => `<!doctype html><html><head><title>${NOME} - Loja</title>
<meta property="og:type" content="product">${ld({ '@type': 'Product', name: NOME, url: path, offers: { '@type': 'Offer', price: preco, priceCurrency: 'BRL', availability: `https://schema.org/${disp}` } })}
<script>window.analytics = { page: '/erro-404', fallback: 'https://cdn.test/404.js' };</script></head>
<body><h1>${NOME}</h1>${mostra ? `<span>R$ ${preco.toFixed(2).replace('.', ',')}</span>` : '<span>Consulte</span>'}${extra}<a href="/pagina-404-antiga">link antigo</a></body></html>`;
// BQD (sanitizada): sem título, h1 "Erro - 404", JSON-LD só com produtos de vitrine (outros links), carrinho R$0,00
const vitrine = (n, i) => ({ '@type': 'Product', name: n, url: `/produtos/vitrine-${i}/`, offers: { '@type': 'Offer', price: 69.99, priceCurrency: 'BRL' } });
const BQD = `<!doctype html><html><head><title></title>${ld({ '@graph': [vitrine('Jogo Cubo Magico 3x3', 1), vitrine('Jogo Dobble', 2), vitrine('Quebra-cabeça', 3), vitrine('Pelúcia', 4)] })}
<script>LS.variants = [];</script></head><body><header>Carrinho R$0,00 ( 0 )</header><h1>Erro - 404</h1><p>A página que você procura não existe.</p>
<section>Você também pode gostar: Jogo Cubo Magico 3x3 R$ 69,99</section></body></html>`;
const U = 'https://loja.test/produtos/box-me05/';

// ---------- unidade: classificação da página
assert.deepEqual(paginaRemovida(BQD, U), { estado: 'removida', motivo: 'h1 "erro - 404"' }, '1) HTTP 200 com "Erro - 404" (BQD)');
assert.equal(paginaRemovida(produto(), U).estado, 'normal', '3) produto válido');
assert.equal(paginaRemovida(produto({ disp: 'OutOfStock', extra: '<p>Produto esgotado. Indisponível no momento. Avise-me</p>' }), U).estado, 'normal', '4) esgotado não é removido');
assert.equal(paginaRemovida('<html><head><title>Booster X</title></head><body><h1>Booster X</h1><p>Sem preço</p></body></html>', U).estado, 'normal', '5) sem preço e sem aviso');
assert.equal(paginaRemovida(produto(), U).estado, 'normal', '8) "404" só em script e link');
assert.equal(paginaRemovida('<html><head><title>Loja</title><script>var t="Erro - 404"</script></head><body><h1>Booster X</h1></body></html>', U).estado, 'normal', '8) "Erro - 404" dentro de script não conta');
// 9) página de erro com layout de produto (preço de vitrine, breadcrumbs) e sem produto próprio: removida
assert.equal(paginaRemovida(`<html><head><title>Página não encontrada | Loja</title></head><body><nav>Início > Pokémon</nav><h1>Ops!</h1><div class="product-grid"><b>Booster</b> R$ 29,90 <button>Comprar</button></div></body></html>`, U).estado, 'removida');
// 9/10) aviso de erro com o próprio produto na página: ambíguo → inconclusiva (nunca removida)
assert.equal(paginaRemovida(produto().replace(`<h1>${NOME}</h1>`, '<h1>Erro 404</h1>'), U).estado, 'inconclusiva');
assert.equal(paginaRemovida(BQD.replace('<script>LS.variants', '<script>LS.product = {id: 9}; LS.variants'), U).estado, 'inconclusiva', 'LS.product da Nuvemshop = produto próprio');
// 10) ambíguos que ficam normais: "não encontrado" só no corpo, h1 genérico, "404" como número de produto
assert.equal(paginaRemovida('<html><head><title>Booster X</title></head><body><h1>Booster X</h1><p>Frete não encontrado para o CEP</p><p>Produto não encontrado? Fale conosco</p></body></html>', U).estado, 'normal');
assert.equal(paginaRemovida('<html><body><h1>Ops!</h1></body></html>', U).estado, 'normal');
assert.equal(paginaRemovida('<html><head><title>Kit 404 cartas Pokémon</title></head><body><h1>Kit 404 cartas Pokémon</h1></body></html>', U).estado, 'normal');
assert.equal(paginaRemovida('', U).estado, 'normal');

// ---------- unidade: rodadas seguidas
{
  const t1 = '2026-10-24T18:00:00Z'; const t2 = '2026-10-24T18:15:00Z';
  let m = atualizarRemocoes({}, { a: 'HTTP 404', b: 'erro' }, ['a', 'b', 'c'], t1);
  assert.equal(remocoesConfirmadas(m).size, 0, 'uma rodada só nunca confirma');
  m = atualizarRemocoes(m, { a: 'HTTP 404' }, ['a', 'c'], t2); // b não planejada (mantém); a de novo
  assert.deepEqual([...remocoesConfirmadas(m)], ['a']); assert.equal(m.a.desde, t1); assert.equal(m.b.n, 1);
  m = atualizarRemocoes(m, {}, ['b'], t2); // b abriu sem evidência: zera
  assert.equal(m.b, undefined); assert.equal(m.a.n, 2, 'a não planejada: mantém');
  m = atualizarRemocoes(m, {}, [], t2); // falha de leitura (não entra em lidas): não soma nem zera
  assert.equal(m.a.n, 2); assert.equal(RODADAS_REMOCAO, 2);
}

// ---------- leitor JSON-LD com fetch simulado: o que vira "gone", "failed" ou anúncio
let rotas = {};
http.setFetch(async (url) => {
  const u = new URL(url); const r = rotas[u.host] || {};
  if (u.pathname === '/robots.txt') return new Response('', { status: 404 });
  const f = r[u.pathname]; if (!f) return new Response('não achei', { status: 404 });
  return f();
});
const page = (s, status = 200, headers = {}) => () => new Response(s, { status, headers: { 'content-type': 'text/html', ...headers } });
{
  rotas['l1.test'] = {
    '/produtos/erro/': page(BQD), '/produtos/ok/': page(produto({ path: '/produtos/ok/' })), '/produtos/esgotado/': page(produto({ disp: 'OutOfStock', path: '/produtos/esgotado/' })),
    '/produtos/sem-preco/': page('<html><head><title>Booster</title></head><body><h1>Booster</h1></body></html>'),
    '/produtos/gone/': page('Gone', 410), '/produtos/503/': page('erro', 503),
    '/produtos/rede/': () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ETIMEDOUT' } }); },
  };
  const urls = ['erro', 'ok', 'esgotado', 'sem-preco', 'sumiu', 'gone', '503', 'rede'].map((p) => `https://l1.test/produtos/${p}/`);
  const out = await jsonld.search({ id: 'l1', url: 'https://l1.test', plannedUrls: urls });
  assert.deepEqual(out.map((l) => [l.url.split('/')[4], l.stock]), [['ok', 'IN_STOCK'], ['esgotado', 'OUT_OF_STOCK']], '3/4) válido e esgotado publicam');
  assert.deepEqual(Object.keys(out.gone).map((u) => u.split('/')[4]).sort(), ['erro', 'gone', 'sumiu'], '1/2) erro com 200, 404 e 410 são evidência');
  assert.match(out.gone['https://l1.test/produtos/erro/'], /^página de erro com HTTP 200 \(h1 "erro - 404"\)$/);
  assert.equal(out.gone['https://l1.test/produtos/sumiu/'], 'HTTP 404'); assert.equal(out.gone['https://l1.test/produtos/gone/'], 'HTTP 410');
  assert.deepEqual(out.failed.map((u) => u.split('/')[4]).sort(), ['503', 'rede'], '6) 5xx e rede são falha de leitura, nunca remoção');
  assert.ok(!('https://l1.test/produtos/sem-preco/' in out.gone), '5) sem preço não é remoção');
}
// 7) 403 e 429: a loja barra a leitura (BlockedError sobe para a rodada), nada é classificado como removido
for (const st of [403, 429]) {
  rotas[`b${st}.test`] = { '/produtos/x/': page('bloqueado', st) };
  await assert.rejects(jsonld.search({ id: 'b', url: `https://b${st}.test`, plannedUrls: [`https://b${st}.test/produtos/x/`] }), (e) => e.blocked === true || e.status === st, `HTTP ${st}`);
}

// ---------- rodada real (runOnce) com loja JSON-LD: uma rodada com erro só protege; duas seguidas removem
{
  const keep = Object.fromEntries(['HUNTER_CONFIG_DIR', 'HUNTER_DATA_DIR', 'HUNTER_TIPS', 'HUNTER_CEP', 'HUNTER_BUDGET_MIN'].map((k) => [k, process.env[k]]));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hunter-soft404-'));
  try {
    process.env.HUNTER_CONFIG_DIR = path.join(tmp, 'config'); process.env.HUNTER_DATA_DIR = path.join(tmp, 'data'); process.env.HUNTER_TIPS = '0';
    delete process.env.HUNTER_CEP; delete process.env.HUNTER_BUDGET_MIN;
    fs.mkdirSync(process.env.HUNTER_CONFIG_DIR, { recursive: true }); fs.mkdirSync(process.env.HUNTER_DATA_DIR, { recursive: true });
    fs.copyFileSync(path.join(root, 'config/catalog.json'), path.join(tmp, 'config/catalog.json'));
    fs.writeFileSync(path.join(tmp, 'config/stores.json'), JSON.stringify({ stores: [{ id: 'soft', name: 'Soft', url: 'https://soft404.test', platform: 'jsonld', kind: 'specialist', evidence: {} }] }));
    fs.writeFileSync(path.join(tmp, 'config/watchlist.json'), JSON.stringify({ settings: { cep: null }, rules: [] }));
    const P = '/produtos/pokemon-box-me05-booster/';
    let estado = 'ok';
    rotas['soft404.test'] = {
      '/sitemap.xml': () => new Response(`<urlset><url><loc>https://soft404.test${P}</loc></url></urlset>`, { status: 200, headers: { 'content-type': 'application/xml' } }),
      [P]: () => (estado === 'ok' ? page(produto({ path: P }))() : estado === 'erro' ? page(BQD)() : page('falha', 503)()),
    };
    const { runOnce } = await import('../src/run.js');
    const read = (f) => JSON.parse(fs.readFileSync(path.join(tmp, 'data', f), 'utf8'));
    const hist = () => fs.readFileSync(path.join(tmp, 'data/history.jsonl'), 'utf8').split('\n').filter(Boolean).map((x) => JSON.parse(x));
    const oferta = () => Object.values(read('offers.json')).find((o) => o.storeId === 'soft');
    const t0 = Date.parse('2026-10-24T12:00:00Z'); let i = 0;
    const rodada = async (e) => { estado = e; await runOnce({ log: () => {}, send: { capture: async () => true }, now: new Date(t0 + (i++) * 3600e3) }); };

    await rodada('ok');
    assert.equal(oferta()?.stale, false, 'rodada 1: oferta válida'); const id = oferta().id;
    await rodada('erro');
    assert.equal(oferta()?.stale, true, 'rodada 2 (1ª evidência): oferta mantida como não confirmada');
    assert.equal(read('sources.json').soft.pagesGone, 1); assert.equal(read('sources.json').soft.pagesGoneConfirmed, 0);
    assert.equal(hist().filter((h) => h.offerId === id && h.event === 'removed').length, 0);
    await rodada('falha');
    assert.equal(oferta()?.stale, true, 'rodada 3 (falha de leitura): não conta como evidência');
    assert.equal(read('url-cache.json').soft.removidas[`https://soft404.test${P}`].n, 1);
    await rodada('erro');
    assert.equal(oferta(), undefined, 'rodada 4 (2ª evidência seguida): oferta sai');
    assert.equal(hist().filter((h) => h.offerId === id && h.event === 'removed').length, 1, 'evento "removed" registrado');
    assert.ok(hist().some((h) => h.offerId === id && h.event !== 'removed'), 'histórico anterior preservado');
    assert.equal(read('sources.json').soft.pagesGoneConfirmed, 1);
    // página confirmada como removida sai da fila prioritária: volta a ser lida pela regra de sempre (HUNTER_JSONLD_RETRY_H, 24 h)
    i += 24; await rodada('ok');
    assert.equal(oferta()?.stale, false, 'produto voltou (releitura de 24 h): oferta volta');
    assert.equal(read('url-cache.json').soft.removidas[`https://soft404.test${P}`], undefined, 'contador zerado');
  } finally {
    for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
console.log('pagina-erro-tests: ok');
