// Chave de API do Google no repositório (alerta de secret scanning #1).
// A única chave permitida é a da configuração web do Firebase, que é pública por natureza: vai para o navegador em
// account.js. O que a protege são as restrições no Google Cloud (sites e APIs) e as regras do Firestore, não o sigilo.
// Estes testes garantem que: só existe UMA chave; ela fica só nos dois arquivos do Firebase web; o pacote servido
// (account.js) usa a mesma chave da fonte; e nenhum código de servidor, workflow ou dado carrega chave do Google.
// Nenhuma mensagem imprime a chave: só uma impressão digital curta (sha256).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const KEY = /AIza[0-9A-Za-z_-]{35}/g;
const fp = (k) => 'chave#' + createHash('sha256').update(k).digest('hex').slice(0, 10);
const ALLOWED = new Set(['tools/account.src.js', 'account.js']);

const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const found = new Map(); // arquivo -> Set(impressões)
const keys = new Set();
for (const f of files) {
  let txt;
  try { txt = fs.readFileSync(new URL(f, root), 'utf8'); } catch { continue; }
  if (txt.includes('\u0000')) continue; // binário
  for (const m of txt.matchAll(KEY)) {
    keys.add(m[0]);
    if (!found.has(f)) found.set(f, new Set());
    found.get(f).add(fp(m[0]));
  }
}
let n = 0; const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };

t('chave do Google só nos arquivos do Firebase web', () => {
  const outside = [...found.keys()].filter((f) => !ALLOWED.has(f));
  assert.deepEqual(outside, [], `chave do Google fora do Firebase web: ${outside.map((f) => `${f} (${[...found.get(f)].join(', ')})`).join('; ')}`);
});

t('uma única chave, igual na fonte e no pacote servido', () => {
  assert.equal(keys.size, 1, `esperada 1 chave, encontradas ${keys.size}: ${[...keys].map(fp).join(', ')}`);
  for (const f of ALLOWED) assert.ok(found.has(f), `${f} sem a chave do Firebase (pacote fora de sincronia com a fonte?)`);
});

t('a chave fica na configuração do Firebase (initializeApp), não em outro uso', () => {
  const src = fs.readFileSync(new URL('tools/account.src.js', root), 'utf8');
  const lines = src.split('\n').filter((l) => KEY.test(l)); KEY.lastIndex = 0;
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\s*apiKey:\s*'/, 'a chave deve aparecer só como apiKey da configuração web');
  const cfg = src.slice(src.indexOf('initializeApp({'), src.indexOf('});', src.indexOf('initializeApp({')));
  assert.match(cfg, /projectId:\s*'tcg-price-hunter'/);
});

t('o site só chama as APIs do Firebase que a chave precisa (CSP)', () => {
  const v = JSON.parse(fs.readFileSync(new URL('vercel.json', root), 'utf8'));
  const csp = v.headers.flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy').value;
  const connect = csp.split(';').map((s) => s.trim()).find((s) => s.startsWith('connect-src')).split(/\s+/).slice(1);
  const google = connect.filter((h) => /googleapis\.com/.test(h)).sort();
  // Se mudar, atualize também a lista de APIs permitidas da chave (docs/firebase-chave.md).
  assert.deepEqual(google, ['https://firestore.googleapis.com', 'https://identitytoolkit.googleapis.com', 'https://securetoken.googleapis.com', 'https://www.googleapis.com']);
});

t('pastas de servidor, workflows e dados não têm chave do Google', () => {
  const bad = [...found.keys()].filter((f) => /^(api|src|tools\/(?!account\.src\.js)|\.github|data|config|db)\//.test(f));
  assert.deepEqual(bad, []);
});

console.log(`✓ Chave do Firebase web: ${n} grupos passaram (${[...keys].map(fp).join(', ') || 'nenhuma chave'})`);
