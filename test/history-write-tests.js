// Escrita do histórico (src/history.js): recordDay, trimJsonl e backfill, com diretório temporário.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hunter-histw-'));
const dataDir = path.join(tmp, 'data');
process.env.HUNTER_DATA_DIR = dataDir; fs.mkdirSync(dataDir, { recursive: true });
const { recordDay, trimJsonl, backfill, histPath } = await import('../src/history.js');

const DAY = 864e5;
const iso = (offsetDays) => new Date(Date.now() - offsetDays * DAY).toISOString();
const dstr = (offsetDays) => iso(offsetDays).slice(0, 10);
const read = (pid) => JSON.parse(fs.readFileSync(histPath(pid), 'utf8'));
const offer = (o) => ({ productId: 'p1', storeId: 's1', storeName: 'Loja 1', stock: 'IN_STOCK', total: 100, ...o });
const products = { p1: { name: 'Produto 1', msrp: 100 } };

// recordDay: guarda o menor valor do dia por loja; nova rodada só baixa, nunca sobe
{
  const T = iso(0);
  assert.equal(recordDay([offer({ total: 120 }), offer({ total: 100 }), offer({ storeId: 's2', storeName: 'Loja 2', total: 110 })], products, T), 1);
  let h = read('p1');
  assert.deepEqual(h.stores.s1.pts, [[T.slice(0, 10), 100]]);
  assert.deepEqual(h.stores.s2.pts, [[T.slice(0, 10), 110]]);
  assert.equal(h.msrp, 100); assert.equal(h.name, 'Produto 1');
  assert.equal(recordDay([offer({ total: 130 })], products, T), 0, 'valor maior no mesmo dia não altera nada');
  assert.equal(read('p1').stores.s1.pts[0][1], 100);
  assert.equal(recordDay([offer({ total: 95 })], products, T), 1);
  assert.equal(read('p1').stores.s1.pts[0][1], 95, 'valor menor substitui');
}

// recordDay: descarta sem estoque, stale, anômalo, total inválido e preço suspeito (< 0,55× msrp ou mediana)
{
  const T = iso(0);
  const p = { q1: { msrp: 100 }, q2: {} };
  const offers = [
    { productId: 'q1', storeId: 'a', storeName: 'A', stock: 'IN_STOCK', total: 100 },
    { productId: 'q1', storeId: 'oos', storeName: 'OOS', stock: 'OUT_OF_STOCK', total: 100 },
    { productId: 'q1', storeId: 'stale', storeName: 'Stale', stock: 'IN_STOCK', stale: true, total: 100 },
    { productId: 'q1', storeId: 'anom', storeName: 'Anom', stock: 'IN_STOCK', anomalous: true, total: 100 },
    { productId: 'q1', storeId: 'zero', storeName: 'Zero', stock: 'IN_STOCK', total: 0 },
    { productId: 'q1', storeId: 'susp', storeName: 'Susp', stock: 'IN_STOCK', total: 50 }, // < 0,55 × msrp
    // sem msrp: suspeito pela mediana do produto (100,100,100,40 → mediana 100)
    { productId: 'q2', storeId: 'm1', storeName: 'M1', stock: 'IN_STOCK', total: 100 },
    { productId: 'q2', storeId: 'm2', storeName: 'M2', stock: 'IN_STOCK', total: 100 },
    { productId: 'q2', storeId: 'm3', storeName: 'M3', stock: 'IN_STOCK', total: 100 },
    { productId: 'q2', storeId: 'm4', storeName: 'M4', stock: 'IN_STOCK', total: 40 },
  ];
  recordDay(offers, p, T);
  assert.deepEqual(Object.keys(read('q1').stores), ['a']);
  assert.deepEqual(Object.keys(read('q2').stores).sort(), ['m1', 'm2', 'm3']);
  assert.equal(recordDay([{ productId: 'q3', storeId: 'x', storeName: 'X', stock: 'IN_STOCK', stale: true, total: 10 }], {}, T), 0);
  assert.equal(fs.existsSync(histPath('q3')), false, 'nada válido: nenhum arquivo criado');
}

// recordDay: corte de 180 dias remove pontos antigos (e a loja que ficar vazia)
{
  const old = dstr(181); const edge = dstr(179);
  fs.writeFileSync(histPath('c1'), JSON.stringify({ productId: 'c1', stores: {
    s1: { name: 'S1', pts: [[old, 90], [edge, 91]] },
    velha: { name: 'Velha', pts: [[old, 80]] },
  } }));
  assert.equal(recordDay([{ productId: 'c1', storeId: 's1', storeName: 'S1', stock: 'IN_STOCK', total: 100 }], { c1: {} }, iso(0)), 1);
  const h = read('c1');
  assert.deepEqual(h.stores.s1.pts.map((x) => x[0]), [edge, dstr(0)]);
  assert.equal(h.stores.velha, undefined);
}

// trimJsonl: arquivo pequeno (< 3 MB) fica intacto; grande mantém só os últimos 45 dias
{
  const f = path.join(dataDir, 'trim.jsonl');
  const lines = [JSON.stringify({ t: iso(60), n: 'velho' }), JSON.stringify({ t: iso(10), n: 'novo' })];
  fs.writeFileSync(f, lines.join('\n') + '\n');
  trimJsonl(f);
  assert.equal(fs.readFileSync(f, 'utf8'), lines.join('\n') + '\n', 'abaixo de 3 MB não mexe');
  const pad = JSON.stringify({ t: iso(5), n: 'x'.repeat(1000) });
  const big = [lines[0], 'lixo{', lines[1], ...Array(3100).fill(pad)];
  fs.writeFileSync(f, big.join('\n') + '\n');
  trimJsonl(f);
  const out = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
  assert.equal(out.length, 3101, 'remove linha antiga e linha corrompida');
  assert.ok(!out.some((l) => l.includes('velho')));
  assert.ok(out.some((l) => l.includes('novo')));
  trimJsonl(path.join(dataDir, 'nao-existe.jsonl')); // sem arquivo: não lança
}

// backfill: monta data/hist do history.jsonl (só estoque, descarta fora da régua) e é idempotente
{
  fs.rmSync(path.join(dataDir, 'hist'), { recursive: true, force: true });
  const d1 = iso(2); const d2 = iso(1);
  const row = (o) => JSON.stringify({ t: d1, productId: 'b1', storeId: 'x', stock: 'IN_STOCK', total: 100, ...o });
  fs.writeFileSync(path.join(dataDir, 'history.jsonl'), [
    row({ total: 100 }), row({ total: 90 }), row({ storeId: 'y', total: 100 }), row({ storeId: 'z', total: 100 }),
    row({ storeId: 'w', total: 20 }), row({ storeId: 'v', total: 1000 }), // fora de 0,55×–3× da mediana
    row({ storeId: 'oos', stock: 'OUT_OF_STOCK' }), row({ storeId: 'zero', total: 0 }),
    row({ t: d2, total: 95 }), JSON.stringify({ t: d1, storeId: 'x', stock: 'IN_STOCK', total: 100 }), // sem productId
  ].join('\n') + '\n');
  const n = backfill({ x: 'Loja X' });
  assert.equal(n, 2, 'dois dias gravados');
  const h = read('b1');
  assert.deepEqual(h.stores.x, { name: 'Loja X', pts: [[d1.slice(0, 10), 90], [d2.slice(0, 10), 95]] });
  assert.deepEqual(Object.keys(h.stores).sort(), ['x', 'y', 'z']);
  const snapshot = fs.readFileSync(histPath('b1'), 'utf8');
  assert.equal(backfill({ x: 'Outro' }), 0, 'segunda chamada: hist/ existe, sai sem fazer nada');
  assert.equal(fs.readFileSync(histPath('b1'), 'utf8'), snapshot);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('history-write-tests: ok');

// merge atômico: falha na escrita mantém o arquivo anterior íntegro e não deixa .tmp
{
  const T = iso(0);
  recordDay([offer({ productId: 'pa', total: 100 })], { pa: { name: 'A', msrp: 100 } }, T);
  const before = fs.readFileSync(histPath('pa'), 'utf8');
  const orig = fs.renameSync; fs.renameSync = () => { throw new Error('falha simulada'); };
  try { assert.throws(() => recordDay([offer({ productId: 'pa', total: 90 })], { pa: { name: 'A', msrp: 100 } }, T), /falha simulada/); } finally { fs.renameSync = orig; }
  assert.equal(fs.readFileSync(histPath('pa'), 'utf8'), before, 'arquivo anterior intacto');
  assert.ok(!fs.existsSync(histPath('pa') + '.tmp'), 'sem .tmp');
}

// recordDay: anômalos não entram na mediana (sem msrp, a mediana inflada por anômalos barraria o preço válido)
{
  const T = iso(0);
  const offers = [offer({ productId: 'pm', storeId: 'a', total: 50 }), offer({ productId: 'pm', storeId: 'b', total: 1000, anomalous: true }), offer({ productId: 'pm', storeId: 'c', total: 1000, anomalous: true })];
  assert.equal(recordDay(offers, { pm: { name: 'M' } }, T), 1);
  assert.deepEqual(Object.keys(read('pm').stores), ['a']);
}
