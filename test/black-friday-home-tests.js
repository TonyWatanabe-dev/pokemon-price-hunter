// Seção Black Friday da Home (06/11/2026): gerada de config/social-black-friday.json por tools/black-friday-site.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { dadosSecao, render, asset, TAG } from '../tools/black-friday-site.mjs';
import { lerCampanha } from '../src/agents/social/blackfriday.js';

let n = 0; const t = (nome, fn) => { try { fn(); n++; } catch (e) { e.message = `[${nome}] ${e.message}`; throw e; } };
const EM = Date.parse('2026-11-06T22:00:00Z');
const camp = (ofertas, extra = {}) => ({ capturedAt: new Date(EM).toISOString(), validadeHoras: 48, ofertas, ...extra });
const o = (x) => ({ loja: 'mercadolivre', titulo: 'Blister Triplo ME05', preco: 29.9, de: 42.99, pix: false, blackFriday: false, obs: null, link: 'https://meli.la/abc', ...x });

t('dados: só link de afiliado do dono por loja; ordem selo, desconto, preço', () => {
  const d = dadosSecao(camp([
    o({ titulo: 'A', preco: 40, de: 50 }), o({ titulo: 'B', blackFriday: true, preco: 90, de: 100 }),
    o({ titulo: 'C', loja: 'shopee', link: 'https://s.shopee.com.br/X1', preco: 10, de: 30 }),
    o({ titulo: 'fora', link: 'https://produto.mercadolivre.com.br/MLB-1' }), o({ titulo: 'fora2', loja: 'amazon', link: 'https://www.amazon.com.br/dp/B000000000?tag=outro-20' }),
    o({ titulo: 'D', loja: 'amazon', link: 'https://link.amazon/B0x', preco: 20, de: 19 }),
  ]));
  assert.deepEqual(d.ofertas.map((x) => x.t), ['B', 'C', 'A', 'D']);
  assert.equal(d.ofertas[3].d, null, '"de" menor que o preço não vira desconto'); assert.equal(d.ofertas[1].x, 67);
  assert.equal(d.ate - d.em, 48 * 3600e3);
  assert.equal(dadosSecao(camp([], { validadeHoras: 500 })).ate - EM, 72 * 3600e3, 'teto de 72 h');
});

t('render: validade, escape, Pix, frete e aviso de afiliado', () => {
  const d = dadosSecao(camp([o({ titulo: '<img src=x onerror=alert(1)>', pix: true, obs: 'Cupom "R$ 5"' }), o({ titulo: 'sem de', de: null })]));
  assert.equal(render(d, EM - 3600e3), '', 'antes da leitura'); assert.equal(render(d, EM + 49 * 3600e3), '', 'vencida some');
  const h = render(d, EM + 3600e3);
  assert.ok(!h.includes('<img src=x') && h.includes('&lt;img src=x'), 'título escapado');
  assert.match(h, /<s>R\$ 42,99<\/s> <b>R\$ 29,90<\/b> <small>no Pix<\/small>/);
  assert.match(h, /Cupom &quot;R\$ 5&quot;/); assert.match(h, /Preço sem frete/); assert.match(h, /lidos em 06\/11 às 19:00/);
  assert.match(h, /rel="sponsored nofollow noopener"/); assert.match(h, /A comissão não muda a ordem nem o ranking/);
  assert.ok(!/R\$ 0,00/.test(h));
});

t('asset publicado bate com o config e o index aponta para ele', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8'); const m = html.match(TAG);
  assert.ok(m, 'tag da seção no index.html');
  const pub = fs.readFileSync(new URL(`../assets/web/bf-v${m[1]}.js`, import.meta.url), 'utf8');
  assert.equal(pub, asset(dadosSecao(lerCampanha())), 'rode node tools/black-friday-site.mjs');
});

t('asset no navegador: entra logo depois do palco, uma vez só, e o botão abre a lista', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8'); const m = html.match(TAG);
  const code = fs.readFileSync(new URL(`../assets/web/bf-v${m[1]}.js`, import.meta.url), 'utf8');
  // DOM mínimo
  const inserts = []; let obs = null; const classes = new Set();
  const btn = { attrs: {}, textContent: '', addEventListener: (_, f) => { btn.click = f; }, setAttribute(k, v) { this.attrs[k] = v; } };
  const secao = { classList: { add: (c) => classes.add(c), toggle: (c) => (classes.has(c) ? (classes.delete(c), false) : (classes.add(c), true)) }, querySelector: () => btn };
  let temSecao = false;
  const view = { querySelector: (s) => (s === ':scope>.stage' ? { insertAdjacentHTML: (pos, h) => { inserts.push([pos, h]); temSecao = true; } } : s === '#black-friday' ? (temSecao ? secao : null) : null) };
  const document = { readyState: 'complete', head: { appendChild() {} }, createElement: () => ({}), getElementById: (id) => (id === 'view' ? view : null) };
  class D2 extends Date { static now() { return EM + 3600e3; } }
  const ctx = { document, MutationObserver: class { constructor(f) { obs = f; } observe() {} }, Date: D2, console };
  vm.runInNewContext(code, ctx);
  assert.equal(inserts.length, 1); assert.equal(inserts[0][0], 'afterend'); assert.match(inserts[0][1], /id="black-friday"/);
  obs(); assert.equal(inserts.length, 1, 'não duplica');
  assert.ok(classes.has('bf-fechado')); btn.click(); assert.equal(btn.attrs['aria-expanded'], 'true'); assert.equal(btn.textContent, 'Mostrar menos');
});

console.log(`✓ black-friday-home: ${n} grupos passaram`);
