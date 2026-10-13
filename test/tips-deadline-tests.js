// Pistas (src/tips.js): collectTips com prazo vencido não faz requisição e marca as fontes com reason "prazo".
// Sem rede: o fetch global falha o teste se for chamado.
import assert from 'node:assert/strict';
import { collectTips } from '../src/tips.js';

const cfg = { pelando: { buscas: ['pokemon booster'] }, telegram: ['@canalteste'] };
const realFetch = globalThis.fetch; let calls = 0;
globalThis.fetch = async () => { calls++; throw new Error('rede proibida no teste'); };
try {
  const r = await collectTips(cfg, [], () => {}, Date.now() - 1000);
  assert.equal(calls, 0, 'prazo vencido não pode fazer requisição');
  assert.deepEqual(r.tips, []);
  assert.equal(r.status.length, 2);
  for (const s of r.status) { assert.equal(s.ok, false); assert.equal(s.reason, 'prazo'); }
} finally { globalThis.fetch = realFetch; }
