// Orquestrador: coleta -> matching -> histórico -> score -> estado -> alertas.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { readJson, writeJson, appendJsonl, dataPath, configPath } from './db.js';
import { adapters, detectPlatform } from './adapters/index.js';
import { shipping as vtexShipping } from './adapters/vtex.js';
import { productUrls as jsonldUrls } from './adapters/jsonld.js';

const BIG_MARKETPLACES = /(^|\.)(amazon|mercadolivre|mercadolibre|shopee|magazineluiza|magalu|aliexpress|americanas|casasbahia|pontofrio|extra|submarino|shoptime)\.com(\.br)?$/i;
async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]); })); }
import { matchProduct, msrpKeys, TYPE_LABEL, groupOf, applyOverride, overridesIndex } from './match.js';
import { copagStatus, pickPrice, PRICE_LABEL, storeScore, isAnomalous } from './score.js';
import { readOfficial, officialFor } from './opportunity-read.js';
import { readDbHealth, syncStatus } from './db-health.js';
import { buildRunRecord, readerSummary, storesSummary, watchedSummary, recordRun } from './opstate.js';
import { evaluate, dedupe, dispatch, transports, tipHits, dispatchTips } from './alerts.js';
import { collectTips, firstPrice } from './tips.js';
import { backfill, recordDay, trimJsonl, histSummary } from './history.js';
import { recordActivity } from './activity.js';
import { linkAgrees } from './gate.js';
import { loadDistrust, trustedPoint } from './distrust.js';
import { processInbox } from './inbox.js';
import { comparable, pendingRef } from './offer-compare.js';

const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
const round2 = (v) => v == null ? null : Math.round(v * 100) / 100;
const envNum = (k, d) => { const v = Number(process.env[k]); return Number.isFinite(v) && v >= 0 ? v : d; };
// Frete simulado (VTEX) que falhou: reaproveita o último simulado desta oferta por até N horas, com a data dele.
const SHIPPING_TTL_MS = envNum('HUNTER_SHIPPING_TTL_H', 24) * 3600e3;

// JSON-LD: quantas páginas novas por rodada, quantas tentativas de uma página nova que falha antes de dar como lida,
// e depois de quantas horas uma página lida e não relevante (não é produto, não casou) é lida de novo.
const JSONLD_FRESH = 25;
export function jsonldPlan(cache, nowMs) {
  const recheckMs = envNum('HUNTER_JSONLD_RECHECK_H', 24) * 3600e3; const recheckMax = envNum('HUNTER_JSONLD_RECHECK_MAX', 10);
  const visited = new Set(cache.visited); const relevant = new Set(cache.relevant);
  const fresh = cache.candidates.filter((u) => !visited.has(u)).slice(0, JSONLD_FRESH);
  const age = (u) => Date.parse(cache.checked?.[u] || '') || 0; // sem data (cache antigo): mais velha de todas
  const recheck = cache.visited.filter((u) => !relevant.has(u) && nowMs - age(u) >= recheckMs).sort((a, b) => age(a) - age(b)).slice(0, recheckMax);
  return { fresh, recheck, prevRelevant: [...cache.relevant] };
}
/** Depois da leitura da loja: página só vira "visitada" se foi lida; relevante que falhou continua relevante. Devolve as URLs com falha. */
export function jsonldSettle(cache, plan, pageErrors = [], T) {
  const retryMax = envNum('HUNTER_JSONLD_RETRY_MAX', 3);
  const errs = new Set(pageErrors.map((e) => e.url));
  cache.relevant = [...new Set([...cache.relevant, ...plan.prevRelevant.filter((u) => errs.has(u))])];
  const relevant = new Set(cache.relevant); const visited = new Set(cache.visited);
  for (const u of plan.fresh) {
    if (errs.has(u)) {
      const n = (cache.retry[u] || 0) + 1;
      if (n < retryMax) { cache.retry[u] = n; continue; } // continua nova: tenta de novo na próxima rodada
      delete cache.retry[u]; cache.checked[u] = T;       // falhou retryMax vezes: só volta depois do intervalo de releitura
    } else delete cache.retry[u];
    if (!visited.has(u)) { cache.visited.push(u); visited.add(u); }
  }
  for (const u of new Set([...plan.fresh, ...plan.recheck, ...plan.prevRelevant])) {
    if (relevant.has(u)) delete cache.checked[u];
    else if (visited.has(u)) cache.checked[u] = T;
  }
  return errs;
}
/** Último estado lido de verdade: a própria oferta, ou (se desatualizada) o último estoque conhecido antes da falha. */
export const lastValid = (o) => (!o ? null : !o.stale ? o : o.lastKnownStock ? { ...o, stock: o.lastKnownStock } : null);

export function loadCatalog() {
  const cat = readJson(configPath('catalog.json'));
  cat.products ||= []; cat.copag ||= {};
  return cat;
}

// Preço Copag de um produto: cadastro OFICIAL > loja oficial Copag > catálogo Copag divulgado por terceiros (só referência).
function resolveCopag(p, catalog, copagSeen) {
  const keys = msrpKeys(p);
  const pick = (map, ok) => { for (const k of keys) if (map[k] && ok(map[k])) return { ...map[k], key: k }; return null; };
  const valid = (c) => copagStatus({ copag: c }).confirmed;
  return pick(catalog.copag, (c) => c.confidence === 'OFICIAL' && valid(c)) || pick(copagSeen, valid) || pick(catalog.copag, valid) || pick(catalog.copag, () => true)
    || { msrp: null, source_url: null, confidence: null };
}

// Oferta que pode ter nota oficial e entrar no bestDeals: em estoque, atual, plausível, confirmada e com preço.
export const liveForScore = (o) => o.stock === 'IN_STOCK' && !o.stale && !o.anomalous && o.confirmed !== false && o.total > 0;
// bestDeals: oferta ao vivo com nota oficial válida ou com desconto Copag. Ordem: nota oficial (sem nota por último),
// depois desconto, total e id — o mesmo critério do site quando falta a nota (6C.2).
export function rankBestDeals(all, opp = new Map()) {
  return all.filter((o) => liveForScore(o) && (opp.has(o.id) || o.discount != null))
    .sort((a, b) => (opp.get(b.id)?.score ?? -1) - (opp.get(a.id)?.score ?? -1) || (b.discount ?? -9) - (a.discount ?? -9) || a.total - b.total || String(a.id).localeCompare(String(b.id)));
}

export async function runOnce({ log = console.log, send = transports, now = new Date() } = {}) {
  const T = now.toISOString();
  const startedAt = new Date().toISOString();
  // generatedAt da rodada anterior (antes de sobrescrever o state.json): base para conferir se ela chegou ao banco
  const prevGeneratedAt = readJson(dataPath('state.json'), {}).generatedAt || null;
  const catalog = loadCatalog();
  const overrides = overridesIndex(readJson(configPath('matching-overrides.json'), {})); // revisão humana; vazio se enabled !== true
  const registry = readJson(dataPath('products.json'), {}); // catálogo automático: todo produto já visto
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
  // Alertas criados pelo site: um arquivo .json por alerta em config/alertas/
  try {
    for (const f of fs.readdirSync(configPath('alertas'))) {
      if (!f.endsWith('.json')) continue;
      const r = readJson(configPath('alertas/' + f), null);
      if (r && typeof r === 'object' && r.filter) (watch.rules ||= []).push({ ...r, id: r.id || f.replace(/\.json$/, ''), file: 'config/alertas/' + f });
    }
  } catch { /* sem pasta de alertas */ }
  const prev = readJson(dataPath('offers.json'), {});
  const sources = readJson(dataPath('sources.json'), {});
  const lowest = readJson(dataPath('lowest.json'), {});
  const distrust = loadDistrust({ sources, prev, T });
  // Menor preço vindo de leitura antiga não confiável é descartado (o cache é refeito com as leituras novas).
  for (const [pid, l] of Object.entries(lowest)) if (l && typeof l === 'object' && !trustedPoint(distrust, l.storeId, l.at)) delete lowest[pid];
  // Na rodada da correção, essas lojas não geram eventos (o "antes" delas não era confiável).
  const quiet = new Set(distrust.fresh ? distrust.stores : []);
  // Uma vez: refaz o "menor já visto" a partir do histórico filtrado (o antigo podia ter preço de anúncio trocado).
  let rebuiltLowest = false;
  if (!lowest.__fromHist && fs.existsSync(dataPath('hist'))) {
    rebuiltLowest = true;
    for (const k of Object.keys(lowest)) delete lowest[k];
    for (const f of fs.readdirSync(dataPath('hist'))) {
      const h = readJson(dataPath('hist/' + f), null); if (!h?.productId) continue;
      for (const [sid, x] of Object.entries(h.stores || {})) for (const [d, v] of x.pts) if (trustedPoint(distrust, sid, d) && (!lowest[h.productId] || v < lowest[h.productId].total)) lowest[h.productId] = { total: v, at: d + 'T12:00:00.000Z', storeId: sid, offerId: null };
    }
    lowest.__fromHist = true;
  }
  const sent = readJson(dataPath('alerts-sent.json'), {});
  const copagSeen = readJson(dataPath('copag-msrp.json'), {}); // preço capturado na loja oficial Copag
  const cep = process.env.HUNTER_CEP || watch.settings?.cep;

  const offers = {}; const unmatched = []; const touched = new Set(); const skipped = new Set();
  const pageFailures = new Map(); // loja -> URLs de página com falha transitória nesta rodada (oferta fica stale, não "removed")
  const shipFails = new Map();    // loja -> { n, reason } das simulações de frete sem resultado nesta rodada
  // Volume: lojas em paralelo (o intervalo de 1,5 s continua valendo por domínio: mais lojas ao mesmo tempo, nunca mais pressa numa loja), prazo por rodada
  // e rodízio — quem ficou para trás numa rodada vai primeiro na seguinte.
  const deadline = Date.now() + Number(process.env.HUNTER_BUDGET_MIN || 7) * 60e3;
  const urlCache = readJson(dataPath('url-cache.json'), {});
  const order = [...stores].sort((a, b) => (sources[a.id]?.lastCheck || '').localeCompare(sources[b.id]?.lastCheck || ''));
  await pool(order, Number(process.env.HUNTER_CONCURRENCY || 16), async (store) => {
    const src = (sources[store.id] ||= { checks: 0, ok: 0 });
    src.name = store.name; src.kind = store.kind; src.url = store.url;
    if (store.platform === 'unsupported') { Object.assign(src, { status: 'UNAVAILABLE', reason: store.note }); return; }
    if (!store.url) { Object.assign(src, { status: 'PENDING', reason: 'domínio ainda não confirmado' }); return; }
    if (store.enabled === false) { Object.assign(src, { status: 'PAUSED', reason: 'pausada manualmente' }); return; }
    if (BIG_MARKETPLACES.test(new URL(store.url).host) && store.platform !== 'mercadolivre') { Object.assign(src, { status: 'UNAVAILABLE', reason: 'Marketplace grande: bloqueia robôs e não tem API pública de busca' }); return; }
    if (Date.now() > deadline) { skipped.add(store.id); return; }
    // Loja que bloqueou ou falhou: espera cada vez mais antes de tentar de novo (15 min, 30, 1 h… até 6 h).
    if (['BLOCKED', 'ERROR'].includes(src.status) && src.fails > 0 && src.lastCheck) {
      const waitMin = Math.min(360, 15 * 2 ** (src.fails - 1));
      if (Date.now() - Date.parse(src.lastCheck) < waitMin * 60e3) return;
    }
    src.checks++; src.lastCheck = T;
    try {
      const base = store.url.replace(/\/$/, '');
      const platform = store.platform !== 'auto' ? store.platform : (src.platform || await detectPlatform(base));
      if (!platform) throw Object.assign(new Error('plataforma não reconhecida (sem Shopify, VTEX ou JSON-LD)'), { status: 'platform' });
      src.platform = platform;
      // JSON-LD: varre o sitemap no máximo 1x/dia; nas rodadas lê as páginas relevantes + algumas novas + algumas
      // já visitadas e não relevantes, de novo depois de JSONLD_RECHECK_H. Página só conta como visitada depois de lida.
      let cache = null; let plan = null;
      if (platform === 'jsonld') {
        cache = urlCache[store.id] ||= { at: null, candidates: [], visited: [], relevant: [] };
        cache.checked ||= {}; cache.retry ||= {};
        if (!cache.at || Date.now() - Date.parse(cache.at) > 864e5) {
          cache.candidates = await jsonldUrls(base, 3000); cache.at = T; cache.visited = cache.visited.filter((u) => cache.candidates.includes(u));
          const keep = new Set(cache.candidates);
          for (const m of [cache.checked, cache.retry]) for (const u of Object.keys(m)) if (!keep.has(u)) delete m[u];
        }
        plan = jsonldPlan(cache, now.getTime());
        store = { ...store, plannedUrls: [...new Set([...cache.relevant, ...plan.fresh, ...plan.recheck, ...(store.productUrls || [])])], pageErrors: [] };
      }
      const listings = await adapters[platform].search(store, catalog);
      if (cache) cache.relevant = [...new Set(listings.filter((l) => /pok[eé]mon/i.test(l.title) || matchProduct(l, catalog).productId).map((l) => l.url))];
      let matched = 0;
      for (const l of listings) {
        const m = applyOverride(l, store.id, matchProduct(l, catalog), catalog, overrides);
        if (!m.productId) { if (/pok[eé]mon/i.test(l.title)) unmatched.push({ store: store.id, title: l.title, url: l.url, why: m.why }); continue; }
        // Trava de publicação: o link precisa falar do mesmo produto que o título (coleção e formato).
        const gate = linkAgrees(l, m, catalog);
        if (!gate.ok) { unmatched.push({ store: store.id, title: l.title, url: l.url, why: [gate.why] }); continue; }
        matched++;
        const product = m.product;
        const prevImg = registry[product.id]?.image;
        registry[product.id] = { ...registry[product.id], ...product, image: (store.copagSource && l.image) || prevImg || l.image || null, firstSeen: registry[product.id]?.firstSeen || T, lastSeen: T };
        let stock = l.stock || 'UNKNOWN';
        if (m.parsed.preorder && stock !== 'OUT_OF_STOCK') stock = 'PRE_ORDER';
        const id = hash(store.id + '|' + l.url + '|' + (l.sellerId || ''));
        let ship = l.shipping ?? null; let shipAt = ship != null ? T : null; let shipSource = ship != null ? 'loja' : null; let shipError = null;
        if (ship == null && cep && l._vtex && stock === 'IN_STOCK') {
          try { ship = await vtexShipping(l, cep); if (ship == null) shipError = 'simulação sem opção de entrega para o CEP'; else { shipAt = T; shipSource = 'simulacao'; } }
          catch (e) { ship = null; shipError = 'simulação de frete falhou: ' + String(e.message || e).slice(0, 100); }
          // Simulação falhou: vale o último frete simulado desta mesma oferta, com a data dele, dentro de SHIPPING_TTL_H.
          // Sem frete anterior válido, fica desconhecido (nunca inventa frete).
          if (ship == null) {
            const old = prev[id]; const at = old?.shippingAt || old?.source_timestamp;
            if (old && old.productId === m.productId && old.shippingKnown && old.shipping != null && at && now.getTime() - Date.parse(at) <= SHIPPING_TTL_MS) {
              ship = old.shipping; shipAt = at; shipSource = 'anterior';
            }
            shipFails.set(store.id, { n: (shipFails.get(store.id)?.n || 0) + 1, reason: shipError });
          }
        }
        const pp = pickPrice(l.price);
        // Loja oficial Copag = fonte nº 1 do preço sugerido (regra 4). Preço "de" vence o promocional.
        if (store.copagSource && l.price?.base > 0) {
          const msrp = l.listPrice > l.price.base ? l.listPrice : l.price.base;
          const old = copagSeen[m.productId];
          if (!old || old.msrp !== msrp) copagSeen[m.productId] = { msrp, source_url: l.url, source_timestamp: T, confidence: 'OFICIAL', previous_msrp: old?.msrp ?? null, msrp_updated_at: T };
          else old.source_timestamp = T;
        }
        const total = pp.value != null ? round2(pp.value + (ship || 0)) : null;
        offers[id] = {
          id, productId: m.productId, matchConfidence: m.confidence, storeId: store.id, storeName: store.name, storeKind: store.kind,
          seller: l.seller || null, sellerId: l.sellerId != null ? String(l.sellerId) : null, sellerKind: l.sellerKind || (store.kind === 'marketplace' ? 'marketplace_seller' : 'store'),
          title: l.title, url: l.url, image: l.image || null, sku: l.sku || null, ean: l.ean || null,
          prices: l.price, listPrice: l.listPrice || null, price: pp.value, priceKind: pp.kind, priceKindLabel: PRICE_LABEL[pp.kind] || '-',
          shipping: ship, shippingKnown: ship != null, shippingAt: shipAt, shippingSource: shipSource, shippingError: shipError, total, perBooster: product.boosters && total ? round2(total / product.boosters) : null,
          stock, stockVerified: l.stockVerified ?? null, quantity: l.quantity ?? null, sourceType: l.sourceType, source_url: l.url, source_timestamp: T,
          firstSeen: prev[id]?.firstSeen || T, stale: false,
        };
      }
      if (cache) {
        const errs = jsonldSettle(cache, plan, store.pageErrors, T);
        if (errs.size) { pageFailures.set(store.id, errs); log(`[${store.id}] ${errs.size} página(s) com falha de leitura: oferta mantida como desatualizada`); }
        // Visível em sources.json/state: quantas páginas falharam na rodada (0 anúncios com falha ≠ loja sem produto).
        src.pageFailures = errs.size; src.pageFailReason = errs.size ? store.pageErrors[0].reason : null;
      }
      Object.assign(src, { status: 'ACTIVE', reason: null, fails: 0, ok: src.ok + 1, listings: listings.length, matched, lastSuccess: T });
      if (listings.length) src.lastListingsAt = T;
      // Frete por CEP: quantas simulações falharam nesta rodada e o último motivo (sem dado pessoal; CEP não vai junto).
      const sf = shipFails.get(store.id);
      if (sf) { src.shippingFailures = sf.n; src.shippingFailReason = sf.reason; log(`[${store.id}] frete: ${sf.n} simulação(ões) sem resultado (${sf.reason})`); }
      else if (src.shippingFailures) { src.shippingFailures = 0; src.shippingFailReason = null; }
      touched.add(store.id);
    } catch (e) {
      Object.assign(src, { status: e.blocked ? 'BLOCKED' : 'ERROR', reason: e.message, fails: (src.fails || 0) + 1 });
      log(`[${store.id}] ${src.status}: ${e.message}`);
    }
  });
  if (skipped.size) log(`${skipped.size} lojas ficaram para a próxima rodada (prazo da rodada).`);
  // Fontes que falharam (loja inteira ou só a página do anúncio): mantém a última leitura, mas como estoque desconhecido
  // (nunca inventa disponibilidade). lastKnownStock guarda o último estoque lido de verdade, base dos eventos de estoque.
  for (const [id, o] of Object.entries(prev)) {
    if (offers[id] || !stores.some((s) => s.id === o.storeId)) continue;
    if (touched.has(o.storeId) && !pageFailures.get(o.storeId)?.has(o.url)) continue;
    const recent = skipped.has(o.storeId) && !o.stale && now.getTime() - Date.parse(o.source_timestamp) < 3 * 3600e3;
    offers[id] = recent ? { ...o } : { ...o, stale: true, stock: 'UNKNOWN', lastKnownStock: lastValid(o)?.stock ?? null };
  }

  // Confirmação: oferta nova, que trocou de produto ou que caiu mais de 3% só vai para Oportunidades, Radar e alertas
  // quando a leitura seguinte (15 min depois) repete o valor. Uma leitura isolada errada nunca vira destaque.
  const bootstrap = !Object.keys(prev).length; // primeira rodada de todas: não há leitura anterior para comparar
  for (const o of Object.values(offers)) {
    if (o.stale) continue;
    if (bootstrap) { o.confirmed = true; o.pendingFrom = null; continue; }
    const old = prev[o.id];
    const same = !!(old && old.productId === o.productId && old.total > 0 && o.total > 0);
    delete o.justConfirmed; delete o.dropFrom;
    if (!same) { o.confirmed = false; o.pendingFrom = null; continue; }
    const wasPending = old.confirmed === false;
    // Total × total só com a mesma situação de frete; senão, preço × preço (frete que some ou volta não é queda).
    const c = comparable(old, o) || { from: old.total, to: o.total };
    const keepPending = (ref) => { o.confirmed = false; o.pendingFrom = ref?.total ?? null; o.pendingPrice = ref?.price ?? null; o.pendingShipKnown = ref?.shippingKnown ?? null; };
    if (c.to < c.from * 0.97) { keepPending(wasPending ? pendingRef(old) : { total: old.total, price: old.price ?? null, shippingKnown: !!old.shippingKnown }); continue; }
    if (wasPending && Math.abs(c.to - c.from) > c.to * 0.03) { keepPending(pendingRef(old)); continue; }
    o.confirmed = true;
    if (wasPending) {
      const ref = pendingRef(old); const pc = ref && (comparable(ref, o) || { from: ref.total, to: o.total });
      if (pc && pc.from > pc.to) { o.justConfirmed = 'drop'; o.dropFrom = old.pendingFrom; } else if (old.pendingFrom == null) o.justConfirmed = 'new';
    }
    o.pendingFrom = null; delete o.pendingPrice; delete o.pendingShipKnown;
  }

  // Histórico e eventos
  const events = []; const history = [];
  for (const o of Object.values(offers)) {
    if (o.stale) continue;
    const p = prev[o.id];
    const changed = !p || p.total !== o.total || p.stock !== o.stock || p.shipping !== o.shipping || p.seller !== o.seller;
    // Eventos comparam com o último estado lido de verdade: oferta desatualizada (loja ou página falhou) e estoque
    // desconhecido nunca viram "voltou ao estoque"; frete que passou a ser (ou deixou de ser) conhecido nunca vira queda.
    const base = lastValid(p);
    if (base && base.stock !== 'IN_STOCK' && base.stock !== 'UNKNOWN' && o.stock === 'IN_STOCK') events.push({ offerId: o.id, event: 'restock' });
    const c = base && o.stock === 'IN_STOCK' ? comparable(base, o) : null;
    if (c && c.to < c.from) events.push({ offerId: o.id, event: 'drop', from: c.from, to: c.to, basis: c.basis });
    if (changed) history.push({ t: T, offerId: o.id, productId: o.productId, storeId: o.storeId, seller: o.seller, price: o.price, priceKind: o.priceKind, shipping: o.shipping, total: o.total, stock: o.stock, quantity: o.quantity });
  }
  for (const o of Object.values(prev)) if (!offers[o.id] && touched.has(o.storeId)) history.push({ t: T, offerId: o.id, productId: o.productId, storeId: o.storeId, stock: 'UNAVAILABLE', event: 'removed' });

  // Agregados por produto. Preço Copag cadastrado à mão vence; senão vale o capturado na loja oficial.
  const products = {}; const newLowest = new Map();
  for (const base of Object.values(registry)) {
    const p = { ...base, copag: resolveCopag(base, catalog, copagSeen) };
    const cs = copagStatus(p);
    const list = Object.values(offers).filter((o) => o.productId === p.id);
    const live = list.filter((o) => o.stock === 'IN_STOCK' && !o.stale && o.total > 0);
    // Mediana (não média): um anúncio errado de R$ 400 num blister não pode puxar a referência e marcar os preços certos como suspeitos.
    const srt = live.map((o) => o.total).sort((x, y) => x - y);
    const rawAvg = srt.length ? (srt.length % 2 ? srt[(srt.length - 1) / 2] : (srt[srt.length / 2 - 1] + srt[srt.length / 2]) / 2) : null;
    for (const o of list) o.anomalous = o.total > 0 && isAnomalous(o.total, cs.msrp, live.length >= 3 ? rawAvg : null);
    const clean = live.filter((o) => !o.anomalous);
    const marketAverage = clean.length >= 2 ? round2(clean.reduce((a, o) => a + o.total, 0) / clean.length) : null;
    // Novo menor preço: só a oferta mais barata (confirmada) do produto, e só se for abaixo do recorde anterior.
    const champ = clean.filter((x) => x.confirmed !== false).reduce((a, o) => (!a || o.total < a.total ? o : a), null);
    if (champ && (!lowest[p.id] || champ.total < lowest[p.id].total)) { if (lowest[p.id] && !rebuiltLowest) newLowest.set(champ.id, lowest[p.id].total); lowest[p.id] = { total: champ.total, at: T, storeId: champ.storeId, offerId: champ.id }; }
    products[p.id] = { ...p, copagConfirmed: cs.confirmed, msrp: cs.confirmed ? cs.msrp : null, copagReason: cs.confirmed ? null : cs.reason, copagReference: cs.reference ?? null, copagReferenceUrl: cs.referenceUrl ?? null, marketAverage, lowestHistorical: lowest[p.id] || null, offerCount: list.length, inStockCount: clean.length };
  }

  const storeScores = Object.fromEntries(stores.map((s) => [s.id, storeScore(s, sources[s.id])]));
  for (const o of Object.values(offers)) {
    const p = products[o.productId]; const st = storeScores[o.storeId];
    o.storeScore = st.score; o.storeValidated = st.validated;
    if (p.msrp && o.total) { o.discount = +(1 - o.total / p.msrp).toFixed(4); o.savings = round2(p.msrp - o.total); } else { o.discount = null; o.savings = null; }
    o.vsMarket = p.marketAverage && o.total ? +(1 - o.total / p.marketAverage).toFixed(4) : null;
    // Nota: só a oficial do Opportunity Engine, lida antes dos alertas (a nota própria do robô e o selo 🔥 saíram na 6C.3).
    o.confidence_score = Math.round(100 * o.matchConfidence * (o.stale ? 0.5 : 1) * (o.stock === 'IN_STOCK' ? 1 : 0.8));
  }

  // Pistas (Pelando e canais do Telegram): separadas das ofertas, sem estoque confirmado, fora do ranking.
  const copagOf = (p) => { const cs = copagStatus({ ...p, copag: resolveCopag(p, catalog, copagSeen) }); return cs.confirmed ? { msrp: cs.msrp } : null; };
  const tipsCfg = readJson(configPath('pistas.json'), null);
  const tipStore = readJson(dataPath('tips.json'), {});
  let tipStatus = [];
  if (tipsCfg && process.env.HUNTER_TIPS !== '0') {
    try {
      const r = await collectTips(tipsCfg, catalog, log); tipStatus = r.status;
      for (const t of r.tips) {
        const old = tipStore[t.id]; const p = t.product; const c = p ? copagOf(p) : null;
        const discount = c && t.price ? +(1 - t.price / c.msrp).toFixed(4) : null;
        const { product, ...rest } = t;
        tipStore[t.id] = { ...rest, firstSeen: old?.firstSeen || T, lastSeen: T, isNew: !old,
          collectionName: p?.collectionName || null, label: p ? p.typeLabel + (p.boosters && /box|combo/.test(p.type) ? ` com ${p.boosters} boosters` : '') + (p.variant ? ' ' + p.variant : '') : null,
          msrp: c?.msrp ?? null, discount, perBooster: p?.boosters && t.price ? round2(t.price / p.boosters) : null, anomalous: !!(c && t.price && t.price < c.msrp * 0.55) };
      }
    } catch (e) { log(`[pistas] ${e.message}`); }
  }
  const maxAge = (tipsCfg?.horasMaximas || 72) * 3600e3;
  for (const [id, t] of Object.entries(tipStore)) { if (t.lastSeen !== T) t.isNew = false; if (now.getTime() - Date.parse(t.postedAt || t.firstSeen) > maxAge) delete tipStore[id]; }
  // Pistas antigas: relê o preço do texto com a regra atual (ignora parcela e preço condicionado a cartão).
  for (const t of Object.values(tipStore)) {
    if (t.lastSeen === T || !t.text) continue;
    const v = firstPrice(t.text); if (!(v > 0) || v === t.price) continue;
    if (t.perBooster && t.price) t.perBooster = round2(t.perBooster * v / t.price);
    t.price = v; t.discount = t.msrp ? +(1 - v / t.msrp).toFixed(4) : null; t.anomalous = !!(t.msrp && v < t.msrp * 0.55);
  }
  const tips = Object.values(tipStore).sort((a, b) => (b.productId ? 1 : 0) - (a.productId ? 1 : 0) || (b.discount ?? -9) - (a.discount ?? -9));

  // Bot: analisa links/promoções que você encaminhar para ele no Telegram.
  const inbox = readJson(dataPath('inbox.json'), {});
  try { const r = await processInbox(inbox, catalog, copagOf, log); if (r.handled) log(`[bot] ${r.handled} mensagens respondidas`); } catch (e) { log(`[bot] ${e.message}`); }

  // Nota oficial (Opportunity Engine, hunter.opportunity): só leitura, com prazo curto. Vale só para a oferta com o
  // mesmo preço lido agora e calculada há no máximo 60 min. Fica num mapa à parte, NÃO vai para state.json/offers.json
  // (o site sem banco continua "sem nota oficial", nunca com nota de rodada anterior).
  const live = liveForScore;
  // Em paralelo, só leitura: o banco recebeu a rodada anterior? (vai para data/meta.json, seção ops)
  const [off, dbHealth] = await Promise.all([readOfficial(Object.values(offers).filter(live).map((o) => o.id)), readDbHealth()]);
  const opp = new Map();
  for (const o of Object.values(offers)) { const x = live(o) ? officialFor(o, off.rows.get(o.id), now) : null; if (x) opp.set(o.id, x); }
  log(off.status === 'ok' ? `Nota oficial: ${opp.size} ofertas com nota válida (de ${off.rows.size} lidas)` : `Nota oficial indisponível (${off.reason}): alertas seguem sem nota`);

  // Alertas
  const okOffers = Object.values(offers).filter((o) => o.confirmed !== false);
  const hits = dedupe(evaluate(watch.rules || [], okOffers, events.filter((e) => offers[e.offerId]?.confirmed !== false), products, { opp, log }), sent, watch.settings, now.getTime(), offers);
  const delivered = [...await dispatch(hits, sent, { send, now }), ...await dispatchTips(tipHits(tips, sent, { tipMinDiscount: tipsCfg?.descontoMinimoAlerta ?? 0.15 }), sent, { send, now })];
  for (const d of delivered) log(`ALERTA ${d.kind} -> ${d.channels.join(', ') || 'só painel'}: ${d.productId} ${d.total}`);

  // Estado para painel e API
  const all = Object.values(offers);
  const ranked = rankBestDeals(all, opp);
  const cov = Object.values(sources).reduce((a, s) => { a.found++; a[s.status] = (a[s.status] || 0) + 1; return a; }, { found: 0 });
  // Histórico por produto e loja (arquivos pequenos em data/hist/) e limpeza do log bruto.
  try {
    const nb = backfill(Object.fromEntries(stores.map((x) => [x.id, x.name])));
    const nd = recordDay(all.filter((o) => o.confirmed !== false), products, T);
    if (nb || nd) log(`Histórico: ${nb ? nb + ' produtos montados do log, ' : ''}${nd} atualizados`);
    
  } catch (e) { log(`[histórico] ${e.message}`); }
  for (const p of Object.values(products)) { try { p.hist = histSummary(p.id, distrust); } catch { p.hist = null; } }
  let activity = [];
  try { activity = recordActivity({ T, offers, prev, products, newLowest, quiet, distrust, storeNames: Object.fromEntries(stores.map((x) => [x.id, x.name])) }).slice(0, 160); } catch (e) { log(`[atividade] ${e.message}`); }
  const state = {
    generatedAt: T,
    coverage: { found: cov.found, active: cov.ACTIVE || 0, blocked: cov.BLOCKED || 0, error: cov.ERROR || 0, pending: cov.PENDING || 0, unavailable: cov.UNAVAILABLE || 0, paused: cov.PAUSED || 0 },
    totals: { products: Object.keys(products).length, offers: all.filter((o) => !o.anomalous).length, review: all.filter((o) => o.anomalous).length, copagConfirmed: Object.values(products).filter((p) => p.copagConfirmed).length },
    collections: catalog.collections.map(({ id, name, series, aliases }) => ({ id, name, series, aliases: aliases || [], products: Object.values(products).filter((p) => p.collection === id).length })).filter((c) => c.products),
    types: Object.entries(TYPE_LABEL).map(([id, label]) => ({ id, label, group: groupOf(id), products: Object.values(products).filter((p) => p.type === id).length })).filter((t) => t.products),
    products: Object.values(products),
    bestDeals: ranked.map((o) => o.id),
    // Preço fora do plausível não é publicado: fica em data/review.json para conferência.
    offers: all.filter((o) => !o.anomalous),
    sources: Object.entries(sources).map(([id, s]) => ({ id, ...s, score: storeScores[id] || null })),
    unmatched: unmatched.slice(0, 200),
    tips: tips.slice(0, 150),
    activity,
    distrust: { stores: distrust.stores, until: distrust.until },
    tipSources: tipStatus,
    rules: watch.rules || [],
    // Reputação no Reclame Aqui: tabela consultada à mão (config/reclameaqui.json); o robô não acessa o site.
    reputation: (() => { const r = readJson(configPath('reclameaqui.json'), null); return r ? { consultadoEm: r.consultadoEm, lojas: r.lojas } : null; })(),
    recentAlerts: [...delivered, ...readJson(dataPath('state.json'), {}).recentAlerts || []].slice(0, 50),
  };
  writeJson(dataPath('offers.json'), offers);
  writeJson(dataPath('review.json'), all.filter((o) => o.anomalous).map(({ id, storeId, productId, title, url, total, prices }) => ({ id, storeId, productId, title, url, total, prices })));
  writeJson(dataPath('sources.json'), sources);
  writeJson(dataPath('lowest.json'), lowest);
  writeJson(dataPath('copag-msrp.json'), copagSeen);
  writeJson(dataPath('url-cache.json'), urlCache);
  writeJson(dataPath('products.json'), registry);
  writeJson(dataPath('alerts-sent.json'), sent);
  writeJson(dataPath('tips.json'), tipStore);
  writeJson(dataPath('inbox.json'), inbox);
  writeJson(dataPath('state.json'), state);
  appendJsonl(dataPath('history.jsonl'), history);
  try { trimJsonl(dataPath('history.jsonl')); } catch { /* sem log */ }
  appendJsonl(dataPath('alerts.jsonl'), delivered);
  // Estado operacional (data/meta.json → ops). Falha aqui nunca derruba a rodada.
  try {
    const rec = buildRunRecord({ startedAt, finishedAt: new Date().toISOString(), generatedAt: T, prevGeneratedAt,
      reader: readerSummary(off, opp.size), dbSync: syncStatus(dbHealth, prevGeneratedAt),
      stores: storesSummary(sources, skipped.size), watched: watchedSummary(sources), offers: all.length, alerts: delivered.length });
    recordRun(dataPath('meta.json'), rec);
    log(`Estado operacional: ${rec.health}${rec.issues.length ? ' (' + rec.issues.join(', ') + ')' : ''} · banco: ${rec.dbSync.status} · leitor: ${rec.reader.status} ${rec.reader.valid}/${rec.reader.read}`);
  } catch (e) { log(`[estado operacional] ${String(e.message).slice(0, 120)}`); }
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
