// Exclusão de conta consistente (achado F1/F2): falha ao apagar o documento users/<uid> NUNCA pode terminar em conta
// excluída com dados pessoais guardados. Roda os mesmos cenários em DUAS implementações:
//   - o código-fonte (tools/account.src.js, a partir de confirmIdentity);
//   - o bundle servido (account.js, gerado por tools/build-account.mjs), extraindo do arquivo minificado as funções
//     wipe/confirmIdentity e ligando os nomes minificados aos mesmos simuladores.
// Os dois têm de produzir a mesma sequência de chamadas e o mesmo estado final. Sem rede, sem Firebase real.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };
const err = (code) => Object.assign(new Error(code), { code });

// ---------- implementação 1: código-fonte ----------
const src = read('../tools/account.src.js');
const iSrc = src.indexOf('async function confirmIdentity(');
assert.ok(iSrc > 0, 'confirmIdentity() não encontrada em account.src.js');
const srcCode = src.slice(iSrc).replace(/^export /gm, '');
assert.doesNotMatch(srcCode, /^\s*(import|export)\b/m);
function loadSrc(m) {
  const ctx = { Object, Error, auth: m.auth, ref: m.ref, pub: m.pub, deleteDoc: m.deleteDoc, deleteUser: m.deleteUser,
    reauthenticateWithPopup: m.reauthenticateWithPopup, reauthenticateWithCredential: m.reauthenticateWithCredential,
    GoogleAuthProvider: m.GoogleAuthProvider, EmailAuthProvider: m.EmailAuthProvider };
  vm.createContext(ctx); vm.runInContext(srcCode + '\n;this.wipe = wipe;', ctx); return ctx.wipe;
}

// ---------- implementação 2: bundle minificado ----------
const bundle = read('../account.js');
const esc = (s) => s.replace(/\$/g, '\\$');
function fnText(name) {
  const i = bundle.indexOf(`async function ${name}(`); assert.ok(i >= 0, `função ${name} não encontrada no bundle`);
  let d = 0; for (let k = bundle.indexOf('{', i); k < bundle.length; k++) {
    if (bundle[k] === '{') d++; else if (bundle[k] === '}' && --d === 0) return bundle.slice(i, k + 1);
  }
  throw new Error('chaves desbalanceadas');
}
const ID = '([\\w$]+)';
const wipeName = bundle.match(/export\{[^}]*?([\w$]+) as wipe[,}]/)?.[1];
assert.ok(wipeName, 'wipe não exportada pelo bundle (account.js desatualizado? rode tools/build-account.mjs)');
assert.doesNotMatch(bundle, / as remove[,}]/, 'bundle ainda exporta remove(): account.js não foi regenerado');
const wipeTxt = fnText(wipeName);
const wm = wipeTxt.match(new RegExp(`^async function ${esc(wipeName)}\\(\\w\\)\\{let \\w=${ID}\\.currentUser;if\\(\\w\\)\\{await ${ID}\\(\\w,\\w\\);try\\{await ${ID}\\(${ID}\\(\\w\\.uid\\)\\)\\}catch\\(\\w\\)\\{if\\(\\w\\?\\.code!=="not-found"\\)throw \\w\\}try\\{await ${ID}\\(\\w\\)\\}catch`));
assert.ok(wm, `forma inesperada de wipe no bundle (ajuste o extrator se o build mudou): ${wipeTxt}`);
const [, bAuth, bConfirm, bDeleteDoc, bRef, bDeleteUser] = wm;
const confTxt = fnText(bConfirm);
const cm = confTxt.match(new RegExp(`^async function ${esc(bConfirm)}\\(\\w,\\w\\)\\{let \\w=${ID}\\(\\w\\)\\.provider;if\\(\\w==="google\\.com"\\)await ${ID}\\(\\w,new ${ID}\\);else if\\(\\w==="password"\\)\\{.*?await ${ID}\\(\\w,${ID}\\.credential\\(\\w\\.email,\\w\\)\\)\\}\\}$`));
assert.ok(cm, `forma inesperada de confirmIdentity no bundle: ${confTxt}`);
const [, bPub, bPopup, bGoogle, bCred, bEmail] = cm;
function loadBundle(m) {
  const ctx = { Object, Error, [bAuth]: m.auth, [bRef]: m.ref, [bPub]: m.pub, [bDeleteDoc]: m.deleteDoc, [bDeleteUser]: m.deleteUser,
    [bPopup]: m.reauthenticateWithPopup, [bCred]: m.reauthenticateWithCredential, [bGoogle]: m.GoogleAuthProvider, [bEmail]: m.EmailAuthProvider };
  vm.createContext(ctx); vm.runInContext(`${confTxt}\n${wipeTxt}\n;this.wipe = ${wipeName};`, ctx); return ctx.wipe;
}

// ---------- mundo simulado: Auth + Firestore ----------
// fail: { reauth, deleteDoc, deleteUser } = lista de códigos de erro consumidos um por chamada (undefined = sucesso).
function world({ provider = 'password', hasDoc = true, fail = {}, user = true } = {}) {
  const calls = []; const docs = new Set(hasDoc ? ['users/u1'] : []); const accounts = new Set(['u1']);
  const take = (k) => { const c = fail[k]?.shift?.(); if (c) throw err(c); };
  const u = { uid: 'u1', email: 'a@b.c', providerData: [{ providerId: provider }] };
  const m = {
    auth: { currentUser: user ? u : null },
    ref: (uid) => `users/${uid}`,
    pub: (x) => ({ provider: x.providerData?.[0]?.providerId || 'password' }),
    deleteDoc: async (r) => { calls.push('deleteDoc'); take('deleteDoc'); docs.delete(r); },
    deleteUser: async (x) => { calls.push('deleteUser'); take('deleteUser'); accounts.delete(x.uid); m.auth.currentUser = null; },
    reauthenticateWithPopup: async (_u, p) => { calls.push('reauthPopup'); assert.ok(p instanceof m.GoogleAuthProvider); take('reauth'); },
    reauthenticateWithCredential: async (_u, c) => { calls.push(`reauthCred:${c.pw}`); take('reauth'); },
    GoogleAuthProvider: class {},
    EmailAuthProvider: { credential: (e, pw) => { assert.equal(e, 'a@b.c'); return { pw }; } },
  };
  return { m, calls, docs, accounts, state: () => ({ doc: docs.has('users/u1'), conta: accounts.has('u1') }), relogin: () => { if (accounts.has('u1')) m.auth.currentUser = u; } };
}
async function run(load, w, pw) { const wipe = load(w.m); try { await wipe(pw); return { ok: true }; } catch (e) { return { ok: false, code: e?.code, docDeleted: e?.docDeleted === true }; } }

// Cada cenário roda nas duas implementações e compara.
const IMPLS = [['fonte', loadSrc], ['bundle', loadBundle]];
async function both(name, fn) {
  const out = [];
  for (const [label, load] of IMPLS) await t(`${name} [${label}]`, async () => { out.push(await fn(load)); });
  assert.deepEqual(out[1], out[0], `${name}: bundle e fonte divergem`);
}

await both('sucesso (senha): confirma a senha, apaga o documento e só então a conta', async (load) => {
  const w = world(); const r = await run(load, w, 'pw');
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(w.calls, ['reauthCred:pw', 'deleteDoc', 'deleteUser']);
  assert.deepEqual(w.state(), { doc: false, conta: false });
  return { r, calls: w.calls };
});

await both('sucesso (Google): popup é a PRIMEIRA chamada (ainda no clique), antes de qualquer exclusão', async (load) => {
  const w = world({ provider: 'google.com' }); const r = await run(load, w);
  assert.deepEqual(w.calls, ['reauthPopup', 'deleteDoc', 'deleteUser']);
  assert.deepEqual(w.state(), { doc: false, conta: false });
  return { r, calls: w.calls };
});

for (const code of ['unavailable', 'permission-denied', 'deadline-exceeded']) {
  await both(`falha no deleteDoc (${code}): aborta, conta NÃO é excluída, erro sobe`, async (load) => {
    const w = world({ fail: { deleteDoc: [code] } }); const r = await run(load, w, 'pw');
    assert.deepEqual(r, { ok: false, code, docDeleted: false });
    assert.ok(!w.calls.includes('deleteUser'), 'deleteUser não pode ser chamado se o documento não foi apagado');
    assert.deepEqual(w.state(), { doc: true, conta: true });
    return { r, calls: w.calls };
  });
}

await both('falha de rede na confirmação: nada é apagado', async (load) => {
  const w = world({ fail: { reauth: ['auth/network-request-failed'] } }); const r = await run(load, w, 'pw');
  assert.deepEqual(r, { ok: false, code: 'auth/network-request-failed', docDeleted: false });
  assert.deepEqual(w.calls, ['reauthCred:pw']);
  assert.deepEqual(w.state(), { doc: true, conta: true });
  return { r, calls: w.calls };
});

await both('senha errada: nada é apagado', async (load) => {
  const w = world({ fail: { reauth: ['auth/invalid-credential'] } }); const r = await run(load, w, 'errada');
  assert.equal(r.code, 'auth/invalid-credential'); assert.deepEqual(w.state(), { doc: true, conta: true });
  return { r, calls: w.calls };
});

await both('requires-recent-login (conta com senha, sem senha digitada): não começa, nada apagado (F2)', async (load) => {
  for (const pw of ['', undefined]) {
    const w = world(); const r = await run(load, w, pw);
    assert.deepEqual(r, { ok: false, code: 'auth/requires-recent-login', docDeleted: false });
    assert.deepEqual(w.calls, []); assert.deepEqual(w.state(), { doc: true, conta: true });
  }
  return 'ok';
});

await both('Google: popup fechado/bloqueado: nada apagado', async (load) => {
  for (const code of ['auth/popup-closed-by-user', 'auth/popup-blocked']) {
    const w = world({ provider: 'google.com', fail: { reauth: [code] } }); const r = await run(load, w);
    assert.equal(r.code, code); assert.deepEqual(w.calls, ['reauthPopup']); assert.deepEqual(w.state(), { doc: true, conta: true });
  }
  return 'ok';
});

await both('falha de rede na exclusão da conta (documento já apagado): erro com docDeleted; repetir conclui', async (load) => {
  const w = world({ fail: { deleteUser: ['auth/network-request-failed'] } });
  const r1 = await run(load, w, 'pw');
  assert.deepEqual(r1, { ok: false, code: 'auth/network-request-failed', docDeleted: true });
  assert.deepEqual(w.state(), { doc: false, conta: true }, 'conta fica, mas SEM dados pessoais');
  const r2 = await run(load, w, 'pw');
  assert.deepEqual(r2, { ok: true });
  assert.deepEqual(w.calls, ['reauthCred:pw', 'deleteDoc', 'deleteUser', 'reauthCred:pw', 'deleteDoc', 'deleteUser']);
  assert.deepEqual(w.state(), { doc: false, conta: false });
  return { r1, r2, calls: w.calls };
});

await both('requires-recent-login mesmo após confirmar (provedor sem confirmação prévia): repetir conclui', async (load) => {
  const w = world({ provider: 'phone', fail: { deleteUser: ['auth/requires-recent-login'] } });
  const r1 = await run(load, w);
  assert.deepEqual(r1, { ok: false, code: 'auth/requires-recent-login', docDeleted: true });
  assert.deepEqual(w.state(), { doc: false, conta: true });
  const r2 = await run(load, w); assert.deepEqual(r2, { ok: true }); assert.deepEqual(w.state(), { doc: false, conta: false });
  return { r1, r2, calls: w.calls };
});

await both('repetição após falha no deleteDoc: a 2ª tentativa conclui', async (load) => {
  const w = world({ fail: { deleteDoc: ['unavailable'] } });
  const r1 = await run(load, w, 'pw'); assert.equal(r1.code, 'unavailable'); assert.deepEqual(w.state(), { doc: true, conta: true });
  w.relogin(); const r2 = await run(load, w, 'pw'); assert.deepEqual(r2, { ok: true });
  assert.deepEqual(w.calls, ['reauthCred:pw', 'deleteDoc', 'reauthCred:pw', 'deleteDoc', 'deleteUser']);
  assert.deepEqual(w.state(), { doc: false, conta: false });
  return { r1, r2, calls: w.calls };
});

await both('documento inexistente conta como sucesso (sem documento, e deleteDoc com not-found)', async (load) => {
  const a = world({ hasDoc: false }); const ra = await run(load, a, 'pw');
  assert.deepEqual(ra, { ok: true }); assert.deepEqual(a.state(), { doc: false, conta: false });
  const b = world({ fail: { deleteDoc: ['not-found'] } }); const rb = await run(load, b, 'pw');
  assert.deepEqual(rb, { ok: true }); assert.deepEqual(b.calls, ['reauthCred:pw', 'deleteDoc', 'deleteUser']);
  return { ra, rb };
});

await both('sem usuário logado: não faz nada', async (load) => {
  const w = world({ user: false }); const r = await run(load, w, 'pw');
  assert.deepEqual(r, { ok: true }); assert.deepEqual(w.calls, []);
  return r;
});

await t('invariante: em nenhum cenário de falha a conta some com o documento ainda guardado', async () => {
  const fails = [{ deleteDoc: ['unavailable'] }, { deleteDoc: ['permission-denied'] }, { reauth: ['auth/network-request-failed'] },
    { deleteUser: ['auth/network-request-failed'] }, { deleteUser: ['auth/requires-recent-login'] }, {}];
  for (const [, load] of IMPLS) for (const provider of ['password', 'google.com']) for (const f of fails) {
    const w = world({ provider, fail: structuredClone(f) }); await run(load, w, 'pw');
    const s = w.state(); assert.ok(!(s.doc && !s.conta), `conta excluída com documento órfão: ${provider} ${JSON.stringify(f)}`);
  }
});

await t('o robô não recria documento de conta excluída (toda gravação em users/ tem pré-condição)', async () => {
  const rest = read('../src/firestore-rest.js');
  const patch = rest.slice(rest.indexOf('async patchUser('), rest.indexOf('async linkedUsers('));
  assert.match(patch, /currentDocument\.updateTime/); assert.match(patch, /currentDocument\.exists', 'true'/);
  assert.equal((rest.match(/call\('(PATCH|POST|PUT)'[^)]*users\//g) || []).length, 1, 'só patchUser grava em users/');
  const tg = read('../src/telegram-usuario.js');
  assert.doesNotMatch(tg, /\b(setDoc|createDocument|call\(')/, 'telegram-usuario só grava via fs.patchUser');
});

console.log(`✓ Exclusão de conta consistente (fonte + bundle): ${n} grupos de testes passaram`);
