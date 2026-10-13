// loadAfil e footAfil reais de index.html em sandbox (vm): geral:null não renderiza, rótulo com "<" sai escapado,
// anuncios inválidos são ignorados. Sem rede, sem DOM real: fetch e document são falsos. Mesmo padrão de affiliate-links-tests.js.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
let n = 0;
const t = async (name, fn) => { try { await fn(); } catch (e) { e.message = `${name}: ${e.message}`; throw e; } n++; };

const line = (name) => { const m = html.match(new RegExp(`^(?:const|let) ${name}\\s*=.*$`, 'm')); assert.ok(m, `index.html: ${name} não encontrado`); return m[0]; };
const block = (re) => { const m = html.match(re); assert.ok(m, `index.html: ${re} não encontrado`); return m[0]; };
const loadSrc = block(/^async function loadAfil\(\)[\s\S]*?(?=\n\/\*)/m);
const footSrc = block(/^function footAfil\(\)[\s\S]*?(?=\nloadAfil\(\);)/m);

// Roda loadAfil com a resposta dada; devolve o que foi inserido no rodapé e quantas vezes render() foi chamado.
async function run(resposta, { ok = true, comS = true } = {}) {
  const inseridos = [];
  const foot = { querySelector: () => null, insertAdjacentHTML: (_pos, h) => inseridos.push(h) };
  const ctx = {
    String, RegExp, URL, Object, JSON,
    fetch: async () => ({ ok, json: async () => resposta }),
    document: { querySelector: (sel) => (sel === '.foot-links' ? foot : null) },
    renders: 0, render: () => { ctx.renders++; },
    S: comS ? {} : null,
  };
  vm.createContext(ctx);
  vm.runInContext(`${line('esc')}\n${line('safeUrl')}\n${line('AFIL')}\n${line('AFIL_OK')}\n${footSrc}\n${loadSrc}\n;globalThis.__t={loadAfil,get AFIL(){return AFIL}};`, ctx);
  await ctx.__t.loadAfil();
  return { inseridos, AFIL: JSON.parse(JSON.stringify(ctx.__t.AFIL)), renders: ctx.renders };
}

const GERAL = { url: 'https://meli.la/1BzQ4PU', rotulo: 'Ver mais no Mercado Livre' };

await t('geral:null não renderiza link no rodapé', async () => {
  for (const r of [{ geral: null, anuncios: {} }, {}, null, { geral: { url: 'https://evil.com/x' } }, { geral: { url: 'javascript:alert(1)' } }, { geral: { url: 5 } }]) {
    const out = await run(r);
    assert.deepEqual(out.inseridos, [], JSON.stringify(r));
    assert.equal(out.AFIL.geral, null);
  }
  assert.deepEqual((await run({ geral: GERAL }, { ok: false })).inseridos, [], 'resposta !ok: nada muda');
});

await t('geral válido renderiza um link marcado, rotulado e com rel seguro', async () => {
  const out = await run({ geral: GERAL });
  assert.equal(out.inseridos.length, 1);
  assert.match(out.inseridos[0], /^<a href="https:\/\/meli\.la\/1BzQ4PU" target="_blank" rel="noopener nofollow sponsored" data-afil>Ver mais no Mercado Livre<span class="sr">/);
  assert.equal((await run({ geral: { url: GERAL.url } })).AFIL.geral.rotulo, 'Ver mais no Mercado Livre', 'rótulo padrão');
  assert.equal((await run({ geral: { ...GERAL, rotulo: 'x'.repeat(100) } })).AFIL.geral.rotulo.length, 60);
});

await t('rótulo com "<" sai escapado', async () => {
  const out = await run({ geral: { ...GERAL, rotulo: '<img src=x onerror=alert(1)>&"' } });
  assert.equal(out.inseridos.length, 1);
  assert.doesNotMatch(out.inseridos[0], /<img/);
  assert.match(out.inseridos[0], /&lt;img src=x onerror=alert\(1\)&gt;&amp;&quot;/);
});

await t('anuncios inválidos são ignorados; válidos entram e disparam render', async () => {
  const bons = { MLB1234567890: 'https://meli.la/2AbCdEf' };
  const ruins = { MLB1111111111: 'https://evil.example.com/x', MLB2222222222: 'http://meli.la/abc', MLB3333333333: 'javascript:alert(1)',
    MLB4444444444: 'https://meli.la/x"onmouseover=1', XYZ: 'https://meli.la/ok', MLB9: 'https://meli.la/ok', MLB5555555555: 42, MLB6666666666: null };
  const out = await run({ anuncios: { ...bons, ...ruins } });
  assert.deepEqual(out.AFIL.anuncios, bons);
  assert.equal(out.renders, 1);
  const so = await run({ anuncios: ruins });
  assert.deepEqual(so.AFIL.anuncios, {});
  assert.equal(so.renders, 0, 'nada válido: não re-renderiza');
  assert.equal((await run({ anuncios: bons }, { comS: false })).renders, 0, 'sem estado S: não renderiza');
  for (const a of [null, 'texto', 7, []]) assert.deepEqual((await run({ anuncios: a })).AFIL.anuncios, {}, String(a));
});

await t('footAfil não duplica o link (data-afil já presente)', async () => {
  const ctx = { String, RegExp, URL, Object, document: {} };
  const ins = [];
  ctx.document.querySelector = () => ({ querySelector: () => ({}), insertAdjacentHTML: (_p, h) => ins.push(h) });
  vm.createContext(ctx);
  vm.runInContext(`${line('esc')}\n${line('safeUrl')}\n${line('AFIL')}\n${footSrc}\n;AFIL.geral=${JSON.stringify(GERAL)};footAfil();`, ctx);
  assert.deepEqual(ins, []);
});

console.log(`✓ Afiliados no front (loadAfil/footAfil): ${n} grupos passaram`);
