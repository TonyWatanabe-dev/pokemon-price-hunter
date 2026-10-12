// Acessibilidade do conteúdo dinâmico: estados de erro anunciados, carregamento sinalizado, regiões live preservadas.
import assert from 'node:assert/strict';
import fs from 'node:fs';

for (const f of ['../index.html', '../tools/page.template.html']) {
  const html = fs.readFileSync(new URL(f, import.meta.url), 'utf8');
  const errs = html.match(/class="empty err-state"[^>]*>/g) || [];
  // O template não tem a página de oportunidades (só o index.html tem): ele tem 2 estados de erro, o index.html 3.
  assert.ok(errs.length >= 2, `${f}: estados de erro esperados`);
  for (const e of errs) assert.match(e, /role="alert"/, `${f}: erro sem role=alert`);
  if (html.includes('OPP.status==="error"')) assert.match(html, /OPP\.status==="error"\)return`<div class="empty err-state" role="alert">/, `${f}: erro das oportunidades sem role=alert`);
  const skels = html.match(/<div class="layout"[^>]*><div class="skel"/g) || [];
  assert.ok(skels.length >= 2, `${f}: esqueletos de carregamento esperados`);
  for (const s of skels) assert.match(s, /aria-busy="true"/, `${f}: carregamento sem aria-busy`);
  assert.match(html, /id="toast" role="status" aria-live="polite"/, `${f}: toast live`);
  assert.match(html, /id="fresh" aria-live="polite"/, `${f}: frescor live`);
  assert.match(html, /class="ticker" aria-live="off"/, `${f}: ticker não deve ser anunciado`);
}

// Vazios e contagem anunciados (role=status) e focusErr funcional (tabindex=-1 nos <p class="err">).
const idx = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert.match(idx, /<h2 role="status">\$\{res\.length\?/, 'contagem da busca sem role=status');
for (const h of ['Nenhum produto com esses filtros', 'Nenhuma pista com', 'Nenhuma oportunidade encontrada', 'Nenhuma pré-venda agora'])
  assert.ok(idx.includes(`<div class="empty" role="status"><h3>${h}`), `vazio sem role=status: ${h}`);
assert.ok(!idx.includes('<div class="empty" role="status"><h3>Não achamos esse produto'), 'vazio da busca duplicaria o anúncio do h2');
const errPs = idx.match(/<p class="err[^"]*"[^>]*>/g) || [];
assert.ok(errPs.length >= 2, 'parágrafos .err esperados');
for (const e of errPs) assert.match(e, /tabindex="-1"/, `focusErr não consegue focar: ${e}`);
console.log('a11y-dynamic-tests: ok');
