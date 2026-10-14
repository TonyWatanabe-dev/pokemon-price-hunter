// #657 — workflow manual de prévia do Social Media: só workflow_dispatch, permissões mínimas, sem secrets, sem push,
// --dry-run obrigatório e entrada do canal validada antes de chegar ao shell.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const raw = fs.readFileSync(path.join(root, '.github/workflows/social-preview.yml'), 'utf8');
const y = raw.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };

t('1. só disparo manual', () => {
  assert.match(y, /^on:\n {2}workflow_dispatch:/m);
  assert.doesNotMatch(y, /schedule:|pull_request|push:|workflow_run|issues:/);
});
t('2. permissões mínimas, sem secrets nem credenciais persistidas', () => {
  assert.match(y, /^permissions:\n {2}contents: read$/m);
  assert.doesNotMatch(y, /secrets\.|write|id-token/);
  assert.match(y, /persist-credentials: false/);
});
t('3. roda a prévia em dry-run e nunca publica', () => {
  assert.match(y, /node tools\/social-preview\.mjs --dry-run /);
  assert.doesNotMatch(y, /SOCIAL_ENABLED|git push|curl |api\.telegram|graph\.facebook/);
});
t('4. canal só pela entrada choice, validado no shell e passado por variável', () => {
  assert.match(y, /type: choice\n {8}options: \[telegram, instagram\]/);
  assert.match(y, /CANAL: \$\{\{ inputs\.canal \}\}/);
  assert.match(y, /case "\$CANAL" in telegram\|instagram\)/);
  assert.doesNotMatch(y.split('run: |')[1].split('- uses:')[0], /\$\{\{/, 'sem expressão interpolada dentro do script');
});
t('5. artefato com retenção curta', () => {
  assert.match(y, /actions\/upload-artifact@[0-9a-f]{40}/);
  assert.match(y, /retention-days: 7/);
});
console.log(`✓ Workflow de prévia Social (#657): ${n} grupos passaram`);
