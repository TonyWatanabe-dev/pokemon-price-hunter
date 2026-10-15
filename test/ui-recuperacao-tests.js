// #83 — recuperação depois de falha: (1) histórico de preço que falhou não fica guardado como "indisponível" para a sessão
// toda — "Tentar de novo" (protegido contra clique duplo) ou voltar ao produto busca outra vez; (2) "tentar de novo" das
// oportunidades da home limpa do cache exatamente as listas que a home pede (antes limpava chaves limite=1 que ninguém
// usa, e as listas "abaixo"/"economia" voltavam do cache velho misturadas com o pódio novo).
// Roda trechos reais de index.html num sandbox (sem harness de navegador).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { e.message = `${name}: ${e.message}`; throw e; } };
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const cut = (a, b) => { const i = html.indexOf(a); const j = html.indexOf(b, i); assert.ok(i > 0 && j > i, `trecho ${a}`); return html.slice(i, j); };

// ---------------------------------------------------------------- histórico
const histCode = cut('async function loadHist(pid){', 'function histSeries') + cut('function drawHist(pid){', 'function chart(');
function mkHist(api) {
  const box = { innerHTML: '' };
  const ctx = { HIST: {}, view: 'produto', curPid: 'x', S: {}, histFromApi: api, fetchData: async () => null, $: () => box, P: {},
    HV: { period: 30, mode: 'best' }, PERIODS: [[7, '7D']], ic: () => '', histSeries: () => null };
  vm.createContext(ctx); vm.runInContext(histCode, ctx); return { ctx, box };
}

await t('histórico: falha mostra aviso com "Tentar de novo" e não fica guardada', async () => {
  let calls = 0; let fail = true;
  const { ctx, box } = mkHist(async () => { calls++; if (fail) throw new Error('rede'); return { stores: {} }; });
  await ctx.loadHist('x');
  assert.match(box.innerHTML, /Histórico indisponível agora/);
  assert.match(box.innerHTML, /<button class="linkbtn" type="button" data-histretry>Tentar de novo<\/button>/);
  assert.equal('x' in ctx.HIST, false, 'falha não vira cache');
  fail = false; await ctx.loadHist('x');
  assert.equal(calls, 2, 'nova tentativa busca de novo');
  assert.match(box.innerHTML, /Ainda não há histórico/); assert.doesNotMatch(box.innerHTML, /indisponível/);
  assert.equal('x' in ctx.HIST, true, 'sucesso fica guardado');
  await ctx.loadHist('x'); assert.equal(calls, 2, 'com dado guardado não busca outra vez');
});

await t('histórico: resposta vazia da API e do arquivo também não fica guardada', async () => {
  const { ctx, box } = mkHist(async () => null);
  await ctx.loadHist('x'); assert.match(box.innerHTML, /indisponível/); assert.equal('x' in ctx.HIST, false);
});

await t('histórico: "Tentar de novo" ignora clique repetido e usa o produto aberto', () => {
  const h = cut('const hrb=t.closest("[data-histretry]");', 'const hp=t.closest("[data-hp]");');
  assert.match(h, /if\(hrb\.disabled\)return;hrb\.disabled=true;/, 'trava contra clique duplo');
  assert.match(h, /loadHist\(curPid\)/);
  const showProduct = cut('if(pid in HIST)drawHist(pid);else loadHist(pid);', '\n');
  assert.ok(showProduct, 'abrir o produto sem histórico guardado busca de novo');
});

// ---------------------------------------------------------------- oportunidades da home
const homeCode = cut('const HOMEOPP={', 'function podCardOpp(') + cut('const retryHomeOpp=', '\n');
function mkHome() {
  const asked = []; const APIC = new Map();
  const ctx = { APIC, APITTL: 6e4, Date, Promise, isPause: () => false, setPause: () => {}, paintHomeOpp: () => {},
    apiGet: async (k) => { asked.push(k); return APIC.has(k) ? APIC.get(k).j : { data: [{ k }], meta: {} }; } };
  vm.createContext(ctx); vm.runInContext(homeCode + ';globalThis.HOMEOPP=HOMEOPP;globalThis.HOME_OPP_KEYS=HOME_OPP_KEYS;globalThis.retryHomeOpp=retryHomeOpp;', ctx);
  return { ctx, asked, APIC };
}

await t('home: "tentar de novo" limpa do cache as mesmas listas que a home pede', async () => {
  const { ctx, asked, APIC } = mkHome();
  await ctx.loadHomeOpp();
  assert.equal(asked.length, 3); assert.deepEqual([...asked].sort(), [...ctx.HOME_OPP_KEYS].sort(), 'chaves pedidas = HOME_OPP_KEYS');
  const first = [...asked];
  for (const k of first) APIC.set(k, { at: Date.now(), j: { data: [{ velho: k }], meta: {} } });
  const deleted = []; const del = APIC.delete.bind(APIC); APIC.delete = (k) => { deleted.push(k); return del(k); };
  await ctx.retryHomeOpp();
  assert.deepEqual(deleted.sort(), first.sort(), 'cada lista pedida sai do cache');
  assert.equal(ctx.HOMEOPP.status, 'ok');
  assert.ok(!ctx.HOMEOPP.below.some((x) => x.velho) && !ctx.HOMEOPP.save.some((x) => x.velho), '"abaixo" e "economia" não voltam do cache velho');
});

await t('home: "tentar de novo" repetido reaproveita a mesma busca em andamento', async () => {
  const { ctx, asked } = mkHome();
  const p1 = ctx.retryHomeOpp(); const p2 = ctx.retryHomeOpp();
  await Promise.all([p1, p2]);
  assert.equal(asked.length, 3, 'uma busca por lista, não duas');
});

console.log(`✓ Recuperação do histórico e das oportunidades da home (#83): ${n} grupos passaram`);
