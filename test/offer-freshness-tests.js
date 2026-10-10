// Frescor por oferta: reaproveitar leitura antiga (falha da fonte) nunca renova o horário nem inventa estoque.
// Puro (sem rede e sem banco): staleCopy / lastValidOf do robô + mapeamento para o banco.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { classify, usable } from '../api/_lib/freshness.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hunter-offfresh-'));
process.env.HUNTER_CONFIG_DIR = path.join(tmp, 'config'); process.env.HUNTER_DATA_DIR = path.join(tmp, 'data');
const { staleCopy, lastValidOf } = await import('../src/run.js');
const { offersRows } = await import('../src/core/mappers.js');

const NOW = Date.parse('2026-10-09T18:00:00.000Z');
const ago = (min) => new Date(NOW - min * 6e4).toISOString();
const live = { id: 'o1', productId: 'me05-etb', storeId: 'loja', title: 'ETB', url: 'https://loja/etb', price: 300, total: 300, shipping: null,
  shippingKnown: false, stock: 'IN_STOCK', matchConfidence: 0.9, confirmed: true, stale: false, source_timestamp: ago(45), firstSeen: ago(5000) };
const row = (o) => offersRows([o])[0];
let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };

t('1. falha da fonte: a cópia antiga mantém o horário da última leitura e vira estoque desconhecido', () => {
  const s = staleCopy(live);
  assert.equal(s.source_timestamp, live.source_timestamp, 'horário não é renovado');
  assert.equal(s.stale, true); assert.equal(s.stock, 'UNKNOWN');
  assert.deepEqual({ stock: s.lastValid.stock, total: s.lastValid.total, at: s.lastValid.at }, { stock: 'IN_STOCK', total: 300, at: live.source_timestamp });
});

t('2. falhas seguidas: nem horário nem lastValid mudam', () => {
  const s2 = staleCopy(staleCopy(live));
  assert.equal(s2.source_timestamp, live.source_timestamp);
  assert.equal(s2.lastValid.stock, 'IN_STOCK'); assert.equal(s2.lastValid.at, live.source_timestamp);
  assert.equal(lastValidOf(s2).stock, 'IN_STOCK', 'base de comparação é a leitura válida, não a falha');
  assert.equal(lastValidOf(staleCopy({ ...live, stale: true })), null, 'stale antiga sem lastValid: sem base');
});

t('3. banco: oferta reaproveitada vai como pending, estoque unknown e last_seen_at antigo', () => {
  const a = row(live); const s = row(staleCopy(live));
  assert.equal(a.status, 'active'); assert.equal(a.stock_status, 'in_stock');
  assert.equal(s.status, 'pending'); assert.equal(s.stock_status, 'unknown');
  assert.equal(s.last_seen_at, a.last_seen_at, 'last_seen_at não avança ao reaproveitar');
  assert.equal(new Date(s.last_seen_at).toISOString(), live.source_timestamp);
});

t('4. frescor derivado do horário da oferta: reaproveitada vai envelhecendo pelos limites configurados', () => {
  const s = staleCopy(live);
  assert.equal(classify(s.source_timestamp, NOW).status, 'atrasado');
  assert.equal(classify(s.source_timestamp, NOW + 60 * 6e4).status, 'desatualizado', '1 h depois, sem leitura nova, o mesmo horário já está desatualizado');
  assert.ok(usable(classify(s.source_timestamp, NOW)) && !usable(classify(s.source_timestamp, NOW + 60 * 6e4)));
  assert.equal(classify(s.source_timestamp, NOW + 25 * 60 * 6e4).status, 'indisponivel');
});

t('5. sem horário válido: desconhecido, nunca "atual"', () => {
  const r = row({ ...live, source_timestamp: null });
  assert.equal(r.last_seen_at, null);
  assert.equal(classify(r.last_seen_at, NOW).status, 'indisponivel');
});

console.log(`offer-freshness-tests: ${n} ok`);
