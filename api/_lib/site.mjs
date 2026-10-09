// Serviço "site" da API v1 (FASE 4): listas e página de produto no formato que o site já renderiza.
// As regras de seleção são as MESMAS do tools/page.template.html (entries, sortEntries, discOf, bestOfferFor,
// filtros): aqui são aplicadas no servidor sobre o estado vindo do banco (ou do state.json no fallback), para o
// navegador receber só a página pedida. Qualquer mudança nelas deve ser feita nos dois lugares — os testes de
// paridade (api-tests + navegador) comparam as duas.
// Nada de estatística é recalculado aqui: preço médio / menor já visto vêm do Price Engine (product_stats).
import { PRODUCT_FIELDS, OFFER_FIELDS } from './home.mjs';

export const live = (o) => o.stock === 'IN_STOCK' && !o.stale && !o.anomalous && o.total > 0;
export const refOf = (p) => (p.copagConfirmed ? { v: p.msrp, net: false } : p.copagReference ? { v: p.copagReference, net: true } : null);
export const discOf = (p, o) => { if (!o || o.anomalous) return null; if (p.copagConfirmed) return o.discount; const r = refOf(p); return r ? +(1 - o.total / r.v).toFixed(4) : null; };
export const GROUP_ORDER = ['Boosters', 'ETB', 'Blisters', 'Coleções', 'Latas', 'Baralhos'];
export const DEFAULT_F = { mode: 'guardar', group: '', col: '', store: '', sort: '', stock: true, type: '', max: '', below: false };
const idCmp = (a, b) => String(a).localeCompare(String(b));
/** desempate do site: preço, id (byTot no index.html). Nota de oportunidade não desempata preço. */
export const byTot = (a, b) => a.total - b.total || idCmp(a.id, b.id);
/** nota oficial da oferta (Opportunity Engine); sem avaliação, null — nunca estimada */
export const oppScore = (o) => (o?.opp && Number.isFinite(o.opp.score) ? o.opp.score : null);

/** entries() do site: por produto, a oferta de menor preço (ou por booster) que passa nos filtros. */
export function entries(st, F) {
  const P = productMap(st); const by = new Map();
  for (const o of st.offers || []) {
    if (F.stock && !live(o)) continue;
    if (!F.stock && (o.stale || o.anomalous || o.stock === 'OUT_OF_STOCK')) continue;
    const p = P.get(o.productId); if (!p) continue;
    if (F.group && p.group !== F.group) continue;
    if (F.col && p.collection !== F.col) continue;
    if (F.store && o.storeId !== F.store) continue;
    if (F.type && p.type !== F.type) continue;
    if (F.max && !(o.total <= Number(F.max))) continue;
    if (F.below && !(o.discount > 0)) continue;
    if (F.mode === 'abrir' && !o.perBooster) continue;
    if (!by.has(p.id)) by.set(p.id, []); by.get(p.id).push(o);
  }
  const key = F.mode === 'abrir' ? (o) => o.perBooster : (o) => o.total;
  return [...by.entries()].map(([id, list]) => { list.sort((a, b) => key(a) - key(b) || idCmp(a.id, b.id)); return { p: P.get(id), o: list[0], n: list.length }; });
}
/** sortEntries() do site (com desempate final pelo id do produto, igual ao site). */
export function sortEntries(list, F) {
  const s = F.sort || (F.mode === 'abrir' ? 'ppb' : 'score');
  // "Melhor oportunidade": nota oficial da oferta exibida; sem nota vai para o fim e segue pelo desconto
  const cmp = { score: (a, b) => (oppScore(b.o) ?? -1) - (oppScore(a.o) ?? -1) || (b.o.discount ?? -9) - (a.o.discount ?? -9),
    disc: (a, b) => (discOf(b.p, b.o) ?? -9) - (discOf(a.p, a.o) ?? -9), price: (a, b) => a.o.total - b.o.total,
    ppb: (a, b) => (a.o.perBooster ?? 1e9) - (b.o.perBooster ?? 1e9),
    new: (a, b) => String(b.p.firstSeen || '').localeCompare(String(a.p.firstSeen || '')) || a.o.total - b.o.total }[s] || (() => 0);
  return list.sort((a, b) => cmp(a, b) || idCmp(a.p.id, b.p.id));
}
/** Dados dos filtros (o que filtersHTML lista), a partir de entries() sem grupo/coleção/loja. */
export function facetsOf(all, st, F) {
  const groups = GROUP_ORDER.filter((gr) => all.some((e) => e.p.group === gr)).map((gr) => [gr, all.filter((e) => e.p.group === gr).length]);
  const cols = (st.collections || []).filter((c) => all.some((e) => e.p.collection === c.id)).map((c) => ({ id: c.id, name: c.name, series: c.series || 'Outras' }));
  const stores = [...new Map(all.map((e) => [e.o.storeId, e.o.storeName])).entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  const types = [...new Map(all.filter((e) => !F.group || e.p.group === F.group).map((e) => [e.p.type, e.p.typeLabel])).entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  return { groups, cols, stores, types };
}

/** reputação (Reclame Aqui) e evidências só das lojas presentes nas ofertas devolvidas */
export function sideOf(st, offers) {
  const stores = new Set(offers.map((o) => o.storeId)); const rep = st.reputation || null;
  return { sources: (st.sources || []).filter((s) => stores.has(s.id)).map((s) => ({ id: s.id, name: s.name, score: s.score?.evidence ? { evidence: s.score.evidence } : undefined })),
    reputation: rep ? { consultadoEm: rep.consultadoEm, lojas: Object.fromEntries(Object.entries(rep.lojas || {}).filter(([k]) => stores.has(k))) } : null };
}
const pmCache = new WeakMap();
function productMap(st) { let m = pmCache.get(st); if (!m) { m = new Map((st.products || []).map((p) => [p.id, p])); pmCache.set(st, m); } return m; }
const pick = (o, keys) => { const r = {}; for (const k of keys) if (o[k] !== undefined && o[k] !== null) r[k] = o[k]; return r; };
const liveCounts = (st) => { const n = {}; for (const o of st.offers || []) if (live(o)) n[o.productId] = (n[o.productId] || 0) + 1; return n; };
const CARD_P = [...PRODUCT_FIELDS, 'firstSeen'];
const cardP = (p, n) => ({ ...pick(p, CARD_P), liveCount: n[p.id] || 0 });

/** /produtos: lista filtrada, ordenada e paginada + filtros + "sem preço sugerido". */
export function siteProducts(st, F0, { page = 1, limit = 48 } = {}) {
  const F = { ...DEFAULT_F, ...F0 };
  const raw = entries(st, F);
  const base = F.mode === 'guardar' ? raw.filter((e) => refOf(e.p)) : raw;
  const noCopag = F.mode === 'guardar' ? raw.filter((e) => !refOf(e.p)) : [];
  const list = sortEntries(base.slice(), F);
  const all = entries(st, { ...F, group: '', col: '', store: '' });
  const n = liveCounts(st);
  const card = (e) => ({ p: cardP(e.p, n), o: pick(e.o, OFFER_FIELDS), n: e.n });
  // "Sem preço sugerido" fica num bloco fechado no site: vem só a contagem; a lista sai com semref=1, sob demanda
  const rows = F.semref ? sortEntries(noCopag, F) : list;
  const pageRows = rows.slice((page - 1) * limit, page * limit);
  return { ...sideOf(st, pageRows.map((e) => e.o)),
    total: rows.length, page, limit, pages: Math.max(1, Math.ceil(rows.length / limit)),
    items: pageRows.map(card),
    allCount: all.length, facets: F.semref ? null : facetsOf(all, st, F),
    noCopagCount: noCopag.length, refNet: base.some((e) => !e.p.copagConfirmed),
  };
}

/** Ofertas candidatas para coleção, tipo e busca: as que renderGroup / bestOfferFor podem escolher. */
export function siteOffers(st, { ids = null, col = null, type = null }) {
  const P = productMap(st);
  // produto entra se tem oferta de verdade na lista (o offerCount do robô às vezes conta ofertas que já não existem)
  const has = new Set((st.offers || []).map((o) => o.productId));
  const want = new Set(ids ? ids.filter((id) => P.has(id))
    : (st.products || []).filter((p) => has.has(p.id) && (col ? p.collection === col : p.type === type)).map((p) => p.id));
  const by = new Map(); for (const o of st.offers || []) if (want.has(o.productId)) { if (!by.has(o.productId)) by.set(o.productId, []); by.get(o.productId).push(o); }
  const keep = new Map(); const add = (o) => o && keep.set(o.id, o);
  const firstBy = (list, cmp) => (list.length ? [...list].sort(cmp)[0] : null);
  for (const [, list] of by) {
    add(firstBy(list.filter(live), byTot));                                                                              // bestLive
    add(firstBy(list, byTot));                                                                                           // renderGroup sem estoque
    add(firstBy(list.filter((o) => !o.anomalous), (a, b) => (a.stock === 'PRE_ORDER' ? 0 : 1) - (b.stock === 'PRE_ORDER' ? 0 : 1) || byTot(a, b))); // bestOfferFor
  }
  const n = liveCounts(st);
  const offers = [...keep.values()];
  return { products: [...want].map((id) => cardP(P.get(id), n)), offers: offers.map((o) => pick(o, OFFER_FIELDS)), liveCount: Object.fromEntries([...want].map((id) => [id, n[id] || 0])), ...sideOf(st, offers) };
}

/** tipHits() do site: pistas do Telegram que batem com o termo da busca (todas as palavras, sem acento). */
const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export function tipHits(st, q) {
  const ws = norm(q).split(/\s+/).filter(Boolean); if (!ws.length) return [];
  return (st.tips || []).filter((x) => !x.expired).filter((x) => { const hay = norm([x.collectionName, x.label, x.title, x.text, x.store].join(' ')); return ws.every((w) => hay.includes(w)); })
    .sort((a, b) => String(b.postedAt || b.firstSeen).localeCompare(String(a.postedAt || a.firstSeen))).slice(0, 8)
    .map((t) => Object.fromEntries(Object.entries(t).filter(([k]) => !['raw', 'html', 'media', 'entities'].includes(k))));
}

const PAGE_OFFER = [...OFFER_FIELDS, 'source_timestamp', 'ean', 'sku', 'priceKindLabel', 'storeKind', 'sellerKind'];
const TIP_DROP = new Set(['text', 'raw', 'html', 'media', 'entities']);
/**
 * Página do produto: o produto, todas as suas ofertas atuais, pistas do Telegram dele, lojas e reputação.
 * stats (Price Engine) define "preço médio" e "menor já visto"; sem histórico suficiente, o menor já visto do robô
 * continua (transição, até o Price Engine ter 3 dias).
 */
export function siteProduct(st, id, { stats = null, minDay = null } = {}) {
  const P = productMap(st); const p = P.get(id); if (!p) return null;
  const offers = (st.offers || []).filter((o) => o.productId === id);
  const stores = new Set(offers.map((o) => o.storeId));
  const prod = { ...pick(p, [...CARD_P, 'series', 'copag', 'marketAverage', 'lowestHistorical', 'hist']) };
  if (stats) {
    prod.marketAverage = stats.coverage?.in_stock_offers >= 2 && stats.market?.average != null ? stats.market.average : null;
    if (stats.history?.status === 'ok' && stats.history.min != null) prod.lowestHistorical = { total: stats.history.min, at: minDay ? `${minDay}T12:00:00.000Z` : null, source: 'price_engine' };
    else if (prod.lowestHistorical) prod.lowestHistorical = { total: prod.lowestHistorical.total, at: prod.lowestHistorical.at, source: 'robot' };
  }
  const rep = st.reputation || null;
  return {
    product: prod, offers: offers.map((o) => pick(o, PAGE_OFFER)), liveCount: offers.filter(live).length,
    tips: (st.tips || []).filter((t) => t.productId === id && !t.expired && t.price > 0).map((t) => Object.fromEntries(Object.entries(t).filter(([k]) => !TIP_DROP.has(k)))),
    sources: (st.sources || []).filter((s) => stores.has(s.id)).map((s) => ({ id: s.id, name: s.name, score: s.score?.evidence ? { evidence: s.score.evidence } : undefined })),
    reputation: rep ? { consultadoEm: rep.consultadoEm, lojas: Object.fromEntries(Object.entries(rep.lojas || {}).filter(([k]) => stores.has(k))) } : null,
    stats,
  };
}
