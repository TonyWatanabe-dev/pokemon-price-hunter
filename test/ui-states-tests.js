// #83 — estados de erro e recuperação da UI: "carregar mais" que falha avisa e oferece nova tentativa
// (sem dizer que a lista acabou), "Atualizar" e "Tentar de novo" não disparam busca duplicada.
// Roda o código real da página (trechos de index.html e tools/page.template.html) num sandbox, como home-page-tests.js.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { e.message = `${name}: ${e.message}`; throw e; } };
const tick = () => new Promise((r) => setImmediate(r));

const el = () => ({ innerHTML: '', style: {}, attrs: {}, removed: false, html: [],
  removeAttribute(a) { delete this.attrs[a]; this.style = {}; }, remove() { this.removed = true; },
  insertAdjacentHTML(_p, h) { this.html.push(h); } });

for (const file of ['../index.html', '../tools/page.template.html']) {
  const html = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  const cut = (a, b) => { const i = html.indexOf(a); const j = html.indexOf(b, i); assert.ok(i > 0 && j > i, `${file}: trecho ${a}`); return html.slice(i, j); };
  const run = (code, ctx) => { vm.createContext(ctx); vm.runInContext(code, ctx); return ctx; };

  // ---------------------------------------------------------------- Atualizar: um toque por vez, trava sempre liberada
  const refreshCode = cut('let fullP=null;', 'async function load(){');
  await t(`${file}: atualizar repetido não dispara outra busca em paralelo`, async () => {
    let calls = 0, release; const toasts = [];
    const ctx = run(refreshCode, { S: { slim: false, generatedAt: 'a' }, view: 'deals', API_VIEWS: new Set(),
      fetchState: () => { calls++; return new Promise((r) => { release = r; }); }, fetchHome: async () => null,
      document: { querySelectorAll: () => [] }, toast: (m) => toasts.push(m), init: () => {} });
    const p1 = ctx.refresh(); const p2 = ctx.refresh();
    assert.equal(calls, 1, 'segundo toque enquanto busca não chama fetchState de novo');
    release(null); await p1; await p2;
    assert.equal(toasts.length, 1, 'um único aviso');
    assert.match(toasts[0], /Mostrando a última atualização/, 'falha mantém os dados atuais e diz isso');
    ctx.refresh(); assert.equal(calls, 2, 'depois de terminar, atualizar volta a funcionar'); release(null); await tick();
  });
  await t(`${file}: trava do atualizar é liberada mesmo se a busca lançar erro`, async () => {
    let calls = 0; const spun = { classList: { add() {}, remove() { this.off = true; } } };
    const ctx = run(refreshCode, { S: null, view: 'deals', API_VIEWS: new Set(), fetchState: async () => { calls++; throw new Error('rede'); },
      fetchHome: async () => null, document: { querySelectorAll: () => [spun] }, toast: () => {}, init: () => {} });
    await assert.rejects(ctx.refresh()); assert.ok(spun.classList.off, 'ícone para de girar');
    await assert.rejects(ctx.refresh()); assert.equal(calls, 2, 'nova tentativa possível');
  });

  // ---------------------------------------------------------------- /produtos: "carregar mais" que falha
  const moreCode = cut('async function moreProdutos(page){', '/* "Sem preço sugerido"');
  const prodCtx = (api) => { const s = el(), box = el(); s.attrs.style = 'height:1px'; s.style = { height: '1px' };
    const ctx = run(moreCode, { view: 'produtos', prodQuery: (p) => 'k' + p, apiGet: api, mergeSide: () => {}, dealCard: () => '<a>', cardE: (x) => x,
      moreSentinel: (n) => `<div id="prod-more" data-page="${n}"></div>`, watchMore: () => {}, revealInit: () => {},
      $: (q) => (q === '#prod-more' ? s : q === '#view .prods .deals' ? box : null) }); return { ctx, s, box }; };
  for (const [what, resp] of [['rede', null], ['404', { notFound: true }]]) {
    await t(`${file}: falha (${what}) ao carregar mais produtos mostra aviso com nova tentativa`, async () => {
      const { ctx, s, box } = prodCtx(async () => resp);
      await ctx.moreProdutos(3);
      assert.match(s.innerHTML, /data-prodretry="3"/, 'botão tenta a mesma página de novo');
      assert.match(s.innerHTML, /Tentar de novo/);
      assert.match(s.innerHTML, /role="alert"/, 'falha anunciada (mesmo padrão da #143)');
      assert.match(s.innerHTML, /A lista acima continua válida/, 'não diz que a lista acabou nem apaga o que já apareceu');
      assert.doesNotMatch(s.innerHTML, /esgotad|indispon|sem estoque/i, 'não afirma estoque');
      assert.equal(box.html.length, 0, 'nenhum cartão inventado');
      assert.ok(!s.removed && !s.attrs.style, 'aviso visível (sentinela sem altura de 1px)');
    });
  }
  await t(`${file}: carregar mais com sucesso continua igual`, async () => {
    const { ctx, s, box } = prodCtx(async () => ({ items: [{}, {}], pages: 5 }));
    await ctx.moreProdutos(3);
    assert.equal(box.html.length, 2, 'cartões + nova sentinela'); assert.ok(s.removed); assert.match(box.html[1], /data-page="4"/);
  });
  await t(`${file}: resposta atrasada de outro filtro é ignorada (sem aviso falso)`, async () => {
    const { ctx, s } = prodCtx(async () => { ctx.view = 'deals'; return null; });
    await ctx.moreProdutos(2); assert.equal(s.innerHTML, '');
  });

  // ---------------------------------------------------------------- cliques de recuperação protegidos contra clique duplo
  await t(`${file}: "Tentar de novo" ignora clique repetido`, () => {
    assert.match(html, /const rtb=t\.closest\("#retry"\);if\(rtb\)\{if\(rtb\.disabled\)return;rtb\.disabled=true;loading\(\);load\(\);return\}/);
    assert.match(html, /const prb=t\.closest\("\[data-prodretry\]"\);if\(prb\)\{if\(prb\.disabled\)return;prb\.disabled=true;/);
  });

  // ---------------------------------------------------------------- /oportunidades (só existe no index.html)
  if (html.includes('async function moreOpp(page){')) {
    const oppCode = cut('async function moreOpp(page){', '/* "Mais filtros" fecha');
    const oppCtx = (api) => { const s = el(), box = el(); s.attrs.style = 'height:1px';
      const ctx = run(oppCode, { view: 'oportunidades', OPP: { key: 'k', items: [{}], page: 1, pages: 4 }, oppQuery: (p) => 'o' + p, apiGet: api,
        oppCard: () => '<a>', watchOppMore: () => {}, revealInit: () => {}, document: { addEventListener() {} }, $: (q) => (q === '#opp-more' ? s : q === '#view .opp .deals' ? box : null) });
      return { ctx, s, box }; };
    await t(`${file}: falha ao carregar mais oportunidades mostra aviso com nova tentativa`, async () => {
      const { ctx, s, box } = oppCtx(async () => null);
      await ctx.moreOpp(2);
      assert.match(s.innerHTML, /data-oppmoreretry="2"/); assert.match(s.innerHTML, /role="alert"/);
      assert.match(s.innerHTML, /A lista acima continua válida/); assert.equal(box.html.length, 0); assert.equal(ctx.OPP.page, 1, 'página não avança');
    });
    await t(`${file}: oportunidades com sucesso continuam iguais; troca de filtro ignora resposta antiga`, async () => {
      const ok = oppCtx(async () => ({ data: [{}, {}] })); await ok.ctx.moreOpp(2);
      assert.equal(ok.ctx.OPP.items.length, 3); assert.equal(ok.ctx.OPP.page, 2); assert.ok(ok.s.removed);
      const late = oppCtx(async () => { late.ctx.OPP.key = 'outro'; return null; }); await late.ctx.moreOpp(2); assert.equal(late.s.innerHTML, '');
    });
    await t(`${file}: nova tentativa de oportunidades protegida contra clique duplo`, () => {
      assert.match(html, /const omb=t\.closest\("\[data-oppmoreretry\]"\);if\(omb\)\{if\(omb\.disabled\)return;omb\.disabled=true;/);
    });
  }
}
console.log(`✓ Estados de erro e recuperação da UI (#83): ${n} grupos passaram`);
