// Issue #106 — limites de tamanho e robustez no parsing de HTML/JSON-LD (src/adapters/parse-limits.js).
// Offline: só fixtures locais. Prova também que, nas fixtures reais do repositório, as funções novas extraem
// exatamente o que o código atual de src/adapters/jsonld.js extrai (rodando os dois).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  DEFAULT_LIMITS, parseLimits, extractJsonLdBlocks, parseJsonSafe, flattenLimited, jsonLdNodes,
  clampText, clampTitle, clampCode, extractLsVariantsRaw, extractLsVariants,
} from '../src/adapters/parse-limits.js';
import { parseProductPage } from '../src/adapters/jsonld.js';

const ld = (o) => `<script type="application/ld+json">${typeof o === 'string' ? o : JSON.stringify(o)}</script>`;
const elapsed = (fn) => { const t = process.hrtime.bigint(); const r = fn(); return [r, Number(process.hrtime.bigint() - t) / 1e6]; };

// ---------------------------------------------------------------------------------------------------------------
// Código ATUAL de jsonld.js, lido do próprio arquivo e executado (não é cópia). Se jsonld.js mudar (PRs #120/#129)
// e o trecho não for mais encontrado, usa a cópia literal abaixo, registrada a partir do jsonld.js da main.
const SRC = fs.readFileSync(new URL('../src/adapters/jsonld.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n'); // checkout Windows (CRLF)
const FROZEN = {
  flatten: "function flatten(node, acc = []) {\n  if (Array.isArray(node)) node.forEach((n) => flatten(n, acc));\n  else if (node && typeof node === 'object') { acc.push(node); if (node['@graph']) flatten(node['@graph'], acc); }\n  return acc;\n}",
  ldRe: '/<script[^>]+application\\/ld\\+json[^>]*>([\\s\\S]*?)<\\/script>/gi',
  varRe: '/LS\\.variants\\s*=\\s*(\\[[\\s\\S]*?\\]);\\s*\\n/',
};
const live = {
  flatten: SRC.match(/^function flatten\(node, acc = \[\]\) \{\n[\s\S]*?\n\}/m)?.[0],
  ldRe: SRC.match(/for \(const \[, raw\] of html\.matchAll\((\/<script[^\n]*?\/gi)\)\)/)?.[1],
  varRe: SRC.match(/const raw = html\.match\((\/LS\\\.variants[^\n]*?\/)\)\?\.\[1\]/)?.[1],
};
const usedLive = Object.fromEntries(Object.keys(FROZEN).map((k) => [k, !!live[k]]));
if (Object.values(usedLive).some((v) => !v)) console.log('aviso: trecho de jsonld.js não encontrado, equivalência contra a cópia registrada:', usedLive);
const legacyFlatten = new Function(`${live.flatten || FROZEN.flatten}; return flatten;`)();
const legacyLdRe = new Function(`return ${live.ldRe || FROZEN.ldRe};`)();
const legacyVarRe = new Function(`return ${live.varRe || FROZEN.varRe};`)();
const legacyNodes = (html) => { const nodes = []; for (const [, raw] of html.matchAll(new RegExp(legacyLdRe.source, legacyLdRe.flags))) { try { legacyFlatten(JSON.parse(raw.trim()), nodes); } catch { /* JSON-LD inválido */ } } return nodes; };
const legacyVariantsRaw = (html) => html.match(legacyVarRe)?.[1] ?? null;
const legacyVariants = (html) => { const raw = legacyVariantsRaw(html); if (!raw) return null; try { return JSON.parse(raw); } catch { return null; } };

// ---------------------------------------------------------------------------------------------------------------
// Fixtures reais do repositório (copiadas literalmente de test/run-tests.js e test/collectors-tests.js).
const relX = { '@type': 'Product', name: 'Pokémon - Blister Quádruplo Megaevolução - Equilíbrio Perfeito - Chikorita (PT-BR)', url: 'https://x.test/produtos/blister-chikorita/', offers: { '@type': 'Offer', price: '55.90', priceCurrency: 'BRL', availability: 'https://schema.org/InStock' } };
const ownX = { '@type': 'Product', name: 'Pokémon - Box Display Megaevolução - Equilíbrio Perfeito 36 Pacotes (PT-BR)', offers: { '@type': 'Offer', price: '449.90', priceCurrency: 'BRL', availability: 'https://schema.org/InStock' } };
const headX = '<meta property="og:title" content="Pokémon - Box Display Megaevolução - Equilíbrio Perfeito 36 Pacotes (PT-BR)">';
const relG = { '@type': 'Product', name: 'Blister Quadrúplo Pokémon Megaevolução Escuridão Absoluta - ME05', offers: { '@type': 'Offer', price: '55', priceCurrency: 'BRL', url: 'https://g.test/produtos/blister-me05/', availability: 'https://schema.org/InStock' } };
const varsG = [{ product_id: 1, price_number: 44, price_with_payment_discount_short: 'R$41,80', compare_at_price_number: 55, stock: 8, sku: 'ME04-04', available: true, is_visible: true }, { product_id: 2, price_number: 52, available: true }];
const htmlNs = `<meta property="og:title" content="Blister Quadrúplo Pokémon Caos Ascendente - ME04">${ld(relG)}<script>LS.product = {\n id : 1,\n name : 'Blister\\u0020Quadr\\u00FAplo\\u0020Pok\\u00E9mon\\u0020Caos\\u0020Ascendente\\u0020\\u002D\\u0020ME04'\n};\nLS.variants = ${JSON.stringify(varsG)};\n</script><p>R$44,00</p><p>3 x de R$16,31</p><p>5% de desconto pagando com Pix</p>`;
const colPage = (name, price) => `<html><head><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', name, offers: { '@type': 'Offer', price, priceCurrency: 'BRL', availability: 'https://schema.org/InStock' } })}</script></head><body><h1>${name}</h1><p>R$ ${Number(price).toFixed(2).replace('.', ',')}</p>${'x'.repeat(40000)}</body></html>`;
const REAL = [
  ['run-tests: relacionados + próprio', headX + ld(relX) + ld(ownX) + '<p>R$ 449,90</p>', 'https://x.test/produtos/box-display-equilibrio/'],
  ['run-tests: só relacionado', headX + ld(relX), 'https://x.test/produtos/box-display-equilibrio/'],
  ['run-tests: produto sem url', '<meta property="og:title" content="Blister Chikorita - Loja X">' + ld({ ...relX, url: undefined }) + '<p>R$ 55,90</p>', 'https://x.test/produtos/blister-chikorita/'],
  ['run-tests: Nuvemshop', htmlNs, 'https://g.test/produtos/blister-me04/'],
  ['run-tests: Loja Integrada esgotada', '<meta property="og:title" content="Pokemon TCG: Escuridão Absoluta - Treinador Avançado"><div itemprop="offers"><meta itemprop="price" content="399.90"/><meta itemprop="availability" content="http://schema.org/OutOfStock"/></div><p>Ops! Esse produto encontra-se indisponível.</p><h2>Produtos relacionados</h2><p>Blister Unitário R$ 13,90 ou R$ 13,20 via Pix</p>', 'https://d.test/pokemon-tcg-escuridao-absoluta-treinador-avancado'],
  ['run-tests: preço escondido', '<meta property="og:title" content="Blister Quádruplo Caos Ascendente - Pokemon Tcg">' + ld({ '@type': 'Product', name: 'Blister Quádruplo Caos Ascendente - Pokemon Tcg', offers: { '@type': 'Offer', price: '50.44', priceCurrency: 'BRL', availability: 'https://schema.org/InStock' } }) + '<p>Fale conosco</p>', 'https://s.test/blister-quadruplo-caos-ascendente-pokemon-tcg'],
  ['run-tests: Loja Integrada Pix', '<meta property="og:title" content="Blister Triplo Caos Ascendente ME04 - Pokémon"><div itemprop="offers"><meta itemprop="price" content="39.90"/><meta itemprop="availability" content="http://schema.org/InStock"/></div><p>Blister Triplo Caos Ascendente ME04 - Pokémon</p><strong>R$ 42,00</strong> <span>ou <strong>R$ 39,90</strong> via Pix</span>', 'https://l.test/blister-triplo-caos-ascendente-me04-pokemon'],
  ['run-tests: WooCommerce', '<meta property="og:title" content="Pokémon Blister Quádruplo Caos Ascendente">' + ld({ '@type': 'Product', name: 'Pokémon Blister Quádruplo Caos Ascendente', offers: { '@type': 'Offer', price: '53.91', priceCurrency: 'BRL', availability: 'https://schema.org/InStock' } }) + '<p>&#082;&#036;&nbsp;59,90 &#082;&#036;&nbsp;53,91 no pix</p>', 'https://a.test/pokemon-blister-quadruplo-caos-ascendente/'],
  ['collectors-tests: P1', colPage('Pokémon Booster Box Caos Ascendente 36 boosters Copag', '359.90'), 'https://ld.test/pokemon-booster-box-caos-ascendente-36'],
  ['collectors-tests: P2', colPage('Pokémon Blister Quádruplo Caos Ascendente Copag', '54.90'), 'https://ld.test/pokemon-box-colecao-novidade'],
  ['collectors-tests: P3', colPage('Pokémon Blister Triplo Escuridão Absoluta Copag', '39.90'), 'https://ld.test/pokemon-blister-triplo-escuridao'],
  ['collectors-tests: página irrelevante', '<title>Em breve</title><p>Página em construção</p>', 'https://ld.test/pokemon-box-colecao-novidade'],
];
// Formatos comuns que as fixtures não cobrem: @graph (Yoast/WooCommerce), script em maiúsculas, JSON-LD inválido no meio.
const SHAPES = [
  ['@graph aninhado', ld({ '@context': 'https://schema.org', '@graph': [{ '@type': 'WebSite', name: 'Loja' }, { '@type': 'BreadcrumbList' }, [{ '@type': 'Product', name: 'Box X', '@graph': [{ '@type': 'Offer' }] }]] })],
  ['maiúsculas e atributos', '<SCRIPT data-x="1" TYPE="Application/LD+JSON">{"@type":"Product","name":"A"}</SCRIPT><script>var a=1</script><script type="application/ld+json" id="b">\n [{"@type":"Organization"},{"@type":"Product","name":"B"}] \n</script>'],
  ['JSON-LD inválido no meio', ld('{"@type": "Product", name: sem aspas}') + ld({ '@type': 'Product', name: 'C' }) + ld('') + ld('null')],
  ['script ld sem fechamento', ld({ '@type': 'Product', name: 'D' }) + '<script type="application/ld+json">{"@type":"Product"'],
  ['tag <script sem >', ld({ '@type': 'Product', name: 'E' }) + '<script type="application/ld+json"'],
  ['tag <script> sem atributos', '<script>{"@type":"Product"}</script>' + ld({ '@type': 'Product', name: 'F' })],
];

// ---- 1) Equivalência: nas fixtures reais e formatos comuns, mesmos nós, mesmas variações, mesmos textos
for (const [label, html] of [...REAL, ...SHAPES]) {
  const { nodes, stats } = jsonLdNodes(html);
  assert.deepStrictEqual(nodes, legacyNodes(html), 'mesmos nós JSON-LD que jsonld.js: ' + label);
  assert.equal(stats.truncated || stats.tooMany || stats.tooLarge > 0, false, 'fixture real não esbarra em teto: ' + label);
  assert.equal(extractLsVariantsRaw(html), legacyVariantsRaw(html), 'mesmo trecho LS.variants: ' + label);
  assert.deepStrictEqual(extractLsVariants(html), legacyVariants(html), 'mesmas variações: ' + label);
}
assert.deepStrictEqual(extractLsVariants(htmlNs), varsG, 'Nuvemshop: variações da fixture lidas inteiras');
// Os campos que parseProductPage publica hoje passam pelos cortes sem mudar (título/SKU/EAN das fixtures).
let published = 0;
for (const [label, html, url] of REAL) {
  const r = parseProductPage(html, url); if (!r) continue; published++;
  assert.equal(clampTitle(r.title), r.title, 'título intacto: ' + label);
  assert.equal(clampCode(r.sku), r.sku, 'SKU intacto: ' + label);
  assert.equal(clampCode(r.ean), r.ean, 'EAN intacto: ' + label);
}
assert.ok(published >= 6, 'as fixtures reais publicam produtos (sanidade da comparação)');

// ---- 2) Tetos x fixtures reais: cada teto fica pelo menos 100x acima do maior valor medido nas fixtures
{
  let maxBlock = 0, maxBlocks = 0, maxNodes = 0, maxVar = 0, maxTitle = 0, maxCode = 0;
  for (const [, html, url] of REAL) {
    const { blocks } = extractJsonLdBlocks(html);
    maxBlocks = Math.max(maxBlocks, blocks.length);
    for (const b of blocks) maxBlock = Math.max(maxBlock, Buffer.byteLength(b));
    maxNodes = Math.max(maxNodes, legacyNodes(html).length);
    maxVar = Math.max(maxVar, Buffer.byteLength(legacyVariantsRaw(html) || ''));
    const r = parseProductPage(html, url);
    if (r) { maxTitle = Math.max(maxTitle, r.title.length); maxCode = Math.max(maxCode, String(r.sku || '').length, String(r.ean || '').length); }
  }
  const L = parseLimits({}, {});
  assert.deepStrictEqual(L, { ...DEFAULT_LIMITS });
  assert.ok(L.jsonLdMaxBlockBytes >= 100 * maxBlock, `bloco: teto ${L.jsonLdMaxBlockBytes} x maior fixture ${maxBlock}`);
  assert.ok(L.jsonLdMaxBlocks >= 10 * maxBlocks, `blocos: teto ${L.jsonLdMaxBlocks} x fixtures ${maxBlocks}`);
  assert.ok(L.jsonLdMaxNodes >= 100 * maxNodes, `nós: teto ${L.jsonLdMaxNodes} x fixtures ${maxNodes}`);
  assert.ok(L.nsVariantsMaxBytes >= 100 * maxVar, `LS.variants: teto ${L.nsVariantsMaxBytes} x fixture ${maxVar}`);
  assert.ok(L.titleMaxChars >= 3 * maxTitle, `título: teto ${L.titleMaxChars} x fixtures ${maxTitle}`);
  assert.ok(L.codeMaxChars >= 4 * maxCode && L.codeMaxChars >= 14, `SKU/EAN: teto ${L.codeMaxChars} x fixtures ${maxCode}`);
  console.log(`  fixtures reais: bloco ${maxBlock} B, ${maxBlocks} blocos, ${maxNodes} nós, LS.variants ${maxVar} B, título ${maxTitle}, código ${maxCode}`);
}

// ---- 3) Variáveis de ambiente HUNTER_* (inteiro positivo; resto ignorado) e overrides
{
  const L = parseLimits({}, { HUNTER_JSONLD_MAX_BLOCK_BYTES: '1024', HUNTER_JSONLD_MAX_BLOCKS: '0', HUNTER_JSONLD_MAX_NODES: 'abc', HUNTER_JSONLD_MAX_DEPTH: '-3', HUNTER_NS_VARIANTS_MAX_BYTES: '2048', HUNTER_TITLE_MAX_CHARS: '1.5', HUNTER_CODE_MAX_CHARS: '20' });
  assert.equal(L.jsonLdMaxBlockBytes, 1024); assert.equal(L.nsVariantsMaxBytes, 2048); assert.equal(L.codeMaxChars, 20);
  assert.equal(L.jsonLdMaxBlocks, DEFAULT_LIMITS.jsonLdMaxBlocks, 'zero é ignorado');
  assert.equal(L.jsonLdMaxNodes, DEFAULT_LIMITS.jsonLdMaxNodes, 'texto é ignorado');
  assert.equal(L.jsonLdMaxDepth, DEFAULT_LIMITS.jsonLdMaxDepth, 'negativo é ignorado');
  assert.equal(L.titleMaxChars, DEFAULT_LIMITS.titleMaxChars, 'fracionário é ignorado');
  assert.equal(parseLimits({ titleMaxChars: 10, inexistente: 5 }, {}).titleMaxChars, 10);
  assert.ok(!('inexistente' in parseLimits({ inexistente: 5 }, {})));
  const prev = process.env.HUNTER_TITLE_MAX_CHARS;
  process.env.HUNTER_TITLE_MAX_CHARS = '5';
  try { assert.equal(clampTitle('abcdefgh'), 'abcde', 'ambiente lido na chamada'); } finally { if (prev === undefined) delete process.env.HUNTER_TITLE_MAX_CHARS; else process.env.HUNTER_TITLE_MAX_CHARS = prev; }
}

// ---- 4) HTML malformado e entradas que não são texto: nunca lança
for (const bad of [undefined, null, 42, {}, '', '<', '<script', '<script type="application/ld+json"', '<script type="application/ld+json">{"@type":"Product"', '<<<script>>>', '</script><script type=application/ld+json></script>', '<script type="application/ld+json">' + '{'.repeat(5000) + '</script>']) {
  const r = jsonLdNodes(bad);
  assert.ok(Array.isArray(r.nodes), 'HTML malformado não lança');
  assert.equal(extractLsVariants(bad), null);
}
assert.deepStrictEqual(jsonLdNodes('<script type="application/ld+json"></script>' + ld({ '@type': 'Product', name: 'ok' })).nodes, [{ '@type': 'Product', name: 'ok' }]);

// ---- 5) JSON-LD inválido → ignorado e contado, sem lançar
assert.equal(parseJsonSafe('{"a":'), null); assert.equal(parseJsonSafe('não é json'), null); assert.equal(parseJsonSafe(undefined), null);
assert.equal(parseJsonSafe(Buffer.from('{}')), null, 'não-string');
assert.deepStrictEqual(parseJsonSafe('  {"a":1}  '), { a: 1 }, 'trim como no código atual');
assert.equal(parseJsonSafe('{"a":"' + 'x'.repeat(100) + '"}', 50), null, 'acima do teto de bytes');
assert.equal(parseJsonSafe('"ç"', 3), null, 'teto em bytes UTF-8, não em caracteres'); assert.equal(parseJsonSafe('"ç"', 4), 'ç');
{ const r = jsonLdNodes(ld('{nope') + ld({ '@type': 'Product', name: 'Z' })); assert.equal(r.stats.invalid, 1); assert.equal(r.nodes.length, 1); }

// ---- 6) Bloco gigante (acima do teto): descartado sem parse, blocos normais seguem
{
  const big = ld({ '@type': 'Product', name: 'Gigante', description: 'x'.repeat(DEFAULT_LIMITS.jsonLdMaxBlockBytes) });
  const [r, ms] = elapsed(() => jsonLdNodes(headX + big + ld(ownX)));
  assert.equal(r.stats.tooLarge, 1); assert.deepStrictEqual(r.nodes, [ownX], 'só o bloco dentro do teto');
  assert.ok(ms < 2000, 'bloco gigante não trava: ' + ms + ' ms');
  const s = extractJsonLdBlocks(ld({ a: 'é'.repeat(60) }), { jsonLdMaxBlockBytes: 100 });
  assert.equal(s.dropped.tooLarge, 1, 'teto conta bytes UTF-8 (é = 2 bytes)');
}

// ---- 7) Muitos blocos: para no teto de blocos
{
  const many = Array.from({ length: 500 }, (_, i) => ld({ '@type': 'Thing', i })).join('');
  const r = jsonLdNodes(many);
  assert.equal(r.stats.tooMany, true); assert.equal(r.nodes.length, DEFAULT_LIMITS.jsonLdMaxBlocks);
  assert.deepStrictEqual(r.nodes, legacyNodes(many).slice(0, DEFAULT_LIMITS.jsonLdMaxBlocks), 'mesma ordem do código atual até o teto');
  // muitas tags <script> comuns no meio não contam como blocos ld+json
  const noise = '<script>var x=1</script>'.repeat(1000) + ld({ '@type': 'Product', name: 'Depois do ruído' });
  assert.equal(jsonLdNodes(noise).nodes.length, 1);
}

// ---- 8) @graph com milhares de nós: corta no teto de nós
{
  const graph = { '@context': 'https://schema.org', '@graph': Array.from({ length: 5000 }, (_, i) => ({ '@type': 'Thing', i })) };
  const html = ld(graph);
  assert.ok(Buffer.byteLength(JSON.stringify(graph)) < DEFAULT_LIMITS.jsonLdMaxBlockBytes, 'bloco dentro do teto de bytes: o corte é pelo teto de nós');
  const [r, ms] = elapsed(() => jsonLdNodes(html));
  assert.equal(r.nodes.length, DEFAULT_LIMITS.jsonLdMaxNodes); assert.equal(r.stats.truncated, true);
  assert.deepStrictEqual(r.nodes, legacyNodes(html).slice(0, DEFAULT_LIMITS.jsonLdMaxNodes), 'mesmos nós e ordem até o teto');
  assert.ok(ms < 2000, '@graph enorme não trava: ' + ms + ' ms');
  // teto vale para a página inteira, somando blocos
  const r2 = jsonLdNodes(ld({ '@graph': Array.from({ length: 8 }, () => ({})) }) + ld({ '@graph': Array.from({ length: 8 }, () => ({})) }), { jsonLdMaxNodes: 10 });
  assert.equal(r2.nodes.length, 10); assert.equal(r2.stats.truncated, true);
  // array enorme de valores que não são objetos: orçamento de visitas corta
  const st = {};
  assert.deepStrictEqual(flattenLimited(Array.from({ length: 100000 }, () => 1), [], { jsonLdMaxNodes: 10, stats: st }), []);
  assert.equal(st.truncated, true, 'array de primitivos enorme é cortado pelo orçamento de visitas');
}

// ---- 9) Aninhamento profundo: não estoura a pilha
{
  let deep = { '@type': 'Product', name: 'fundo' }; for (let i = 0; i < 100000; i++) deep = [deep];
  const st = {};
  const out = flattenLimited(deep, [], { stats: st });
  assert.deepStrictEqual(out, []); assert.equal(st.tooDeep, 1, 'arrays além da profundidade máxima não são visitados');
  let g = { '@type': 'Thing', n: 0 }; for (let i = 1; i < 50; i++) g = { '@type': 'Thing', n: i, '@graph': g };
  const st2 = {};
  const out2 = flattenLimited(g, [], { jsonLdMaxDepth: 5, stats: st2 });
  assert.equal(out2.length, 6); assert.equal(st2.tooDeep, 1);
  // dentro da profundidade, igual ao código atual
  assert.deepStrictEqual(flattenLimited(g, [], { jsonLdMaxDepth: 100 }), legacyFlatten(g, []));
  // HTML com JSON profundo dentro do teto de bytes: sem exceção
  const html = ld('['.repeat(20000) + '{"@type":"Product"}' + ']'.repeat(20000));
  assert.deepStrictEqual(jsonLdNodes(html).nodes, []);
}

// ---- 10) Objeto cíclico (montado em memória): cada objeto entra uma vez
{
  const a = { '@type': 'Product', name: 'A' }; const b = { '@type': 'Offer', '@graph': [a] }; a['@graph'] = [b, a];
  const st = {};
  const out = flattenLimited(a, [], { stats: st });
  assert.deepStrictEqual(out.map((n) => n['@type']), ['Product', 'Offer']); assert.ok(st.cycles >= 1);
  const arr = []; arr.push(arr, { '@type': 'X' });
  assert.equal(flattenLimited(arr).length, 1);
  const hostile = { get '@graph'() { throw new Error('getter hostil'); } };
  assert.deepStrictEqual(flattenLimited(hostile), [hostile], 'getter que lança não derruba');
}

// ---- 11) Título / SKU / EAN gigantes: cortados sem partir caractere
{
  const title = 'Pokémon '.repeat(100000);
  assert.equal(clampTitle(title).length, DEFAULT_LIMITS.titleMaxChars);
  assert.equal(clampCode('S'.repeat(10000)).length, DEFAULT_LIMITS.codeMaxChars);
  assert.equal(clampCode('7891234567890'), '7891234567890');
  const emoji = 'a'.repeat(9) + '😀😀'; // 😀 = 2 unidades UTF-16
  assert.equal(clampText(emoji, 10), 'a'.repeat(9), 'não deixa meio emoji');
  assert.equal(clampText(emoji, 11), 'a'.repeat(9) + '😀');
  assert.ok(!/[\ud800-\udbff]$/.test(clampText('x' + '😀'.repeat(1000), 300)));
  assert.equal(clampText('ção', 2), 'çã', 'acentuado (1 unidade) não quebra');
  for (const v of [null, undefined, 7891234567890, true]) assert.equal(clampText(v, 3), v, 'não-string volta como veio');
  assert.equal(clampText('abc', 3), 'abc'); assert.equal(clampText('abc', -1), 'abc', 'limite inválido não corta');
}

// ---- 12) LS.variants gigante ou truncado
{
  const vars = (n) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ product_id: 1, price_number: 44, sku: 'V' + i, available: true })));
  const prefix = '<script>LS.product = {\n id : 1,\n name : \'X\'\n};\nLS.variants = ';
  const ok = prefix + vars(3) + ';\n</script>';
  assert.equal(extractLsVariants(ok).length, 3);
  const giant = prefix + vars(20000) + ';\n</script>'; // ~1 MB, acima de 512 KB
  assert.ok(Buffer.byteLength(legacyVariantsRaw(giant)) > DEFAULT_LIMITS.nsVariantsMaxBytes, 'fixture realmente acima do teto');
  const [g, ms] = elapsed(() => extractLsVariants(giant));
  assert.equal(g, null, 'LS.variants acima do teto não é lido'); assert.ok(ms < 2000, ms + ' ms');
  assert.equal(extractLsVariants(giant, { nsVariantsMaxBytes: 4 * 1024 * 1024 }).length, 20000, 'teto ajustável');
  // truncado: sem o "];\n" final
  const cut = prefix + vars(500).slice(0, -1) + '\n</script>' + '<p>' + 'x'.repeat(1000000) + '</p>';
  assert.equal(legacyVariantsRaw(cut), null); assert.equal(extractLsVariants(cut), null);
  const [, ms2] = elapsed(() => extractLsVariantsRaw(cut)); assert.ok(ms2 < 2000, 'truncado não varre sem limite: ' + ms2 + ' ms');
  // "];" sem quebra de linha logo depois, JSON inválido dentro do teto
  const noNl = prefix + '[{"a":[1]}; x = [2];\n';
  assert.equal(extractLsVariantsRaw(noNl), legacyVariantsRaw(noNl));
  assert.equal(extractLsVariants(noNl), null, 'JSON inválido vira null');
  const spaced = 'LS.variants   =\n [ {"a": 1} ];  \t \n';
  assert.equal(extractLsVariantsRaw(spaced), legacyVariantsRaw(spaced)); assert.deepStrictEqual(extractLsVariants(spaced), [{ a: 1 }]);
  const two = 'LS.variants = [1];\nLS.variants = [2];\n';
  assert.deepStrictEqual(extractLsVariants(two), legacyVariants(two), 'primeira ocorrência, como o regex atual');
  assert.equal(extractLsVariants('LS.variants = {"a":1};\n'), null, 'não-array não vale');
}

console.log('OK — limites de parsing (issue #106)' + (Object.values(usedLive).every(Boolean) ? '' : ' [equivalência contra cópia registrada]'));
