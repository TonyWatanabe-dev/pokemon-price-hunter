// Compartilhar oferta (17/10): botão na página do produto ao lado de Favoritar. Leva o link do site (a página do produto,
// que já tem prévia com foto, preço e desconto), nunca o link da loja. Celular: menu do sistema (navigator.share);
// sem ele, WhatsApp com o texto pronto, em nova aba com noopener. Conta "share_click" no Analytics.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert.match(html, /<div class="ptools">\$\{favBtn\(pid\)\}\$\{shareBtn\(pid\)\}<\/div>/, 'botão ao lado de Favoritar');
assert.match(html, /<symbol id="i-share-network" viewBox="0 0 256 256">/, 'ícone no sprite');
assert.match(html, /const url=location\.origin\+"\/produto\/"\+\(SLUG\[pid\]\|\|encodeURIComponent\(pid\)\)/, 'link é a página do produto no site');
assert.match(html, /const wa="https:\/\/wa\.me\/\?text="\+encodeURIComponent\(text\+" "\+url\);window\.open\(wa,"_blank","noopener"\)/, 'WhatsApp com noopener');
assert.match(html, /if\(shb\)\{sharePid\(shb\.dataset\.share\);return\}/, 'clique tratado');
assert.match(html, /track\("share_click"/, 'Analytics');
// texto: preço, loja e desconto Copag só quando confirmado
const src = html.match(/function shareText\(pid\)\{[\s\S]*?Achei no TCG Price Hunter\.`\}/)[0];
const ctx = { P: { a: { copagConfirmed: true, collectionName: 'Fábulas Nebulosas' }, b: { copagConfirmed: false, collectionName: 'X' } },
  OFF: [{ productId: 'a', total: 9.9, storeName: 'Golpe', discount: 0.95, anomalous: true }, { productId: 'a', total: 199.9, storeName: 'Loja A', discount: 0.234 }, { productId: 'b', total: 50, storeName: 'Loja B', discount: 0.3 }],
  bestOffer: (os) => os.slice().sort((x, y) => x.total - y.total)[0], label: () => 'Treinador Avançado', money: (v) => `R$ ${v.toFixed(2).replace('.', ',')}`, pixTxt: () => '' };
vm.createContext(ctx); vm.runInContext(src, ctx);
assert.equal(ctx.shareText('a'), 'Treinador Avançado Fábulas Nebulosas por R$ 199,90 em Loja A (23% abaixo do preço Copag). Achei no TCG Price Hunter.');
assert.equal(ctx.shareText('b'), 'Treinador Avançado X por R$ 50,00 em Loja B. Achei no TCG Price Hunter.', 'sem Copag confirmado, sem %');
assert.doesNotMatch(ctx.shareText('a'), /Golpe/, 'oferta anômala nunca entra no texto');
console.log('✓ Compartilhar: botão no produto, link do site, WhatsApp com noopener');
