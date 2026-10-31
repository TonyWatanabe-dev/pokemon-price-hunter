// Acessórios com link de afiliado (config/afiliados/acessorios.json → /data/afiliados-acessorios.json → acessorios.html).
// Lista curada à parte: nunca lida pelo robô, ranking, Score ou kit; preço com data da leitura; ordem só por preço.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { parse, validar, CATEGORIAS } from '../tools/acessorios-importar.mjs';
import { classificarAcessorio } from '../api/_lib/acessorios.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ler = (f) => fs.readFileSync(path.join(root, f), 'utf8');
let n = 0; const t = (nome, fn) => { try { fn(); n++; } catch (e) { e.message = `[${nome}] ${e.message}`; throw e; } };

t('arquivo versionado passa na validação e cobre as 5 categorias', () => {
  const j = JSON.parse(ler('config/afiliados/acessorios.json'));
  assert.deepEqual(validar(j), []);
  for (const c of Object.keys(CATEGORIAS)) assert.ok(j.itens.some((i) => i.categoria === c), `sem ${c}`);
  for (const l of ['mercadolivre', 'amazon', 'shopee']) assert.ok(j.itens.some((i) => i.loja === l), `sem ${l}`);
  assert.match(j.regras, /nunca entra em oferta, ranking, Opportunity Score/);
});

t('o arquivo é o resultado do importador sobre as leituras versionadas', () => {
  const j = JSON.parse(ler('config/afiliados/acessorios.json'));
  const itens = ['mercadolivre:ml', 'amazon:amazon', 'shopee:shopee'].flatMap((s) => { const [l, f] = s.split(':'); return parse(l, ler(`tools/acessorios/${f}-2026-10-31.txt`)).itens; });
  assert.equal(j.itens.length, itens.length);
  const k = (i) => `${i.loja}:${i.id}:${i.price}:${i.url}`;
  assert.deepEqual(new Set(j.itens.map(k)), new Set(itens.map(k)));
});

t('parse: cupom Shopee, faixa, duplicata, id do ML em URL antiga, fora do padrão', () => {
  const sh = 'x ; shopee.com.br/product/1/2 ; https://s.shopee.com.br/abc ; Dragon Shield Matte 100 Sleeves ; R$ 92,11 (ou R$ 96,95) ; - ; Loja ; Dragon Shield ; sleeve ; 100 un ; disponível ; 31/10/2026 12:57\n'
    + 'y ; shopee.com.br/product/1/2 ; https://s.shopee.com.br/def ; Dragon Shield Matte 100 Sleeves ; R$ 92,11 (ou R$ 96,95) ; - ; Loja ; Dragon Shield ; sleeve ; 100 un ; disponível ; 31/10/2026 12:58\n'
    + 'z ; shopee.com.br/product/3/4 ; https://s.shopee.com.br/ghi ; Deck Box Dragon Shield Double Shell 150+ ; R$ 65,99 a R$ 69,90 (conforme cor) ; - ; Loja ; Dragon Shield ; deck box ; 150+ ; 3 ; 31/10/2026 13:00\n';
  const r = parse('shopee', sh);
  assert.equal(r.itens.length, 2, 'mesmo anúncio em duas buscas entra uma vez');
  assert.equal(r.itens[0].price, 96.95); assert.equal(r.itens[0].priceCupom, 92.11);
  assert.equal(r.itens[0].capturedAt, '2026-10-31T12:57:00-03:00');
  assert.equal(r.itens[1].price, 65.99); assert.equal(r.itens[1].aPartirDe, true);
  const ml = parse('mercadolivre', 'deck box ; https://produto.mercadolivre.com.br/MLB-3112266470-deck-box-_JM ; https://meli.la/2xX ; Deck Box Gamegenic Fourtress 320+ ; R$ 73,99 ; LOJA ; Gamegenic ; deck box ; 320+ ; 1 ; 31/10/2026 13:10\n'
    + 'sleeve ; https://www.mercadolivre.com.br/p/MLB1?pdp_filters=item_id%3AMLB99 ; https://meli.la/1 ; Lorcana Sleeve Tiana 65 Unidades Copag ; R$ 111,24 ; LOJA ; Copag ; sleeve ; 65 ; 1 ; 31/10/2026 13:10\n');
  assert.equal(ml.itens.length, 1); assert.equal(ml.itens[0].id, 'MLB3112266470');
  assert.equal(ml.fora[0].motivo, 'estampa Lorcana');
  const am = parse('amazon', 't ; amazon.com.br/dp/B000000001 ; https://link.amazon/x ; Ultra Pro Toploader 10,16 cm x 15,24 cm (4" x 6"), 25 unidades ; R$114,74 ; V ; Vendedor ; Ultra Pro ; toploader ; 25 ; Em estoque ; 31/10/2026, 13:10:01\n');
  assert.equal(am.itens.length, 0); assert.match(am.fora[0].motivo, /4x6/);
  assert.ok(validar({ itens: [{ ...r.itens[0], productId: 'x' }] }).some((e) => /lacrado/.test(e)), 'acessório não se liga a produto do catálogo');
});

t('classificador: a marca Dragon Shield não transforma deck box ou fichário em sleeve', () => {
  assert.equal(classificarAcessorio('Deck Box Dragon Shield Shell 100 Case Pokemon Magic').kit, 'deck_box');
  assert.equal(classificarAcessorio('Pasta Binder Fichário 360 Espaços Com Zíper Dragon Shield TCG').kit, 'fichario');
  assert.equal(classificarAcessorio('Dragon Shield Matte Standard 100 Sleeves').kit, 'sleeve');
});

t('site: página fora do índice, link de afiliado marcado, ordem só por preço, data da leitura', () => {
  const h = ler('acessorios.html'); const js = ler('assets/web/acessorios-v1.js');
  assert.match(h, /<meta name="robots" content="noindex/); assert.match(h, /acessorios-v1\.js/);
  assert.match(h, /nunca muda a ordem/);
  assert.match(js, /fetch\('\/data\/afiliados-acessorios\.json'\)/);
  assert.match(js, /rel="sponsored nofollow noopener"/);
  assert.match(js, /sort\(function \(a, b\) \{ return a\.price - b\.price; \}\)/);
  assert.match(js, /Lido em /);
  const b = JSON.parse(ler('package.json')).scripts.build;
  assert.match(b, /\bacessorios\.html\b/); assert.match(b, /cp config\/afiliados\/acessorios\.json public\/data\/afiliados-acessorios\.json/);
  assert.match(ler('index.html'), /<a href="\/acessorios\.html">Acessórios<\/a>/);
  assert.match(ler('kit.html'), /href="\/acessorios\.html"/);
});

t('robô, ranking, Score e API não leem a lista de acessórios (o kit completa no navegador)', () => {
  const lista = (d) => fs.readdirSync(path.join(root, d), { recursive: true }).filter((f) => /\.(m?js)$/.test(f)).map((f) => path.join(d, f));
  for (const f of [...lista('src'), ...lista('api')]) assert.doesNotMatch(ler(f), /acessorios\.json|afiliados-acessorios/, f);
});

console.log(`✓ acessorios: ${n} grupos passaram`);
