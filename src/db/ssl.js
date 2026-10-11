// TLS das conexões PostgreSQL. Arquivo IDÊNTICO em src/db/ssl.js (robô e ferramentas) e api/_lib/ssl.mjs (funções da
// Vercel, que não enxergam src/): test/tls-tests.js confere que as duas cópias são iguais. Ver docs/tls.md.
//
// Regras:
//  - MODO COMPATÍVEL (sem PG_CA_CERT/PG_CA_CERT_B64 e sem PG_TLS_STRICT): exatamente o comportamento anterior.
//    A URL vai intacta (sslmode=, ssl= etc. continuam valendo como antes), host local pela mesma regra de antes
//    (`@localhost` ou `@127.0.0.1`) → sem TLS; o resto → { rejectUnauthorized: false }. Só acrescenta um aviso no
//    log, UMA vez por processo;
//  - PG_CA_CERT (PEM, aceita vários certificados no mesmo texto) ou PG_CA_CERT_B64 (o arquivo em base64, PEM ou DER)
//    → TLS verificado: { ca, rejectUnauthorized: true, servername } (tlsMode 'verify'). O Node confere a cadeia e o
//    nome do host. Só neste modo os parâmetros ssl* saem da URL: no node-postgres eles SOBRESCREVEM o objeto ssl
//    (connection-parameters.js faz Object.assign com o resultado do parse da URL) e jogariam fora a CA;
//  - PG_TLS_STRICT=1 sem CA → recusa conectar (erro PG_TLS_STRICT). CA preenchida mas ilegível → erro PG_CA_INVALID;
//  - host local (localhost, 127.0.0.1, ::1) com CA ou estrito → sem TLS, URL intacta (desenvolvimento e CI local).
// Nada aqui escreve URL, senha, usuário, host ou o conteúdo da CA em log ou mensagem de erro.
import crypto from 'node:crypto';
import net from 'node:net';

// parâmetros da URL que mexem no TLS do node-postgres (pg-connection-string 2.x)
export const SSL_URL_PARAMS = ['ssl', 'sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'sslpassword', 'uselibpqcompat'];
// detecção de host local usada antes deste helper (mantida igual no modo compatível)
const LEGACY_LOCAL_RE = /@(localhost|127\.0\.0\.1)[:/]/;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const PEM_RE = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;

let warned = false;
/** Só para testes: permite verificar de novo o aviso "uma vez por processo". */
export function _resetTlsWarning() { warned = false; }

const on = (v) => /^(1|true|sim|yes)$/i.test(String(v ?? '').trim());
const filled = (v) => String(v ?? '').trim() !== '';

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

/** O ambiente pede algo além do modo compatível? (CA preenchida ou PG_TLS_STRICT ligado) */
export function tlsConfigured(env = process.env) {
  return filled(env.PG_CA_CERT) || filled(env.PG_CA_CERT_B64) || on(env.PG_TLS_STRICT);
}

const legacyLocal = (url) => LEGACY_LOCAL_RE.test(String(url ?? ''));
const anyLocal = (url) => legacyLocal(url) || LOCAL_HOSTS.has(pgHost(url));

/** DER (bytes) → PEM. */
const derToPem = (buf) => `-----BEGIN CERTIFICATE-----\n${buf.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`;
const invalid = (msg) => Object.assign(new Error(msg), { code: 'PG_CA_INVALID' });

/**
 * CA configurada no ambiente: lista de certificados PEM, ou null se nenhuma variável estiver preenchida.
 * Lança erro PG_CA_INVALID (sem o conteúdo da variável) se estiver preenchida mas não puder ser lida.
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
  if (!certs.length) throw invalid('PG_CA_CERT inválido: nenhum certificado PEM (-----BEGIN CERTIFICATE-----) encontrado. Ver docs/tls.md');
  certs.forEach((c, i) => {
    try { new crypto.X509Certificate(c); } catch { throw invalid(`PG_CA_CERT inválido: o certificado nº ${i + 1} não pôde ser lido. Ver docs/tls.md`); }
  });
  return certs;
}

/** Validade de cada certificado da CA (para diagnóstico e rotação; não é segredo). */
export function caSummary(env = process.env) {
  const certs = readCa(env);
  if (!certs) return null;
  return certs.map((c) => { const x = new crypto.X509Certificate(c); return { subject: x.subject.replace(/\n/g, ', '), validFrom: x.validFrom, validTo: x.validTo }; });
}

/**
 * Modo de TLS que a conexão usará, sem conectar, sem avisar e sem lançar:
 * 'off' (sem URL) | 'local' | 'no-verify' (modo compatível) | 'verify' | 'invalid' (CA ilegível) | 'refused' (estrito sem CA).
 */
export function tlsModeFor(url, env = process.env, { detectLocal = true } = {}) {
  if (!url) return 'off';
  if (!tlsConfigured(env)) return detectLocal && legacyLocal(url) ? 'local' : 'no-verify';
  if (detectLocal && anyLocal(url)) return 'local';
  try { return readCa(env) ? 'verify' : 'refused'; } catch { return 'invalid'; }
}

/**
 * Configuração de conexão para pg.Pool/pg.Client: { connectionString, ssl, tlsMode, caCount }.
 * Use sempre os dois campos juntos nas opções do Pool/Client do pg: { ...outros, connectionString, ssl }.
 * detectLocal: false trata todo host como remoto (tools/db-diagnose.mjs, que nunca desligou o TLS).
 * Lança erro se PG_TLS_STRICT=1 e não houver CA (PG_TLS_STRICT), ou se a CA configurada for inválida (PG_CA_INVALID).
 */
export function pgConnectionConfig(url, { env = process.env, warn = (m) => console.warn(m), detectLocal = true } = {}) {
  if (!tlsConfigured(env)) {
    // modo compatível: URL e ssl exatamente como antes deste helper
    if (detectLocal && legacyLocal(url)) return { connectionString: url, ssl: false, tlsMode: 'local', caCount: 0 };
    if (!warned) {
      warned = true;
      try { warn('[tls] PG_CA_CERT não definido: conexão ao PostgreSQL no modo compatível (certificado do servidor não verificado por CA própria). Ver docs/tls.md.'); } catch { /* aviso nunca derruba */ }
    }
    return { connectionString: url, ssl: { rejectUnauthorized: false }, tlsMode: 'no-verify', caCount: 0 };
  }
  if (detectLocal && anyLocal(url)) return { connectionString: url, ssl: false, tlsMode: 'local', caCount: 0 };
  const ca = readCa(env);
  if (!ca) {
    throw Object.assign(new Error('PG_TLS_STRICT=1 e nenhuma CA configurada (PG_CA_CERT/PG_CA_CERT_B64): conexão recusada. Ver docs/tls.md'), { code: 'PG_TLS_STRICT' });
  }
  const host = pgHost(url);
  const ssl = { ca, rejectUnauthorized: true };
  if (host && net.isIP(host) === 0) ssl.servername = host;   // SNI e conferência do nome (IP não leva servername)
  return { connectionString: stripSslParams(url), ssl, tlsMode: 'verify', caCount: ca.length };
}
