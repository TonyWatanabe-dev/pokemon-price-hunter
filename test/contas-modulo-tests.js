// Módulo de conta (tools/account.src.js → account.js): roda o código-fonte INTEIRO com o SDK do Firebase simulado.
// Sem rede, sem conta real, sem e-mail. Cobre configuração (popup x redirecionamento), login Google/e-mail, cadastro
// (nome opcional, e-mail de confirmação com e sem link de volta), recuperação de senha, saída, leitura e gravação do
// próprio documento users/<uid>. A exclusão (remove/wipe) está em test/account-delete-tests.js.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../tools/account.src.js', import.meta.url), 'utf8');
const code = src
  .replace(/^import[\s\S]*?from '[^']+';\n/gm, '')
  .replace(/^export (const|async function|function) /gm, '$1 ');
assert.doesNotMatch(code, /^\s*(import|export)\b/m, 'sobrou import/export no código preparado');
const NAMES = ['authMode', 'redirectResult', 'watch', 'google', 'emailIn', 'emailUp', 'resend', 'reload', 'reset', 'out', 'load', 'save', 'wipe', 'pub'];

let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };
const err = (c) => Object.assign(new Error(c), { code: c });

function setup({ host = 'tcgpricehunter.com.br', user = null, redirect = Promise.resolve(null), docs = {}, sdk = {} } = {}) {
  const calls = []; const log = (...a) => calls.push(a);
  const auth = { currentUser: user, languageCode: null };
  const store = new Map(Object.entries(docs));
  const ctx = {
    location: { hostname: host, origin: `https://${host}` },
    Date, Object, Set, Promise, structuredClone,
    initializeApp: (cfg) => { log('initializeApp', cfg); return { cfg }; },
    getAuth: () => auth,
    getFirestore: () => ({}),
    doc: (_db, col, id) => `${col}/${id}`,
    getRedirectResult: () => redirect,
    onAuthStateChanged: (_a, cb) => { ctx._cb = cb; return () => {}; },
    GoogleAuthProvider: class { setCustomParameters(p) { this.params = p; } },
    EmailAuthProvider: { credential: (e, pw) => ({ e, pw }) },
    signInWithPopup: async (_a, p) => { log('popup', p.params); return { user: sdk.googleUser || gUser }; },
    signInWithRedirect: async (_a, p) => { log('redirect', p.params); },
    signInWithEmailAndPassword: async (_a, e, pw) => { log('emailIn', e, pw); if (sdk.emailIn) throw sdk.emailIn; return { user: pwUser }; },
    createUserWithEmailAndPassword: async (_a, e, pw) => { log('create', e, pw); if (sdk.create) throw sdk.create; auth.currentUser = { ...pwUser, email: e }; return { user: auth.currentUser }; },
    updateProfile: async (u, p) => { log('updateProfile', p); if (sdk.updateProfile) throw sdk.updateProfile; u.displayName = p.displayName; },
    sendEmailVerification: async (_u, s) => { log('verify', s); const e = sdk.verify?.shift?.(); if (e) throw e; },
    sendPasswordResetEmail: async (_a, e, s) => { log('reset', e, s); const x = sdk.reset?.shift?.(); if (x) throw x; },
    signOut: async () => { log('signOut'); auth.currentUser = null; },
    deleteUser: async () => { log('deleteUser'); },
    reauthenticateWithPopup: async () => { log('reauthPopup'); },
    reauthenticateWithCredential: async () => { log('reauthCred'); },
    getDoc: async (r) => { log('getDoc', r); if (sdk.getDoc) throw sdk.getDoc; return { exists: () => store.has(r), data: () => structuredClone(store.get(r)) }; },
    setDoc: async (r, d, o) => { log('setDoc', r, structuredClone(d), o); if (sdk.setDoc) throw sdk.setDoc; store.set(r, { ...(o?.merge ? store.get(r) : {}), ...d }); },
    deleteDoc: async (r) => { log('deleteDoc', r); store.delete(r); },
  };
  vm.createContext(ctx);
  vm.runInContext(code + `\n;Object.assign(this, { ${NAMES.join(', ')} });`, ctx);
  return { ctx, calls, auth, store, of: (k) => calls.filter((c) => c[0] === k) };
}
const pwUser = { uid: 'u1', email: 'a@b.c', displayName: null, photoURL: null, emailVerified: false, providerData: [{ providerId: 'password' }] };
const gUser = { uid: 'g1', email: 'g@gmail.com', displayName: 'Pessoa G', photoURL: 'https://lh3.googleusercontent.com/x', emailVerified: true, providerData: [{ providerId: 'google.com' }] };

await t('produção usa popup e authDomain do Firebase; só hosts da lista usam redirecionamento', async () => {
  const p = setup();
  assert.equal(p.ctx.authMode, 'popup');
  assert.equal(p.of('initializeApp')[0][1].authDomain, 'tcg-price-hunter.firebaseapp.com');
  assert.equal(p.auth.languageCode, 'pt', 'e-mails do Firebase em português');
  const host = src.match(/REDIRECT_HOSTS = \['([^']+)'\]/)[1];
  const r = setup({ host });
  assert.equal(r.ctx.authMode, 'redirect');
  assert.equal(r.of('initializeApp')[0][1].authDomain, host);
});

await t('pub expõe só uid, e-mail, nome, foto, verificado e provedor (sem token)', async () => {
  const { ctx } = setup();
  assert.deepEqual({ ...ctx.pub(pwUser) }, { uid: 'u1', email: 'a@b.c', name: '', photo: '', verified: false, provider: 'password' });
  assert.deepEqual({ ...ctx.pub({ ...gUser, accessToken: 'tk', stsTokenManager: {} }) },
    { uid: 'g1', email: 'g@gmail.com', name: 'Pessoa G', photo: gUser.photoURL, verified: true, provider: 'google.com' });
  assert.equal(ctx.pub({ ...pwUser, providerData: [] }).provider, 'password');
  assert.equal(ctx.pub(null), null);
});

await t('watch repassa login e saída já no formato pub', async () => {
  const { ctx } = setup(); const got = [];
  ctx.watch((u) => got.push(u)); ctx._cb(gUser); ctx._cb(null);
  assert.equal(got[0].provider, 'google.com'); assert.equal(got[1], null);
});

await t('Google: popup pede escolha de conta; no modo redirecionamento não espera usuário', async () => {
  const p = setup();
  const u = await p.ctx.google();
  assert.equal(u.uid, 'g1'); assert.deepEqual({ ...p.of('popup')[0][1] }, { prompt: 'select_account' });
  const host = src.match(/REDIRECT_HOSTS = \['([^']+)'\]/)[1];
  const r = setup({ host });
  assert.equal(await r.ctx.google(), null); assert.equal(r.of('redirect').length, 1); assert.equal(r.of('popup').length, 0);
});

await t('volta do redirecionamento: sucesso, sem resultado e erro sem código viram objetos simples', async () => {
  assert.equal((await setup({ redirect: Promise.resolve({ user: gUser }) }).ctx.redirectResult()).user.uid, 'g1');
  assert.equal((await setup({ redirect: Promise.resolve(null) }).ctx.redirectResult()).user, null);
  const e1 = await setup({ redirect: Promise.reject(err('auth/popup-blocked')) }).ctx.redirectResult();
  assert.equal(e1.error.code, 'auth/popup-blocked');
  const e2 = await setup({ redirect: Promise.reject(new Error('x')) }).ctx.redirectResult();
  assert.equal(e2.error.code, 'auth/internal-error', 'erro sem código não vira undefined');
});

await t('login por e-mail devolve pub e propaga o erro do Firebase (a página traduz)', async () => {
  assert.equal((await setup().ctx.emailIn('a@b.c', 'senha1')).provider, 'password');
  await assert.rejects(setup({ sdk: { emailIn: err('auth/invalid-credential') } }).ctx.emailIn('a@b.c', 'x'), { code: 'auth/invalid-credential' });
});

await t('cadastro: nome opcional, falha no nome não derruba a conta; confirmação com link de volta para a home', async () => {
  const p = setup();
  const r = await p.ctx.emailUp('n@b.c', 'senha1', 'Haruto');
  assert.equal(r.verifyError, null); assert.equal(r.email, 'n@b.c');
  assert.deepEqual({ ...p.of('updateProfile')[0][1] }, { displayName: 'Haruto' });
  assert.deepEqual({ ...p.of('verify')[0][1] }, { url: 'https://tcgpricehunter.com.br/' });
  const s = setup(); await s.ctx.emailUp('n@b.c', 'senha1', ''); assert.equal(s.of('updateProfile').length, 0, 'sem nome, sem updateProfile');
  const f = setup({ sdk: { updateProfile: err('auth/network-request-failed') } });
  assert.equal((await f.ctx.emailUp('n@b.c', 'senha1', 'X')).verifyError, null, 'nome falhou mas a conta existe e o e-mail sai');
  await assert.rejects(setup({ sdk: { create: err('auth/email-already-in-use') } }).ctx.emailUp('n@b.c', 'senha1'), { code: 'auth/email-already-in-use' });
});

await t('cadastro: endereço não autorizado reenvia sem link; outro erro do e-mail volta como verifyError (conta criada)', async () => {
  const a = setup({ sdk: { verify: [err('auth/unauthorized-continue-uri')] } });
  const r = await a.ctx.emailUp('n@b.c', 'senha1');
  assert.equal(r.verifyError, null);
  assert.equal(a.of('verify').length, 2); assert.equal(a.of('verify')[1][1], undefined, 'segunda tentativa sem continueUrl');
  const b = setup({ sdk: { verify: [err('auth/too-many-requests')] } });
  const r2 = await b.ctx.emailUp('n@b.c', 'senha1');
  assert.equal(r2.verifyError, 'auth/too-many-requests'); assert.equal(b.of('verify').length, 1, 'não insiste em erro que não é de link');
  const c = setup({ sdk: { verify: [new Error('sem código')] } });
  assert.equal((await c.ctx.emailUp('n@b.c', 'senha1')).verifyError, 'auth/internal-error');
});

await t('reenviar confirmação e recarregar: nada sem login; com login usam o usuário atual', async () => {
  const none = setup(); await none.ctx.resend(); assert.equal(none.of('verify').length, 0);
  assert.equal(await none.ctx.reload(), null);
  const p = setup({ user: { ...pwUser, reload: async () => { p.auth.currentUser.emailVerified = true; } } });
  await p.ctx.resend(); assert.equal(p.of('verify').length, 1);
  assert.equal((await p.ctx.reload()).verified, true);
});

await t('recuperar senha: e-mail com link de volta; sem link se o endereço não estiver autorizado; outros erros sobem', async () => {
  const p = setup(); await p.ctx.reset('a@b.c');
  assert.equal(p.of('reset')[0][1], 'a@b.c'); assert.deepEqual({ ...p.of('reset')[0][2] }, { url: 'https://tcgpricehunter.com.br/' });
  const q = setup({ sdk: { reset: [err('auth/invalid-continue-uri')] } }); await q.ctx.reset('a@b.c');
  assert.equal(q.of('reset').length, 2); assert.equal(q.of('reset')[1][2], undefined);
  await assert.rejects(setup({ sdk: { reset: [err('auth/invalid-email')] } }).ctx.reset('x'), { code: 'auth/invalid-email' });
});

await t('sair chama signOut', async () => {
  const p = setup({ user: pwUser }); await p.ctx.out();
  assert.equal(p.of('signOut').length, 1); assert.equal(p.auth.currentUser, null);
});

await t('load: sem login não lê; lê só users/<próprio uid>; documento inexistente = null', async () => {
  const none = setup(); assert.equal(await none.ctx.load(), null); assert.equal(none.of('getDoc').length, 0);
  const p = setup({ user: pwUser, docs: { 'users/u1': { favorites: ['a'] }, 'users/outro': { favorites: ['x'] } } });
  assert.deepEqual({ ...(await p.ctx.load()) }.favorites, ['a']);
  assert.deepEqual(p.of('getDoc').map((c) => c[1]), ['users/u1']);
  assert.equal(await setup({ user: { ...pwUser, uid: 'novo' } }).ctx.load(), null);
  await assert.rejects(setup({ user: pwUser, sdk: { getDoc: err('unavailable') } }).ctx.load(), { code: 'unavailable' }, 'offline: a página marca loadFailed');
});

await t('save: sem login falha com auth/no-user sem gravar; com login grava só o patch + updatedAt, com merge, no próprio uid', async () => {
  const none = setup();
  await assert.rejects(none.ctx.save({ favorites: [] }), { code: 'auth/no-user' }); assert.equal(none.of('setDoc').length, 0);
  const p = setup({ user: pwUser, docs: { 'users/u1': { name: 'T', favorites: ['a'], alerts: [{ p: 'x', v: 10 }] } } });
  await p.ctx.save({ favorites: ['a', 'b'] });
  const [, ref, data, opts] = p.of('setDoc')[0];
  assert.equal(ref, 'users/u1'); assert.deepEqual({ ...opts }, { merge: true });
  assert.deepEqual(Object.keys(data).sort(), ['favorites', 'updatedAt']);
  assert.match(data.updatedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  assert.deepEqual(p.store.get('users/u1').alerts, [{ p: 'x', v: 10 }], 'merge não apaga os outros campos');
  await assert.rejects(setup({ user: pwUser, sdk: { setDoc: err('permission-denied') } }).ctx.save({ name: 'x' }), { code: 'permission-denied' });
});

await t('o módulo só toca a coleção users e só com o uid do usuário logado', async () => {
  const refs = [...src.matchAll(/doc\(db, '([^']+)', ([^)]+)\)/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(refs, [['users', 'uid']]);
  for (const m of src.matchAll(/ref\(([^)]*)\)/g)) assert.ok(['uid', 'u.uid'].includes(m[1]), `ref(${m[1]})`);
  assert.doesNotMatch(src, /collection\(|query\(|getDocs\(/, 'nenhuma leitura de outros documentos');
});

console.log(`✓ Módulo de conta: ${n} grupos de testes passaram`);
