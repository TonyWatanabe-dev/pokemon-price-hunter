// Orquestrador: coleta -> matching -> histórico -> score -> estado -> alertas.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { readJson, writeJson, appendJsonl, dataPath, configPath } from './db.js';
import { adapters, detectPlatform } from './adapters/index.js';
import { shipping as vtexShipping } from './adapters/vtex.js';
import { productUrls as jsonldUrls } from './adapters/jsonld.js';

const BIG_MARKETPLACES = /(^|\.)(amazon|mercadolivre|mercadolibre|shopee|magazineluiza|magalu|aliexpress|americanas|casasbahia|pontofrio|extra|submarino|shoptime)\.com(\.br)?$/i;
async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]); })); }
import { matchProduct } from './match.js';
import { copagStatus, pickPrice, PRICE_LABEL, storeScore, dealScore, classify, isAnomalous, opportunityBadge } from './score.js';
import { evaluate, dedupe, dispatch, transports } from './alerts.js';

const TYPE_LABEL = { booster_box: 'Booster Box', etb: 'Treinador Avançado (ETB)', premium_collection: 'Coleção Premium', collection_box: 'Box Coleção', blister: 'Blister', blister_3: 'Blister Triplo', blister_4: 'Blister Quádruplo', deck: 'Deck', booster_pack: 'Booster unitário' };
const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
const round2 = (v) => v == null ? null : Math.round(v * 100) / 100;

export function loadCatalog() {
  const cat = readJson(configPath('catalog.json'));
  const cols = Object.fromEntries(cat.collections.map((c) => [c.id, c]));
  cat.products = cat.products.map((p) => ({ language: 'PT', manufacturer: 'Copag', ean: null, sku: null, release_date: null, status: 'ATIVO', ...p, copag: { ...cat.defaults.copag, ...(p.copag || {}) }, collectionName: cols[p.collection]?.name || p.collection, typeLabel: TYPE_LABEL[p.type] || p.type }));
  return cat;
}

export async function runOnce({ log = console.log, send = transports, now = new Date() } = {}) {
  const T = now.toISOString();
  const catalog = loadCatalog();
  const { stores } = readJson(configPath('stores.json'));
  // Lojas extras: um endereço por linha em config/lojas.txt (linhas com # são ignoradas)
  try {
    const known = new Set(stores.filter((s) => s.url).map((s) => new URL(s.url).host.replace(/^www\./, '')));
    const dir = configPath('lojas');
    const texts = [];
    try { texts.push(fs.readFileSync(configPath('lojas.txt'), 'utf8')); } catch { /* opcional */ }
    try { for (const f of fs.readdirSync(dir)) if (f.endsWith('.txt')) texts.push(fs.readFileSync(dir + '/' + f, 'utf8')); } catch { /* opcional */ }
    for (const line of texts.join('\n').split(/\r?\n/)) {
      const raw = line.replace(/#.*/, '').trim(); if (!raw) continue;
      let u; try { u = new URL(/^https?:\/\//.test(raw) ? raw : 'https://' + raw); } catch { continue; }
      const host = u.host.replace(/^www\./, ''); if (known.has(host)) continue; known.add(host);
      stores.push({ id: host.replace(/[^a-z0-9]/gi, '').toLowerCase(), name: host, url: u.origin, platform: 'auto', kind: 'specialist', evidence: {}, fromList: true });
    }
  } catch { /* sem lojas.txt */ }
  const watch = readJson(configPath('watchlist.json'), { settings: {}, rules: [] });
  const prev = readJson(dataPath('offers.json'), {});
  const sources = readJson(dataPath('sources.json'), {});
  const lowest = readJson(dataPath('lowest.json'), {});
  const sent = readJson(dataPath('alerts-sent.json'), {});
  const copagSeen = readJson(dataPath('copag-msrp.json'), {}); // preço capturado na loja oficial Copag
  const cep = process.env.HUNTER_CEP || watch.settings?.cep;

  const offers = {}; const unmatched = []; const touched = new Set(); const skipped = new Set();
  // Volume: lojas em paralelo (o intervalo de 1,5 s continua valendo por domínio), prazo por rodada
  // e rodízio — quem ficou para trás numa rodada vai primeiro na seguinte.
  const deadline = Date.now() + Number(process.env.HUNTER_BUDGET_MIN || 7) * 60e3;
  const urlCache = readJson(dataPath('url-cache.json'), {});
  const order = [...stores].sort((a, b) => (sources[a.id]?.lastCheck || '').localeCompare(sources[b.id]?.lastCheck || ''));
  await pool(order, Number(process.env.HUNTER_CONCURRENCY || 8), async (store) => {
    const src = (sources[store.id] ||= { checks: 0, ok: 0 });
    src.name = store.name; src.kind = store.kind; src.url = store.url;
    if (store.platform === 'unsupported') { Object.assign(src, { status: 'UNAVAILABLE', reason: store.note }); return; }
    if (!store.url) { Object.assign(src, { status: 'PENDING', reason: 'domínio ainda não confirmado' }); return; }
    if (store.enabled === false) { Object.assign(src, { status: 'PAUSED', reason: 'pausada manualmente' }); return; }
    if (BIG_MARKETPLACES.test(new URL(store.url).host) && store.platform !== 'mercadolivre') { Object.assign(src, { status: 'UNAVAILABLE', reason: 'Marketplace grande: bloqueia robôs e não tem API pública de busca' }); return; }
    if (Date.now() > deadline) { skipped.add(store.id); return; }
    src.checks++; src.lastCheck = T;
    try {
      const base = store.url.replace(/\/$/, '');
      const platform = store.platform !== 'auto' ? store.platform : (src.platform || await detectPlatform(base));
      if (!platform) throw Object.assign(new Error('plataforma não reconhecida (sem Shopify, VTEX ou JSON-LD)'), { status: 'platform' });
      src.platform = platform;
      // JSON-LD: varre o sitemap no máximo 1x/dia; nas rodadas lê as páginas relevantes + algumas novas.
      let cache = null;
      if (platform === 'jsonld') {
        cache = urlCache[store.id] ||= { at: null, candidates: [], visited: [], relevant: [] };
        if (!cache.at || Date.now() - Date.parse(cache.at) > 864e5) {
          cache.candidates = await jsonldUrls(base, 3000); cache.at = T; cache.visited = cache.visited.filter((u) => cache.candidates.includes(u));
        }
        const fresh = cache.candidates.filter((u) => !cache.visited.includes(u)).slice(0, 25);
        cache.visited.push(...fresh);
        store = { ...store, plannedUrls: [...new Set([...cache.relevant, ...fresh, ...(store.productUrls || [])])] };
      }
      const listings = await adapters[platform].search(store, catalog);
      if (cache) cache.relevant = [...new Set(listings.filter((l) => /pok[eé]mon/i.test(l.title) || matchProduct(l, catalog).productId).map((l) => l.url))];
      let matched = 0;
      for (const l of listings) {
        const m = matchProduct(l, catalog);
        if (!m.productId) { if (/pok[eé]mon/i.test(l.title)) unmatched.push({ store: store.id, title: l.title, url: l.url, why: m.why }); continue; }
        matched++;
        const product = catalog.products.find((p) => p.id === m.productId);
        let stock = l.stock || 'UNKNOWN';
        if (m.parsed.preorder && stock !== 'OUT_OF_STOCK') stock = 'PRE_ORDER';
        let ship = l.shipping ?? null;
        if (ship == null && cep && l._vtex && stock === 'IN_STOCK') { try { ship = await vtexShipping(l, cep); } catch { ship = null; } }
        const pp = pickPrice(l.price);
        // Loja oficial Copag = fonte nº 1 do preço sugerido (regra 4). Preço "de" vence o promocional.
        if (store.copagSource && l.price?.base > 0) {
          const msrp = l.listPrice > l.price.base ? l.listPrice : l.price.base;
          const old = copagSeen[m.productId];
          if (!old || old.msrp !== msrp) copagSeen[m.productId] = { msrp, source_url: l.url, source_timestamp: T, confidence: 'OFICIAL', previous_msrp: old?.msrp ?? null, msrp_updated_at: T };
          else old.source_timestamp = T;
        }
        const total = pp.value != null ? round2(pp.value + (ship || 0)) : null;
        const id = hash(store.id + '|' + l.url + '|' + (l.sellerId || ''));
        offers[id] = {
          id, productId: m.productId, matchConfidence: m.confidence, storeId: store.id, storeName: store.name, storeKind: store.kind,
          seller: l.seller || null, sellerKind: l.sellerKind || (store.kind === 'marketplace' ? 'marketplace_seller' : 'store'),
          title: l.title, url: l.url, sku: l.sku || null, ean: l.ean || null,
          prices: l.price, listPrice: l.listPrice || null, price: pp.value, priceKind: pp.kind, priceKindLabel: PRICE_LABEL[pp.kind] || '—',
          shipping: ship, shippingKnown: ship != null, total, perBooster: product.boosters && total ? round2(total / product.boosters) : null,
          stock, quantity: l.quantity ?? null, sourceType: l.sourceType, source_url: l.url, source_timestamp: T,
          firstSeen: prev[id]?.firstSeen || T, stale: false,
        };
      }
      Object.assign(src, { status: 'ACTIVE', reason: null, ok: src.ok + 1, listings: listings.length, matched, lastSuccess: T });
      touched.add(store.id);
    } catch (e) {
      Object.assign(src, { status: e.blocked ? 'BLOCKED' : 'ERROR', reason: e.message });
      log(`[${store.id}] ${src.status}: ${e.message}`);
    }
  });
  if (skipped.size) log(`${skipped.size} lojas ficaram para a próxima rodada (prazo da rodada).`);
  // Fontes que falharam: mantém a última leitura, mas como estoque desconhecido (nunca inventa disponibilidade).
  for (const [id, o] of Object.entries(prev)) {
    if (offers[id] || touched.has(o.storeId) || !stores.some((s) => s.id === o.storeId)) continue;
    const recent = skipped.has(o.storeId) && !o.stale && now.getTime() - Date.parse(o.source_timestamp) < 3 * 3600e3;
    offers[id] = recent ? { ...o } : { ...o, stale: true, stock: 'UNKNOWN' };
  }

  // Histórico e eventos
  const events = []; const history = [];
  for (const o of Object.values(offers)) {
    if (o.stale) continue;
    const p = prev[o.id];
    const changed = !p || p.total !== o.total || p.stock !== o.stock || p.shipping !== o.shipping || p.seller !== o.seller;
    if (p && p.stock !== 'IN_STOCK' && o.stock === 'IN_STOCK') events.push({ offerId: o.id, event: 'restock' });
    if (p && p.total && o.total && o.total < p.total && o.stock === 'IN_STOCK') events.push({ offerId: o.id, event: 'drop', from: p.total });
    if (changed) history.push({ t: T, offerId: o.id, productId: o.productId, storeId: o.storeId, seller: o.seller, price: o.price, priceKind: o.priceKind, shipping: o.shipping, total: o.total, stock: o.stock, quantity: o.quantity });
  }
  for (const o of Object.values(prev)) if (!offers[o.id] && touched.has(o.storeId)) history.push({ t: T, offerId: o.id, productId: o.productId, storeId: o.storeId, stock: 'UNAVAILABLE', event: 'removed' });

  // Agregados por produto. Preço Copag cadastrado à mão vence; senão vale o capturado na loja oficial.
  const products = {};
  for (const p of catalog.products) {
    if (!copagStatus(p).confirmed && copagSeen[p.id]) p.copag = { ...p.copag, ...copagSeen[p.id] };
    const cs = copagStatus(p);
    const list = Object.values(offers).filter((o) => o.productId === p.id);
    const live = list.filter((o) => o.stock === 'IN_STOCK' && !o.stale && o.total > 0);
    const rawAvg = live.length ? live.reduce((a, o) => a + o.total, 0) / live.length : null;
    for (const o of list) o.anomalous = o.total > 0 && isAnomalous(o.total, cs.msrp, live.length >= 3 ? rawAvg : null);
    const clean = live.filter((o) => !o.anomalous);
    const marketAverage = clean.length >= 2 ? round2(clean.reduce((a, o) => a + o.total, 0) / clean.length) : null;
    for (const o of clean) if (!lowest[p.id] || o.total < lowest[p.id].total) lowest[p.id] = { total: o.total, at: T, storeId: o.storeId, offerId: o.id };
    products[p.id] = { ...p, copagConfirmed: cs.confirmed, msrp: cs.confirmed ? cs.msrp : null, copagReason: cs.confirmed ? null : cs.reason, marketAverage, lowestHistorical: lowest[p.id] || null, offerCount: list.length, inStockCount: clean.length };
  }
  const bestPPB = {};
  for (const o of Object.values(offers)) if (o.perBooster && o.stock === 'IN_STOCK' && !o.anomalous && !o.stale) { const c = products[o.productId].collection; if (!bestPPB[c] || o.perBooster < bestPPB[c]) bestPPB[c] = o.perBooster; }

  const storeScores = Object.fromEntries(stores.map((s) => [s.id, storeScore(s, sources[s.id])]));
  for (const o of Object.values(offers)) {
    const p = products[o.productId]; const st = storeScores[o.storeId];
    o.storeScore = st.score; o.storeValidated = st.validated;
    if (p.msrp && o.total) { o.discount = +(1 - o.total / p.msrp).toFixed(4); o.savings = round2(p.msrp - o.total); } else { o.discount = null; o.savings = null; }
    o.vsMarket = p.marketAverage && o.total ? +(1 - o.total / p.marketAverage).toFixed(4) : null;
    const ds = o.anomalous || o.stale ? { score: null, parts: null } : dealScore(o, { msrp: p.msrp, lowestHistorical: p.lowestHistorical?.total, bestPerBoosterInCollection: bestPPB[p.collection], store: st });
    o.dealScore = ds.score; o.scoreParts = ds.parts; o.classification = classify(ds.score);
    o.opportunity = opportunityBadge(o, { msrp: p.msrp, store: st });
    o.confidence_score = Math.round(100 * o.matchConfidence * (o.stale ? 0.5 : 1) * (o.stock === 'IN_STOCK' ? 1 : 0.8));
  }

  // Alertas
  const hits = dedupe(evaluate(watch.rules || [], Object.values(offers), events, products), sent, watch.settings, now.getTime(), offers);
  const delivered = await dispatch(hits, sent, { send, now });
  for (const d of delivered) log(`ALERTA ${d.kind} -> ${d.channels.join(', ') || 'só painel'}: ${d.productId} ${d.total}`);

  // Estado para painel e API
  const all = Object.values(offers);
  const ranked = all.filter((o) => o.stock === 'IN_STOCK' && !o.stale && !o.anomalous && o.dealScore != null).sort((a, b) => b.dealScore - a.dealScore);
  const cov = Object.values(sources).reduce((a, s) => { a.found++; a[s.status] = (a[s.status] || 0) + 1; return a; }, { found: 0 });
  const state = {
    generatedAt: T,
    coverage: { found: cov.found, active: cov.ACTIVE || 0, blocked: cov.BLOCKED || 0, error: cov.ERROR || 0, pending: cov.PENDING || 0, unavailable: cov.UNAVAILABLE || 0, paused: cov.PAUSED || 0 },
    totals: { products: catalog.products.length, offers: all.length, copagConfirmed: Object.values(products).filter((p) => p.copagConfirmed).length },
    collections: catalog.collections.map(({ id, name }) => ({ id, name })),
    products: Object.values(products),
    bestDeals: ranked.map((o) => o.id),
    offers: all,
    sources: Object.entries(sources).map(([id, s]) => ({ id, ...s, score: storeScores[id] || null })),
    unmatched: unmatched.slice(0, 200),
    rules: watch.rules || [],
    recentAlerts: [...delivered, ...readJson(dataPath('state.json'), {}).recentAlerts || []].slice(0, 50),
  };
  writeJson(dataPath('offers.json'), offers);
  writeJson(dataPath('sources.json'), sources);
  writeJson(dataPath('lowest.json'), lowest);
  writeJson(dataPath('copag-msrp.json'), copagSeen);
  writeJson(dataPath('url-cache.json'), urlCache);
  writeJson(dataPath('alerts-sent.json'), sent);
  writeJson(dataPath('state.json'), state);
  appendJsonl(dataPath('history.jsonl'), history);
  appendJsonl(dataPath('alerts.jsonl'), delivered);
  log(`Fontes ativas ${state.coverage.active}/${state.coverage.found} · ofertas ${all.length} · ranking ${ranked.length} · alertas ${delivered.length}`);
  return state;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) {
  const loop = process.argv.includes('--loop');
  const minutes = Number(process.env.HUNTER_INTERVAL_MIN || 10);
  do {
    try { await runOnce(); } catch (e) { console.error('Falha na rodada:', e); if (!loop) process.exitCode = 1; }
    if (loop) await new Promise((r) => setTimeout(r, minutes * 60e3));
  } while (loop);
}
