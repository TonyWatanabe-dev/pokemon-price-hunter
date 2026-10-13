// Limite diário de alertas por usuário (issue #459): capPerUser é pura e ainda não é usada na rodada.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
process.env.HUNTER_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-cfg-')); process.env.HUNTER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-data-'));
const { capPerUser } = await import('../src/alerts.js');

const hits = [{ key: 'a' }, { key: 'b' }, { key: 'c' }];
assert.deepEqual(capPerUser(hits, 2, 3), [{ key: 'a' }]);
assert.deepEqual(capPerUser(hits, 0, 2).map(h => h.key), ['a', 'b']);
assert.deepEqual(capPerUser(hits, 3, 3), []);
assert.deepEqual(capPerUser(hits, 5, 3), []);
assert.deepEqual(capPerUser(hits, 0, 10).map(h => h.key), ['a', 'b', 'c']);
assert.deepEqual(capPerUser(null, 0, 3), []);
assert.deepEqual(capPerUser(hits, 0, undefined), []);
assert.equal(hits.length, 3);
console.log('alerts-cap-tests: ok');
