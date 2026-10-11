// Resumo da Home (FASE 3). Recebe um estado no formato do state.json — vindo do banco (Marketplace Core +
// Price Engine, com campos legados sobrepostos) ou do próprio state.json (fallback) — e devolve só o que a Home
// renderiza, no mesmo formato que o site já entende. Função pura: mesma entrada, mesma saída.
//
// O que a Home usa (tools/page.template.html → renderDeals e auxiliares):
// • todos os produtos (slugs, busca, contagens), com campos enxutos;
// • por produto: a melhor oferta com estoque (bestLive), a melhor oferta "sem estoque negado" (entries com o filtro
//   de estoque desligado) e a melhor pré-venda. Cada oferta leva a nota oficial do Opportunity Engine (opp), quando existe;
// • a oferta com menor preço por booster (destaques), as ofertas citadas na atividade recente;
// • atividade, pistas (sem o texto bruto), reputação e evidências só das lojas presentes.
import { byComparableTotal } from './offer-rank.mjs';

export const HOME_VERSION = 1;

const live = (o) => o.stock === 'IN_STOCK' && !o.stale && !o.anomalous && o.total > 0;
const notOut = (o) => !(o.stale || o.anomalous || o.stock === 'OUT_OF_STOCK') && o.total > 0;
// "menor total" comparável (issue #84): frete desconhecido não vence oferta com frete conhecido — ver offer-rank.mjs
const byTotal = byComparableTotal;
const first = (list, cmp) => (list.length ? [...list].sort(cmp)[0] : null);

// Só os campos que o código da Home lê (levantamento em tools/page.template.html; ver relatório da fase 3).
export const PRODUCT_FIELDS = ['id', 'collection', 'collectionName', 'type', 'typeLabel', 'group', 'boosters', 'variant', 'ean', 'image',
  'copagConfirmed', 'msrp', 'copagReference', 'copagReferenceUrl', 'offerCount'];
export const OFFER_FIELDS = ['id', 'productId', 'storeId', 'storeName', 'seller', 'url', 'image', 'price', 'priceKind', 'shipping', 'shippingKnown', 'total',
  'perBooster', 'stock', 'quantity', 'releaseDate', 'firstSeen', 'stale', 'confirmed', 'anomalous', 'storeValidated', 'discount', 'savings', 'opp'];   // opp = nota oficial do Opportunity Engine (sem Deal Score)
const TIP_DROP = new Set(['text', 'raw', 'html', 'media', 'entities']);
const pick = (o, keys) => { const r = {}; for (const k of keys) if (o[k] !== undefined && o[k] !== null) r[k] = o[k]; return r; };

export function slimHome(st, { source = 'state', now = Date.now(), activityDays = 7, tipsMax = 8 } = {}) {
  const products = st.products || []; const offers = st.offers || [];
  const P = new Map(products.map((p) => [p.id, p]));
  const byP = new Map();
  for (const o of offers) { if (!P.has(o.productId)) continue; if (!byP.has(o.productId)) byP.set(o.productId, []); byP.get(o.productId).push(o); }

  const keep = new Map(); const add = (o) => { if (o) keep.set(o.id, o); };
  const liveCount = {}; const codes = {};
  for (const [pid, list] of byP) {
    const L = list.filter(live); liveCount[pid] = L.length;
    add(first(L, byTotal));                                   // bestLive / entries (estoque confirmado)
    add(first(list.filter(notOut), byTotal));                 // entries com o filtro de estoque desligado
    add(first(list.filter((o) => o.stock === 'PRE_ORDER'), byTotal));                                           // pré-vendas
    const cs = new Set(); for (const o of list) for (const v of [o.sku, o.ean]) if (v && String(v).length >= 4) cs.add(String(v)); codes[pid] = [...cs];
  }
  // destaque "booster mais barato": menor preço por booster entre todas as ofertas com estoque (produto com Copag)
  add(offers.filter((o) => live(o) && o.perBooster && P.get(o.productId)?.copagConfirmed).sort((a, b) => a.perBooster - b.perBooster || String(a.id).localeCompare(String(b.id)))[0]);
  // atividade recente (ticker, radar, feed, quedas) e as ofertas que ela cita (selo "no Pix")
  const since = now - activityDays * 864e5;
  const activity = (st.activity || []).filter((e) => P.has(e.productId) && Date.parse(e.t) >= since);
  const offById = new Map(offers.map((o) => [o.id, o]));

  const kept = [...keep.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  // a atividade só precisa do tipo de preço da oferta citada (selo "no Pix"); a oferta inteira não vem
  const offerKinds = {};
  for (const e of activity) { const o = offById.get(e.offerId); if (o && !keep.has(o.id) && o.priceKind === 'pix') offerKinds[o.id] = 'pix'; }
  const stores = new Set(kept.map((o) => o.storeId));
  const withImg = new Set(kept.filter((o) => o.image).map((o) => o.productId));
  const colName = new Map((st.collections || []).map((c) => [c.id, c.name]));
  const typeOf = new Map((st.types || []).map((t) => [t.id, t]));
  const liveAll = offers.filter((o) => live(o) && P.has(o.productId));
  const allTips = (st.tips || []);
  const liveTips = allTips.filter((t) => t.productId && !t.expired && t.price > 0)
    .sort((a, b) => String(b.postedAt || b.firstSeen).localeCompare(String(a.postedAt || a.firstSeen)));
  const rep = st.reputation || null;

  return {
    v: HOME_VERSION, slim: true, source,
    hydrate: ['collectionName', 'typeLabel', 'group'],   // o site completa a partir de collections/types
    generatedAt: st.generatedAt, coverage: st.coverage, totals: st.totals,
    counts: {
      products: products.length,
      productsWithOffers: byP.size,
      liveOffers: liveAll.length,
      stores: new Set(liveAll.map((o) => o.storeId)).size,
      pre: offers.filter((o) => o.stock === 'PRE_ORDER').length,
      tips: allTips.filter((x) => x.productId && !x.expired && x.discount >= 0.15 && !x.anomalous).length,
      offersIncluded: kept.length,
    },
    collections: (st.collections || []).map((c) => pick(c, ['id', 'name', 'series', 'aliases', 'logo', 'products'])),   // products: nº de produtos (atalhos da busca)
    types: st.types || [],
    // produto sem nenhuma oferta não aparece na Home nem muda o endereço dos outros (slugs ordenam por nº de ofertas)
    products: products.filter((p) => byP.has(p.id) || activity.some((e) => e.productId === p.id))
      .map((p) => {
        const r = { ...pick(p, PRODUCT_FIELDS), liveCount: liveCount[p.id] || 0, codes: codes[p.id] || [] };
        if (withImg.has(p.id)) delete r.image;               // a foto da oferta tem prioridade (photo(p, o))
        if (p.lowestHistorical?.total) r.lowestHistorical = { total: p.lowestHistorical.total, at: p.lowestHistorical.at };
        // nome da coleção, rótulo e grupo do tipo saem das listas collections/types quando batem (o site preenche de volta)
        if (colName.get(p.collection) === p.collectionName) delete r.collectionName;
        const ty = typeOf.get(p.type); if (ty && ty.label === p.typeLabel) delete r.typeLabel; if (ty && ty.group === p.group) delete r.group;
        if (!r.copagConfirmed) delete r.copagConfirmed;
        return r;
      }),
    // booleanos no valor padrão não viajam: o site testa !o.stale, !o.anomalous, o.confirmed!==false...
    offers: kept.map((o) => { const r = pick(o, OFFER_FIELDS); for (const k of ['stale', 'anomalous', 'storeValidated', 'shippingKnown']) if (r[k] === false) delete r[k];
      if (r.confirmed === true) delete r.confirmed; return r; }),
    activity,
    offerKinds,
    tips: liveTips.slice(0, tipsMax).map((t) => Object.fromEntries(Object.entries(t).filter(([k]) => !TIP_DROP.has(k)))),
    sources: (st.sources || []).filter((s) => stores.has(s.id)).map((s) => ({ id: s.id, name: s.name, score: s.score?.evidence ? { evidence: s.score.evidence } : undefined })),
    distrust: st.distrust || null,      // janela de leituras não confiáveis (o gráfico de reserva do produto usa)
    reputation: rep ? { consultadoEm: rep.consultadoEm, lojas: Object.fromEntries(Object.entries(rep.lojas || {}).filter(([k]) => stores.has(k))) } : null,
  };
}
