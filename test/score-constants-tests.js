// Constantes de anomalia (0,55× e 3×) e mínimo de dias de histórico em um só lugar: src/core/price-engine.js.
// src/score.js e src/history.js importam de lá; nenhum dos dois repete os números.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hunter-const-'));
process.env.HUNTER_DATA_DIR = path.join(tmp, 'data'); fs.mkdirSync(path.join(tmp, 'data/hist'), { recursive: true });
const PE = await import('../src/core/price-engine.js');
const { MIN_HIST_DAYS } = await import('../src/history.js');
const { isAnomalous } = await import('../src/score.js');
const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

// valores não mudaram
assert.equal(PE.PLAUSIBLE_MIN, 0.55); assert.equal(PE.PLAUSIBLE_MAX, 3); assert.equal(PE.MIN_HISTORY_DAYS, 3);
// history.js expõe o mesmo mínimo do Price Engine
assert.equal(MIN_HIST_DAYS, PE.MIN_HISTORY_DAYS);

// score.js e history.js importam as constantes do Price Engine e não repetem os números
for (const [f, names] of [['src/score.js', ['PLAUSIBLE_MIN', 'PLAUSIBLE_MAX']], ['src/history.js', ['PLAUSIBLE_MIN', 'PLAUSIBLE_MAX', 'MIN_HISTORY_DAYS']]]) {
  const src = read(f);
  const imp = src.match(/import\s*\{([^}]*)\}\s*from\s*'\.\/core\/price-engine\.js'/);
  assert.ok(imp, `${f} importa de ./core/price-engine.js`);
  for (const n of names) assert.match(imp[1], new RegExp(`\\b${n}\\b`), `${f} importa ${n}`);
  const code = src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.doesNotMatch(code, /0\.55/, `${f} não repete 0,55`);
  assert.doesNotMatch(code, /\*\s*3\b/, `${f} não repete o limite 3×`);
  assert.doesNotMatch(code, /MIN_HIST(?:ORY)?_DAYS\s*=\s*\d/, `${f} não redefine o mínimo de dias`);
}

// isAnomalous segue os limites do Price Engine (limite exato não é anômalo)
assert.equal(isAnomalous(1000 * PE.PLAUSIBLE_MIN, 1000, null), false);
assert.equal(isAnomalous(1000 * PE.PLAUSIBLE_MIN - 0.01, 1000, null), true);
assert.equal(isAnomalous(1000 * PE.PLAUSIBLE_MAX, 1000, null), false);
assert.equal(isAnomalous(1000 * PE.PLAUSIBLE_MAX + 0.01, 1000, null), true);

fs.rmSync(tmp, { recursive: true, force: true });
console.log('OK — constantes de anomalia e histórico vêm do Price Engine');
