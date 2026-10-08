// Fallback da API v1: as mesmas respostas, montadas a partir do state.json (comportamento atual do site).
// Usado quando o banco não está configurado na Vercel ou não responde. Mesmo formato das leituras do banco,
// com a marcação source: 'state' na resposta. O que só existe no banco (histórico diário, estatísticas históricas)
// volta vazio/nulo, nunca inventado.
import { slugs, label } from '../_seo.mjs';
import { robotReferenceKind, SCOPE, LABEL } from '../../src/core/references.js';

const live = (o) => o.stock === 'IN_STOCK' && !o.stale && !o.anomalous && o.total > 0;
const STOCK_IN = { IN_STOCK: 'in_stock', OUT_OF_STOCK: 'out_of_stock', PRE_ORDER: 'preorder' };
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 100) / 100; };

function index(st) {
  const { of } = slugs(st.products || []);
  const cols = new Map((st.collections || []).map((c) => [c.id, c]));
  const byP = new Map(); for (const o of st.offers || []) { if (!byP.has(o.productId)) byP.set(o.productId, []); byP.get(o.productId).push(o); }
  return { of, cols, byP };
}
function marketOf(list) {
  const elig = list.filter((o) => live(o) && o.confirmed !== false && o.price > 0);
  const prices = elig.map((o) => o.price);
  const withTotal = elig.filter((o) => o.shippingKnown && o.total > 0);
  return { elig, current: prices.length ? Math.min(...prices) : null, total: withTotal.length ? Math.min(...withTotal.map((o) => o.total)) : null, median: median(prices) };
}
const refOf = (p) => (p.copagConfirmed && p.msrp ? { value: p.msrp, status: 'verified' } : p.copagReference ? { value: p.copagReference, status: 'pending' } : null);
const nameOf = (p) => `${p.collectionName} - ${label(p)}`;

export function stateListProducts(st, { page, limit, colecao = null, tipo = null, estoque = false, busca = null, ordem = 'relevancia' }) {
  const { of, byP } = index(st);
  let items = (st.products || []).map((p) => {
    const list = byP.get(p.id) || []; const m = marketOf(list); const r = refOf(p);
    return { id: p.id, slug: of[p.id], name: nameOf(p), collection: { code: p.collection, name: p.collectionName }, category: null, type: p.type, boosters: p.boosters ?? null,
      image: p.image ?? null, price: { current: m.current, current_total: m.total, median: m.median }, reference: r,
      discount_vs_reference: r?.status === 'verified' && m.current != null ? +((r.value - m.current) / r.value).toFixed(4) : null,
      offers: { active: list.filter((o) => !o.stale).length, in_stock: m.elig.length, stores: new Set(m.elig.map((o) => o.storeId)).size },
      status: !list.length ? 'no_offers' : m.elig.length ? 'ok' : 'no_stock' };
  });
  if (colecao) items = items.filter((x) => x.collection.code === colecao);
  if (tipo) items = items.filter((x) => x.type === tipo);
  if (estoque) items = items.filter((x) => x.status === 'ok');
  if (busca) items = items.filter((x) => x.name.toLowerCase().includes(String(busca).toLowerCase()));
  const by = { preco: (a, b) => (a.price.current ?? 1e12) - (b.price.current ?? 1e12), desconto: (a, b) => (b.discount_vs_reference ?? -9) - (a.discount_vs_reference ?? -9),
    nome: () => 0, ofertas: (a, b) => b.offers.active - a.offers.active, relevancia: (a, b) => b.offers.in_stock - a.offers.in_stock }[ordem] || (() => 0);
  items.sort((a, b) => by(a, b) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return { items: items.slice((page - 1) * limit, page * limit), total: items.length };
}

function findProduct(st, key) {
  const { of } = slugs(st.products || []);
  return (st.products || []).find((p) => p.id === key || of[p.id] === key) || null;
}

export function stateGetProduct(st, key) {
  const p = findProduct(st, key); if (!p) return null;
  const { of, byP } = index(st); const list = byP.get(p.id) || []; const m = marketOf(list); const r = refOf(p);
  return { id: p.id, slug: of[p.id], name: nameOf(p), tcg: 'pokemon', category: null, type: p.type, type_label: p.typeLabel,
    collection: { code: p.collection, name: p.collectionName, series: p.series ?? null }, boosters: p.boosters ?? null, variant: p.variant ?? null,
    language: 'pt-BR', condition: 'new', image: p.image ?? null, status: 'active',
    identifiers: p.ean ? [{ kind: 'ean', value: String(p.ean) }] : [],
    ...stateRefs(p, r), stats: stateStatsOf(p, list, m, r) };
}
// mesmo contrato do banco: referência atual × contexto histórico (o state.json não tem histórico Copag)
function stateRefs(p, r) {
  if (!r) return { current_reference: null, historical_context: [], references: [] };
  const url = r.status === 'verified' ? p.copag?.source_url ?? null : p.copagReferenceUrl ?? null; const kind = robotReferenceKind({ source_url: url });
  const ref = { ...r, source: r.status === 'verified' ? 'copag_loja' : 'internet', source_url: url, verified_at: r.status === 'verified' ? p.copag?.source_timestamp ?? null : null,
    kind, scope: SCOPE[kind], label: LABEL[kind] };
  return { current_reference: r.status === 'verified' && SCOPE[kind] === 'current' ? ref : null, historical_context: [], references: [ref] };
}
function stateStatsOf(p, list, m, r) {
  return { as_of_day: null, status: !list.length ? 'no_offers' : m.elig.length ? 'ok' : 'no_stock',
    market: { current_price: m.current, current_total_price: m.total, lowest: m.current, highest: m.elig.length ? Math.max(...m.elig.map((o) => o.price)) : null,
      average: m.elig.length ? Math.round((m.elig.reduce((a, o) => a + o.price, 0) / m.elig.length) * 100) / 100 : null, median: m.median },
    history: { days: 0, from: null, status: 'insufficient', min: null, max: null, average: null, median: null, variation_24h: null, variation_7d: null, variation_30d: null, distance_from_average: null, distance_from_min: null },
    reference: r ? { value: r.value, status: r.status, source: null, verified_at: null } : null,
    discount_vs_reference: r?.status === 'verified' && m.current != null ? +((r.value - m.current) / r.value).toFixed(4) : null,
    coverage: { active_offers: list.filter((o) => !o.stale).length, in_stock_offers: m.elig.length, stores: new Set(m.elig.map((o) => o.storeId)).size,
      marketplaces: new Set(m.elig.map((o) => (o.storeId === 'mercadolivre' ? 'mercadolivre' : 'direct'))).size,
      shipping_coverage: m.elig.length ? +(m.elig.filter((o) => o.shippingKnown).length / m.elig.length).toFixed(4) : null },
    engine_version: null, computed_at: null };
}

export function stateProductOffers(st, key, { page, limit, todas = false }) {
  const p = findProduct(st, key); if (!p) return null;
  const { of, byP } = index(st);
  const list = [...(byP.get(p.id) || [])]   // o state.json só tem ofertas vivas ou pendentes (removidas não ficam nele)
    .sort((a, b) => (!!a.stale - !!b.stale) || ((b.stock === 'IN_STOCK') - (a.stock === 'IN_STOCK')) || (a.price ?? 1e12) - (b.price ?? 1e12) || String(a.id).localeCompare(String(b.id)));
  const items = list.slice((page - 1) * limit, page * limit).map((o) => ({
    id: o.id, store: { id: o.storeId, name: o.storeName }, marketplace: o.storeId === 'mercadolivre' ? 'mercadolivre' : 'direct', seller: o.seller ?? null,
    title: o.title, url: o.url, image: o.image ?? null, price: o.price ?? null, price_kind: o.priceKind ?? null, pix_price: o.prices?.pix ?? null, list_price: o.listPrice ?? null,
    shipping: { status: o.shippingKnown ? (o.shipping === 0 ? 'free' : 'known') : 'unknown', price: o.shippingKnown ? o.shipping : null },
    total_price: o.shippingKnown ? o.total : null, stock: STOCK_IN[o.stock] || 'unknown', quantity: o.quantity ?? null, status: o.stale ? 'pending' : 'active',
    confirmed: o.confirmed !== false, anomalous: !!o.anomalous, first_seen_at: o.firstSeen ?? null, last_seen_at: o.source_timestamp ?? null,
  }));
  return { product: { id: p.id, slug: of[p.id], name: nameOf(p) }, items, total: list.length };
}

export function stateProductHistory(st, key, { dias }) {
  const p = findProduct(st, key); if (!p) return null;
  const { of } = slugs(st.products || []);
  return { product: { id: p.id, slug: of[p.id], name: nameOf(p) }, days: dias, series: [] };   // série diária só existe no banco
}
export function stateProductStats(st, key) {
  const d = stateGetProduct(st, key); if (!d) return null;
  return { product: { id: d.id, slug: d.slug, name: d.name }, stats: d.stats };
}
export function stateListReferences(st, { page, limit, status = null }) {
  const { of } = slugs(st.products || []);
  let items = (st.products || []).map((p) => { const r = refOf(p); return r ? { product: { id: p.id, slug: of[p.id], name: nameOf(p) }, value: r.value, status: r.status,
    source: r.status === 'verified' ? 'copag_loja' : 'internet', source_url: r.status === 'verified' ? p.copag?.source_url ?? null : p.copagReferenceUrl ?? null,
    verified_at: r.status === 'verified' ? p.copag?.source_timestamp ?? null : null } : null; }).filter(Boolean);
  if (status) items = items.filter((x) => x.status === status);
  items.sort((a, b) => ((b.status === 'verified') - (a.status === 'verified')) || a.product.name.localeCompare(b.product.name));
  return { items: items.slice((page - 1) * limit, page * limit), total: items.length };
}
