// Cadeia de suprimentos (#94): instalações nos workflows respeitam o lockfile e não rodam scripts de terceiros
// onde há secrets sensíveis sem necessidade.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const wf = (n) => fs.readFileSync(new URL(`../.github/workflows/${n}`, import.meta.url), 'utf8');
assert.match(wf('hunter.yml'), /npm ci --omit=dev/, 'hunter instala pelo lockfile');
assert.doesNotMatch(wf('hunter.yml'), /npm install --omit=dev/);
for (const n of ['social-whatsapp-auto.yml', 'social-whatsapp-parear.yml']) {
  assert.match(wf(n), /npm install --no-save --no-audit --no-fund --ignore-scripts '@whiskeysockets\/baileys@\d[^']*'/, `${n}: Baileys fixado e sem scripts`);
}
for (const f of fs.readdirSync(new URL('../.github/workflows/', import.meta.url))) {
  for (const m of wf(f).matchAll(/uses:\s*([^\s#]+)/g)) {
    if (m[1].startsWith('./')) continue;
    assert.match(m[1], /@[0-9a-f]{40}$/, `${f}: ação ${m[1]} sem SHA fixo`);
  }
}
console.log('supply-chain-tests ok');
