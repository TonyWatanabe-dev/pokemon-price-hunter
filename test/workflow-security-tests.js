// Lote 6 — segurança dos workflows e arquivos de segurança versionados:
// toda ação (`uses:`) fixada por SHA de 40 caracteres com o comentário da versão; Dependabot de github-actions;
// variáveis de TLS ao lado de todo DATABASE_URL; regras do Firestore fora da raiz (não implica publicação).
import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0;
async function t(name, fn) { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } }
const WF = path.join(root, '.github/workflows');
const workflows = fs.readdirSync(WF).filter((f) => /\.ya?ml$/.test(f)).map((f) => ({ f, src: fs.readFileSync(path.join(WF, f), 'utf8') }));

/** Todas as linhas `uses:` (passo ou job reutilizável), com o valor sem aspas e o comentário. */
export function usesLines(src) {
  return src.split('\n').map((l, i) => ({ l, i: i + 1 })).filter(({ l }) => /^\s*(-\s*)?uses\s*:/.test(l)).map(({ l, i }) => {
    const m = l.match(/uses\s*:\s*['"]?([^'"\s#]+)['"]?\s*(#\s*(.*))?$/);
    return { line: i, ref: m?.[1] || '', comment: m?.[3]?.trim() || '' };
  });
}
const pinned = (ref) => ref.startsWith('./') || ref.startsWith('docker://') || /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/.test(ref);

await t('1. toda ação está fixada por SHA de 40 caracteres, com o comentário da versão (# vN)', () => {
  const bad = []; let total = 0;
  for (const { f, src } of workflows) for (const u of usesLines(src)) {
    total++;
    if (!pinned(u.ref)) bad.push(`${f}:${u.line} ${u.ref} (não fixada por SHA)`);
    else if (!u.ref.startsWith('./') && !/^v\d+/.test(u.comment)) bad.push(`${f}:${u.line} ${u.ref} (falta o comentário # vN)`);
  }
  assert.deepEqual(bad, [], 'ações sem SHA fixo:\n' + bad.join('\n'));
  assert.ok(total >= 19, `uses encontrados: ${total}`);
});

await t('2. o detector recusa tag, ramo e SHA curto (e aceita ação local)', () => {
  const y = ['      - uses: actions/checkout@v4', '      - uses: actions/checkout@main', "      - uses: 'actions/checkout@11d5960'",
    '      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4', '    uses: ./.github/workflows/x.yml', '      - uses: actions/cache/save@0057852bfaa89a56745cba8c7296529d2fc39830 # v4'].join('\n');
  assert.deepEqual(usesLines(y).map((u) => pinned(u.ref)), [false, false, false, true, true, true]);
  assert.equal(usesLines(y)[3].comment, 'v4');
});

await t('3. as ações v4 conhecidas estão nos SHAs registrados (sem troca de major neste lote)', () => {
  const SHA = {
    'actions/checkout': '11d5960a326750d5838078e36cf38b85af677262', 'actions/setup-node': '49933ea5288caeca8642d1e84afbd3f7d6820020',
    'actions/upload-artifact': 'ea165f8d65b6e75b540449e92b4886f43607fa02', 'actions/download-artifact': 'd3f86a106a0bac45b974a628896c90dbdf5c8093',
    'actions/cache/restore': '0057852bfaa89a56745cba8c7296529d2fc39830', 'actions/cache/save': '0057852bfaa89a56745cba8c7296529d2fc39830',
  };
  for (const { f, src } of workflows) for (const u of usesLines(src)) {
    const [name, sha] = u.ref.split('@');
    if (SHA[name] && u.comment === 'v4') assert.equal(sha, SHA[name], `${f}:${u.line}`);
  }
});

await t('4. Dependabot cobre github-actions toda semana', () => {
  const d = fs.readFileSync(path.join(root, '.github/dependabot.yml'), 'utf8');
  assert.match(d, /^version:\s*2/m);
  assert.match(d, /package-ecosystem:\s*github-actions/);
  assert.match(d, /directory:\s*\/\s*$/m);
  assert.match(d, /interval:\s*weekly/);
});

await t('5. todo passo/job com DATABASE_URL do Secret também recebe PG_CA_CERT e PG_TLS_STRICT', () => {
  for (const { f, src } of workflows) {
    const blocks = src.split(/\n(?=\s*- name:|\s*- uses:|\s{2}\w[\w-]*:\s*$)/);
    for (const b of blocks) if (/DATABASE_URL:\s*\$\{\{\s*secrets\.DATABASE_URL/.test(b)) {
      assert.match(b, /PG_CA_CERT:\s*\$\{\{\s*secrets\.PG_CA_CERT\s*\}\}/, `${f}: bloco com DATABASE_URL sem PG_CA_CERT`);
      assert.match(b, /PG_TLS_STRICT:\s*\$\{\{[^}]*\bvars\.PG_TLS_STRICT\b[^}]*\}\}/, `${f}: bloco com DATABASE_URL sem PG_TLS_STRICT`);
    }
  }
});

await t('6. regras do Firestore versionadas em firebase/ (não na raiz) e mínimas', () => {
  for (const f of ['firebase.json', 'firestore.rules', '.firebaserc']) assert.equal(fs.existsSync(path.join(root, f)), false, `${f} na raiz implicaria publicação`);
  const r = fs.readFileSync(path.join(root, 'firebase/firestore.rules'), 'utf8');
  const code = r.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.match(code, /rules_version\s*=\s*'2'/);
  assert.match(code, /match \/users\/\{uid\}\s*\{\s*allow read, write: if request\.auth != null && request\.auth\.uid == uid;\s*\}/);
  assert.match(code, /match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;\s*\}/);
  assert.equal((code.match(/allow /g) || []).length, 2, 'só as duas regras');
  const fj = JSON.parse(fs.readFileSync(path.join(root, 'firebase/firebase.json'), 'utf8'));
  assert.equal(fj.firestore.rules, 'firestore.rules');
  // o site só usa a coleção users (se outra aparecer, as regras precisam mudar junto)
  const acc = fs.readFileSync(path.join(root, 'tools/account.src.js'), 'utf8');
  assert.deepEqual([...new Set([...acc.matchAll(/doc\(db,\s*'([^']+)'/g)].map((m) => m[1]))], ['users']);
  assert.doesNotMatch(acc, /collection\(/);
});

console.log(`OK — segurança dos workflows: ${n} testes`);
