// #82 — layout estreito com conteúdo longo no fluxo de compra (página do produto). Sem harness de navegador: o teste lê
// o CSS real de index.html. (1) "Ver oferta na <loja>" (.btn.wide) herdava white-space:nowrap de .btn: em 320 px,
// "Ver oferta na Magazine Luiza" passa da largura do botão e o body (overflow-x:clip) corta o texto; agora quebra linha.
// (2) nome da loja e "vendido por <vendedor>" na lista de ofertas (.so-top b, .so-seller) sem quebra: nome sem espaço
// (vendedor de marketplace) estourava a linha; agora quebra em qualquer ponto.
import assert from 'node:assert/strict';
import fs from 'node:fs';

let n = 0; const t = (name, fn) => { try { fn(); n++; } catch (e) { e.message = `${name}: ${e.message}`; throw e; } };
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = html.slice(html.indexOf('<style'), html.indexOf('</style>'));

// declarações de um seletor exato fora de @media, na ordem do arquivo (a última vence, como no navegador)
function decls(selector) {
  const out = {}; let inMedia = 0;
  const re = /([^{}]+)\{|\}/g; let m; const stack = [];
  while ((m = re.exec(css))) {
    if (m[0] === '}') { const top = stack.pop(); if (top === 'media') inMedia--; continue; }
    const sel = m[1].trim();
    if (sel.startsWith('@media') || sel.startsWith('@supports')) { stack.push('media'); inMedia++; continue; }
    const end = css.indexOf('}', re.lastIndex); const body = css.slice(re.lastIndex, end);
    stack.push('rule');
    if (!inMedia && sel.split(',').map((x) => x.trim()).includes(selector))
      for (const d of body.split(';')) { const k = d.indexOf(':'); if (k > 0) out[d.slice(0, k).trim()] = d.slice(k + 1).trim(); }
  }
  return out;
}

t('.btn continua nowrap (botões curtos) e .btn.wide quebra linha com nome de loja longo', () => {
  assert.equal(decls('.btn')['white-space'], 'nowrap');
  const w = decls('.btn.wide');
  assert.equal(w.width, '100%'); assert.equal(w['white-space'], 'normal'); assert.equal(w['overflow-wrap'], 'anywhere'); assert.equal(w['text-align'], 'center');
  assert.match(html, /<a class="btn wide"[^>]*>Ver oferta na \$\{esc\(best\.storeName\)\}/, 'CTA do produto usa .btn.wide com o nome da loja');
});

t('lista de ofertas: nome da loja e vendedor quebram em qualquer ponto', () => {
  for (const s of ['.so-top b', '.so-seller']) {
    const d = decls(s); assert.equal(d['overflow-wrap'], 'anywhere', s); assert.equal(d['min-width'], '0', s);
  }
  assert.equal(decls('.so-top')['flex-wrap'], 'wrap');
  assert.equal(decls('.so-mid>div')['min-width'], '0', 'preço não empurra o "Ver oferta"');
  assert.equal(decls('.so .btn').flex, 'none', '"Ver oferta" da lista não encolhe');
});

t('nenhuma regra sob @media volta o .btn.wide para nowrap', () => {
  assert.doesNotMatch(css, /\.btn\.wide\{[^}]*white-space:nowrap/);
});

console.log(`✓ Fluxo de compra com nomes longos em tela estreita (#82): ${n} grupos passaram`);
