// Chamada dos grupos (pedido do dono, 17/10): título "Entre no grupo de ofertas" no balão do computador e na barra do
// celular, efeitos leves (entrada, marca-texto, brilho nos botões, flutuar) só sem prefers-reduced-motion, e balão
// arrastável no computador com posição salva (dois cliques no topo volta ao canto).
import assert from 'node:assert/strict';
import fs from 'node:fs';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const ui = html.match(/function grpUI\(\)\{[\s\S]*?\n\}/)[0];
assert.match(ui, /<div class="grp-head" data-grp-drag[^>]*><b class="grp-t">Entre no <mark>grupo de ofertas<\/mark><\/b><p>O robô acha Pokémon TCG abaixo da Copag e avisa no seu celular\. Grátis\.<\/p><\/div>/, 'balão: título + apoio (opção 1)');
assert.match(ui, /dock\.innerHTML=`<span class="grp-lbl">Entre no <mark>grupo de ofertas<\/mark>:<\/span>/, 'celular: linha acima dos botões');
assert.match(ui, /grpPosAplica\(store\.get\("grp-pos",null\)\)/, 'posição salva reaplicada');
const motion = html.match(/@media \(prefers-reduced-motion:no-preference\)\{\n  \.grp-fab\{animation:grpBob[\s\S]*?\n\}/);
assert.ok(motion, 'animações dos grupos só sem prefers-reduced-motion');
for (const k of ['grpBob', 'grpIn', 'grpMark', 'grpShine']) assert.match(motion[0], new RegExp(`@keyframes ${k}`), k);
assert.match(html, /function grpPosAplica\(p\)\{[\s\S]*?Math\.min\(Math\.max\(8,p\.x\),innerWidth-r\.width-8\)/, 'posição presa dentro da tela');
assert.match(html, /store\.set\("grp-pos",\{x:parseFloat\(f\.style\.left\),y:parseFloat\(f\.style\.top\)\}\)/, 'soltar grava a posição');
assert.match(html, /if\(grpArrastou&&t\.closest\("#grp-fab"\)\)\{grpArrastou=false;return\}/, 'soltar após arrastar não vira clique');
assert.ok(html.indexOf('if(grpArrastou&&t.closest("#grp-fab"))') < html.indexOf('[data-grp-popx]"))'), 'checado antes do X e do botão');
assert.match(html, /dblclick[^\n]*store\.set\("grp-pos",null\);grpPosAplica\(null\)/, 'dois cliques volta ao canto');
console.log('✓ Grupos: chamada, efeitos com reduced-motion e balão arrastável');
