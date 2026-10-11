// Segurança dos workflows (extraído da #17): toda ação (`uses:`) fixada por SHA de 40 caracteres com o comentário
// da versão (# vN, # vN.N ou # vN.N.N — qualquer major, para o Dependabot poder subir de versão), cada ação num único
// SHA/versão em todos os workflows, e Dependabot semanal para github-actions e npm.
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

console.log(`OK — segurança dos workflows: ${n} testes`);
