// TLS das conexões PostgreSQL (Lote 6 — Segurança). Arquivo IDÊNTICO em src/db/ssl.js (robô e ferramentas) e
// api/_lib/ssl.mjs (funções da Vercel, que não enxergam src/): test/tls-tests.js confere que as duas cópias são iguais.
//
// Regras:
//  - host local (localhost, 127.0.0.1, ::1) → sem TLS (tlsMode 'local');
//  - PG_CA_CERT (PEM, aceita vários certificados no mesmo texto) ou PG_CA_CERT_B64 (o mesmo arquivo em base64, PEM ou
//    DER) → TLS verificado: { ca, rejectUnauthorized: true, servername } (tlsMode 'verify'). Node confere a cadeia e o
//    nome do host;
//  - sem CA → mantém o comportamento antigo { rejectUnauthorized: false } (tlsMode 'no-verify') e avisa UMA vez por
//    processo; com PG_TLS_STRICT=1 recusa conectar.
// Os parâmetros ssl* da URL (sslmode, sslrootcert...) são retirados: no node-postgres eles SOBRESCREVEM o objeto ssl
// (connection-parameters.js faz Object.assign com o resultado do parse da URL) e jogariam fora a CA.
// Nada aqui escreve URL, senha, usuário ou host em log. Ver docs/tls.md.
import crypto from 'node:crypto';
import net from 'node:net';

// parâmetros da URL que mexem no TLS do node-postgres (pg-connection-string 2.x)
export const SSL_URL_PARAMS = ['ssl', 'sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'sslpassword', 'uselibpqcompat'];
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const PEM_RE = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;

let warned = false;
/** Só para testes: permite verificar de novo o aviso "uma vez por processo". */
export function _resetTlsWarning() { warned = false; }

const on = (v) => /^(1|true|sim|yes)$/i.test(String(v ?? '').trim());

/** Partes da URL sem usar new URL (senha com caractere especial não quebra): host e posição da query. */
function splitUrl(url) {
  const s = String(url || '');
  const scheme = s.indexOf('://');
  const afterScheme = scheme >= 0 ? scheme + 3 : 0;
  const at = s.lastIndexOf('@');
  const hostStart = at >= afterScheme ? at + 1 : afterScheme;
  const q = s.indexOf('?', hostStart);
  const slash = s.indexOf('/', hostStart);
  const hostEnd = [slash, q, s.length].filter((i) => i >= 0).reduce((a, b) => Math.min(a, b));
  let host = s.slice(hostStart, hostEnd);
  if (host.startsWith('[')) host = host.slice(1, host.indexOf(']') > 0 ? host.indexOf(']') : undefined);   // [ipv6]:porta
  else host = host.replace(/:\d*$/, '');
  try { host = decodeURIComponent(host); } catch { /* fica como está */ }
  return { s, host: host.toLowerCase(), q };
}

/** Host da URL de conexão (minúsculo, sem porta). */
export function pgHost(url) { return splitUrl(url).host; }

/** Retira da URL os parâmetros ssl* (o resto da query fica igual, na mesma ordem). */
export function stripSslParams(url) {
  const { s, q } = splitUrl(url);
  if (q < 0) return s;
  const hash = s.indexOf('#', q);
  const query = s.slice(q + 1, hash >= 0 ? hash : undefined);
  const kept = query.split('&').filter((p) => {
    if (!p) return false;
    let k = p.split('=')[0];
    try { k = decodeURIComponent(k); } catch { /* chave estranha: compara crua */ }
    return !SSL_URL_PARAMS.includes(k.toLowerCase());
  });
  return s.slice(0, q) + (kept.length ? '?' + kept.join('&') : '') + (hash >= 0 ? s.slice(hash) : '');
}

const isLocal = (host) => LOCAL_HOSTS.has(host);

/** DER (bytes) → PEM. */
const derToPem = (buf) => `-----BEGIN CERTIFICATE-----\n${buf.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`;

/**
 * CA configurada no ambiente: lista de certificados PEM, ou null se nenhuma variável estiver preenchida.
 * Lança erro (sem conteúdo da variável) se estiver preenchida mas inválida.
 */
export function readCa(env = process.env) {
  let text = String(env.PG_CA_CERT ?? '').trim();
  const b64 = String(env.PG_CA_CERT_B64 ?? '').replace(/\s+/g, '');
  if (!text && !b64) return null;
  if (!text) {
    const buf = Buffer.from(b64, 'base64');
    const asText = buf.toString('utf8');
    text = asText.includes('-----BEGIN CERTIFICATE-----') ? asText : (buf.length ? derToPem(buf) : '');
  }
  if (!text.includes('\n') && text.includes('\\n')) text = text.replace(/\\n/g, '\n');   // colado numa linha só com \n literal
  const certs = (text.match(PEM_RE) || []).map((c) => c.replace(/\r/g, '') + '\n');
  if (!certs.length) throw Object.assign(new Error('PG_CA_CERT inválido: nenhum certificado PEM (-----BEGIN CERTIFICATE-----) encontrado'), { code: 'PG_CA_INVALID' });
  certs.forEach((c, i) => {
    try { new crypto.X509Certificate(c); } catch { throw Object.assign(new Error(`PG_CA_CERT inválido: o certificado nº ${i + 1} não pôde ser lido`), { code: 'PG_CA_INVALID' }); }
  });
  return certs;
}

/** Validade de cada certificado da CA (para diagnóstico e rotação; não é segredo). */
export function caSummary(env = process.env) {
  const certs = readCa(env);
  if (!certs) return null;
  return certs.map((c) => { const x = new crypto.X509Certificate(c); return { subject: x.subject.replace(/\n/g, ', '), validFrom: x.validFrom, validTo: x.validTo }; });
}

/** Modo de TLS que a conexão usará, sem conectar e sem avisar: 'local' | 'verify' | 'no-verify' ('off' sem URL, 'invalid' se a CA configurada não puder ser lida). */
export function tlsModeFor(url, env = process.env) {
  if (!url) return 'off';
  if (isLocal(pgHost(url))) return 'local';
  try { return readCa(env) ? 'verify' : 'no-verify'; } catch { return 'invalid'; }
}

/**
 * Configuração de conexão para pg.Pool/pg.Client: { connectionString, ssl, tlsMode, caCount }.
 * Use sempre os dois campos juntos: new pg.Pool({ ...outros, connectionString, ssl }).
 * Lança erro se PG_TLS_STRICT=1 e não houver CA, ou se a CA configurada for inválida.
 */
export function pgConnectionConfig(url, { env = process.env, warn = (m) => console.warn(m) } = {}) {
  const connectionString = stripSslParams(url);
  const host = pgHost(url);
  if (isLocal(host)) return { connectionString, ssl: false, tlsMode: 'local', caCount: 0 };
  const ca = readCa(env);
  if (ca) {
    const ssl = { ca, rejectUnauthorized: true };
    if (host && net.isIP(host) === 0) ssl.servername = host;   // SNI e conferência do nome (IP não leva servername)
    return { connectionString, ssl, tlsMode: 'verify', caCount: ca.length };
  }
  if (on(env.PG_TLS_STRICT)) {
    throw Object.assign(new Error('PG_TLS_STRICT=1 e nenhuma CA configurada (PG_CA_CERT/PG_CA_CERT_B64): conexão recusada'), { code: 'PG_TLS_STRICT' });
  }
  if (!warned) {
    warned = true;
    try { warn('[tls] PG_CA_CERT não definido: conexão ao PostgreSQL com TLS SEM verificar o certificado do servidor (no-verify). Ver docs/tls.md.'); } catch { /* aviso nunca derruba */ }
  }
  return { connectionString, ssl: { rejectUnauthorized: false }, tlsMode: 'no-verify', caCount: 0 };
}
