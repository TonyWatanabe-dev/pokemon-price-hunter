// Home e /oportunidades (SSR): o item da lista diz o tipo de preço e o frete, como a página de produto (auditoria de
// produção de 24/10/2026: a Home servia "R$ 29,90 em loja" enquanto o produto dizia "R$ 29,90 no Pix (frete a calcular)").
// Frete desconhecido nunca aparece como zero nem é omitido.
import assert from 'node:assert/strict';
import { oppItem } from '../api/pagina.mjs';
const X = (o = {}) => ({ product: { id: 'p1', name: 'Blister Triplo Caos Ascendente' }, price: 29.9, offer: { price_kind: 'pix' }, shipping: 'unknown', total: null,
  store: { name: 'Radiante TCG' }, opportunity_score: 72, reference_comparison: { available: true, position: 'below', percentage_below: 12.3, reference_kind: 'COPAG_OFFICIAL_CURRENT' }, ...o });

let li = oppItem(X(), 'caos-ascendente-blister-triplo');
assert.match(li, /<b>R\$ 29,90 no Pix<\/b> \(frete a calcular\) em Radiante TCG/);
assert.match(li, /12,3% abaixo do preço sugerido Copag, Opportunity Score 72/);
assert.match(li, /href="\/produto\/caos-ascendente-blister-triplo"/);
// preço normal (não Pix): sem "no Pix"
assert.doesNotMatch(oppItem(X({ offer: { price_kind: 'avista' } }), 'p'), /no Pix/);
// frete conhecido: mostra o total com frete; grátis: diz grátis
assert.match(oppItem(X({ shipping: 'known', total: 41.4 }), 'p'), /\(R\$ 41,40 com frete\)/);
assert.match(oppItem(X({ shipping: 'free', total: 29.9 }), 'p'), /\(frete grátis\)/);
// conhecido mas sem total: nunca inventa (volta para "a calcular"); nunca R$ 0,00
assert.match(oppItem(X({ shipping: 'known', total: null }), 'p'), /\(frete a calcular\)/);
assert.doesNotMatch(oppItem(X(), 'p'), /R\$ 0,00/);
// texto da loja escapado
assert.match(oppItem(X({ store: { name: '<b>x</b>' } }), 'p'), /&lt;b&gt;x&lt;\/b&gt;/);
console.log('home-oportunidade-frete-tests: ok');
