// Cupom de loja: o CSV de "Meus cupons" traz o nome de exibição ("Saga Geek") e o anúncio traz o apelido ("SAGAGEEK").
import assert from 'node:assert/strict';
import { chaveLoja, cupomPara, deLinha } from '../src/agents/social/cupons.js';

assert.equal(chaveLoja('Saga Geek'), 'sagageek');
assert.equal(chaveLoja(' SAGA_GEEK '), 'sagageek');
assert.equal(chaveLoja('Coleção dos Reis'), chaveLoja('COLECAO_DOS_REIS'));
assert.equal(chaveLoja(''), '');

const linha = { desconto: '8%', emissor: 'Loja', loja: 'Saga Geek', nome_cupom: '', 'compra_minima_R$': '10', 'limite_R$': '5000', validade: '30/11' };
const c = deLinha(linha, '2026-11-02', { vendedores: new Set([chaveLoja('SAGAGEEK')]) });
assert.equal(c?.escopo, 'vendedor', 'apelido sem espaço casa com o nome de exibição');
assert.equal(deLinha(linha, '2026-11-02', { vendedores: new Set(['outraloja']) }), null, 'loja fora das ofertas não entra');

const now = Date.parse('2026-11-02T15:00:00Z');
const oferta = { storeId: 'mercadolivre', price: 200, seller: 'SAGAGEEK' };
assert.equal(cupomPara(oferta, [c], now)?.vendedor, 'Saga Geek');
assert.equal(cupomPara({ ...oferta, seller: 'SAGA GEEKS' }, [c], now), null, 'outra loja não herda o cupom');
console.log('✓ cupons-loja: 3 grupos passaram');
