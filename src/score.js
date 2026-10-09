// Preço Copag, anomalia e STORE_SCORE. A nota de oportunidade é só a oficial (Opportunity Engine, src/core/).
const MARKETPLACE_HOSTS = /(mercadolivre|mercadolibre|amazon|shopee|magazineluiza|magalu|americanas|casasbahia|pontofrio|extra\.com|carrefour|kabum|aliexpress|submarino|buscape|zoom\.com)/i;

export function copagStatus(product) {
  const c = product.copag || {};
  if (!(c.msrp > 0)) return { confirmed: false, reason: 'sem valor' };
  if (!c.source_url) return { confirmed: false, reason: 'sem fonte' };
  if (MARKETPLACE_HOSTS.test(c.source_url)) return { confirmed: false, reason: 'fonte é marketplace (não aceita como MSRP)' };
  // Só vale preço verificável na fonte oficial (loja oficial Copag ou página oficial cadastrada à mão).
  // Catálogo divulgado por terceiros fica como referência, sem calcular desconto nem disparar alerta.
  if (c.confidence === 'CATALOGO_COPAG') return { confirmed: false, reason: 'preço do catálogo Copag divulgado por terceiros, sem fonte oficial verificável', reference: c.msrp, referenceUrl: c.source_url };
  if (c.confidence !== 'OFICIAL') return { confirmed: false, reason: 'fonte não marcada como oficial' };
  return { confirmed: true, msrp: c.msrp, source: c.confidence };
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
