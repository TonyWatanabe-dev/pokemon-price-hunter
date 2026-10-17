// Conta de serviço do Firestore: motivo legível (sem expor conteúdo) e colagens comuns aceitas.
import assert from 'node:assert/strict';
import { parseServiceAccount, motivoServiceAccount } from '../src/firestore-rest.js';

const pem = '-----BEGIN PRIVATE KEY-----\nMIIabc\n-----END PRIVATE KEY-----\n';
const ok = JSON.stringify({ type: 'service_account', client_email: 'robo@tcg-price-hunter.iam.gserviceaccount.com', private_key: pem, project_id: 'tcg-price-hunter' });
assert.ok(parseServiceAccount(ok)); assert.equal(motivoServiceAccount(ok), null);
for (const v of ['﻿' + ok, `  ${ok}\n`, `'${ok}'`, `"${ok}"`]) { assert.ok(parseServiceAccount(v), 'colagem tolerada'); assert.equal(motivoServiceAccount(v), null); }
assert.match(motivoServiceAccount(''), /^vazio/);
assert.match(motivoServiceAccount(undefined), /^vazio/);
assert.match(motivoServiceAccount('AIzaSyXXXX'), /não começa com "\{"/);
assert.match(motivoServiceAccount(ok.slice(0, 80)), /JSON incompleto/);
assert.match(motivoServiceAccount(JSON.stringify({ apiKey: 'x', projectId: 'p' })), /sem client_email/);
assert.match(motivoServiceAccount(JSON.stringify({ type: 'authorized_user' })), /não é chave de conta de serviço/);
assert.doesNotMatch(motivoServiceAccount(ok.slice(0, 80)), /robo@|MIIabc/, 'nunca mostra conteúdo');
console.log('conta-servico-motivo-tests: ok');
