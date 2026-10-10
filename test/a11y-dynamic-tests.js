// Acessibilidade do conteúdo dinâmico: estados de erro anunciados, carregamento sinalizado, regiões live preservadas.
import assert from 'node:assert/strict';
import fs from 'node:fs';

for (const f of ['../index.html', '../tools/page.template.html']) {
  const html = fs.readFileSync(new URL(f, import.meta.url), 'utf8');
  const errs = html.match(/class="empty err-state"[^>]*>/g) || [];
  assert.ok(errs.length >= 3, `${f}: estados de erro esperados`);
  for (const e of errs) assert.match(e, /role="alert"/, `${f}: erro sem role=alert`);
  const skels = html.match(/<div class="layout"[^>]*><div class="skel"/g) || [];
  assert.ok(skels.length >= 2, `${f}: esqueletos de carregamento esperados`);
  for (const s of skels) assert.match(s, /aria-busy="true"/, `${f}: carregamento sem aria-busy`);
  assert.match(html, /id="toast" role="status" aria-live="polite"/, `${f}: toast live`);
  assert.match(html, /id="fresh" aria-live="polite"/, `${f}: frescor live`);
  assert.match(html, /class="ticker" aria-live="off"/, `${f}: ticker não deve ser anunciado`);
}
console.log('a11y-dynamic-tests: ok');
