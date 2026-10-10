// Exportação CSV: escaping, proteção contra fórmulas, acentos, datas e ausência de dados (desconhecido nunca vira 0).
import assert from 'node:assert/strict';
import { csvCell, opportunitiesToCsv, COLUMNS } from '../src/export-csv.js';

let n = 0;
function t(name, fn) { try { fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } }

t('fórmulas maliciosas são neutralizadas', () => {
  for (const f of ['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\tx', '\rx']) assert.ok(csvCell(f).replace(/^"/, '').startsWith("'"), f);
  assert.equal(csvCell("=HYPERLINK(\"http://x\",\"a\")"), '"\'=HYPERLINK(""http://x"",""a"")"');
});
t('delimitadores, aspas e quebras de linha', () => {
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('a;b'), '"a;b"');
  assert.equal(csvCell('diz "oi"'), '"diz ""oi"""');
  assert.equal(csvCell('l1\nl2'), '"l1\nl2"');
  assert.equal(csvCell('simples'), 'simples');
});
t('acentos preservados e BOM presente', () => {
  const csv = opportunitiesToCsv([{ productId: 'p', storeName: 'Gato Gingado', price: 10 }], [{ id: 'p', name: 'Blister Quádruplo Fogo Fantasmagórico' }]);
  assert.ok(csv.startsWith('﻿' + COLUMNS.join(',')));
  assert.ok(csv.includes('Blister Quádruplo Fogo Fantasmagórico'));
});
t('desconhecido não vira zero', () => {
  const csv = opportunitiesToCsv([{ productId: 'p', storeName: 'L', price: null, total: 0, shipping: null, shippingKnown: false, source_timestamp: 'lixo' }], [{ id: 'p', name: 'P', msrp: null }]);
  const row = csv.split('\r\n')[1].split(',');
  assert.deepEqual(row.slice(2, 8), ['', '', '', '', '', '']);
  assert.equal(row[8], '');
});
t('frete grátis conhecido é 0,00; frete desconhecido é vazio', () => {
  const known = opportunitiesToCsv([{ productId: 'p', price: 10, shipping: 0, shippingKnown: true }], []).split('\r\n')[1].split(',');
  assert.equal(known[3], '0.00');
  const unknown = opportunitiesToCsv([{ productId: 'p', price: 10, shipping: 0, shippingKnown: false }], []).split('\r\n')[1].split(',');
  assert.equal(unknown[3], '');
});
t('frete desconhecido: total vazio (o total é só o preço e não se compara com total com frete)', () => {
  // na main, com frete desconhecido o o.total é só o preço: exportá-lo como "total" inventaria frete zero
  const unknown = opportunitiesToCsv([{ productId: 'p', price: 300, total: 300, shipping: null, shippingKnown: false }], []).split('\r\n')[1].split(',');
  assert.equal(unknown[2], '300.00'); assert.equal(unknown[3], ''); assert.equal(unknown[4], '');
  const absent = opportunitiesToCsv([{ productId: 'p', price: 300, total: 300 }], []).split('\r\n')[1].split(',');
  assert.equal(absent[3], ''); assert.equal(absent[4], '');
  const known = opportunitiesToCsv([{ productId: 'p', price: 295, total: 305, shipping: 10, shippingKnown: true }], []).split('\r\n')[1].split(',');
  assert.equal(known[3], '10.00'); assert.equal(known[4], '305.00');
});
t('datas em ISO, referência Copag e status', () => {
  const csv = opportunitiesToCsv([{ productId: 'p', storeName: 'L', price: 300, total: 300, source_timestamp: '2026-10-07T13:45:26.327Z', firstSeen: '2026-10-07T07:01:45Z',
    classification: { label: 'OPORTUNIDADE' }, stock: 'IN_STOCK', url: 'https://l.com.br/p' }], [{ id: 'p', name: 'ETB', msrp: 400 }]);
  const row = csv.split('\r\n')[1].split(',');
  assert.deepEqual(row.slice(5), ['400.00', 'OPORTUNIDADE', 'IN_STOCK', '2026-10-07T13:45:26.327Z', '2026-10-07T07:01:45.000Z', 'https://l.com.br/p']);
});
t('título malicioso vindo da loja é protegido na linha', () => {
  const csv = opportunitiesToCsv([{ productId: 'x', storeName: '=cmd|calc', price: 1 }], []);
  assert.ok(csv.includes("'=cmd|calc"));
});
t('entradas vazias não quebram', () => {
  assert.equal(opportunitiesToCsv([], []), '﻿' + COLUMNS.join(',') + '\r\n');
  assert.equal(opportunitiesToCsv(undefined, undefined), '﻿' + COLUMNS.join(',') + '\r\n');
});

console.log(`export-csv-tests: ${n} ok`);
