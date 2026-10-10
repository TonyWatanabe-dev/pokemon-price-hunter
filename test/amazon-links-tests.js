// "Também na Amazon" (Amazon Associados): a lista curada em config/afiliados/amazon.json é a ÚNICA fonte de link
// com tag de afiliado. Este teste trava as regras: link no formato oficial, casado pelo matcher do site, preço sempre
// com a data e hora da leitura, fora do ranking (nenhum módulo de preço/ranking/API lê o arquivo) e mostrado só no
// bloco próprio. O aviso de afiliado fica no rodapé e nos Termos.
// Sem rede e sem banco.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchProduct } from '../src/match.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
let n = 0;
const t = (name, fn) => { try { fn(); } catch (e) { e.message = `${name}: ${e.message}`; throw e; } n++; };

const doc = JSON.parse(read('config/afiliados/amazon.json'));
const catalog = JSON.parse(read('config/catalog.json')); catalog.products ||= []; catalog.copag ||= {};

t('programa e tag', () => {
  assert.equal(doc.program, 'amazon');
  assert.match(doc.tag, /^[a-z0-9-]+-20$/);
  assert.ok(Array.isArray(doc.links) && doc.links.length > 0);
});

t('cada link: ASIN válido, URL oficial exata com a tag do arquivo, preço só com data e hora da leitura', () => {
  const seen = new Set();
  for (const l of doc.links) {
    assert.match(l.asin, /^[A-Z0-9]{10}$/, l.asin);
    assert.ok(!seen.has(l.asin), `ASIN repetido: ${l.asin}`); seen.add(l.asin);
    assert.equal(l.url, `https://www.amazon.com.br/dp/${l.asin}?tag=${doc.tag}`, l.asin);
    assert.deepEqual(Object.keys(l).filter((k) => k !== 'matchTitle').sort(), ['asin', 'capturedAt', 'fulfilledBy', 'price', 'productId', 'seller', 'stockNote', 'title', 'url'], `${l.asin}: campos`);
    assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?Z$/.test(l.capturedAt) && Date.parse(l.capturedAt) <= Date.now(), `${l.asin}: capturedAt inválido`);
    if (l.price === null) { assert.equal(l.seller, null, `${l.asin}: vendedor sem preço`); continue; }
    assert.ok(typeof l.price === 'number' && l.price > 0, `${l.asin}: preço`);
    assert.ok(typeof l.seller === 'string' && l.seller, `${l.asin}: preço sem vendedor`);
    assert.ok(['amazon', 'seller'].includes(l.fulfilledBy), `${l.asin}: fulfilledBy`);
  }
});

// A Amazon às vezes escreve o formato em inglês. matchTitle só pode trocar esses termos pelo nome Copag do formato.
const EN_PT = [['4-Pack Blister', 'Blister Quádruplo'], ['3-Pack Blister', 'Blister Triplo'], ['Advanced Trainer Box', 'Treinador Avançado']];
const toPt = (s) => EN_PT.reduce((x, [en, pt]) => x.replace(en, pt), s);
t('cada link continua casando com o mesmo produto pelo matcher do site', () => {
  for (const l of doc.links) {
    if (l.matchTitle !== undefined) {
      assert.notEqual(l.matchTitle, l.title, `${l.asin}: matchTitle igual ao título`);
      assert.equal(l.matchTitle, toPt(l.title), `${l.asin}: matchTitle só pode traduzir o formato (${EN_PT.map((x) => x[0]).join(', ')})`);
    }
    const title = l.matchTitle ?? l.title;
    const m = matchProduct({ title }, catalog);
    assert.equal(m.productId, l.productId, `${l.asin}: "${title}" agora casa com ${m.productId} (${m.why?.join(', ')})`);
  }
});

t('preço, ranking, Opportunity Score e API nunca leem a lista da Amazon', () => {
  const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((d) => {
    const rel = `${dir}/${d.name}`; return d.isDirectory() ? walk(rel) : /\.(m?js|cjs)$/.test(d.name) ? [rel] : [];
  });
  const files = [...walk('src'), ...walk('api')];
  assert.ok(files.includes('src/core/price-engine.js') && files.includes('src/core/opportunity-engine.js'));
  const hits = files.filter((f) => /afiliados[/-]amazon|config\/afiliados/.test(read(f)));
  assert.deepEqual(hits, [], `arquivo de afiliado lido por: ${hits.join(', ')}`);
});

t('front: a lista só é usada no bloco "Também na Amazon", com rel sponsored; aviso de afiliado no rodapé e nos Termos', () => {
  const src = read('index.html');
  assert.equal(src.match(/fetch\("\/data\/afiliados-amazon\.json"\)/g)?.length, 1, 'a lista deve ser carregada num único lugar');
  const block = src.match(/function amzBlock\(pid\)\{[\s\S]*?<\/section>`\}/)?.[0];
  const row = src.match(/function amzRow\(l\)\{[\s\S]*?<\/div>`\}/)?.[0];
  assert.ok(block && row, 'amzBlock/amzRow não encontrados');
  assert.match(row, /rel="noopener nofollow sponsored"/);
  assert.match(block, /Preço e disponibilidade na data e hora indicadas/, 'aviso de data e hora junto do preço');
  assert.match(row, /money\(l\.price\)\}<\/b> <small>em \$\{esc\(when\)\}/, 'preço da Amazon sempre com a data e hora da leitura');
  assert.equal(src.match(/AMZ\?\.links|AMZ\.links/g)?.length, 1, 'os links da Amazon só podem ser lidos pelo amzBlock');
  assert.match(src, /como Associado da Amazon, o TCG Price Hunter recebe por compras qualificadas/);
});

t('build publica a lista em /data/ (e o buildCommand da Vercel cabe no limite de 256 caracteres)', () => {
  const v = JSON.parse(read('vercel.json'));
  const pkg = JSON.parse(read('package.json'));
  assert.ok(v.buildCommand.length <= 256, `buildCommand com ${v.buildCommand.length} caracteres: a Vercel recusa acima de 256`);
  assert.equal(v.buildCommand, 'npm run build');
  assert.match(pkg.scripts.build, /cp config\/afiliados\/amazon\.json public\/data\/afiliados-amazon\.json/);
});

console.log(`✓ Amazon Associados: ${n} grupos passaram (${doc.links.length} links, fora do ranking)`);
