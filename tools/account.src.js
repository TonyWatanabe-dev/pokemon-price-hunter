// Conta do usuário (Firebase Auth + Firestore Lite). Empacotado em account.js por tools/build-account.mjs.
// A configuração abaixo é pública por natureza; quem protege os dados são as regras do Firestore
// (cada pessoa só lê e grava o próprio documento users/<uid>).
import { initializeApp } from 'firebase/app';
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, updateProfile, sendEmailVerification, sendPasswordResetEmail,
  signOut, deleteUser, reauthenticateWithPopup, reauthenticateWithCredential, EmailAuthProvider,
} from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, runTransaction } from 'firebase/firestore/lite';

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
  // Todos os jeitos de entrar da conta (Google e senha podem coexistir) e as datas do Auth (ms; 0 = desconhecida): a
  // página usa para escolher como confirmar a exclusão e para não recriar sozinha o perfil de conta antiga sem documento.
  providers: (u.providerData || []).map((p) => p?.providerId).filter(Boolean),
  // nova = último login a menos de 2 min da criação (cadastro agora); sem datas, conta como nova.
  lastIn: Date.parse(u.metadata?.lastSignInTime || '') || 0,
  nova: !(Date.parse(u.metadata?.creationTime) < Date.parse(u.metadata?.lastSignInTime) - 120e3),
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

// Primeiro estado sem login = marcas de exclusão órfãs: conta excluída em outro aparelho é descartada pelo Firebase ao
// abrir a página (reload no início falha), então o uid nem chega aqui. Sem login a marca não protege nada (valem o
// updateDoc do save e a regra da conta antiga em delState); limpar só troca o painel de 'pendente' para 'ausente'.
export function watch(cb) { let i = 1; return onAuthStateChanged(auth, (u) => { if (i && !u) limparMarcas(); i = 0; cb(pub(u)); }); }
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
// Gravação: por padrão só ATUALIZA um documento que já existe (updateDoc; documento inexistente = erro not-found). Assim
// uma aba ou aparelho com dados antigos em memória não recria o documento de quem pediu a exclusão. Criar o perfil
// (setDoc com merge) só com criar = true, numa ação explícita da página (cadastro novo ou "continuar usando").
export async function save(patch, criar) {
  const u = auth.currentUser; if (!u) throw Object.assign(new Error('sem login'), { code: 'auth/no-user' });
  const data = { ...patch, updatedAt: new Date().toISOString() };
  if (criar === true) await setDoc(ref(u.uid), data, { merge: true });
  else await updateDoc(ref(u.uid), data);
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
// Conta com mais de um jeito de entrar (Google + senha): via escolhe ('password' ou 'google.com'); sem via, senha
// digitada usa a senha e, sem senha, o Google. Outro provedor (sem confirmação pelo site): só com login de até 5 min;
// senão requires-recent-login ANTES de apagar (antes apagava o documento e falhava sempre no deleteUser).
// Devolve true quando concluiu; sem usuário logado devolve undefined (a página não pode dizer "conta excluída").
async function confirmIdentity(u, password, via) {
  const p = pub(u); const has = (x) => (p.providers?.length ? p.providers : [p.provider]).includes(x);
  const use = via && has(via) ? via : password && has('password') ? 'password' : has('google.com') ? 'google.com' : p.provider;
  if (use === 'google.com') await reauthenticateWithPopup(u, new GoogleAuthProvider());
  else if (use === 'password') {
    if (!password) throw Object.assign(new Error('senha necessária para excluir'), { code: 'auth/requires-recent-login' });
    await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, password));
  } else if (!(Date.now() - (p.lastIn || 0) < 5 * 60e3)) throw Object.assign(new Error('entre de novo para excluir'), { code: 'auth/requires-recent-login' });
}
export async function wipe(password, via) {
  const u = auth.currentUser; if (!u) return;
  await confirmIdentity(u, password, via);
  try { await deleteDoc(ref(u.uid)); } catch (e) { if (e?.code !== 'not-found') throw e; }
  try { await deleteUser(u); } catch (e) { if (e && typeof e === 'object') e.docDeleted = true; throw e; }
  return true;
}

// ---- Exclusão pendente (a página só mostra; a regra fica aqui). Testes: test/exclusao-pendente-tests.js ----
// Marca local por conta, ph:del:<uid>: 'andamento' (clique em excluir, antes de tudo) → 'pendente' (documento apagado,
// login não). Só esses valores, nunca dado pessoal. As outras abas do navegador param de gravar já no 'andamento'
// (evento storage na página) e a recarga mostra o pendente. Storage bloqueado: valem o updateDoc do save e a regra da
// conta antiga em delState.
export function mark(uid, v) {
  const k = 'ph:del:' + uid;
  try { if (v === undefined) return localStorage.getItem(k); if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* sem storage */ }
  return null;
}
export function limparMarcas() {
  try { for (let i = localStorage.length; i--;) { const k = localStorage.key(i); if (k?.startsWith('ph:del:')) localStorage.removeItem(k); } } catch { /* sem storage */ }
}
// Estado ao entrar, com o documento lido (d = dados; null = não existe; undefined = falha ao ler). 'pendente' = há marca;
// 'ausente' = conta antiga (não acabou de ser criada) sem documento e sem marca: o perfil NÃO é recriado sozinho (outro
// aparelho depois de uma exclusão parcial); 'fim' = a conta já foi excluída (em outro aparelho): limpa a marca e encerra
// a sessão; '' = normal. Marca 'andamento' com documento presente (aba fechada no meio, ou falha antes de apagar) é limpa.
export async function delState(d) {
  const u = auth.currentUser; if (!u) return ''; const mk = mark(u.uid);
  if (mk === 'andamento' && d) return mark(u.uid, null) || '';
  const s = mk ? 'pendente' : d === null && !pub(u).nova ? 'ausente' : '';
  // Conta excluída: o SDK traduz o USER_NOT_FOUND do servidor em auth/user-token-expired (e já encerra a sessão); token
  // revogado com a conta viva dá o mesmo código: aí só se perde a marca (próximo login vê 'ausente', nunca recria sozinho).
  if (s && !d) try { await u.reload(); } catch (e) { if (/^auth\/user-(not-found|token-expired)$/.test(e?.code)) { mark(u.uid, null); await signOut(auth); return 'fim'; } }
  return s;
}
// Exclusão pedida na página: grava 'andamento' de forma síncrona (o popup do Google continua saindo no clique), troca
// por 'pendente' se o documento foi apagado e o login não, e limpa ao concluir (com o vínculo do Telegram da sessão)
// ou se falhou antes de apagar sem marca anterior. Senha digitada confirma pela senha; em branco, pelo Google.
export async function excluir(password) {
  const u = auth.currentUser; if (!u) return; const antes = mark(u.uid); if (!antes) mark(u.uid, 'andamento');
  let ok;
  try { ok = await wipe(password || undefined, password ? 'password' : 'google.com'); } catch (e) { if (e?.docDeleted) mark(u.uid, 'pendente'); else if (!antes) mark(u.uid, null); throw e; }
  if (ok === true) { mark(u.uid, null); try { sessionStorage.removeItem('ph:tg:' + u.uid); } catch { /* sem storage */ } } else if (!antes) mark(u.uid, null);
  return ok;
}
// "Continuar usando" / "Criar perfil": NUNCA apaga dados. Perfil completo existente (marca antiga e conta usada em outro
// aparelho, ou outra aba no meio de uma exclusão) = só devolve os dados, sem gravar; documento inexistente = cria o perfil
// vazio; documento parcial = completa sem perder favoritos e alertas. Transação: a gravação leva a pré-condição do que
// foi lido (não existe / mesma versão); se outra aba ou aparelho gravar no meio, o Firestore repete e relê.
export async function continuar(name) {
  const u = auth.currentUser; if (!u) throw Object.assign(new Error('sem login'), { code: 'auth/no-user' });
  const r = ref(u.uid); const now = new Date().toISOString();
  const d = await runTransaction(db, async (t) => {
    const s = await t.get(r); const x = s.exists() ? s.data() : {};
    if (x.createdAt) return x;
    const b = { ...x, name: x.name || name, favorites: x.favorites || [], alerts: x.alerts || [], termsAt: now, createdAt: now, updatedAt: now };
    t.set(r, b); return b;
  });
  mark(u.uid, null); return d;
}

// ---- Telas da exclusão: só servem a quem entrou, então ficam aqui (carregado à parte) e não pesam no index.html ----
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
export const provs = (u) => (u.providers?.length ? u.providers : [u.provider]);
// Formulário de exclusão: senha quando a conta tem senha (com Google também: em branco = confirmar pelo Google).
export function delForm(u, label, icon = '') {
  const v = provs(u), pw = v.includes('password'), g = v.includes('google.com');
  return `<form id="delf" class="delf" novalidate>${pw ? `<div class="field"><label for="d-pw">Confirme sua senha${g ? ' (em branco: Google)' : ''}</label><input id="d-pw" name="pw" type="password" autocomplete="current-password"${g ? '' : ' required'}></div>` : ''}<button class="btn danger" type="submit">${icon}${label}</button></form>`;
}
// Painel que substitui Minha conta, Favoritos, Alertas e Configurações enquanto d (estado da página) existir.
// 'ausente' (conta sem documento e sem pedido de exclusão neste navegador): texto neutro e "Criar perfil".
export function delPanel(d, u, icon) {
  const p = d.why !== 'ausente';
  return `<div class="stack" style="margin-top:16px"><section class="panel" id="delbox"><h2 tabindex="-1">${p ? 'Exclusão pendente: confirme para concluir' : 'Sua conta não tem dados salvos'}</h2>`
    + `<p role="status">${p ? (d.apagados ? 'Favoritos, alertas e perfil já foram apagados; falta excluir o login.' : 'A exclusão não terminou.') + ' Até lá, nada é salvo.' : 'Criar perfil? Ele começa sem favoritos e alertas.'}</p>`
    + (d.err ? `<p class="err" tabindex="-1" role="alert">${esc(d.err)}</p>` : '') + delForm(u, p ? 'Concluir a exclusão' : 'Excluir a conta', icon)
    + `<p><button type="button" data-a="del-continuar">${p ? 'Continuar usando a conta' : 'Criar perfil'}</button> (${p ? 'retoma o que ainda existir' : 'começa vazio'}; vale o aceite dos <a href="/termos" data-go="termos">Termos</a>)</p></section></div>`;
}
