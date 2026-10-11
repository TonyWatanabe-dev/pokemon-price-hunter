// TLS do PostgreSQL em modo compatível: src/db/ssl.js (robô e ferramentas) e api/_lib/ssl.mjs (API) — mesma lógica.
// Sem rede e sem banco: certificados de teste fixos (só a parte pública, sem chave), driver pg só para conferir a
// configuração efetiva (connectionParameters), nunca para conectar.
//  - sem PG_CA_CERT e sem PG_TLS_STRICT: IDÊNTICO ao comportamento anterior (URL intacta, mesmo `ssl`), só um aviso;
//  - com CA: { ca, rejectUnauthorized: true, servername } e parâmetros ssl* fora da URL (senão o pg descarta a CA);
//  - PG_TLS_STRICT=1 sem CA: erro; CA ilegível: erro claro, sem o conteúdo.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path';
import { X509Certificate } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as R from '../src/db/ssl.js';
import * as A from '../api/_lib/ssl.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0;
async function t(name, fn) { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } }
const { default: pg } = await import('pg');
const quiet = { warn: () => {} };
// o ambiente desta execução nunca entra nos testes
for (const k of ['PG_CA_CERT', 'PG_CA_CERT_B64', 'PG_TLS_STRICT']) delete process.env[k];

// CAs de teste autoassinadas (EC P-256, validade até 2126), geradas só para estes testes. Só o certificado público.
const CA1 = `-----BEGIN CERTIFICATE-----
MIIBqDCCAU+gAwIBAgIURzFnOdD3lsgH6vfAksbi8s3Bq9QwCgYIKoZIzj0EAwIw
KTEnMCUGA1UEAwweVGVzdGUgVExTIGNhMSAoc29tZW50ZSB0ZXN0ZXMpMCAXDTI2
MTAxMTAxMDYyMloYDzIxMjYwOTE3MDEwNjIyWjApMScwJQYDVQQDDB5UZXN0ZSBU
TFMgY2ExIChzb21lbnRlIHRlc3RlcykwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNC
AATw67lyf8HZrYqNNVwR1wCRSzcH+qV+FqIYnJjKG4LztD/Yo/+zocthg6npbDRv
QtYthqp77SHsd7djemStoUZto1MwUTAdBgNVHQ4EFgQUFYdpbMPJqu+GZmAJr5xV
CL7pZ3EwHwYDVR0jBBgwFoAUFYdpbMPJqu+GZmAJr5xVCL7pZ3EwDwYDVR0TAQH/
BAUwAwEB/zAKBggqhkjOPQQDAgNHADBEAiAbjSM1Fe0Wt/BDHNxWyPo81lZ+YrVO
anQjfhk0YHFXTwIgSHk8HpUNM8+4DAC6mFAhjs2tnG/VNViFXkrJOELpUB4=
-----END CERTIFICATE-----
`;
const CA2 = `-----BEGIN CERTIFICATE-----
MIIBqjCCAU+gAwIBAgIUWuW2AQiMsDZvbBiT7fa3ICi8sJAwCgYIKoZIzj0EAwIw
KTEnMCUGA1UEAwweVGVzdGUgVExTIGNhMiAoc29tZW50ZSB0ZXN0ZXMpMCAXDTI2
MTAxMTAxMDYyMloYDzIxMjYwOTE3MDEwNjIyWjApMScwJQYDVQQDDB5UZXN0ZSBU
TFMgY2EyIChzb21lbnRlIHRlc3RlcykwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNC
AATMletgbRjUGM6Mwh8Vj9mqZEqGMsCpPgx59dvc1joDLvJKkckBXeMCzwo9lOG6
1w4KRGZKbTIXiHvxegPdCVyuo1MwUTAdBgNVHQ4EFgQUrCW0jeoAYVH01czLc8on
gGzimCcwHwYDVR0jBBgwFoAUrCW0jeoAYVH01czLc8ongGzimCcwDwYDVR0TAQH/
BAUwAwEB/zAKBggqhkjOPQQDAgNJADBGAiEAu67JFRYqnbO+srvjPfnxcknRaJ4J
ZwkyYsWd0dCh/TkCIQD70Uwd2uJOVUjmvUzXY6ijiHacmfM+wVs04p1W/gh33Q==
-----END CERTIFICATE-----
`;
const URL_REMOTE = 'postgres://postgres.abcdefghijkl:s3nh4@aws-0-sa-east-1.pooler.supabase.com:6543/postgres';
const SECRETS = ['s3nh4', 'abcdefghijkl', 'pooler.supabase.com', 'postgres://'];

// Comportamento ANTERIOR a este helper, copiado dos pontos de conexão da main (api/_lib/db.mjs, src/db/pg.js,
// src/db-health.js, src/opportunity-read.js; tools/db-diagnose.mjs usava sempre { rejectUnauthorized: false }).
const legacy = (url) => ({ connectionString: url, ssl: /@(localhost|127\.0\.0\.1)[:/]/.test(url) ? false : { rejectUnauthorized: false } });
const legacyDiagnose = (url) => ({ connectionString: url, ssl: { rejectUnauthorized: false } });
// `ssl` que o driver usa de verdade (connection-parameters.js junta config + parse da URL)
const effective = (cfg) => {
  const w = process.emitWarning; process.emitWarning = () => {};   // aviso de sslmode do pg-connection-string fora da saída
  try { return new pg.Client({ connectionString: cfg.connectionString, ssl: cfg.ssl }).connectionParameters.ssl; } finally { process.emitWarning = w; }
};
// URLs de produção possíveis hoje (sem e com parâmetros de TLS) e locais
const COMPAT_URLS = [
  URL_REMOTE,
  `${URL_REMOTE}?sslmode=require`, `${URL_REMOTE}?sslmode=disable`, `${URL_REMOTE}?sslmode=no-verify`,
  `${URL_REMOTE}?sslmode=verify-full&application_name=x`, `${URL_REMOTE}?sslmode=prefer`, `${URL_REMOTE}?ssl=true`, `${URL_REMOTE}?ssl=0`,
  `${URL_REMOTE}?uselibpqcompat=true&sslmode=require`, `${URL_REMOTE}?pgbouncer=true&connection_limit=1`,
  'postgres://postgres:pw@localhost:5432/postgres', 'postgres://postgres:pw@localhost:5432/postgres?sslmode=require',
  'postgres://u:p@127.0.0.1/x', 'postgres://localhost/x', 'postgres://u:p@[::1]:5432/x', 'postgres://u:p@10.1.2.3:5432/x',
];

// ------------------------------------------------------------------ 1) modo compatível = exatamente o anterior
await t('1. sem PG_CA_CERT e sem PG_TLS_STRICT: URL inalterada e mesmo ssl de antes (inclusive com sslmode= na URL)', () => {
  const absent = [{}, { PG_TLS_STRICT: '0' }, { PG_TLS_STRICT: '' }, { PG_CA_CERT: '   ', PG_CA_CERT_B64: '' }, { PG_TLS_STRICT: 'false' }];
  for (const env of absent) for (const u of COMPAT_URLS) {
    const c = R.pgConnectionConfig(u, { env, ...quiet });
    const old = legacy(u);
    assert.equal(c.connectionString, u, 'URL intacta: ' + u);
    assert.deepEqual(c.ssl, old.ssl, u);
    assert.deepEqual(effective(c), effective(old), 'driver recebe o mesmo ssl: ' + u);
    assert.equal(c.tlsMode, old.ssl === false ? 'local' : 'no-verify');
    assert.equal(R.tlsModeFor(u, env), c.tlsMode);
    // db-diagnose (detectLocal: false): sempre { rejectUnauthorized: false }, como antes
    const d = R.pgConnectionConfig(u, { env, ...quiet, detectLocal: false });
    assert.deepEqual(d, { ...legacyDiagnose(u), tlsMode: 'no-verify', caCount: 0 });
  }
  // o ponto da auditoria: no modo compatível o sslmode da URL continua valendo como antes (não é retirado)
  assert.equal(R.pgConnectionConfig(`${URL_REMOTE}?sslmode=disable`, { env: {}, ...quiet }).connectionString.includes('sslmode=disable'), true);
  assert.equal(effective(R.pgConnectionConfig(`${URL_REMOTE}?sslmode=disable`, { env: {}, ...quiet })), false);
});

await t('2. modo compatível: aviso UMA vez por processo, sem segredo; aviso que lança não derruba', () => {
  R._resetTlsWarning();
  const msgs = []; const warn = (m) => msgs.push(m);
  for (let i = 0; i < 3; i++) R.pgConnectionConfig(`${URL_REMOTE}?sslmode=require`, { env: {}, warn });
  R.pgConnectionConfig('postgres://u:p@localhost:5432/x', { env: {}, warn });   // local não avisa
  assert.equal(msgs.length, 1);
  assert.match(msgs[0], /^\[tls\] PG_CA_CERT não definido/);
  for (const s of SECRETS) assert.equal(msgs[0].includes(s), false, s);
  R._resetTlsWarning();
  assert.equal(R.pgConnectionConfig(URL_REMOTE, { env: {}, warn: () => { throw new Error('x'); } }).tlsMode, 'no-verify');
  assert.equal(R.tlsModeFor('', {}), 'off');
});

// ------------------------------------------------------------------ 3) CA configurada: verificação ligada
await t('3. com PG_CA_CERT: ssl { ca, rejectUnauthorized: true, servername } e o pg recebe a CA mesmo com sslmode na URL', () => {
  for (const mode of ['require', 'verify-full', 'no-verify', 'disable']) {
    const c = R.pgConnectionConfig(`${URL_REMOTE}?sslmode=${mode}&application_name=a`, { env: { PG_CA_CERT: CA1 }, ...quiet });
    assert.equal(c.tlsMode, 'verify'); assert.equal(c.caCount, 1);
    assert.equal(c.connectionString, `${URL_REMOTE}?application_name=a`);
    assert.deepEqual(c.ssl, { ca: [CA1], rejectUnauthorized: true, servername: 'aws-0-sa-east-1.pooler.supabase.com' });
    const eff = effective(c);
    assert.equal(eff.rejectUnauthorized, true); assert.equal(eff.ca.length, 1);
    // por que só neste modo a URL perde os ssl*: deixados nela, o pg descartaria a CA
    if (mode !== 'require') assert.equal(effective({ connectionString: `${URL_REMOTE}?sslmode=${mode}`, ssl: c.ssl })?.ca, undefined);
  }
  assert.equal(R.pgConnectionConfig('postgres://u:p@10.1.2.3:5432/x', { env: { PG_CA_CERT: CA1 }, ...quiet }).ssl.servername, undefined, 'IP não leva servername');
  // CA certa + estrito = verify
  assert.equal(R.pgConnectionConfig(URL_REMOTE, { env: { PG_TLS_STRICT: '1', PG_CA_CERT: CA1 }, ...quiet }).tlsMode, 'verify');
});

await t('4. formatos da CA: PG_CA_CERT_B64 (PEM ou DER), PEM numa linha com \\n literal, pacote com 2 certificados', () => {
  assert.equal(R.pgConnectionConfig(URL_REMOTE, { env: { PG_CA_CERT_B64: Buffer.from(CA1).toString('base64') }, ...quiet }).caCount, 1);
  const der = new X509Certificate(CA1).raw;
  const d = R.pgConnectionConfig(URL_REMOTE, { env: { PG_CA_CERT_B64: der.toString('base64') }, ...quiet });
  assert.equal(new X509Certificate(d.ssl.ca[0]).fingerprint256, new X509Certificate(CA1).fingerprint256);
  assert.equal(R.pgConnectionConfig(URL_REMOTE, { env: { PG_CA_CERT: CA1.trim().replace(/\n/g, '\\n') }, ...quiet }).caCount, 1);
  assert.equal(R.pgConnectionConfig(URL_REMOTE, { env: { PG_CA_CERT: CA1.replace(/\n/g, '\r\n') }, ...quiet }).ssl.ca[0], CA1, 'CRLF normalizado');
  const bundle = R.pgConnectionConfig(URL_REMOTE, { env: { PG_CA_CERT: CA1 + CA2 }, ...quiet });
  assert.equal(bundle.caCount, 2); assert.deepEqual(bundle.ssl.ca, [CA1, CA2]);
  assert.equal(R.pgConnectionConfig(URL_REMOTE, { env: { PG_CA_CERT: CA1, PG_CA_CERT_B64: Buffer.from(CA1 + CA2).toString('base64') }, ...quiet }).caCount, 1, 'PG_CA_CERT vence');
  const s = R.caSummary({ PG_CA_CERT: CA1 + CA2 });
  assert.equal(s.length, 2); assert.match(s[0].subject, /Teste TLS ca1/); assert.ok(Date.parse(s[1].validTo) > Date.now());
  assert.equal(R.caSummary({}), null);
});

// ------------------------------------------------------------------ 5) estrito sem CA e CA inválida: erro claro
await t('5. PG_TLS_STRICT=1 sem CA: conexão recusada (PG_TLS_STRICT), sem segredo na mensagem', () => {
  for (const v of ['1', 'true', 'TRUE', ' sim ']) {
    assert.throws(() => R.pgConnectionConfig(`${URL_REMOTE}?sslmode=require`, { env: { PG_TLS_STRICT: v }, ...quiet }),
      (e) => e.code === 'PG_TLS_STRICT' && /PG_TLS_STRICT=1 e nenhuma CA/.test(e.message) && SECRETS.every((s) => !e.message.includes(s)));
    assert.equal(R.tlsModeFor(URL_REMOTE, { PG_TLS_STRICT: v }), 'refused');
  }
});

await t('6. CA preenchida mas inválida: erro PG_CA_INVALID claro, sem mostrar o conteúdo', () => {
  const bad = ['não é certificado segredo123', '-----BEGIN CERTIFICATE-----\nAAAAsegredo123\n-----END CERTIFICATE-----', CA1 + '-----BEGIN CERTIFICATE-----\nsegredo123\n-----END CERTIFICATE-----'];
  for (const b of bad) {
    assert.throws(() => R.pgConnectionConfig(URL_REMOTE, { env: { PG_CA_CERT: b }, ...quiet }),
      (e) => e.code === 'PG_CA_INVALID' && /^PG_CA_CERT inválido: /.test(e.message) && !e.message.includes('segredo123'));
    assert.equal(R.tlsModeFor(URL_REMOTE, { PG_CA_CERT: b }), 'invalid');
  }
  assert.throws(() => R.pgConnectionConfig(URL_REMOTE, { env: { PG_CA_CERT_B64: 'c2VncmVkbzEyMw==' }, ...quiet }), (e) => e.code === 'PG_CA_INVALID');
  // o nº do certificado ruim aparece (ajuda a achar o erro num pacote)
  assert.throws(() => R.readCa({ PG_CA_CERT: bad[2] }), /certificado nº 2/);
});

await t('7. host local com CA ou estrito: sem TLS e URL intacta (CI e desenvolvimento)', () => {
  for (const u of ['postgres://postgres:pw@localhost:54317/x?sslmode=require', 'postgres://p@127.0.0.1/x', 'postgres://p@[::1]:5432/x', 'postgres://localhost/x']) {
    for (const env of [{ PG_CA_CERT: CA1 }, { PG_TLS_STRICT: '1' }, { PG_CA_CERT: 'lixo', PG_TLS_STRICT: '1' }]) {
      const c = R.pgConnectionConfig(u, { env, ...quiet });
      assert.deepEqual(c, { connectionString: u, ssl: false, tlsMode: 'local', caCount: 0 });
      assert.equal(R.tlsModeFor(u, env), 'local');
    }
  }
});

// ------------------------------------------------------------------ 8) as duas cópias do helper
await t('8. api/_lib/ssl.mjs é cópia idêntica de src/db/ssl.js e responde igual', () => {
  assert.equal(fs.readFileSync(path.join(root, 'api/_lib/ssl.mjs'), 'utf8'), fs.readFileSync(path.join(root, 'src/db/ssl.js'), 'utf8'),
    'api/_lib/ssl.mjs difere de src/db/ssl.js — copie: cp src/db/ssl.js api/_lib/ssl.mjs');
  assert.deepEqual(Object.keys(A).sort(), Object.keys(R).sort());
  const envs = [{}, { PG_TLS_STRICT: '1' }, { PG_CA_CERT: CA1 }, { PG_CA_CERT: CA1 + CA2 }, { PG_CA_CERT_B64: Buffer.from(CA2).toString('base64') }, { PG_CA_CERT: 'lixo' }];
  const run = (M, u, env, o) => { try { return M.pgConnectionConfig(u, { env, ...quiet, ...o }); } catch (e) { return { error: e.code, message: e.message }; } };
  for (const u of COMPAT_URLS) for (const env of envs) for (const o of [{}, { detectLocal: false }]) {
    assert.deepEqual(run(A, u, env, o), run(R, u, env, o));
    assert.equal(A.tlsModeFor(u, env, o), R.tlsModeFor(u, env, o));
  }
});

// ------------------------------------------------------------------ 9) os pontos de conexão usam o helper
await t('9. nenhum rejectUnauthorized solto fora do helper; todo new pg.Pool/Client de src/api/tools usa pgConnectionConfig', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(path.join(d, e.name))) : /\.m?js$/.test(e.name) ? [path.join(d, e.name)] : []));
  const files = ['src', 'api', 'tools'].flatMap((d) => walk(path.join(root, d)));
  const rel = (f) => path.relative(root, f).split(path.sep).join('/');
  const loose = files.filter((f) => !/^(src\/db\/ssl\.js|api\/_lib\/ssl\.mjs)$/.test(rel(f)) && /rejectUnauthorized/.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(loose.map(rel), []);
  const users = files.filter((f) => /new pg\.(Pool|Client)\(/.test(fs.readFileSync(f, 'utf8'))).map(rel).sort();
  assert.deepEqual(users, ['api/_lib/db.mjs', 'src/db-health.js', 'src/db/pg.js', 'src/opportunity-read.js', 'tools/db-diagnose.mjs']);
  for (const f of users) assert.match(fs.readFileSync(path.join(root, f), 'utf8'), /pgConnectionConfig/, f);
});

await t('10. pontos de conexão de verdade (sem conectar): mesma config de antes sem variável; CA e estrito chegam ao driver', async () => {
  const { readDbHealth } = await import('../src/db-health.js');
  const { readOfficial } = await import('../src/opportunity-read.js');
  const seen = [];
  const loadPg = async () => ({ default: { Client: class { constructor(cfg) { seen.push(cfg); } on() {} connect() { return Promise.reject(Object.assign(new Error('recusado'), { code: 'ECONNREFUSED' })); } query() {} end() { return Promise.resolve(); } } } });
  const url = `${URL_REMOTE}?sslmode=require`;
  for (const call of [(env) => readDbHealth({ env, loadPg, timeoutMs: 500 }), (env) => readOfficial(['x'], { env, loadPg, timeoutMs: 500 })]) {
    seen.length = 0;
    let r = await call({ DATABASE_URL: url });
    assert.equal(r.status, 'error'); assert.equal(seen[0].connectionString, url); assert.deepEqual(seen[0].ssl, { rejectUnauthorized: false });
    r = await call({ DATABASE_URL: url, PG_CA_CERT: CA1 });
    assert.equal(seen[1].connectionString, URL_REMOTE); assert.equal(seen[1].ssl.rejectUnauthorized, true); assert.deepEqual(seen[1].ssl.ca, [CA1]);
    // estrito sem CA: não lança, não conecta e não vaza a URL
    r = await call({ DATABASE_URL: url, PG_TLS_STRICT: '1' });
    assert.equal(r.status, 'error'); assert.equal(r.reason, 'PG_TLS_STRICT'); assert.equal(seen.length, 2);
    for (const s of SECRETS) assert.equal(JSON.stringify(r).includes(s), false);
  }
  // src/db/pg.js e api/_lib/db.mjs: o Pool é criado sem conectar; confere as opções que recebeu
  const env0 = { DATABASE_URL: process.env.DATABASE_URL, API_DATABASE_URL: process.env.API_DATABASE_URL };
  try {
    process.env.DATABASE_URL = url; process.env.API_DATABASE_URL = url;
    const db = await import('../src/db/pg.js');
    const p = await db.pool();
    assert.equal(p.options.connectionString, url); assert.deepEqual(p.options.ssl, { rejectUnauthorized: false });
    await db.close();
    const api = await import('../api/_lib/db.mjs');
    const ap = await api.apiPool();
    assert.equal(ap.options.connectionString, url); assert.deepEqual(ap.options.ssl, { rejectUnauthorized: false });
    await api.closeApiPool();
    process.env.PG_CA_CERT = CA1;
    const p2 = await db.pool();
    assert.equal(p2.options.connectionString, URL_REMOTE); assert.equal(p2.options.ssl.rejectUnauthorized, true);
    await db.close();
    process.env.PG_TLS_STRICT = '1'; delete process.env.PG_CA_CERT;
    await assert.rejects(() => api.apiPool(), (e) => e.code === 'PG_TLS_STRICT');
  } finally {
    for (const k of ['PG_CA_CERT', 'PG_TLS_STRICT']) delete process.env[k];
    for (const [k, v] of Object.entries(env0)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

// ------------------------------------------------------------------ 11) workflows: variáveis opcionais ao lado do banco
await t('11. workflows: todo bloco com o Secret DATABASE_URL repassa PG_CA_CERT e PG_TLS_STRICT, sem torná-los obrigatórios', () => {
  const WF = path.join(root, '.github/workflows');
  let blocksWithDb = 0;
  for (const f of fs.readdirSync(WF).filter((x) => /\.ya?ml$/.test(x))) {
    const src = fs.readFileSync(path.join(WF, f), 'utf8');
    for (const b of src.split(/\n(?=\s*- name:|\s*- uses:|\s*- run:|\s{2}\w[\w-]*:\s*$)/)) {
      if (!/DATABASE_URL:\s*'?\$\{\{\s*secrets\.DATABASE_URL/.test(b)) continue;
      blocksWithDb++;
      assert.match(b, /PG_CA_CERT:\s*'?\$\{\{\s*secrets\.PG_CA_CERT\s*\}\}/, `${f}: bloco com DATABASE_URL sem PG_CA_CERT`);
      assert.match(b, /PG_TLS_STRICT:\s*'?\$\{\{[^}]*\bvars\.PG_TLS_STRICT\b[^}]*\}\}/, `${f}: bloco com DATABASE_URL sem PG_TLS_STRICT`);
    }
    // nenhum passo exige a CA (a ausência só gera aviso)
    assert.doesNotMatch(src, /PG_CA_CERT[^\n]*\|\|[^\n]*exit\s+1|\$PG_CA_CERT"?\s*\]\s*\|\|\s*\{[^}]*exit\s+1/, `${f}: PG_CA_CERT não pode ser obrigatório`);
  }
  assert.ok(blocksWithDb >= 7, 'blocos com DATABASE_URL: ' + blocksWithDb);
  const tlsWf = fs.readFileSync(path.join(WF, 'db-tls.yml'), 'utf8');
  assert.match(tlsWf, /^on:\s*\n\s*workflow_dispatch:/m, 'db-tls.yml só manual');
  assert.doesNotMatch(tlsWf, /schedule:|push:|pull_request/);
  assert.match(tlsWf, /permissions:\s*\n\s*contents: read\s*\n/, 'db-tls.yml só leitura');
  assert.doesNotMatch(tlsWf, /db-migrate|db-sync|git push/);
});

console.log(`OK — TLS do PostgreSQL (modo compatível): ${n} testes`);
