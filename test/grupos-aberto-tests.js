// Pedido do dono (17/10): no computador, o balão com WhatsApp e Telegram já aparece aberto, sem precisar clicar.
// O X do balão fecha por 7 dias; na página do produto fica só o botão (não cobre o "Ver oferta");
// depois que a pessoa abre ou fecha na visita, o site não reabre sozinho.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const ui = html.match(/function grpUI\(\)\{[\s\S]*?\n\}/)[0];
assert.match(ui, /if\(!grpPopMexeu\)grpPop\(view!=="produto"&&!grpPopFechado\(\)\)/, 'balão aberto por padrão, menos no produto ou se fechado');
assert.match(ui, /class="grp-x" data-grp-popx aria-label="Fechar por 7 dias"/, 'X do balão fecha por 7 dias');
assert.match(html, /function grpPopFechado\(\)\{const t=store\.get\("grp-pop-fechado",0\);return typeof t==="number"&&Date\.now\(\)-t<GRP_FECHA_DIAS\*864e5\}/);
assert.match(html, /\[data-grp-popx\]"\)\)\{grpPopMexeu=true;store\.set\("grp-pop-fechado",Date\.now\(\)\);grpPop\(false\);return\}/, 'fechar grava a data');
assert.match(html, /\[data-grp-pop\]"\)\)\{grpPopMexeu=true;grpPop\(/, 'botão continua abrindo e fechando');
assert.ok(html.indexOf('[data-grp-popx]') < html.indexOf('[data-grp-pop]"'), 'X tratado antes do botão');
assert.match(html, /if\(!t\.closest\("#grp-fab"\)&&grpPopMexeu\)grpPop\(false\);/, 'clique fora não fecha o balão aberto por padrão (só depois que a pessoa mexeu)');
console.log('✓ Grupos: balão aberto no computador, X fecha por 7 dias');
