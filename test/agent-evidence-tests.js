// Contrato de evidência das decisões dos agentes (issue #91): decisão sem evidência válida é recusada;
// horário ausente ou inválido nunca é inventado e a evidência sai rotulada 'incompleta'.
// Importado por test/agents-integration-tests.js (roda no npm test). Puro: sem rede nem banco.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildEvidence, validateEvidence, EVIDENCE_BASIS, EVIDENCE_STATUS } from '../src/agents/evidence.js';
import { reviewCandidates } from '../src/agents/matching-review.js';
import { validateReviewProposal } from '../src/agents/handlers/review-propose.js';

let n = 0;
const test = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const catalog = JSON.parse(fs.readFileSync(new URL('../config/catalog.json', import.meta.url), 'utf8'));
const NOW = Date.parse('2026-10-10T12:00:00Z');
const base = { source: 'state.unmatched', url: 'https://loja.com.br/p/etb', reason: 'tipo de produto não identificado', basis: 'observado', observedAt: '2026-10-10T11:45:00Z' };

await test('evidência completa: todos os campos, status calculado', async () => {
  const r = buildEvidence(base, { now: NOW });
  assert.equal(r.ok, true);
  assert.deepEqual(r.evidence, { ...base, observedAt: '2026-10-10T11:45:00.000Z', status: 'completa', missing: [] });
  assert.equal(validateEvidence(r.evidence, { now: NOW }), null);
  assert.deepEqual([...EVIDENCE_BASIS], ['observado', 'inferido']); assert.deepEqual([...EVIDENCE_STATUS], ['completa', 'incompleta']);
});

await test('sem fonte, URL, motivo ou base válidos: decisão recusada', async () => {
  const bad = [
    [{ source: undefined }, /falta source/], [{ source: '   ' }, /falta source/],
    [{ url: undefined }, /falta url/], [{ url: '/p/etb' }, /falta url/], [{ url: 'javascript:alert(1)' }, /falta url/], [{ url: 'ftp://loja.com.br/x' }, /falta url/],
    [{ reason: '' }, /falta reason/], [{ reason: 42 }, /falta reason/],
    [{ basis: 'achismo' }, /falta basis/], [{ basis: undefined }, /falta basis/],
  ];
  for (const [patch, re] of bad) {
    const r = buildEvidence({ ...base, ...patch }, { now: NOW });
    assert.equal(r.ok, false, JSON.stringify(patch)); assert.match(r.error, /decisão sem evidência válida/); assert.match(r.error, re);
    assert.equal(r.evidence, undefined, 'recusa não devolve evidência parcial');
  }
  assert.equal(buildEvidence().ok, false);
  assert.equal(validateEvidence(null), 'evidência ausente'); assert.equal(validateEvidence([]), 'evidência ausente');
  assert.match(validateEvidence({ ...base, url: null, status: 'completa' }, { now: NOW }), /sem evidência válida/);
});

await test('horário ausente, ilegível ou no futuro: não é inventado, evidência incompleta', async () => {
  for (const observedAt of [undefined, null, '', 'ontem', '2026-10-10T13:00:00Z']) {
    const r = buildEvidence({ ...base, observedAt }, { now: NOW });
    assert.equal(r.ok, true, String(observedAt));
    assert.equal(r.evidence.observedAt, null, 'nunca substituído pelo relógio');
    assert.equal(r.evidence.status, 'incompleta'); assert.deepEqual(r.evidence.missing, ['observedAt']);
  }
  // pequena diferença de relógio entre máquinas é tolerada
  assert.equal(buildEvidence({ ...base, observedAt: '2026-10-10T12:04:00Z' }, { now: NOW }).evidence.status, 'completa');
});

await test('validateEvidence não confia em status nem horário vindos de fora', async () => {
  const inc = buildEvidence({ ...base, observedAt: null }, { now: NOW }).evidence;
  assert.equal(validateEvidence(inc, { now: NOW }), null);
  assert.match(validateEvidence({ ...inc, status: 'completa' }, { now: NOW }), /status de evidência incoerente/);
  assert.equal(validateEvidence({ ...base, status: 'completa' }, { now: NOW }), null);
  assert.match(validateEvidence({ ...base, observedAt: 'lixo', status: 'incompleta' }, { now: NOW }), /observedAt inválido/);
  assert.match(validateEvidence({ ...base, observedAt: '2027-01-01T00:00:00Z', status: 'incompleta' }, { now: NOW }), /observedAt inválido ou no futuro/);
});

await test('agente de matching: toda proposta leva evidência; sem evidência válida não vira proposta', async () => {
  const U = (title, why, url) => ({ store: 'loja', title, url, why: [why] });
  const state = {
    generatedAt: '2026-10-10T11:45:00Z',
    unmatched: [
      U('POKEMON TCG PACK 36 BOOSTER ESCURIDAO ABSOLUTA', 'tipo de produto não identificado', 'https://loja.com.br/p/pack36'),
      U('Booster Box ME02 Fogo Fantasmagórico', 'quantidade de boosters não informada', '/p/relativa'),        // URL sem origem: recusada
      U('Pokémon ETB Escuridão Absoluta', 'EAN diverge do catálogo', 'javascript:alert(1)'),                    // URL não http(s): recusada
    ],
    offers: [
      { id: 'o1', productId: 'me05-etb', storeId: 'omni', title: 'Caixa de Booster', url: 'https://omni.com.br/o1', matchConfidence: 0.6, source_timestamp: '2026-10-09T08:00:00Z' },
      { id: 'o2', productId: 'me05-etb', storeId: 'omni', title: 'Caixa de Booster', url: 'https://omni.com.br/o2', matchConfidence: 0.5 },     // sem horário da leitura
    ],
  };
  const c = reviewCandidates(state, { catalog, now: NOW });
  assert.deepEqual(c.map((x) => x.payload.proposal.kind), ['tipo_desconhecido', 'baixa_confianca', 'baixa_confianca']);
  for (const x of c) {
    assert.equal(validateReviewProposal(x.payload, { now: NOW }), null, 'payload continua passando no handler');
    assert.equal(validateEvidence(x.payload.proposal.evidence, { now: NOW }), null, 'evidência válida e coerente');
    assert.equal(x.payload.proposal.evidence.url, x.payload.proposal.url);
  }
  const [u, o1, o2] = c.map((x) => x.payload.proposal.evidence);
  assert.deepEqual(u, { source: 'state.unmatched', url: 'https://loja.com.br/p/pack36', reason: 'tipo de produto não identificado', basis: 'observado', observedAt: '2026-10-10T11:45:00.000Z', status: 'completa', missing: [] });
  assert.equal(o1.source, 'state.offers'); assert.equal(o1.basis, 'inferido'); assert.equal(o1.observedAt, '2026-10-09T08:00:00.000Z', 'horário da leitura da oferta, não da rodada');
  assert.match(o1.reason, /confiança 0\.6/);
  assert.equal(o2.observedAt, null, 'oferta sem horário não herda o horário da rodada'); assert.equal(o2.status, 'incompleta');
  // rodada sem generatedAt: recusas continuam indo para revisão, rotuladas como incompletas
  const semHora = reviewCandidates({ unmatched: state.unmatched }, { catalog, now: NOW });
  assert.equal(semHora.length, 1); assert.equal(semHora[0].payload.proposal.evidence.status, 'incompleta');
  assert.deepEqual(reviewCandidates(state, { catalog, now: NOW }), c, 'determinístico');
});

console.log(`✓ Evidência dos agentes: ${n} grupos de testes passaram (puro)`);
