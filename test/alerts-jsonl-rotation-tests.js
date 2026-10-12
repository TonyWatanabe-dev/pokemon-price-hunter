// Rotação de alerts.jsonl: após N+k appends o arquivo tem até N linhas e as últimas 200 seguem iguais.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
process.env.HUNTER_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rot-cfg-')); process.env.HUNTER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rot-data-'));
const { capJsonlLines, ALERTS_LOG_MAX_LINES } = await import('../src/alerts.js');
const { appendJsonl, readJsonl, dataPath } = await import('../src/db.js');
let n = 0; const t = async (name, fn) => { await fn(); n++; };

await t('abaixo do limite: nada a reescrever', () => {
  assert.equal(capJsonlLines('{"i":1}\n{"i":2}\n', 5), null);
  assert.equal(capJsonlLines('', 5), null);
});
await t('N+k appends: fica com N linhas e as últimas 200 não mudam', () => {
  const N = 300; const k = 50; const f = dataPath('alerts.jsonl');
  for (let i = 0; i < N + k; i++) {
    appendJsonl(f, [{ i }]);
    const kept = capJsonlLines(fs.readFileSync(f, 'utf8'), N); if (kept) fs.writeFileSync(f, kept);
  }
  const rows = readJsonl(f);
  assert.equal(rows.length, N);
  assert.deepEqual(rows.slice(-200).map((r) => r.i), Array.from({ length: 200 }, (_, j) => N + k - 200 + j));
  assert.equal(rows[0].i, k);
});
await t('limite padrão cobre as 200 linhas que GET /alerts lê', () => assert.ok(ALERTS_LOG_MAX_LINES >= 200));
console.log(`alerts-jsonl-rotation-tests: ${n} ok`);
