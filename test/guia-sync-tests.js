// Lote E: o guia do site (index.html, const GUIA) é a cópia literal de api/_lib/guia.mjs. Se um dos dois mudar sozinho,
// este teste quebra: o texto que o Google lê no SSR tem de ser o mesmo que a pessoa lê no site.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { GUIA, plain, guiaHTML, faqHTML, glossarioHTML, faqLD, glossarioLD } from '../api/_lib/guia.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0;
async function t(name, fn) { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } }
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

await t('1. const GUIA do index.html é idêntica ao objeto de api/_lib/guia.mjs', () => {
  const m = html.match(/^const GUIA=(\{.*\});$/m); assert.ok(m, 'const GUIA=... numa linha só');
  const ctx = vm.createContext({}); const spa = vm.runInContext('(' + m[1] + ')', ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(spa)), JSON.parse(JSON.stringify(GUIA)));
});

await t('2. o site renderiza a partir de GUIA (sem texto duplicado em renderGuide) e tem a view do glossário', () => {
  const fn = html.slice(html.indexOf('function renderGuide(){'), html.indexOf('function renderLegal(kind){'));
  assert.match(fn, /GUIA\.sections\.map/); assert.match(fn, /GUIA\.faq\.map/); assert.match(fn, /GUIA\.glossario\.map/);
  assert.doesNotMatch(fn, /Opportunity Engine/, 'texto do guia só no módulo');
  assert.match(html, /seg\[0\]==="guia"&&seg\[1\]==="glossario"/); assert.match(html, /glossario:"guia\/glossario"/);
  assert.match(html, /view==="glossario"\)renderGlossario\(\)/);
  assert.match(html, /<a href="\/guia\/glossario" data-go="glossario">Glossário<\/a>/, 'link no rodapé');
});

await t('3. conteúdo: 6 a 8 perguntas com os temas pedidos, faixas iguais ao motor (90/75/50), 15+ termos, HTML limpo', async () => {
  const { BANDS } = await import('../src/core/opportunity-engine.js');
  assert.deepEqual(BANDS.map(([m]) => m), [90, 75, 50, 0]);
  const bands = GUIA.sections.flatMap((s) => s.blocks).find((b) => b.bands).bands;
  assert.deepEqual(bands.map(([k, , r]) => [k, r]), [['excelente', '90 a 100'], ['boa', '75 a 89'], ['normal', '50 a 74'], ['baixa', '0 a 49']]);
  assert.ok(GUIA.faq.length >= 6 && GUIA.faq.length <= 8, GUIA.faq.length);
  const qs = GUIA.faq.map((f) => f.q + ' ' + f.a).join('\n');
  for (const re of [/Opportunity Score/, /Excelente: 90 a 100/, /confiança/i, /preço sugerido Copag/i, /pré-venda/i, /sem estoque/i, /no Pix/, /frete/i, /afiliado/i, /nunca muda/, /golpe/i, /alerta/i, /Criar alerta/]) assert.match(qs, re);
  assert.ok(GUIA.glossario.length >= 15);
  for (const term of ['Booster', 'Booster Box', 'Blister', 'ETB', 'Lata', 'Deck', 'Coleção', 'Copag', 'Preço sugerido', 'Pix', 'Opportunity Score', 'Confiança', 'Pré-venda', 'Frete comparável', 'Reclame Aqui', 'Lacrado']) assert.ok(GUIA.glossario.some((x) => x.t.includes(term)), term);
  const all = JSON.stringify(GUIA);
  assert.doesNotMatch(all, /<(?!\/?(b|i|a)\b)[a-z]/i, 'só <b>, <i> e <a> nos textos');
  assert.doesNotMatch(all, /<script|javascript:|on\w+=/i);
  assert.equal(plain('<b>x</b>  y'), 'x y');
  assert.equal((guiaHTML().match(/<h2>/g) || []).length, GUIA.sections.length);
  assert.equal((faqHTML().match(/<h3>/g) || []).length, GUIA.faq.length);
  assert.equal((glossarioHTML().match(/<dt /g) || []).length, GUIA.glossario.length);
  assert.equal(faqLD().mainEntity.length, GUIA.faq.length); assert.equal(glossarioLD(GUIA, 'https://x').hasDefinedTerm.length, GUIA.glossario.length);
});

console.log(`✓ Guia em sincronia: ${n} grupos de testes passaram`);
