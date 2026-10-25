// Exclusão pendente (ressalva M1/B1/B2/B4 da revisão da #932): se o documento users/<uid> foi apagado e a exclusão do
// login falhou, o site NUNCA recria dados pessoais sozinho, avisa "Exclusão pendente: confirme para concluir" e deixa
// retomar com segurança. "Continuar usando" nunca apaga dados que existem (A1 da revisão: REV-A, REV-G) e conta sem
// documento que não pediu exclusão vê texto neutro (M1). Roda o código REAL da página (trechos de index.html) e do módulo
// de conta (tools/account.src.js: pub, save, confirmIdentity, wipe, mark, delState, excluir, continuar, delPanel)
// contra um Firebase simulado em memória (Auth + Firestore com transação + localStorage compartilhado entre abas com
// evento storage). Sem rede, sem Firebase real.
// Bundle servido (account.js) ≡ fonte: pub/save aqui; wipe/confirmIdentity em test/exclusao-conta-tests.js; as funções
// da exclusão pendente em test/exclusao-modulo-tests.js.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const html = read('../index.html');
const src = read('../tools/account.src.js');
const bundle = read('../account.js');
const cut = (txt, a, b) => { const i = txt.indexOf(a); const j = txt.indexOf(b, i + a.length); assert.ok(i >= 0 && j > i, `trecho ${a}`); return txt.slice(i, j); };
let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };
const err = (code) => Object.assign(new Error(code), { code });

// ---------- código real ----------
const PAGE = [
  cut(html, 'const AERR={', 'const favs='),
  cut(html, 'async function onUser(u){', '/* AuthGate:'),
  cut(html, 'async function submitDel(f){', 'const saveAlerts='),
  cut(html, 'function renderConfig(){', '\nconst BASE_TITLE'),
].join('\n');
const MOD = [
  cut(src, 'const pub = (u) =>', 'const back ='),
  cut(src, 'export async function save(', '// Exclusão da conta').replace(/^export /gm, ''),
  src.slice(src.indexOf('async function confirmIdentity(')).replace(/^export /gm, ''),
].join('\n');
assert.doesNotMatch(MOD, /^\s*(import|export)\b/m);

// ---------- mundo simulado ----------
const OLD = { creationTime: 'Thu, 01 Jan 2026 10:00:00 GMT', lastSignInTime: 'Mon, 20 Oct 2026 10:00:00 GMT' };
function world({ providers = ['password'], meta = OLD, doc = { name: 'Ana', favorites: ['p1'], alerts: [{ p: 'p2', v: 50 }], termsAt: 't', createdAt: 't', telegramPedido: { hash: 'h', criadoEm: 1 } } } = {}) {
  const W = {
    docs: new Map(doc ? [['users/u1', structuredClone(doc)]] : []), ver: new Map(), accounts: new Set(['u1']), ls: new Map(), tabs: [], calls: [], fail: {}, pend: [],
    user: { uid: 'u1', email: 'a@b.c', displayName: 'Ana', photoURL: '', emailVerified: true, providerData: providers.map((providerId) => ({ providerId })), metadata: { ...meta },
      async reload() { W.authReloads = (W.authReloads || 0) + 1; W.take('reload'); if (!W.accounts.has('u1')) throw err('auth/user-not-found'); } },
    take(k) { const c = W.fail[k]?.shift?.(); if (c) throw err(c); },
    emit(from, key, newValue) { for (const tb of W.tabs) if (tb !== from && tb.lsShared) tb.ctx.delStorage({ key, newValue }); },
    async settle() { while (W.pend.length) await W.pend.shift(); await new Promise((r) => setTimeout(r, 0)); },
  };
  // toda gravação muda a versão do documento (pré-condição das transações)
  const set0 = W.docs.set.bind(W.docs), del0 = W.docs.delete.bind(W.docs); const bump = (k) => W.ver.set(k, (W.ver.get(k) || 0) + 1);
  W.docs.set = (k, v) => { bump(k); return set0(k, v); }; W.docs.delete = (k) => { bump(k); return del0(k); };
  return W;
}
// Uma aba (ou outro aparelho, com lsShared=false: localStorage próprio, sem evento entre eles).
function tab(W, { lsShared = true } = {}) {
  const sess = new Map([['ph:tg:u1', 'segredo']]); const ownLs = new Map(); const tb = { lsShared, sess, toasts: [], gone: [], renders: 0, reloads: 0 };
  const lsMap = lsShared ? W.ls : ownLs;
  const auth = { currentUser: W.user };
  const fs_ = {
    ref: (uid) => `users/${uid}`,
    setDoc: async (r, data, o) => { W.calls.push('setDoc'); W.take('setDoc'); assert.equal(JSON.stringify(o), '{"merge":true}'); W.docs.set(r, { ...(W.docs.get(r) || {}), ...structuredClone(data) }); },
    updateDoc: async (r, data) => { W.calls.push('updateDoc'); W.take('updateDoc'); if (!W.docs.has(r)) throw err('not-found'); W.docs.set(r, { ...W.docs.get(r), ...structuredClone(data) }); },
    deleteDoc: async (r) => { W.calls.push('deleteDoc'); W.take('deleteDoc'); W.docs.delete(r); },
    deleteUser: async (u) => {
      W.calls.push('deleteUser'); W.take('deleteUser'); W.accounts.delete(u.uid);
      for (const o of W.tabs) { o.auth.currentUser = null; W.pend.push(o.ctx.onUser(null)); }   // o Auth avisa todas as abas
    },
    reauthenticateWithPopup: async () => { W.calls.push('reauthPopup'); W.take('reauth'); },
    reauthenticateWithCredential: async (_u, c) => { W.calls.push(`reauthCred:${c.pw}`); W.take('reauth'); if (c.pw === 'errada') throw err('auth/invalid-credential'); },
    GoogleAuthProvider: class {}, EmailAuthProvider: { credential: (_e, pw) => ({ pw }) },
    signOut: async () => { W.calls.push('signOut'); for (const o of W.tabs) { o.auth.currentUser = null; W.pend.push(o.ctx.onUser(null)); } },
    db: 'DB',
    // Transação do Firestore: leitura registra a versão; a gravação leva a pré-condição (não existe / mesma versão) e, se
    // outra gravação aconteceu no meio, o "servidor" recusa e a função roda de novo (como o SDK faz).
    runTransaction: async (db, fn) => {
      assert.equal(db, 'DB');
      for (let i = 0; i < 5; i++) {
        const lidos = new Map(); const sets = [];
        const t = {
          get: async (r) => { W.calls.push('tx.get'); W.take('txGet'); const d = W.docs.get(r); lidos.set(r, W.ver.get(r) || 0); return { exists: () => !!d, data: () => structuredClone(d) }; },
          set: (r, data) => { sets.push([r, structuredClone(data)]); },
        };
        const out = await fn(t);
        if (W.beforeCommit) { const h = W.beforeCommit; W.beforeCommit = null; await h(); }
        if (sets.some(([r]) => (W.ver.get(r) || 0) !== lidos.get(r))) { W.calls.push('tx.retry'); continue; }
        for (const [r, data] of sets) { W.calls.push('tx.set'); W.docs.set(r, data); }
        return out;
      }
      throw err('aborted');
    },
  };
  const mctx = { auth, Date, Object, Error, String, ...fs_, localStorage: null, sessionStorage: null }; vm.createContext(mctx);
  vm.runInContext(MOD + '\n;this.pub=pub;this.provs=provs;', mctx);
  const mod = {
    pub: mctx.pub, save: mctx.save, wipe: (...a) => mctx.wipe(...a), excluir: mctx.excluir, continuar: mctx.continuar, delState: mctx.delState, mark: mctx.mark,
    delForm: mctx.delForm, delPanel: mctx.delPanel, provs: mctx.provs,
    load: async () => { W.take('load'); const d = W.docs.get('users/u1'); return d ? structuredClone(d) : null; },
    reload: async () => { if (!auth.currentUser) return null; if (!W.accounts.has('u1')) throw err('auth/user-not-found'); return mctx.pub(auth.currentUser); },
  };
  const ctx = {
    ACC: { mod, user: null, data: null, ready: false, signupName: '', favBusy: false },
    store: { set() {} }, track() {}, accSync() {}, resumeGate: async () => {}, console: { warn() {} },
    toast: (m) => tb.toasts.push(m), render: () => { tb.renders++; }, go: (v) => tb.gone.push(v), setBusy() {}, syncFavButtons() {}, authGate() {},
    PRIVATE: [], view: 'configuracoes', esc: (s) => String(s).replace(/</g, '&lt;'), ic: () => '', privateGate: () => 'GATE', bestLive: () => null, alertOf: () => null,
    document: { querySelectorAll: () => [], querySelector: () => null, documentElement: { dataset: {} } },
    FormData: function (f) { return { get: (k) => (k === 'pw' ? f.pw : null) }; },
    localStorage: { getItem: (k) => (lsMap.has(k) ? lsMap.get(k) : null), setItem: (k, v) => { lsMap.set(k, String(v)); if (lsShared) W.emit(tb, k, String(v)); }, removeItem: (k) => { lsMap.delete(k); if (lsShared) W.emit(tb, k, null); } },
    sessionStorage: { getItem: (k) => sess.get(k) ?? null, setItem: (k, v) => sess.set(k, String(v)), removeItem: (k) => sess.delete(k) },
    location: { reload: () => { tb.reloads++; } },   // recarregar = nova aba com o mesmo localStorage (o teste recria com tab())
    Date, Promise, structuredClone, Object, String, Number, JSON, Error,
  };
  ctx.favs = () => ctx.ACC.data?.favorites || []; ctx.alertsL = () => ctx.ACC.data?.alerts || []; ctx.isFav = (pid) => ctx.favs().includes(pid);
  ctx.$ = () => ({ set innerHTML(v) { tb.view = v; }, focus() {} });
  mctx.localStorage = ctx.localStorage; mctx.sessionStorage = ctx.sessionStorage;
  vm.createContext(ctx); vm.runInContext(PAGE, ctx);
  Object.assign(tb, { ctx, mod, mctx, auth, ls: lsMap, login: () => ctx.onUser(auth.currentUser ? mod.pub(auth.currentUser) : null) });
  W.tabs.push(tb); return tb;
}
const btn = () => ({ innerHTML: '', textContent: '', disabled: false, setAttribute() {}, removeAttribute() {} });
const form = (pw) => ({ pw, querySelector: () => btn() });
const del = (tb, pw) => tb.ctx.submitDel(form(pw));
const ultima = (tb) => tb.toasts.at(-1) || '';
const painel = (tb) => tb.mod.delPanel(tb.ctx.ACC.del, tb.ctx.ACC.user, '');

// ---------- cenários ----------
await t('falha parcial: documento apagado e login mantido → pendente, memória zerada, sem "conta excluída"', async () => {
  const W = world(); const A = tab(W); await A.login();
  assert.deepEqual(A.ctx.favs(), ['p1']);
  W.fail.deleteUser = ['auth/network-request-failed'];
  await del(A, 'pw'); await W.settle();
  assert.deepEqual(W.calls, ['reauthCred:pw', 'deleteDoc', 'deleteUser']);
  assert.equal(W.docs.has('users/u1'), false); assert.equal(W.accounts.has('u1'), true);
  assert.equal(A.ctx.ACC.data, null); assert.deepEqual(A.ctx.favs(), []); assert.deepEqual(A.ctx.alertsL(), []);
  assert.equal(A.ctx.ACC.del.why, 'pendente'); assert.equal(A.ctx.ACC.del.apagados, true);
  assert.equal(W.ls.get('ph:del:u1'), 'pendente');
  assert.equal(A.sess.has('ph:tg:u1'), false, 'segredo do vínculo com o Telegram limpo (B4)');
  assert.ok(!A.toasts.includes('Conta e dados excluídos')); assert.deepEqual(A.gone, []);
  assert.match(ultima(A), /Seus dados foram apagados, mas a conta ainda não\. Confirme para concluir/);
  A.view = painel(A);
  assert.match(A.view, /Exclusão pendente: confirme para concluir/); assert.match(A.view, /Concluir a exclusão/);
  assert.match(A.view, /Sem conexão com a internet/); assert.match(A.view, /data-a="del-continuar"/);
});

await t('sem recarregar: favoritar, alerta ou Telegram não recriam o documento', async () => {
  const W = world(); const A = tab(W); await A.login();
  W.fail.deleteUser = ['auth/network-request-failed']; await del(A, 'pw'); W.calls.length = 0;
  await A.ctx.setFav('p9', true);
  await assert.rejects(() => A.ctx.saveField('telegramPedido', { hash: 'x', criadoEm: 2 }, null), { code: 'conta/exclusao-pendente' });
  assert.deepEqual(W.calls, []); assert.equal(W.docs.has('users/u1'), false);
  assert.match(ultima(A), /Exclusão da conta pendente/);
});

await t('recarga no mesmo navegador: onUser não recria o documento (nome, termsAt) e mostra pendente', async () => {
  const W = world(); const A = tab(W); await A.login();
  W.fail.deleteUser = ['auth/network-request-failed']; await del(A, 'pw'); W.calls.length = 0;
  W.tabs.length = 0; const R = tab(W); await R.login();
  assert.deepEqual(W.calls, [], 'nenhuma gravação ao carregar'); assert.equal(W.docs.has('users/u1'), false);
  assert.equal(R.ctx.ACC.del.why, 'pendente'); assert.equal(R.ctx.ACC.data, null);
});

await t('outro aparelho (sem a marca local), conta antiga sem documento: não recria; mostra "Conta sem dados salvos"', async () => {
  const W = world({ doc: null }); const B = tab(W, { lsShared: false }); await B.login();
  assert.deepEqual(W.calls, []); assert.equal(W.docs.has('users/u1'), false);
  assert.equal(B.ctx.ACC.del.why, 'ausente'); B.view = painel(B);
  assert.match(B.view, /Sua conta não tem dados salvos/); assert.match(B.view, /Criar perfil\?/); assert.match(B.view, />Criar perfil<\/button>/);
  assert.match(B.view, /Excluir a conta/); assert.doesNotMatch(B.view, /xclus[ãa]o (pendente|não)/i, 'sem pedido de exclusão: texto neutro (M1)');
  await B.ctx.setFav('p1', true); assert.equal(W.docs.has('users/u1'), false);
  assert.equal(ultima(B), 'Sua conta não tem dados salvos. Veja em Minha conta.', 'favoritar: texto neutro, não "exclusão pendente" (M1/REV-B)');
});

await t('conta nova (cadastro agora) sem documento: perfil continua sendo criado sozinho (sem regressão)', async () => {
  const now = new Date().toUTCString();
  const W = world({ doc: null, meta: { creationTime: now, lastSignInTime: now } }); const A = tab(W); await A.login();
  assert.deepEqual(W.calls, ['setDoc']); assert.equal(A.ctx.ACC.del, null);
  assert.deepEqual(Object.keys(W.docs.get('users/u1')).sort(), ['alerts', 'createdAt', 'favorites', 'name', 'termsAt', 'updatedAt']);
  await A.ctx.setFav('p9', true); assert.deepEqual(W.docs.get('users/u1').favorites, ['p9']); assert.equal(W.calls.at(-1), 'updateDoc');
});

await t('retomar: conclui, é idempotente (documento já ausente) e só então diz "conta excluída"', async () => {
  const W = world(); const A = tab(W); await A.login();
  W.fail.deleteUser = ['auth/network-request-failed']; await del(A, 'pw');
  W.tabs.length = 0; const R = tab(W); await R.login(); W.calls.length = 0;
  await del(R, 'errada'); await W.settle();
  assert.deepEqual(W.calls, ['reauthCred:errada']); assert.equal(W.ls.get('ph:del:u1'), 'pendente', 'senha errada não tira a marca');
  assert.equal(R.ctx.ACC.del.why, 'pendente'); assert.match(R.ctx.ACC.del.err, /incorretos/);
  await del(R, 'pw'); await W.settle();
  assert.deepEqual(W.calls.slice(1), ['reauthCred:pw', 'deleteDoc', 'deleteUser']);
  assert.equal(W.accounts.has('u1'), false); assert.equal(W.docs.has('users/u1'), false);
  assert.equal(W.ls.has('ph:del:u1'), false); assert.equal(R.sess.has('ph:tg:u1'), false);
  assert.equal(ultima(R), 'Conta e dados excluídos'); assert.deepEqual(R.gone, ['']);
  assert.equal(R.ctx.ACC.del, null); assert.equal(R.ctx.ACC.data, null);
});

await t('popup fechado: "Nada foi excluído" fora do pendente; "continua pendente" dentro; marca nova é desfeita', async () => {
  const W = world({ providers: ['google.com'] }); const A = tab(W); await A.login();
  W.fail.reauth = ['auth/popup-closed-by-user']; await del(A, '');
  assert.equal(ultima(A), 'Confirmação cancelada. Nada foi excluído.'); assert.equal(W.ls.has('ph:del:u1'), false);
  assert.ok(W.docs.has('users/u1'));
  W.fail.deleteUser = ['auth/network-request-failed']; await del(A, ''); assert.equal(A.ctx.ACC.del.why, 'pendente');
  W.fail.reauth = ['auth/popup-closed-by-user']; await del(A, '');
  assert.equal(A.ctx.ACC.del.err, 'Confirmação cancelada. A exclusão continua pendente.'); assert.equal(W.ls.get('ph:del:u1'), 'pendente');
  W.fail.reauth = ['auth/user-mismatch']; await del(A, '');
  assert.equal(A.ctx.ACC.del.err, 'Escolha no Google a mesma conta conectada aqui.');
});

await t('sem usuário no módulo (saiu em outra aba): não diz "conta excluída"', async () => {
  const W = world(); const A = tab(W); await A.login();
  A.auth.currentUser = null; await del(A, 'pw');
  assert.ok(!A.toasts.includes('Conta e dados excluídos')); assert.equal(ultima(A), 'Por segurança, entre de novo para excluir a conta.');
  assert.equal(W.ls.has('ph:del:u1'), false); assert.ok(W.docs.has('users/u1'));
});

await t('duas abas: a outra para de gravar já no início, vê o pendente e sai quando a exclusão termina', async () => {
  const W = world(); const A = tab(W); const B = tab(W); await A.login(); await B.login();
  assert.deepEqual(B.ctx.favs(), ['p1']);
  let soltar; const trava = new Promise((r) => { soltar = r; });
  const real = A.mctx.wipe; A.mctx.wipe = async (...a) => { await trava; return real(...a); };
  W.fail.deleteUser = ['auth/network-request-failed'];
  const p = del(A, 'pw');
  assert.equal(B.ctx.ACC.del?.why, 'pendente', 'B soube pela marca "andamento"'); assert.equal(B.ctx.ACC.data, null);
  assert.equal(B.sess.has('ph:tg:u1'), false);
  await B.ctx.setFav('p7', true); assert.deepEqual(W.calls, [], 'B não grava durante a exclusão (corrida B1 no mesmo navegador)');
  soltar(); await p; await W.settle();
  assert.equal(B.ctx.ACC.del.apagados, true); assert.equal(W.docs.has('users/u1'), false);
  A.mctx.wipe = real; await del(A, 'pw'); await W.settle();
  assert.equal(W.accounts.has('u1'), false); assert.equal(B.ctx.ACC.user, null); assert.equal(B.ctx.ACC.del, null); assert.equal(B.ctx.ACC.data, null);
});

await t('duas abas: a exclusão falha antes de apagar (senha errada) → a outra aba volta ao normal com os dados', async () => {
  const W = world(); const A = tab(W); const B = tab(W); await A.login(); await B.login();
  await del(A, 'errada'); await W.settle();
  assert.equal(W.ls.has('ph:del:u1'), false); assert.equal(A.ctx.ACC.del, null); assert.deepEqual(A.ctx.favs(), ['p1']);
  assert.equal(B.reloads, 1, 'B recarrega ao ver a marca sumir'); assert.ok(W.docs.has('users/u1'));
  const B2 = tab(W); await B2.login(); assert.equal(B2.ctx.ACC.del, null); assert.deepEqual(B2.ctx.favs(), ['p1']);
});

await t('outro aparelho com dados antigos em memória: gravar depois da exclusão parcial NÃO recria o documento', async () => {
  const W = world(); const A = tab(W); const B = tab(W, { lsShared: false }); await A.login(); await B.login();
  W.fail.deleteUser = ['auth/network-request-failed']; await del(A, 'pw'); W.calls.length = 0;
  assert.deepEqual(B.ctx.favs(), ['p1'], 'B ainda não sabe');
  await B.ctx.setFav('p9', true);
  assert.deepEqual(W.calls, ['updateDoc']); assert.equal(W.docs.has('users/u1'), false, 'updateDoc falha com not-found');
  assert.equal(B.ctx.ACC.del.why, 'ausente'); assert.equal(B.ctx.ACC.data, null); assert.equal(ultima(B), 'Sua conta não tem dados salvos. Veja em Minha conta.');
});

await t('dois provedores (senha primeiro): senha em branco confirma pelo Google; com senha usa a senha', async () => {
  const W = world({ providers: ['password', 'google.com'] }); const A = tab(W); await A.login();
  A.ctx.renderConfig();
  assert.match(A.view, /Confirme sua senha \(em branco: Google\)/); assert.doesNotMatch(A.view, / required>/);
  W.fail.deleteUser = ['auth/network-request-failed']; await del(A, ''); assert.deepEqual(W.calls.slice(0, 1), ['reauthPopup']);
  W.calls.length = 0; await del(A, 'pw'); await W.settle();
  assert.deepEqual(W.calls, ['reauthCred:pw', 'deleteDoc', 'deleteUser']); assert.equal(W.accounts.has('u1'), false);
  const W2 = world({ providers: ['password'] }); const S = tab(W2); await S.login(); S.ctx.renderConfig();
  assert.match(S.view, /<label for="d-pw">Confirme sua senha<\/label>/); assert.match(S.view, / required>/);
  await del(S, ''); assert.deepEqual(W2.calls, []); assert.equal(ultima(S), 'Por segurança, digite sua senha para excluir.');
});

await t('"Continuar usando": recria perfil vazio só com o clique, tira a marca e volta a gravar', async () => {
  const W = world(); const A = tab(W); const B = tab(W); await A.login(); await B.login();
  W.fail.deleteUser = ['auth/network-request-failed']; await del(A, 'pw'); W.calls.length = 0;
  await A.ctx.delContinuar(btn()); await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(W.calls, ['tx.get', 'tx.set']); const d = W.docs.get('users/u1');
  assert.deepEqual(d.favorites, []); assert.deepEqual(d.alerts, []); assert.ok(d.termsAt && d.createdAt);
  assert.equal(W.ls.has('ph:del:u1'), false); assert.equal(A.ctx.ACC.del, null);
  await A.ctx.setFav('p3', true); assert.deepEqual(W.docs.get('users/u1').favorites, ['p3']);
  assert.equal(B.reloads, 1, 'a outra aba recarrega ao ver a marca sumir');
  const B2 = tab(W); await B2.login(); assert.equal(B2.ctx.ACC.del, null); assert.deepEqual(B2.ctx.ACC.data.favorites, ['p3']);
});

await t('aba fechada no meio (marca "andamento", documento intacto): ao entrar, a marca some e tudo segue normal', async () => {
  const W = world(); W.ls.set('ph:del:u1', 'andamento'); const A = tab(W); await A.login();
  assert.equal(A.ctx.ACC.del, null); assert.equal(W.ls.has('ph:del:u1'), false); assert.deepEqual(A.ctx.favs(), ['p1']);
  const W2 = world({ doc: null }); W2.ls.set('ph:del:u1', 'andamento'); const B = tab(W2); await B.login();
  assert.equal(B.ctx.ACC.del.why, 'pendente'); assert.deepEqual(W2.calls, []);
});

await t('falha ao carregar com marca: pendente, nada gravado', async () => {
  const W = world(); W.ls.set('ph:del:u1', 'pendente'); W.fail.load = ['unavailable']; const A = tab(W); await A.login();
  assert.equal(A.ctx.ACC.del.why, 'pendente'); assert.deepEqual(W.calls, []);
});

await t('página: ouvinte de storage registrado; dados pessoais nunca vão para a marca', () => {
  assert.match(html, /\naddEventListener\("storage",delStorage\);\n/);
  assert.match(html, /\n  if\(ACC\.user&&ACC\.del&&PRIVATE\.includes\(view\)\)return \$\("#view"\)\.innerHTML=ACC\.mod\.delPanel\(ACC\.del,ACC\.user,ic\("trash"\)\);\n  if\(view==="conta"\)return renderConta\(\);/, 'páginas da conta mostram o pendente');
  assert.doesNotMatch(html, /localStorage\.setItem\("ph:del:|ph:del:"\+[^;]*setItem/, 'a marca só é gravada pelo módulo');
  const marks = [...src.matchAll(/\bmark\(([^)]*)\)/g)].map((m) => m[1]).filter((a) => a.includes(',') && a !== 'uid, v');
  assert.ok(marks.length >= 6, 'gravações da marca no módulo');
  for (const a of marks) assert.match(a, /^u\.uid, ('andamento'|'pendente'|null)$/, a);
});

// ---------- A1 da revisão: "Continuar usando" nunca apaga dados que existem ----------
await t('REV-A: marca "pendente" antiga e perfil usado em outro aparelho → "Continuar" só carrega (favoritos e alertas mantidos)', async () => {
  const W = world(); W.ls.set('ph:del:u1', 'pendente'); const A = tab(W); await A.login();
  assert.equal(A.ctx.ACC.del.why, 'pendente'); assert.equal(A.ctx.ACC.del.apagados, false); assert.deepEqual(W.calls, []);
  assert.match(painel(A), /A exclusão não terminou\./); assert.match(painel(A), /retoma o que ainda existir/);
  await A.ctx.delContinuar(btn());
  assert.deepEqual(W.calls, ['tx.get'], 'só leitura: nada gravado');
  assert.deepEqual(W.docs.get('users/u1').favorites, ['p1']); assert.deepEqual(W.docs.get('users/u1').alerts, [{ p: 'p2', v: 50 }]);
  assert.deepEqual(A.ctx.favs(), ['p1']); assert.equal(A.ctx.ACC.del, null); assert.equal(W.ls.has('ph:del:u1'), false);
  assert.equal(ultima(A), 'Pronto: sua conta segue ativa.');
  await A.ctx.setFav('p3', true); assert.deepEqual(W.docs.get('users/u1').favorites, ['p1', 'p3']);
});

await t('REV-G: aba A no popup do Google, aba B clica "Continuar" → nada é apagado; popup cancelado em A mantém tudo', async () => {
  const W = world({ providers: ['google.com'] }); const A = tab(W); const B = tab(W); await A.login(); await B.login();
  let soltar; const trava = new Promise((r) => { soltar = r; });
  A.mctx.reauthenticateWithPopup = async () => { W.calls.push('reauthPopup'); await trava; throw err('auth/popup-closed-by-user'); };
  const p = del(A, '');
  assert.equal(B.ctx.ACC.del?.why, 'pendente', 'B viu a marca "andamento"');
  await B.ctx.delContinuar(btn());
  assert.deepEqual(W.calls, ['reauthPopup', 'tx.get'], 'B só leu');
  assert.deepEqual(B.ctx.favs(), ['p1']); assert.deepEqual(B.ctx.alertsL(), [{ p: 'p2', v: 50 }]); assert.equal(B.ctx.ACC.del, null);
  soltar(); await p; await W.settle();
  assert.equal(ultima(A), 'Confirmação cancelada. Nada foi excluído.');
  assert.deepEqual(W.docs.get('users/u1').favorites, ['p1']); assert.deepEqual(W.docs.get('users/u1').alerts, [{ p: 'p2', v: 50 }]);
  assert.ok(W.docs.get('users/u1').telegramPedido, 'nenhum campo perdido'); assert.equal(W.ls.has('ph:del:u1'), false);
});

await t('REV-G (variante): B continuou, A conclui só o deleteDoc → B volta ao pendente sem gravar', async () => {
  const W = world({ providers: ['google.com'] }); const A = tab(W); const B = tab(W); await A.login(); await B.login();
  let soltar; const trava = new Promise((r) => { soltar = r; }); const real = A.mctx.reauthenticateWithPopup;
  A.mctx.reauthenticateWithPopup = async (...a) => { await trava; return real(...a); };
  W.fail.deleteUser = ['auth/network-request-failed'];
  const p = del(A, ''); await B.ctx.delContinuar(btn()); soltar(); await p; await W.settle();
  assert.equal(W.docs.has('users/u1'), false); assert.equal(B.ctx.ACC.del.why, 'pendente'); assert.equal(B.ctx.ACC.del.apagados, true);
  const antes = W.calls.length; await B.ctx.setFav('p8', true); assert.equal(W.calls.length, antes); assert.equal(W.docs.has('users/u1'), false);
});

await t('corrida: dois aparelhos clicam "Criar perfil" juntos → um cria, o outro relê (transação) e usa o que existe', async () => {
  const W = world({ doc: null }); const B = tab(W, { lsShared: false }); const C = tab(W, { lsShared: false }); await B.login(); await C.login();
  assert.equal(B.ctx.ACC.del.why, 'ausente'); assert.equal(C.ctx.ACC.del.why, 'ausente');
  W.beforeCommit = async () => { await C.ctx.delContinuar(btn()); await C.ctx.setFav('p5', true); };
  await B.ctx.delContinuar(btn());
  assert.deepEqual(W.calls, ['tx.get', 'tx.get', 'tx.set', 'updateDoc', 'tx.retry', 'tx.get']);
  assert.deepEqual(W.docs.get('users/u1').favorites, ['p5'], 'favorito de C não foi sobrescrito');
  assert.deepEqual(B.ctx.favs(), ['p5']); assert.equal(B.ctx.ACC.data.createdAt, C.ctx.ACC.data.createdAt);
});

await t('documento parcial (gravação de aba antiga) + marca: "Continuar" completa o perfil sem perder favoritos', async () => {
  const W = world({ doc: { favorites: ['p1'], updatedAt: 'x' } }); W.ls.set('ph:del:u1', 'pendente'); const A = tab(W); await A.login();
  assert.equal(A.ctx.ACC.del.why, 'pendente'); assert.deepEqual(W.calls, []);
  await A.ctx.delContinuar(btn());
  const d = W.docs.get('users/u1'); assert.deepEqual(d.favorites, ['p1']); assert.deepEqual(d.alerts, []); assert.equal(d.name, 'Ana'); assert.ok(d.createdAt && d.termsAt);
});

// ---------- M1: textos distintos com e sem pedido de exclusão ----------
await t('M1: sem documento COM marca → texto de exclusão pendente (painel e favoritar)', async () => {
  const W = world({ doc: null }); W.ls.set('ph:del:u1', 'pendente'); const A = tab(W); await A.login();
  assert.equal(A.ctx.ACC.del.why, 'pendente'); assert.match(painel(A), /Exclusão pendente: confirme para concluir/);
  assert.match(painel(A), /já foram apagados/); assert.match(painel(A), /Continuar usando a conta/);
  await A.ctx.setFav('p1', true); assert.equal(ultima(A), 'Exclusão da conta pendente. Veja em Minha conta.'); assert.deepEqual(W.calls, []);
  await A.ctx.delContinuar(btn()); assert.deepEqual(W.calls, ['tx.get', 'tx.set']); assert.deepEqual(W.docs.get('users/u1').favorites, []);
});

await t('marca gravada sem o evento storage ter chegado: favoritar não grava (guarda do saveField consulta a marca)', async () => {
  const W = world(); const A = tab(W); await A.login(); W.ls.set('ph:del:u1', 'andamento');   // direto no mapa: sem evento
  assert.equal(A.ctx.ACC.del, null); await A.ctx.setFav('p9', true);
  assert.deepEqual(W.calls, []); assert.equal(ultima(A), 'Exclusão da conta pendente. Veja em Minha conta.'); assert.deepEqual(W.docs.get('users/u1').favorites, ['p1']);
});

// ---------- marca limpa quando a conta já não existe ----------
await t('conta já excluída em outro aparelho: a marca some, a sessão é encerrada e nada é gravado', async () => {
  const W = world({ doc: null }); W.accounts.delete('u1'); W.ls.set('ph:del:u1', 'pendente'); const A = tab(W); await A.login(); await W.settle();
  assert.equal(W.ls.has('ph:del:u1'), false); assert.ok(A.toasts.includes('Essa conta já foi excluída.'));
  assert.deepEqual(W.calls, ['signOut']); assert.equal(A.ctx.ACC.user, null); assert.equal(A.ctx.ACC.data, null);
  const W2 = world({ doc: null }); W2.ls.set('ph:del:u1', 'pendente'); W2.fail.reload = ['auth/network-request-failed']; const B = tab(W2); await B.login();
  assert.equal(B.ctx.ACC.del.why, 'pendente', 'sem resposta do Auth: continua pendente'); assert.equal(W2.ls.get('ph:del:u1'), 'pendente'); assert.deepEqual(W2.calls, []);
});
// T4-A: no SDK real (firebase 12.19.0, conferido no emulador do Auth) o reload de conta excluída falha com
// auth/user-token-expired (USER_NOT_FOUND do servidor é traduzido); e o estado "fim" não pode ficar preso em memória.
await t('conta excluída com o código real do SDK (user-token-expired): fim, marca limpa, nada preso em ACC.del, sem resumeGate', async () => {
  const W = world({ doc: null }); W.ls.set('ph:del:u1', 'pendente'); W.fail.reload = ['auth/user-token-expired']; const A = tab(W);
  let gates = 0; A.ctx.resumeGate = async () => { gates++; };
  await A.login(); await W.settle();
  assert.equal(W.ls.has('ph:del:u1'), false); assert.ok(A.toasts.includes('Essa conta já foi excluída.')); assert.deepEqual(W.calls, ['signOut']);
  assert.equal(A.ctx.ACC.user, null); assert.equal(A.ctx.ACC.del, null, 'estado "fim" não fica preso depois de sair'); assert.equal(A.ctx.ACC.data, null);
  assert.equal(gates, 0, 'não retoma ação pendente com a sessão encerrada');
});

// T5-B: no emulador do Auth (test/exclusao-emulador-tests.mjs, E1/E2/E11) o deleteUser que falha com conta desativada
// ou token revogado ENCERRA a sessão no próprio SDK antes de o erro chegar à página (onUser(null) roda no meio).
await t('falha parcial com sessão encerrada pelo SDK no meio (user-token-expired/user-disabled): nunca "excluída", nada gravado, novo login na mesma página volta ao pendente', async () => {
  for (const code of ['auth/user-token-expired', 'auth/user-disabled']) {
    const W = world(); const A = tab(W); await A.login(); W.calls.length = 0;
    A.mctx.deleteUser = async () => { W.calls.push('deleteUser'); for (const o of W.tabs) { o.auth.currentUser = null; await o.ctx.onUser(null); } throw err(code); };
    await del(A, 'pw'); await W.settle();
    assert.deepEqual(W.calls, ['reauthCred:pw', 'deleteDoc', 'deleteUser'], code);
    assert.equal(W.ls.get('ph:del:u1'), 'pendente'); assert.equal(W.docs.has('users/u1'), false); assert.equal(A.ctx.ACC.user, null);
    assert.ok(!A.toasts.some((m) => /excluída|excluídos/.test(m)), `${code}: nunca diz que a conta foi excluída`);
    assert.match(ultima(A), /Seus dados foram apagados, mas a conta ainda não\. Confirme para concluir/);
    // mensagem do painel hoje: genérica com o código (ver frentes/T5-B.md: proposta de texto "entre de novo")
    assert.ok(A.ctx.ACC.del?.err?.includes(`código: ${code}`), `${code}: ${A.ctx.ACC.del?.err}`);
    A.auth.currentUser = W.user; await A.login(); await W.settle();
    assert.equal(A.ctx.ACC.del?.why, 'pendente', `${code}: novo login sem recarregar mostra o pendente`); assert.equal(A.ctx.ACC.del.apagados, true);
    assert.match(painel(A), /já foram apagados; falta excluir o login/);
    assert.ok(!W.calls.some((c) => /setDoc|updateDoc|tx\.set/.test(c)), `${code}: nada recriado`); assert.equal(W.docs.has('users/u1'), false);
  }
});

await t('mensagens quando a exclusão não termina: nunca vazias, nunca "excluída", sempre com próximo passo; antes de apagar diz "Nada foi excluído" ou pede a senha', async () => {
  const passo = /tente de novo|entre de novo|digite sua senha|libere|espere|confirme|senha incorretos/i;
  for (const [onde, code] of [['reauth', 'auth/network-request-failed'], ['reauth', 'auth/too-many-requests'], ['reauth', 'auth/invalid-credential'], ['deleteUser', 'auth/network-request-failed'], ['deleteUser', 'auth/requires-recent-login'], ['deleteUser', 'auth/internal-error'], ['deleteUser', 'auth/user-token-expired']]) {
    const W = world(); const A = tab(W); await A.login(); W.fail[onde] = [code]; await del(A, 'pw'); await W.settle();
    const msgs = [...A.toasts, A.ctx.ACC.del?.err].filter((m) => m !== undefined);
    assert.ok(msgs.length && msgs.every((m) => m && !/excluída|excluídos/.test(m)), `${onde}/${code}: ${msgs.join(' | ')}`);
    assert.ok(msgs.some((m) => passo.test(m)), `${onde}/${code} sem próximo passo: ${msgs.join(' | ')}`);
    if (onde === 'reauth') { assert.ok(W.docs.has('users/u1'), 'nada apagado'); assert.equal(W.ls.has('ph:del:u1'), false); assert.equal(A.ctx.ACC.del, null); }
    else { assert.equal(A.ctx.ACC.del?.why, 'pendente'); assert.equal(W.ls.get('ph:del:u1'), 'pendente'); }
  }
});

// ---------- fonte ≡ bundle: pub e save ----------
await t('bundle account.js: pub e save idênticos à fonte (mesmas saídas e mesmas chamadas)', async () => {
  const exp = (name) => bundle.match(new RegExp(`export\\{[^}]*?([\\w$]+) as ${name}[,}]`))?.[1];
  const saveName = exp('save'); assert.ok(saveName, 'save não exportada');
  const i = bundle.indexOf(`async function ${saveName}(`); let d = 0, k = bundle.indexOf('{', i);
  for (; k < bundle.length; k++) { if (bundle[k] === '{') d++; else if (bundle[k] === '}' && --d === 0) break; }
  const saveTxt = bundle.slice(i, k + 1);
  const sm = saveTxt.match(/^async function [\w$]+\(\w,\w\)\{let \w=([\w$]+)\.currentUser;if\(!\w\)throw .*?;let \w=\{\.\.\.\w,updatedAt:new Date\(\)\.toISOString\(\)\};\w===!0\?await ([\w$]+)\(([\w$]+)\(\w\.uid\),\w,\{merge:!0\}\):await ([\w$]+)\(\3\(\w\.uid\),\w\)\}$/);
  assert.ok(sm, `forma inesperada de save no bundle: ${saveTxt}`);
  const pm = bundle.match(/([\w$]+)=(\w)=>\2&&\{uid:\2\.uid,[^}]*\}/); assert.ok(pm, 'pub não encontrada no bundle');
  const [, bAuth, bSet, bRef, bUpd] = sm;
  const users = [
    { uid: 'a', email: 'e', displayName: 'N', photoURL: 'f', emailVerified: true, providerData: [{ providerId: 'password' }, { providerId: 'google.com' }], metadata: OLD },
    { uid: 'b', email: null, providerData: [], metadata: {} },
    { uid: 'd', providerData: [{ providerId: 'password' }], metadata: { creationTime: OLD.creationTime, lastSignInTime: 'Thu, 01 Jan 2026 10:01:30 GMT' } }, { uid: 'c', providerData: [{ providerId: 'google.com' }] }, null,
  ];
  const runs = [];
  for (const kind of ['fonte', 'bundle']) {
    const calls = []; const ctx = { Date: class extends Date { toISOString() { return 'T'; } }, Object, Error };
    const m = { currentUser: { uid: 'u1' } };
    if (kind === 'fonte') Object.assign(ctx, { auth: m, ref: (u) => `users/${u}`, setDoc: async (...a) => calls.push(['set', ...a]), updateDoc: async (...a) => calls.push(['upd', ...a]) });
    else Object.assign(ctx, { [bAuth]: m, [bRef]: (u) => `users/${u}`, [bSet]: async (...a) => calls.push(['set', ...a]), [bUpd]: async (...a) => calls.push(['upd', ...a]) });
    vm.createContext(ctx);
    if (kind === 'fonte') vm.runInContext(MOD.slice(0, MOD.indexOf('async function confirmIdentity(')) + ';this.pub=pub;this.save=save;', ctx);
    else vm.runInContext(`var ${pm[0]};${saveTxt};this.pub=${pm[1]};this.save=${saveName};`, ctx);
    await ctx.save({ favorites: ['x'] }); await ctx.save({ name: 'n' }, true); await ctx.save({ a: 1 }, 'sim');
    m.currentUser = null; let semLogin; try { await ctx.save({}); } catch (e) { semLogin = e.code; }
    runs.push(JSON.stringify({ calls, semLogin, pubs: users.map((u) => ctx.pub(u ? structuredClone(u) : u)) }));
  }
  assert.equal(runs[1], runs[0], 'bundle e fonte divergem');
  const r = JSON.parse(runs[0]);
  assert.deepEqual(r.calls.map((c) => c[0]), ['upd', 'set', 'upd'], 'só criar === true usa setDoc');
  assert.equal(r.semLogin, 'auth/no-user');
  assert.deepEqual(r.pubs[0].providers, ['password', 'google.com']); assert.equal(r.pubs[0].lastIn, Date.parse(OLD.lastSignInTime));
  assert.equal(r.pubs[0].nova, false, 'conta antiga'); assert.equal(r.pubs[1].nova, true, 'sem datas: comportamento anterior');
  assert.equal(r.pubs[1].lastIn, 0); assert.equal(r.pubs[2].nova, true, 'login 90 s após criar = nova'); assert.equal(r.pubs[4], null);
});

console.log(`✓ Exclusão pendente (página + módulo, Firebase simulado): ${n} grupos de testes passaram`);
