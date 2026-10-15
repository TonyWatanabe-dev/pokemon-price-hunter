// Social Media — legendas de carrossel por slide (issue #647): ordem fixa dos slides, limites por slide, disclosure
// sempre no último, frete desconhecido explícito, injeção no texto da loja, ordem das elegíveis preservada e recusas.
// Módulo puro: sem rede, sem banco, sem imagem.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  gerarCarrossel, socialEnabled, SOCIAL_ENABLED_DEFAULT, TIPOS, LIMITES_SLIDE, MAX_COMPARACAO, SEM_AFILIADO, CTA,
} from '../src/agents/social/carrossel.js';
import { DISCLOSURE, AVISO_COMPRA } from '../src/agents/social/rascunho.js';
import { selecionarElegiveis } from '../src/agents/social/elegiveis.js';
import { parseAffiliates } from '../api/_lib/affiliates.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0;
function t(name, fn) { try { fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } }
const SITE = 'https://tcgpricehunter.com.br';
const T0 = Date.parse('2026-10-13T17:10:00Z');
const SEM_CFG = parseAffiliates(null);
const CFG = parseAffiliates({ mercadolivre: { anuncios: { MLB1234567890: 'https://meli.la/abc' } } });
const produto = { nome: 'Booster Box Evoluções Prismáticas', slug: 'evolucoes-prismaticas-booster-box' };
// Formatos das elegíveis: API v1 (read-db/read-state) e state.json.
const api = (o = {}) => ({ id: 'a1', product: { id: 'pe-bb' }, store: { id: 'loja-a', name: 'Loja A' }, stock: 'in_stock', status: 'active',
  confirmed: true, anomalous: false, price: 899.9, total_price: 925.4, shipping: { status: 'known', price: 25.5 },
  url: 'https://loja-a.com.br/bb', last_seen_at: '2026-10-13T17:05:00.000Z', ...o });
const st = (o = {}) => ({ id: 's1', productId: 'pe-bb', storeId: 'loja-b', storeName: 'Loja B', stock: 'IN_STOCK', stale: false, anomalous: false,
  price: 950, shippingKnown: true, total: 950, url: 'https://loja-b.com.br/bb', source_timestamp: '2026-10-13T17:00:00.000Z', ...o });
const gerar = (ofertas, opts) => gerarCarrossel(ofertas, { produto, siteUrl: SITE, afiliados: SEM_CFG, ...opts });
const nbsp = (s) => s.replace(/[\u00a0\u202f]/g, ' ');
const URL_RE = /https?:\/\/|www\./i;
const textos = (r) => Object.fromEntries(r.slides.map((s) => [s.tipo, nbsp(s.texto)]));

t('desligado por padrão: só SOCIAL_ENABLED=1 liga', () => {
  assert.equal(SOCIAL_ENABLED_DEFAULT, false);
  for (const env of [undefined, {}, { SOCIAL_ENABLED: '' }, { SOCIAL_ENABLED: '0' }, { SOCIAL_ENABLED: 'true' }]) assert.equal(!!socialEnabled(env), false);
  assert.equal(socialEnabled({ SOCIAL_ENABLED: '1' }), true);
});

t('slides na ordem fixa capa → oferta → comparação → CTA → disclosure, cada um no limite', () => {
  const r = gerar([api(), st()]);
  assert.deepEqual(r.slides.map((s) => s.tipo), [...TIPOS]);
  assert.deepEqual([...TIPOS], ['capa', 'oferta', 'comparacao', 'cta', 'disclosure']);
  for (const s of r.slides) assert.ok(s.texto.length > 0 && s.texto.length <= LIMITES_SLIDE[s.tipo], s.tipo);
  const x = textos(r);
  assert.equal(x.capa, 'Booster Box Evoluções Prismáticas\nComparamos 2 ofertas com estoque confirmado.');
  assert.match(x.oferta, /^Menor total com frete encontrado\nLoja A: R\$ 899,90 · total com frete R\$ 925,40\nPreço visto em 13\/10\/2026,? 14:05\.$/);
  assert.equal(x.comparacao, 'Outras ofertas:\n• Loja B: R$ 950,00 · total com frete R$ 950,00');
  assert.equal(x.cta, `${CTA}\n${AVISO_COMPRA}`);
  assert.equal(r.link, `${SITE}/produto/evolucoes-prismaticas-booster-box`);
  assert.deepEqual(r.ofertas, ['a1', 's1']);
  assert.deepEqual(r.avisos, []);
});

t('só texto: nenhum slide traz URL, e o link vai separado', () => {
  const r = gerar([api(), st()], { siteUrl: SITE + '/x?y=1' });
  for (const s of r.slides) assert.ok(!URL_RE.test(s.texto), s.texto);
  assert.equal(r.link, `${SITE}/produto/evolucoes-prismaticas-booster-box`);
  assert.deepEqual(Object.keys(r).sort(), ['afiliado', 'avisos', 'link', 'ofertas', 'slides']);
});

t('disclosure obrigatório e sempre no último slide', () => {
  const sem = gerar([api(), st()]);
  assert.equal(sem.afiliado, false);
  assert.equal(sem.slides.at(-1).tipo, 'disclosure');
  assert.equal(sem.slides.at(-1).texto, SEM_AFILIADO);
  const ml = api({ id: 'ml', store: { id: 'mercadolivre', name: 'Mercado Livre' }, url: 'https://produto.mercadolivre.com.br/MLB-1234567890-bb-_JM', price: 980, total_price: 990 });
  for (const lista of [[api(), ml], [ml, api()], [st({ disclosure: true })]]) {
    const r = gerar(lista, { afiliados: CFG });
    assert.equal(r.afiliado, true);
    assert.equal(r.slides.at(-1).tipo, 'disclosure');
    assert.equal(r.slides.at(-1).texto, DISCLOSURE);
    assert.ok(r.slides.slice(0, -1).every((s) => !s.texto.includes(DISCLOSURE)), 'divulgação só no último');
  }
  assert.equal(gerar([api(), ml]).afiliado, false, 'sem configuração, sem afiliado');
});

t('afiliado não muda a ordem: destaque é sempre a primeira elegível', () => {
  const ml = api({ id: 'ml', store: { id: 'mercadolivre', name: 'Mercado Livre' }, url: 'https://produto.mercadolivre.com.br/MLB-1234567890-bb-_JM', price: 980, total_price: 990 });
  const { elegiveis } = selecionarElegiveis([ml, st(), api()], { now: T0 });
  assert.deepEqual(elegiveis.map((o) => o.id), ['a1', 's1', 'ml']);
  const comAfiliado = gerar(elegiveis, { afiliados: CFG });
  const semAfiliado = gerar(elegiveis);
  assert.deepEqual(comAfiliado.ofertas, ['a1', 's1', 'ml']);
  assert.deepEqual(comAfiliado.slides.slice(0, -1), semAfiliado.slides.slice(0, -1));
  assert.match(textos(comAfiliado).oferta, /Loja A/);
});

t('frete desconhecido: "frete a calcular" explícito, nunca total inventado', () => {
  const desconhecido = [api({ shipping: { status: 'unknown', price: null }, total_price: null }), st({ shippingKnown: false, total: 950, price: 950 })];
  const r = gerar(desconhecido);
  const x = textos(r);
  assert.match(x.oferta, /^Menor preço encontrado \(antes do frete\)\nLoja A: R\$ 899,90 \(frete a calcular\)/);
  assert.equal(x.comparacao, 'Outras ofertas:\n• Loja B: R$ 950,00 (frete a calcular)');
  for (const s of r.slides) assert.ok(!s.texto.includes('total com frete'));
  assert.ok(r.avisos.includes('frete desconhecido no destaque: total a calcular'));
  // Frete "conhecido" com total ausente ou menor que o preço: tratado como desconhecido, com aviso.
  for (const total_price of [null, 500, Number.NaN, '925.40']) {
    const q = gerar([api({ total_price })]);
    assert.match(textos(q).oferta, /\(frete a calcular\)/, String(total_price));
    assert.ok(q.avisos.some((a) => a.startsWith('oferta a1: total inválido')));
  }
  assert.match(textos(gerar([api({ total_price: 899.9, shipping: { status: 'free', price: 0 } })])).oferta, /total com frete R\$ 899,90/);
});

t('comparação: no máximo MAX_COMPARACAO lojas e dentro do limite; o resto vira aviso', () => {
  const muitas = Array.from({ length: 9 }, (_, i) => api({ id: `o${i}`, store: { id: `l${i}`, name: `Loja ${i} ${'X'.repeat(80)}` }, price: 900 + i, total_price: 920 + i }));
  const r = gerar(muitas);
  const linhas = textos(r).comparacao.split('\n').slice(1);
  assert.ok(linhas.length >= 1 && linhas.length <= MAX_COMPARACAO);
  assert.ok(r.slides[2].texto.length <= LIMITES_SLIDE.comparacao);
  assert.ok(linhas.every((l) => l.split(':')[0].length <= 2 + 40), 'loja cortada na comparação');
  assert.deepEqual(r.ofertas, muitas.slice(0, linhas.length + 1).map((o) => o.id));
  assert.ok(r.avisos.includes(`${8 - linhas.length} oferta(s) fora do slide de comparação`));
  assert.equal(textos(r).capa.split('\n')[1], 'Comparamos 9 ofertas com estoque confirmado.');
  // Uma só oferta: o slide de comparação diz isso, sem inventar concorrente.
  const um = gerar([api()]);
  assert.equal(textos(um).capa.split('\n')[1], 'Comparamos 1 oferta com estoque confirmado.');
  assert.match(textos(um).comparacao, /^Só esta oferta passou/);
});

t('truncamento seguro: nome e loja enormes encolhem sem partir emoji', () => {
  const r = gerar([api({ store: { id: 'l', name: 'L'.repeat(500) } })], { produto: { nome: 'Booster 🎴 '.repeat(200), slug: 'x' } });
  for (const s of r.slides) assert.ok(s.texto.length <= LIMITES_SLIDE[s.tipo], s.tipo);
  assert.ok(r.avisos.includes('nome do produto truncado'));
  assert.ok(r.avisos.includes('nome da loja truncado'));
  assert.ok(r.slides[0].texto.split('\n')[0].endsWith('…'));
  assert.match(nbsp(r.slides[1].texto), /…: R\$ 899,90/);
  for (const s of r.slides) assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(s.texto), 'surrogate partido');
});

t('injeção no nome e na loja: sem HTML, markdown, link ou @menção', () => {
  const nome = '<b>Box</b> <script>alert(1)</script> [clique](https://evil.example) *grátis* _já_ `x` @everyone ＠admin www.evil.example #promo (36 boosters)';
  const r = gerar([api({ store: { id: 'l', name: '<a href="https://x.y">Loja</a> @loja‮​' } }), st({ storeName: '[Loja](javascript:alert(1))' })],
    { produto: { nome, slug: 'box' } });
  for (const s of r.slides) {
    assert.ok(!/[<>*_`[\]@#\\]/.test(s.texto), s.texto);
    assert.ok(!URL_RE.test(s.texto), s.texto);
    assert.ok(!/[​‮]/.test(s.texto));
    assert.ok(!s.texto.includes('evil.example'));
  }
  assert.ok(r.slides[0].texto.includes('(36 boosters)'));
  assert.ok(r.avisos.includes('nome do produto limpo: marcação, link ou menção removidos'));
  assert.ok(r.avisos.some((a) => a.startsWith('oferta a1: texto da loja limpo')));
  assert.ok(r.avisos.some((a) => a.startsWith('oferta s1: texto da loja limpo')));
});

t('oferta inválida é ignorada com aviso; sem nenhuma válida, recusa explícita', () => {
  const r = gerar([api({ id: 'sem-preco', price: 0 }), api({ id: 'http', url: 'http://loja.com/p' }), api({ id: 'sem-loja', store: { id: 'x', name: '@' } }), st()]);
  assert.deepEqual(r.ofertas, ['s1']);
  assert.deepEqual(r.avisos.slice(0, 3), ['oferta sem-preco ignorada: sem preço válido', 'oferta http ignorada: sem URL https', 'oferta sem-loja ignorada: loja sem nome']);
  const recusa = (fn, re) => assert.throws(fn, (e) => e.code === 'CARROSSEL_INVALIDO' && re.test(e.message));
  recusa(() => gerar([]), /nenhuma oferta/);
  recusa(() => gerar([null, 'x', api({ price: -1 })]), /nenhuma oferta/);
  for (const o of [null, undefined, 'x', {}]) recusa(() => gerar(o), /lista/);
  for (const siteUrl of [undefined, 'http://tcgpricehunter.com.br', 'tcg']) recusa(() => gerar([api()], { siteUrl }), /siteUrl/);
  for (const slug of [undefined, '', '../admin', 'a b', 'A']) recusa(() => gerar([api()], { produto: { nome: 'Box', slug } }), /slug/);
  recusa(() => gerar([api()], { produto: { nome: '<b></b>', slug: 'x' } }), /sem nome/);
  recusa(() => gerarCarrossel([api()], null), /siteUrl/);
});

t('sem data de leitura: destaque sai sem data e com aviso; determinístico', () => {
  const r = gerar([api({ last_seen_at: null })]);
  assert.ok(!r.slides[1].texto.includes('Preço visto'));
  assert.ok(r.avisos.includes('sem data de leitura do preço no destaque'));
  assert.deepEqual(gerar([api(), st()]), gerar([api(), st()]));
});

t('isolamento: reusa rascunho/elegíveis, sem rede, banco, env nem publicação', () => {
  const src = fs.readFileSync(path.join(root, 'src/agents/social/carrossel.js'), 'utf8');
  const imports = [...src.matchAll(/^import .* from '([^']+)';/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ['../../format.js', './rascunho.js', './elegiveis.js']);
  assert.ok(!/\bfetch\s*\(|process\.env|require\(|import\(/.test(src));
  assert.ok(!/api\.telegram\.org|graph\.facebook\.com|graph\.instagram\.com/.test(src));
});

console.log(`social-carrossel: ${n} testes ok`);
