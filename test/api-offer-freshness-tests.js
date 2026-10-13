// Issue #625 — frescor por oferta na API: cada oferta traz `freshness` calculado pelo horário da PRÓPRIA leitura
// (last_seen_at / source_timestamp), com os limites já existentes (LIMITS). Nunca herda o frescor da loja ou da resposta.
import assert from 'node:assert/strict';
import { offerFreshness, classify, LIMITS, setFreshnessClock } from '../api/_lib/freshness.mjs';
import { stateProductOffers } from '../api/_lib/read-state.mjs';

const NOW = Date.parse('2026-10-13T12:00:00Z');
const ago = (min) => new Date(NOW - min * 60e3).toISOString();
let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };

t('1. offerFreshness usa os limites existentes e só devolve status + idade', () => {
  assert.deepEqual(offerFreshness(ago(10), NOW), { status: 'atual', ageMin: 10 });
  assert.deepEqual(offerFreshness(ago(LIMITS.ATUAL_MIN + 1), NOW), { status: 'atrasado', ageMin: 31 });
  assert.deepEqual(offerFreshness(ago(LIMITS.ATRASADO_MIN + 1), NOW), { status: 'desatualizado', ageMin: 91 });
  assert.equal(offerFreshness(ago(LIMITS.EXPIRA_MIN + 1), NOW).status, 'indisponivel');
  for (const at of [ago(10), ago(200), null]) assert.equal(offerFreshness(at, NOW).status, classify(at, NOW).status, 'mesma regra do classify');
});

t('2. sem horário, inválido ou no futuro (> 5 min) = indisponível, sem idade', () => {
  for (const at of [null, undefined, '', 'ontem', new Date(NOW + 10 * 60e3).toISOString()]) {
    assert.deepEqual(offerFreshness(at, NOW), { status: 'indisponivel', ageMin: null }, String(at));
  }
  assert.equal(offerFreshness(new Date(NOW + 2 * 60e3).toISOString(), NOW).status, 'atual', 'tolerância de relógio de 5 min');
});

t('3. API (state.json): ofertas mistas da mesma loja e resposta têm cada uma o seu frescor', () => {
  setFreshnessClock(() => NOW);
  try {
    const base = { productId: 'me04-box36', storeId: 'vt', storeName: 'Loja', url: 'https://vt.test/p', title: 'Box', price: 900, total: 900, shippingKnown: true, shipping: 0, stock: 'IN_STOCK' };
    const st = { generatedAt: ago(0), dataAt: ago(0), products: [{ id: 'me04-box36', collection: 'me04', collectionName: 'ME04', type: 'booster_box', boosters: 36 }],
      offers: [
        { ...base, id: 'atual', source_timestamp: ago(5) },
        { ...base, id: 'atrasada', source_timestamp: ago(60) },
        { ...base, id: 'desatualizada', source_timestamp: ago(300) },
        { ...base, id: 'stale', stale: true, source_timestamp: ago(45) },
        { ...base, id: 'sem-horario' },
      ] };
    const items = stateProductOffers(st, 'me04-box36', { page: 1, limit: 10, todas: true }).items;
    const by = Object.fromEntries(items.map((i) => [i.id, i]));
    assert.equal(by.atual.freshness.status, 'atual');
    assert.equal(by.atrasada.freshness.status, 'atrasado');
    assert.equal(by.desatualizada.freshness.status, 'desatualizado');
    assert.deepEqual([by.stale.status, by.stale.freshness.status], ['pending', 'atrasado'], 'stale continua stale e mostra a idade real');
    assert.deepEqual(by['sem-horario'].freshness, { status: 'indisponivel', ageMin: null }, 'resposta atual não empresta frescor');
    for (const i of items) assert.ok('last_seen_at' in i && 'status' in i, 'campos atuais preservados');
  } finally { setFreshnessClock(null); }
});

console.log(`✓ Frescor por oferta (#625): ${n} grupos de testes passaram`);
