// Selo de frete grátis pela regra pública da loja (24/10/2026): FG no index.html igual a config/frete-gratis.json,
// só lojas com fonte e valor; texto aparece só quando o preço passa do mínimo; frete conhecido não muda.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const cfg = JSON.parse(fs.readFileSync(new URL('../config/frete-gratis.json', import.meta.url), 'utf8')).lojas;
const m = html.match(/const FG=(\{[^;]*\});/); assert.ok(m, 'FG no index.html');
const FG = Function(`return ${m[1]}`)();
assert.deepEqual(Object.keys(FG).sort(), Object.keys(cfg).sort(), 'mesmas lojas no site e na config');
for (const [k, v] of Object.entries(cfg)) {
  assert.equal(FG[k].min, v.min, `${k}: mesmo mínimo`);
  assert.match(v.fonte, /^https:\/\//, `${k}: fonte da loja`); assert.ok(v.min > 0 && v.conferido);
}
const money = (v) => 'R$ ' + v.toFixed(2).replace('.', ',');
const line = html.match(/const fgMin=.*\n const shipNote=.*|const fgMin=[^\n]*\nconst shipNote=[^\n]*/)[0];
const { shipNote } = Function('FG', 'money', `${line}; return { shipNote };`)(FG, money);
assert.equal(shipNote({ storeId: 'rihappycombr', price: 250, shippingKnown: false }), 'Frete grátis acima de R$ 199,99 na loja');
assert.equal(shipNote({ storeId: 'rihappycombr', price: 100, shippingKnown: false }), 'Preço antes do frete', 'abaixo do mínimo: sem selo');
assert.equal(shipNote({ storeId: 'outra', price: 900, shippingKnown: false }), 'Preço antes do frete');
assert.equal(shipNote({ storeId: 'rihappycombr', price: 250, shippingKnown: true, shipping: 12 }), 'Produto R$ 250,00 + frete R$ 12,00', 'frete conhecido manda');
console.log('✓ frete-gratis: selo só acima do mínimo, config e site iguais');
