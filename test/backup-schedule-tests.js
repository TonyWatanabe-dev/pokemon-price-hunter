// Backup diário do ramo data (decisão do proprietário, 15/10/2026): teste estático de .github/workflows/backup-data.yml
// (agendamento, permissões, só main, ações fixadas) e da poda restrita ao prefixo data-backup/AAAA-MM-DD.
// Sem rede. Roda dentro de npm test (test/run-all.mjs).
import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planPrune, tagDate, PREFIX, KEEP_MIN, RETENTION_DEFAULT } from '../tools/data-backup.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const y = fs.readFileSync(path.join(root, '.github/workflows/backup-data.yml'), 'utf8');
const code = y.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

// Gatilhos: só schedule diário + workflow_dispatch.
const on = /^on:\n((?: {2}.*\n|\n)+?)(?=^\S)/m.exec(code);
assert.ok(on, 'bloco on:');
const triggers = [...on[1].matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1]).sort();
assert.deepEqual(triggers, ['schedule', 'workflow_dispatch'], 'gatilhos');
const crons = [...code.matchAll(/^\s+- cron: '([^']+)'/gm)].map((m) => m[1]);
assert.equal(crons.length, 1, 'um cron só');
const [min, hour, dom, mon, dow] = crons[0].split(/\s+/);
assert.deepEqual([dom, mon, dow], ['*', '*', '*'], 'todo dia');
assert.match(min, /^\d+$/); assert.match(hour, /^\d+$/);
assert.ok(Number(min) % 5 !== 0, `minuto não redondo (${min})`);
assert.ok(Number(hour) >= 2 && Number(hour) <= 6, `madrugada UTC, longe da rodada das 09:17 (${hour})`);

// Permissões mínimas: só contents: write (etiquetas), declarado no topo; nenhum secret.
const perms = /^permissions:\n((?: {2}.*\n)+)/m.exec(code);
assert.ok(perms, 'permissions no topo');
assert.deepEqual(perms[1].trim().split('\n').map((l) => l.trim()), ['contents: write']);
assert.equal((code.match(/permissions:/g) || []).length, 1, 'sem permissões extras por job');
assert.doesNotMatch(code, /secrets\./, 'nenhum secret');
assert.doesNotMatch(code, /write-all|pull_request_target/);

// Só a partir da main; concorrência própria; ações fixadas por SHA; roda o script do backup.
assert.match(code, /^ {4}if: github\.ref == 'refs\/heads\/main'$/m, 'job só na main');
assert.match(code, /group: data-backup/); assert.match(code, /cancel-in-progress: false/);
for (const m of code.matchAll(/uses:\s*(\S+)/g)) assert.match(m[1], /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/, m[1]);
assert.match(code, /run: node tools\/data-backup\.mjs$/m);
assert.doesNotMatch(code, /--dry-run|git push|git tag/, 'etiquetas só pelo script');

// Padrão de etiqueta e retenção restrita ao prefixo.
assert.equal(PREFIX, 'data-backup/'); assert.equal(KEEP_MIN, 3); assert.equal(RETENTION_DEFAULT, 14);
assert.ok(tagDate('data-backup/2026-10-01'));
for (const n of ['data-backup/antes-da-restauracao', 'data-backup/2026-10-01-extra', 'data-backup/2026-13-01', 'v1.0.0',
  'backup/2026-10-01', 'refs/heads/data', 'data', 'main', 'xdata-backup/2026-10-01']) assert.equal(tagDate(n), null, n);

const NOW = '2026-10-31T04:37:00Z';
const daily = Array.from({ length: 40 }, (_, i) => PREFIX + new Date(Date.parse('2026-10-31T00:00:00Z') - i * 864e5).toISOString().slice(0, 10));
const others = ['data-backup/antes-da-restauracao-2026-09-01', 'v0.1.0', 'data', 'main', 'backup/2026-09-01', 'data-backup/2026-09-01-manual'];
const pruned = planPrune([...daily, ...others], { now: NOW, retention: 14 });
assert.ok(pruned.length > 0, 'poda acontece');
for (const n of pruned) assert.match(n, /^data-backup\/\d{4}-\d{2}-\d{2}$/, `só etiquetas datadas: ${n}`);
for (const n of others) assert.ok(!pruned.includes(n), `nunca apaga ${n}`);
const kept = daily.filter((n) => !pruned.includes(n));
assert.equal(kept.length, 15, 'retenção de 14 dias mantém 15 retratos diários (hoje + 14)');
// Robô parado: tudo velho, ainda assim as 3 mais recentes ficam.
const stale = daily.slice(20);
assert.equal(stale.length - planPrune(stale, { now: NOW, retention: 14 }).length, KEEP_MIN);

// A poda envia só refs/tags/<nome datado>: nenhum outro refspec de exclusão no script.
const src = fs.readFileSync(path.join(root, 'tools/data-backup.mjs'), 'utf8');
const deletes = [...src.matchAll(/`:(refs\/[^`]*)`/g)].map((m) => m[1]);
assert.deepEqual(deletes, ['refs/tags/${n}'], 'exclusão só de refs/tags/ vindas do planPrune');
assert.match(src, /pruned\.map\(\(n\) => `:refs\/tags\/\$\{n\}`\)/);

// Documento e workflow concordam no horário.
const hhmm = `${hour.padStart(2, '0')}:${min.padStart(2, '0')} UTC`;
const doc = fs.readFileSync(path.join(root, 'docs/backup.md'), 'utf8');
assert.match(doc, /## Estado: ligado/); assert.ok(doc.includes(hhmm), `docs/backup.md cita ${hhmm}`);

console.log('backup-schedule-tests ok');
