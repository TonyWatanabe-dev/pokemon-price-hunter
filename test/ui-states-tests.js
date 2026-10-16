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

  // ---------------------------------------------------------------- carga inicial load() e botão #retry (estados-ui §4, proposta 1)
  const loadCode = cut('async function load(){', '/* Eventos */');
  const loadCtx = (over = {}) => { const v = el(), calls = { init: [], render: 0, loading: 0, prefetch: 0 };
    const ctx = run(loadCode, { view: 'deals', API_VIEWS: new Set(['deals']), PRIVATE: ['conta'], fetchHome: async () => null, fetchState: async () => null,
      init: (st) => calls.init.push(st), render: () => { calls.render++; }, loading: () => { calls.loading++; }, prefetchOpp: () => { calls.prefetch++; },
      ic: (n) => `<i data-ic="${n}"></i>`, $: (q) => (q === '#view' ? v : null), ...over }); return { ctx, v, calls }; };
  await t(`${file}: load() com fetchHome e fetchState falhando mostra .err-state com #retry`, async () => {
    const { ctx, v, calls } = loadCtx();
    await ctx.load();
    assert.equal(calls.loading, 1, 'esqueleto de carregamento aparece primeiro');
    assert.match(v.innerHTML, /class="empty err-state"/); assert.match(v.innerHTML, /role="alert"/);
    assert.match(v.innerHTML, /<button[^>]*id="retry"/, 'botão de nova tentativa'); assert.match(v.innerHTML, /Tentar de novo/);
    assert.equal(calls.init.length, 0, 'não renderiza dados que não existem');
  });
  await t(`${file}: load() cai no state.json quando a API da home falha`, async () => {
    let home = 0, state = 0; const st = { products: [] };
    const { ctx, v, calls } = loadCtx({ fetchHome: async () => { home++; return null; }, fetchState: async () => { state++; return st; } });
    await ctx.load();
    assert.deepEqual([home, state], [1, 1]); assert.equal(calls.init[0], st); assert.doesNotMatch(v.innerHTML, /err-state/);
  });
  await t(`${file}: load() com sucesso na home renderiza sem buscar o state.json`, async () => {
    let state = 0; const h = { slim: true };
    const { ctx, v, calls } = loadCtx({ fetchHome: async () => h, fetchState: async () => { state++; return null; } });
    await ctx.load();
    assert.equal(state, 0); assert.equal(calls.init[0], h); assert.equal(v.innerHTML, '');
  });
  await t(`${file}: view fora das da API usa só o state.json; página privada sem dados renderiza sem erro`, async () => {
    let home = 0;
    const a = loadCtx({ view: 'produtos', fetchHome: async () => { home++; return { slim: true }; }, fetchState: async () => ({ ok: 1 }) });
    await a.ctx.load(); assert.equal(home, 0); assert.deepEqual(a.calls.init, [{ ok: 1 }]);
    const b = loadCtx({ view: 'conta' }); await b.ctx.load();
    assert.equal(b.calls.render, 1); assert.equal(b.v.innerHTML, '', 'conta não mostra o erro de preços');
  });
  await t(`${file}: segundo clique em #retry durante a nova tentativa não chama load() de novo`, async () => {
    const m = html.match(/const rtb=t\.closest\("#retry"\);.*?return\}/); assert.ok(m, 'trecho do #retry');
    let loads = 0, loadings = 0; const btn = { disabled: false };
    const handler = vm.runInNewContext(`(function(t,loading,load){${m[0]}})`, {});
    const target = { closest: (s) => (s === '#retry' ? btn : null) };
    const click = () => handler(target, () => { loadings++; }, () => { loads++; });
    click(); click();
    assert.equal(loads, 1, 'load() chamado uma vez'); assert.equal(loadings, 1); assert.equal(btn.disabled, true, 'botão desabilitado no primeiro clique');
  });

  // ---------------------------------------------------------------- /oportunidades (só existe no index.html)
  if (html.includes('async function moreOpp(page){')) {
    const oppCode = cut('async function moreOpp(page){', '/* "Mais filtros" fecha');
    const oppCtx = (api) => { const s = el(), box = el(); s.attrs.style = 'height:1px';
      const ctx = run(oppCode, { view: 'oportunidades', OPP: { key: 'k', items: [{}], page: 1, pages: 4 }, oppQuery: (p) => 'o' + p, apiGet: api,
        oppCard: () => '<a>', oppTips: () => [], oppMix: (items, from) => items.slice(from).map(() => '<a>').join(''), watchOppMore: () => {}, revealInit: () => {}, document: { addEventListener() {} }, $: (q) => (q === '#opp-more' ? s : q === '#view .opp .deals' ? box : null) });
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

// #442 — falha do histórico: mensagem curta, sem quebrar a página (só index.html)
{
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const i = html.indexOf('async function loadHist(pid){'), j = html.indexOf('function histSeries', i);
  const k = html.indexOf('function drawHist(pid){'), l = html.indexOf('function chart(', k);
  assert.ok(i > 0 && j > i && k > 0 && l > k, 'trechos do histórico');
  const mk = (api, data) => { const box = el(); const ctx = { HIST: {}, view: 'produto', curPid: 'x', S: {}, histFromApi: api, fetchData: data,
    $: () => box, P: {}, HV: { period: 30, mode: 'best' }, PERIODS: [[7, '7D']], ic: () => '', histSeries: () => null };
    vm.createContext(ctx); vm.runInContext(html.slice(i, j) + html.slice(k, l), ctx); return { ctx, box }; };
  await t('histórico: falha de rede/API mostra "Histórico indisponível agora"', async () => {
    const { ctx, box } = mk(async () => { throw new Error('x'); }, async () => null);
    await ctx.loadHist('x'); assert.match(box.innerHTML, /Histórico indisponível agora/);
    const b = mk(async () => null, async () => null); await b.ctx.loadHist('x'); assert.match(b.box.innerHTML, /Histórico indisponível agora/);
  });
  await t('histórico: sem pontos continua com a mensagem antiga', async () => {
    const { ctx, box } = mk(async () => ({ stores: {} }), async () => null);
    await ctx.loadHist('x'); assert.match(box.innerHTML, /Ainda não há histórico/); assert.doesNotMatch(box.innerHTML, /indisponível/);
  });
}
console.log(`✓ Estados de erro e recuperação da UI (#83): ${n} grupos passaram`);
