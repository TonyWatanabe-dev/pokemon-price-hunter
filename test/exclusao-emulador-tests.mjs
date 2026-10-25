// Exclusão de conta contra os EMULADORES do Firebase (Auth + Firestore), sem projeto real e sem rede de produção.
// O `npm test` (test/run-all.mjs) descobre este arquivo, mas sem emulador ele só imprime "pulado" e sai 0 (nada é
// baixado nem executado contra rede). Roda o código de tools/account.src.js (a mesma fonte do account.js; fonte ≡ bundle
// em test/exclusao-modulo-tests.js) com o SDK firebase@12.19.0 apontado para os emuladores.
// Uso (projeto demo-, versões do workflow firestore-regras.yml; FB_DIR = pasta com node_modules de firebase-tools e firebase):
//   cd <pasta com firebase.json declarando auth e firestore> && "$FB_DIR/node_modules/.bin/firebase" emulators:exec \
//     --only auth,firestore --project demo-tcgph "FB_DIR=$FB_DIR REGRAS=<repo>/firebase/firestore.rules \
//     REGRAS_PROPOSTAS=<arquivo .rules opcional> node <repo>/test/exclusao-emulador-tests.mjs"
// Só com o emulador do Auth (--only auth): os casos de Auth rodam com um Firestore em memória no lugar do emulador e os
// casos que dependem do Firestore (transação, regras, robô) são PULADOS e listados como tal (nunca contam como ok).
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const FS = process.env.FIRESTORE_EMULATOR_HOST;
const PID = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'demo-tcgph';
if (!AUTH) { console.log('exclusao-emulador: pulado (sem FIREBASE_AUTH_EMULATOR_HOST; rode dentro de `firebase emulators:exec --only auth,firestore`)'); process.exit(0); }
assert.match(PID, /^demo-/, 'só projeto demo- (nada fala com o projeto real)');
// Falha de rede de verdade numa chamada escolhida (o SDK do Auth guarda o fetch global ao carregar: o desvio vem antes).
const fetchReal = globalThis.fetch; let falharRede = null;
globalThis.fetch = (u, o) => { if (falharRede?.(String(u))) { falharRede = null; return Promise.reject(new TypeError('fetch failed')); } return fetchReal(u, o); };
const req = createRequire(path.join(process.env.FB_DIR || process.cwd(), 'package.json'));
const APP = req('firebase/app'); const A = req('firebase/auth'); const L = req('firebase/firestore/lite');
const ler = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

// ---------- o módulo de conta de verdade, uma instância por aba/aparelho ----------
let code = ler('../tools/account.src.js').replace(/import\s*\{([^}]*)\}\s*from\s*'([^']+)';/g, (_, n, m) => `const {${n}} = __sdk[${JSON.stringify(m)}];`).replace(/^export /gm, '');
assert.doesNotMatch(code, /^\s*(import|export)\b/m, 'account.src.js mudou de forma: ajuste o carregador');
const fabrica = new Function('__sdk', 'localStorage', 'sessionStorage', 'location', `${code}\nreturn { watch, load, save, wipe, mark, delState, excluir, continuar, pub, auth, db, ref, emailIn, out };`);

// Firestore em memória (só no modo sem emulador do Firestore; mesma interface usada pelo módulo)
const mem = new Map(); let memVer = 0;
const FAKE = {
  getFirestore: () => 'DB', doc: (_db, c, id) => `${c}/${id}`,
  getDoc: async (r) => { const d = mem.get(r); return { exists: () => !!d, data: () => structuredClone(d) }; },
  setDoc: async (r, d, o) => { mem.set(r, structuredClone(o?.merge ? { ...mem.get(r), ...d } : d)); memVer++; },
  updateDoc: async (r, d) => { if (!mem.has(r)) throw Object.assign(new Error('not-found'), { code: 'not-found' }); mem.set(r, { ...mem.get(r), ...structuredClone(d) }); memVer++; },
  deleteDoc: async (r) => { mem.delete(r); memVer++; },
  runTransaction: async (_db, fn) => { for (;;) { const v = memVer; const sets = []; const out = await fn({ get: FAKE.getDoc, set: (r, d) => sets.push([r, d]) }); if (v !== memVer) continue; for (const [r, d] of sets) await FAKE.setDoc(r, d); return out; } },
};
const G = { aposDeleteDoc: null, noMeioDaTx: null, txGets: 0 };   // ganchos para provocar falhas e corridas reais
const base = FS ? L : FAKE;
const FIRESTORE = {
  ...base,
  getFirestore: (app) => { if (!FS) return 'DB'; const d = L.getFirestore(app); const [h, p] = FS.split(':'); L.connectFirestoreEmulator(d, h, Number(p)); return d; },
  deleteDoc: async (r) => { await base.deleteDoc(r); const g = G.aposDeleteDoc; G.aposDeleteDoc = null; if (g) await g(); },
  runTransaction: (db, fn) => base.runTransaction(db, async (t) => fn({
    get: async (r) => { G.txGets++; const s = await t.get(r); const g = G.noMeioDaTx; G.noMeioDaTx = null; if (g) await g(); return s; },
    set: (r, d) => t.set(r, d),
  })),
};
let seq = 0;
// Navegador: localStorage/sessionStorage compartilhados pelas abas e a sessão persistida do Firebase (como o IndexedDB),
// para reabrir a página e passar pela restauração de verdade do SDK (recarrega o usuário no servidor ao iniciar).
function navegador() {
  const ls = new Map(); const ss = new Map(); const sessao = new Map();
  const storage = (m) => ({ getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } });
  // a chave do SDK termina no nome do app (aqui um por aba); no navegador real as abas usam o mesmo nome → sem o sufixo
  const K = (k) => k.replace(/:aba\d+$/, '');
  class Persistencia { static type = 'LOCAL'; type = 'LOCAL'; async _isAvailable() { return true; } async _set(k, v) { sessao.set(K(k), structuredClone(v)); } async _get(k) { return sessao.has(K(k)) ? structuredClone(sessao.get(K(k))) : null; } async _remove(k) { sessao.delete(K(k)); } _addListener() {} _removeListener() {} }
  const nav = { ls, ss, localStorage: storage(ls), sessionStorage: storage(ss) };
  nav.aba = () => fabrica({
    'firebase/app': { initializeApp: (cfg) => APP.initializeApp({ ...cfg, projectId: PID }, `aba${++seq}`) },
    'firebase/auth': { ...A, getAuth: (app) => { const a = A.initializeAuth(app, { persistence: Persistencia }); A.connectAuthEmulator(a, `http://${AUTH}`, { disableWarnings: true }); return a; } },
    'firebase/firestore/lite': FIRESTORE,
  }, nav.localStorage, nav.sessionStorage, undefined);
  return nav;
}

// ---------- administração dos emuladores (Bearer owner = admin do emulador) ----------
async function adm(op, body) {
  const r = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PID}/${op}`, { method: 'POST', headers: { authorization: 'Bearer owner', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json(); assert.equal(r.status, 200, `${op}: ${JSON.stringify(j)}`); return j;
}
const existe = async (uid) => !!(await adm('accounts:lookup', { localId: [uid] })).users?.length;
const FSURL = FS && `http://${FS}/v1/projects/${PID}/databases/(default)/documents`;
async function docServidor(uid) {
  if (!FS) return mem.get(`users/${uid}`) ?? null;
  const r = await fetch(`${FSURL}/users/${uid}`, { headers: { authorization: 'Bearer owner' } });
  if (r.status === 404) return null; const j = await r.json(); return { ...j.fields, _updateTime: j.updateTime };
}
async function regras(arquivo) {
  const r = await fetch(`http://${FS}/emulator/v1/projects/${PID}:securityRules`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content: fs.readFileSync(arquivo, 'utf8') }] } }) });
  assert.equal(r.status, 200, `regras não carregadas: ${await r.text()}`);
}
const limparFirestore = async () => { if (FS) await fetch(`http://${FS}/emulator/v1/projects/${PID}/databases/(default)/documents`, { method: 'DELETE' }); else mem.clear(); };
const PW = 'senha-forte-1';
// Conta com senha; velha = criada há 1 dia (createdAt ajustado pelo admin do emulador), como quem já usa o site.
async function conta(m, { velha = true } = {}) {
  const email = `t${Date.now()}${++seq}@exemplo.test`;
  const { user } = await A.createUserWithEmailAndPassword(m.auth, email, PW);
  if (velha) { await adm('accounts:update', { localId: user.uid, createdAt: String(Date.now() - 864e5) }); await user.reload(); }
  return { uid: user.uid, email };
}
const codigo = async (p) => { try { await p; return 'ok'; } catch (e) { return e?.code || String(e); } };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const primeiroEstado = (m) => new Promise((res) => { const un = m.watch((u) => { un?.(); res(u); }); });

// ---------- casos ----------
const resultado = []; const pulados = [];
async function caso(nome, precisa, fn) {
  if (precisa === 'firestore' && !FS) { pulados.push(nome); console.log(`PULADO ${nome} (sem emulador do Firestore)`); return; }
  if (precisa === 'propostas' && !(FS && process.env.REGRAS_PROPOSTAS)) { pulados.push(nome); console.log(`PULADO ${nome} (sem emulador do Firestore ou REGRAS_PROPOSTAS)`); return; }
  await limparFirestore(); Object.assign(G, { aposDeleteDoc: null, noMeioDaTx: null, txGets: 0 });
  if (FS && process.env.REGRAS) await regras(process.env.REGRAS);
  try { await fn(); resultado.push([nome, true]); console.log(`ok  ${nome}`); } catch (e) { resultado.push([nome, false]); console.log(`ERRO ${nome}\n     ${String(e?.stack || e).split("\n").slice(0, 8).join('\n     ')}`); }
}
const fundo = FS ? 'emulador do Firestore' : 'Firestore em memória';

await caso(`E1 deleteUser falha no Auth depois do deleteDoc (conta desativada; ${fundo}) → pendente; retomada conclui`, null, async () => {
  const nav = navegador(); const m = nav.aba(); const c = await conta(m);
  await m.continuar('Ana'); assert.ok(await docServidor(c.uid), 'perfil criado'); nav.ss.set(`ph:tg:${c.uid}`, 'x');
  G.aposDeleteDoc = () => adm('accounts:update', { localId: c.uid, disableUser: true });
  let e; try { await m.excluir(PW); } catch (x) { e = x; }
  assert.equal(e?.code, 'auth/user-disabled'); assert.equal(e?.docDeleted, true);
  assert.equal(nav.ls.get(`ph:del:${c.uid}`), 'pendente'); assert.equal(await docServidor(c.uid), null); assert.ok(await existe(c.uid), 'login continua existindo');
  assert.equal(m.auth.currentUser, null, 'o SDK encerra a sessão ao receber user-disabled');
  await adm('accounts:update', { localId: c.uid, disableUser: false });
  await m.emailIn(c.email, PW); const d = await m.load(); assert.equal(d, null);
  assert.equal(await m.delState(d), 'pendente');
  assert.equal(await codigo(m.save({ favorites: ['x'] })), FS ? 'not-found' : 'not-found', 'gravação comum não recria o documento');
  assert.equal(await m.excluir(PW), true); assert.equal(await existe(c.uid), false); assert.equal(await docServidor(c.uid), null);
  assert.equal(nav.ls.has(`ph:del:${c.uid}`), false); assert.equal(nav.ss.has(`ph:tg:${c.uid}`), false);
});

await caso(`E2 deleteUser falha com token revogado (validSince) depois do deleteDoc (${fundo}) → pendente, nada recriado`, null, async () => {
  const nav = navegador(); const m = nav.aba(); const c = await conta(m); await m.continuar('Bia');
  G.aposDeleteDoc = () => adm('accounts:update', { localId: c.uid, validSince: String(Math.floor(Date.now() / 1000) + 2) });
  let e; try { await m.excluir(PW); } catch (x) { e = x; }
  assert.equal(e?.code, 'auth/user-token-expired'); assert.equal(e?.docDeleted, true);
  assert.equal(nav.ls.get(`ph:del:${c.uid}`), 'pendente'); assert.equal(await docServidor(c.uid), null); assert.ok(await existe(c.uid));
  await espera(3100); await m.emailIn(c.email, PW); assert.equal(await m.delState(await m.load()), 'pendente');
  assert.equal(await m.excluir(PW), true); assert.equal(await existe(c.uid), false);
});

await caso('E3 lastSignInTime avança com a reautenticação e o outro aparelho vê ao recarregar/reabrir (M3)', null, async () => {
  const n1 = navegador(); const n2 = navegador(); const m1 = n1.aba(); const c = await conta(m1);
  const m2 = n2.aba(); await m2.emailIn(c.email, PW); const antes = m2.pub(m2.auth.currentUser).lastIn;
  await espera(1100);
  await A.reauthenticateWithCredential(m1.auth.currentUser, A.EmailAuthProvider.credential(c.email, PW));
  const depois = m1.pub(m1.auth.currentUser).lastIn; assert.ok(depois > antes, `reautenticação não avançou lastSignInTime (${antes} → ${depois})`);
  await m2.auth.currentUser.reload(); assert.equal(m2.pub(m2.auth.currentUser).lastIn, depois, 'reload no outro aparelho traz a data do servidor');
  const m2b = n2.aba(); const u = await primeiroEstado(m2b);   // reabrir a página: sessão restaurada e recarregada pelo SDK
  assert.equal(u?.lastIn, depois); assert.equal(u?.nova, false, 'conta antiga: não é tratada como cadastro novo');
});

await caso('E4 limite documentado: conta criada há < 2 min e reautenticada → outro aparelho ainda a vê como nova', null, async () => {
  const n1 = navegador(); const m1 = n1.aba(); const c = await conta(m1, { velha: false });
  await A.reauthenticateWithCredential(m1.auth.currentUser, A.EmailAuthProvider.credential(c.email, PW));
  const m2 = navegador().aba(); await m2.emailIn(c.email, PW); assert.equal(m2.pub(m2.auth.currentUser).nova, true);
  assert.equal(await m2.delState(null), '', 'sem marca e nova: a página criaria o perfil (limite já conhecido; só nos 2 primeiros minutos)');
});

await caso('E5 página aberta noutro aparelho, exclusão concluída aqui: delState vê a conta excluída (token-expired), limpa a marca e sai', null, async () => {
  const n1 = navegador(); const n2 = navegador(); const m1 = n1.aba(); const c = await conta(m1);
  const m2 = n2.aba(); await m2.emailIn(c.email, PW); n2.ls.set(`ph:del:${c.uid}`, 'pendente');
  assert.equal(await m1.excluir(PW), true); assert.equal(await existe(c.uid), false);
  // o que o Auth responde de verdade a quem ficou com o usuário em memória (o SDK traduz USER_NOT_FOUND do lookup)
  const n3 = navegador(); const m3 = n3.aba(); const c3 = await conta(m3);
  const m3b = navegador().aba(); await m3b.emailIn(c3.email, PW); assert.equal(await m3b.excluir(PW), true);
  assert.equal(await codigo(m3.auth.currentUser.reload()), 'auth/user-token-expired');
  // a regra do módulo: página aberta, marca pendente, documento ausente → 'fim'
  assert.equal(await m2.delState(null), 'fim'); assert.equal(n2.ls.has(`ph:del:${c.uid}`), false); assert.equal(m2.auth.currentUser, null);
});

await caso('E6 reabrir a página depois da exclusão concluída noutro aparelho: o SDK descarta a sessão e a marca órfã é limpa', null, async () => {
  const nav = navegador(); const m = nav.aba(); const c = await conta(m); nav.ls.set(`ph:del:${c.uid}`, 'pendente'); nav.ls.set('outra', '1');
  const outro = navegador().aba(); await outro.emailIn(c.email, PW); assert.equal(await outro.excluir(PW), true);
  const u = await primeiroEstado(nav.aba());   // nova aba no mesmo navegador: restauração da sessão persistida
  assert.equal(u, null, 'conta excluída não chega à página'); assert.equal(nav.ls.has(`ph:del:${c.uid}`), false, 'marca órfã removida'); assert.equal(nav.ls.get('outra'), '1');
  // controle: conta que existe → a sessão volta e a marca fica
  const n2 = navegador(); const m2 = n2.aba(); const c2 = await conta(m2); n2.ls.set(`ph:del:${c2.uid}`, 'pendente');
  const u2 = await primeiroEstado(n2.aba()); assert.equal(u2?.uid, c2.uid); assert.equal(n2.ls.get(`ph:del:${c2.uid}`), 'pendente');
});

// ---------- T5-B: caminho feliz, rede, recarga, "Continuar usando", sessão, repetição ----------
await caso(`E7 exclusão bem-sucedida (${fundo}): conta e documento somem, marca e vínculo do Telegram limpos, sessão encerrada; repetir não faz nada`, null, async () => {
  const nav = navegador(); const m = nav.aba(); const c = await conta(m); await m.continuar('Ana'); await m.save({ favorites: ['p1'] }); nav.ss.set(`ph:tg:${c.uid}`, 'x');
  assert.equal(await m.excluir(PW), true);
  assert.equal(await existe(c.uid), false); assert.equal(await docServidor(c.uid), null);
  assert.equal(nav.ls.has(`ph:del:${c.uid}`), false); assert.equal(nav.ss.has(`ph:tg:${c.uid}`), false); assert.equal(m.auth.currentUser, null);
  assert.equal(await m.excluir(PW), undefined, 'sem usuário: undefined (a página não repete "conta excluída")');
  assert.equal(await primeiroEstado(nav.aba()), null, 'reabrir: sem sessão');
});

await caso(`E8 rede cai no deleteUser (sessão mantida; ${fundo}) → pendente; recarga mantém o pendente; outro aparelho não recria; retomar conclui`, null, async () => {
  const nav = navegador(); const m = nav.aba(); const c = await conta(m); await m.continuar('Ana'); await m.save({ favorites: ['p1'] });
  const outro = navegador().aba(); await outro.emailIn(c.email, PW);   // aparelho com a página aberta e dados antigos
  G.aposDeleteDoc = () => { falharRede = (u) => u.includes('accounts:delete'); };
  let e; try { await m.excluir(PW); } catch (x) { e = x; }
  assert.equal(e?.code, 'auth/network-request-failed'); assert.equal(e?.docDeleted, true);
  assert.equal(nav.ls.get(`ph:del:${c.uid}`), 'pendente'); assert.equal(await docServidor(c.uid), null); assert.ok(await existe(c.uid));
  assert.equal(m.auth.currentUser?.uid, c.uid, 'erro de rede não encerra a sessão');
  // recarga no mesmo navegador: sessão restaurada pelo SDK, marca preservada (só some no 1º estado SEM login)
  const r = nav.aba(); const u = await primeiroEstado(r); assert.equal(u?.uid, c.uid); assert.equal(nav.ls.get(`ph:del:${c.uid}`), 'pendente');
  const d = await r.load(); assert.equal(d, null); assert.equal(await r.delState(d), 'pendente');
  assert.equal(await codigo(r.save({ favorites: ['p2'] })), 'not-found', 'gravação comum não recria');
  // outro aparelho (sem a marca): favoritar não recria; ao recarregar, conta antiga sem documento = ausente (não cria sozinho)
  assert.equal(await codigo(outro.save({ favorites: ['p3'] })), 'not-found'); assert.equal(await outro.delState(await outro.load()), 'ausente');
  assert.equal(await docServidor(c.uid), null, 'nada recriado em nenhum aparelho');
  assert.equal(await r.excluir(PW), true); assert.equal(await r.excluir(PW), undefined);
  assert.equal(await existe(c.uid), false); assert.equal(nav.ls.has(`ph:del:${c.uid}`), false);
});

await caso(`E9 "Continuar usando" depois da exclusão parcial (${fundo}): perfil vazio só com o clique, marca limpa, volta a gravar; repetir não grava de novo`, null, async () => {
  const nav = navegador(); const m = nav.aba(); const c = await conta(m); await m.continuar('Ana'); await m.save({ favorites: ['p1'] });
  G.aposDeleteDoc = () => { falharRede = (u) => u.includes('accounts:delete'); };
  await m.excluir(PW).catch(() => {}); assert.equal(nav.ls.get(`ph:del:${c.uid}`), 'pendente');
  const x = await m.continuar('Ana'); assert.deepEqual(x.favorites, [], 'o que foi apagado não volta'); assert.ok(x.createdAt && x.termsAt);
  assert.equal(nav.ls.has(`ph:del:${c.uid}`), false); assert.equal(await m.delState(await m.load()), '');
  assert.equal(await codigo(m.save({ favorites: ['p9'] })), 'ok');
  const y = await m.continuar('Outro'); assert.equal(y.createdAt, x.createdAt); assert.deepEqual(y.favorites, ['p9'], 'perfil completo: só lê');
  assert.ok(await existe(c.uid));
});

await caso(`E10 sessão: senha em branco (conta só com senha) e senha errada param ANTES de apagar; sem usuário nada acontece (${fundo})`, null, async () => {
  const nav = navegador(); const m = nav.aba(); const c = await conta(m); await m.continuar('Ana');
  assert.equal(await codigo(m.excluir('')), 'auth/requires-recent-login');
  assert.ok(await docServidor(c.uid), 'documento intacto'); assert.ok(await existe(c.uid)); assert.equal(nav.ls.has(`ph:del:${c.uid}`), false, 'marca nova desfeita');
  assert.match(await codigo(m.excluir('errada-123')), /^auth\/(invalid-credential|wrong-password|invalid-login-credentials)$/);
  assert.ok(await docServidor(c.uid)); assert.equal(nav.ls.has(`ph:del:${c.uid}`), false);
  // marca pendente anterior + senha errada: a marca continua (não some o aviso)
  nav.ls.set(`ph:del:${c.uid}`, 'pendente'); await m.excluir('errada-123').catch(() => {}); assert.equal(nav.ls.get(`ph:del:${c.uid}`), 'pendente');
  nav.ls.delete(`ph:del:${c.uid}`);
  await A.signOut(m.auth); assert.equal(await m.excluir(PW), undefined); assert.equal(await codigo(m.continuar('Ana')), 'auth/no-user');
  assert.ok(await docServidor(c.uid)); assert.ok(await existe(c.uid)); assert.equal(nav.ls.size, 0);
});

await caso(`E11 sessão encerrada pelo Auth na falha parcial (token revogado) + recarga sem login: marca some (custo do 73c658ff), novo login vê "ausente" e NADA é recriado (${fundo})`, null, async () => {
  const nav = navegador(); const m = nav.aba(); const c = await conta(m); await m.continuar('Ana');
  G.aposDeleteDoc = () => adm('accounts:update', { localId: c.uid, validSince: String(Math.floor(Date.now() / 1000) + 2) });
  await m.excluir(PW).catch(() => {}); assert.equal(nav.ls.get(`ph:del:${c.uid}`), 'pendente'); assert.equal(m.auth.currentUser, null);
  assert.equal(await primeiroEstado(nav.aba()), null); assert.equal(nav.ls.has(`ph:del:${c.uid}`), false, 'limpa no 1º estado sem login');
  await espera(3100); const r = nav.aba(); await r.emailIn(c.email, PW); const d = await r.load();
  assert.equal(d, null); assert.equal(await r.delState(d), 'ausente', 'texto neutro; perfil não é criado sozinho');
  assert.equal(await codigo(r.save({ favorites: ['x'] })), 'not-found'); assert.equal(await docServidor(c.uid), null);
  assert.equal(await r.excluir(PW), true); assert.equal(await existe(c.uid), false);
});

await caso('F1 continuar() em duas abas ao mesmo tempo (dois clientes, documento ausente): um perfil só', 'firestore', async () => {
  const nav = navegador(); const a = nav.aba(); const c = await conta(a); const b = nav.aba(); await b.emailIn(c.email, PW);
  const [x, y] = await Promise.all([a.continuar('Ana'), b.continuar('Ana')]);
  const d = await docServidor(c.uid); assert.equal(x.createdAt, y.createdAt, 'as duas abas devolvem o mesmo perfil'); assert.equal(d.createdAt.stringValue, x.createdAt);
});

await caso('F2 corrida forçada: outra aba grava no meio da transação → pré-condição falha, o SDK repete e preserva o favorito', 'firestore', async () => {
  const nav = navegador(); const a = nav.aba(); const c = await conta(a); const b = nav.aba(); await b.emailIn(c.email, PW);
  G.noMeioDaTx = () => L.setDoc(L.doc(b.db, 'users', c.uid), { favorites: ['fav-B'], updatedAt: 'x' }, { merge: true });   // cliente antigo (setDoc merge)
  const r = await a.continuar('Ana');
  assert.ok(G.txGets >= 2, `sem nova tentativa (gets=${G.txGets})`); assert.deepEqual(r.favorites, ['fav-B']); assert.ok(r.createdAt);
  const d = await docServidor(c.uid); assert.deepEqual(d.favorites.arrayValue.values.map((v) => v.stringValue), ['fav-B']); assert.ok(d.createdAt && d.termsAt);
});

await caso('F3 documento parcial: continuar completa sem perder favoritos e alertas; perfil completo: nenhuma gravação', 'firestore', async () => {
  const nav = navegador(); const m = nav.aba(); const c = await conta(m);
  await L.setDoc(L.doc(m.db, 'users', c.uid), { favorites: ['p9'], alerts: [{ p: 'p3', alvo: 10 }], updatedAt: 'u' }, { merge: true });
  const r = await m.continuar('Ana'); assert.deepEqual(r.favorites, ['p9']); assert.equal(r.alerts.length, 1); assert.ok(r.createdAt && r.termsAt);
  const t1 = (await docServidor(c.uid))._updateTime; await m.continuar('Outro'); assert.equal((await docServidor(c.uid))._updateTime, t1, 'perfil completo: sem gravar');
});

await caso('F4 regras ATUAIS: cliente antigo (setDoc merge sem createdAt) ainda CRIA documento apagado (lacuna M2); campo desconhecido é negado', 'firestore', async () => {
  const m = navegador().aba(); const c = await conta(m); const r = L.doc(m.db, 'users', c.uid);
  assert.equal(await codigo(L.setDoc(r, { favorites: ['x'], updatedAt: 'u' }, { merge: true })), 'ok', 'lacuna M2 confirmada');
  await L.deleteDoc(r);
  assert.equal(await codigo(L.setDoc(r, { favorites: [], intruso: 1 }, { merge: true })), 'permission-denied');
  assert.equal(await codigo(m.continuar('Ana')), 'ok'); assert.equal(await codigo(m.save({ favorites: ['p1'] })), 'ok');
});

async function robo() {
  const { firestoreClient, TOKEN_URI, API } = await import('../src/firestore-rest.js');
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const f = async (url, opt) => (url === TOKEN_URI ? new Response(JSON.stringify({ access_token: 'owner', expires_in: 3600 })) : fetch(String(url).replace(API, `http://${FS}/v1`), opt));
  return firestoreClient({ serviceAccount: { projectId: PID, clientEmail: 'robo@demo.test', privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }) }, fetch: f });
}
await caso('F5 robô (src/firestore-rest.js, conta de serviço = admin): grava só com pré-condição exists, nunca recria', 'firestore', async () => {
  const m = navegador().aba(); const c = await conta(m); await m.continuar('Ana'); const cli = await robo();
  await cli.patchUser(c.uid, { telegramPedido: null }, ['telegramPedido']); assert.ok(await docServidor(c.uid));
  await m.excluir(PW).catch(() => {}); await adm('accounts:delete', { localId: c.uid }).catch(() => {});
  await L.deleteDoc(L.doc(m.db, 'users', c.uid)).catch(() => {});
  await limparFirestore();
  assert.notEqual(await codigo(cli.patchUser(c.uid, { telegramPedido: null }, ['telegramPedido'])), 'ok'); assert.equal(await docServidor(c.uid), null);
});

await caso('M2 regra PROPOSTA: barra create sem createdAt/termsAt; cadastro, continuar, gravação comum e robô seguem', 'propostas', async () => {
  await regras(process.env.REGRAS_PROPOSTAS);
  const nav = navegador(); const m = nav.aba(); const c = await conta(m); const r = L.doc(m.db, 'users', c.uid);
  assert.equal(await codigo(L.setDoc(r, { favorites: ['x'], updatedAt: 'u' }, { merge: true })), 'permission-denied', 'cliente antigo não recria');
  assert.equal(await codigo(L.setDoc(r, { createdAt: 'c', favorites: [] }, { merge: true })), 'permission-denied', 'sem termsAt');
  assert.equal(await codigo(L.setDoc(r, { termsAt: 't', favorites: [] }, { merge: true })), 'permission-denied', 'sem createdAt');
  assert.equal(await docServidor(c.uid), null);
  const now = new Date().toISOString();   // cadastro normal (onUser: save(base, true) = setDoc merge com createdAt+termsAt)
  assert.equal(await codigo(m.save({ name: 'Ana', favorites: [], alerts: [], termsAt: now, createdAt: now }, true)), 'ok');
  assert.equal(await codigo(m.save({ favorites: ['p1'] })), 'ok', 'gravação comum (updateDoc)');
  assert.equal(await codigo(L.setDoc(r, { favorites: ['p2'], updatedAt: 'u' }, { merge: true })), 'ok', 'cliente antigo em doc existente = update');
  assert.equal(await codigo(L.setDoc(r, { favorites: [], intruso: 1 }, { merge: true })), 'permission-denied', 'campos continuam restritos');
  const cli = await robo(); await cli.patchUser(c.uid, { telegramPedido: null }, ['telegramPedido']);
  await L.deleteDoc(r); assert.equal(await codigo(m.continuar('Ana')), 'ok', '"Criar perfil"/"Continuar" (transação) cria');
  await L.deleteDoc(r); assert.notEqual(await codigo(cli.patchUser(c.uid, { telegramPedido: null }, ['telegramPedido'])), 'ok');
  // parcial na corrida: a outra aba (cliente antigo) é barrada; a transação cria completo
  G.noMeioDaTx = () => codigo(L.setDoc(r, { favorites: ['fav-B'] }, { merge: true })).then((x) => assert.equal(x, 'permission-denied'));
  assert.equal(await codigo(m.continuar('Ana')), 'ok');
  const outro = navegador().aba(); const c2 = await conta(outro);   // isolamento: não cria o documento de outra conta
  assert.equal(await codigo(L.setDoc(L.doc(outro.db, 'users', c.uid), { createdAt: 'c', termsAt: 't' }, { merge: true })), 'permission-denied'); void c2;
});

const falhas = resultado.filter(([, ok]) => !ok);
console.log(`\nexclusao-emulador (${PID}; Auth: emulador; Firestore: ${fundo}): ${resultado.length - falhas.length}/${resultado.length} ok, ${pulados.length} pulados${pulados.length ? ` (${pulados.map((p) => p.split(' ')[0]).join(', ')})` : ''}`);
process.exit(falhas.length ? 1 : 0);
