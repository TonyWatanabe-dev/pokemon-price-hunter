// Vitrine "Com link do TCG Price Hunter" (home): só ofertas vivas de anúncio do ML com link do dono, uma por produto,
// `melhor` igual à melhor oferta do produto entre todas as lojas; nada muda ranking (os módulos de ranking não leem afiliados).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { vitrineAfiliados, parseAffiliates } from '../api/_lib/affiliates.mjs';

const cfg = parseAffiliates({ mercadolivre: { anuncios: { MLB1111111111: 'https://meli.la/aaa', MLB2222222222: 'https://meli.la/bbb', MLB3333333333: 'https://meli.la/ccc' } } });
const ml = (item, cat = 'MLB9') => `https://www.mercadolivre.com.br/p/${cat}?pdp_filters=item_id%3A${item}`;
const of = (id, productId, url, total, extra = {}) => ({ id, productId, url, total, price: total, stock: 'IN_STOCK', shippingKnown: true, storeId: 's', storeName: 'Loja', ...extra });
const st = {
  products: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }],
  offers: [
    of('a', 'p1', ml('MLB1111111111'), 100),                       // afiliado e melhor do p1
    of('b', 'p1', 'https://loja.com.br/p1', 120),
    of('c', 'p2', ml('MLB2222222222'), 90, { discount: 0.2 }),     // afiliado, mas p2 tem oferta mais barata em outra loja
    of('d', 'p2', 'https://loja.com.br/p2', 80),
    of('e', 'p3', ml('MLB3333333333'), 50, { stock: 'OUT_OF_STOCK' }),   // sem estoque: fora
    of('f', 'p3', ml('MLB4444444444'), 40),                        // ML sem link no mapa: fora
    of('g', 'px', ml('MLB1111111111'), 10),                        // produto desconhecido: fora
  ],
};
const r = vitrineAfiliados(st, cfg);
assert.equal(r.total, 2);
assert.deepEqual(r.items.map((x) => [x.offer.id, x.melhor]), [['a', true], ['c', false]], 'melhor primeiro; flag honesta');
assert.ok(r.items.every((x) => x.offer.url.includes('mercadolivre')), 'só anúncio do ML');
assert.equal(vitrineAfiliados(st, parseAffiliates({})).total, 0, 'sem mapa: vitrine vazia');
assert.equal(vitrineAfiliados({}, cfg).total, 0);

// ranking intocado: offer-rank/site/opportunity não importam affiliates.mjs
for (const f of ['api/_lib/offer-rank.mjs', 'api/_lib/site.mjs', 'src/core/opportunity-engine.js']) assert.ok(!/affiliates\.mjs/.test(fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')), `${f} não lê afiliados`);
// página: seção marcada como afiliado e com o link que passa por outUrl (selo de afiliado do dealCard)
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert.match(html, /function afilVitrineHTML\(\)/);
assert.match(html, /Com link do TCG Price Hunter/);
assert.match(html, /podemos receber comissão, sem custo extra para você\. Não muda a ordem nem a melhor oferta do site\./);
assert.match(html, /fetch\("\/api\/v1\/site\/afiliados"\)/);
console.log('✓ Vitrine de afiliados: só ML com link, uma por produto, melhor honesto, ranking intocado');
