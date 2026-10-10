// Redaction de logs com segredos 100% sintéticos (nenhum valor real).
import assert from 'node:assert/strict';
import { redact } from '../src/redact.js';

const env = { TELEGRAM_BOT_TOKEN: 'FAKE-bot-token-1234', NTFY_TOPIC: 'topico-sintetico-xyz', HOME: '/home/x' };
const none = { env: {} };

// valores de variáveis sensíveis presentes no ambiente
const a = redact('falhou com FAKE-bot-token-1234 e topico-sintetico-xyz em /home/x', { env });
assert.ok(!a.includes('FAKE-bot-token-1234') && !a.includes('topico-sintetico-xyz'));
assert.ok(a.includes('/home/x'), 'variável não sensível não é mascarada');

// padrões genéricos
const cases = [
  ['postgres://user:senha-falsa@db.exemplo.test:5432/x', 'senha-falsa'],
  ['https://u:p4ss-falsa@exemplo.test/a', 'p4ss-falsa'],
  ['POST https://api.telegram.org/bot123456:ABC-def_FAKE/sendMessage', 'ABC-def_FAKE'],
  ['Authorization: Bearer abcDEF1234567890fake', 'abcDEF1234567890fake'],
  ['GET /x?access_token=APP_USR-1111-fake-2222&q=1', 'APP_USR-1111-fake-2222'],
  ['{"refresh_token":"TG-fake-refresh-0000"}', 'TG-fake-refresh-0000'],
  ['client_secret=segredo-sintetico', 'segredo-sintetico'],
  ['jwt eyJhbGciOiJGQUtFIn0.eyJzdWIiOiJmYWtlIn0.assinaturafake', 'eyJzdWIiOiJmYWtlIn0'],
  ['contato fulano.teste@exemplo.test falhou', 'fulano.teste@exemplo.test'],
  ['cpf 123.456.789-09 inválido', '123.456.789-09'],
  ['cep 01001-000 sem frete', '01001-000'],
];
for (const [input, secret] of cases) assert.ok(!redact(input, none).includes(secret), `vazou: ${secret}`);

// texto comum é preservado
assert.equal(redact('HTTP 503 em loja-x', none), 'HTTP 503 em loja-x');
assert.equal(redact(null, none), '');
assert.equal(redact(new Error('boom'), none), 'Error: boom');

// limite de tamanho
const big = redact('x'.repeat(5000), none);
assert.equal(big.length, 201);
assert.equal(redact('y'.repeat(50), { env: {}, max: 10 }).length, 11);

console.log('redact-tests: ok');
