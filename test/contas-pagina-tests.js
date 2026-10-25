// Contas, favoritos e alertas na página (index.html, só leitura): roda trechos reais num sandbox, com o módulo de conta
// simulado. Sem rede, sem Firebase real. Complementa test/account-page-tests.js (perfil, remover favorito, rollback) com:
// mensagens de erro do login, validação do formulário, recuperação de senha sem revelar se a conta existe, exclusão,
// limites (200 favoritos / 50 alertas), valor do alerta, contador c-hit e aviso "chegou no seu preço", lista de alertas,
// política de privacidade x dados gravados e regras do Firestore (só o dono).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const html = read('index.html');
const cut = (a, b) => { const i = html.indexOf(a); const j = html.indexOf(b, i + a.length); assert.ok(i > 0 && j > i, `trecho ${a}`); return html.slice(i, j); };
const errCode = cut('const AERR=', 'const favs=()=>');
const accData = cut('const favs=()=>', 'const authPending=');
const submitAccCode = cut('function focusErr(){', 'async function submitDel(');
const submitDelCode = cut('async function submitDel(f){', 'async function saveField(');
const delEnterCode = cut('function delEnter(', 'function delStorage(');
const accSrc = read('tools/account.src.js');
const saveCode = cut('async function saveField(', 'function favBtn(');
const setBusyCode = cut('function setBusy(b,on,txt){', '/* Favoritos (perfil)');
const accSyncCode = cut('function accSync(', 'function syncFavButtons(');
const renderAlertsCode = cut('function renderAlerts(){', 'function renderConfig(){');
const renderConfigCode = cut('function renderConfig(){', 'const BASE_TITLE=');
const privacidade = cut('privacidade:`<h2>Política de privacidade</h2>', '`};');

let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };
const err = (c, message = '') => Object.assign(new Error(message || c), { code: c });
const money = (v) => 'R$ ' + Number(v).toFixed(2).replace('.', ',');

function base(extra = {}) {
  const ctx = {
    ACC: { mod: null, user: null, data: null, ready: true, tab: 'up', step: 'form', gate: null, err: null, errField: null, form: {}, ok: null, told: false },
    toasts: [], tracks: [], renders: 0, gone: [],
    toast(m) { ctx.toasts.push(m); }, track(...a) { ctx.tracks.push(a); }, render() { ctx.renders++; }, go(v) { ctx.gone.push(v); },
    renderGate() {}, accSync() {}, syncFavButtons() {}, pulse() {}, $: () => null, document: { querySelector: () => null, querySelectorAll: () => [] },
    console: { warn() {} }, Date, Promise, Object, Set, Number, String, Math, structuredClone, view: '', PRIVATE: ['conta', 'favoritos', 'alertas', 'configuracoes'],
    OFF: [], S: null, live: (o) => o.stock === 'IN_STOCK' && !o.stale && !o.anomalous && o.total > 0, afPref: () => 0, freshState: () => ({ status: 'atual' }),
    ...extra,
  };
  vm.createContext(ctx);
  vm.runInContext(errCode + accData + setBusyCode + ';Object.assign(this,{AERR,AFIELD,aerr,pwPolicy,favs,alertsL,isFav,alertOf,bestLive,hits});', ctx);
  return ctx;
}
const btn = () => { const b = { disabled: false, attrs: {}, innerHTML: 'x', setAttribute(k, v) { b.attrs[k] = v; }, removeAttribute(k) { delete b.attrs[k]; } }; return b; };

// ------------------------------------------------------------------ mensagens de erro do login
await t('aerr: cancelar o Google é silencioso; códigos conhecidos em português; desconhecido mostra o código limpo', async () => {
  const c = base();
  for (const k of ['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled', 'auth/redirect-cancelled-by-user']) assert.equal(c.aerr(err(k)), '', k);
  assert.equal(c.aerr(err('auth/invalid-credential')), 'E-mail ou senha incorretos.');
  assert.equal(c.aerr(err('auth/user-not-found')), c.aerr(err('auth/wrong-password')), 'não revela se o e-mail tem conta');
  assert.match(c.aerr(err('auth/network-request-failed')), /Sem conexão/);
  assert.match(c.aerr(err('auth/too-many-requests')), /Espere alguns minutos/);
  assert.equal(c.aerr(err('auth/requests-from-referer-https://x')), c.AERR['auth/requests-from-referer']);
  const u = c.aerr(err('auth/novo"<img src=x>' + 'a'.repeat(80)));
  assert.match(u, /^Não foi possível concluir agora\. Tente de novo em instantes\. \(código: auth\/novoimgsrcx/);
  assert.doesNotMatch(u, /[<>"=]/, 'código sem HTML'); assert.ok(u.match(/código: ([^)]*)\)/)[1].length <= 60);
  assert.doesNotMatch(c.aerr(new Error('x')), /código/, 'sem código, sem parênteses vazios');
  assert.doesNotMatch(c.aerr(null), /código/);
});

await t('política de senha do Firebase traduzida; mensagem desconhecida cai num texto útil', async () => {
  const c = base();
  const m = c.aerr(err('auth/password-does-not-meet-requirements', 'Firebase: Missing password requirements: [Password must contain at least 8 characters, Password must contain an upper case character, Password must contain a numeric character, Password must contain a non-alphanumeric character] (auth/password-does-not-meet-requirements).'));
  assert.equal(m, 'A senha precisa ter pelo menos 8 caracteres, uma letra maiúscula, um número, um símbolo (ex.: ! ? #).');
  assert.match(c.aerr(err('auth/password-does-not-meet-requirements', 'sem lista')), /não atende às regras de segurança/);
});

// ------------------------------------------------------------------ formulário de cadastro, login e recuperação
function form(c, tab, fields) {
  const b = btn(); c.ACC.tab = tab;
  c.FormData = function () { return Object.entries(fields); };
  return { b, f: { querySelector: () => b } };
}
function accSandbox(mod) { const c = base(); c.ACC.mod = mod; vm.runInContext(submitAccCode, c); return c; }
const okMod = () => { const calls = []; return { calls, emailIn: async (...a) => { calls.push(['in', ...a]); }, emailUp: async (...a) => { calls.push(['up', ...a]); return { verified: false, verifyError: null }; }, reset: async (...a) => { calls.push(['reset', ...a]); } }; };

await t('validação local: e-mail vazio/inválido, senha vazia/curta e termos — sem chamar o Firebase, erro colado no campo', async () => {
  const cases = [
    ['in', { email: '', pw: 'senha1' }, 'Digite seu e-mail.', 'email'],
    ['in', { email: 'semarroba.com', pw: 'senha1' }, /não parece válido/, 'email'],
    ['in', { email: 'a@b', pw: 'senha1' }, /não parece válido/, 'email'],
    ['in', { email: 'a@b.c', pw: '' }, 'Digite a senha.', 'pw'],
    ['up', { email: 'a@b.c', pw: '12345', terms: 'on' }, 'A senha precisa ter pelo menos 6 caracteres.', 'pw'],
    ['up', { email: 'a@b.c', pw: '123456' }, /aceite os Termos e a Privacidade/, 'terms'],
  ];
  for (const [tab, fields, msg, field] of cases) {
    const mod = okMod(); const c = accSandbox(mod); const { f } = form(c, tab, fields);
    await c.submitAcc(f);
    if (msg instanceof RegExp) assert.match(c.ACC.err, msg); else assert.equal(c.ACC.err, msg);
    assert.equal(c.ACC.errField, field); assert.equal(mod.calls.length, 0, JSON.stringify(fields));
    assert.equal(c.ACC.form.pw, undefined, 'a senha nunca volta preenchida');
  }
});

await t('recuperar senha: não pede senha, mensagem neutra (não diz se a conta existe) e volta para "Entrar"', async () => {
  const mod = okMod(); const c = accSandbox(mod); const { f } = form(c, 'reset', { email: '  a@b.c ' });
  await c.submitAcc(f);
  assert.deepEqual(mod.calls, [['reset', 'a@b.c']]);
  assert.equal(c.ACC.err, null); assert.match(c.ACC.ok, /^Se houver conta com esse e-mail/); assert.match(c.ACC.ok, /spam/);
  assert.equal(c.ACC.tab, 'in');
  const m2 = { reset: async () => { throw err('auth/network-request-failed'); } }; const c2 = accSandbox(m2); const x = form(c2, 'reset', { email: 'a@b.c' });
  await c2.submitAcc(x.f); assert.match(c2.ACC.err, /Sem conexão/); assert.equal(c2.ACC.ok, null); assert.equal(x.b.disabled, false, 'botão liberado');
});

await t('login e cadastro: erro do Firebase vira mensagem no campo certo; cadastro avisa para confirmar o e-mail', async () => {
  const c = accSandbox({ emailIn: async () => { throw err('auth/invalid-credential'); } }); const a = form(c, 'in', { email: 'a@b.c', pw: 'errada' });
  await c.submitAcc(a.f); assert.equal(c.ACC.err, 'E-mail ou senha incorretos.'); assert.equal(c.ACC.errField, null);
  const d = accSandbox({ emailUp: async () => { throw err('auth/email-already-in-use'); } }); const b = form(d, 'up', { email: 'a@b.c', pw: '123456', terms: 'on' });
  await d.submitAcc(b.f); assert.match(d.ACC.err, /Já existe uma conta/); assert.equal(d.ACC.errField, 'email'); assert.equal(d.ACC.signupName, '');
  const mod = okMod(); const e = accSandbox(mod); const g = form(e, 'up', { email: 'a@b.c', pw: '123456', terms: 'on', name: '  ' + 'N'.repeat(70) });
  await e.submitAcc(g.f);
  assert.equal(mod.calls[0][3].length, 60, 'nome cortado em 60');
  assert.ok(e.toasts.some((m) => /Confirme seu e-mail/.test(m)));
  assert.equal(JSON.stringify(e.tracks[0]), JSON.stringify(['signup_completed', { method: 'email' }]));
  const h = accSandbox({ emailUp: async () => ({ verified: false, verifyError: 'auth/too-many-requests' }) }); const k = form(h, 'up', { email: 'a@b.c', pw: '123456', terms: 'on' });
  await h.submitAcc(k.f); assert.ok(h.toasts.some((m) => /e-mail de confirmação não saiu agora\. Reenvie em Minha conta/.test(m)));
});

// ------------------------------------------------------------------ exclusão
// #932/#937: a página chama m.excluir(senha) (que grava a marca de exclusão e chama wipe) e só diz "excluída" quando o
// módulo devolve true; exige ACC.user. Senha vazia vira undefined dentro do módulo (excluir → wipe(password || undefined)),
// não mais na página: a asserção "senha vazia vai como undefined" foi para o código do módulo (ver abaixo).
const USER = { uid: 'u1', provider: 'password', providers: ['password'] };
function delSandbox(excluir, user = USER) {
  const c = base(); const calls = [];
  c.ACC.user = user; c.ACC.data = { favorites: ['a'] };
  c.ACC.mod = { excluir: async (pw) => { calls.push(pw); return excluir(pw); }, provs: (u) => (u.providers?.length ? u.providers : [u.provider]) };
  c.sessionStorage = { removeItem() {} };
  vm.runInContext(delEnterCode + submitDelCode, c); return { c, calls };
}
const delForm = (c, pw) => { const b = btn(); c.FormData = function () { return { get: () => pw }; }; return { b, f: { querySelector: () => b } }; };

await t('excluir: sucesso limpa os dados da memória, avisa e volta para a home; sem confirmação do módulo não diz "excluída"', async () => {
  const { c, calls } = delSandbox(async () => true); const { f } = delForm(c, 'senha1');
  await c.submitDel(f);
  assert.deepEqual(calls, ['senha1']); assert.equal(c.ACC.data, null); assert.deepEqual(c.toasts, ['Conta e dados excluídos']); assert.deepEqual(c.gone, ['']);
  const x = delSandbox(async () => undefined); const y = delForm(x.c, 'senha1'); await x.c.submitDel(y.f);
  assert.deepEqual(x.c.toasts, ['Por segurança, entre de novo para excluir a conta.']); assert.notEqual(x.c.ACC.data, null); assert.deepEqual(x.c.gone, []); assert.equal(y.b.disabled, false);
  const z = delSandbox(async () => true, null); await z.c.submitDel(delForm(z.c, 'senha1').f);
  assert.deepEqual(z.calls, [], 'sem usuário na página: nada é chamado'); assert.deepEqual(z.c.toasts, []);
  assert.match(accSrc, /ok = await wipe\(password \|\| undefined, password \? 'password' : 'google\.com'\)/, 'senha vazia vai ao wipe como undefined');
});

await t('excluir: login antigo sem senha, Google cancelado, rede e senha errada têm mensagem; botão volta; nada apagado', async () => {
  const run = async (e, pw, user) => { const { c, calls } = delSandbox(async () => { throw e; }, user); const { b, f } = delForm(c, pw); await c.submitDel(f); return { c, b, calls }; };
  let r = await run(err('auth/requires-recent-login'), '');
  assert.deepEqual(r.calls, [''], 'a página repassa a senha digitada; o módulo converte'); assert.deepEqual(r.c.toasts, ['Por segurança, digite sua senha para excluir.']); assert.equal(r.b.disabled, false);
  // #932: o texto do cancelamento passou a dizer o que aconteceu ("Nada foi excluído") em vez de "Não foi possível excluir agora."
  r = await run(err('auth/popup-closed-by-user'), '', { uid: 'u1', provider: 'google.com', providers: ['google.com'] }); assert.deepEqual(r.c.toasts, ['Confirmação cancelada. Nada foi excluído.']); assert.equal(r.b.disabled, false);
  r = await run(err('auth/requires-recent-login'), '', { uid: 'u1', provider: 'google.com', providers: ['google.com'] }); assert.deepEqual(r.c.toasts, ['Por segurança, entre de novo para excluir a conta.'], 'conta só Google: não pede senha');
  r = await run(err('auth/network-request-failed'), 'x'); assert.match(r.c.toasts[0], /Sem conexão/); assert.equal(r.b.disabled, false);
  r = await run(err('auth/invalid-credential'), 'errada'); assert.equal(r.c.toasts[0], 'E-mail ou senha incorretos.');
  assert.notEqual(r.c.ACC.data, null); assert.deepEqual(r.c.gone, []); assert.equal(r.c.ACC.del, undefined);
  // documento apagado e login não (exclusão parcial): pendente, dados fora da memória, nunca "excluída"
  r = await run(Object.assign(err('auth/network-request-failed'), { docDeleted: true }), 'x');
  assert.equal(r.c.ACC.del.why, 'pendente'); assert.equal(r.c.ACC.data, null); assert.deepEqual(r.c.gone, []);
  assert.deepEqual(r.c.toasts, ['Seus dados foram apagados, mas a conta ainda não. Confirme para concluir.']); assert.match(r.c.ACC.del.err, /Sem conexão/);
});

// ------------------------------------------------------------------ favoritos e alertas: limites e valor
function saveSandbox(data, extra = {}) {
  const saves = [];
  const c = base({ ...extra });
  c.ACC.user = { uid: 'u1' }; c.ACC.data = structuredClone(data);
  c.ACC.mod = { save: async (p) => { saves.push(structuredClone(p)); }, mark: () => null };
  vm.runInContext(saveCode + ';this.saveAlerts=saveAlerts;this.toggleFav=toggleFav;', c);
  return { c, saves };
}

await t('limite de 200 favoritos: o 201º não grava e avisa; remover continua possível', async () => {
  const favorites = Array.from({ length: 200 }, (_, i) => 'p' + i);
  const { c, saves } = saveSandbox({ favorites, alerts: [] });
  await c.setFav('novo', true); assert.equal(saves.length, 0); assert.deepEqual(c.toasts, ['Limite de 200 favoritos']);
  await c.setFav('p0', false); assert.equal(saves[0].favorites.length, 199);
});

await t('limite de 50 alertas: alerta novo bloqueado; atualizar um existente substitui (sem duplicar) e grava {p,v,at}', async () => {
  const alerts = Array.from({ length: 50 }, (_, i) => ({ p: 'p' + i, v: 10, at: 't' }));
  const { c, saves } = saveSandbox({ favorites: [], alerts });
  await c.setAlert('novo', 99); assert.equal(saves.length, 0); assert.deepEqual(c.toasts, ['Limite de 50 alertas']);
  await c.setAlert('p3', 77.5);
  assert.equal(saves.length, 1); assert.deepEqual(Object.keys(saves[0]), ['alerts']);
  const l = saves[0].alerts; assert.equal(l.length, 50); assert.equal(l.filter((a) => a.p === 'p3').length, 1);
  const a = l.find((x) => x.p === 'p3'); assert.equal(a.v, 77.5); assert.match(a.at, /^\d{4}-\d\d-\d\dT/); assert.deepEqual(Object.keys(a), ['p', 'v', 'at']);
  assert.equal(c.toasts.at(-1), 'Alerta criado');
});

await t('remover alerta pelo produto grava a lista sem ele; falha mantém a lista e avisa', async () => {
  const { c, saves } = saveSandbox({ favorites: [], alerts: [{ p: 'a', v: 1 }, { p: 'b', v: 2 }] });
  await c.saveAlerts(c.alertsL().filter((x) => x.p !== 'a')); assert.deepEqual(saves[0].alerts, [{ p: 'b', v: 2 }]);
  c.ACC.mod.save = async () => { throw err('unavailable'); };
  await assert.rejects(c.saveAlerts([])); assert.deepEqual(c.ACC.data.alerts, [{ p: 'b', v: 2 }]); assert.match(c.toasts.at(-1), /Sem conexão/);
});

await t('valor do alerta: aceita vírgula e arredonda centavos; recusa vazio, zero, negativo, texto e >= R$ 100.000', async () => {
  const { c } = saveSandbox({ favorites: [], alerts: [] });
  const gates = []; c.authGate = async (a) => { gates.push(a); };
  const send = async (v) => { c.FormData = function () { return { get: () => v }; }; const b = btn(); await c.submitAlert({ dataset: { pid: 'p1' }, querySelector: (q) => (q === '[type=submit]' ? b : { focus() {} }) }); };
  await send('199,90'); await send('10.005'); await send('99999.99');
  assert.deepEqual(gates.map((g) => g.v), [199.9, 10.01, 99999.99]); assert.equal(gates[0].type, 'alert'); assert.equal(gates[0].pid, 'p1');
  for (const v of ['', '0', '-5', 'abc', '100000', '0,001']) { gates.length = 0; c.toasts.length = 0; await send(v); assert.equal(gates.length, 0, v); assert.deepEqual(c.toasts, ['Digite um valor em reais'], v); }
});

// ------------------------------------------------------------------ "chegou no seu preço": contador c-hit e aviso
function syncSandbox({ alerts, offers, user = { uid: 'u1', email: 'a@b.c' }, S = {} }) {
  const els = [{ hidden: true, textContent: '' }, { hidden: true, textContent: '' }];
  const c = base({ OFF: offers, S, store: { get: () => false }, safeUrl: (x) => x, esc: (x) => String(x), ic: () => '', render() {}, refreshProdTools() {}, authPending: () => false });
  c.ACC.user = user; c.ACC.data = { alerts };
  c.document = { querySelectorAll: (s) => (s === '.c-hit' ? els : []), querySelector: () => null };
  c.$ = () => ({ open: false, dataset: {} });
  vm.runInContext(accSyncCode + 'function syncFavButtons(){}', c);
  return { c, els };
}
const off = (id, productId, total, more = {}) => ({ id, productId, total, stock: 'IN_STOCK', ...more });

await t('c-hit conta só alertas com oferta viva (estoque, não velha, não anômala) no alvo ou abaixo', async () => {
  const alerts = [{ p: 'a', v: 100 }, { p: 'b', v: 50 }, { p: 'c', v: 80 }, { p: 'd', v: 80 }, { p: 'e', v: 80 }, { p: 'f', v: 30 }];
  const offers = [off(1, 'a', 100), off(2, 'b', 60), off(3, 'c', 70, { stale: true }), off(4, 'd', 10, { anomalous: true }), off(5, 'e', 70, { stock: 'OUT_OF_STOCK' }), off(6, 'f', 31), off(7, 'f', 29.99)];
  const { c, els } = syncSandbox({ alerts, offers });
  assert.deepEqual(c.hits().map((h) => h.a.p), ['a', 'f'], 'igual ao alvo conta; usa a melhor oferta viva');
  c.accSync();
  for (const el of els) { assert.equal(el.hidden, false); assert.equal(el.textContent, 2); }
  assert.deepEqual(c.toasts, ['2 alertas chegaram no seu preço']);
  c.accSync(); c.accSync(); assert.equal(c.toasts.length, 1, 'aviso uma vez por visita');
});

await t('c-hit: singular, escondido com zero, sem login ou antes dos dados carregarem', async () => {
  let s = syncSandbox({ alerts: [{ p: 'a', v: 100 }], offers: [off(1, 'a', 90)] }); s.c.accSync(); assert.deepEqual(s.c.toasts, ['Um alerta chegou no seu preço']);
  s = syncSandbox({ alerts: [{ p: 'a', v: 100 }], offers: [off(1, 'a', 120)] }); s.c.accSync(); assert.ok(s.els.every((e) => e.hidden)); assert.deepEqual(s.c.toasts, []);
  s = syncSandbox({ alerts: [{ p: 'a', v: 100 }], offers: [off(1, 'a', 90)], user: null }); s.c.accSync(); assert.ok(s.els.every((e) => e.hidden)); assert.deepEqual(s.c.toasts, []);
  s = syncSandbox({ alerts: [{ p: 'a', v: 100 }], offers: [off(1, 'a', 90)], S: null }); s.c.accSync(); assert.ok(s.els.every((e) => e.hidden));
});

// ------------------------------------------------------------------ página de alertas
await t('lista de alertas: vazia convida a criar; atingidos primeiro; "Faltam" e "Sem estoque"; produto fora do catálogo some', async () => {
  const P = { a: { id: 'a' }, b: { id: 'b' }, c: { id: 'c' } };
  const c = base({ P, money, ic: (x) => `[${x}]`, esc: String, tgBox: () => '<TG>', privateGate: (t) => `GATE:${t}`, out: '' });
  c.$ = () => ({ set innerHTML(v) { c.out = v; } });
  const rows = []; c.prodRow = (id, extra) => { rows.push(id); return `<row ${id}>${extra}</row>`; };
  vm.runInContext(renderAlertsCode, c);
  c.renderAlerts(); assert.equal(c.out, 'GATE:Alertas de preço');
  c.ACC.user = { uid: 'u' }; c.ACC.loadFailed = true; c.renderAlerts(); assert.match(c.out, /Não consegui carregar seus alertas/); assert.doesNotMatch(c.out, /Nenhum alerta/);
  c.ACC.loadFailed = false; c.ACC.data = { alerts: [] }; c.renderAlerts();
  assert.match(c.out, /Nenhum alerta ainda\./); assert.match(c.out, /Me avise quando baixar/); assert.match(c.out, /<TG>/, 'bloco do Telegram também no estado vazio');
  c.ACC.data = { alerts: [{ p: 'b', v: 50 }, { p: 'c', v: 10 }, { p: 'sumiu', v: 1 }, { p: 'a', v: 100 }] };
  c.OFF = [off(1, 'a', 95), off(2, 'b', 60)];
  rows.length = 0; c.renderAlerts();
  assert.deepEqual(rows, ['a', 'b', 'c']);
  assert.match(c.out, /1 de 3 já chegou no seu preço/);
  assert.match(c.out, /<row a>.*No seu preço/); assert.match(c.out, /<row b>.*Faltam R\$ 10,00/); assert.match(c.out, /<row c>.*Sem estoque/);
});

// ------------------------------------------------------------------ privacidade x dados guardados
await t('política de privacidade, configurações e /privacidade (SSR) descrevem os dados que o site grava e a exclusão', async () => {
  const rules = read('firebase/firestore.rules');
  const fields = JSON.parse(rules.match(/hasOnly\((\[[^\]]+\])\)/)[1].replace(/'/g, '"'));
  // cada campo que a conta pode gravar e a frase que o explica na política (createdAt/updatedAt/telegramPedido: ver relatório T-B)
  const explica = { name: /nome ou apelido/, favorites: /produtos favoritados/, alerts: /preços-alvo dos seus alertas/, termsAt: /data em que aceitou estes termos/, telegram: /número da conversa com o nosso bot e o registro dos avisos enviados/ };
  for (const f of Object.keys(explica)) { assert.ok(fields.includes(f), `campo ${f} nas regras`); assert.match(privacidade, explica[f], f); }
  assert.match(privacidade, /e-mail/); assert.match(privacidade, /foto do perfil quando você entra com Google/);
  assert.match(privacidade, /a conta, os favoritos e os alertas são apagados na hora, sem volta/);
  assert.match(privacidade, /apagados quando você desliga ou exclui a conta/);
  assert.match(renderConfigCode, /Guardamos nome, e-mail, favoritos e alertas \(e, se você ligar os alertas no Telegram, o número da conversa com o bot\)/);
  assert.match(renderConfigCode, /Apaga sua conta, favoritos e alertas na hora/);
  assert.match(renderConfigCode, /data-go="privacidade"/);
  assert.match(html, /Guardamos só nome, e-mail e o que você salvar\./, 'aviso no login');
  const ssr = read('api/pagina.mjs');
  assert.match(ssr, /com conta, guarda e-mail, nome, favoritos e alertas no Firebase, e a exclusão da conta apaga tudo na hora/);
  assert.match(privacidade, /E-mails<\/b>?[^]*?confirmação de e-mail e troca de senha/);
});

// #932/#937: o formulário de exclusão saiu do index.html para o módulo (delForm em tools/account.src.js, só carrega
// para quem entrou). Conta com senha e Google pode deixar a senha em branco para confirmar pelo Google; por isso o
// campo deixa de ser obrigatório só nesse caso. Mesma proteção, agora executando o código real.
await t('senha de exclusão só para conta com senha; Google reautentica pelo popup', async () => {
  assert.match(renderConfigCode, /\$\{ACC\.mod\.delForm\(u,"Excluir conta e dados",ic\("trash"\)\)\}/);
  const i = accSrc.indexOf('const esc = (s) =>'); const j = accSrc.indexOf('// Painel que substitui', i); assert.ok(i > 0 && j > i, 'delForm no módulo');
  const m = vm.createContext({ String }); vm.runInContext(accSrc.slice(i, j).replace(/^export /gm, '') + ';this.delForm=delForm;', m);
  const pw = m.delForm({ provider: 'password', providers: ['password'] }, 'Excluir conta e dados');
  assert.match(pw, /<label for="d-pw">Confirme sua senha<\/label><input id="d-pw" name="pw" type="password" autocomplete="current-password" required>/);
  const g = m.delForm({ provider: 'google.com', providers: ['google.com'] }, 'Excluir conta e dados');
  assert.doesNotMatch(g, /d-pw|type="password"/, 'conta Google: sem campo de senha');
  const ambos = m.delForm({ provider: 'password', providers: ['password', 'google.com'] }, 'Excluir conta e dados');
  assert.match(ambos, /Confirme sua senha \(em branco: Google\)<\/label><input id="d-pw"[^>]*type="password"[^>]*>/); assert.doesNotMatch(ambos, /required/);
  for (const h of [pw, g, ambos]) assert.match(h, /Excluir conta e dados/);
});

// ------------------------------------------------------------------ regras do Firestore: só o dono
await t('regras: toda permissão de users/{uid} exige login e uid igual; o resto é negado; nada aberto', async () => {
  const code = read('firebase/firestore.rules').replace(/\/\/[^\n]*/g, '');
  const allows = [...code.matchAll(/allow\s+([a-z, ]+):\s*if\s+([^;]+);/g)].map((m) => ({ ops: m[1].split(',').map((s) => s.trim()), cond: m[2].replace(/\s+/g, ' ') }));
  assert.equal(allows.length, 3);
  const users = allows.filter((a) => !/^false$/.test(a.cond.trim()));
  assert.deepEqual(users.flatMap((a) => a.ops).sort(), ['create', 'delete', 'read', 'update']);
  for (const a of users) assert.ok(a.cond.startsWith('request.auth != null && request.auth.uid == uid'), a.cond);
  assert.deepEqual(allows.find((a) => a.cond.trim() === 'false').ops, ['read', 'write']);
  assert.doesNotMatch(code, /if\s+true\b/); assert.doesNotMatch(code, /allow\s+list\b/);
  const matches = [...code.matchAll(/match\s+(\S+)\s*\{/g)].map((m) => m[1]);
  assert.deepEqual(matches, ['/databases/{database}/documents', '/users/{uid}', '/{document=**}']);
});

await t('robô (conta de serviço): toda gravação em users/{uid} tem pré-condição — não recria conta excluída', async () => {
  const fr = await import('../src/firestore-rest.js');
  const crypto = await import('node:crypto');
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const sa = fr.parseServiceAccount(JSON.stringify({ client_email: 'r@demo.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), project_id: 'demo-tcgph' }));
  const urls = [];
  const fetch = async (url, init) => { urls.push({ url, init }); if (url === fr.TOKEN_URI) return new Response(JSON.stringify({ access_token: 'tk', expires_in: 3600 })); return new Response(JSON.stringify({ updateTime: 'U' })); };
  const c = fr.firestoreClient({ serviceAccount: sa, fetch });
  await c.patchUser('A', {}, ['telegram']);
  const u = new URL(urls.at(-1).url);
  assert.equal(urls.at(-1).init.method, 'PATCH'); assert.equal(u.searchParams.get('currentDocument.exists'), 'true');
  assert.equal(u.searchParams.get('currentDocument.updateTime'), null);
  assert.ok(urls.every((x) => /^https:\/\/(oauth2|firestore)\.googleapis\.com\//.test(x.url)), 'só Google, nada real foi chamado (fetch simulado)');
});

console.log(`✓ Contas, favoritos e alertas (página): ${n} grupos de testes passaram`);
