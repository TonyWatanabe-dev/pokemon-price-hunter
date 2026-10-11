// Testes offline do cliente HTTP: URL inválida, timeout, payload malformado, limite de tamanho e redaction (segredos sintéticos).
import assert from 'node:assert/strict';
process.env.HUNTER_DOMAIN_DELAY_MS = '0';
process.env.HUNTER_MAX_BODY_BYTES = '1000';
const http = await import('../src/http.js');

let calls = 0;
http.setFetch(async (url, opt) => {
  calls++;
  const u = new URL(url);
  if (u.host === 'slow.test') return new Promise((_, rej) => opt.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  if (u.host === 'bad-json.test') return new Response('<html>segredo-sintetico-123</html>', { status: 200, headers: { 'content-type': 'application/json' } });
  if (u.host === 'big.test') return new Response('x'.repeat(5000), { status: 200, headers: { 'content-type': 'text/html' } });
  if (u.host === 'err.test') return new Response('erro', { status: 500 });
  return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
});

// URLs inválidas: nenhuma conexão é feita
for (const bad of ['not a url', 'file:///etc/passwd', 'ftp://shop.test/x', 'javascript:alert(1)', 'https://user:pass@shop.test/x', '']) {
  await assert.rejects(() => http.request(bad), (e) => e.invalidUrl === true && e.status === 0 && !/pass/.test(e.message), `recusa ${bad}`);
}
assert.equal(calls, 0, 'URL inválida não chega ao fetch');

// timeout
await assert.rejects(() => http.request('https://slow.test/', { timeout: 20 }), (e) => /Timeout em slow\.test/.test(e.message) && e.status === 0);

// payload malformado: erro não repete o conteúdo recebido
await assert.rejects(() => http.getJson('https://bad-json.test/x'), (e) => e.malformed === true && !/segredo-sintetico/.test(e.message));

// resposta grande demais
await assert.rejects(() => http.request('https://big.test/'), (e) => /grande demais/.test(e.message));

// erro HTTP não carrega query nem token da URL
await assert.rejects(() => http.request('https://err.test/api?access_token=TOKEN-SINTETICO-999&q=1'), (e) => e.status === 500 && !/TOKEN-SINTETICO/.test(e.message) && /err\.test\/api/.test(e.message));

// URL válida segue funcionando
assert.deepEqual(await http.getJson('https://ok.test/a?b=1'), { ok: true });

// redaction
assert.equal(http.safeUrl('https://u:p@x.test/a/b?token=abc#f'), 'https://x.test/a/b');
assert.equal(http.safeUrl('lixo'), '(URL inválida)');
const r = http.redact('POST https://api.telegram.org/bot123456789:AAFAKE_synthetic-token_000/sendMessage falhou; Authorization: Bearer abcDEF123456789.synthetic; https://x.test/?api_key=SINTETICA&ok=1');
assert.ok(!/AAFAKE|abcDEF123456789|SINTETICA/.test(r), r);
assert.ok(/ok=1/.test(r), 'parâmetros comuns ficam');
assert.equal(http.redact(null), '');

console.log('http-security-tests: ok');
