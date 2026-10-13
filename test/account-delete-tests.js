// Exclusão de conta (tools/account.src.js): roda o código real de remove/wipe com o SDK do Firebase simulado.
// Sem rede, sem emulador e sem produção. Inverter a ordem deleteDoc/deleteUser no código faz estes testes falharem.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../tools/account.src.js', import.meta.url), 'utf8');
const i = src.indexOf('export async function remove(');
assert.ok(i > 0, 'remove() não encontrada em account.src.js');
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
  vm.runInContext(code + '\nthis.wipe = wipe; this.remove = remove;', ctx);
  return { ctx, calls };
}

await t('wipe apaga o documento antes da conta', async () => {
  const { ctx, calls } = setup();
  await ctx.wipe('pw');
  assert.deepEqual(calls, ['deleteDoc:users/u1', 'deleteUser']);
});

await t('wipe sem usuário logado não faz nada', async () => {
  const { ctx, calls } = setup({ user: false });
  await ctx.wipe();
  assert.deepEqual(calls, []);
});

await t('requires-recent-login (senha): reautentica, apaga o documento e remove a conta', async () => {
  const { ctx, calls } = setup({ failFirstDelete: true });
  await ctx.wipe('pw');
  assert.deepEqual(calls, ['deleteDoc:users/u1', 'deleteUser', 'reauthCred:pw', 'deleteDoc:users/u1', 'deleteUser']);
});

await t('requires-recent-login (Google): reautentica por popup antes de apagar', async () => {
  const { ctx, calls } = setup({ provider: 'google.com', failFirstDelete: true });
  await ctx.wipe();
  assert.deepEqual(calls, ['deleteDoc:users/u1', 'deleteUser', 'reauthPopup', 'deleteDoc:users/u1', 'deleteUser']);
});

await t('requires-recent-login sem senha propaga o erro e não reautentica', async () => {
  const { ctx, calls } = setup({ failFirstDelete: true });
  await assert.rejects(() => ctx.wipe(''), { code: 'auth/requires-recent-login' });
  assert.ok(!calls.some((c) => c.startsWith('reauth')));
});

console.log(`✓ Exclusão de conta: ${n} grupos de testes passaram`);
