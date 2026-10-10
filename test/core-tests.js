// Marketplace Core: conversões puras (sem banco).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { categoryOf, KNOWN_TYPES } from '../src/core/taxonomy.js';
import { detectLanguage, normalize, parseListing } from '../src/match.js';
import { productsRows, offersRows, historyRows, referenceRows, storesRows, marketplaceOf } from '../src/core/mappers.js';

// todo tipo que o matcher produz tem categoria no banco
const seed = fs.readFileSync(new URL('../db/migrations/002_seed.sql', import.meta.url), 'utf8');
for (const t of KNOWN_TYPES) assert.ok(seed.includes(`'${categoryOf(t)}'`), `categoria ${categoryOf(t)} não está no seed`);
assert.throws(() => categoryOf('tipo_inventado'));

// produto: slug igual ao do site, id antigo preservado
const P = [{ id: 'me05-etb', collection: 'me05', collectionName: 'Escuridão Absoluta', type: 'etb', typeLabel: 'Treinador Avançado (ETB)', group: 'ETB', boosters: 9, offerCount: 3 }];
const [p] = productsRows(P);
assert.equal(p.legacy_id, 'me05-etb'); assert.equal(p.collection_id, 'pokemon:me05'); assert.equal(p.category_id, 'sealed.etb');
assert.match(p.slug, /^escuridao-absoluta-treinador-avancado/);

// oferta: frete desconhecido nunca vira total; ML vira marketplace + vendedor
const base = { id: 'h1', productId: 'me05-etb', storeId: 'loja', title: 't', url: 'https://x', price: 100, total: 100, stock: 'IN_STOCK', matchConfidence: 0.85 };
const [o1] = offersRows([{ ...base, shipping: null, shippingKnown: false }]);
assert.equal(o1.total_price, null); assert.equal(o1.shipping_status, 'unknown'); assert.equal(o1.marketplace_id, 'direct'); assert.equal(o1.match_confidence, 85);
const [o2] = offersRows([{ ...base, shipping: 0, shippingKnown: true }]);
assert.equal(o2.shipping_status, 'free'); assert.equal(o2.total_price, 100);
const [o3] = offersRows([{ ...base, storeId: 'mercadolivre', sku: 'MLB123', seller: 'LOJA_TCG', sellerId: '77', sellerKind: 'marketplace_seller' }]);
assert.equal(o3.marketplace_id, 'mercadolivre'); assert.equal(o3.external_offer_id, 'MLB123'); assert.equal(o3.seller.external_id, '77');
assert.equal(marketplaceOf({ storeId: 'tocadotabuleiro' }), 'direct');
// vendedor parceiro em loja (Ri Happy): guardado com o nome, prefixado pela loja; loja sem vendedor não cria vendedor
const [o4] = offersRows([{ ...base, storeId: 'rihappycombr', seller: 'Gourmande', sellerKind: 'store' }]);
assert.equal(o4.marketplace_id, 'direct'); assert.deepEqual(o4.seller, { external_id: 'rihappycombr:Gourmande', name: 'Gourmande', is_official: false });
assert.equal(o1.seller, null);

// histórico: total só com frete conhecido; saída de oferta marcada
const h = historyRows([{ t: '2026-10-08T10:00:00Z', offerId: 'h1', productId: 'me05-etb', price: 100, shipping: null, total: 100, stock: 'IN_STOCK' },
  { t: '2026-10-08T11:00:00Z', offerId: 'h1', productId: 'me05-etb', stock: 'UNAVAILABLE', event: 'removed' }]);
assert.equal(h[0].total_price, null); assert.equal(h[1].event, 'removed'); assert.equal(h[1].stock_status, 'unknown');

// referência: sem fonte não entra; confirmada vira verified
assert.equal(referenceRows([{ id: 'a', copagConfirmed: true, msrp: 10, copag: {} }]).length, 0);
const [r] = referenceRows([{ id: 'a', copagConfirmed: true, msrp: 399.99, copag: { source_url: 'https://www.copagloja.com.br/x/p', confidence: 'OFICIAL' } }]);
assert.equal(r.verification_status, 'verified'); assert.equal(r.source, 'copag_loja');

// loja: status e Reclame Aqui
const [s] = storesRows([{ id: 'x', name: 'X', url: 'https://www.x.com.br', status: 'BLOCKED', fails: 2 }], { lojas: { x: { status: 'OTIMO', nota: 8.3, url: 'https://ra' } } });
assert.equal(s.status, 'blocked'); assert.equal(s.domain, 'x.com.br'); assert.equal(s.ra_score, 8.3);

// regra de negócio: o núcleo de preço nunca lê afiliados
for (const f of ['src/core/mappers.js', 'src/core/sync.js', 'src/score.js']) assert.ok(!/affiliate/i.test(fs.readFileSync(f, 'utf8')), `${f} não pode depender de afiliados`);
// idioma: só por evidência explícita no título; ausente = não informado (null), nunca presumido; conflito nunca casa
const lang = (s) => detectLanguage(normalize(s));
assert.equal(lang('Booster Box Escarlate e Violeta 36 boosters').code, null);
assert.equal(lang('Booster Box 36 boosters em Português (PT-BR)').code, 'pt');
assert.equal(lang('Pokémon Booster Box 36 packs [EN]').code, 'en');
assert.equal(lang('Pokemon Booster Box (JP) 30 packs').code, 'ja');
assert.equal(lang('Pokemon Display JPN').evidence, 'jpn');
assert.equal(lang('Pokémon Box coreano').code, 'ko');
assert.equal(lang('Booster inglês e japonês').conflict, true);
assert.equal(lang('Booster em português edição japonesa').conflict, true);
assert.equal(lang('Booster Box Mega Evolução').code, null); // "en" dentro de palavra não conta
assert.equal(lang('Deck Entei Pokemon').code, null);
const emptyCat = { collections: [], products: [] };
const rej = (s) => parseListing(s, emptyCat).rejects.includes('idioma diferente de PT');
assert.ok(rej('Pokémon Booster Box 36 boosters Inglês'));
assert.ok(rej('Pokémon Booster Box 36 boosters JP'));
assert.ok(rej('Pokémon Booster Box 36 boosters PT-BR japonês'));
assert.ok(!rej('Pokémon Booster Box 36 boosters PT-BR'));
assert.ok(!rej('Pokémon Booster Box 36 boosters'));
assert.equal(parseListing('Pokémon Booster Box 36 boosters', emptyCat).language.code, null);
assert.equal(parseListing('Pokémon Booster Box 36 boosters (EN)', emptyCat).language.evidence, 'en');
// hífen separa tokens de idioma (EN-US, JP-JA, Inglês-EN), como o \b da regra antiga; pt-br continua PT
assert.equal(lang('Booster Box 36 boosters EN-US').code, 'en');
assert.equal(lang('Booster Box JP-JA').code, 'ja');
assert.equal(lang('Box Treinador Avançado (Inglês-EN)').code, 'en');
assert.equal(lang('Box Treinador Avançado Japonês-JP').code, 'ja');
assert.equal(lang('Booster Box 36 boosters PT-BR').code, 'pt');
assert.equal(lang('Booster Box 36 boosters pt-br').code, 'pt');
assert.equal(lang('Booster Box 36 boosters ptbr').code, 'pt');
assert.ok(rej('Pokémon Booster Box 36 boosters EN-US'));
assert.ok(rej('Pokémon Booster Box 36 boosters JP-JA'));
assert.ok(rej('Pokémon Booster Box 36 boosters Inglês-EN'));
assert.ok(rej('Pokémon Booster Box 36 boosters Japonês-JP'));
assert.ok(!rej('Pokémon Booster Box 36 boosters pt-br'));
// palavras hifenizadas sem token de idioma não viram idioma
for (const t of ['Pokémon Mega-Evolução Booster Box', 'Pokémon Sun-Moon Booster', 'Pokémon X-Y Booster Box', 'Booster Box pré-venda', 'Booster Box SV-04 Fenda-Paradoxal', 'Booster Box Escarlate-Violeta 151']) {
  assert.equal(lang(t).code, null, t); assert.equal(lang(t).conflict, false, t); assert.ok(!rej(t), t);
}
{
  const { matchProduct } = await import('../src/match.js');
  const catalog = JSON.parse(fs.readFileSync(new URL('../config/catalog.json', import.meta.url), 'utf8'));
  assert.equal(matchProduct({ title: 'Pokémon TCG Booster Box Fogo Fantasmagórico 36 Boosters' }, catalog).productId, 'me02-box36');
  for (const t of ['Pokémon TCG Booster Box Fogo Fantasmagórico 36 Boosters EN-US', 'Pokémon TCG Booster Box Fogo Fantasmagórico 36 Boosters JP-JA']) {
    assert.notEqual(matchProduct({ title: t }, catalog).productId, 'me02-box36', t);
  }
  for (const t of ['Pokémon TCG Box Treinador Avançado Fogo Fantasmagórico JP-JA', 'Pokémon TCG Box Treinador Avançado Fogo Fantasmagórico (Inglês-EN)', 'Pokémon TCG Box Treinador Avançado Fogo Fantasmagórico Versão EN-US']) {
    assert.notEqual(matchProduct({ title: t }, catalog).productId, 'me02-etb', t);
  }
}
console.log('OK — Marketplace Core (conversões)');
