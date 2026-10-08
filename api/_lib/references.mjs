// Referências de preço — modelo da Fase 5.6. Funções puras.
// Duas perguntas que NUNCA se confundem:
//   1) referência ATUAL: "qual a melhor referência para avaliar o preço de hoje?"  → COPAG_OFFICIAL_CURRENT, depois MARKET_CURRENT
//   2) CONTEXTO histórico: "quanto era sugerido/observado em tal momento?"         → COPAG_OFFICIAL_HISTORICAL, MARKET_HISTORICAL
// COMMUNITY_REFERENCE (tabela divulgada por lojas, redes sociais...) é guardada, mas não é oficial e não é referência atual.
// "NONE" não é linha no banco: é a ausência de referência atual (current = null). Preço histórico nunca vira atual,
// nem corrigido por inflação/câmbio — isso seria estimativa, e estimativa não é preço oficial.

export const KINDS = ['COPAG_OFFICIAL_CURRENT', 'COPAG_OFFICIAL_HISTORICAL', 'MARKET_CURRENT', 'MARKET_HISTORICAL', 'COMMUNITY_REFERENCE'];
export const SCOPE = { COPAG_OFFICIAL_CURRENT: 'current', MARKET_CURRENT: 'current', COPAG_OFFICIAL_HISTORICAL: 'historical', MARKET_HISTORICAL: 'historical', COMMUNITY_REFERENCE: 'community' };
/** prioridade para a referência ATUAL (menor = melhor). Só tipos atuais têm prioridade. */
export const CURRENT_PRIORITY = { COPAG_OFFICIAL_CURRENT: 1, MARKET_CURRENT: 2 };
export const LABEL = {
  COPAG_OFFICIAL_CURRENT: 'Preço sugerido Copag', COPAG_OFFICIAL_HISTORICAL: 'Preço sugerido de lançamento',
  MARKET_CURRENT: 'Referência de mercado atual', MARKET_HISTORICAL: 'Histórico de mercado', COMMUNITY_REFERENCE: 'Referência não oficial',
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
