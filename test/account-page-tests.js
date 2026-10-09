// Fase 6C.1.1 — Conta: nome do cadastro no perfil e "Remover dos favoritos" no perfil.
// Roda o código real da página (trechos de index.html) num sandbox, com o módulo de conta (Firebase) simulado.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const cut = (a, b) => { const i = html.indexOf(a); const j = html.indexOf(b, i); assert.ok(i > 0 && j > i, `trecho ${a}`); return html.slice(i, j); };
const onUserCode = cut('async function onUser(u){', '/* AuthGate:');
const favCode = cut('async function saveField(', 'const saveAlerts=');
const renderFavsCode = cut('function renderFavs(){', 'function renderAlerts(){');
let n = 0; const t = async (name, fn) => { await fn(); n++; };

// "Firestore" simulado: grava em memória; pode falhar ou demorar.
function makeMod({ doc = null, fail = false, delay = 0 } = {}) {
  const saves = []; let stored = doc ? structuredClone(doc) : null;
  return {
    saves, get stored() { return stored; },
    load: async () => (stored ? structuredClone(stored) : null),
    save: async (patch) => { saves.push(structuredClone(patch)); if (delay) await new Promise((r) => setTimeout(r, delay)); if (fail) throw Object.assign(new Error('x'), { code: 'permission-denied' }); stored = { ...(stored || {}), ...patch }; },
  };
}
function sandbox(mod, extra = {}) {
  const toasts = []; let renders = 0;
  const btns = [];
  const ctx = {
    ACC: { mod, user: null, data: null, ready: false, signupName: '', favBusy: false },
    store: { set() {} }, track() {}, accSync() {}, resumeGate: async () => {}, console: { warn() {} },
    toast: (m) => toasts.push(m), render: () => { renders++; }, syncFavButtons() {}, pulse() {}, authGate() {},
    PRIVATE: ['conta', 'favoritos', 'alertas', 'configuracoes'], view: 'favoritos',
    document: { querySelectorAll: () => btns, querySelector: () => null },
    toasts, get renders() { return renders; }, Date, Promise, structuredClone, ...extra,
  };
  ctx.favs = () => ctx.ACC.data?.favorites || [];
  ctx.isFav = (pid) => ctx.favs().includes(pid);
  vm.createContext(ctx);
  vm.runInContext(onUserCode + favCode, ctx);
  return ctx;
}
const pwUser = (name = '') => ({ uid: 'u1', email: 'a@b.c', name, photo: '', verified: false, provider: 'password' });

// ------------------------------------------------------------------ Etapa A: nome
await t('cadastro: perfil nasce com o nome digitado (Auth ainda sem displayName), numa única gravação', async () => {
  const mod = makeMod(); const c = sandbox(mod);
  c.ACC.signupName = 'Haruto';                     // submitAcc guarda o nome durante emailUp
  await c.onUser(pwUser(''));                      // o Firebase avisa o login antes do updateProfile
  assert.equal(mod.saves.length, 1);
  assert.equal(mod.saves[0].name, 'Haruto');
  assert.deepEqual(Object.keys(mod.saves[0]).sort(), ['alerts', 'createdAt', 'favorites', 'name', 'termsAt']);
});
await t('cadastro sem nome: grava nome vazio, sem erro', async () => {
  const mod = makeMod(); const c = sandbox(mod); await c.onUser(pwUser(''));
  assert.equal(mod.saves.length, 1); assert.equal(mod.saves[0].name, '');
});
await t('Google: usa o nome da conta Google', async () => {
  const mod = makeMod(); const c = sandbox(mod); await c.onUser({ ...pwUser('Pessoa G'), provider: 'google.com' });
  assert.equal(mod.saves[0].name, 'Pessoa G');
});
await t('perfil antigo com name "" é reparado com o nome do Auth, sem mexer nos favoritos', async () => {
  const mod = makeMod({ doc: { name: '', favorites: ['a', 'b'], alerts: [], termsAt: 't', createdAt: 't' } }); const c = sandbox(mod);
  await c.onUser(pwUser('Haruto'));
  assert.deepEqual(mod.saves, [{ name: 'Haruto' }]);
  assert.deepEqual(mod.stored.favorites, ['a', 'b']);
});
await t('nome válido nunca é sobrescrito, e não há gravação desnecessária', async () => {
  const mod = makeMod({ doc: { name: 'Apelido', favorites: [], alerts: [], termsAt: 't', createdAt: 't' } }); const c = sandbox(mod);
  await c.onUser(pwUser('')); await c.onUser(pwUser('Outro'));
  assert.equal(mod.saves.length, 0); assert.equal(mod.stored.name, 'Apelido');
});
await t('submitAcc guarda o nome só durante o cadastro e limpa depois, mesmo com erro', () => {
  const code = cut('async function submitAcc(f){', 'async function submitDel(');
  assert.match(code, /ACC\.signupName=nm;let r;try\{r=await m\.emailUp\(email,d\.pw,nm\)\}finally\{ACC\.signupName=""\}/);
});

// ------------------------------------------------------------------ Etapa B: remover dos favoritos
const favDoc = () => ({ name: 'T', favorites: ['p1', 'p2', 'p3'], alerts: [], termsAt: 't', createdAt: 't' });
async function logged(opts) { const mod = makeMod({ doc: favDoc(), ...opts }); const c = sandbox(mod); await c.onUser(pwUser('T')); mod.saves.length = 0; return { c, mod }; }

await t('remover tira só o produto escolhido e grava só o campo favorites', async () => {
  const { c, mod } = await logged();
  await c.unfav('p2');
  assert.deepEqual(mod.saves, [{ favorites: ['p1', 'p3'] }]);
  assert.deepEqual(c.ACC.data.favorites, ['p1', 'p3']);
  assert.equal(c.toasts.at(-1), 'Saiu dos favoritos');
  assert.ok(c.renders >= 1, 'a lista é redesenhada sem recarregar');
});
await t('falha ao gravar: a lista volta como estava e a pessoa é avisada', async () => {
  const { c } = await logged({ fail: true });
  await c.unfav('p1');
  assert.deepEqual(c.ACC.data.favorites, ['p1', 'p2', 'p3']);
  assert.ok(c.toasts.includes('Não consegui salvar. Tente de novo.'));
  assert.equal(c.ACC.favBusy, false, 'botões liberados de novo');
});
await t('cliques repetidos durante a gravação não geram segunda gravação', async () => {
  const { c, mod } = await logged({ delay: 30 });
  const a = c.unfav('p1'); const b = c.unfav('p1'); const d = c.unfav('p3');
  await Promise.all([a, b, d]);
  assert.equal(mod.saves.length, 1); assert.deepEqual(c.ACC.data.favorites, ['p2', 'p3']);
});
await t('sem login ou produto que não é favorito: nada é gravado', async () => {
  const { c, mod } = await logged();
  await c.unfav('nao-existe'); assert.equal(mod.saves.length, 0);
  c.ACC.user = null; await c.unfav('p1'); assert.equal(mod.saves.length, 0);
});
await t('lista: cada favorito tem o coração "Remover dos favoritos"; vazia leva ao catálogo; sem login não mostra botões', () => {
  const P = { p1: { collectionName: 'Caos Ascendente', id: 'p1' }, p2: { collectionName: 'Escuridão Absoluta', id: 'p2' } };
  const ctx = { ACC: { user: { uid: 'u' }, favBusy: false, data: { favorites: ['p1', 'p2', 'sumiu'] } }, P, out: '',
    $: () => ({ set innerHTML(v) { ctx.out = v; } }), esc: (s) => String(s), ic: (n) => `<i ${n}>`, label: () => 'Blister', prodRow: (id) => `<button data-p="${id}">`, privateGate: () => 'GATE' };
  ctx.favs = () => ctx.ACC.data.favorites; vm.createContext(ctx); vm.runInContext(renderFavsCode, ctx);
  ctx.renderFavs();
  assert.equal((ctx.out.match(/data-unfav=/g) || []).length, 2, 'só produtos que existem no catálogo');
  assert.match(ctx.out, /aria-label="Remover dos favoritos: Caos Ascendente · Blister"/);
  assert.match(ctx.out, /<i heart-f>/); assert.match(ctx.out, /2 produtos/);
  ctx.ACC.favBusy = true; ctx.renderFavs(); assert.equal((ctx.out.match(/ disabled>/g) || []).length, 2, 'bloqueados durante a gravação');
  ctx.ACC.favBusy = false; ctx.ACC.data.favorites = []; ctx.renderFavs();
  assert.match(ctx.out, /data-go="produtos">Ver produtos</); assert.doesNotMatch(ctx.out, /data-unfav/);
  ctx.ACC.user = null; ctx.renderFavs(); assert.equal(ctx.out, 'GATE');
});
await t('o clique no coração é tratado antes do favorito comum e o botão não fica dentro da linha que abre o produto', () => {
  const click = cut('const ufb=t.closest("[data-unfav]")', 'const fvb=t.closest("[data-fav]")');
  assert.match(click, /unfav\(ufb\.dataset\.unfav\)/);
  assert.match(renderFavsCode, /<div class="fav-row">\$\{prodRow\(id\)\}<button class="fav-x"/);
});
await t('script da página compila', () => {
  const scripts = [...html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  for (const sc of scripts) { if (sc.trim().startsWith('{')) continue; assert.doesNotThrow(() => new vm.Script(sc), 'erro de sintaxe no index.html'); }
});
console.log(`✓ Conta (6C.1.1): ${n} grupos de testes passaram`);
