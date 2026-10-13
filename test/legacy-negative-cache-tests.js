// Cache negativo curto do state.json (desempenho §4.5): após uma falha, pedidos nos próximos ~5 s
// não voltam à rede; um sucesso posterior limpa o estado.
import assert from 'node:assert/strict';
import { setLegacyLoader, legacyState } from '../api/_lib/legacy.mjs';

const T0 = Date.parse('2026-10-13T12:00:00.000Z');
const st = { products: [], offers: [], generatedAt: '2026-10-13T11:55:00.000Z' };

// 1) carregador falhando: duas chamadas seguidas → uma só tentativa
{
  let calls = 0; const boom = new Error('fora do ar');
  setLegacyLoader(async () => { calls++; throw boom; });
  await assert.rejects(legacyState({ now: T0 }), /fora do ar/);
  await assert.rejects(legacyState({ now: T0 + 100 }), /fora do ar/);
  await assert.rejects(legacyState({ now: T0 + 4_999 }), /fora do ar/);
  assert.equal(calls, 1, 'dentro de 5 s a falha é servida do cache negativo');
  // passado o prazo, tenta de novo
  await assert.rejects(legacyState({ now: T0 + 5_000 }), /fora do ar/);
  assert.equal(calls, 2, 'após 5 s volta a tentar');
}

// 2) sucesso posterior limpa o estado
{
  let calls = 0, ok = false;
  setLegacyLoader(async () => { calls++; if (!ok) throw new Error('falhou'); return st; });
  await assert.rejects(legacyState({ now: T0 }));
  ok = true;
  await assert.rejects(legacyState({ now: T0 + 1_000 }), 'ainda no cache negativo');
  assert.equal(calls, 1);
  const r = await legacyState({ now: T0 + 6_000 });
  assert.equal(calls, 2); assert.equal(r.st, st); assert.equal(r.cached, false);
  // cache positivo expirado (60 s) e nova falha: tenta uma vez e o cache negativo volta a valer
  ok = false;
  const a = await legacyState({ now: T0 + 70_000 }); assert.match(a.from, /cópia antiga/); assert.equal(a.st, st);
  const b = await legacyState({ now: T0 + 71_000 }); assert.match(b.from, /cópia antiga/);
  assert.equal(calls, 3);
}

// 3) rede (sem carregador): ambas as URLs falhando → uma rodada de fetch; cópia antiga servida sem nova rede
{
  setLegacyLoader(null);
  const realFetch = globalThis.fetch; let calls = 0, down = true;
  globalThis.fetch = async () => { calls++; return down ? new Response('erro', { status: 500 }) : new Response(JSON.stringify(st), { status: 200 }); };
  try {
    await assert.rejects(legacyState({ now: T0 }), /state\.json indisponível: HTTP 500/);
    assert.equal(calls, 2, 'tentou as duas URLs');
    await assert.rejects(legacyState({ now: T0 + 2_000 }), /state\.json indisponível/);
    assert.equal(calls, 2, 'não voltou à rede dentro de 5 s');
    down = false;
    const r = await legacyState({ now: T0 + 5_500 });
    assert.equal(calls, 3); assert.equal(r.from, 'ramo data'); assert.deepEqual(r.st, st);
    // cópia expirada e rede caída: serve a cópia antiga e não repete a rede nos 5 s seguintes
    down = true;
    const a = await legacyState({ now: T0 + 70_000 }); assert.equal(calls, 5); assert.match(a.from, /cópia antiga/);
    const b = await legacyState({ now: T0 + 72_000 }); assert.equal(calls, 5); assert.match(b.from, /cópia antiga/); assert.deepEqual(b.st, st);
  } finally { globalThis.fetch = realFetch; setLegacyLoader(null); }
}

console.log('✓ Cache negativo do state.json: falha repetida não volta à rede por 5 s; sucesso limpa');
