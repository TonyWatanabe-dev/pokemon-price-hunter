// /lojas (24/10/2026): "monitorada" só diz que o robô lê a loja. Selo separa com oferta, lida sem estoque e lida sem
// produto Pokémon; a página pré-renderizada usa a regra (o espelho no index.html saiu em 07/11/2026).
process.env.SITE_SO_PARCEIROS = '0';   // site só com parceiros (07/11/2026): este teste cobre o comportamento com todas as lojas (modo desligado); o modo ligado é test/so-parceiros-ui-tests.js
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
// Site só com parceiros (07/11/2026): a tela /lojas e o espelho desta regra saíram do index.html (a página do servidor segue com a chave desligada).
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert.ok(!/ljColeta|LJ_COLETA|lojasNormalize/.test(html), 'index.html sem a tela de lojas');
console.log('✓ lojas-coleta: com oferta × sem estoque × sem produto, regra do servidor');
