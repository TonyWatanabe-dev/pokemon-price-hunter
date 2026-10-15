// Runbook de restauração (docs/backup.md, "Ressincronizar o banco"): a sequência de comandos do documento precisa ser a
// mesma do passo de banco do robô (.github/workflows/hunter.yml). O ensaio de 15/10/2026 achou o documento sem
// db-stats (sem ele o Opportunity Engine avalia 0 produtos). Estático, sem rede nem banco.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const tools = (txt) => [...txt.matchAll(/^\s*node (tools\/db-[\w-]+\.mjs)/gm)].map((m) => m[1]);

const doc = read('docs/backup.md');
const sec = doc.slice(doc.indexOf('### Ressincronizar o banco'), doc.indexOf('## Disparo pelo cron-job.org'));
assert.ok(sec.length > 100, 'seção "Ressincronizar o banco" encontrada');
const block = sec.match(/```bash\n([\s\S]*?)```/)?.[1] || '';
const runbook = tools(block);

const hunter = read('.github/workflows/hunter.yml');
const robo = tools(hunter.slice(hunter.indexOf('node tools/db-migrate.mjs') - 20).split(/\n\s*- name:/)[0]);

assert.deepEqual(robo, ['tools/db-migrate.mjs', 'tools/db-grants.mjs', 'tools/db-sync.mjs', 'tools/db-import-references.mjs', 'tools/db-stats.mjs', 'tools/db-opportunity.mjs'], 'passo de banco do robô (referência)');
// O runbook repete a sequência do robô, na mesma ordem, e pode acrescentar a validação no fim.
assert.deepEqual(runbook.slice(0, robo.length), robo, 'docs/backup.md precisa seguir a ordem do hunter.yml: ' + JSON.stringify(runbook));
assert.deepEqual(runbook.slice(robo.length), ['tools/db-validate.mjs'], 'depois da sequência, só a validação');
for (const t of runbook) assert.ok(fs.existsSync(path.join(root, t)), t + ' existe');

// Ensaio registrado e citado.
assert.ok(fs.existsSync(path.join(root, 'docs/smoke/restore-drill-2026-10-15.md')), 'registro do ensaio');
assert.match(doc, /restore-drill-2026-10-15\.md/);
console.log('backup-runbook: sequência do docs/backup.md = hunter.yml (+ validação)');
