// Segurança dos workflows (extraído da #17): toda ação (`uses:`) fixada por SHA de 40 caracteres com o comentário
// da versão (# vN, # vN.N ou # vN.N.N — qualquer major, para o Dependabot poder subir de versão), cada ação num único
// SHA/versão em todos os workflows, e Dependabot semanal para github-actions e npm; regras do Firestore em firebase/.
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
/** Comentário de versão aceito: v4, v6.1 ou v7.0.1 (qualquer major; nada além da versão). */
const versionComment = (c) => /^v\d+(\.\d+){0,2}$/.test(c);

await t('1. toda ação está fixada por SHA de 40 caracteres, com o comentário da versão (# vN)', () => {
  const bad = []; let total = 0;
  for (const { f, src } of workflows) for (const u of usesLines(src)) {
    total++;
    if (!pinned(u.ref)) bad.push(`${f}:${u.line} ${u.ref} (não fixada por SHA)`);
    else if (!u.ref.startsWith('./') && !versionComment(u.comment)) bad.push(`${f}:${u.line} ${u.ref} (falta o comentário # vN)`);
  }
  assert.deepEqual(bad, [], 'ações sem SHA fixo:\n' + bad.join('\n'));
  assert.ok(total >= 25, `uses encontrados: ${total}`);
});

await t('2. o detector recusa tag, ramo e SHA curto (e aceita ação local)', () => {
  const y = ['      - uses: actions/checkout@v4', '      - uses: actions/checkout@main', "      - uses: 'actions/checkout@11d5960'",
    '      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4', '    uses: ./.github/workflows/x.yml', '      - uses: actions/cache/save@0057852bfaa89a56745cba8c7296529d2fc39830 # v4'].join('\n');
  assert.deepEqual(usesLines(y).map((u) => pinned(u.ref)), [false, false, false, true, true, true]);
  assert.equal(usesLines(y)[3].comment, 'v4');
  const z = ['      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1',
    '      - uses: actions/cache/restore@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0',
    '      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0',
    '      - uses: actions/setup-node@v7 # v7', '      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1'].join('\n');
  assert.deepEqual(usesLines(z).map((u) => pinned(u.ref)), [true, true, true, false, true]);
  assert.deepEqual(usesLines(z).map((u) => versionComment(u.comment)), [true, true, true, true, false]);
  for (const c of ['v4', 'v6.1', 'v7.0.1', 'v12']) assert.ok(versionComment(c), c);
  for (const c of ['', 'v', '4', 'latest', 'main', 'v4 (antigo)', 'v7.0.1.2']) assert.ok(!versionComment(c), c);
});

await t('3. as ações v4 conhecidas estão nos SHAs registrados', () => {
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

await t('3b. cada ação usa um único SHA e uma única versão em todos os workflows (sem majors misturados)', () => {
  const seen = new Map(); const bad = [];
  for (const { f, src } of workflows) for (const u of usesLines(src)) {
    if (u.ref.startsWith('./') || u.ref.startsWith('docker://')) continue;
    const [name, sha] = u.ref.split('@'); const cur = `${sha} # ${u.comment}`;
    const prev = seen.get(name);
    if (!prev) seen.set(name, { cur, at: `${f}:${u.line}` });
    else if (prev.cur !== cur) bad.push(`${name}: ${f}:${u.line} (${cur}) difere de ${prev.at} (${prev.cur})`);
  }
  assert.deepEqual(bad, [], 'ação em versões diferentes:\n' + bad.join('\n'));
  assert.ok(seen.size >= 4, `ações distintas: ${seen.size}`);
});

await t('4. Dependabot cobre github-actions e npm toda semana, agrupado e com limite de PRs', () => {
  const d = fs.readFileSync(path.join(root, '.github/dependabot.yml'), 'utf8');
  assert.match(d, /^version:\s*2/m);
  const blocks = d.split(/\n(?=\s*- package-ecosystem:)/).slice(1);
  const eco = (name) => blocks.find((b) => new RegExp(`package-ecosystem:\\s*${name}\\s*$`, 'm').test(b));
  for (const name of ['github-actions', 'npm']) {
    const b = eco(name);
    assert.ok(b, `ecossistema ${name} ausente`);
    assert.match(b, /directory:\s*\/\s*$/m, name);
    assert.match(b, /interval:\s*weekly/, name);
    assert.match(b, /open-pull-requests-limit:\s*5\b/, name);
    assert.match(b, /groups:\s*\n\s+[\w-]+:\s*\n\s+patterns:\s*\["\*"\]/, name);
  }
});

// Residual da #17: regras do Firestore versionadas (sem publicação; ver docs/firestore-regras.md).
await t('5. regras do Firestore versionadas em firebase/ (não na raiz), iguais às publicadas', () => {
  for (const f of ['firebase.json', 'firestore.rules', '.firebaserc']) assert.equal(fs.existsSync(path.join(root, f)), false, `${f} na raiz implicaria publicação`);
  const r = fs.readFileSync(path.join(root, 'firebase/firestore.rules'), 'utf8');
  const code = r.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.match(code, /rules_version\s*=\s*'2'/);
  const own = "request.auth != null && request.auth.uid == uid";
  assert.ok(code.includes(`allow read, delete: if ${own};`), 'ler/apagar só o próprio documento');
  assert.ok(code.includes(`allow create, update: if ${own}`), 'gravar só o próprio documento');
  assert.match(code, /request\.resource\.data\.favorites\.size\(\) <= 200/);
  assert.match(code, /request\.resource\.data\.alerts\.size\(\) <= 50/);
  assert.match(code, /match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;\s*\}/);
  assert.equal((code.match(/allow /g) || []).length, 3, 'só as três regras');
  assert.doesNotMatch(code, /allow [a-z, ]*write: if request\.auth/, 'gravação sem lista de campos');
  // Lista de campos permitidos = campos que a página grava (perfil inicial, saveField, nome, updatedAt do save()).
  const allowed = JSON.parse(code.match(/keys\(\)\.hasOnly\((\[[^\]]*\])\)/)[1].replace(/'/g, '"')).sort();
  const page = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const written = new Set(['updatedAt', 'name']);
  for (const k of page.match(/const base=\{([^}]*)\}/)[1].matchAll(/(\w+):/g)) written.add(k[1]);
  for (const k of page.matchAll(/saveField\("(\w+)"/g)) written.add(k[1]);
  assert.deepEqual([...written].sort(), allowed, 'campos gravados pela página fora da lista das regras (ou sobrando)');
  assert.match(page, /old\.length>=200\)\{toast\("Limite de 200 favoritos"/, 'limite de favoritos da página = regra');
  assert.match(page, /old\.length>=50\)\{toast\("Limite de 50 alertas"/, 'limite de alertas da página = regra');
  const fj = JSON.parse(fs.readFileSync(path.join(root, 'firebase/firebase.json'), 'utf8'));
  assert.equal(fj.firestore.rules, 'firestore.rules');
  assert.match(fs.readFileSync(path.join(root, '.vercelignore'), 'utf8'), /^firebase\/$/m, 'firebase/ fora do deploy da Vercel');
  // o site só usa a coleção users (se outra aparecer, as regras precisam mudar junto)
  const acc = fs.readFileSync(path.join(root, 'tools/account.src.js'), 'utf8');
  assert.deepEqual([...new Set([...acc.matchAll(/doc\(db,\s*'([^']+)'/g)].map((m) => m[1]))], ['users']);
  assert.doesNotMatch(acc, /collection\(/);
});

console.log(`OK — segurança dos workflows: ${n} testes`);
