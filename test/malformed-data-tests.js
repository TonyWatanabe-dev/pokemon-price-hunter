// Dados malformados vindos das lojas: markup, emojis, acentos e campos ausentes não podem virar HTML nem quebrar a página.
// Roda o código real da página (trechos de index.html) num sandbox.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const cut = (a, b) => { const i = html.indexOf(a); const j = html.indexOf(b, i); assert.ok(i > 0 && j > i, `trecho ${a}`); return html.slice(i, j); };
const code = cut('const esc=(s)=>', 'const store={get(k,d)') + cut('const STOCK=', 'const SRC=') + cut('function stockChip(o)', 'function photo(p,o,cls');
const raCode = cut('const RA_ST=', 'function raBadge(o,full)') + cut('function raBadge(o,full)', '\n}\n') + '\n}\n';

const ctx = { String, Number, Date, encodeURIComponent, safeUrl: (u) => (/^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : '#'), S: { reputation: { lojas: { x: { status: 'BOM', nota: '<img src=x onerror=1>' } }, consultadoEm: '2026-10-01' } } };
vm.createContext(ctx);
vm.runInContext(code + raCode + ';globalThis.__t={esc,money,stockChip,raBadge};', ctx);
const { esc, money, stockChip, raBadge } = ctx.__t;

const evil = '<script>alert(1)</script> "x" \'y\' 🎴 Pokémon & cia';

// preços ausentes ou inesperados nunca viram "NaN" nem lançam
for (const v of [null, undefined, NaN, Infinity, '12,90', {}]) assert.equal(money(v), '-', String(v));
assert.match(money(12.9), /12,90/);

// estoque: quantidade e rótulo desconhecido são escapados
assert.doesNotMatch(stockChip({ stock: 'IN_STOCK', quantity: '<b>9</b>' }), /<b>9/);
assert.doesNotMatch(stockChip({ stock: '<img src=x>' }), /<img/);
assert.match(stockChip({ stock: 'IN_STOCK', quantity: 3 }), /3 em estoque/);
assert.doesNotThrow(() => stockChip({}));

// Reclame Aqui: nota maliciosa escapada; loja sem nome não quebra
const o = { storeId: 'x', storeName: null };
assert.doesNotThrow(() => raBadge(o, true));
assert.doesNotMatch(raBadge(o, true), /<img src=x/);
assert.doesNotMatch(raBadge(o, false), /<img src=x/);

// esc cobre markup, emojis e acentos
assert.equal(esc(null), '');
assert.doesNotMatch(esc(evil), /<script>|"x"/);
assert.match(esc(evil), /🎴 Pokémon &amp; cia/);

console.log('malformed-data-tests: ok');
