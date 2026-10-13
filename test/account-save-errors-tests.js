// Contrato de saveErr (index.html): mensagens por código de erro. Só leitura do index.html.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const i = html.indexOf('const SAVE_AUTH=');
const j = html.indexOf('\n', html.indexOf('function saveErr(e)', i));
assert.ok(i > 0 && j > i, 'trecho saveErr');
const ctx = vm.createContext({});
vm.runInContext(html.slice(i, j) + ';this.saveErr=saveErr;', ctx);
const saveErr = ctx.saveErr;

const AUTH = 'Sua sessão expirou. Entre de novo para salvar.';
const NET = 'Sem conexão. Confira a internet e tente de novo.';
const GENERIC = 'Não consegui salvar. Tente de novo.';

for (const code of ['auth/no-user', 'unauthenticated', 'auth/user-token-expired', 'auth/user-not-found'])
  assert.equal(saveErr({ code }), AUTH, code);
for (const code of ['unavailable', 'auth/network-request-failed', 'deadline-exceeded'])
  assert.equal(saveErr({ code }), NET, code);
for (const e of [{ code: 'permission-denied' }, { code: 'algo-novo' }, {}, null, undefined, new Error('x')])
  assert.equal(saveErr(e), GENERIC, JSON.stringify(e));

console.log('account-save-errors-tests: ok');
