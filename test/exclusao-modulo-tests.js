// Exclusão pendente no módulo de conta (tools/account.src.js: mark, delState, excluir, continuar, provs, delForm, delPanel)
// e prova de que o bundle servido (account.js, gerado por tools/build-account.mjs) faz EXATAMENTE o mesmo: as funções são
// extraídas do arquivo minificado, ligadas aos mesmos simuladores (Auth, Firestore com transação, localStorage,
// sessionStorage) e as duas implementações rodam a mesma bateria de cenários; o registro de chamadas e os resultados têm
// de ser idênticos. Comportamento na página (abas, painel, REV-A/REV-G): test/exclusao-pendente-tests.js.
// Sem rede, sem Firebase real.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const src = read('../tools/account.src.js');
const bundle = read('../account.js');
let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };
const err = (code) => Object.assign(new Error(code), { code });

// ---------- implementação 1: fonte (de mark até o fim) ----------
const iSrc = src.indexOf('export function mark(');
assert.ok(iSrc > 0, 'mark() não encontrada em account.src.js');
const srcCode = src.slice(iSrc).replace(/^export /gm, '');
assert.doesNotMatch(srcCode, /^\s*(import|export)\b/m);
const NOMES = ['mark', 'limparMarcas', 'delState', 'excluir', 'continuar', 'provs', 'delForm', 'delPanel'];

// ---------- implementação 2: bundle minificado ----------
const ex = Object.fromEntries([...bundle.slice(bundle.lastIndexOf('export{')).matchAll(/([\w$]+) as (\w+)/g)].map((m) => [m[2], m[1]]));
for (const k of [...NOMES, 'wipe']) assert.ok(ex[k], `${k} não exportada pelo bundle (account.js desatualizado? rode tools/build-account.mjs)`);
const rx = (s) => s.replace(/\$/g, '\\$');
function fnText(name) {
  const m = new RegExp(`(?:async )?function ${rx(name)}\\(`).exec(bundle); assert.ok(m, `função ${name} não encontrada no bundle`);
  let d = 0; for (let k = bundle.indexOf('{', m.index); k < bundle.length; k++) {
    if (bundle[k] === '{') d++; else if (bundle[k] === '}' && --d === 0) return bundle.slice(m.index, k + 1);
  }
  throw new Error('chaves desbalanceadas');
}
const T = Object.fromEntries(['mark', 'limparMarcas', 'delState', 'excluir', 'continuar', 'delForm', 'delPanel'].map((k) => [k, fnText(ex[k])]));
const pick = (txt, re, what) => { const m = txt.match(re); assert.ok(m, `forma inesperada de ${what} no bundle (ajuste o extrator se o build mudou): ${txt}`); return m; };
const [, bAuth] = pick(T.delState, /^async function [\w$]+\(\w\)\{let \w=([\w$]+)\.currentUser;/, 'delState');
const [, bPub] = pick(T.delState, /!([\w$]+)\(\w\)\.nova/, 'delState (pub)');
const [, bOut] = pick(T.delState, new RegExp(`await ([\\w$]+)\\(${rx(bAuth)}\\),"fim"`), 'delState (signOut)');
const [, bRef, bTx, bDb] = pick(T.continuar, /let \w=([\w$]+)\(\w\.uid\),\w=new Date\(\)\.toISOString\(\),\w=await ([\w$]+)\(([\w$]+),async/, 'continuar');
const [, bEsc] = pick(T.delPanel, /\$\{([\w$]+)\(\w\.err\)\}/, 'delPanel (esc)');
const iProvs = bundle.search(new RegExp(`[ ,]${rx(ex.provs)}=\\w=>\\w\\.providers\\?\\.length`)); assert.ok(iProvs > 0, 'provs não encontrada no bundle');
const varTxt = bundle.slice(bundle.lastIndexOf('var ', iProvs), bundle.indexOf(';', iProvs) + 1);
assert.ok(varTxt.startsWith(`var ${bEsc}=`), `esc e provs fora do lugar esperado no bundle: ${varTxt}`);
// nenhuma outra dependência: tudo o que as funções usam está ligado abaixo (senão ReferenceError na bateria)

// ---------- simuladores comuns ----------
function mundo() {
  const log = []; const ls = new Map(); const ss = new Map([['ph:tg:u1', 'x']]); const docs = new Map(); const ver = new Map(); const fail = {};
  const w = { log, ls, ss, docs, fail, user: null, wipeRes: [], beforeCommit: null };
  const bump = (k) => ver.set(k, (ver.get(k) || 0) + 1);
  w.put = (k, v) => { bump(k); if (v) docs.set(k, structuredClone(v)); else docs.delete(k); };
  w.deps = {
    auth: { get currentUser() { return w.user; } },
    pub: (u) => ({ nova: u.nova }),
    signOut: async (a) => { assert.equal(a, w.deps.auth); log.push('signOut'); w.user = null; },
    wipe: async (...a) => { log.push(['wipe', ...a]); const r = w.wipeRes.shift(); if (r instanceof Error) throw r; return r; },
    ref: (uid) => `users/${uid}`,
    db: 'DB',
    runTransaction: async (db, fn) => {
      assert.equal(db, 'DB');
      for (let i = 0; i < 5; i++) {
        const lidos = new Map(); const sets = [];
        const tx = {
          get: async (r) => { log.push(['get', r]); lidos.set(r, ver.get(r) || 0); const d = docs.get(r); return { exists: () => !!d, data: () => structuredClone(d) }; },
          set: (r, d) => { sets.push([r, structuredClone(d)]); },
        };
        const out = await fn(tx);
        if (w.beforeCommit) { const h = w.beforeCommit; w.beforeCommit = null; await h(); }
        if (sets.some(([r]) => (ver.get(r) || 0) !== lidos.get(r))) { log.push('retry'); continue; }
        for (const [r, d] of sets) { log.push(['set', r, d]); w.put(r, d); }
        return out;
      }
      throw err('aborted');
    },
    localStorage: {
      getItem: (k) => { if (fail.ls) throw new Error('bloqueado'); return ls.has(k) ? ls.get(k) : null; },
      setItem: (k, v) => { if (fail.ls) throw new Error('bloqueado'); log.push(['ls.set', k, v]); ls.set(k, String(v)); },
      removeItem: (k) => { if (fail.ls) throw new Error('bloqueado'); log.push(['ls.del', k]); ls.delete(k); },
      key: (i) => { if (fail.ls) throw new Error('bloqueado'); return [...ls.keys()][i] ?? null; },
      get length() { if (fail.ls) throw new Error('bloqueado'); return ls.size; },
    },
    sessionStorage: { removeItem: (k) => { log.push(['ss.del', k]); ss.delete(k); } },
  };
  return w;
}
const user = (o = {}) => ({ uid: 'u1', nova: false, reloadErr: null, async reload() { if (this.reloadErr) throw err(this.reloadErr); }, ...o });
const FixDate = class extends Date { toISOString() { return 'AGORA'; } };

function carregar(kind, w) {
  const d = w.deps; const ctx = { Object, Error, String, Date: FixDate, localStorage: d.localStorage, sessionStorage: d.sessionStorage };
  if (kind === 'fonte') {
    Object.assign(ctx, { auth: d.auth, pub: d.pub, signOut: d.signOut, wipe: d.wipe, ref: d.ref, runTransaction: d.runTransaction, db: d.db });
    vm.createContext(ctx); vm.runInContext(`${srcCode}\n;this.$m={${NOMES.join(',')}};`, ctx);
  } else {
    Object.assign(ctx, { [bAuth]: d.auth, [bPub]: d.pub, [bOut]: d.signOut, [ex.wipe]: d.wipe, [bRef]: d.ref, [bTx]: d.runTransaction, [bDb]: d.db });
    vm.createContext(ctx);
    vm.runInContext(`${varTxt}\n${Object.values(T).join('\n')}\n;this.$m={${NOMES.map((k) => `${k}:${ex[k]}`).join(',')}};`, ctx);
  }
  return ctx.$m;
}

// ---------- bateria (mesma para as duas implementações) ----------
const DOC = { name: 'Ana', favorites: ['p1'], alerts: [{ p: 'p2' }], termsAt: 't', createdAt: 'c' };
async function bateria(kind) {
  const out = [];
  const caso = async (nome, prep, run) => {
    const w = mundo(); prep?.(w); const m = carregar(kind, w); let r, e;
    try { r = await run(m, w); } catch (x) { e = { code: x.code, docDeleted: x.docDeleted }; }
    // JSON: objetos de contextos vm diferentes têm protótipos diferentes; compara-se o conteúdo
    out.push(JSON.parse(JSON.stringify({ nome, r: r === undefined ? '(undefined)' : r, e, log: w.log, ls: [...w.ls], docs: [...w.docs], ss: [...w.ss], user: !!w.user }, (_k, v) => (v === undefined ? '(undefined)' : v))));
  };
  // mark
  await caso('mark', null, async (m) => [m.mark('u1'), m.mark('u1', 'andamento'), m.mark('u1'), m.mark('u1', null), m.mark('u1')]);
  await caso('mark sem storage', (w) => { w.fail.ls = true; }, async (m) => [m.mark('u1'), m.mark('u1', 'pendente')]);
  await caso('limparMarcas', (w) => { for (const [k, v] of [['ph:del:u1', 'pendente'], ['ph:del:u2', 'andamento'], ['ph:x', '1'], ['acc', '1']]) w.ls.set(k, v); }, async (m) => m.limparMarcas());
  await caso('limparMarcas sem storage', (w) => { w.fail.ls = true; }, async (m) => m.limparMarcas());
  // delState: marca × documento × conta nova/antiga × resposta do Auth
  for (const mk of [null, 'andamento', 'pendente']) for (const d of [DOC, null, undefined]) for (const nova of [false, true]) for (const re of [null, 'auth/user-not-found', 'auth/user-token-expired', 'auth/network-request-failed']) {
    await caso(`delState ${mk}/${d && 'doc'}/${nova}/${re}`, (w) => { w.user = user({ nova, reloadErr: re }); if (mk) w.ls.set('ph:del:u1', mk); }, async (m) => m.delState(d));
  }
  await caso('delState sem usuário', null, async (m) => m.delState(null));
  // excluir: marca anterior × senha × resultado do wipe
  const R = [true, undefined, Object.assign(err('auth/network-request-failed'), { docDeleted: true }), err('auth/invalid-credential')];
  for (const antes of [null, 'pendente']) for (const pw of ['', 'segredo']) for (const res of R) {
    await caso(`excluir ${antes}/${pw}/${res?.code || res}`, (w) => { w.user = user(); if (antes) w.ls.set('ph:del:u1', antes); w.wipeRes.push(res); }, async (m) => m.excluir(pw));
  }
  await caso('excluir sem usuário', null, async (m) => m.excluir('x'));
  // continuar: documento completo / ausente / parcial / corrida
  for (const d of [DOC, null, { favorites: ['p9'], updatedAt: 'u' }, { name: 'Bia', alerts: [{ p: 'p3' }], telegram: null }]) {
    await caso(`continuar ${JSON.stringify(d)}`, (w) => { w.user = user(); w.ls.set('ph:del:u1', 'pendente'); if (d) w.put('users/u1', d); }, async (m) => m.continuar('Nome'));
  }
  await caso('continuar corrida', (w) => { w.user = user(); w.beforeCommit = () => w.put('users/u1', { ...DOC, favorites: ['p5'] }); }, async (m) => m.continuar('Nome'));
  await caso('continuar sem usuário', null, async (m) => m.continuar('Nome'));
  // telas
  const us = [{ provider: 'password', providers: [] }, { provider: 'password', providers: ['password', 'google.com'] }, { provider: 'google.com', providers: ['google.com'] }, { provider: 'phone' }];
  await caso('provs/delForm', null, async (m) => us.map((u) => [m.provs(u), m.delForm(u, 'Excluir <x>', '<i>'), m.delForm(u, 'Sem ícone')]));
  await caso('delPanel', null, async (m) => [
    { why: 'pendente', apagados: true }, { why: 'pendente', apagados: false, err: 'Falhou <b>"x"</b> & \'y\'' }, { why: 'ausente', apagados: true }, { why: 'fim' },
  ].map((d) => m.delPanel(d, us[1], '<i>')));
  return out;
}

let fonte;
await t('fonte e bundle: mesma bateria, mesmas chamadas e mesmos resultados', async () => {
  fonte = await bateria('fonte'); const b = await bateria('bundle');
  assert.equal(b.length, fonte.length);
  for (let i = 0; i < fonte.length; i++) assert.deepEqual(b[i], fonte[i], `bundle diverge da fonte em: ${fonte[i].nome}`);
});

const get = (nome) => { const c = fonte.find((x) => x.nome === nome); assert.ok(c, nome); return c; };
await t('mark: só "andamento"/"pendente", remove com null, storage bloqueado não quebra', () => {
  assert.deepEqual(get('mark').r, [null, null, 'andamento', null, null]);
  assert.deepEqual(get('mark sem storage').r, [null, null]); assert.equal(get('mark sem storage').e, '(undefined)');
});
await t('delState: pendente, ausente, andamento limpo, fim (conta já excluída) e falha de rede', () => {
  assert.equal(get('delState null/doc/false/null').r, ''); assert.equal(get('delState null/null/false/null').r, 'ausente');
  assert.equal(get('delState null/null/true/null').r, '', 'conta nova: perfil criado pela página');
  assert.equal(get('delState null/undefined/false/null').r, '', 'falha ao ler não vira ausente');
  const a = get('delState andamento/doc/false/null'); assert.equal(a.r, ''); assert.deepEqual(a.ls, []);
  assert.equal(get('delState andamento/null/false/null').r, 'pendente'); assert.equal(get('delState pendente/doc/false/null').r, 'pendente');
  assert.equal(get('delState pendente/undefined/false/null').r, 'pendente');
  const f = get('delState pendente/null/false/auth/user-not-found'); assert.equal(f.r, 'fim'); assert.deepEqual(f.ls, []); assert.ok(f.log.includes('signOut')); assert.equal(f.user, false);
  assert.equal(get('delState null/null/false/auth/user-not-found').r, 'fim', 'conta antiga sem documento já excluída');
  const r = get('delState pendente/null/false/auth/network-request-failed'); assert.equal(r.r, 'pendente'); assert.deepEqual(r.ls, [['ph:del:u1', 'pendente']]);
  assert.equal(get('delState pendente/doc/false/auth/user-not-found').r, 'pendente', 'com documento não consulta o Auth');
  assert.equal(get('delState sem usuário').r, '');
  // T4-A: o SDK real devolve user-token-expired para conta excluída (USER_NOT_FOUND traduzido; conferido no emulador do Auth)
  const x = get('delState pendente/null/false/auth/user-token-expired'); assert.equal(x.r, 'fim'); assert.deepEqual(x.ls, []); assert.equal(x.user, false);
  assert.equal(get('delState null/null/false/auth/user-token-expired').r, 'fim');
  assert.equal(get('delState pendente/doc/false/auth/user-token-expired').r, 'pendente', 'com documento não consulta o Auth');
});
await t('limparMarcas: remove só ph:del:*; storage bloqueado não quebra', () => {
  assert.deepEqual(get('limparMarcas').ls, [['ph:x', '1'], ['acc', '1']]); assert.equal(get('limparMarcas sem storage').e, '(undefined)');
});
await t('excluir: andamento antes do wipe, pendente com docDeleted, limpa no sucesso e na falha antes de apagar', () => {
  const ok = get('excluir null/segredo/true');
  assert.deepEqual(ok.log, [['ls.set', 'ph:del:u1', 'andamento'], ['wipe', 'segredo', 'password'], ['ls.del', 'ph:del:u1'], ['ss.del', 'ph:tg:u1']]); assert.equal(ok.r, true);
  assert.deepEqual(get('excluir null//true').log[1], ['wipe', '(undefined)', 'google.com']);
  const p = get('excluir null/segredo/auth/network-request-failed'); assert.deepEqual(p.ls, [['ph:del:u1', 'pendente']]); assert.equal(p.e.docDeleted, true);
  const c = get('excluir null/segredo/auth/invalid-credential'); assert.deepEqual(c.ls, []); assert.equal(c.e.code, 'auth/invalid-credential');
  assert.deepEqual(get('excluir pendente/segredo/auth/invalid-credential').ls, [['ph:del:u1', 'pendente']], 'retomada que falha mantém o pendente');
  assert.deepEqual(get('excluir null/segredo/undefined').ls, []); assert.deepEqual(get('excluir pendente/segredo/undefined').ls, [['ph:del:u1', 'pendente']]);
  assert.deepEqual(get('excluir sem usuário').log, []);
});
await t('continuar: nunca apaga dados; cria só sem documento; completa o parcial; corrida relê', () => {
  const full = get(`continuar ${JSON.stringify(DOC)}`);
  assert.deepEqual(full.log.filter((x) => x[0] === 'set'), [], 'perfil existente: sem gravação'); assert.deepEqual(full.r, DOC); assert.deepEqual(full.ls, []);
  const novo = get('continuar null'); assert.deepEqual(novo.r, { name: 'Nome', favorites: [], alerts: [], termsAt: 'AGORA', createdAt: 'AGORA', updatedAt: 'AGORA' });
  const parc = get('continuar {"favorites":["p9"],"updatedAt":"u"}'); assert.deepEqual(parc.docs[0][1].favorites, ['p9']); assert.equal(parc.docs[0][1].createdAt, 'AGORA');
  const tg = get('continuar {"name":"Bia","alerts":[{"p":"p3"}],"telegram":null}'); assert.equal(tg.docs[0][1].name, 'Bia'); assert.deepEqual(tg.docs[0][1].alerts, [{ p: 'p3' }]);
  const cor = get('continuar corrida'); assert.ok(cor.log.includes('retry')); assert.deepEqual(cor.r.favorites, ['p5']); assert.deepEqual(cor.docs[0][1].favorites, ['p5']);
  assert.equal(get('continuar sem usuário').e.code, 'auth/no-user');
});
await t('telas: senha opcional com Google, required só sem Google; painel neutro no "ausente"; erro escapado', () => {
  const [pwOnly, ambos, google, phone] = get('provs/delForm').r;
  assert.match(pwOnly[1], /<label for="d-pw">Confirme sua senha<\/label>.* required>/); assert.deepEqual(pwOnly[0], ['password']);
  assert.match(ambos[1], /Confirme sua senha \(em branco: Google\)/); assert.doesNotMatch(ambos[1], / required/);
  assert.doesNotMatch(google[1], /d-pw/); assert.deepEqual(phone[0], ['phone']); assert.match(google[1], /<i>Excluir <x><\/button>/);
  const [pend, naoApagou, aus, fim] = get('delPanel').r;
  assert.match(pend, /Exclusão pendente: confirme para concluir/); assert.match(pend, /já foram apagados; falta excluir o login\. Até lá, nada é salvo\./);
  assert.match(pend, /Concluir a exclusão/); assert.match(pend, /Continuar usando a conta<\/button> \(retoma o que ainda existir/);
  assert.match(naoApagou, /A exclusão não terminou\./); assert.match(naoApagou, /<p class="err" tabindex="-1" role="alert">Falhou &#60;b&#62;&#34;x&#34;&#60;\/b&#62; &#38; &#39;y&#39;<\/p>/);
  assert.match(aus, /Sua conta não tem dados salvos/); assert.match(aus, /Criar perfil\? Ele começa sem favoritos e alertas\./); assert.match(aus, />Criar perfil<\/button> \(começa vazio/);
  assert.doesNotMatch(aus, /pendente|exclusão não/i); assert.match(aus, /Excluir a conta/); assert.match(fim, /Exclusão pendente/);
});

// T4-A: watch limpa as marcas órfãs só no PRIMEIRO estado, e só se for sem login (conta excluída noutro aparelho é
// descartada pelo SDK ao abrir a página; conferido no emulador do Auth em test/exclusao-emulador-tests.mjs).
await t('watch: primeiro estado sem login limpa ph:del:*; com login ou depois do primeiro, não (fonte ≡ bundle)', () => {
  const wSrc = src.slice(src.indexOf('export function watch('), src.indexOf('\n', src.indexOf('export function watch('))).replace(/^export /, '');
  const wB = fnText(ex.watch);
  const [, bOn, bA, bLimpa, bPub2] = pick(wB, /return ([\w$]+)\(([\w$]+),\w=>\{\w&&!\w&&([\w$]+)\(\),\w=0,\w\(([\w$]+)\(\w\)\)\}\)/, 'watch');
  assert.equal(bLimpa, ex.limparMarcas);
  const rodar = (kind, estados) => {
    const log = []; let cb; const AUTH = {};
    const deps = { on: (a, f) => { assert.equal(a, AUTH); cb = f; return 'un'; }, limpa: () => log.push('limpa'), pub: (u) => (u ? { uid: u.uid } : null) };
    const ctx = kind === 'fonte' ? { onAuthStateChanged: deps.on, auth: AUTH, limparMarcas: deps.limpa, pub: deps.pub } : { [bOn]: deps.on, [bA]: AUTH, [bLimpa]: deps.limpa, [bPub2]: deps.pub };
    vm.createContext(ctx); vm.runInContext(`${kind === 'fonte' ? wSrc : wB}\n;this.$w=${kind === 'fonte' ? 'watch' : ex.watch};`, ctx);
    const r = ctx.$w((u) => log.push(['cb', u && u.uid])); for (const e of estados) cb(e); return JSON.parse(JSON.stringify([r, log]));
  };
  for (const est of [[null], [null, { uid: 'u1' }, null], [{ uid: 'u1' }, null], [{ uid: 'u1' }]]) assert.deepEqual(rodar('bundle', est), rodar('fonte', est));
  assert.deepEqual(rodar('fonte', [null, { uid: 'u1' }, null])[1], ['limpa', ['cb', null], ['cb', 'u1'], ['cb', null]]);
  assert.deepEqual(rodar('fonte', [{ uid: 'u1' }, null])[1], [['cb', 'u1'], ['cb', null]], 'sair depois (ou forçado pelo SDK) não apaga o pendente');
});

console.log(`✓ Exclusão pendente no módulo (fonte ≡ bundle): ${n} grupos de testes passaram`);
