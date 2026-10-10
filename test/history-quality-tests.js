// Qualidade do histórico por dia (data/hist/<id>.json): pontos inválidos não viram preço, duplicatas e ordem, série curta.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hunter-hist-'));
process.env.HUNTER_DATA_DIR = path.join(tmp, 'data'); fs.mkdirSync(path.join(tmp, 'data/hist'), { recursive: true });
const { cleanPoints, histSummary, histPath, MIN_HIST_DAYS } = await import('../src/history.js');

// pontos inválidos são descartados (nunca viram preço); duplicata do dia fica com o menor; saída ordenada
{
  const r = cleanPoints([['2026-10-03', 120], ['2026-10-01', 100], ['2026-10-01', 90], ['2026-10-02', null], ['2026-10-02', 0], ['2026-10-02', -5], ['2026-10-02', NaN], ['2026-10-02', '80'], ['ontem', 70], null, ['2026-10-04']]);
  assert.deepEqual(r.pts, [['2026-10-01', 90], ['2026-10-03', 120]]);
  assert.equal(r.duplicates, 1); assert.equal(r.invalid, 8);
  assert.deepEqual(cleanPoints(undefined), { pts: [], invalid: 0, duplicates: 0 });
}

const write = (pid, stores) => fs.writeFileSync(histPath(pid), JSON.stringify({ productId: pid, stores }));

// série com menos de MIN_HIST_DAYS dias: resumo existe, mas marcado como insuficiente e sem queda inventada
{
  write('curta', { a: { name: 'A', pts: [['2026-10-01', 100], ['2026-10-02', 80]] } });
  const h = histSummary('curta');
  assert.equal(h.days, 2); assert.equal(h.enough, false); assert.ok(MIN_HIST_DAYS >= 3);
  assert.equal(h.drop7d, 0, 'série curta (100 → 80 em 2 dias) não entra no ranking "maior queda"');
  write('um-dia', { a: { name: 'A', pts: [['2026-10-02', 80]] } });
  assert.deepEqual({ ...histSummary('um-dia') }, { days: 1, from: '2026-10-02', enough: false, drop7d: 0 }, 'um dia só: sem queda');
}

// pontos corrompidos e desordenados não quebram nem criam queda falsa
{
  write('suja', { a: { name: 'A', pts: [['2026-10-03', 100], ['2026-10-01', 100], ['2026-10-02', null], ['2026-10-02', 0]] }, b: { name: 'B', pts: [['2026-10-03', 100], ['2026-10-01', 100], ['2026-10-01', 100]] } });
  const h = histSummary('suja');
  assert.equal(h.days, 2, 'dia com valor inválido não conta como observação'); assert.equal(h.drop7d, 0); assert.equal(h.enough, false);
}

// série suficiente com queda real; ponto de loja em janela de desconfiança fica de fora
{
  write('ok', { a: { name: 'A', pts: [['2026-10-01', 100], ['2026-10-02', 100], ['2026-10-03', 80]] }, b: { name: 'B', pts: [['2026-10-03', 10]] } });
  const h = histSummary('ok', { stores: ['b'], until: '2026-10-03' });
  assert.equal(h.enough, true); assert.equal(h.days, 3); assert.equal(h.drop7d, 0.2);
}
assert.equal(histSummary('inexistente'), null, 'sem arquivo: sem resumo');
console.log('OK — qualidade do histórico');
