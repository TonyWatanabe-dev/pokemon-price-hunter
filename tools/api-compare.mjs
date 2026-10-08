// Comparação automática state.json × API (FASE 3).
// 1) Home: o resumo montado do banco contra o montado do state.json, no que o site MOSTRA (melhor preço por produto,
//    pódio/sequência de oportunidades, mural de coleções, contadores) e campo a campo nas ofertas em comum.
// 2) Endpoints: preço atual, estoque, referência Copag e ofertas de cada produto, banco × state.json.
// Uso: DATABASE_URL=... node tools/api-compare.mjs <pasta-data> [saida.json]   (sai com 1 se houver divergência crítica)
import fs from 'node:fs';
import path from 'node:path';
import { slimHome } from '../api/_lib/home.mjs';

const live = (o) => o.stock === 'IN_STOCK' && !o.stale && !o.anomalous && o.total > 0;
const eq = (a, b) => (a == null && b == null) || (a != null && b != null && (typeof a === 'number' || typeof b === 'number' ? Math.abs(Number(a) - Number(b)) < 0.005 : String(a) === String(b)));

/** O que a Home exibe, calculado como o site calcula (mesmas regras de tools/page.template.html). */
export function homeView(h) {
  const cols = new Map((h.collections || []).map((c) => [c.id, c])); const types = new Map((h.types || []).map((t) => [t.id, t]));
  const P = new Map(h.products.map((p) => [p.id, { ...p, collectionName: p.collectionName ?? cols.get(p.collection)?.name, typeLabel: p.typeLabel ?? types.get(p.type)?.label, group: p.group ?? types.get(p.type)?.group }]));
  const best = {}; const pool = {}; const wall = {};
  for (const o of h.offers) {
    if (!live(o)) continue; const p = P.get(o.productId); if (!p) continue;
    if (!best[p.id] || o.total < best[p.id].total || (o.total === best[p.id].total && (o.dealScore ?? -1) > (best[p.id].dealScore ?? -1))) best[p.id] = o;
    if (p.copagConfirmed && o.dealScore != null && o.confirmed !== false && o.discount > 0) { const c = pool[p.id]; if (!c || o.dealScore > c.dealScore || (o.dealScore === c.dealScore && o.total < c.total)) pool[p.id] = o; }
    const w = (wall[p.collection] ||= { n: new Set(), min: Infinity }); w.n.add(p.id); if (o.total < w.min) w.min = o.total;
  }
  const poolList = Object.values(pool).sort((a, b) => b.dealScore - a.dealScore || b.discount - a.discount).slice(0, 15).map((o) => `${o.productId}:${o.id}:${o.dealScore}`);
  return { P, best, poolList, wall: Object.fromEntries(Object.entries(wall).map(([k, v]) => [k, { products: v.n.size, min: v.min }])), counts: h.counts };
}

export function compareHome(hDb, hSt) {
  const a = homeView(hDb); const b = homeView(hSt);
  const d = { productsOnlyInDb: [], productsOnlyInState: [], productFieldDiffs: [], bestPriceDiffs: [], poolDiffs: [], wallDiffs: [], countDiffs: [], offerFieldDiffs: [], offersOnlyInDb: [], offersOnlyInState: [] };
  for (const id of a.P.keys()) if (!b.P.has(id)) d.productsOnlyInDb.push(id);
  for (const id of b.P.keys()) if (!a.P.has(id)) d.productsOnlyInState.push(id);
  for (const [id, pa] of a.P) { const pb = b.P.get(id); if (!pb) continue;
    for (const k of ['collection', 'collectionName', 'type', 'typeLabel', 'group', 'boosters', 'variant', 'copagConfirmed', 'msrp', 'copagReference', 'offerCount', 'liveCount'])
      if (!eq(pa[k] ?? (k === 'copagConfirmed' ? false : null), pb[k] ?? (k === 'copagConfirmed' ? false : null))) d.productFieldDiffs.push({ id, field: k, db: pa[k] ?? null, state: pb[k] ?? null }); }
  for (const id of new Set([...Object.keys(a.best), ...Object.keys(b.best)])) {
    const x = a.best[id]; const y = b.best[id];
    if (!x || !y || !eq(x.total, y.total)) d.bestPriceDiffs.push({ id, db: x ? { offer: x.id, total: x.total } : null, state: y ? { offer: y.id, total: y.total } : null });
  }
  if (a.poolList.join() !== b.poolList.join()) d.poolDiffs.push({ db: a.poolList, state: b.poolList });
  for (const k of new Set([...Object.keys(a.wall), ...Object.keys(b.wall)])) if (!a.wall[k] || !b.wall[k] || a.wall[k].products !== b.wall[k].products || !eq(a.wall[k].min, b.wall[k].min)) d.wallDiffs.push({ collection: k, db: a.wall[k] || null, state: b.wall[k] || null });
  for (const k of ['liveOffers', 'stores', 'pre', 'tips']) if (a.counts[k] !== b.counts[k]) d.countDiffs.push({ count: k, db: a.counts[k], state: b.counts[k] });
  const OA = new Map(hDb.offers.map((o) => [o.id, o])); const OB = new Map(hSt.offers.map((o) => [o.id, o]));
  for (const id of OA.keys()) if (!OB.has(id)) d.offersOnlyInDb.push(id);
  for (const id of OB.keys()) if (!OA.has(id)) d.offersOnlyInState.push(id);
  for (const [id, x] of OA) { const y = OB.get(id); if (!y) continue;
    for (const k of ['productId', 'storeId', 'storeName', 'seller', 'url', 'image', 'price', 'priceKind', 'shipping', 'shippingKnown', 'total', 'perBooster', 'stock', 'quantity', 'stale', 'confirmed', 'anomalous', 'discount', 'savings', 'dealScore'])
      if (!eq(x[k] ?? (['stale', 'anomalous', 'shippingKnown'].includes(k) ? false : k === 'confirmed' ? true : null), y[k] ?? (['stale', 'anomalous', 'shippingKnown'].includes(k) ? false : k === 'confirmed' ? true : null))) d.offerFieldDiffs.push({ id, field: k, db: x[k] ?? null, state: y[k] ?? null }); }
  const critical = d.productsOnlyInDb.length + d.productsOnlyInState.length + d.bestPriceDiffs.length + d.poolDiffs.length + d.wallDiffs.length
    + d.productFieldDiffs.filter((x) => ['msrp', 'copagConfirmed', 'copagReference'].includes(x.field)).length;
  return { critical, summary: Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.length])), details: Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.slice(0, 20)])),
    sizes: { db: Buffer.byteLength(JSON.stringify(hDb)), state: Buffer.byteLength(JSON.stringify(hSt)) } };
}

/** Endpoints por produto: banco × state.json (preço atual, estoque, referência, ofertas). */
export async function compareEndpoints(st, DB, ST) {
  const out = { products: 0, currentPrice: { equal: 0, diffs: [] }, inStock: { equal: 0, diffs: [] }, reference: { equal: 0, diffs: [] }, offers: { equal: 0, diffs: [] } };
  for (const p of st.products || []) {
    const a = await DB.getProduct(p.id); if (!a) continue; out.products++;
    const b = ST.stateGetProduct(st, p.id);
    const ap = a.stats?.market?.current_price ?? null; const bp = b.stats.market.current_price;
    if (eq(ap, bp)) out.currentPrice.equal++; else out.currentPrice.diffs.push({ id: p.id, db: ap, state: bp });
    const ai = a.stats?.coverage?.in_stock_offers ?? 0; const bi = b.stats.coverage.in_stock_offers;
    if (ai === bi) out.inStock.equal++; else out.inStock.diffs.push({ id: p.id, db: ai, state: bi });
    const ar = a.references.find((r) => r.status === 'verified') || a.references[0] || null; const br = b.references[0] || null;
    if (eq(ar?.value ?? null, br?.value ?? null) && (ar?.status ?? null) === (br?.status ?? null)) out.reference.equal++; else out.reference.diffs.push({ id: p.id, db: ar && { value: ar.value, status: ar.status }, state: br && { value: br.value, status: br.status } });
    const ao = await DB.productOffers(p.id, { page: 1, limit: 500 }); const bo = ST.stateProductOffers(st, p.id, { page: 1, limit: 500 });
    const ka = new Map(ao.items.map((o) => [o.id, o])); let same = ao.total === bo.total;
    const bad = [];
    for (const o of bo.items) { const x = ka.get(o.id); if (!x) { bad.push({ offer: o.id, issue: 'só no state.json' }); continue; }
      for (const k of ['price', 'total_price', 'stock', 'status']) if (!eq(x[k], o[k])) bad.push({ offer: o.id, field: k, db: x[k], state: o[k] }); }
    if (same && !bad.length) out.offers.equal++; else out.offers.diffs.push({ id: p.id, db: ao.total, state: bo.total, issues: bad.slice(0, 5) });
  }
  for (const k of ['currentPrice', 'inStock', 'reference', 'offers']) { out[k].diffCount = out[k].diffs.length; out[k].diffs = out[k].diffs.slice(0, 25); }
  return out;
}


/** FASE 4 — páginas: lista (matriz de filtros), produto (todas as ofertas), coleção e tipo; banco × state.json. */
export function comparePages(dbSt, st, SITE) {
  const out = { lists: { combos: 0, equal: 0, diffs: [] }, products: { total: 0, equal: 0, diffs: [] }, groups: { total: 0, equal: 0, diffs: [] } };
  const groups = ['', ...SITE.GROUP_ORDER];
  for (const mode of ['guardar', 'abrir']) for (const group of groups) for (const stock of [true, false]) for (const sort of ['', 'price', 'disc', 'new']) for (const semref of [false, true]) {
    if (semref && mode === 'abrir') continue;
    const F = { mode, group, stock, sort, semref }; out.lists.combos++;
    const a = SITE.siteProducts(dbSt, F, { page: 1, limit: 1000 }); const b = SITE.siteProducts(st, F, { page: 1, limit: 1000 });
    const k = (r) => r.items.map((e) => `${e.p.id}:${e.o.id}:${e.o.total}:${e.o.dealScore ?? ''}`);
    const ka = k(a), kb = k(b);
    if (ka.join() === kb.join() && JSON.stringify(a.facets) === JSON.stringify(b.facets)) out.lists.equal++;
    else out.lists.diffs.push({ F, db: a.total, state: b.total, first: ka.map((x, i) => (x !== kb[i] ? { i, db: x, state: kb[i] } : null)).filter(Boolean).slice(0, 3) });
  }
  const pk = (o) => `${o.id}:${o.price}:${o.total}:${o.stock}:${o.shipping ?? ''}:${o.seller ?? ''}:${o.dealScore ?? ''}`;
  for (const p of st.products || []) {
    const a = SITE.siteProduct(dbSt, p.id); const b = SITE.siteProduct(st, p.id); if (!a && !b) continue; out.products.total++;
    const ka = (a?.offers || []).map(pk).sort(), kb = (b?.offers || []).map(pk).sort();
    if (ka.join() === kb.join() && a?.liveCount === b?.liveCount) out.products.equal++; else out.products.diffs.push({ id: p.id, db: ka.filter((x) => !kb.includes(x)).slice(0, 3), state: kb.filter((x) => !ka.includes(x)).slice(0, 3) });
  }
  for (const [kind, ids] of [['col', (st.collections || []).map((c) => c.id)], ['type', (st.types || []).map((t) => t.id)]]) for (const id of ids) {
    out.groups.total++;
    const args = kind === 'col' ? { col: id } : { type: id };
    const a = SITE.siteOffers(dbSt, args), b = SITE.siteOffers(st, args);
    const ka = a.offers.map((o) => o.id).sort().join(), kb = b.offers.map((o) => o.id).sort().join();
    if (ka === kb && JSON.stringify(a.liveCount) === JSON.stringify(b.liveCount)) out.groups.equal++; else out.groups.diffs.push({ [kind]: id });
  }
  for (const k of ['lists', 'products', 'groups']) { out[k].diffCount = out[k].diffs.length; out[k].diffs = out[k].diffs.slice(0, 10); }
  return out;
}
// ---------------------------------------------------------------- CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2] || 'data'; const outFile = process.argv[3] || null;
  if (!process.env.DATABASE_URL && !process.env.API_DATABASE_URL) { console.log('Sem banco: nada a comparar.'); process.exit(0); }
  process.env.API_DATABASE_URL ||= process.env.DATABASE_URL;
  const st = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
  const DB = await import('../api/_lib/read-db.mjs'); const ST = await import('../api/_lib/read-state.mjs'); const { closeApiPool } = await import('../api/_lib/db.mjs');
  const now = Date.parse(st.generatedAt) || Date.now();
  const t0 = Date.now();
  const dbSt = await DB.stateLikeFromDb(st); const hDb = slimHome(dbSt, { source: 'db', now }); const tDb = Date.now() - t0;
  const hSt = slimHome(st, { source: 'state', now });
  const home = compareHome(hDb, hSt);
  const endpoints = await compareEndpoints(st, DB, ST);
  const SITE = await import('../api/_lib/site.mjs');
  const pages = comparePages(dbSt, st, SITE);
  // desempenho das consultas (ms; 1ª chamada e média de 5), no mesmo banco
  const perf = {};
  const id = (st.products || []).find((p) => p.offerCount > 5)?.id || st.products?.[0]?.id;
  for (const [k, fn] of Object.entries({ home: () => DB.stateLikeFromDb(st), produtos: () => DB.listProducts({ page: 1, limit: 24 }), produtos_filtro: () => DB.listProducts({ page: 2, limit: 24, estoque: true, ordem: 'desconto' }),
    produto: () => DB.getProduct(id), ofertas: () => DB.productOffers(id, { page: 1, limit: 24 }), historico: () => DB.productHistory(id, { dias: 30 }), estatisticas: () => DB.productStats(id), referencias: () => DB.listReferences({ page: 1, limit: 24 }), site_produtos: () => SITE.siteProducts(dbSt, {}, { page: 1, limit: 48 }), site_produto: () => SITE.siteProduct(dbSt, id), site_colecao: () => SITE.siteOffers(dbSt, { col: (st.collections || [])[0]?.id }) })) {
    const t = []; for (let i = 0; i < 6; i++) { const a = performance.now(); await fn(); t.push(performance.now() - a); }
    perf[k] = { first: Math.round(t[0]), avg: Math.round(t.slice(1).reduce((x, y) => x + y, 0) / 5) };
  }
  const sizes = { home: Buffer.byteLength(JSON.stringify(hDb)), produtos24: Buffer.byteLength(JSON.stringify(await DB.listProducts({ page: 1, limit: 24 }))), produto: Buffer.byteLength(JSON.stringify(await DB.getProduct(id))),
    ofertas24: Buffer.byteLength(JSON.stringify(await DB.productOffers(id, { page: 1, limit: 24 }))), historico30: Buffer.byteLength(JSON.stringify(await DB.productHistory(id, { dias: 30 }))),
    referencias24: Buffer.byteLength(JSON.stringify(await DB.listReferences({ page: 1, limit: 24 }))), stateJson: Buffer.byteLength(JSON.stringify(st)) };
  await closeApiPool();
  const rep = { at: new Date().toISOString(), stateGeneratedAt: st.generatedAt, buildHomeFromDbMs: tDb, perf, sizes, home, endpoints, pages };
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(rep, null, 2));
  console.log('Desempenho (ms):', JSON.stringify(perf)); console.log('Tamanhos (bytes):', JSON.stringify(sizes));
  console.log('Home:', JSON.stringify(home.summary), 'tamanho', JSON.stringify(home.sizes), 'críticas', home.critical);
  console.log('Endpoints:', JSON.stringify({ produtos: endpoints.products, precoAtual: [endpoints.currentPrice.equal, endpoints.currentPrice.diffCount], estoque: [endpoints.inStock.equal, endpoints.inStock.diffCount],
    referencia: [endpoints.reference.equal, endpoints.reference.diffCount], ofertas: [endpoints.offers.equal, endpoints.offers.diffCount] }));
  console.log('Páginas:', JSON.stringify({ listas: [pages.lists.equal, pages.lists.combos], produtos: [pages.products.equal, pages.products.total], colecoesTipos: [pages.groups.equal, pages.groups.total] }));
  process.exitCode = home.critical || endpoints.reference.diffCount ? 1 : 0;
}
