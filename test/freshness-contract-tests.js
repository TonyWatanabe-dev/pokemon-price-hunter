// Contrato de frescor por oferta (issue #608): a matriz de docs/frescor.md ("Matriz de estados") em testes.
// Horário ausente, inválido, fresco, stale e falha parcial são distinguíveis de sucesso, e nenhum caminho inventa
// preço/estoque atual nem coloca oferta parada no ranking. Puro (sem rede e sem banco).
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { classify, usable } from '../api/_lib/freshness.mjs';
import { stateProductOffers } from '../api/_lib/read-state.mjs';
import { calculateOpportunity, CAPS } from '../src/core/opportunity-engine.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hunter-frcontract-'));
process.env.HUNTER_CONFIG_DIR = path.join(tmp, 'config'); process.env.HUNTER_DATA_DIR = path.join(tmp, 'data');
const { staleCopy, lastValidOf, recentRead, liveForScore, rankBestDeals } = await import('../src/run.js');
const { offersRows } = await import('../src/core/mappers.js');

const NOW = Date.parse('2026-10-13T18:00:00.000Z'); const now = new Date(NOW);
const ago = (min) => new Date(NOW - min * 6e4).toISOString();
const fresh = { id: 'a', productId: 'me05-etb', storeId: 'loja', storeName: 'Loja', title: 'ETB', url: 'https://loja.test/etb', price: 300, total: 300,
  shipping: null, shippingKnown: false, stock: 'IN_STOCK', matchConfidence: 0.9, confirmed: true, stale: false, anomalous: false, discount: 0.2,
  source_timestamp: ago(10), firstSeen: ago(5000) };
const row = (o) => offersRows([o])[0];
// Nunca devolve um horário "válido" para leitura sem horário confiável: ou não há horário (null) ou o mapeamento recusa.
const mappedAt = (o) => { try { return row(o).last_seen_at; } catch { return null; } };
const opp = (o) => { const r = row(o); return calculateOpportunity({}, { ...r, id: r.legacy_id, store: { ra_status: 'OTIMO' }, seller: null }, { now }); };
let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };

t('1. horário ausente: indisponível, não recente e sem horário no banco', () => {
  for (const at of [undefined, null, '']) {
    assert.equal(classify(at, NOW).status, 'indisponivel', String(at)); assert.equal(classify(at, NOW).dataAt, null);
    assert.equal(usable(classify(at, NOW)), false);
    assert.equal(recentRead({ ...fresh, source_timestamp: at }, now), false, 'rodada pulada: vira staleCopy, não fica como atual');
    assert.equal(mappedAt({ ...fresh, source_timestamp: at }), null);
  }
});

t('2. horário inválido ou no futuro (> 5 min): mesmo tratamento do ausente', () => {
  for (const at of ['lixo', '2026-13-45T99:00:00Z', ago(-6)]) {
    assert.equal(classify(at, NOW).status, 'indisponivel', at); assert.equal(usable(classify(at, NOW)), false);
    assert.equal(recentRead({ ...fresh, source_timestamp: at }, now), false, `rodada pulada com horário ${at}`);
  }
  for (const at of ['lixo', '2026-13-45T99:00:00Z']) assert.equal(mappedAt({ ...fresh, source_timestamp: at }), null, 'banco nunca recebe horário inventado');
  // folga de relógio de até 5 min continua valendo, como em classify
  assert.equal(classify(ago(-4), NOW).status, 'atual'); assert.equal(recentRead({ ...fresh, source_timestamp: ago(-4) }, now), true);
});

t('3. fresco: atual, utilizável, entra no ranking e vai ativo para o banco', () => {
  assert.equal(classify(fresh.source_timestamp, NOW).status, 'atual'); assert.ok(usable(classify(fresh.source_timestamp, NOW)));
  assert.equal(recentRead(fresh, now), true);
  assert.equal(liveForScore(fresh), true); assert.deepEqual(rankBestDeals([fresh]).map((o) => o.id), ['a']);
  const r = row(fresh); assert.equal(r.status, 'active'); assert.equal(r.stock_status, 'in_stock'); assert.equal(r.last_seen_at, fresh.source_timestamp);
  assert.notEqual(opp(fresh).evidence, 'stale');
});

t('4. envelhecimento sem leitura nova: atrasado → desatualizado → indisponível; rodada pulada só mantém até 3 h', () => {
  assert.equal(classify(ago(60), NOW).status, 'atrasado'); assert.ok(usable(classify(ago(60), NOW)));
  assert.equal(classify(ago(120), NOW).status, 'desatualizado'); assert.equal(usable(classify(ago(120), NOW)), false);
  assert.equal(classify(ago(25 * 60), NOW).status, 'indisponivel');
  assert.equal(recentRead({ ...fresh, source_timestamp: ago(179) }, now), true);
  assert.equal(recentRead({ ...fresh, source_timestamp: ago(180) }, now), false);
});

t('5. stale (falha da fonte): distinguível de sucesso, sem estoque inventado e fora do ranking', () => {
  const s = staleCopy({ ...fresh, source_timestamp: ago(20) }, now);
  assert.equal(s.stale, true); assert.equal(s.stock, 'UNKNOWN', 'estoque atual não é inventado');
  assert.equal(s.source_timestamp, ago(20), 'horário não é renovado');
  assert.equal(lastValidOf(s).stock, 'IN_STOCK', 'a última leitura válida fica em lastValid, separada');
  assert.equal(recentRead(s, now), false, 'stale nunca volta a ser "recente" por rodada pulada');
  assert.equal(liveForScore(s), false); assert.deepEqual(rankBestDeals([s]), [], 'oferta parada não entra no ranking');
  const r = row(s); assert.equal(r.status, 'pending'); assert.equal(r.stock_status, 'unknown'); assert.equal(r.total_price, null, 'frete desconhecido: sem total');
  const o = opp(s);
  assert.equal(o.evidence, 'stale'); assert.ok(o.opportunity_score <= CAPS.pending, String(o.opportunity_score));
  assert.ok(o.warnings.some((w) => w.code === 'STALE'));
});

t('6. falha parcial (loja com páginas que falharam): só a leitura atual concorre; a parada é marcada', () => {
  const ok = { ...fresh, id: 'ok', price: 320, total: 320, discount: 0.15 };
  const parada = staleCopy({ ...fresh, id: 'parada', price: 250, total: 250, discount: 0.3, source_timestamp: ago(200) }, now); // mais barata, mas não lida
  assert.deepEqual(rankBestDeals([parada, ok]).map((o) => o.id), ['ok'], 'preço antigo mais baixo não vence a leitura atual');
  const st = { products: [{ id: 'me05-etb', collection: 'me05', collectionName: 'Coleção', type: 'etb', typeLabel: 'ETB' }], offers: [parada, ok] };
  const { items } = stateProductOffers(st, 'me05-etb', { page: 1, limit: 10 });
  assert.deepEqual(items.map((i) => [i.id, i.status, i.stock]), [['ok', 'active', 'in_stock'], ['parada', 'pending', 'unknown']]);
  assert.equal(items[1].last_seen_at, ago(200), 'a oferta parada mostra a idade real');
  assert.equal(classify(items[1].last_seen_at, NOW).status, 'desatualizado');
  // produto só com oferta parada: nada no ranking (sem preço "atual" inventado)
  assert.deepEqual(rankBestDeals([parada]), []);
});

console.log(`freshness-contract-tests: ${n} testes ok`);
