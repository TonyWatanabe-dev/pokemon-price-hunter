// Escrita atômica de alerts.jsonl: com renameSync falhando, o original permanece íntegro.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
process.env.HUNTER_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'atm-cfg-')); process.env.HUNTER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'atm-data-'));
const { capAlertsLog } = await import('../src/run.js');
const { appendJsonl, readJsonl, dataPath } = await import('../src/db.js');
const f = dataPath('alerts.jsonl');
appendJsonl(f, Array.from({ length: 10 }, (_, i) => ({ i })));
const before = fs.readFileSync(f, 'utf8');
const orig = fs.renameSync; fs.renameSync = () => { throw new Error('EXDEV'); };
try { assert.throws(() => capAlertsLog(f, 5), /EXDEV/); } finally { fs.renameSync = orig; }
assert.equal(fs.readFileSync(f, 'utf8'), before);
assert.equal(fs.existsSync(f + '.tmp'), false);
assert.equal(capAlertsLog(f, 5), true);
assert.deepEqual(readJsonl(f).map((r) => r.i), [5, 6, 7, 8, 9]);
console.log('alerts-jsonl-atomic-tests: 2 ok');
