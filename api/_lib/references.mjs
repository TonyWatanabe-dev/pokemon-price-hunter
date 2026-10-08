// Referências de preço — modelo da Fase 5.6. Funções puras.
// Duas perguntas que NUNCA se confundem:
//   1) referência ATUAL: "qual a melhor referência para avaliar o preço de hoje?"  → COPAG_OFFICIAL_CURRENT, depois MARKET_CURRENT
//   2) CONTEXTO histórico: "quanto era sugerido/observado em tal momento?"         → COPAG_OFFICIAL_HISTORICAL, MARKET_HISTORICAL
// COMMUNITY_REFERENCE (tabela divulgada por lojas, redes sociais...) é guardada, mas não é oficial e não é referência atual.
// "NONE" não é linha no banco: é a ausência de referência atual (kind 'NONE', preço nulo). Preço histórico nunca vira atual,
// nem corrigido por inflação/câmbio — isso seria estimativa, e estimativa não é preço oficial.

export const KINDS = ['COPAG_OFFICIAL_CURRENT', 'COPAG_OFFICIAL_HISTORICAL', 'MARKET_CURRENT', 'MARKET_HISTORICAL', 'COMMUNITY_REFERENCE'];
export const SCOPE = { COPAG_OFFICIAL_CURRENT: 'current', MARKET_CURRENT: 'current', COPAG_OFFICIAL_HISTORICAL: 'historical', MARKET_HISTORICAL: 'historical', COMMUNITY_REFERENCE: 'community' };
/** prioridade para a referência ATUAL (menor = melhor). Só tipos atuais têm prioridade. */
export const CURRENT_PRIORITY = { COPAG_OFFICIAL_CURRENT: 1, MARKET_CURRENT: 2 };
export const LABEL = {
  COPAG_OFFICIAL_CURRENT: 'Preço sugerido Copag', COPAG_OFFICIAL_HISTORICAL: 'Preço sugerido de lançamento',
  MARKET_CURRENT: 'Referência de mercado', MARKET_HISTORICAL: 'Histórico de mercado', COMMUNITY_REFERENCE: 'Referência comunitária',
};
/** escala de confiança (0–100) usada na importação da auditoria; não é reajustada depois */
export const CONFIDENCE = { alta: 90, 'média': 60, baixa: 30 };
export const confidenceLabel = (n) => (n == null ? null : n >= 85 ? 'alta' : n >= 50 ? 'média' : 'baixa');
const PARTIAL_DATE = /^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/;   // AAAA, AAAA-MM ou AAAA-MM-DD: sem inventar dia
export const isPartialDate = (s) => s == null || PARTIAL_DATE.test(String(s));
const COPAG_HOST = /(^|\.)copag(loja)?\.com\.br$/i;
export const isCopagUrl = (u) => { try { return COPAG_HOST.test(new URL(u).hostname); } catch { return false; } };

/** tipo de uma referência vinda do robô (catalog.json): só é Copag oficial se a fonte for domínio da Copag */
export function robotReferenceKind({ source_url }) {
  return isCopagUrl(source_url) ? 'COPAG_OFFICIAL_CURRENT' : 'COMMUNITY_REFERENCE';
}

const t = (v) => (v ? new Date(v).getTime() : -Infinity);
/** Melhor referência ATUAL entre as linhas de um produto (mesma regra da view reference_price_current).
 *  Só tipos atuais e verificados. Desempate: prioridade do tipo, confiança, verificação mais recente, id. Sem nenhuma → null (NONE). */
export function pickCurrentReference(rows) {
  const ok = (rows || []).filter((r) => CURRENT_PRIORITY[r.reference_kind] && r.verification_status === 'verified' && Number(r.value) > 0);
  ok.sort((a, b) => CURRENT_PRIORITY[a.reference_kind] - CURRENT_PRIORITY[b.reference_kind] || (b.confidence ?? 0) - (a.confidence ?? 0)
    || t(b.verified_at) - t(a.verified_at) || Number(b.id ?? 0) - Number(a.id ?? 0));
  return ok[0] || null;
}
/** Contexto histórico: só tipos históricos, do mais recente para o mais antigo (pela publicação, depois observação). */
export function historicalContext(rows) {
  return (rows || []).filter((r) => SCOPE[r.reference_kind] === 'historical')
    .sort((a, b) => String(b.published_at ?? '').localeCompare(String(a.published_at ?? '')) || t(b.observed_at) - t(a.observed_at));
}

/** Validação de uma entrada do arquivo de importação. Devolve lista de problemas (vazia = ok). */
export function validateImportEntry(e, { excluded = [] } = {}) {
  const bad = [];
  if (!e || typeof e !== 'object') return ['entrada inválida'];
  if (!e.legacy_id) bad.push('sem produto');
  if (excluded.includes(e.legacy_id)) bad.push('produto na lista de exclusão (match ambíguo)');
  if (!KINDS.includes(e.reference_kind)) bad.push(`tipo inválido: ${e.reference_kind}`);
  if (!(Number(e.value) > 0)) bad.push('preço inválido');
  if (!e.source) bad.push('sem fonte');
  if (!e.source_url) bad.push('sem URL');
  if ((e.reference_kind || '').startsWith('COPAG_OFFICIAL') && !isCopagUrl(e.source_url)) bad.push('Copag oficial fora do domínio Copag');
  if (!isPartialDate(e.published_at)) bad.push(`published_at inválida: ${e.published_at}`);
  if (!isPartialDate(e.effective_date)) bad.push(`effective_date inválida: ${e.effective_date}`);
  if (!e.observed_at || Number.isNaN(Date.parse(e.observed_at))) bad.push('sem observed_at');
  if (!['verified', 'pending'].includes(e.verification_status)) bad.push(`status inválido: ${e.verification_status}`);
  if (e.verification_status === 'verified' && !e.verified_at) bad.push('verificada sem verified_at');
  if (!(e.confidence >= 0 && e.confidence <= 100)) bad.push('confiança fora de 0–100');
  if (!e.evidence_text) bad.push('sem evidência');
  return bad;
}

// ================================================================ Fase 6A — política de referência ATUAL
// CURRENT_REFERENCE = Copag oficial atual verificada > mercado atual ROBUSTO > NONE. Histórico e comunitária nunca entram.
export const NONE = 'NONE';
export const CURRENT_KINDS = ['COPAG_OFFICIAL_CURRENT', 'MARKET_CURRENT'];
/** Critério conservador do mercado atual (documentado no relatório da 6A). */
export const MARKET_RULE = { minOffers: 3, minStores: 2, maxAnomalyShare: 1 / 3 };
const med = (xs) => { const a = [...xs].sort((x, y) => x - y); const n = a.length; if (!n) return null;
  const m = n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2; return Math.round(m * 100) / 100; };

/**
 * Mercado atual robusto. Entrada: as ofertas que o Price Engine já considera ELEGÍVEIS e EM ESTOQUE (ativas, preço confirmado,
 * mesma condição, preço plausível) + quantas ofertas em estoque foram descartadas como implausíveis.
 * Regra: ≥ 3 ofertas de lojas confiáveis (fora da janela de desconfiança), em ≥ 2 lojas, e anomalias ≤ 1/3 das ofertas em estoque.
 * Preço = MEDIANA (não média, não menor preço). Sem isso → null (não força referência).
 * Confiança (informativa, não entra no score): 0,60 no mínimo do critério; +0,05 por oferta além de 3 (até +0,15);
 * +0,05 por loja além de 2 (até +0,10). Máximo 0,85 — sempre abaixo da Copag oficial verificada.
 */
export function marketReferenceOf(offers, { implausibleInStock = 0, isTrusted = () => true } = {}) {
  const sample = (offers || []).filter((o) => Number(o.price) > 0 && isTrusted(o));
  const untrusted = (offers || []).length - sample.length;
  const stores = new Set(sample.map((o) => o.store_id).filter(Boolean)).size;
  const marketplaces = new Set(sample.map((o) => o.marketplace_id).filter(Boolean)).size;
  const base = { offers: sample.length, stores, marketplaces, untrusted, implausible: implausibleInStock };
  if (sample.length < MARKET_RULE.minOffers) return { ok: false, reason: 'insufficient_offers', ...base };
  if (stores < MARKET_RULE.minStores) return { ok: false, reason: 'single_store', ...base };
  if (implausibleInStock / (sample.length + implausibleInStock) > MARKET_RULE.maxAnomalyShare) return { ok: false, reason: 'too_many_anomalies', ...base };
  const confidence = Math.round((0.6 + Math.min(0.15, 0.05 * (sample.length - 3)) + Math.min(0.1, 0.05 * (stores - 2))) * 1000) / 1000;
  return { ok: true, price: med(sample.map((o) => Number(o.price))), confidence, reason: 'robust_current_market', ...base };
}

/**
 * Referência ATUAL de um produto. copag: linha atual verificada (reference_price_current) ou null; market: saída de marketReferenceOf.
 * Retorna { kind, price, source, confidence (0–1), reason, verified_at }. Nunca devolve preço histórico ou comunitário.
 */
export function resolveCurrentReference({ copag = null, market = null } = {}) {
  if (copag && copag.reference_kind === 'COPAG_OFFICIAL_CURRENT' && copag.verification_status === 'verified' && Number(copag.value) > 0)
    return { kind: 'COPAG_OFFICIAL_CURRENT', price: Math.round(Number(copag.value) * 100) / 100, source: copag.source || 'copag',
      confidence: copag.confidence != null ? Number(copag.confidence) / 100 : null, reason: 'verified_current_copag', verified_at: copag.verified_at ?? null };
  if (market?.ok && Number(market.price) > 0)
    return { kind: 'MARKET_CURRENT', price: market.price, source: 'market', confidence: market.confidence, reason: 'robust_current_market', verified_at: null };
  return { kind: NONE, price: null, source: null, confidence: null, reason: market?.reason ? `no_copag_${market.reason}` : 'no_current_reference', verified_at: null };
}

// ---------------------------------------------------------------- formato público (API)
const hostPath = (u) => { try { const x = new URL(u); return (x.hostname.replace(/^www\./, '') + x.pathname).replace(/\/$/, ''); } catch { return null; } };
const conf01 = (c) => (c == null ? null : Number(c) > 1 ? Math.round(Number(c)) / 100 : Number(c));
/** referência atual no contrato da API: { kind, label, price, source, confidence, reason } (NONE com tudo nulo) */
export function currentReferenceView(r) {
  if (!r || !r.kind || r.kind === NONE) return { kind: NONE, label: null, price: null, source: null, confidence: null, reason: r?.reason ?? 'no_current_reference' };
  return { kind: r.kind, label: LABEL[r.kind], price: r.price != null ? Number(r.price) : null, source: r.kind === 'MARKET_CURRENT' ? 'market' : 'Copag',
    confidence: conf01(r.confidence), reason: r.reason ?? null };
}
/** linha de reference_price → contexto (histórico/comunitário) no contrato da API */
export function contextReferenceView(row) {
  const k = row.reference_kind;
  return { kind: k, label: LABEL[k] ?? null, price: row.value != null ? Number(row.value) : null,
    source: k.startsWith('COPAG_OFFICIAL') ? 'Copag' : k === 'COMMUNITY_REFERENCE' ? hostPath(row.source_url) : row.source ?? null,
    url: row.source_url ?? null, published_at: row.published_at ?? null, effective_date: row.effective_date ?? null,
    confidence: conf01(row.confidence), status: row.verification_status ?? null };
}
