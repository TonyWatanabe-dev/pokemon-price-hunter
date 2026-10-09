// Preço Copag, anomalia e STORE_SCORE. A nota de oportunidade é só a oficial (Opportunity Engine, src/core/).
import { evaluateReference, fromRobotEntry } from './copag-policy.js';

/**
 * Preço Copag de UMA entrada (product.copag), pela política única (src/copag-policy.js): fonte oficial da Copag,
 * valor > 0 e verificada há no máximo 30 dias em relação a opts.now (padrão: agora). Fora disso, só referência.
 * opts.origin: 'catalog' (cadastro do catalog.json) | 'captura' (loja oficial, data/copag-msrp.json).
 */
export function copagStatus(product, { now = new Date(), origin = product?.copag?.origin || 'catalog' } = {}) {
  const d = evaluateReference(fromRobotEntry(product?.copag || {}, origin), { now, productId: product?.id || null });
  return d.confirmed ? { confirmed: true, msrp: d.msrp, source: 'OFICIAL', status: d.status, verifiedAt: d.verifiedAt }
    : { confirmed: false, reason: d.reason, status: d.status, ...(d.reference != null ? { reference: d.reference, referenceUrl: d.referenceUrl } : {}) };
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

// Preço anormal: desconto Copag > 45% ou < 55% da média monitorada. Vai para investigação, nunca para o ranking.
export function isAnomalous(price, msrp, marketAvg) {
  if (msrp && price < msrp * 0.55) return true;
  if (marketAvg && price < marketAvg * 0.55) return true;
  // Três vezes acima da referência quase sempre é anúncio casado errado (ex.: box anunciada como blister).
  if (msrp && price > msrp * 3) return true;
  if (marketAvg && price > marketAvg * 3) return true;
  return false;
}
