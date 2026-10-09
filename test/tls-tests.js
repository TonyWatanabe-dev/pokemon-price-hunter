// Lote 6 — TLS do PostgreSQL: src/db/ssl.js (robô) e api/_lib/ssl.mjs (API) — mesma lógica, URL sem ssl*, CA de
// PG_CA_CERT/PG_CA_CERT_B64 (com pacote de vários certificados), local sem TLS, modo estrito, aviso uma vez só.
// Parte offline com certificados gerados pelo openssl num diretório temporário (pulada se não houver openssl):
// o driver pg de verdade, num servidor TLS falso, aceita o certificado assinado pela CA e recusa o resto.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import net from 'node:net'; import tls from 'node:tls';
import { execFileSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as R from '../src/db/ssl.js';
import * as A from '../api/_lib/ssl.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0; let skipped = 0;
async function t(name, fn) { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } }
const { default: pg } = await import('pg');
const quiet = { warn: () => {} };

// ------------------------------------------------------------------ certificados de teste (openssl, temporários)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tls-'));
let hasOpenssl = true;
const ossl = (...a) => execFileSync('openssl', a, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
const rd = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
function makeCa(name) {
  ossl('req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', `${name}.key`, '-out', `${name}.crt`, '-days', '2', '-subj', `/CN=Teste ${name}`);
}
function makeServer(name, ca, san) {
  fs.writeFileSync(path.join(dir, `${name}.ext`), `subjectAltName=${san}\n`);
  ossl('req', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', `${name}.key`, '-out', `${name}.csr`, '-subj', '/CN=servidor');
  ossl('x509', '-req', '-in', `${name}.csr`, '-CA', `${ca}.crt`, '-CAkey', `${ca}.key`, '-CAcreateserial', '-out', `${name}.crt`, '-days', '2', '-extfile', `${name}.ext`);
}
try { makeCa('ca1'); makeCa('ca2'); makeServer('srv', 'ca1', 'DNS:db.test,IP:127.0.0.1'); } catch { hasOpenssl = false; }
// sem openssl não há certificado real: as partes que dependem dele são puladas (o resto roda igual)
const CA1 = hasOpenssl ? rd('ca1.crt') : null; const CA2 = hasOpenssl ? rd('ca2.crt') : null;
const need = async (name, fn) => { if (!hasOpenssl) { skipped++; return; } await t(name, fn); };

const URL_REMOTE = 'postgres://postgres.abcdefghijkl:s3nh4@aws-0-sa-east-1.pooler.supabase.com:6543/postgres';

// ------------------------------------------------------------------ 1) URL: parâmetros ssl* saem, o resto fica
await t('1. stripSslParams: retira sslmode/ssl/sslrootcert/sslcert/sslkey/uselibpqcompat e mantém o resto', () => {
  for (const mode of ['require', 'verify-full', 'no-verify', 'prefer', 'disable']) {
    assert.equal(R.stripSslParams(`${URL_REMOTE}?sslmode=${mode}`), URL_REMOTE);
  }
  assert.equal(R.stripSslParams(`${URL_REMOTE}?application_name=x&sslmode=require&ssl=true&sslrootcert=/a.crt&SSLMODE=no-verify&options=-c%20a%3D1`),
    `${URL_REMOTE}?application_name=x&options=-c%20a%3D1`);
  assert.equal(R.stripSslParams(`${URL_REMOTE}?sslcert=a&sslkey=b&sslpassword=c&uselibpqcompat=true`), URL_REMOTE);
  assert.equal(R.stripSslParams(URL_REMOTE), URL_REMOTE);
  // senha com caractere especial (sem codificar) não confunde host nem query
  assert.equal(R.pgHost('postgres://u:p@ss?w/rd@db.exemplo.com:5432/x?sslmode=require'), 'db.exemplo.com');
  assert.equal(R.stripSslParams('postgres://u:p@ss?w/rd@db.exemplo.com:5432/x?sslmode=require'), 'postgres://u:p@ss?w/rd@db.exemplo.com:5432/x');
  assert.equal(R.pgHost('postgres://u:p@[::1]:5432/x'), '::1');
  assert.equal(R.pgHost('postgresql://u@LOCALHOST/x'), 'localhost');
});

await need('2. CA em PG_CA_CERT: ssl { ca, rejectUnauthorized: true, servername } e o pg recebe a CA mesmo com sslmode na URL', () => {
  for (const mode of ['require', 'verify-full', 'no-verify']) {
    const c = R.pgConnectionConfig(`${URL_REMOTE}?sslmode=${mode}`, { env: { PG_CA_CERT: CA1 }, ...quiet });
    assert.equal(c.tlsMode, 'verify'); assert.equal(c.caCount, 1);
    assert.equal(c.connectionString.includes('sslmode'), false);
    assert.deepEqual(c.ssl, { ca: [CA1.replace(/\r/g, '').trim() + '\n'], rejectUnauthorized: true, servername: 'aws-0-sa-east-1.pooler.supabase.com' });
    // o que o driver usa de verdade (connection-parameters.js junta config + parse da URL)
    const client = new pg.Client({ connectionString: c.connectionString, ssl: c.ssl });
    assert.equal(client.connectionParameters.ssl.rejectUnauthorized, true);
    assert.equal(client.connectionParameters.ssl.ca.length, 1);
    // prova do problema que o helper evita: com sslmode na URL, o pg joga fora a CA ('require' só gera aviso do pg)
    if (mode === 'require') continue;
    const raw = new pg.Client({ connectionString: `${URL_REMOTE}?sslmode=${mode}`, ssl: c.ssl });
    assert.equal(raw.connectionParameters.ssl.ca, undefined);
  }
  // IP não leva servername (SNI não aceita IP)
  assert.equal(R.pgConnectionConfig('postgres://u:p@10.1.2.3:5432/x', { env: { PG_CA_CERT: CA1 }, ...quiet }).ssl.servername, undefined);
});

await need('3. PG_CA_CERT_B64 (PEM ou DER em base64), PEM numa linha só com \\n literal, pacote com 2 certificados', () => {
  const b64 = Buffer.from(CA1).toString('base64');
  const c = R.pgConnectionConfig(URL_REMOTE, { env: { PG_CA_CERT_B64: b64 }, ...quiet });
  assert.equal(c.tlsMode, 'verify'); assert.equal(c.caCount, 1);
  const der = new X509Certificate(CA1).raw;
  const d = R.pgConnectionConfig(URL_REMOTE, { env: { PG_CA_CERT_B64: der.toString('base64') }, ...quiet });
  assert.equal(d.caCount, 1);
  assert.equal(new X509Certificate(d.ssl.ca[0]).fingerprint256, new X509Certificate(CA1).fingerprint256);
  const oneLine = CA1.trim().replace(/\n/g, '\\n');
  assert.equal(R.pgConnectionConfig(URL_REMOTE, { env: { PG_CA_CERT: oneLine }, ...quiet }).caCount, 1);
  const bundle = R.pgConnectionConfig(URL_REMOTE, { env: { PG_CA_CERT: CA1 + '\n' + CA2 }, ...quiet });
  assert.equal(bundle.caCount, 2); assert.equal(bundle.ssl.ca.length, 2);
  // PG_CA_CERT tem prioridade sobre o base64
  assert.equal(R.pgConnectionConfig(URL_REMOTE, { env: { PG_CA_CERT: CA1, PG_CA_CERT_B64: Buffer.from(CA1 + CA2).toString('base64') }, ...quiet }).caCount, 1);
  const s = R.caSummary({ PG_CA_CERT: CA1 + CA2 });
  assert.equal(s.length, 2); assert.match(s[0].subject, /Teste ca1/); assert.ok(Date.parse(s[0].validTo) > Date.now());
});
await t('4. local (localhost, 127.0.0.1, ::1): sem TLS, mesmo com CA ou modo estrito', () => {
  for (const u of ['postgres://postgres:pw@localhost:54317/x?sslmode=require', 'postgres://p@127.0.0.1/x', 'postgres://p@[::1]:5432/x']) {
    const c = R.pgConnectionConfig(u, { env: { PG_CA_CERT: 'qualquer', PG_TLS_STRICT: '1' }, ...quiet });
    assert.equal(c.ssl, false); assert.equal(c.tlsMode, 'local');
    assert.equal(c.connectionString.includes('sslmode'), false);
    assert.equal(R.tlsModeFor(u, {}), 'local');
  }
});

await t('5. sem CA: comportamento antigo (no-verify), aviso UMA vez por processo e sem segredo; estrito recusa', () => {
  R._resetTlsWarning();
  const msgs = []; const warn = (m) => msgs.push(m);
  for (let i = 0; i < 3; i++) {
    const c = R.pgConnectionConfig(`${URL_REMOTE}?sslmode=require`, { env: {}, warn });
    assert.deepEqual(c.ssl, { rejectUnauthorized: false }); assert.equal(c.tlsMode, 'no-verify');
  }
  assert.equal(msgs.length, 1);
  assert.match(msgs[0], /PG_CA_CERT/);
  for (const secret of ['s3nh4', 'abcdefghijkl', 'pooler.supabase.com', 'postgres://']) assert.equal(msgs[0].includes(secret), false);
  assert.equal(R.tlsModeFor(URL_REMOTE, {}), 'no-verify');
  assert.equal(R.tlsModeFor('', {}), 'off');
  // estrito
  for (const v of ['1', 'true']) {
    assert.throws(() => R.pgConnectionConfig(URL_REMOTE, { env: { PG_TLS_STRICT: v }, ...quiet }), (e) => e.code === 'PG_TLS_STRICT' && !e.message.includes('s3nh4'));
  }
  assert.equal(R.pgConnectionConfig(URL_REMOTE, { env: { PG_TLS_STRICT: '0' }, ...quiet }).tlsMode, 'no-verify');
  assert.equal(R.pgConnectionConfig(URL_REMOTE, { env: { PG_TLS_STRICT: '' , PG_CA_CERT: '  ' }, ...quiet }).tlsMode, 'no-verify');   // variável vazia = ausente
  // aviso que lança não derruba a conexão
  R._resetTlsWarning();
  assert.equal(R.pgConnectionConfig(URL_REMOTE, { env: {}, warn: () => { throw new Error('x'); } }).tlsMode, 'no-verify');
});

await need('6. estrito com CA conecta em modo verify; CA inválida falha sem mostrar o conteúdo', () => {
  assert.equal(R.pgConnectionConfig(URL_REMOTE, { env: { PG_TLS_STRICT: '1', PG_CA_CERT: CA1 }, ...quiet }).tlsMode, 'verify');
  for (const bad of ['não é certificado segredo123', '-----BEGIN CERTIFICATE-----\nAAAAsegredo123\n-----END CERTIFICATE-----']) {
    assert.throws(() => R.pgConnectionConfig(URL_REMOTE, { env: { PG_CA_CERT: bad }, ...quiet }), (e) => e.code === 'PG_CA_INVALID' && !e.message.includes('segredo123'));
    assert.equal(R.tlsModeFor(URL_REMOTE, { PG_CA_CERT: bad }), 'invalid');
  }
});

// ------------------------------------------------------------------ 7) paridade robô × API
await t('7. paridade: api/_lib/ssl.mjs é cópia idêntica de src/db/ssl.js e responde igual', () => {
  assert.equal(fs.readFileSync(path.join(root, 'api/_lib/ssl.mjs'), 'utf8'), fs.readFileSync(path.join(root, 'src/db/ssl.js'), 'utf8'),
    'api/_lib/ssl.mjs difere de src/db/ssl.js — copie: cp src/db/ssl.js api/_lib/ssl.mjs');
  assert.deepEqual(Object.keys(A).sort(), Object.keys(R).sort());
  const envs = [{}, { PG_TLS_STRICT: '1' }, ...(hasOpenssl ? [{ PG_CA_CERT: CA1 }, { PG_CA_CERT: CA1 + CA2 }, { PG_CA_CERT_B64: Buffer.from(CA2).toString('base64') }] : [])];
  const urls = [URL_REMOTE, `${URL_REMOTE}?sslmode=verify-full&application_name=a`, 'postgres://p@localhost:5432/x?ssl=true', 'postgres://p@10.0.0.1/x'];
  const run = (M, u, env) => { try { return M.pgConnectionConfig(u, { env, ...quiet }); } catch (e) { return { error: e.code }; } };
  for (const u of urls) for (const env of envs) {
    assert.deepEqual(run(A, u, env), run(R, u, env));
    assert.equal(A.tlsModeFor(u, env), R.tlsModeFor(u, env));
  }
});

await t('8. todos os pontos de conexão usam o helper (nenhum rejectUnauthorized: false solto no código)', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(path.join(d, e.name))) : /\.m?js$/.test(e.name) ? [path.join(d, e.name)] : []));
  const files = ['src', 'api', 'tools'].flatMap((d) => walk(path.join(root, d)));
  const loose = files.filter((f) => !/[\\/]ssl\.m?js$/.test(f) && /rejectUnauthorized/.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(loose.map((f) => path.relative(root, f)), []);
  const users = files.filter((f) => /new pg\.(Pool|Client)\(/.test(fs.readFileSync(f, 'utf8')));
  for (const f of users) assert.match(fs.readFileSync(f, 'utf8'), /pgConnectionConfig|conn\(/, path.relative(root, f));
  assert.ok(users.length >= 5, 'pontos de conexão encontrados: ' + users.length);
});

// ------------------------------------------------------------------ 9) offline: driver pg de verdade × servidor TLS falso
// Servidor que fala só o começo do protocolo: responde 'S' ao SSLRequest e faz o handshake TLS com o certificado de
// teste. Conexão do cliente sempre chega ao servidor em 127.0.0.1 (o host da URL é db.test, para conferir o nome).
async function fakePg(certName) {
  const key = rd(`${certName}.key`); const cert = rd(`${certName}.crt`);
  const state = { secured: 0 };
  const srv = net.createServer((sock) => {
    sock.on('error', () => {});
    sock.once('data', () => {
      sock.write('S');
      const ts = new tls.TLSSocket(sock, { isServer: true, key, cert });
      ts.on('error', () => {});
      ts.on('secure', () => { state.secured++; setTimeout(() => ts.destroy(), 20); });
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { port: srv.address().port, state, close: () => new Promise((r) => srv.close(r)) };
}
async function tryConnect(port, url, env) {
  const { connectionString, ssl } = R.pgConnectionConfig(url, { env, ...quiet });
  const stream = () => { const s = new net.Socket(); const orig = s.connect.bind(s); s.connect = (...a) => orig(port, '127.0.0.1', ...a.filter((x) => typeof x === 'function')); return s; };
  const c = new pg.Client({ connectionString, ssl, stream, connectionTimeoutMillis: 3000 });
  c.on('error', () => {});
  try { await c.connect(); return { ok: true }; } catch (e) { return { code: e.code || null, message: String(e.message) }; } finally { c.end().catch(() => {}); }
}
const CERT_ERR = /SELF_SIGNED|UNABLE_TO|ALTNAME|CERT_/;
await need('9. offline: aceita certificado assinado pela CA (inclusive no pacote de rotação) e recusa outra CA ou outro nome', async () => {
  const s = await fakePg('srv');
  try {
    const URLDB = 'postgres://u:p@db.test:5432/x?sslmode=verify-full';
    // CA certa: o TLS fecha (o servidor falso encerra depois, então o erro é de protocolo, não de certificado)
    let r = await tryConnect(s.port, URLDB, { PG_CA_CERT: CA1 });
    assert.equal(CERT_ERR.test(String(r.code)), false, JSON.stringify(r)); assert.equal(s.state.secured, 1);
    // pacote [CA nova, CA antiga] (rotação): aceita
    r = await tryConnect(s.port, URLDB, { PG_CA_CERT: CA2 + CA1 });
    assert.equal(CERT_ERR.test(String(r.code)), false, JSON.stringify(r)); assert.equal(s.state.secured, 2);
    // outra CA: recusa
    r = await tryConnect(s.port, URLDB, { PG_CA_CERT: CA2 });
    assert.match(String(r.code), CERT_ERR, JSON.stringify(r)); assert.equal(s.state.secured, 2);
    // nome que não está no certificado: recusa
    r = await tryConnect(s.port, 'postgres://u:p@outro.test:5432/x', { PG_CA_CERT: CA1 });
    assert.equal(r.code, 'ERR_TLS_CERT_ALTNAME_INVALID', JSON.stringify(r)); assert.equal(s.state.secured, 2);
    // sem CA (modo antigo): aceita qualquer certificado — é exatamente o risco que o PG_CA_CERT fecha
    r = await tryConnect(s.port, URLDB, {});
    assert.equal(CERT_ERR.test(String(r.code)), false, JSON.stringify(r)); assert.equal(s.state.secured, 3);
    // IP no host: confere pelo SAN de IP
    r = await tryConnect(s.port, 'postgres://u:p@127.0.0.2:5432/x', { PG_CA_CERT: CA1 });
    assert.equal(r.code, 'ERR_TLS_CERT_ALTNAME_INVALID', JSON.stringify(r));
  } finally { await s.close(); }
});

fs.rmSync(dir, { recursive: true, force: true });
console.log(`OK — TLS do PostgreSQL: ${n} testes${skipped ? ` (${skipped} pulados: openssl indisponível)` : ''}`);
