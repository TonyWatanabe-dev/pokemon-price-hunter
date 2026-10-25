// Smoke do frete (#84): escolhe 1 oferta por loja VTEX resolvível, resume cotação sem lançar.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from '../tools/frete-smoke.mjs';

const st = {
  sources: [{ id: 'l1', platform: 'vtex', status: 'ACTIVE', url: 'https://loja1.com.br' }, { id: 'l2', platform: 'shopify', status: 'ACTIVE', url: 'https://l2.com' }],
  offers: [
    { id: 'a', storeId: 'l1', storeName: 'Loja 1', stock: 'IN_STOCK', sku: '10', sellerId: '1', url: 'https://loja1.com.br/p' },
    { id: 'b', storeId: 'l1', storeName: 'Loja 1', stock: 'IN_STOCK', sku: '11', sellerId: '1', url: 'https://loja1.com.br/q' },
    { id: 'c', storeId: 'l2', storeName: 'Loja 2', stock: 'IN_STOCK', sku: '1', sellerId: '1', url: 'https://l2.com/x' },
  ],
};
const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fs-')), 's.json');
fs.writeFileSync(f, JSON.stringify(st));
const linhas = []; const chamadas = []; const avisos = [];
// notice injetado: o teste não pode emitir ::notice:: de verdade (virava anotação "HTTP 403" falsa em todo run do CI)
const code = await main(['--state', f, '--cep', '01310-100'], { log: (s) => linhas.push(s), notice: (s) => avisos.push(s), pausaMs: 0,
  fetchQuote: async (a) => { chamadas.push(a); return { logisticsInfo: [{ slas: [{ id: 'p', name: 'PAC', price: 1990 }] }] }; } });
assert.equal(code, 0);
assert.equal(chamadas.length, 1);
assert.equal(chamadas[0].cep, '01310100');
assert.ok(linhas.some((l) => l.includes('Loja 1: ok — PAC R$ 19.90')));
assert.ok(linhas.some((l) => l.includes('1/1')));
assert.deepEqual(avisos, ['frete-smoke Loja 1: ok — PAC R$ 19.90', 'frete-smoke total 1/1 lojas com cotação (CEP 01310100)']);
const erro = []; const avisosErro = [];
await main(['--state', f], { log: (s) => erro.push(s), notice: (s) => avisosErro.push(s), pausaMs: 0, fetchQuote: async () => { throw new Error('HTTP 403 na cotação'); } });
assert.ok(erro.some((l) => l.includes('error — HTTP 403')));
assert.ok(avisosErro.some((l) => l.includes('error — HTTP 403')) && avisosErro.at(-1).includes('0/1'));

// Sem notice injetado, o padrão continua sendo a anotação do GitHub em stderr (uso real no frete-smoke.yml).
const stderr = []; const orig = console.error; console.error = (s) => stderr.push(String(s));
try { await main(['--state', f], { log: () => {}, pausaMs: 0, fetchQuote: async () => ({ logisticsInfo: [{ slas: [{ id: 'p', name: 'PAC', price: 1990 }] }] }) }); }
finally { console.error = orig; }
assert.deepEqual(stderr, ['::notice::frete-smoke Loja 1: ok — PAC R$ 19.90', '::notice::frete-smoke total 1/1 lojas com cotação (CEP 01310100)']);
console.log('frete-smoke-tests ok');
