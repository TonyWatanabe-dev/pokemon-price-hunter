// Issue #41 — situação da referência Copag por produto: ausente, desatualizada, confirmada e conflitante. Testes puros.
import assert from 'node:assert/strict';
import { copagReferenceStatus, resolveCurrentReference } from '../src/core/references.js';

let n = 0; const t = (name, fn) => { fn(); n++; };
const asOf = new Date('2026-10-08T12:00:00Z');
const row = (value, verified_at, x = {}) => ({ reference_kind: 'COPAG_OFFICIAL_CURRENT', verification_status: 'verified', value, source: 'copag_loja', confidence: 90, verified_at, ...x });

t('produto sem referência: missing, sem preço inventado', () => {
  for (const rows of [undefined, [], [row(349.99, '2026-10-01T00:00:00Z', { verification_status: 'pending' })],
    [row(349.99, '2026-10-01T00:00:00Z', { reference_kind: 'COPAG_OFFICIAL_HISTORICAL' })], [row(0, '2026-10-01T00:00:00Z')]]) {
    const s = copagReferenceStatus(rows, asOf);
    assert.equal(s.status, 'missing'); assert.deepEqual(s.prices, []);
  }
  assert.equal(resolveCurrentReference({ copag: null, asOf }).price, null);
});

t('produto com referência recente: confirmed, com preço e data', () => {
  const s = copagReferenceStatus([row(349.99, '2026-10-08T10:00:00Z'), row(349.99, '2026-10-05T10:00:00Z')], asOf);
  assert.deepEqual(s, { status: 'confirmed', prices: [349.99], verified_at: '2026-10-08T10:00:00.000Z' });
});

t('referência vencida (mais de 30 dias): stale, mantém a data e não oferece preço', () => {
  const s = copagReferenceStatus([row(349.99, '2026-08-01T00:00:00Z')], asOf);
  assert.equal(s.status, 'stale'); assert.deepEqual(s.prices, []); assert.equal(s.verified_at, '2026-08-01T00:00:00.000Z');
  assert.equal(copagReferenceStatus([row(349.99, null)], asOf).status, 'stale');
});

t('referência conflitante: conflicting, lista todos os preços e não escolhe um', () => {
  const s = copagReferenceStatus([row(349.99, '2026-10-08T10:00:00Z'), row(329.99, '2026-10-07T10:00:00Z')], asOf);
  assert.equal(s.status, 'conflicting'); assert.deepEqual(s.prices, [329.99, 349.99]);
});

t('linha vencida não gera conflito com a recente', () => {
  const s = copagReferenceStatus([row(349.99, '2026-10-08T10:00:00Z'), row(299.99, '2026-07-01T00:00:00Z')], asOf);
  assert.equal(s.status, 'confirmed'); assert.deepEqual(s.prices, [349.99]);
});

// verified_at mais recente é escolhido pelo INSTANTE, não pelo texto (o driver pg devolve Date; fusos podem variar)
const asOf10 = new Date('2026-10-10T12:00:00Z');
t('Date em dias diferentes da semana: escolhe a mais recente (09/10, não 08/10)', () => {
  const s = copagReferenceStatus([row(349.99, new Date('2026-10-09T10:00:00Z')), row(349.99, new Date('2026-10-08T10:00:00Z'))], asOf10);
  assert.equal(s.status, 'confirmed'); assert.equal(s.verified_at, '2026-10-09T10:00:00.000Z');
  const st = copagReferenceStatus([row(349.99, new Date('2026-08-06T00:00:00Z')), row(349.99, new Date('2026-08-05T00:00:00Z'))], asOf10);
  assert.equal(st.status, 'stale'); assert.equal(st.verified_at, '2026-08-06T00:00:00.000Z');
});

t('strings ISO em fusos diferentes: compara o instante e devolve ISO UTC', () => {
  const s = copagReferenceStatus([row(349.99, '2026-10-09T01:00:00-03:00'), row(349.99, '2026-10-09T02:00:00Z')], asOf10);
  assert.equal(s.verified_at, '2026-10-09T04:00:00.000Z');
  const st = copagReferenceStatus([row(349.99, '2026-08-01T22:00:00-03:00'), row(349.99, '2026-08-02T00:30:00Z')], asOf10);
  assert.equal(st.status, 'stale'); assert.equal(st.verified_at, '2026-08-02T01:00:00.000Z');
});

t('datas nulas ou inválidas são ignoradas e nunca viram a data escolhida', () => {
  const s = copagReferenceStatus([row(349.99, null), row(349.99, 'não é data'), row(349.99, new Date('x')), row(349.99, '2026-10-07T10:00:00Z'), row(349.99, undefined)], asOf10);
  assert.equal(s.status, 'confirmed'); assert.equal(s.verified_at, '2026-10-07T10:00:00.000Z');
  const st = copagReferenceStatus([row(349.99, 'lixo'), row(349.99, '2026-08-01T00:00:00Z'), row(349.99, null)], asOf10);
  assert.equal(st.status, 'stale'); assert.equal(st.verified_at, '2026-08-01T00:00:00.000Z');
  const only = copagReferenceStatus([row(349.99, 'lixo'), row(349.99, null)], asOf10);
  assert.deepEqual(only, { status: 'stale', prices: [], verified_at: null });
});

t('lista vazia: missing sem data', () => {
  assert.deepEqual(copagReferenceStatus([], asOf10), { status: 'missing', prices: [], verified_at: null });
});

console.log(`copag-status-tests: ${n} ok`);

// Política única do preço Copag no site (robô e home da API): registrada aqui para não mexer no package.json.
await import('./copag-policy-tests.js');
