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
{
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /function focusTitle\(\)\{[^}]*#view h1, #view h2[^}]*setAttribute\("tabindex","-1"\)[^}]*focus\(\{preventScroll:true\}\)/, 'título do #view deve ter tabindex=-1 e receber foco sem rolar');
  const calls = html.match(/focusTitle\(\)/g) || [];
  assert.ok(calls.length >= 8, 'foco no título esperado em go, hashchange, popstate, grupo, produto e busca');
  assert.match(html, /render\(\);scrollTo\(\{top:0\}\);focusTitle\(\)/, 'go() deve focar o título depois do render');
  assert.doesNotMatch(html.slice(html.indexOf('function render(){'), html.indexOf('function render(){') + 400), /focusTitle/, 'render() não deve roubar o foco ao recarregar dados');
}

// Vazios e contagem anunciados (role=status) e focusErr funcional (tabindex=-1 nos <p class="err">).
const idx = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
// a contagem da busca é anunciada pelo foco no título (focusTitle em doSearch, #279), sem role=status duplicado no h1
assert.match(idx, /view="busca";render\(\);scrollTo\(\{top:0\}\);focusTitle\(\)/, 'contagem da busca não é anunciada');
for (const h of ['Nenhum produto com esses filtros', 'Nenhuma pista com', 'Nenhuma oportunidade encontrada', 'Nenhuma pré-venda agora'])
  assert.match(idx, new RegExp(`<div class="empty" role="status"><h[23]>${h}`), `vazio sem role=status: ${h}`);
assert.doesNotMatch(idx, /<div class="empty" role="status"><h[23]>Não achamos esse produto/, 'vazio da busca duplicaria o anúncio do título');
const errPs = idx.match(/<p class="err[^"]*"[^>]*>/g) || [];
assert.ok(errPs.length >= 2, 'parágrafos .err esperados');
for (const e of errPs) assert.match(e, /tabindex="-1"/, `focusErr não consegue focar: ${e}`);

// Botões ocupados: aria-busy + texto de estado, e restauram o conteúdo original no fim.
assert.match(idx, /function setBusy\(b,on,txt\)\{[^]*?setAttribute\("aria-busy","true"\);b\.textContent=txt\|\|"Salvando…"[^]*?removeAttribute\("aria-busy"\);if\(b\._idle!=null\)\{b\.innerHTML=b\._idle/, 'setBusy deve pôr texto de estado e restaurar o original');
assert.equal((idx.match(/b\.setAttribute\("aria-busy","true"\)/g) || []).length, 1, 'aria-busy em botões só via setBusy');
for (const m of ['setBusy(b,true,"Salvando…")', 'setBusy(b,true,"Excluindo…")', 'setBusy(b,true,"Removendo…")'])
  assert.ok(idx.includes(m), `botão ocupado sem texto de estado: ${m}`);
console.log('a11y-dynamic-tests: ok');

// Foco após remover alerta ou favorito: vai para o próximo item ou, com a lista vazia, para o botão/título da lista.
{
  const fn = (n) => idx.slice(idx.indexOf(n), idx.indexOf(n) + 900);
  const fav = fn('async function unfav(pid)');
  assert.match(fav, /render\(\);\s*const bs=\[\.\.\.document\.querySelectorAll\("\[data-unfav\]"\)\];\(bs\[i\]\|\|bs\[i-1\]\|\|[^;]*#view h2"\)\)\?\.focus\?\.\(\)/, 'unfav deve focar o próximo favorito ou o título');
  const al = fn('if(a==="alert-del")');
  assert.match(al, /if\(view!=="alertas"\)return;render\(\);/, 'alert-del deve re-renderizar a lista de alertas');
  assert.match(al, /\(rs\[i\]\|\|rs\[i-1\]\|\|document\.querySelector\("#view \.empty-in \.btn"\)\|\|document\.querySelector\("#view h2"\)\)\?\.focus\?\.\(\)/, 'alert-del deve focar o próximo alerta ou o título');
}
