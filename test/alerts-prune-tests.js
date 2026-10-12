// Poda de alerts-sent.json (issue #314): entrada sem pendente e mais velha que o limite sai; pendente e recente ficam.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
process.env.HUNTER_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'prune-cfg-')); process.env.HUNTER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'prune-data-'));
const { pruneSent, SENT_MAX_AGE_DAYS } = await import('../src/alerts.js');
let n = 0; const t = async (name, fn) => { await fn(); n++; };

const NOW = new Date('2026-10-12T12:00:00Z');
const ago = (days) => new Date(NOW.getTime() - days * 24 * 3600e3).toISOString();
const pending = (days) => ({ since: ago(days), msg: { text: 'x', url: 'https://loja/o1' }, alert: { kind: 'drop' } });
const sent = () => ({
  'r|p1': { at: ago(45), total: 39.9, offerId: 'o1' },                  // velha, sem pendente: sai
  'drop|o2': { at: ago(31), total: 20, offerId: 'o2' },                 // velha: sai
  'tip|t1': { at: ago(40), total: 10 },                                 // pista velha: sai
  'r|p2': { at: ago(2), total: 50, offerId: 'o3' },                     // recente: fica
  'r|p3': { at: ago(29.9), total: 50, offerId: 'o4' },                  // dentro do limite: fica
  'drop|o5': { at: ago(60), total: 15, offerId: 'o5', pending: pending(60) }, // pendente (mesmo velha): fica
  'tip|t2': { at: ago(45), total: 12, pending: pending(45) },           // pista pendente: fica
  'r|p4': { at: 'lixo', total: 9 },                                     // "at" inválido: fica (não é provadamente velha)
});

await t('velhas sem pendente saem; pendentes e recentes ficam', () => {
  const out = pruneSent(sent(), NOW, 30);
  assert.deepEqual(Object.keys(out).sort(), ['drop|o5', 'r|p2', 'r|p3', 'r|p4', 'tip|t2']);
  assert.deepEqual(out['r|p2'], sent()['r|p2'], 'entrada mantida segue igual');
});
await t('pura: não altera o objeto de entrada; aceita Date ou número', () => {
  const s = sent(); const before = JSON.stringify(s);
  pruneSent(s, NOW, 30); assert.equal(JSON.stringify(s), before);
  assert.deepEqual(pruneSent(s, NOW.getTime(), 30), pruneSent(s, NOW, 30));
});
await t('idempotente: podar de novo não muda nada', () => {
  const once = pruneSent(sent(), NOW, 30);
  assert.deepEqual(pruneSent(once, NOW, 30), once);
  assert.deepEqual(pruneSent(pruneSent(once, NOW, 30), NOW, 30), once);
});
await t('limite padrão e entradas vazias', () => {
  assert.equal(SENT_MAX_AGE_DAYS, 30);
  assert.deepEqual(Object.keys(pruneSent(sent(), NOW)).sort(), ['drop|o5', 'r|p2', 'r|p3', 'r|p4', 'tip|t2']);
  assert.deepEqual(pruneSent({}, NOW, 30), {}); assert.deepEqual(pruneSent(null, NOW, 30), {}); assert.deepEqual(pruneSent(undefined, NOW, 30), {});
  assert.deepEqual(Object.keys(pruneSent(sent(), NOW, 1)).sort(), ['drop|o5', 'r|p4', 'tip|t2'], 'limite menor poda mais');
});

console.log(`✓ Poda de alerts-sent.json (#314): ${n} grupos passaram`);
