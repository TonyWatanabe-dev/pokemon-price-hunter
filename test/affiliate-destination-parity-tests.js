// Paridade entre o filtro do navegador (AFIL_OK em index.html) e o do servidor (validDestination em api/_lib/affiliates.mjs).
// A regex é extraída do index.html durante o teste: se alguém mudar uma só das pontas, este teste quebra. Sem rede e sem banco.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validDestination } from '../api/_lib/affiliates.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const m = html.match(/const AFIL_OK=\/((?:\\\/|[^\n])+?)\/([a-z]*);/);
assert.ok(m, 'AFIL_OK não encontrada no index.html');
const AFIL_OK = new RegExp(m[1], m[2]);

// [entrada, aceita?]
const CASOS = [
  ['https://meli.la/2abcDeF', true],
  ['https://www.mercadolivre.com.br/p/MLB123', true],
  ['https://produto.mercadolivre.com.br/MLB-123456789-x', true],
  ['https://mercadolivre.com.br/x', true],
  ['https://MELI.LA/abc', true],
  ['https://www.mercadolivre.com.br/', true],
  ['https://www.mercadolivre.com.br/p/MLB1?a=b#c', true],
  ['http://meli.la/abc', false],
  ['//meli.la/abc', false],
  ['javascript:alert(1)', false],
  ['data:text/html,x', false],
  ['https://evil.com/', false],
  ['https://meli.la.evil.com/x', false],
  ['https://evilmercadolivre.com.br/x', false],
  ['https://www.mercadolivre.com.br.evil.com/x', false],
  ['https://meli.la@evil.com/x', false],
  ['https://user:pw@meli.la/x', false],
  ['https://meli.la:8443/x', false],
  ['https://meli.la', false],
  ['https://meli.la?x=1', false],
  ['https://meli.la#x', false],
  ['https://evil.com\\@meli.la/x', false],
  ['https://meli.la/x y', false],
  ['https://meli.la/x"onmouseover="1', false],
  ["https://meli.la/x'y", false],
  ['https://meli.la/<script>', false],
  ['https://meli.la/x\\y', false],
  [' https://meli.la/x', false],
  ['https://meli.la/x ', false],
  ['https://meli.la/x\n', false],
  ['', false],
  ['ftp://meli.la/x', false],
  ['https://sub.meli.la/x', false],
];

for (const [entrada, ok] of CASOS) {
  const srv = validDestination(entrada) !== null;
  const cli = AFIL_OK.test(entrada);
  assert.equal(srv, ok, `servidor: ${JSON.stringify(entrada)} deveria ser ${ok ? 'aceita' : 'rejeitada'}`);
  assert.equal(cli, srv, `divergência navegador × servidor em ${JSON.stringify(entrada)} (navegador=${cli}, servidor=${srv})`);
}
for (const nao of [null, undefined, 42, {}, []]) assert.equal(validDestination(nao), null);

console.log(`affiliate-destination-parity-tests: ${CASOS.length} casos ok`);
