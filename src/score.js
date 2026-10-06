// Preço Copag, Deal Score, classificação, anomalia e STORE_SCORE.
const MARKETPLACE_HOSTS = /(mercadolivre|mercadolibre|amazon|shopee|magazineluiza|magalu|americanas|casasbahia|pontofrio|extra\.com|carrefour|kabum|aliexpress|submarino|buscape|zoom\.com)/i;

export function copagStatus(product) {
  const c = product.copag || {};
  if (!(c.msrp > 0)) return { confirmed: false, reason: 'sem valor' };
  if (!c.source_url) return { confirmed: false, reason: 'sem fonte' };
  if (MARKETPLACE_HOSTS.test(c.source_url)) return { confirmed: false, reason: 'fonte é marketplace (não aceita como MSRP)' };
  if (c.confidence !== 'OFICIAL') return { confirmed: false, reason: 'fonte não marcada como oficial' };
  return { confirmed: true, msrp: c.msrp };
}

// Pix > à vista > cartão > preço base da plataforma.
export function pickPrice(p = {}) {
  for (const k of ['pix', 'avista', 'cartao', 'base']) if (p[k] > 0) return { value: p[k], kind: k };
  return { value: null, kind: null };
}
export const PRICE_LABEL = { pix: 'Pix', avista: 'à vista', cartao: 'cartão', base: 'preço da loja' };

export function storeScore(store, sourceStats = {}) {
  const e = store.evidence || {}; const parts = []; let s = 0;
  if (e.cnpj) { s += 20; parts.push('CNPJ'); }
  if (e.rating > 0 && e.reviewCount > 0) { const w = Math.min(1, e.reviewCount / 500); s += Math.round((e.rating / 5) * 30 * w); parts.push(`avaliação ${e.rating}/5 (${e.reviewCount})`); }
  if (e.foundedYear) { const yrs = new Date().getFullYear() - e.foundedYear; s += Math.round(Math.min(1, yrs / 5) * 15); parts.push(`${yrs} anos`); }
  if (e.returnPolicyUrl) { s += 10; parts.push('política de troca'); }
  if (e.contact) { s += 5; parts.push('contato'); }
  if (e.officialStore) { s += 25; parts.push('loja oficial'); }
  const checks = sourceStats.checks || 0;
  if (checks >= 10) { s += Math.round(((sourceStats.ok || 0) / checks) * 20); parts.push('histórico de coleta'); }
  if (!parts.length) return { score: null, validated: false, evidence: [] };
  return { score: Math.min(100, s), validated: s >= 50, evidence: parts };
}

export function classify(score) {
  if (score == null) return { label: 'DADO NÃO CONFIRMADO', tier: 'none' };
  if (score >= 90) return { label: '🔥 OPORTUNIDADE EXCEPCIONAL', tier: 'exceptional' };
  if (score >= 80) return { label: '🟢 EXCELENTE', tier: 'excellent' };
  if (score >= 70) return { label: '🟢 MUITO BOM', tier: 'verygood' };
  if (score >= 60) return { label: '🟡 BOM', tier: 'good' };
  if (score >= 50) return { label: '🟡 NORMAL', tier: 'normal' };
  return { label: '⚪ IGNORAR', tier: 'ignore' };
}

// Preço anormal: desconto Copag > 45% ou < 55% da média monitorada. Vai para investigação, nunca para o ranking.
export function isAnomalous(price, msrp, marketAvg) {
  if (msrp && price < msrp * 0.55) return true;
  if (marketAvg && price < marketAvg * 0.55) return true;
  return false;
}

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));

/** ctx: { msrp, lowestHistorical, bestPerBoosterInCollection, store } */
export function dealScore(offer, ctx) {
  if (!ctx.msrp || offer.stock !== 'IN_STOCK' || !offer.productId || !(offer.total > 0)) return { score: null, parts: null, partial: true };
  const d = 1 - offer.total / ctx.msrp;
  const parts = {
    copag: d <= 0 ? 0 : 35 * clamp(d / 0.30),
    historico: ctx.lowestHistorical ? 15 * clamp(1 - (offer.total - ctx.lowestHistorical) / ctx.lowestHistorical / 0.15) : 7.5,
    porBooster: offer.perBooster && ctx.bestPerBoosterInCollection ? 15 * clamp(ctx.bestPerBoosterInCollection / offer.perBooster) : (offer.perBooster ? 7.5 : 7.5),
    estoque: 10,
    loja: ctx.store?.score != null ? 10 * ctx.store.score / 100 : 0,
    frete: offer.shipping === 0 ? 5 : offer.shipping > 0 ? 3 : 0,
    lacrado: offer.matchConfidence >= 0.85 ? 5 : 2.5,
    disponibilidade: offer.quantity > 1 ? 5 : 3,
  };
  const score = Math.round(Object.values(parts).reduce((a, b) => a + b, 0));
  return { score, parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, +v.toFixed(1)])), partial: false };
}

// Selo 🔥 OPORTUNIDADE: todas as condições da regra 25.
export function opportunityBadge(offer, ctx) {
  return offer.stock === 'IN_STOCK' && !!offer.productId && offer.matchConfidence >= 0.75 && offer.total > 0 && !!ctx.msrp
    && offer.discount > 0 && !offer.anomalous && !!ctx.store?.validated && (offer.dealScore ?? 0) >= 80;
}
