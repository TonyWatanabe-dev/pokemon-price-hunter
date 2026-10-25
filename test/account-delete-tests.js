// Exclusão de conta (tools/account.src.js): roda o código real de confirmIdentity/wipe com o SDK do Firebase simulado.
// Sem rede, sem emulador e sem produção. Inverter a ordem deleteDoc/deleteUser no código faz estes testes falharem.
// Falhas, repetição e equivalência com o bundle account.js: test/exclusao-conta-tests.js.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../tools/account.src.js', import.meta.url), 'utf8');
const i = src.indexOf('async function confirmIdentity(');
assert.ok(i > 0, 'confirmIdentity() não encontrada em account.src.js');
const code = src.slice(i).replace(/export /g, '');
let n = 0; const t = async (name, fn) => { await fn(); n++; };

function setup({ provider = 'password', failFirstDelete = false, user = true } = {}) {
  const calls = []; let deletes = 0;
  const u = { uid: 'u1', email: 'a@b.c', providerData: [{ providerId: provider }] };
  const ctx = {
    auth: { currentUser: user ? u : null },
    ref: (uid) => `users/${uid}`,
    pub: (x) => ({ provider: x.providerData[0].providerId }),
    deleteDoc: async (r) => { calls.push(`deleteDoc:${r}`); },
    deleteUser: async () => {
      calls.push('deleteUser');
      if (failFirstDelete && deletes++ === 0) throw Object.assign(new Error('x'), { code: 'auth/requires-recent-login' });
    },
    reauthenticateWithPopup: async () => { calls.push('reauthPopup'); },
    reauthenticateWithCredential: async (_u, c) => { calls.push(`reauthCred:${c.pw}`); },
    GoogleAuthProvider: class {},
    EmailAuthProvider: { credential: (_e, pw) => ({ pw }) },
  };
  vm.createContext(ctx);
  vm.runInContext(code + '\nthis.wipe = wipe;', ctx);
  return { ctx, calls };
}

await t('wipe confirma a senha e apaga o documento antes da conta', async () => {
  const { ctx, calls } = setup();
  await ctx.wipe('pw');
  assert.deepEqual(calls, ['reauthCred:pw', 'deleteDoc:users/u1', 'deleteUser']);
});

await t('wipe sem usuário logado não faz nada', async () => {
  const { ctx, calls } = setup({ user: false });
  await ctx.wipe();
  assert.deepEqual(calls, []);
});

await t('senha: reautentica ANTES de apagar qualquer coisa', async () => {
  const { ctx, calls } = setup();
  await ctx.wipe('pw');
  assert.equal(calls[0], 'reauthCred:pw');
});

await t('Google: reautentica por popup antes de apagar', async () => {
  const { ctx, calls } = setup({ provider: 'google.com' });
  await ctx.wipe();
  assert.deepEqual(calls, ['reauthPopup', 'deleteDoc:users/u1', 'deleteUser']);
});

await t('conta com senha sem senha digitada: erro requires-recent-login e nada é apagado', async () => {
  const { ctx, calls } = setup({ failFirstDelete: true });
  await assert.rejects(() => ctx.wipe(''), { code: 'auth/requires-recent-login' });
  assert.deepEqual(calls, []);
});

console.log(`✓ Exclusão de conta: ${n} grupos de testes passaram`);
