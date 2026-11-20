// Pódio da home (20/11/2026): "Ver oferta" abre direto a oferta (link de afiliado), sem cair na página do produto.
// O link do cartão (.pod .deal-hit) fica abaixo do corpo; o corpo deixa o clique passar e só links/botões o recebem.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const z = (re) => { const m = html.match(re); assert.ok(m, String(re)); return Number(m[1]); };
const hit = z(/\.pod \.deal-hit\{z-index:(\d+)/);
const body = z(/\.pod-body\{z-index:(\d+);pointer-events:none\}/);
assert.ok(body > hit, `corpo (${body}) acima do link do cartão (${hit})`);
assert.match(html, /\.pod-body a,\.pod-body button\{pointer-events:auto\}/, 'links e botões do corpo recebem o clique');
assert.match(html, /<a class="pod-cta" href="\$\{esc\(safeUrl\(outUrl\(of\.url\)\)\)\}" target="_blank"/, '"Ver oferta" do pódio vai para a oferta');
console.log('✓ Pódio: "Ver oferta" clicável e direto na oferta: 3 checagens passaram');
