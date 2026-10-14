// #662 (#83) — bloco "Sem preço sugerido" de /produtos: carregando, vazio, erro e recuperação.
// Antes, uma falha deixava o bloco aberto e vazio, sem aviso; reabrir recomeçava da página 1 e repetia cartões.
// Roda o código real de index.html num sandbox, como ui-states-tests.js.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { e.message = `${name}: ${e.message}`; throw e; } };
const tick = () => new Promise((r) => setImmediate(r));

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const cut = (a, b) => { const i = html.indexOf(a); const j = html.indexOf(b, i); assert.ok(i > 0 && j > i, `trecho ${a}`); return html.slice(i, j); };
const code = cut('async function loadSemref(el){', 'const moreSentinel=');

// <details data-semref> mínimo: a grade .deals guarda os filhos; o aviso fica logo depois dela
const mk = (api) => {
  const box = { kids: [], attrs: {}, after: [],
    get children() { return this.kids; },
    set innerHTML(h) { this.kids = h.match(/<div class="skel semref-skel"[^>]*><\/div>/g) || []; },
    setAttribute(a, v) { this.attrs[a] = v; }, removeAttribute(a) { delete this.attrs[a]; },
    querySelectorAll(q) { return q === '.semref-skel' ? this.kids.filter((x) => x.includes('semref-skel')).map(() => ({ remove: () => { this.kids = this.kids.filter((y) => !y.includes('semref-skel')); } })) : []; },
    insertAdjacentHTML(pos, h) { if (pos === 'beforeend') this.kids.push(...(h.match(/<a>.*?<\/a>/g) || [])); else this.after.push(h); } };
  const details = { dataset: {}, open: true, matches: (q) => q === 'details[data-semref]',
    querySelector: (q) => (q === '.deals' ? box : q === '.semref-msg' ? (box.after.length ? { remove: () => { box.after.length = 0; } } : null) : null) };
  const calls = [], handlers = {};
  const ctx = { apiGet: (k) => { calls.push(k); return api(k); }, prodQuery: (p, semref) => `p${p}${semref ? 's' : ''}`, mergeSide: () => {},
    dealCard: (e) => `<a>${e.id}</a>`, cardE: (x) => x, revealInit: () => {}, document: { addEventListener: (ty, fn) => { handlers[ty] = fn; } } };
  vm.createContext(ctx); vm.runInContext(code, ctx);
  const open = () => handlers.toggle({ target: details });
  return { ctx, box, details, calls, open, cards: () => box.kids.filter((x) => x.startsWith('<a>')), msg: () => box.after.join('') };
};
const page = (ids, pages = 1) => ({ items: ids.map((id) => ({ id })), pages });

await t('carregando: esqueleto e aria-busy até a resposta chegar', async () => {
  let release; const s = mk(() => new Promise((r) => { release = r; }));
  s.open(); await tick();
  assert.equal(s.box.attrs['aria-busy'], 'true'); assert.equal(s.box.kids.length, 3, 'três esqueletos'); assert.equal(s.cards().length, 0);
  release(page(['a', 'b'])); await tick(); await tick();
  assert.deepEqual(s.cards(), ['<a>a</a>', '<a>b</a>']); assert.equal(s.box.kids.length, 2, 'esqueletos saem');
  assert.equal(s.box.attrs['aria-busy'], undefined); assert.equal(s.msg(), '');
});

await t('sucesso em várias páginas; reabrir não busca de novo nem repete cartões', async () => {
  const s = mk(async (k) => (k === 'p1s' ? page(['a'], 2) : page(['b'], 2)));
  s.open(); await tick(); await tick(); await tick();
  assert.deepEqual(s.calls, ['p1s', 'p2s']); assert.deepEqual(s.cards(), ['<a>a</a>', '<a>b</a>']);
  s.open(); await tick();
  assert.deepEqual(s.calls, ['p1s', 'p2s'], 'nenhuma busca nova'); assert.equal(s.cards().length, 2);
});

await t('abrir duas vezes enquanto carrega faz uma busca só', async () => {
  let release; const s = mk(() => new Promise((r) => { release = r; }));
  s.open(); s.open(); s.ctx.loadSemref(s.details);
  assert.equal(s.calls.length, 1); release(page(['a'])); await tick(); await tick();
  assert.equal(s.cards().length, 1);
});

for (const [what, resp] of [['rede', null], ['404', { notFound: true }], ['resposta sem itens', { pages: 1 }]]) {
  await t(`falha (${what}) na primeira página: aviso com nova tentativa, nada inventado`, async () => {
    const s = mk(async () => resp);
    await s.ctx.loadSemref(s.details);
    assert.match(s.msg(), /role="alert"/); assert.match(s.msg(), /Não conseguimos carregar estes produtos agora/);
    assert.match(s.msg(), /<button[^>]*data-semretry[^>]*>Tentar de novo<\/button>/);
    assert.doesNotMatch(s.msg(), /esgotad|indispon|sem estoque|R\$/i, 'não afirma preço nem estoque');
    assert.equal(s.box.kids.length, 0, 'sem cartão nem esqueleto'); assert.equal(s.box.attrs['aria-busy'], undefined);
    assert.equal(s.details.dataset.loaded, '', 'pode tentar de novo');
  });
}

await t('falha no meio: mantém os cartões, avisa e a nova tentativa continua da página que falhou', async () => {
  let fail = true;
  const s = mk(async (k) => (k === 'p1s' ? page(['a'], 3) : k === 'p2s' && fail ? null : page([k === 'p2s' ? 'b' : 'c'], 3)));
  await s.ctx.loadSemref(s.details);
  assert.deepEqual(s.cards(), ['<a>a</a>'], 'cartão da página 1 continua');
  assert.match(s.msg(), /o restante destes produtos/); assert.match(s.msg(), /A lista acima continua válida/);
  fail = false; await s.ctx.loadSemref(s.details);
  assert.deepEqual(s.calls, ['p1s', 'p2s', 'p2s', 'p3s'], 'retoma da página 2, sem recarregar a 1');
  assert.deepEqual(s.cards(), ['<a>a</a>', '<a>b</a>', '<a>c</a>'], 'sem cartão repetido');
  assert.equal(s.msg(), '', 'aviso some na recuperação');
});

await t('fechar e reabrir depois da falha também retoma sem repetir', async () => {
  let fail = true;
  const s = mk(async (k) => (k === 'p1s' ? page(['a'], 2) : fail ? null : page(['b'], 2)));
  s.open(); await tick(); await tick(); await tick();
  fail = false; s.open(); await tick(); await tick();
  assert.deepEqual(s.cards(), ['<a>a</a>', '<a>b</a>']);
});

await t('vazio de verdade: mensagem calma, sem alerta', async () => {
  const s = mk(async () => page([]));
  await s.ctx.loadSemref(s.details);
  assert.match(s.msg(), /Nenhum produto sem preço sugerido agora/); assert.doesNotMatch(s.msg(), /role="alert"|Tentar de novo/);
  assert.equal(s.box.kids.length, 0);
});

await t('"Tentar de novo" do bloco ignora clique repetido', () => {
  const m = html.match(/const srb=t\.closest\("\[data-semretry\]"\);.*?return\}/); assert.ok(m, 'trecho do data-semretry');
  let loads = 0; const det = {}; const btn = { disabled: false, closest: (q) => (q === 'details[data-semref]' ? det : null) };
  const handler = vm.runInNewContext(`(function(t,loadSemref){${m[0]}})`, {});
  const target = { closest: (q) => (q === '[data-semretry]' ? btn : null) };
  handler(target, (d) => { assert.equal(d, det); loads++; }); handler(target, () => { loads++; });
  assert.equal(loads, 1); assert.equal(btn.disabled, true);
});

console.log(`✓ Estados do bloco "Sem preço sugerido" (#662/#83): ${n} grupos passaram`);
