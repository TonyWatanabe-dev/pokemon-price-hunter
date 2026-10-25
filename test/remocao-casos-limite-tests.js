// Remoção de produto (#897): casos-limite da classificação da página e do leitor JSON-LD — testes de CARACTERIZAÇÃO
// (só descrevem o comportamento atual de src/pagina-erro.js e src/adapters/jsonld.js; nada em src muda). Complementa
// test/pagina-erro-tests.js. Nenhuma requisição real: fetch simulado.
import assert from 'node:assert/strict';
process.env.HUNTER_DOMAIN_DELAY_MS ??= '0';
const http = await import('../src/http.js');
http.setSleep(async () => {});
const { paginaRemovida, temProdutoProprio, atualizarRemocoes, remocoesConfirmadas } = await import('../src/pagina-erro.js');
const jsonld = await import('../src/adapters/jsonld.js');

const ld = (o) => `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', ...o })}</script>`;
const U = 'https://loja.test/produtos/box-me05/';
const NOME = 'Box Display Pokémon ME05 Escuridão Absoluta 36 Boosters Copag';
const produtoLd = (url, name = NOME) => ld({ '@type': 'Product', name, url, offers: { '@type': 'Offer', price: 449.9, priceCurrency: 'BRL', availability: 'https://schema.org/InStock' } });
const pagina = ({ titulo = '', h1 = '', head = '', corpo = '' } = {}) => `<!doctype html><html><head><title>${titulo}</title>${head}</head><body>${h1 ? `<h1>${h1}</h1>` : ''}${corpo}</body></html>`;
const est = (html, url = U) => paginaRemovida(html, url).estado;

// ---------- classificação: sinais explícitos em inglês e variações de escrita
assert.equal(est(pagina({ titulo: 'Page not found – Loja' })), 'removida', 'inglês: "Page not found" no título');
assert.equal(est(pagina({ titulo: '404 Not Found' })), 'removida', 'inglês: "404 Not Found" no título');
assert.equal(est(pagina({ h1: 'Product not found' })), 'removida', 'inglês: "Product not found" no h1');
assert.equal(est(pagina({ h1: 'PÁGINA NÃO ENCONTRADA' })), 'removida', 'maiúsculas e acentos normalizados');
assert.equal(est(pagina({ h1: 'Error 404' })), 'removida');
assert.equal(est(pagina({ titulo: 'Erro: 404 | Loja' })), 'removida');
// frases que NÃO estão na lista explícita ficam normais (lado conservador: nunca remove por palpite)
assert.equal(est(pagina({ titulo: "Oops! That page can't be found" })), 'normal', 'frase do WordPress fora da lista: normal');
assert.equal(est(pagina({ h1: 'Não encontrado' })), 'normal', '"não encontrado" sem "página/produto": normal');

// ---------- título genérico de erro + JSON-LD Product de OUTRO produto (vitrine): removida
assert.equal(est(pagina({ titulo: 'Página não encontrada', head: produtoLd('/produtos/outro-produto/', 'Pelúcia Pikachu') })), 'removida', 'Product de outro link é vitrine');
assert.equal(est(pagina({ titulo: 'Página não encontrada', head: produtoLd('https://loja.test/produtos/outro/') })), 'removida', 'Product de outro link absoluto');
// Product sem url nenhuma não é "produto próprio" (temProdutoProprio exige o link da página)
assert.equal(est(pagina({ titulo: 'Página não encontrada', head: ld({ '@type': 'Product', name: 'X' }) })), 'removida', 'Product sem url não segura a página');
// ... e com o Product DESTA página (url relativa, absoluta, sem barra final, via @id ou offers.url): inconclusiva
for (const url of ['/produtos/box-me05/', 'https://loja.test/produtos/box-me05', '/produtos/box-me05']) {
  assert.equal(est(pagina({ titulo: 'Página não encontrada', head: produtoLd(url) })), 'inconclusiva', `Product da própria página (${url})`);
}
assert.equal(est(pagina({ titulo: 'Página não encontrada', head: ld({ '@type': 'Product', '@id': '/produtos/box-me05/#produto', name: 'X' }) })), 'inconclusiva', '@id com fragmento: comparação por pathname, é a própria página');
assert.equal(est(pagina({ titulo: 'Página não encontrada', head: ld({ '@type': 'Product', name: 'X', offers: { '@type': 'Offer', url: '/produtos/box-me05/' } }) })), 'inconclusiva', 'offers.url da própria página');
assert.equal(est(pagina({ titulo: 'Página não encontrada', head: ld({ '@type': ['Product', 'Thing'], name: 'X', url: U }) })), 'inconclusiva', '@type em lista');
assert.equal(est(pagina({ h1: 'Erro 404', head: '<meta content="product" property="og:type">' })), 'inconclusiva', 'og:type product com atributos invertidos');
assert.equal(est(pagina({ h1: 'Erro 404', head: '<meta property="og:type" content="website">' })), 'removida', 'og:type website não é produto');
// URL com acento codificado: o caminho é comparado decodificado
{
  const u = 'https://loja.test/produtos/pel%C3%BAcia-pikachu/';
  assert.equal(temProdutoProprio(produtoLd('/produtos/pelúcia-pikachu/'), u), true, 'caminho com acento decodificado');
  assert.equal(temProdutoProprio(produtoLd('/produtos/pelucia-pikachu/'), u), false);
  assert.equal(temProdutoProprio(produtoLd('/produtos/x/'), 'não é url'), false, 'URL inválida: só LS.product/og:type valem');
}

// ---------- páginas que NÃO são remoção: redirecionamento para home/senha, busca vazia, vitrine sem sinal
assert.equal(est(pagina({ titulo: 'Loja — Pokémon TCG e mais', h1: 'Bem-vindo', corpo: '<div>Booster R$ 29,90</div>' }), 'https://loja.test/'), 'normal', 'home');
assert.equal(est(pagina({ titulo: 'Entre com a senha', h1: 'Esta loja estará disponível em breve', corpo: '<form action="/password"><input type="password"></form>' }), 'https://loja.test/password/'), 'normal', 'página de senha (loja fechada)');
assert.equal(est(pagina({ titulo: 'Busca: box me05', h1: 'Nenhum produto encontrado', corpo: '<p>Tente outros termos</p>' })), 'normal', 'busca vazia');
assert.equal(est(pagina({ titulo: 'Resultados da busca', h1: 'Resultados', corpo: '<ul><li>Booster A R$ 29,90</li><li>Booster B R$ 31,90</li></ul>' })), 'normal', 'soft 404 só com lista de produtos, sem sinal: normal');
// soft 404 com lista de produtos E sinal explícito no h1, sem produto próprio: removida (caso BQD com vitrine)
assert.equal(est(pagina({ h1: 'Página não encontrada', head: ld({ '@graph': [{ '@type': 'Product', name: 'V1', url: '/produtos/v1/' }, { '@type': 'Product', name: 'V2', url: '/produtos/v2/' }] }), corpo: '<ul><li>V1 R$ 9,90</li></ul>' })), 'removida');
// sinal fora do h1/título não conta: h2, parágrafo, breadcrumb, alt de imagem, meta description
assert.equal(est(pagina({ titulo: 'Loja', h1: 'Booster X', corpo: '<h2>Página não encontrada</h2><p>Erro 404</p><img alt="404 not found">' })), 'normal', 'h2/p/alt não contam');
assert.equal(est(pagina({ titulo: 'Loja', h1: 'Booster X', head: '<meta name="description" content="Página não encontrada">' })), 'normal', 'meta description não conta');
assert.equal(est(pagina({ titulo: 'Loja', h1: 'Booster X', corpo: '<!-- <h1>Erro 404</h1> -->' })), 'normal', 'h1 comentado não conta');
assert.equal(est('<html><head><title>Loja</title><template><h1>Página não encontrada</h1></template></head><body><h1>Booster X</h1></body></html>'), 'normal', 'h1 dentro de <template> não conta');
// só o PRIMEIRO h1 é olhado: tema com h1 no logotipo esconde o aviso de erro do segundo h1 (falso negativo, lado seguro)
assert.equal(est('<html><head><title></title></head><body><h1><a href="/">Loja</a></h1><h1>Página não encontrada</h1></body></html>'), 'normal', '2º h1 ignorado (lacuna conhecida, lado seguro)');
// h1 com tags internas e entidades
assert.equal(est('<html><body><h1><span>Erro</span>&nbsp;-&nbsp;<b>404</b></h1></body></html>'), 'removida', 'h1 com tags e &nbsp;');

// ---------- contador: rodadas intercaladas
{
  const A = 'https://l.test/a'; const t = (h) => `2026-10-25T${String(h).padStart(2, '0')}:00:00Z`;
  // evidência → falha → falha → evidência: falha não quebra a sequência (confirma com 2 evidências)
  let m = atualizarRemocoes({}, { [A]: 'HTTP 404' }, [A], t(1));
  m = atualizarRemocoes(m, {}, [], t(2)); m = atualizarRemocoes(m, {}, [], t(3));
  assert.equal(m[A].n, 1, 'falhas mantêm o contador');
  m = atualizarRemocoes(m, { [A]: 'página de erro com HTTP 200 (h1 "erro - 404")' }, [A], t(4));
  assert.deepEqual([...remocoesConfirmadas(m)], [A], 'evidência, falha, falha, evidência confirma');
  assert.equal(m[A].desde, t(1), '"desde" é o da 1ª evidência'); assert.match(m[A].motivo, /^página de erro/, 'motivo é o da última evidência');
  // confirmada e com nova evidência: segue contando e confirmada
  m = atualizarRemocoes(m, { [A]: 'HTTP 410' }, [A], t(5)); assert.equal(m[A].n, 3); assert.equal(remocoesConfirmadas(m).size, 1);
  // confirmada que volta a abrir sem evidência (produto voltou): sai do mapa
  m = atualizarRemocoes(m, {}, [A], t(6)); assert.equal(m[A], undefined, 'produto que volta zera');
  // evidência → leitura normal → evidência: não confirma (a leitura normal zerou)
  m = atualizarRemocoes({}, { [A]: 'HTTP 404' }, [A], t(7)); m = atualizarRemocoes(m, {}, [A], t(8)); m = atualizarRemocoes(m, { [A]: 'HTTP 404' }, [A], t(9));
  assert.equal(m[A].n, 1, 'evidência, normal, evidência = 1'); assert.equal(m[A].desde, t(9));
  // entradas malformadas não confirmam nem quebram
  assert.equal(remocoesConfirmadas({ x: null, z: {}, w: { n: 1 } }).size, 0);
  assert.equal(remocoesConfirmadas(undefined).size, 0);
}

// ---------- leitor JSON-LD com fetch simulado: redirecionamentos e status
const rotas = {};
http.setFetch(async (url) => {
  const u = new URL(url); const r = rotas[u.host] || {};
  if (u.pathname === '/robots.txt') return new Response('', { status: 404 });
  const f = r[u.pathname]; if (!f) return new Response('não achei', { status: 404 });
  return f();
});
const html = (s, status = 200) => () => new Response(s, { status, headers: { 'content-type': 'text/html' } });
const redir = (loc, status = 301) => () => new Response(null, { status, headers: { location: loc } });
const produtoPagina = (p, name = NOME) => `<!doctype html><html><head><title>${name}</title><meta property="og:type" content="product">${produtoLd(p, name)}</head><body><h1>${name}</h1><span>R$ 449,90</span></body></html>`;
{
  const H = 'r.test';
  rotas[H] = {
    '/': html(pagina({ titulo: 'Loja', h1: 'Bem-vindo' })),
    '/password/': html(pagina({ titulo: 'Entre com a senha', h1: 'Em breve' })),
    '/404': html('não existe', 404),
    '/pagina-erro': html(pagina({ titulo: '', h1: 'Erro - 404' })),
    '/produtos/novo/': html(produtoPagina('/produtos/novo/', 'Box Display Pokémon ME06 36 Boosters Copag')),
    '/produtos/p-home/': redir('/'),
    '/produtos/p-senha/': redir('/password/', 302),
    '/produtos/p-404/': redir('/404'),
    '/produtos/p-erro200/': redir('/pagina-erro'),
    '/produtos/p-outro/': redir('/produtos/novo/'),
    '/produtos/p-en/': html(pagina({ titulo: 'Page not found', corpo: '<ul><li>Booster R$ 9,90</li></ul>' })),
    '/produtos/p-busca/': html(pagina({ titulo: 'Busca', h1: 'Nenhum produto encontrado' })),
    '/produtos/p-400/': html('bad', 400),
    '/produtos/p-408/': html('timeout', 408),
  };
  const P = (s) => `https://${H}/produtos/${s}/`;
  const urls = ['p-home', 'p-senha', 'p-404', 'p-erro200', 'p-outro', 'p-en', 'p-busca', 'p-400', 'p-408'].map(P);
  const out = await jsonld.search({ id: 'r', url: `https://${H}`, plannedUrls: urls });
  const nome = (u) => u.split('/')[4];
  assert.deepEqual(Object.keys(out.gone).map(nome).sort(), ['p-404', 'p-en', 'p-erro200'], 'só 404 após redirect, erro 200 após redirect e "Page not found" são evidência');
  assert.equal(out.gone[P('p-404')], 'HTTP 404', 'redirect para página com 404 real: evidência pela URL planejada');
  assert.match(out.gone[P('p-erro200')], /^página de erro com HTTP 200/);
  assert.deepEqual(out.failed.map(nome), ['p-408'], '408 é falha de leitura');
  // redirect para home/senha, busca vazia e 400: nem evidência nem falha (contam como "abriu sem evidência" e zeram o contador)
  for (const s of ['p-home', 'p-senha', 'p-busca', 'p-400']) { assert.ok(!(P(s) in out.gone), `${s} não é evidência`); assert.ok(!out.failed.includes(P(s)), `${s} não é falha`); }
  // 301 para OUTRO produto: o anúncio sai com a URL de destino (não a planejada) e a planejada não é evidência
  assert.deepEqual(out.map((l) => l.url), [`https://${H}/produtos/novo/`], '301 para outro produto publica o destino');
  assert.ok(!(P('p-outro') in out.gone));
}
// 304 com anúncio guardado: vale a leitura anterior; nunca vira evidência
{
  const H = 'c.test'; const p = '/produtos/x/'; const u = `https://${H}${p}`;
  rotas[H] = { [p]: () => new Response(null, { status: 304 }) };
  const listing = { title: NOME, url: u, price: { base: 449.9, pix: null }, stock: 'IN_STOCK' };
  const out = await jsonld.search({ id: 'c', url: `https://${H}`, plannedUrls: [u], cond: { [u]: { etag: '"e1"', lm: null, listing } } });
  assert.equal(out.length, 1); assert.deepEqual(out.gone, {}); assert.deepEqual(out.failed, []); assert.equal(out.notModified, 1);
}
// prazo da rodada estourado: páginas restantes viram falha ("prazo da rodada"), nunca evidência
{
  const H = 'd.test'; rotas[H] = {};
  const out = await jsonld.search({ id: 'd', url: `https://${H}`, plannedUrls: [`https://${H}/produtos/a/`], deadline: Date.now() - 1 });
  assert.deepEqual(out.gone, {}); assert.equal(out.failReasons[`https://${H}/produtos/a/`], 'prazo da rodada');
}
// 401 e desafio anti-robô (CAPTCHA) sobem como bloqueio: nada classificado como removido
{
  rotas['b401.test'] = { '/produtos/x/': html('auth', 401) };
  await assert.rejects(jsonld.search({ id: 'b', url: 'https://b401.test', plannedUrls: ['https://b401.test/produtos/x/'] }), (e) => e.blocked === true);
  rotas['cap.test'] = { '/produtos/x/': redir('/account-verification?x=1', 302), '/account-verification': html('verifique') };
  await assert.rejects(jsonld.search({ id: 'b', url: 'https://cap.test', plannedUrls: ['https://cap.test/produtos/x/'] }), (e) => e.blocked === true, 'redirect para verificação = bloqueio');
}
console.log('remocao-casos-limite-tests: ok');
