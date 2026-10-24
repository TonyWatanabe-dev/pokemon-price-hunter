// /lojas (24/10/2026): "monitorada" só diz que o robô lê a loja. Selo separa com oferta, lida sem estoque e lida sem
// produto Pokémon; o site (index.html) e a página pré-renderizada usam a mesma regra.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { coleta, coletaFatos, COLETA_CHIP } from '../api/_lib/lojas.mjs';
const q = () => 'agora';
const L = (o) => ({ status: 'monitorada', offersLive: 0, offersRead: 0, lastReadAt: '2026-10-24T12:00:00Z', ...o });
assert.equal(coleta(L({ offersLive: 2, offersRead: 3 })), 'com-ofertas');
assert.equal(coleta(L({ offersRead: 3 })), 'sem-estoque');
assert.equal(coleta(L({})), 'sem-produto');
assert.equal(coleta({ status: 'sem-leitura' }), 'sem-leitura', 'sem leitura não vira estado de coleta');
assert.equal(coletaFatos(L({ offersLive: 1, offersRead: 1 }), q), '1 oferta com estoque · última leitura agora');
assert.equal(coletaFatos(L({ offersRead: 3 }), q), '0 ofertas com estoque agora (3 lidas) · última leitura agora');
assert.equal(coletaFatos(L({ lastReadAt: null }), q), 'nenhum produto Pokémon lacrado reconhecido nas leituras', 'sem leitura registrada: não inventa horário');
assert.deepEqual(Object.keys(COLETA_CHIP), ['com-ofertas', 'sem-estoque', 'sem-produto']);
// mesma regra e rótulos no site
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const fn = html.match(/const ljColeta=[^\n]*\nconst LJ_COLETA=[^\n]*\nconst ljFatos=[^\n]*/)[0];
const { ljColeta, LJ_COLETA, ljFatos } = Function('ago', `${fn}; return { ljColeta, LJ_COLETA, ljFatos };`)(q);
for (const l of [L({ offersLive: 2, offersRead: 3 }), L({ offersRead: 3 }), L({}), { status: 'pausada' }]) { assert.equal(ljColeta(l), coleta(l)); assert.equal(ljFatos(l), coletaFatos(l, q)); }
assert.deepEqual(LJ_COLETA, Object.fromEntries(Object.entries(COLETA_CHIP)));
assert.match(html, /offersRead:offs\.filter\(\(o\)=>!o\.stale\)\.length/, 'site conta ofertas lidas como o servidor');
console.log('✓ lojas-coleta: com oferta × sem estoque × sem produto, site e servidor iguais');
