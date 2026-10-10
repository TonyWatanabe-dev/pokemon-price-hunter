// Issue #37 — UX de confiança: última leitura da oferta explícita (conhecida, antiga ou desconhecida) no cartão de
// loja e na caixa de melhor preço. Roda o código real de index.html num sandbox; não há browser harness no ambiente.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const line = (start) => { const i = html.indexOf(start); assert.ok(i > 0, `trecho ${start}`); return html.slice(i, html.indexOf('\n', i)); };
const cut = (a, b) => { const i = html.indexOf(a); const j = html.indexOf(b, i); assert.ok(i > 0 && j > i, `trecho ${a}`); return html.slice(i, j); };

const ctx = {
  Date, Number, Math, String,
  esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  money: (v) => (v == null ? '-' : 'R$ ' + Number(v).toFixed(2).replace('.', ',')), ic: (id) => `<i data-ic="${id}"></i>`,
  safeUrl: (u) => u, raBadge: () => '', thirdParty: () => false, stockChip: () => '', pixTag: () => '', pct: (v) => v, scoreChip: () => '',
};
vm.createContext(ctx);
vm.runInContext(line('const ago=') + '\n' + cut('/* Última leitura da oferta', 'const shipNote=') + '\n' + line('const shipNote=') + '\n' + line('const shipOk=') + '\n' + line('const live=') +
  '\n' + cut('function storeOffer(o,p){', 'function renderProduct(pid){') + '\n;globalThis.__t={ago,readKnown,readNote,storeOffer};', ctx);
const { ago, readKnown, readNote, storeOffer } = ctx.__t;
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const offer = (x = {}) => ({ id: 'o1', storeName: 'Loja A', total: 39.9, price: 39.9, shipping: 0, shippingKnown: false, stock: 'IN_STOCK', url: 'https://loja/x', source_timestamp: new Date(Date.now() - 5 * 60e3).toISOString(), ...x });

// ago nunca devolve "NaN": horário inválido vira "-"
assert.equal(ago('lixo'), '-'); assert.equal(ago(null), '-'); assert.equal(ago(undefined), '-');
assert.match(ago(new Date(Date.now() - 5 * 60e3).toISOString()), /^há 5 min$/);

// leitura conhecida
assert.equal(readKnown(offer()), true);
assert.match(readNote(offer()), /^Atualizado há \d+ min$/);

// leitura desconhecida: texto explícito, nunca "Atualizado -"
for (const bad of [null, undefined, '', 'nao-e-data']) {
  const o = offer({ source_timestamp: bad });
  assert.equal(readKnown(o), false);
  assert.equal(readNote(o), 'Data da leitura desconhecida');
  const card = text(storeOffer(o, {}));
  assert.match(card, /Data da leitura desconhecida/); assert.ok(!/Atualizado -/.test(card) && !/NaN/.test(card));
}

// dado velho: não é apresentado como atual, o cartão avisa que o preço pode ter mudado e o frete segue explícito
const old = text(storeOffer(offer({ stale: true, source_timestamp: new Date(Date.now() - 3 * 864e5).toISOString() }), {}));
assert.match(old, /Atualizado há 3 d/); assert.match(old, /Leitura antiga: preço pode ter mudado/);
assert.match(old, /Preço antes do frete/, 'frete desconhecido continua explícito');
assert.match(text(storeOffer(offer({ shippingKnown: true, shipping: 12.5 }), {})), /Produto R\$ 39,90 \+ frete R\$ 12,50/);

// caixa de melhor preço (detalhe) mostra a leitura, com aviso quando desconhecida
assert.match(html, /data-read="\$\{readKnown\(best\)\?"known":"unknown"\}"/, 'caixa de melhor preço tem a linha de leitura');
assert.match(html, /\$\{readNote\(best\)\}\$\{readKnown\(best\)\?"":"\. Confira o preço na loja\."\}/);

console.log('trust-ux-tests: ok');
