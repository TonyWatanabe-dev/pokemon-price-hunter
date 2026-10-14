// #663 (#82) — fluxo busca → produto → "Ver oferta": alvos de toque, contraste dentro do tema e autocomplete por teclado.
// Não há harness de navegador: os testes leem o CSS/JS reais do index.html e rodam trechos num sandbox (sem cobertura visual).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
let n = 0; const t = (name, fn) => { try { fn(); n++; } catch (e) { e.message = `${name}: ${e.message}`; throw e; } };
const rule = (sel) => {   // última regra cujo seletor é exatamente `sel` (a cascata usa a última)
  const re = new RegExp(`(?:^|[}\\n])\\s*${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\{([^}]*)\\}`, 'g');
  const all = [...css.matchAll(re)].map((m) => m[1]); assert.ok(all.length, `regra ${sel}`); return all.join(';');
};
const px = (decls, prop) => { const m = [...decls.matchAll(new RegExp(`(?:^|;)${prop}:(\\d+(?:\\.\\d+)?)px`, 'g'))].pop(); return m ? +m[1] : 0; };

// ---------------------------------------------------------------- alvos de toque ≥ 44px nos controles da busca e dos resultados
t('alvos de toque da busca e dos filtros têm pelo menos 44px', () => {
  for (const sel of ['.fchip', '.busca-tipos .fchip', '.busca-ord select', '.qchip', '.ac-all', '.xf summary', '.deal-cta', '.busca-more .btn'])
    assert.ok(px(rule(sel), 'min-height') >= 44, `${sel}: min-height < 44px`);
  const x = rule('.sbox-x'); assert.ok(px(x, 'width') >= 44 && px(x, 'height') >= 44, '.sbox-x (limpar busca) < 44×44');
});

// ---------------------------------------------------------------- contraste: texto azul passa AA nos dois temas
const tokens = (block) => Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9A-Fa-f]{6})/g)].map((m) => [m[1], m[2]]));
const light = tokens(css.slice(css.indexOf(':root{'), css.indexOf('}', css.indexOf(':root{'))));
const darkStart = css.indexOf(':root[data-theme="dark"]{'); const dark = tokens(css.slice(darkStart, css.indexOf('}', darkStart)));
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, p) => rgb(a).map((v, i) => v * p + rgb(b)[i] * (1 - p));
const lum = (c) => { const [r, g, b] = c.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
t('texto azul (--water-txt) tem contraste ≥ 4.5:1 no claro e no escuro', () => {
  const m = css.match(/--water-txt:color-mix\(in srgb,var\(--e-water\) (\d+)%,var\(--ink\)\)/); assert.ok(m, 'token --water-txt');
  const p = +m[1] / 100;
  for (const [nome, k] of [['claro', light], ['escuro', dark]]) {
    assert.ok(k['e-water'] && k.ink && k.surface && k.sunk, `tokens do tema ${nome}`);
    const txt = mix(k['e-water'], k.ink, p);
    for (const bg of ['surface', 'sunk', 'ground']) assert.ok(ratio(txt, rgb(k[bg])) >= 4.5, `${nome}: --water-txt sobre --${bg} = ${ratio(txt, rgb(k[bg])).toFixed(2)}`);
    const refBg = mix(k['e-water'], k.surface, 0.14);   // fundo do selo .off.ref
    assert.ok(ratio(txt, refBg) >= 4.5, `${nome}: selo "Ref." = ${ratio(txt, refBg).toFixed(2)}`);
  }
  // sem a correção, o azul puro do tema claro reprovava (4.14:1 no branco): garante que o teste mede algo real
  assert.ok(ratio(rgb(light['e-water']), rgb(light.surface)) < 4.5);
  for (const sel of ['.ac-all', '.refnet', '.off.ref', '.tk-t.info,.ai-tag.info']) assert.match(rule(sel), /(?:^|;)color:var\(--water-txt\)/, `${sel} deve usar --water-txt`);
  // --e-water puro só em ícones (não-texto pede 3:1, e o azul do claro dá 4.14:1); em texto volta a reprovar AA
  const water = [...css.matchAll(/([^{}]+)\{(?:[^}]*;)?color:var\(--e-water\)/g)].map((m) => m[1].trim());
  assert.ok(water.length >= 2, 'ícones azuis esperados (o filtro precisa enxergar as regras)');
  for (const sel of water) assert.match(sel, /\.icon(?:\.[\w-]+)?$/, `texto com --e-water puro: ${sel}`);
});

// ---------------------------------------------------------------- autocomplete: opção destacada pelas setas é anunciada
t('autocomplete expõe a opção ativa com aria-activedescendant/aria-selected', () => {
  const start = html.indexOf('function acRender(input){'); const code = html.slice(start, html.indexOf('\n}', start) + 2);
  const attrs = (el) => ({ ...el, attrs: {}, setAttribute(k, v) { this.attrs[k] = String(v); }, removeAttribute(k) { delete this.attrs[k]; } });
  const input = attrs({ id: 'tq', value: 'char' }); input.attrs['aria-activedescendant'] = 'velho';
  const box = { id: 'tq-ac', hidden: true, items: [], set innerHTML(h) { this.h = h; this.items = (h.match(/class="ac-(i|all)"/g) || []).map(() => attrs({})); }, get innerHTML() { return this.h; }, querySelectorAll() { return this.items; } };
  const ctx = {
    S: {}, document: { getElementById: (id) => (id === 'tq-ac' ? box : null) },
    searchCollections: () => [{ name: 'Chamas', series: 'EV', products: 2 }], searchProducts: () => [{ p: { id: 'p1', collectionName: 'Chamas' } }],
    bestLive: () => null, SLUG: { p1: 'p1' }, esc: String, label: () => 'Booster', money: String, pixTxt: () => '',
  };
  vm.createContext(ctx); vm.runInContext(`let acSel=-1;${code}\nglobalThis.acRender=acRender;`, ctx);
  ctx.acRender(input);
  assert.equal(input.attrs['aria-expanded'], 'true');
  assert.equal(input.attrs['aria-activedescendant'], undefined, 'lista nova não pode apontar para opção antiga');
  assert.equal(box.items.length, 3, 'coleção + produto + "Ver todos"');
  assert.deepEqual(box.items.map((x) => x.id), ['tq-ac-o0', 'tq-ac-o1', 'tq-ac-o2'], 'cada opção tem id');
  for (const x of box.items) assert.equal(x.attrs['aria-selected'], 'false');
  assert.equal((box.h.match(/role="option"/g) || []).length, 3, '"Ver todos" também é opção da listbox');

  const keys = html.slice(html.indexOf('document.addEventListener("keydown"'), html.indexOf('let hT=0;'));
  assert.match(keys, /x\.setAttribute\("aria-selected",String\(k===acSel\)\)/, 'setas atualizam aria-selected');
  assert.match(keys, /i\.setAttribute\("aria-activedescendant",items\[acSel\]\.id\)/, 'setas atualizam aria-activedescendant');
  assert.match(html, /function acClose\(\)\{[^\n]*removeAttribute\("aria-activedescendant"\)/, 'fechar a lista limpa aria-activedescendant');
});

console.log(`✓ UI a11y do fluxo de compra (#663): ${n} grupos passaram`);
