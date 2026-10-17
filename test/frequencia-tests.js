// Frequência adaptativa: espera quem não muda, volta ao ritmo quando muda, 6 h para quem lê e não casa nada.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { aposLeitura, adiar, assinatura, sempre, MAX_MIN, ZERO_MIN, ZERO_RODADAS, ligada } from '../src/frequencia.js';

const loja = { id: 'x', platform: 'jsonld' };
assert.equal(assinatura(['a|1|IN', 'b|2|IN']), assinatura(['b|2|IN', 'a|1|IN']), 'ordem não importa');
const src = {};
assert.equal(aposLeitura(src, loja, { sig: 's1', matched: 3, listings: 5 }), 0, '1ª leitura: toda rodada');
assert.equal(aposLeitura(src, loja, { sig: 's1', matched: 3, listings: 5 }), 30);
assert.equal(aposLeitura(src, loja, { sig: 's1', matched: 3, listings: 5 }), 60);
assert.equal(aposLeitura(src, loja, { sig: 's1', matched: 3, listings: 5 }), 120);
assert.equal(aposLeitura(src, loja, { sig: 's1', matched: 3, listings: 5 }), MAX_MIN, 'teto de 2 h (< 3 h da leitura recente)');
assert.equal(aposLeitura(src, loja, { sig: 's2', matched: 3, listings: 5 }), 0, 'mudou: volta a toda rodada');
const z = {}; for (let i = 0; i < ZERO_RODADAS; i++) aposLeitura(z, loja, { sig: 'z', matched: 0, listings: 40 });
assert.equal(z.intervalMin, ZERO_MIN, 'lê e não casa nada por várias rodadas: 6 h');
aposLeitura(z, loja, { sig: 'z2', matched: 2, listings: 40 }); assert.equal(z.intervalMin, 0, 'passou a casar: volta sozinha');
const ml = {}; aposLeitura(ml, { id: 'mercadolivre', platform: 'mercadolivre' }, { sig: 'a', matched: 1, listings: 1 }); aposLeitura(ml, { id: 'mercadolivre', platform: 'mercadolivre' }, { sig: 'a', matched: 1, listings: 1 });
assert.equal(ml.intervalMin, 0, 'Mercado Livre sempre'); assert.ok(sempre({ copagSource: true }));
const now = Date.parse('2026-10-17T12:00:00Z');
assert.equal(adiar({ status: 'ACTIVE', intervalMin: 60, lastSuccess: '2026-10-17T11:30:00Z' }, loja, now), true);
assert.equal(adiar({ status: 'ACTIVE', intervalMin: 60, lastSuccess: '2026-10-17T10:30:00Z' }, loja, now), false);
assert.equal(adiar({ status: 'ERROR', intervalMin: 60, lastSuccess: '2026-10-17T11:59:00Z' }, loja, now), false, 'só loja ativa');
assert.equal(adiar({ status: 'ACTIVE', intervalMin: 0, lastSuccess: '2026-10-17T11:59:00Z' }, loja, now), false);
assert.equal(ligada({ FREQ_ADAPTATIVA: '0' }), false); assert.equal(ligada({}), true);
const run = fs.readFileSync(new URL('../src/run.js', import.meta.url), 'utf8');
assert.match(run, /if \(FREQ && adiar\(src, store\)\) \{ skipped\.add\(store\.id\); adiadas\.add\(store\.id\); return; \}/, 'adiada mantém oferta como leitura recente');
assert.match(run, /storesSummary\(sources, skipped\.size - adiadas\.size\)/, 'adiada não conta como atraso de rodada');
console.log('frequencia-tests: ok');
