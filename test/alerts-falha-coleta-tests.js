// Fase 4 — "queda" (e reposição) nunca dispara por falha de coleta. Encadeia o caminho real da rodada: staleCopy
// (leitura que falhou) → offerEvents (eventos contra a última leitura válida) → prevBestOf → evaluate → dispatch.
// Puro: sem rede, sem banco, canais simulados.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
process.env.HUNTER_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fcol-cfg-')); process.env.HUNTER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fcol-data-'));
const { staleCopy, offerEvents } = await import('../src/run.js');
const { evaluate, dedupe, dispatch, prevBestOf } = await import('../src/alerts.js');
let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { e.message = `${name}: ${e.message}`; throw e; } };

const T0 = new Date('2026-10-15T12:00:00Z');
const at = (min) => new Date(T0.getTime() + min * 60e3);
const read = (o = {}, min = 0) => ({ id: 'o1', productId: 'p1', storeId: 's', storeName: 'Loja X', stock: 'IN_STOCK', matchConfidence: 0.95, anomalous: false, stale: false,
  confirmed: true, price: 500, total: 500, shipping: 0, shippingKnown: true, seller: null, discount: null, priceKindLabel: 'Pix', url: 'https://loja-x/p1',
  source_timestamp: at(min).toISOString(), ...o });
const prod = { p1: { id: 'p1', type: 'booster_box', collection: 'me04', collectionName: 'Caos Ascendente', typeLabel: 'Booster Box', copagConfirmed: false } };
// maxPrice: 1 só torna o produto vigiado (queda) sem disparar por preço; restock exige evento.
const rules = [{ id: 'vigia', label: 'Vigiar Caos', filter: { productId: 'p1' }, maxPrice: 1 }, { id: 'rs', filter: { productId: 'p1' }, restock: true }];

// Uma rodada como em src/run.js: eventos contra a rodada anterior; queda medida contra a melhor anterior (prevBestOf).
async function round(prev, cur, sent = {}, now = T0) {
  const events = cur.flatMap((o) => offerEvents(prev.find((p) => p.id === o.id), o));
  const hits = dedupe(evaluate(rules, cur, events, prod, { prevBest: prevBestOf(prev) }), sent, {}, now.getTime(), Object.fromEntries(cur.map((o) => [o.id, o])));
  const calls = []; const delivered = await dispatch(hits, sent, { send: { telegram: async (m) => { calls.push(m); return true; } }, now });
  return { events, hits, delivered, calls };
}

await t('coleta falhou: oferta stale não gera evento nem alerta', async () => {
  const r1 = read(); const fail = staleCopy(r1, at(15));
  assert.equal(fail.stale, true); assert.equal(fail.stock, 'UNKNOWN');
  const r = await round([r1], [fail]);
  assert.deepEqual(r.events, []); assert.equal(r.hits.length, 0); assert.equal(r.calls.length, 0);
});

await t('em estoque → falha → volta ao MESMO preço: nem queda nem reposição', async () => {
  const r1 = read(); const fail = staleCopy(r1, at(15)); const back = read({}, 30);
  const r = await round([fail], [back]);
  assert.deepEqual(r.events, [], 'comparado com a última leitura válida (R$ 500), não com a falha');
  assert.equal(r.calls.length, 0);
});

await t('falha seguida (staleCopy de staleCopy) e volta ao mesmo preço: nada dispara', async () => {
  const fail2 = staleCopy(staleCopy(read(), at(15)), at(30));
  assert.equal(fail2.lastValid.total, 500, 'a base continua a última leitura válida');
  const r = await round([fail2], [read({}, 45)]);
  assert.deepEqual(r.events, []); assert.equal(r.calls.length, 0);
});

await t('falha com valor lixo gravado na cópia: a base segue a última leitura válida', async () => {
  // Mesmo que a cópia da falha carregue um total alto (ex.: leitura parcial), a queda é medida contra lastValid.
  const fail = { ...staleCopy(read(), at(15)), total: 900, price: 900 };
  const r = await round([fail], [read({}, 30)]);
  assert.deepEqual(r.events, [], 'R$ 900 da falha não vira base: voltar a R$ 500 não é queda');
  assert.equal(r.calls.length, 0);
});

await t('leitura com estoque desconhecido e preço menor não é queda; nem quando o estoque volta no mesmo preço', async () => {
  const r1 = read();
  const unk = read({ stock: 'UNKNOWN', price: 400, total: 400 }, 15);
  const a = await round([r1], [unk]);
  assert.deepEqual(a.events, []); assert.equal(a.calls.length, 0);
  const b = await round([unk], [read({ price: 400, total: 400 }, 30)]);
  assert.equal(b.events.filter((e) => e.event === 'drop').length, 0, 'mesmo preço da leitura anterior: não é queda');
});

await t('stale sem última leitura válida (legado) que volta mais barata: sem base, sem evento', async () => {
  const legacy = { ...read(), stale: true, stock: 'UNKNOWN', lastValid: null };
  const r = await round([legacy], [read({ price: 450, total: 450 }, 30)]);
  assert.deepEqual(r.events, []); assert.equal(r.calls.length, 0);
});

await t('controle: depois da falha, queda REAL contra a última leitura válida dispara uma vez', async () => {
  const fail = staleCopy(read(), at(15)); const sent = {};
  const r = await round([fail], [read({ price: 450, total: 450 }, 30)], sent, at(30));
  assert.deepEqual(r.events, [{ offerId: 'o1', event: 'drop', from: 500, fromShippingKnown: true }]);
  assert.equal(r.calls.length, 1); assert.match(r.calls[0].text, /R\$\s500,00 → R\$\s450,00/);
  const again = await round([read({ price: 450, total: 450 }, 30)], [read({ price: 450, total: 450 }, 45)], sent, at(45));
  assert.equal(again.calls.length, 0, 'rodada seguinte no mesmo preço não repete');
});

await t('src/run.js usa offerEvents na rodada (e nada além dele gera evento de queda/reposição)', () => {
  const src = fs.readFileSync(new URL('../src/run.js', import.meta.url), 'utf8');
  assert.match(src, /events\.push\(\.\.\.offerEvents\(prev\[o\.id\], o\)\)/);
  assert.equal((src.match(/event: 'drop'/g) || []).length, 1, 'um único ponto gera evento de queda');
  assert.equal((src.match(/event: 'restock'/g) || []).length, 1, 'um único ponto gera evento de reposição');
});

console.log(`✓ Queda/reposição não disparam por falha de coleta (Fase 4): ${n} grupos passaram`);
