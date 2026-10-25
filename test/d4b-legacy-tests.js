// D4b (frentes/T5-D4.md, rodada 2) — o state.json do robô (api/_lib/legacy.mjs: raw do ramo data e, na falha, o raw da
// main, cópia congelada de 07/10) só alimenta a API dentro do limite que já existe (LIMITS.EXPIRA_MIN, 24 h; `classify`).
// Handlers reais (api/v1.mjs, api/pagina.mjs, api/sitemap.mjs) com banco simulado (pool.query) e fetch falso; sem rede.
//  1–3  catalogState('db'): banco em dia + state vencido/sem horário/ausente → preços do banco, campos do robô omitidos
//       (menor preço já visto, média, histórico, pistas, reputação, atividade, distrust, cobertura, nota das lojas); em dia → sobrepostos
//  4    /api/v1/frete: state vencido → 503 (sem cotação, nunca frete zero)
//  5    caches: memória do v1, do legacy ("cópia antiga") e do _seo; Cache-Control da CDN só com dado utilizável (limite do atraso)
//  6    SSR × API do mesmo produto: recente (mesmo menor preço), 2 h (SSR sem preço, API marcada), 2 dias (SSR sem preço, API 503)
//  7    sitemap com state vencido não usa a cópia
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); process.chdir(root);
let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { e.message = `${name}: ${e.message}`; throw e; } };

const NOW = Date.now(); const H = 3600e3;
const at = (ms) => new Date(NOW - ms).toISOString();
const FR = await import('../api/_lib/freshness.mjs'); FR.setFreshnessClock(() => NOW);

// ---- state.json do robô (fixture). dataAt controla o frescor; campos do robô com marcadores fáceis de achar.
const legado = (dataAt) => ({
  generatedAt: dataAt ?? at(5 * 60e3), ...(dataAt !== undefined ? { dataAt } : {}), coverage: { stores: 2, marca: 'COBERTURA-ROBO' }, totals: { offers: 3 },
  collections: [{ id: 'me05', name: 'Escuridão Absoluta' }], types: [{ id: 'etb', label: 'Treinador Avançado (ETB)', group: 'ETB' }],
  products: [{ id: 'me05-etb', collection: 'me05', collectionName: 'Escuridão Absoluta', type: 'etb', typeLabel: 'Treinador Avançado (ETB)', group: 'ETB', boosters: 9,
    copagConfirmed: true, msrp: 400, offerCount: 3, lowestHistorical: { total: 123.45, at: '2026-09-01T00:00:00Z' }, marketAverage: 777.77, hist: [[1, 2]], firstSeen: '2026-08-01T00:00:00Z' }],
  offers: [
    { id: 'oa', productId: 'me05-etb', storeId: 'a', storeName: 'Loja A', url: 'https://a.com.br/etb', price: 380, priceKind: 'pix', shipping: null, shippingKnown: false, total: 380, perBooster: 1.11, stock: 'IN_STOCK', source_timestamp: dataAt ?? at(5 * 60e3), storeValidated: true, releaseDate: null, sku: '10', ean: null, vtex: { base: 'https://a.com.br', itemId: '10', sellerId: '1' } },
    { id: 'ob', productId: 'me05-etb', storeId: 'b', storeName: 'Loja B', url: 'https://b.com.br/etb', price: 360, priceKind: 'base', shipping: 20, shippingKnown: true, total: 380, perBooster: 2.22, stock: 'IN_STOCK', source_timestamp: dataAt ?? at(5 * 60e3), storeValidated: true },
    { id: 'oc', productId: 'me05-etb', storeId: 'b', storeName: 'Loja B', url: 'https://b.com.br/etb2', price: 350, priceKind: 'base', shipping: null, shippingKnown: false, total: 350, perBooster: 3.33, stock: 'IN_STOCK', source_timestamp: dataAt ?? at(5 * 60e3), storeValidated: true },
  ],
  activity: [{ t: at(H), productId: 'me05-etb', offerId: 'oa', storeName: 'Loja A', to: 380, from: 400, type: 'drop', marca: 'ATIVIDADE-ROBO' }],
  tips: [{ key: 'tg:1', id: 't1', source: 'Telegram', title: 'PISTA-ROBO', productId: 'me05-etb', price: 330, postedAt: at(H), url: 'https://t.me/x/1' }],
  sources: [{ id: 'a', name: 'Loja A', url: 'https://a.com.br', status: 'ACTIVE', score: { evidence: ['NOTA-ROBO'] } }, { id: 'b', name: 'Loja B', url: 'https://b.com.br', status: 'ACTIVE', score: { evidence: ['NOTA-ROBO'] } }],
  reputation: { consultadoEm: '2026-10-01', lojas: { b: { status: 'BOM', nota: 7.9, marca: 'REPUTACAO-ROBO' } } },
  distrust: { from: at(2 * H), to: at(H), marca: 'DISTRUST-ROBO' },
});
const FRESCO = () => legado(at(5 * 60e3)), VENCIDO = () => legado(at(48 * H)), SEM_HORA = () => legado(null);
const COPIA_0710 = () => { const s = legado(undefined); s.generatedAt = '2026-10-07T13:45:26.327Z'; for (const o of s.offers) o.source_timestamp = s.generatedAt; return s; };   // como a da main: sem dataAt

// ---- banco simulado (mesmas linhas para todos os casos; preços do banco = 299 para distinguir dos do robô)
const DB_AT = at(4 * 60e3);
const productRows = [{ id: 1, legacy_id: 'me05-etb', units: 9, variant: null, image_url: null, attrs: { type: 'etb', typeLabel: 'Treinador Avançado (ETB)', group: 'ETB' },
  col_code: 'me05', col_name: 'Escuridão Absoluta', ref_value: 400, ref_status: 'verified', ref_url: 'https://copag', ref_source: 'copag_loja', ref_verified_at: at(H), ref_kind: 'COPAG_OFFICIAL_CURRENT', ean: null }];
const offerRows = ['oa', 'ob', 'oc'].map((id, i) => ({ legacy_id: id, product_legacy: 'me05-etb', store_id: i ? 'b' : 'a', store_name: i ? 'Loja B' : 'Loja A', seller_name: null,
  url: `https://x/${id}`, image_url: null, price: 299 + i, price_kind: 'base', shipping_price: null, shipping_status: 'unknown', total_price: null, stock_status: 'in_stock',
  quantity: null, confirmed: true, anomalous: false, status: 'active', first_seen_at: at(10 * H), last_seen_at: DB_AT, opp_score: 70, opp_band: 'boa', opp_conf: 0.8 }));
const responder = (sql) => {
  if (/max\(last_seen_at\)/.test(sql)) return [{ at: DB_AT }];
  if (/op\.opportunity_score AS opp_score/.test(sql)) return offerRows;
  if (/FROM hunter\.product p\s+LEFT JOIN hunter\.collection/.test(sql) && /WHERE p\.legacy_id IS NOT NULL\s*$/.test(sql)) return productRows;
  if (/FROM hunter\.collection ORDER BY code/.test(sql)) return [{ id: 'me05', name: 'Escuridão Absoluta', series: null, aliases: [] }];
  return [];
};

const { setLegacyLoader } = await import('../api/_lib/legacy.mjs');
const { clearCatalogCache } = await import('../api/_lib/catalog.mjs');
const v1mod = await import('../api/v1.mjs'); const api = v1mod.default;
const DBM = await import('../api/_lib/db.mjs');
async function useDb(on) {
  await DBM.closeApiPool(); delete process.env.API_DATABASE_URL; delete process.env.DATABASE_URL;
  if (on) { process.env.API_DATABASE_URL = 'postgres://t:t@127.0.0.1:1/t'; const pool = await DBM.apiPool(); pool.query = async (sql) => ({ rows: responder(String(sql)) }); }
  FR.clearFreshnessCache(); clearCatalogCache(); v1mod._cache.clear();
}
const call = async (url) => { const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  await api({ url, method: 'GET', headers: {} }, res); let json = null; try { json = JSON.parse(res.body); } catch {}
  return { status: res.statusCode, h: res.headers, json, body: String(res.body || '') }; };
const ROBO = /COBERTURA-ROBO|ATIVIDADE-ROBO|PISTA-ROBO|NOTA-ROBO|REPUTACAO-ROBO|DISTRUST-ROBO|123\.45|777\.77/;
const loader = (fn) => { setLegacyLoader(fn); clearCatalogCache(); v1mod._cache.clear(); };

await t('1. banco em dia + cópia de 07/10 (ou vencida/sem horário/ausente): preços do banco, nada do robô, frescor do banco', async () => {
  await useDb(true);
  for (const [nome, fx] of [['cópia de 07/10', COPIA_0710], ['vencido 48 h', VENCIDO], ['sem horário', SEM_HORA], ['ausente', null]]) {
    loader(fx ? async () => fx() : async () => { throw new Error('state.json indisponível'); });
    for (const rota of ['/api/v1/home', '/api/v1/site/produto/me05-etb', '/api/v1/site/ofertas?colecao=me05', '/api/v1/site/pagina/pistas', '/api/v1/site/kit?objetivo=colecionar&orcamento=500']) {
      const r = await call(rota);
      assert.equal(r.status, rota.includes('/kit') && r.status === 404 ? 404 : 200, `${nome} ${rota}: ${r.status} ${r.body.slice(0, 120)}`);
      if (r.status !== 200) continue;
      assert.doesNotMatch(r.body, ROBO, `${nome} ${rota}: campo do robô vencido saiu junto do preço do banco`);
      assert.equal(r.h['X-Data-Source'], 'db', `${nome} ${rota}`);
    }
    const h = await call('/api/v1/home');
    assert.equal(h.json.freshness.status, 'atual'); assert.ok(h.json.offers.some((o) => o.price === 299), 'preço do banco');
    assert.deepEqual(h.json.tips ?? [], []); assert.equal(h.json.reputation ?? null, null); assert.equal(h.json.distrust ?? null, null);
    assert.ok(h.json.products.every((p) => p.lowestHistorical == null && p.marketAverage == null), `${nome}: menor preço/média do robô`);
  }
});

await t('2. banco em dia + state em dia: campos do robô continuam sobrepostos (comportamento de antes)', async () => {
  await useDb(true); loader(async () => FRESCO());
  const h = await call('/api/v1/home');
  assert.equal(h.status, 200); assert.match(h.body, /PISTA-ROBO/); assert.match(h.body, /NOTA-ROBO/); assert.match(h.body, /ATIVIDADE-ROBO/);
  assert.ok(h.json.products.some((p) => p.lowestHistorical?.total === 123.45));
});

await t('3. limite = o da API: 24 h aceito, 24 h + 1 min omitido (classify)', async () => {
  await useDb(true);
  for (const [min, robo] of [[1440, true], [1441, false]]) {
    loader(async () => legado(at(min * 60e3)));
    const h = await call('/api/v1/home'); assert.equal(h.status, 200);
    assert.equal(/PISTA-ROBO/.test(h.body), robo, `${min} min`);
    assert.equal(FR.classify(at(min * 60e3)).status === 'indisponivel', !robo);
  }
});

await t('4. frete: state vencido ou sem horário → 503 sem cotação (nunca frete zero); em dia → atende', async () => {
  await useDb(false); process.env.SHIPPING_CALC_ENABLED = '1';
  let cotou = 0;
  v1mod._setFrete({ service: { quote: async () => { cotou++; return { ok: true, options: [{ price: 0, days: 1 }] }; } } });
  try {
    for (const fx of [COPIA_0710, VENCIDO, SEM_HORA]) {
      loader(async () => fx());
      for (const rota of ['/api/v1/frete/estado', '/api/v1/frete?oferta=oa&cep=01001000&quantidade=1']) {
        const r = await call(rota); assert.equal(r.status, 503, `${rota}: ${r.status} ${r.body.slice(0, 80)}`); assert.equal(r.h['Cache-Control'], 'no-store');
        assert.doesNotMatch(r.body, /"price"\s*:\s*0/);
      }
    }
    assert.equal(cotou, 0, 'nenhuma cotação com dado vencido');
    loader(async () => FRESCO());
    const e = await call('/api/v1/frete/estado'); assert.equal(e.status, 200); assert.equal(e.json.enabled, true);
  } finally { delete process.env.SHIPPING_CALC_ENABLED; v1mod._setFrete(null); }
});

await t('5. caches: dado que venceu em cache não sai como atual (v1, legacy "cópia antiga", _seo) e a CDN só guarda dado utilizável', async () => {
  // (a) memória do v1 + cópia do legacy: em dia às NOW; o mesmo objeto, 25 h depois, sai 503 (state) / sem campos do robô (db)
  await useDb(false); loader(async () => FRESCO());
  let r = await call('/api/v1/home'); assert.equal(r.status, 200); assert.match(r.h['Cache-Control'], /s-maxage=60, stale-while-revalidate=300/);
  FR.setFreshnessClock(() => NOW + 25 * H); clearCatalogCache();
  r = await call('/api/v1/home'); assert.equal(r.status, 503, 'cache do v1 e do legacy não seguram dado vencido'); assert.equal(r.h['Cache-Control'], 'no-store');
  FR.setFreshnessClock(() => NOW);
  // (b) "cópia antiga" do legacy: a fonte cai depois de uma leitura boa; 25 h depois a cópia em memória não vira atual
  await useDb(false); let falha = false; loader(async () => { if (falha) throw new Error('raw fora'); return FRESCO(); });
  assert.equal((await call('/api/v1/home')).status, 200); falha = true; FR.setFreshnessClock(() => NOW + 25 * H); v1mod._cache.clear();
  r = await call('/api/v1/home'); assert.equal(r.status, 503); assert.equal(r.json.freshness?.status ?? 'indisponivel', 'indisponivel');
  FR.setFreshnessClock(() => NOW);
  // (c) CDN: Cache-Control público só com frescor utilizável; desatualizado/fallback/5xx = no-store. Atraso máximo de uma cópia
  //     de CDN = idade utilizável (90 min) + s-maxage + stale-while-revalidate, bem abaixo das 24 h do vencimento.
  for (const [idade, cc] of [[5, /s-maxage/], [200, /^no-store$/]]) {
    await useDb(false); loader(async () => legado(at(idade * 60e3)));
    r = await call('/api/v1/home'); assert.match(r.h['Cache-Control'], cc, `${idade} min`);
  }
  const maxAtraso = (cc) => { const g = (k) => Number((cc.match(new RegExp(k + '=(\\d+)')) || [, 0])[1]); return g('s-maxage') + g('stale-while-revalidate'); };
  const CDN = ['public, max-age=30, s-maxage=60, stale-while-revalidate=300', 'public, max-age=60, s-maxage=120, stale-while-revalidate=600'];
  for (const cc of CDN) assert.ok(FR.LIMITS.ATRASADO_MIN + maxAtraso(cc) / 60 < FR.LIMITS.EXPIRA_MIN, cc);
  assert.ok(FR.LIMITS.ATRASADO_MIN + maxAtraso('public, max-age=0, s-maxage=600, stale-while-revalidate=3600') / 60 < FR.LIMITS.EXPIRA_MIN, 'SSR com preço: ≤ 160 min');
});

// ---- SSR (api/pagina.mjs) com o raw do ramo data simulado
let RAW_ST = FRESCO(); let rawFalha = false;
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, o) => { const s = String(u);
  if (/raw\.githubusercontent\.com\/.+\/data\/state\.json/.test(s)) { if (rawFalha) return new Response('x', { status: 503 }); return new Response(JSON.stringify(RAW_ST), { status: 200 }); }
  if (/^http:\/\/(localhost|127)/.test(s)) return realFetch(u, o); throw new Error('rede bloqueada: ' + s); };
const { default: pagina } = await import('../api/pagina.mjs');
const { slugs } = await import('../api/_seo.mjs');
const ssr = async (slug) => { const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = String(b || ''); } };
  await pagina({ url: `/api/pagina?t=produto&slug=${slug}`, headers: { host: 'tcgpricehunter.com.br' } }, res); return res; };
const preco = (txt) => { const m = String(txt).match(/a partir de R\$ ([\d.]+,\d{2})/); return m ? Number(m[1].replace(/\./g, '').replace(',', '.')) : null; };
const liveMin = (offers) => offers.filter((o) => o.stock === 'IN_STOCK' && !o.stale && !o.anomalous && o.total > 0).reduce((m, o) => (m == null || o.total < m ? o.total : m), null);

await t('6. SSR × API do mesmo produto: recente igual; 2 h SSR sem preço e API marcada; 2 dias SSR sem preço e API 503', async () => {
  await useDb(false);
  const slug = slugs(FRESCO().products).of['me05-etb'];
  // recente: o mesmo state no SSR e na API (fonte state)
  RAW_ST = FRESCO(); loader(async () => RAW_ST);
  let s = await ssr(slug); const a = await call('/api/v1/site/produto/me05-etb');
  assert.equal(a.status, 200); assert.equal(a.json.freshness.status, 'atual');
  const pSsr = preco((s.body.match(/<title>([^<]*)<\/title>/) || [])[1]);
  assert.ok(pSsr != null, 'SSR recente com preço no título'); assert.equal(pSsr, liveMin(a.json.offers), 'mesmo menor preço no SSR e na API');
  assert.match(s.headers['cache-control'], /s-maxage=600/);
  // o _seo guarda o state por 10 min (Date.now) e a API o legacy por 60 s: o MESMO state em cache, com o relógio de frescor
  // adiantado, mostra o que cada lado faz quando ele envelhece (desatualizado e vencido) sem nova leitura.
  FR.setFreshnessClock(() => NOW + 25 * H);
  s = await ssr(slug); const v = await call('/api/v1/site/produto/me05-etb');
  assert.equal(preco(s.body), null, 'state em cache vencido: SSR sem preço'); assert.doesNotMatch(s.headers['cache-control'], /s-maxage=600/);
  assert.equal(v.status, 503, 'API: vencido = 503'); assert.equal(v.h['Cache-Control'], 'no-store');
  FR.setFreshnessClock(() => NOW + 2 * H); v1mod._cache.clear();   // relógio 2 h depois (voltar o relógio exige limpar o cache do v1)
  s = await ssr(slug); const d = await call('/api/v1/site/produto/me05-etb');
  assert.equal(preco(s.body), null, 'desatualizado: SSR sem preço'); assert.equal(d.status, 200); assert.equal(d.json.freshness.status, 'desatualizado'); assert.equal(d.h['Cache-Control'], 'no-store');
  FR.setFreshnessClock(() => NOW);
});

await t('7. sitemap: state vencido em cache não vira lastmod/URLs de produto', async () => {
  const { default: sitemap } = await import('../api/sitemap.mjs');
  const sm = async () => { const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = String(b || ''); } }; await sitemap({ url: '/sitemap.xml', headers: {} }, res); return res.body; };
  FR.setFreshnessClock(() => NOW);
  assert.match(await sm(), /\/produto\//, 'em dia: produtos no sitemap');
  FR.setFreshnessClock(() => NOW + 25 * H);
  assert.doesNotMatch(await sm(), /\/produto\//, 'vencido: sem produtos');
  FR.setFreshnessClock(() => NOW);
});

await t('8. /lojas com os campos do robô fora: loja com oferta viva no banco nunca "sem leitura"; status e plataforma ficam', async () => {
  await useDb(true);
  const comErro = () => { const x = COPIA_0710(); x.sources[1].status = 'ERROR'; return x; };   // status antigo ruim, banco lendo agora
  for (const [nome, fx] of [['cópia de 07/10', COPIA_0710], ['cópia com ERROR', comErro], ['vencido', VENCIDO], ['ausente', null]]) {
    loader(fx ? async () => fx() : async () => { throw new Error('state.json indisponível'); });
    const r = await call('/api/v1/site/pagina/lojas'); assert.equal(r.status, 200, nome);
    const vivas = r.json.lojas.filter((l) => l.offersLive > 0);
    assert.ok(vivas.length >= 2, `${nome}: lojas com oferta viva listadas (${vivas.map((l) => l.id)})`);
    for (const l of vivas) assert.equal(l.status, 'monitorada', `${nome}: ${l.id} com ${l.offersLive} ofertas vivas está "${l.status}"`);
    assert.doesNotMatch(r.body, /NOTA-ROBO/, `${nome}: nota antiga da loja não volta`);
  }
  // status e plataforma ficam no overlay (configuração, não valor de outra época); a nota sai
  const { legacyOverlay } = await import('../api/_lib/catalog.mjs');
  const src = { ...COPIA_0710(), sources: [{ id: 'a', name: 'Loja A', url: 'https://a.com.br', status: 'PAUSED', platform: 'vtex', score: { evidence: ['x'] }, lastSuccess: '2026-10-07T13:00:00Z' }] };
  assert.deepEqual(legacyOverlay(src).sources, [{ id: 'a', name: 'Loja A', url: 'https://a.com.br', status: 'PAUSED', platform: 'vtex', platformHint: undefined }]);
});

globalThis.fetch = realFetch; await DBM.closeApiPool(); delete process.env.API_DATABASE_URL;
console.log(`d4b-legacy: ${n} grupos ok`);
