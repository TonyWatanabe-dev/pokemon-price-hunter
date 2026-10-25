// tools/bench-site.mjs: benchmark offline das funções do site. Aqui só o que é estável em qualquer máquina:
// estatísticas, state sintético N× (ids/slugs únicos, idioma no fim do id), banco simulado cobrindo as rotas medidas,
// um conjunto pequeno de ponta a ponta (status, contagens, fonte) e orçamentos de TAMANHO do slim. Tempo não é critério
// (CI varia): só um teto folgado de 5 s por chamada, que pega travamento, não lentidão.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { estatisticas, sintetico, bancoSimulado, tamanhosSlim, rodarConjunto, resolverState } from '../tools/bench-site.mjs';
import { slugs } from '../api/_seo.mjs';

let n = 0;
async function t(nome, fn) { try { await fn(); n++; } catch (e) { console.error('✗ ' + nome); throw e; } }

const AT = '2026-10-12T17:55:00.000Z';
const fx = () => ({
  generatedAt: AT, dataAt: AT, coverage: {}, totals: {},
  collections: [{ id: 'c1', name: 'Alfa', series: 'S', aliases: ['a'] }, { id: 'c2', name: 'Beta', series: 'S', aliases: [] }],
  types: [{ id: 'etb', label: 'Treinador Avançado (ETB)', group: 'ETB' }, { id: 'booster_box', label: 'Booster Box', group: 'Boosters' }],
  products: [
    { id: 'c1-etb', collection: 'c1', collectionName: 'Alfa', type: 'etb', typeLabel: 'Treinador Avançado (ETB)', group: 'ETB', boosters: 9, offerCount: 2, copagConfirmed: true, msrp: 400, copag: { source_url: 'https://www.copagloja.com.br/x/p', source_timestamp: AT } },
    { id: 'c2-bb-en', collection: 'c2', collectionName: 'Beta', type: 'booster_box', typeLabel: 'Booster Box', group: 'Boosters', boosters: 36, offerCount: 1 },
  ],
  offers: [
    { id: 'o1', productId: 'c1-etb', storeId: 's1', storeName: 'Loja 1', title: 'ETB', url: 'https://l1.com.br/etb', price: 300, total: 300, shipping: 0, shippingKnown: true, stock: 'IN_STOCK', confirmed: true, firstSeen: AT, source_timestamp: AT, dealScore: 70 },
    { id: 'o2', productId: 'c1-etb', storeId: 's2', storeName: 'Loja 2', title: 'ETB', url: 'https://l2.com.br/etb?x=1', price: 320, total: 320, shipping: null, shippingKnown: false, stock: 'IN_STOCK', confirmed: true, firstSeen: AT, source_timestamp: AT },
    { id: 'o3', productId: 'c2-bb-en', storeId: 's1', storeName: 'Loja 1', title: 'BB', url: 'https://l1.com.br/bb', price: 900, total: 900, shipping: 0, shippingKnown: true, stock: 'OUT_OF_STOCK', confirmed: true, firstSeen: AT, source_timestamp: AT },
  ],
  sources: [{ id: 's1', name: 'Loja 1', url: 'https://l1.com.br', status: 'ACTIVE' }, { id: 's2', name: 'Loja 2', url: 'https://l2.com.br', status: 'ACTIVE' }],
  activity: [], tips: [], bestDeals: [],
});

await t('1. estatísticas: média, mediana, p95 por posto, min e max', () => {
  const e = estatisticas([5, 1, 4, 2, 3, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 100]);
  assert.equal(e.n, 20); assert.equal(e.min, 1); assert.equal(e.max, 100); assert.equal(e.p95, 19); assert.equal(e.mediana, 10); assert.equal(e.media, 14.5);
  assert.deepEqual(estatisticas([]), { n: 0, media: null, mediana: null, p95: null, min: null, max: null });
  assert.equal(estatisticas([3]).p95, 3);
});

await t('2. sintético 5×: contagens multiplicadas, ids e slugs únicos, idioma continua no fim do id, ofertas apontam para produtos existentes', () => {
  const base = fx(); const s = sintetico(base, 5);
  assert.equal(s.products.length, 10); assert.equal(s.offers.length, 15); assert.equal(s.collections.length, 10);
  for (const k of ['products', 'offers', 'collections']) assert.equal(new Set(s[k].map((x) => x.id)).size, s[k].length, `${k}: ids únicos`);
  const ids = new Set(s.products.map((p) => p.id)); assert.ok(s.offers.every((o) => ids.has(o.productId)));
  assert.ok(s.products.filter((p) => p.type === 'booster_box').every((p) => /-en$/.test(p.id)), 'importado continua importado');
  const { of } = slugs(s.products); assert.equal(new Set(Object.values(of)).size, 10);
  assert.ok(Object.values(of).every((x) => !/-\d+$/.test(x)), 'nomes de coleção distintos: nenhum slug precisou de sufixo');
  assert.equal(new Set(s.offers.map((o) => o.url)).size, 15, 'URLs de oferta distintas');
  assert.equal(s.dataAt, base.dataAt); assert.equal(s.generatedAt, base.generatedAt);
  assert.equal(base.products.length, 2, 'não altera o original'); assert.equal(sintetico(base, 1), base);
});

await t('3. banco simulado: responde frescor, produtos, ofertas, coleções e oportunidades (paginado); SQL desconhecido vira [] e é registrado', async () => {
  const b = bancoSimulado(fx());
  assert.deepEqual(b.contagem, { produtos: 2, ofertas: 3, oportunidades: 1 });
  assert.equal((await b.query('SELECT max(last_seen_at) AS at FROM hunter.offer')).rows[0].at, AT);
  const opp = (await b.query('SELECT ..., count(*) OVER () AS total_rows FROM hunter.product_opportunity o', [null, null, null, 10, 0])).rows;
  assert.equal(opp.length, 1); assert.equal(opp[0].total_rows, 1); assert.equal(opp[0].offer_legacy, 'o1');
  assert.deepEqual((await b.query('SELECT 1 FROM hunter.qualquer')).rows, []); assert.equal(b.naoSimulado.size, 1);
});

await t('4. ponta a ponta num conjunto pequeno (real e 3×): status 200, fonte certa, sitemap cresce com os produtos, nenhum SQL sem simulação', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-teste-')); const arquivo = path.join(dir, 'state.json');
  try {
    fs.writeFileSync(arquivo, JSON.stringify(fx()));
    assert.equal(resolverState({ state: arquivo }).arquivo, arquivo);
    const [um, tres] = [1, 3].map((escala) => rodarConjunto({ arquivo, escala, n: 2 }));
    assert.equal(um.produtos, 2); assert.equal(tres.produtos, 6); assert.equal(tres.ofertas, 9);
    for (const c of [um, tres]) {
      for (const g of ['pagina', 'v1State', 'paginaBanco', 'v1Banco']) for (const [k, v] of Object.entries(c[g])) {
        assert.equal(v.status, 200, `${g}/${k}`); assert.equal(v.n, 2); assert.ok(v.bytes > 0);
        assert.ok(v.max < 5000 && v.frioMs < 5000, `${g}/${k}: sem travamento (${v.max} ms)`);
      }
      for (const k of ['home', 'produto', 'colecao', 'oportunidades']) assert.equal(c.pagina[k].noindex, undefined, `${k}: página indexável`);
      assert.equal(c.v1State.home.fonte, 'state'); assert.equal(c.v1Banco.home.fonte, 'db');
      assert.deepEqual(c.banco.sqlNaoSimulado, {}, 'todas as consultas das rotas medidas estão simuladas');
      assert.equal(c.fetchesState, 2, 'state.json baixado uma vez por módulo (página e API), depois só cache');
    }
    assert.ok(tres.sitemap.urls > um.sitemap.urls, `sitemap cresce: ${um.sitemap.urls} → ${tres.sitemap.urls}`);
    assert.ok(tres.pagina.colecao.bytes >= um.pagina.colecao.bytes - 200);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

await t('5. orçamentos de tamanho do slim (folgados; linha de base 25/10: app.html 32 KB, CSS 32 KB gzip, JS 95 KB gzip)', async () => {
  const s = await tamanhosSlim();
  assert.equal(s.arquivos.length, 2);
  assert.ok(s.appHtml.gzip < 24 * 1024, `app.html gzip ${s.appHtml.gzip} B`);
  assert.ok(s.css.gzip < 64 * 1024, `CSS gzip ${s.css.gzip} B`);
  assert.ok(s.js.gzip < 160 * 1024, `JS gzip ${s.js.gzip} B`);
  assert.ok(s.appHtml.bytes + s.css.bytes + s.js.bytes >= s.indexHtml.bytes - 1024, 'o slim só move bytes, não some com eles');
});

console.log(`resiliencia-bench-tests: ${n} testes ok`);
