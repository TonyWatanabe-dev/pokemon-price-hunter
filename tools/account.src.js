// Conta do usuário (Firebase Auth + Firestore Lite). Empacotado em account.js por tools/build-account.mjs.
// A configuração abaixo é pública por natureza; quem protege os dados são as regras do Firestore
// (cada pessoa só lê e grava o próprio documento users/<uid>).
import { initializeApp } from 'firebase/app';
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, updateProfile, sendEmailVerification, sendPasswordResetEmail,
  signOut, deleteUser, reauthenticateWithPopup, reauthenticateWithCredential, EmailAuthProvider,
} from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore/lite';

// Login com Google por REDIRECIONAMENTO na mesma aba só nos endereços listados aqui. Nesses endereços o "authDomain" é o
// próprio site e /__/auth/* é repassado ao Firebase (vercel.json), então o fluxo não depende de cookies de terceiros.
// Um endereço só entra na lista depois de cadastrado em: Firebase > Authentication > Domínios autorizados, e
// Google Cloud > Credenciais > cliente OAuth > URIs de redirecionamento (https://<endereço>/__/auth/handler).
// Nos demais endereços continua o popup (comportamento atual).
const REDIRECT_HOSTS = ['tcg-price-hunter-git-fase-6c1-tonywatanabeart-1457s-projects.vercel.app'];
const host = typeof location !== 'undefined' ? location.hostname : '';
export const authMode = REDIRECT_HOSTS.includes(host) ? 'redirect' : 'popup';

const app = initializeApp({
  apiKey: 'AIzaSyCxiwO6ysxr-M-xwK0Rm1x1-51CJ0oNJs4',
  authDomain: authMode === 'redirect' ? host : 'tcg-price-hunter.firebaseapp.com',
  projectId: 'tcg-price-hunter',
  storageBucket: 'tcg-price-hunter.firebasestorage.app',
  messagingSenderId: '714998242983',
  appId: '1:714998242983:web:e77de0512f7550a93d4582',
});
const auth = getAuth(app);
auth.languageCode = 'pt';
const db = getFirestore(app);
const ref = (uid) => doc(db, 'users', uid);
const pub = (u) => u && ({
  uid: u.uid, email: u.email, name: u.displayName || '', photo: u.photoURL || '', verified: !!u.emailVerified,
  provider: u.providerData?.[0]?.providerId || 'password',
});
const back = () => ({ url: location.origin + '/' });
// Link de volta nos e-mails: se o endereço atual não estiver autorizado no Firebase, manda sem o link de volta
// em vez de falhar calado (antes o e-mail de confirmação simplesmente não saía).
const CONTINUE_ERR = new Set(['auth/unauthorized-continue-uri', 'auth/invalid-continue-uri', 'auth/missing-continue-uri']);
async function withBack(send) { try { await send(back()); } catch (e) { if (!CONTINUE_ERR.has(e?.code)) throw e; await send(undefined); } }

// Já ao carregar o módulo: no modo redirect, recebe o resultado da volta do Google; no modo popup, deixa o canal do
// Firebase pronto antes do clique, para a janela do Google abrir no mesmo clique (sem espera que a jogue para trás
// ou faça o navegador bloquear).
const redirectOutcome = getRedirectResult(auth).then((r) => ({ user: pub(r?.user) || null }), (e) => ({ error: { code: e?.code || 'auth/internal-error', message: e?.message || '' } }));
export function redirectResult() { return redirectOutcome; }

export function watch(cb) { return onAuthStateChanged(auth, (u) => cb(pub(u))); }
export async function google() {
  const p = new GoogleAuthProvider(); p.setCustomParameters({ prompt: 'select_account' });
  if (authMode === 'redirect') { await signInWithRedirect(auth, p); return null; }   // a página segue para o Google
  return pub((await signInWithPopup(auth, p)).user);
}
export async function emailIn(email, pw) { return pub((await signInWithEmailAndPassword(auth, email, pw)).user); }
export async function emailUp(email, pw, name) {
  const { user } = await createUserWithEmailAndPassword(auth, email, pw);
  if (name) { try { await updateProfile(user, { displayName: name }); } catch { /* nome é opcional; a conta já existe */ } }
  let verifyError = null;
  try { await withBack((s) => sendEmailVerification(user, s)); } catch (e) { verifyError = e?.code || 'auth/internal-error'; }
  return { ...pub(user), verifyError };
}
export async function resend() { const u = auth.currentUser; if (u) await withBack((s) => sendEmailVerification(u, s)); }
export async function reload() { if (auth.currentUser) { await auth.currentUser.reload(); return pub(auth.currentUser); } return null; }
export async function reset(email) { await withBack((s) => sendPasswordResetEmail(auth, email, s)); }
export async function out() { await signOut(auth); }
export async function load() {
  const u = auth.currentUser; if (!u) return null;
  const s = await getDoc(ref(u.uid)); return s.exists() ? s.data() : null;
}
export async function save(patch) {
  const u = auth.currentUser; if (!u) throw Object.assign(new Error('sem login'), { code: 'auth/no-user' });
  await setDoc(ref(u.uid), { ...patch, updatedAt: new Date().toISOString() }, { merge: true });
}
// Exclusão da conta, em ordem segura: falha em qualquer passo NUNCA deixa conta excluída com dados guardados.
// 1) Confirma a identidade ANTES de apagar qualquer coisa. O Firebase pode exigir login recente para excluir a conta e
//    não há como saber sem tentar a exclusão; por isso confirma sempre: Google por popup (primeira chamada, ainda no
//    clique, sem ser bloqueada) e senha com a senha digitada. Conta com senha sem senha digitada: não começa (erro
//    auth/requires-recent-login, nada apagado).
// 2) Apaga users/<uid> (depois de excluir a conta não há mais permissão para apagar). Se falhar, para aqui: a conta NÃO
//    é excluída e o erro sobe para a página, que deixa tentar de novo. Documento já inexistente conta como sucesso.
// 3) Só então exclui a conta no Auth. Se falhar aqui, o documento já não existe (erro com docDeleted = true) e a
//    próxima tentativa conclui sem perda: o robô só grava com pré-condição de documento existente, nunca o recria.
async function confirmIdentity(u, password) {
  const provider = pub(u).provider;
  if (provider === 'google.com') await reauthenticateWithPopup(u, new GoogleAuthProvider());
  else if (provider === 'password') {
    if (!password) throw Object.assign(new Error('senha necessária para excluir'), { code: 'auth/requires-recent-login' });
    await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, password));
  }
}
export async function wipe(password) {
  const u = auth.currentUser; if (!u) return;
  await confirmIdentity(u, password);
  try { await deleteDoc(ref(u.uid)); } catch (e) { if (e?.code !== 'not-found') throw e; }
  try { await deleteUser(u); } catch (e) { if (e && typeof e === 'object') e.docDeleted = true; throw e; }
}
