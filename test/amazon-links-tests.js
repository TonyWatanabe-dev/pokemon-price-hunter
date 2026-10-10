// "Também na Amazon" (Amazon Associados): a lista curada em config/afiliados/amazon.json é a ÚNICA fonte de link
// com tag de afiliado. Este teste trava as regras: link no formato oficial, casado pelo matcher do site, sem preço,
// fora do ranking (nenhum módulo de preço/ranking/API lê o arquivo) e mostrado só no bloco próprio, com aviso.
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

t('cada link: ASIN válido, URL oficial exata com a tag do arquivo, sem preço', () => {
  const seen = new Set();
  for (const l of doc.links) {
    assert.match(l.asin, /^[A-Z0-9]{10}$/, l.asin);
    assert.ok(!seen.has(l.asin), `ASIN repetido: ${l.asin}`); seen.add(l.asin);
    assert.equal(l.url, `https://www.amazon.com.br/dp/${l.asin}?tag=${doc.tag}`, l.asin);
    assert.deepEqual(Object.keys(l).sort(), ['asin', 'productId', 'title', 'url'], `${l.asin}: campo a mais (preço não pode entrar)`);
  }
});

t('cada link continua casando com o mesmo produto pelo matcher do site', () => {
  for (const l of doc.links) {
    const m = matchProduct({ title: l.title }, catalog);
    assert.equal(m.productId, l.productId, `${l.asin}: "${l.title}" agora casa com ${m.productId} (${m.why?.join(', ')})`);
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

t('front: a lista só é usada no bloco "Também na Amazon", com rel sponsored e aviso de afiliado', () => {
  const src = read('index.html');
  assert.equal(src.match(/fetch\("\/data\/afiliados-amazon\.json"\)/g)?.length, 1, 'a lista deve ser carregada num único lugar');
  const block = src.match(/function amzBlock\(pid\)\{[\s\S]*?<\/section>`\}/)?.[0];
  assert.ok(block, 'amzBlock não encontrado');
  assert.match(block, /rel="noopener nofollow sponsored"/);
  assert.match(block, /Link de afiliado/);
  assert.doesNotMatch(block, /money\(|\.price|\.total/, 'o bloco da Amazon não pode mostrar preço');
  assert.equal(src.match(/AMZ\?\.links|AMZ\.links/g)?.length, 1, 'os links da Amazon só podem ser lidos pelo amzBlock');
  assert.match(src, /como Associado da Amazon, o TCG Price Hunter recebe por compras qualificadas/);
});

t('build publica a lista em /data/', () => {
  const v = JSON.parse(read('vercel.json'));
  assert.match(v.buildCommand, /cp config\/afiliados\/amazon\.json public\/data\/afiliados-amazon\.json/);
});

console.log(`✓ Amazon Associados: ${n} grupos passaram (${doc.links.length} links, fora do ranking)`);
