// Social Media — gerador de rascunhos (issue #634): Telegram e Instagram, divulgação de afiliado obrigatória, frete
// desconhecido explícito, truncamento seguro, injeção no texto da loja e recusas. Módulo puro: sem rede, sem banco.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gerarRascunho, limpar, socialEnabled, SOCIAL_ENABLED_DEFAULT, DISCLOSURE, LIMITES, CANAIS } from '../src/agents/social/rascunho.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0;
function t(name, fn) { try { fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } }
const SITE = 'https://tcgpricehunter.com.br';
const oferta = (o = {}) => ({
  produto: { nome: 'Booster Box Evoluções Prismáticas', slug: 'evolucoes-prismaticas-booster-box' },
  loja: { nome: 'Loja Exemplo' }, preco: 899.9, precoTotal: 925.4,
  url: 'https://loja.exemplo.com.br/p/123', urlDestino: 'https://loja.exemplo.com.br/p/123', disclosure: false,
  lidaEm: '2026-10-13T17:05:00.000Z', ...o,
});
const tg = (o, opts) => gerarRascunho(oferta(o), { canal: 'telegram', siteUrl: SITE, ...opts });
const ig = (o, opts) => gerarRascunho(oferta(o), { canal: 'instagram', siteUrl: SITE, ...opts });
const nbsp = (s) => s.replace(/ /g, ' ');
const URL_RE = /https?:\/\/|www\./i;

t('desligado por padrão: só SOCIAL_ENABLED=1 liga', () => {
  assert.equal(SOCIAL_ENABLED_DEFAULT, false);
  for (const env of [undefined, null, {}, { SOCIAL_ENABLED: '' }, { SOCIAL_ENABLED: '0' }, { SOCIAL_ENABLED: 'false' }, { SOCIAL_ENABLED: 'true' }]) assert.equal(!!socialEnabled(env), false);
  assert.equal(socialEnabled({ SOCIAL_ENABLED: '1' }), true);
  assert.deepEqual([...CANAIS], ['telegram', 'instagram']);
});

t('Telegram: nome, loja, preço em BRL, total, data, link no corpo', () => {
  const r = tg();
  assert.equal(r.canal, 'telegram');
  assert.equal(r.link, `${SITE}/produto/evolucoes-prismaticas-booster-box`);
  const txt = nbsp(r.texto);
  assert.match(txt, /^Booster Box Evoluções Prismáticas\n/);
  assert.match(txt, /R\$ 899,90 em Loja Exemplo · total com frete R\$ 925,40/);
  assert.match(txt, /Preço visto em 13\/10\/2026,? 14:05\./);
  assert.ok(txt.includes(r.link));
  assert.ok(!txt.includes('frete a calcular'));
  assert.ok(!txt.includes(DISCLOSURE));
  assert.ok(r.texto.length <= LIMITES.telegram);
  assert.deepEqual(r.avisos, []);
});

t('Instagram: mesmo conteúdo, sem link no corpo (link vai em `link`)', () => {
  const r = ig();
  assert.equal(r.canal, 'instagram');
  assert.equal(r.link, `${SITE}/produto/evolucoes-prismaticas-booster-box`);
  assert.ok(!URL_RE.test(r.texto), r.texto);
  assert.ok(!r.texto.includes('tcgpricehunter.com.br'));
  assert.match(r.texto, /na bio/);
  assert.match(nbsp(r.texto), /R\$ 899,90 em Loja Exemplo/);
  assert.ok(r.texto.length <= LIMITES.instagram);
});

t('determinístico: mesma entrada, mesma saída; siteUrl com caminho/barra usa só a origem', () => {
  assert.deepEqual(tg(), tg());
  assert.equal(tg({}, { siteUrl: SITE + '/' }).link, tg().link);
  assert.equal(tg({}, { siteUrl: SITE + '/x?y=1' }).link, tg().link);
});

t('disclosure true: frase de afiliado obrigatória nos dois canais', () => {
  for (const r of [tg({ disclosure: true }), ig({ disclosure: true })]) {
    assert.ok(r.texto.includes(DISCLOSURE), r.canal);
    assert.ok(r.texto.length <= LIMITES[r.canal]);
  }
  for (const d of [false, undefined, 'true', 1]) assert.ok(!tg({ disclosure: d }).texto.includes(DISCLOSURE), String(d));
});

t('frete desconhecido: "frete a calcular" explícito, nunca total inventado', () => {
  for (const r of [tg({ precoTotal: null }), ig({ precoTotal: null }), tg({ precoTotal: undefined })]) {
    assert.match(nbsp(r.texto), /R\$ 899,90 em Loja Exemplo \(frete a calcular\)/);
    assert.ok(!r.texto.includes('total com frete'));
    assert.ok(r.avisos.includes('frete desconhecido: total a calcular'));
  }
  for (const v of [500, Number.NaN, '925.40']) {
    const r = tg({ precoTotal: v });
    assert.ok(r.texto.includes('(frete a calcular)'), String(v));
    assert.ok(!r.texto.includes('total com frete'));
    assert.ok(r.avisos.some((a) => a.startsWith('precoTotal inválido')));
  }
  assert.match(nbsp(tg({ precoTotal: 899.9 }).texto), /total com frete R\$ 899,90/);   // frete grátis
});

t('truncamento seguro: nome enorme encolhe, preço/link/divulgação ficam inteiros', () => {
  const nome = 'Booster 🎴 '.repeat(800);
  for (const canal of CANAIS) {
    const r = gerarRascunho(oferta({ produto: { nome, slug: 'x' }, loja: { nome: 'L'.repeat(500) }, disclosure: true, precoTotal: null }), { canal, siteUrl: SITE });
    assert.ok(r.texto.length <= LIMITES[canal], `${canal}: ${r.texto.length}`);
    assert.ok(r.texto.includes(DISCLOSURE));
    assert.ok(r.texto.includes('(frete a calcular)'));
    assert.ok(r.avisos.includes('nome do produto truncado'));
    assert.ok(r.avisos.includes('nome da loja truncado'));
    if (canal === 'telegram') assert.ok(r.texto.includes(`${SITE}/produto/x`));
    const primeira = r.texto.split('\n')[0];
    assert.ok(primeira.endsWith('…'));
    assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(r.texto), 'surrogate partido');
  }
  // Limite apertado: o nome encolhe até caber exatamente.
  const r = tg({ produto: { nome: 'a'.repeat(5000), slug: 'x' }, disclosure: true });
  assert.ok(r.texto.length <= LIMITES.telegram);
  assert.ok(!tg().avisos.includes('nome do produto truncado'));
});

t('injeção no título e na loja: sem HTML, markdown, link ou @menção', () => {
  const nome = '<b>Box</b> <script>alert(1)</script> [clique](https://evil.example) *grátis* _já_ `x` @everyone ＠admin www.evil.example #promo (36 boosters)';
  for (const r of [tg({ produto: { nome, slug: 'box' }, loja: { nome: '<a href="https://x.y">Loja</a> @loja‮​' } }), ig({ produto: { nome, slug: 'box' }, loja: { nome: '[Loja](javascript:alert(1))' } })]) {
    const corpo = r.canal === 'telegram' ? r.texto.replace(r.link, '') : r.texto;
    assert.ok(!/[<>*_`[\]@#\\]/.test(corpo), corpo);
    assert.ok(!URL_RE.test(corpo), corpo);
    assert.ok(!/[​‮]/.test(corpo));
    assert.ok(!corpo.includes('evil.example'));
    assert.ok(corpo.includes('(36 boosters)'));
    assert.ok(r.avisos.some((a) => a.startsWith('texto da loja limpo')));
  }
  assert.equal(limpar('Box\n\nNovo\tLacrado'), 'Box Novo Lacrado');
  assert.equal(limpar('ETB Evoluções Prismáticas'), 'ETB Evoluções Prismáticas');
});

t('recusas explícitas: sem preço, URL não https, canal desconhecido, slug/site inválidos', () => {
  const recusa = (fn, re) => assert.throws(fn, (e) => e.code === 'RASCUNHO_INVALIDO' && re.test(e.message));
  for (const preco of [undefined, null, 0, -1, Number.NaN, Infinity, '899,90']) recusa(() => tg({ preco }), /sem preço/);
  for (const url of [undefined, '', 'http://loja.com/p', 'javascript:alert(1)', 'loja.com/p', 'ftp://x.y']) recusa(() => tg({ url }), /sem URL https/);
  recusa(() => tg({ urlDestino: 'http://x.y' }), /urlDestino/);
  for (const canal of [undefined, '', 'whatsapp', 'Telegram', 'twitter']) recusa(() => gerarRascunho(oferta(), { canal, siteUrl: SITE }), /canal desconhecido/);
  for (const siteUrl of [undefined, 'http://tcgpricehunter.com.br', 'tcg']) recusa(() => tg({}, { siteUrl }), /siteUrl/);
  for (const slug of [undefined, '', '../admin', 'a b', 'A', 'x?y=1']) recusa(() => tg({ produto: { nome: 'Box', slug } }), /slug/);
  recusa(() => tg({ produto: { nome: '<b></b>', slug: 'x' } }), /sem nome/);
  recusa(() => tg({ loja: { nome: '@' } }), /loja sem nome/);
  for (const o of [null, undefined, [], 'x']) recusa(() => gerarRascunho(o, { canal: 'telegram', siteUrl: SITE }), /sem preço/);
  recusa(() => gerarRascunho(oferta(), null), /canal desconhecido/);
});

t('sem data de leitura: rascunho sai sem data e com aviso', () => {
  for (const lidaEm of [undefined, null, 'ontem']) {
    const r = tg({ lidaEm });
    assert.ok(!r.texto.includes('Preço visto'));
    assert.ok(r.avisos.includes('sem data de leitura do preço'));
  }
});

t('isolamento: não importa rede, banco, afiliados nem publica', () => {
  const src = fs.readFileSync(path.join(root, 'src/agents/social/rascunho.js'), 'utf8');
  const imports = [...src.matchAll(/^import .* from '([^']+)';/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ['../../format.js']);
  assert.ok(!/\bfetch\s*\(|process\.env|require\(|import\(/.test(src));
  assert.ok(!/api\.telegram\.org|graph\.facebook\.com|graph\.instagram\.com/.test(src));
});

console.log(`social-rascunho: ${n} testes ok`);
