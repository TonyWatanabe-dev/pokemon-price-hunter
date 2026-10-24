// Sonda de adaptadores: só leitura (workflow sem escrita/secrets), entrada validada e veredito conservador.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseLojas, veredito } from '../tools/sonda-adaptadores.mjs';

assert.deepEqual(parseLojas('lifegeek:vtex, metacardscombr:shopify'), [{ id: 'lifegeek', plataforma: 'vtex' }, { id: 'metacardscombr', plataforma: 'shopify' }]);
assert.deepEqual(parseLojas('x:jsonld,../etc:vtex,ok:mercadolivre'), [], 'só vtex/shopify/woocommerce e id simples');
assert.equal(parseLojas('lojaw:woocommerce').length, 1);
assert.equal(parseLojas('kalungacombr:busca').length, 1, 'prova de conceito do leitor pela busca');
assert.equal(veredito({ atual: { casados: 27 }, sonda: { validos: 40, casados: 27 } }), 'passa');
assert.equal(veredito({ atual: { casados: 27 }, sonda: { validos: 40, casados: 20 } }), 'pior');
assert.equal(veredito({ atual: { casados: null }, sonda: { validos: 0, casados: 0 } }), 'sem_anuncios');
assert.equal(veredito({ atual: {}, sonda: { erro: 'HTTP 403', validos: 0 } }), 'falhou');

const wf = fs.readFileSync(new URL('../.github/workflows/sonda-adaptadores.yml', import.meta.url), 'utf8');
assert.match(wf, /permissions:\n  contents: read\n/);
assert.doesNotMatch(wf, /\$\{\{\s*secrets\.|git push|contents: write/);
for (const m of wf.matchAll(/uses: ([^\s]+)/g)) assert.match(m[1], /@[0-9a-f]{40}$/, `ação fixada por SHA: ${m[1]}`);
const tool = fs.readFileSync(new URL('../tools/sonda-adaptadores.mjs', import.meta.url), 'utf8');
assert.doesNotMatch(tool, /writeJson|appendJsonl|db-sync|pg\b/, 'não grava dados');
console.log('sonda-adaptadores-tests: ok');

// Amostra de triagem: inválido mostra o 1º motivo; válido sem produto mostra o motivo do casamento; limite por tipo.
{
  const { amostra, textoAmostra } = await import('../tools/sonda-adaptadores.mjs');
  const catalog = JSON.parse(fs.readFileSync(new URL('../config/catalog.json', import.meta.url), 'utf8')); catalog.products ||= []; catalog.copag ||= {};
  const store = { id: 'lojax', url: 'https://lojax.com.br' };
  const ok = (title, extra = {}) => ({ storeId: 'lojax', title, url: 'https://lojax.com.br/p/' + encodeURIComponent(title), price: { base: 99.9 }, stock: 'IN_STOCK', sourceType: 'json_ld', ...extra });
  const raw = [ok('Camiseta Pikachu Algodão'), ok('Sleeve Pokémon 65 unidades'), ok('Booster Avulso', { url: 'https://outra.com/p/1' })];
  const a = amostra(raw, store, catalog);
  assert.equal(a.invalidos.length, 1);
  assert.match(a.invalidos[0], /^Booster Avulso — link fora do domínio da loja/);
  assert.equal(a.naoCasados.length, 2);
  assert.ok(a.naoCasados.every((x) => / — \S/.test(x)), 'cada não casado traz um motivo');
  const muitos = Array.from({ length: 20 }, (_, i) => ok('Camiseta ' + i));
  assert.equal(amostra(muitos, store, catalog).naoCasados.length, 6, 'no máximo 6 por tipo');
  assert.equal(textoAmostra(null), '');
  assert.match(textoAmostra(a), /inválidos: Booster Avulso.*não casaram: /);
  console.log('sonda-adaptadores-tests (amostra): ok');
}

// Diagnóstico de página: conta Product no JSON-LD, preço em meta e se o leitor publica (parse injetado).
{
  const { resumoPagina } = await import('../tools/sonda-adaptadores.mjs');
  const html = '<html><head><meta property="product:price:amount" content="49.90"><script type="application/ld+json">{"@type":"Product","name":"Booster"}</script></head></html>';
  assert.deepEqual(resumoPagina(html, 'https://lojax.com.br/produto/booster-pokemon', () => null), { caminho: '/produto/booster-pokemon', ld: 1, og: true, publica: false, nome: 'Booster', titulo: '', preco: null, escrito: null });
  // motivo da recusa: nome × título, preço do JSON-LD e se ele está escrito na página
  const comPreco = '<title>Booster Fogo - Loja</title><script type="application/ld+json">{"@type":"Product","name":"Booster Fogo","offers":{"price":"24.90"}}</script><p>R$ 24,90</p>';
  assert.deepEqual(resumoPagina(comPreco, 'https://lojax.com.br/p/b', () => null), { caminho: '/p/b', ld: 1, og: false, publica: false, nome: 'Booster Fogo', titulo: 'Booster Fogo - Loja', preco: '24.90', escrito: true });
  assert.equal(resumoPagina(comPreco.replace('R$ 24,90', 'Consulte'), 'https://lojax.com.br/p/b', () => null).escrito, false);
  assert.equal(resumoPagina('<html></html>', 'https://lojax.com.br/p/x', () => ({ title: 'x' })).publica, true);
  assert.equal(resumoPagina('<html></html>', 'https://lojax.com.br/p/x', () => null).ld, 0);
  console.log('sonda-adaptadores-tests (página): ok');
}

// Marcadores de página: plataforma (Nuvemshop/Tray), título, h1, microdata, esgotado/não encontrado e trechos de preço.
{
  const { marcadores } = await import('../tools/sonda-adaptadores.mjs');
  const m = marcadores('<html><head><title>Booster X | Loja</title><script>LS.product = {id: 1}; LS.variants = [];</script></head><body><h1>Booster <b>X</b></h1><img src="/loja/arquivos/1/a.png"><span itemprop="price" content="10">R$ 24,90</span><p>Produto esgotado</p></body></html>');
  assert.equal(m.tituloTag, 'Booster X | Loja'); assert.equal(m.h1, 'Booster X');
  assert.equal(m.nuvemshop, true); assert.equal(m.variantes, true); assert.equal(m.tray, true); assert.equal(m.microdata, 1);
  assert.equal(m.esgotado, true); assert.equal(m.naoEncontrado, false);
  assert.equal(m.precos.length, 1); assert.match(m.precos[0], /R\$ 24,90/);
  assert.doesNotMatch(JSON.stringify(marcadores('<script>var p = "R$ 9,99"</script>').precos), /9,99/, 'preço dentro de script não conta como escrito');
  console.log('sonda-adaptadores-tests (marcadores): ok');
}

// Resumo das páginas das ofertas atuais (BQD: página de erro com HTTP 200) e trecho do dataLayer (Tray).
{
  const { resumoOfertas, marcadores } = await import('../tools/sonda-adaptadores.mjs');
  assert.deepEqual(resumoOfertas([{ publica: true }, { publica: false, m: { h1: 'Erro - 404', naoEncontrado: true } }, { erro: '503' }, { publica: false, m: { h1: 'Booster', naoEncontrado: false } }]),
    { paginas: 4, publica: 1, erro404: 1, falha: 1, semDados: 1 });
  assert.match(marcadores('<script>dataLayer = [{"idProduct":"9","price":"67.80"}];</script>').dataLayerTrecho, /"price":"67\.80"/);
  assert.equal(marcadores('<p>sem nada</p>').dataLayerTrecho, null);
  console.log('sonda-adaptadores-tests (resumo e dataLayer): ok');
}
