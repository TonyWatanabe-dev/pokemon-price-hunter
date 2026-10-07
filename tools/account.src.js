// Conta do usuário (Firebase Auth + Firestore Lite). Empacotado em account.js por tools/build-account.mjs.
// A configuração abaixo é pública por natureza; quem protege os dados são as regras do Firestore
// (cada pessoa só lê e grava o próprio documento users/<uid>).
import { initializeApp } from 'firebase/app';
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, updateProfile, sendEmailVerification, sendPasswordResetEmail,
  signOut, deleteUser, reauthenticateWithPopup, reauthenticateWithCredential, EmailAuthProvider,
} from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore/lite';

const app = initializeApp({
  apiKey: 'AIzaSyCxiwO6ysxr-M-xwK0Rm1x1-51CJ0oNJs4',
  authDomain: 'tcg-price-hunter.firebaseapp.com',
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

export function watch(cb) { return onAuthStateChanged(auth, (u) => cb(pub(u))); }
export async function google() {
  const p = new GoogleAuthProvider(); p.setCustomParameters({ prompt: 'select_account' });
  return pub((await signInWithPopup(auth, p)).user);
}
export async function emailIn(email, pw) { return pub((await signInWithEmailAndPassword(auth, email, pw)).user); }
export async function emailUp(email, pw, name) {
  const { user } = await createUserWithEmailAndPassword(auth, email, pw);
  if (name) await updateProfile(user, { displayName: name });
  try { await sendEmailVerification(user, back()); } catch { /* reenviar depois */ }
  return pub(user);
}
export async function resend() { if (auth.currentUser) await sendEmailVerification(auth.currentUser, back()); }
export async function reload() { if (auth.currentUser) { await auth.currentUser.reload(); return pub(auth.currentUser); } return null; }
export async function reset(email) { await sendPasswordResetEmail(auth, email, back()); }
export async function out() { await signOut(auth); }
export async function load() {
  const u = auth.currentUser; if (!u) return null;
  const s = await getDoc(ref(u.uid)); return s.exists() ? s.data() : null;
}
export async function save(patch) {
  const u = auth.currentUser; if (!u) throw Object.assign(new Error('sem login'), { code: 'auth/no-user' });
  await setDoc(ref(u.uid), { ...patch, updatedAt: new Date().toISOString() }, { merge: true });
}
// Exclui os dados e a conta. Se o login for antigo, o Firebase pede para confirmar de novo.
export async function remove(password) {
  const u = auth.currentUser; if (!u) return;
  try { await deleteUser(u); }
  catch (e) {
    if (e.code !== 'auth/requires-recent-login') throw e;
    if (pub(u).provider === 'google.com') await reauthenticateWithPopup(u, new GoogleAuthProvider());
    else { if (!password) throw e; await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, password)); }
    await deleteDoc(ref(u.uid));
    await deleteUser(u);
    return;
  }
}
// Apaga o documento antes da conta (depois de excluir a conta não há mais permissão para apagar).
export async function wipe(password) {
  const u = auth.currentUser; if (!u) return;
  try { await deleteDoc(ref(u.uid)); } catch { /* sem documento */ }
  await remove(password);
}
