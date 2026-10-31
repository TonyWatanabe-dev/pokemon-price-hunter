// Monte seu kit (K2): golden do critério de liberação (docs/monte-seu-kit.md §6) com fixtures SINTÉTICAS.
// Estoque atual, idioma sem mistura, orçamento, frete por loja, frete desconhecido ≠ 0, link e oferta rastreáveis,
// limitação explícita quando falta dado.
import assert from 'node:assert/strict';
import { recomendar, freteDaCesta, idiomaDe, melhoresOfertas } from '../src/kit/recomendar.js';
import { nomeProduto } from '../api/_lib/kit.mjs';
import { label } from '../api/_seo.mjs';
import { MODELOS, OBJETIVO_MODELO } from '../src/kit/modelos.js';

const P = (id, type, name) => ({ id, type, name });
const O = (productId, storeId, price, extra = {}) => ({ productId, storeId, storeName: storeId.toUpperCase(), price, total: price, stock: 'IN_STOCK', url: `https://${storeId}.test/${productId}`, shippingKnown: false, shipping: null, source_timestamp: '2026-10-24T12:00:00Z', ...extra });
const produtos = [
  P('xx1-blister3', 'blister_3', 'Coleção X - Blister Triplo'), P('xx1-blister3-en', 'blister_3', 'Coleção X - Blister Triplo (Inglês)'),
  P('xx1-booster', 'booster_pack', 'Coleção X - Booster unitário'), P('xx1-etb', 'etb', 'Coleção X - Treinador Avançado (ETB)'),
  P('avulsos-deck-pikachu', 'deck', 'Box Pokémon - Baralho de Batalha Pikachu'), P('avulsos-colecao_ex-charizard', 'colecao_ex', 'Box Pokémon - Box Pokémon ex Charizard'),
  P('avulsos-colecao_ex-gengar', 'colecao_ex', 'Box Pokémon - Box Pokémon ex Gengar'),
];
const ofertas = [
  O('xx1-blister3', 'a', 30), O('xx1-blister3', 'b', 28, { stock: 'OUT_OF_STOCK' }), O('xx1-blister3-en', 'c', 20),
  O('xx1-booster', 'a', 12), O('xx1-etb', 'b', 380, { shippingKnown: true, shipping: 20 }), O('avulsos-deck-pikachu', 'c', 90, { shippingKnown: true, shipping: 15 }),
  O('avulsos-colecao_ex-charizard', 'a', 150), O('avulsos-colecao_ex-gengar', 'b', 140, { shippingKnown: true, shipping: 0 }),
];

assert.equal(idiomaDe('xx1-blister3-en'), 'en'); assert.equal(idiomaDe('xx1-blister3'), 'pt');
assert.equal(melhoresOfertas(ofertas).get('xx1-blister3').storeId, 'a', 'sem estoque nunca é a melhor oferta');
assert.equal(melhoresOfertas([O('p', 'a', 10, { anomalous: true }), O('p', 'b', 20, { stale: true }), O('p', 'c', 30)]).get('p').storeId, 'c', 'preço anômalo e leitura desatualizada ficam de fora');
for (const k of Object.values(OBJETIVO_MODELO)) if (k) assert.ok(MODELOS[k], k);

// 1. primeira coleção, R$ 100, português: blister triplo PT (nunca o inglês mais barato), até 3 unidades no orçamento
{
  const r = recomendar({ objetivo: 'colecionar', orcamento: 100, idioma: 'pt' }, produtos, ofertas);
  assert.equal(r.itens.length, 1); const it = r.itens[0];
  assert.deepEqual([it.productId, it.quantidade, it.oferta.storeId, it.idioma], ['xx1-blister3', 3, 'a', 'pt']);
  assert.equal(r.subtotal, 90); assert.ok(r.cabeNoOrcamento);
  assert.equal(it.oferta.url, 'https://a.test/xx1-blister3', 'link da oferta real'); assert.ok(it.oferta.source_timestamp, 'oferta rastreável');
  assert.equal(it.imagem, null, 'sem foto https: nenhuma imagem inventada');
  assert.equal(r.total, null, 'frete desconhecido: sem total'); assert.equal(r.fretes[0].frete, null);
  assert.deepEqual(r.acessorios, ['sleeve', 'fichario'], 'acessórios do modelo vão para a página completar o kit (lista curada, #991)');
  assert.ok(r.itens.every((it) => it.productId && it.oferta), 'a API não inventa item de acessório: só lacrados com oferta real');
  assert.ok(!JSON.stringify(r).match(/rara|chance|garantid|probabilidade/i), 'nunca promete carta');
}
// 1b. foto: a do anúncio; sem ela, a do produto
{
  const pr = [P('f1-b3', 'blister_3', 'F - Blister Triplo')]; pr[0].image = 'https://cat.test/f1.png';
  assert.equal(recomendar({ objetivo: 'colecionar', orcamento: 50, idioma: 'pt' }, pr, [O('f1-b3', 'a', 20, { image: 'https://a.test/foto.jpg' })]).itens[0].imagem, 'https://a.test/foto.jpg');
  assert.equal(recomendar({ objetivo: 'colecionar', orcamento: 50, idioma: 'pt' }, pr, [O('f1-b3', 'a', 20)]).itens[0].imagem, 'https://cat.test/f1.png');
  assert.equal(recomendar({ objetivo: 'colecionar', orcamento: 50, idioma: 'pt' }, pr, [O('f1-b3', 'a', 20, { image: 'http://cdn.test/f.webp' })]).itens[0].imagem, 'https://cdn.test/f.webp', 'foto do anúncio em http vira https');
}
// 1c. outras opções: mesmo papel e idioma, sem repetir o escolhido
{ const r = recomendar({ objetivo: 'colecionar', orcamento: 100, idioma: 'pt' }, produtos, ofertas); assert.deepEqual(r.alternativas.map((a) => a.productId), ['xx1-booster']); }
// 2. idioma inglês: só produto -en
{ const r = recomendar({ objetivo: 'abrir', orcamento: 60, idioma: 'en' }, produtos, ofertas); assert.deepEqual(r.itens.map((i) => [i.productId, i.quantidade]), [['xx1-blister3-en', 3]]); }
// 3. orçamento abaixo do mais barato: cesta vazia com motivo (não estoura)
{ const r = recomendar({ objetivo: 'colecionar', orcamento: 10, idioma: 'pt' }, produtos, ofertas); assert.equal(r.itens.length, 0); assert.ok(r.limitacoes.some((l) => /passa do orçamento/.test(l))); }
// 4. jogar: deck com frete conhecido → total = preço + frete daquela loja
{ const r = recomendar({ objetivo: 'jogar', orcamento: 120, idioma: 'pt' }, produtos, ofertas); assert.equal(r.itens[0].productId, 'avulsos-deck-pikachu'); assert.equal(r.total, 105); }
// 5. presente com ETB fora do orçamento cai para o próximo tipo que cabe? ETB 380 > 300: sem item e motivo
{ const r = recomendar({ objetivo: 'presentear', orcamento: 300, idioma: 'pt' }, produtos, ofertas); assert.equal(r.itens.length, 0); assert.ok(r.limitacoes.length); }
// 6. favorito filtra pelo nome; inexistente avisa e mostra as outras opções
{
  const g = recomendar({ objetivo: 'especiais', orcamento: 200, idioma: 'pt', favorito: 'Charizard' }, produtos, ofertas); assert.equal(g.itens[0].productId, 'avulsos-colecao_ex-charizard');
  const m = recomendar({ objetivo: 'especiais', orcamento: 200, idioma: 'pt', favorito: 'Mewtwo' }, produtos, ofertas); assert.equal(m.itens[0].productId, 'avulsos-colecao_ex-gengar', 'mais em conta quando o favorito não existe'); assert.ok(m.limitacoes.some((l) => /Mewtwo/.test(l)));
  assert.equal(m.total, 140, 'frete grátis informado pela loja conta como 0 conhecido');
}
// 7. proteger cartas: kit só de acessórios (a página escolhe na lista curada); a API não inventa item lacrado
{ const r = recomendar({ objetivo: 'proteger', orcamento: 100 }, produtos, ofertas); assert.equal(r.itens.length, 0); assert.equal(r.modelo, 'proteger'); assert.deepEqual(r.acessorios, ['sleeve', 'toploader', 'fichario', 'deck_box']); }
// 8. frete por loja: dois itens na mesma loja com frete por item conhecido → combinado desconhecido (nunca soma por item);
//    regra pública de frete grátis vale quando o subtotal da loja passa do mínimo
{
  const it = (p, price, ship) => ({ quantidade: 1, oferta: O(p, 'z', price, { shippingKnown: true, shipping: ship }) });
  const f = freteDaCesta([it('p1', 50, 10), it('p2', 60, 12)]); assert.equal(f.length, 1); assert.equal(f[0].frete, null, 'não soma frete por item');
  const g = freteDaCesta([it('p1', 150, 10), it('p2', 60, 12)], { z: { min: 199.99 } }); assert.equal(g[0].frete, 0); assert.match(g[0].como, /regra da loja/);
  const q = freteDaCesta([{ quantidade: 2, oferta: O('p1', 'y', 50, { shippingKnown: true, shipping: 10 }) }]); assert.equal(q[0].frete, null, 'duas unidades: frete do pedido desconhecido');
}
// 9. sem orçamento
{ assert.match(recomendar({ objetivo: 'jogar' }, produtos, ofertas).limitacoes[0], /orçamento/); }
// 10. nome na fonte do banco (sem `name`): mapa do robô; sem ele, rótulo "Coleção - Tipo" do SEO
{
  const db = { id: 'me03-blister3', collectionName: 'Equilíbrio Perfeito', type: 'blister_3', typeLabel: 'Blister Triplo' };
  assert.equal(nomeProduto(db, new Map([['me03-blister3', 'Equilíbrio Perfeito - Blister Triplo (robô)']]), label), 'Equilíbrio Perfeito - Blister Triplo (robô)');
  assert.equal(nomeProduto(db, new Map(), label), 'Equilíbrio Perfeito - Blister Triplo');
  assert.equal(nomeProduto({ ...db, name: 'Nome próprio' }, new Map(), label), 'Nome próprio');
  assert.equal(nomeProduto({ id: 'x-en', type: 'etb', typeLabel: 'Treinador Avançado (ETB)' }, new Map(), label), 'Pokémon TCG - Treinador Avançado (ETB) Inglês');
}
console.log('✓ kit-recomendar: estoque, idioma, orçamento, frete por loja, limitações (fixtures sintéticas)');
