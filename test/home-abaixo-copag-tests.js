// Linha do topo da Home (17/10): "N abaixo do preço Copag" ao lado de lojas e ofertas com estoque. Mesma regra no servidor
// (api/_lib/home.mjs, counts.belowCopag) e no site sem resumo: oferta viva, sem anomalia, desconto >= 0,5% e Copag confirmado.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
assert.match(read('api/_lib/home.mjs'), /belowCopag: liveAll\.filter\(\(o\) => !o\.anomalous && o\.discount >= 0\.005 && P\.get\(o\.productId\)\?\.copagConfirmed\)\.length/);
const html = read('index.html');
assert.match(html, /const nBelow=S\.slim\?\(S\.counts\.belowCopag\|\|0\):OFF\.filter\(\(o\)=>live\(o\)&&!o\.anomalous&&o\.discount>=\.005&&P\[o\.productId\]\?\.copagConfirmed\)\.length/);
assert.match(html, /\$\{nBelow\?`<p class="live-below" style="--d:560"><b>\$\{nBelow\}<\/b> abaixo do preço Copag<\/p>`:""\}/, 'some quando é zero');
console.log('✓ Home: contagem abaixo da Copag no topo');
