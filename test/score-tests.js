// src/score.js: limites de isAnomalous (0,55× e 3×), validated de storeScore (≥ 50), loja sem evidência e ordem de pickPrice.
import assert from 'node:assert/strict';
import { isAnomalous, storeScore, pickPrice } from '../src/score.js';

// isAnomalous: abaixo de 0,55× ou acima de 3× da referência; o limite exato não é anômalo (comparação estrita)
{
  // msrp 1000 → limites exatos 550 e 3000 (sem erro de ponto flutuante)
  assert.equal(isAnomalous(550, 1000, null), false, 'exatamente 0,55× não é anômalo');
  assert.equal(isAnomalous(549.99, 1000, null), true, 'logo abaixo de 0,55× é anômalo');
  assert.equal(isAnomalous(550.01, 1000, null), false);
  assert.equal(isAnomalous(3000, 1000, null), false, 'exatamente 3× não é anômalo');
  assert.equal(isAnomalous(3000.01, 1000, null), true, 'logo acima de 3× é anômalo');
  assert.equal(isAnomalous(2999.99, 1000, null), false);
  // mesma régua para a média monitorada
  assert.equal(isAnomalous(11, null, 20), false);
  assert.equal(isAnomalous(10.99, null, 20), true);
  assert.equal(isAnomalous(60, null, 20), false);
  assert.equal(isAnomalous(60.01, null, 20), true);
  // comportamento real: 100 × 0,55 = 55.00000000000001 em ponto flutuante, então 55 com msrp 100 já conta como anômalo
  assert.equal(isAnomalous(55, 100, null), true, 'limite com erro de ponto flutuante (100 × 0,55 > 55)');
  assert.equal(isAnomalous(55.01, 100, null), false);
  assert.equal(isAnomalous(300, 100, null), false);
  // qualquer uma das referências basta; referência ausente/zero é ignorada
  assert.equal(isAnomalous(100, 100, 300), true, 'abaixo de 0,55× da média, mesmo dentro da faixa do msrp');
  assert.equal(isAnomalous(400, 300, 100), true, 'acima de 3× da média, mesmo dentro da faixa do msrp');
  assert.equal(isAnomalous(1, null, null), false);
  assert.equal(isAnomalous(1, 0, 0), false);
  assert.equal(isAnomalous(1e6, undefined, undefined), false);
}

// storeScore: validated a partir de 50 pontos (49 não valida)
{
  const s49 = storeScore({ evidence: { cnpj: '00.000.000/0001-00', rating: 4.9, reviewCount: 500 } }); // 20 + round(29,4)
  assert.equal(s49.score, 49); assert.equal(s49.validated, false);
  assert.deepEqual(s49.evidence, ['CNPJ', 'avaliação 4.9/5 (500)']);
  const s50 = storeScore({ evidence: { cnpj: '00.000.000/0001-00', rating: 5, reviewCount: 500 } }); // 20 + 30
  assert.equal(s50.score, 50); assert.equal(s50.validated, true);
  const s51 = storeScore({ evidence: { cnpj: 'x', officialStore: true, contact: 'x' } }, { checks: 10, ok: 0.5 }); // 20 + 25 + 5 + round(1)
  assert.equal(s51.score, 51); assert.equal(s51.validated, true);
  // nota limitada a 100
  const max = storeScore({ evidence: { cnpj: 'x', rating: 5, reviewCount: 1000, foundedYear: new Date().getFullYear() - 10, returnPolicyUrl: 'u', contact: 'c', officialStore: true } }, { checks: 10, ok: 10 });
  assert.equal(max.score, 100); assert.equal(max.validated, true);
}

// storeScore: sem nenhuma evidência → score null (não 0), não validada
{
  const vazio = { score: null, validated: false, evidence: [] };
  assert.deepEqual(storeScore({}), vazio);
  assert.deepEqual(storeScore({ evidence: {} }), vazio);
  assert.deepEqual(storeScore({ evidence: { rating: 5, reviewCount: 0 } }), vazio, 'avaliação sem contagem não é evidência');
  assert.deepEqual(storeScore({ evidence: {} }, { checks: 9, ok: 9 }), vazio, 'menos de 10 coletas não contam');
  // comportamento real: 10+ coletas sozinhas já são evidência
  const so = storeScore({ evidence: {} }, { checks: 10, ok: 10 });
  assert.equal(so.score, 20); assert.equal(so.validated, false); assert.deepEqual(so.evidence, ['histórico de coleta']);
}

// pickPrice: Pix > à vista > cartão > base; valores não positivos são pulados
{
  assert.deepEqual(pickPrice({ pix: 90, avista: 95, cartao: 100, base: 110 }), { value: 90, kind: 'pix' });
  assert.deepEqual(pickPrice({ avista: 95, cartao: 100, base: 110 }), { value: 95, kind: 'avista' });
  assert.deepEqual(pickPrice({ cartao: 100, base: 110 }), { value: 100, kind: 'cartao' });
  assert.deepEqual(pickPrice({ base: 110 }), { value: 110, kind: 'base' });
  assert.deepEqual(pickPrice({ base: 80, cartao: 100, pix: 120 }), { value: 120, kind: 'pix' }, 'ordem fixa, não o menor valor');
  assert.deepEqual(pickPrice({ pix: 0, avista: -1, cartao: null, base: 70 }), { value: 70, kind: 'base' });
  assert.deepEqual(pickPrice({}), { value: null, kind: null });
  assert.deepEqual(pickPrice(), { value: null, kind: null });
  assert.deepEqual(pickPrice({ pix: 0, base: 0 }), { value: null, kind: null });
}

console.log('OK — score.js (anomalia, STORE_SCORE, pickPrice)');
