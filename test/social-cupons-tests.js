// Dica de cupom do ML nos posts (#690): importação do CSV "Meus cupons" e escolha por oferta.
import assert from 'node:assert/strict';
import { validadeAte, importarCsv, cupomPara, dicaCupom, descontoEm } from '../src/agents/social/cupons.js';

// validade relativa à exportação (15/10/2026 é quinta)
assert.equal(validadeAte('31/12', '2026-10-15'), '2026-12-31');
assert.equal(validadeAte('01/02', '2026-10-15'), '2027-02-01');
assert.equal(validadeAte('domingo', '2026-10-15'), '2026-10-18');
assert.equal(validadeAte('quinta-feira', '2026-10-15'), '2026-10-15');
assert.equal(validadeAte('amanhã', '2026-10-15'), '2026-10-16');
assert.equal(validadeAte('', '2026-10-15'), '2026-10-18');
assert.equal(validadeAte('lixo', '2026-10-15'), null);

const csv = '﻿desconto;emissor;loja;nome_cupom;compra_minima_R$;limite_R$;validade;esgotando\n'
  + '15%;Mercado Livre;;BRINQUEDOS;39;30;;\n'          // categoria TCG → entra
  + '30%;Mercado Livre;;em moda;99;30;;sim\n'          // outra categoria → fora
  + '10%;Mercado Livre;;KIDSTEP;29;50;31/10;\n'         // marca infantil → fora
  + '12%;Mercado Livre;;;299;50;31/12;\n'               // ML geral → entra
  + '5%;Loja;Rctcg;;80;30;sábado;\n'                    // vendedor presente → entra
  + '5%;Loja;Outra;;80;30;sábado;\n'                    // vendedor ausente → fora
  + 'grátis;Mercado Livre;;;0;0;;\n';                   // desconto ilegível → fora
const cs = importarCsv(csv, '2026-10-15', { vendedores: new Set(['rctcg']) });
assert.deepEqual(cs.map((c) => c.escopo).sort(), ['categoria', 'ml', 'vendedor']);
assert.throws(() => importarCsv('a;b\n1;2', '2026-10-15'), /coluna ausente/);

const now = Date.parse('2026-10-16T15:00:00Z');
const ml = (price, seller = 'X') => ({ storeId: 'mercadolivre', price, seller });
assert.equal(cupomPara({ storeId: 'pbkids', price: 500 }, cs, now), null, 'só ofertas do ML');
assert.equal(cupomPara(ml(30), cs, now), null, 'abaixo de todos os mínimos');
assert.equal(cupomPara(ml(100), cs, now).escopo, 'categoria', 'R$ 15 (15%) > nada mais elegível');
assert.equal(cupomPara(ml(100, 'RCTCG'), cs, now).escopo, 'categoria', '15% de 100 = 15 > 5% de 100 = 5');
assert.equal(cupomPara(ml(400), cs, now).escopo, 'ml', '12% de 400 = 48 > teto 30 da categoria');
assert.equal(descontoEm(cs.find((c) => c.escopo === 'categoria'), 1000), 30, 'teto respeitado');
assert.equal(cupomPara(ml(100), cs, Date.parse('2026-10-20T15:00:00Z'))?.escopo ?? null, null, 'vencidos somem');
const d = dicaCupom(ml(100), cs, now);
assert.match(d, /^🎟️ Cupom de Brinquedos: 15% até R\$ 30 \(mín\. R\$ 39\) · veja em "Meus cupons" no ML$/);
assert.ok(d.length <= 85, 'dica curta: ' + d.length);   // antes: 105
assert.equal(dicaCupom(ml(10), cs, now), null);

// integração: a dica entra na legenda do candidato do ML; SOCIAL_CUPONS=0 desliga; outras lojas ficam sem
const { candidatos } = await import('../tools/social-telegram-piloto.mjs');
const NOW = Date.now(); const iso = (min) => new Date(NOW - min * 60000).toISOString();
const st = { generatedAt: iso(0), products: [{ id: 'me04-box36', collection: 'me04', collectionName: 'ME04', type: 'booster_box', boosters: 36, name: 'Box ME04' }],
  offers: [['o1', 'mercadolivre', 'Mercado Livre'], ['o2', 'loja1', 'Loja 1']].map(([id, storeId, storeName], i) => ({ id, productId: 'me04-box36', storeId, storeName, seller: 'X',
    url: `https://l${i}.test/p`, image: `https://l${i}.test/i.jpg`, title: 'Box ME04', price: 900 + i, total: 900 + i, shippingKnown: true, shipping: 0,
    stock: 'IN_STOCK', confirmed: true, stale: false, anomalous: false, firstSeen: iso(5000), source_timestamp: iso(5) })) };
const cup = [{ escopo: 'ml', tipo: 'pct', valor: 15, minimo: 399, limite: 100, validoAte: '2099-12-31' }];
const lista = candidatos(st, { now: NOW, env: {}, afiliados: {}, cupons: cup });
const doMl = lista.find((c) => c.oferta.storeId === 'mercadolivre'); const outra = lista.find((c) => c.oferta.storeId === 'loja1');
assert.ok(doMl && outra, 'as duas ofertas elegíveis');
assert.match(doMl.item.texto, /🎟️ Cupom: 15% até R\$ 100 \(mín\. R\$ 399\) · veja em "Meus cupons" no ML/);
assert.equal(doMl.fila.itens.find((x) => x.id === doMl.item.id).texto, doMl.item.texto, 'fila e item com o mesmo texto');
assert.doesNotMatch(outra.item.texto, /🎟️/);
const off = candidatos(st, { now: NOW, env: { SOCIAL_CUPONS: '0' }, afiliados: {}, cupons: cup });
assert.doesNotMatch(off.find((c) => c.oferta.storeId === 'mercadolivre').item.texto, /🎟️/);
console.log('social-cupons-tests ok');
