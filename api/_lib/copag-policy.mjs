// Política ÚNICA do preço sugerido Copag (Lote 5). Funções puras, usadas pelo robô (src/copag-policy.js reexporta este
// arquivo, como src/core/references.js faz com references.mjs) e pela API (api/_lib/read-db.mjs). A Vercel só publica
// api/ e o site; src/ não vai para a função — por isso a implementação mora aqui.
//
// "Copag confirmado" (copagConfirmed / msrp) só quando TODAS valem:
//   1. valor > 0;
//   2. fonte oficial da Copag: URL em copagloja.com.br ou copag.com.br (e subdomínios), marcada como oficial
//      (robô: confidence 'OFICIAL' — captura da loja oficial ou cadastro manual; banco: linha 'verified' de copag_loja/manual);
//   3. última verificação há no máximo VALIDADE_DIAS (30) dias em relação ao momento da rodada/consulta.
// Fora disso o valor fica só como referência (copagReference), com estado 'pendente' ou 'expirado' — nunca confirmado
// por palpite. Produtos em PENDENTES ficam pendentes por decisão do responsável (ver pendingReason).

export const VALIDADE_DIAS = 30;
const DAY = 864e5;
const FUTURO_TOLERADO = DAY;   // relógio adiantado/fuso: até 1 dia no futuro conta como "agora"

// Pendentes por decisão do responsável: a captura automática (loja oficial / catálogo público da loja) NÃO confirma.
// Só um cadastro manual no config/catalog.json com URL oficial da Copag fora da loja (copag.com.br) — que o banco grava
// como source 'manual' — ou a retirada do produto desta lista libera o preço.
export const PENDENTES = Object.freeze({
  'me04-box36': 'pendente por decisão do responsável (página esgotada sem preço e EAN divergente na própria Copag)',
});

const COPAG_HOST = /(^|\.)copag(loja)?\.com\.br$/i;
const LOJA_HOST = /(^|\.)copagloja\.com\.br$/i;
const MARKETPLACE_HOSTS = /(mercadolivre|mercadolibre|amazon|shopee|magazineluiza|magalu|americanas|casasbahia|pontofrio|extra\.com|carrefour|kabum|aliexpress|submarino|buscape|zoom\.com)/i;
const hostOf = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.hostname : null; } catch { return null; } };
export const isCopagUrl = (u) => COPAG_HOST.test(hostOf(u) || '');
export const isCopagStoreUrl = (u) => LOJA_HOST.test(hostOf(u) || '');
export const isMarketplaceUrl = (u) => MARKETPLACE_HOSTS.test(String(u || ''));

const ms = (v) => { if (v == null || v === '') return null; const t = Date.parse(v); return Number.isFinite(t) ? t : null; };

/** Última verificação da fonte (ISO) entre os carimbos conhecidos; null quando não há nenhum válido. */
export function lastVerifiedAt(e = {}) {
  const ts = [e.verified_at, e.source_timestamp, e.msrp_updated_at, e.last_check?.matches === true ? e.last_check.at : null].map(ms).filter((t) => t != null);
  return ts.length ? new Date(Math.max(...ts)).toISOString() : null;
}

/**
 * Avalia UMA referência normalizada: { value, source_url, official, verifiedAt, automatic }.
 *  official: marcada como oficial na origem · automatic: captura automática (loja oficial/catálogo público), sem decisão humana.
 * Devolve { status: 'confirmado'|'pendente'|'expirado'|'sem_referencia', confirmed, msrp, reference, referenceUrl, reason, verifiedAt, ageDays }.
 */
export function evaluateReference(ref, { now = new Date(), productId = null } = {}) {
  const value = Number(ref?.value);
  const url = ref?.source_url || null;
  const verifiedAt = ref?.verifiedAt || null;
  const nowMs = now instanceof Date ? now.getTime() : ms(now);
  const out = (status, reason, extra = {}) => ({ status, confirmed: status === 'confirmado', msrp: status === 'confirmado' ? value : null,
    reference: status === 'pendente' || status === 'expirado' ? value : null, referenceUrl: status === 'pendente' || status === 'expirado' ? url : null,
    reason, verifiedAt, ageDays: null, ...extra });
  if (!(value > 0)) return out('sem_referencia', 'sem valor');
  // marketplace nunca é evidência de preço Copag: nem confirmado nem referência
  if (url && isMarketplaceUrl(url)) return { ...out('sem_referencia', 'fonte é marketplace (não aceita como MSRP)'), reference: null };
  if (!url) return out('pendente', 'sem fonte');
  if (!isCopagUrl(url)) return out('pendente', 'fonte fora do domínio oficial da Copag (copagloja.com.br / copag.com.br)');
  // pendente por decisão vem antes da marcação oficial: no banco a referência pendente perde a marcação, e o motivo
  // mostrado precisa ser o mesmo no robô e na API
  if (productId && PENDENTES[productId] && ref.automatic) return out('pendente', PENDENTES[productId]);
  if (!ref.official) return out('pendente', 'fonte não marcada como oficial');
  const t = ms(verifiedAt);
  if (t == null) return out('pendente', 'sem data da última verificação');
  if (!Number.isFinite(nowMs)) return out('pendente', 'sem data da rodada');
  if (t - nowMs > FUTURO_TOLERADO) return out('pendente', 'data da verificação no futuro');
  const age = Math.max(0, nowMs - t);
  const ageDays = Math.round((age / DAY) * 100) / 100;
  if (age > VALIDADE_DIAS * DAY) return out('expirado', `última verificação há mais de ${VALIDADE_DIAS} dias`, { ageDays });
  return out('confirmado', null, { ageDays });
}

// ------------------------------------------------------------------ robô (catalog.json / data/copag-msrp.json)
/** Normaliza uma entrada do robô (cadastro do catalog.json ou captura da loja oficial). origin: 'catalog' | 'captura'. */
export function fromRobotEntry(e, origin = 'catalog') {
  return { value: e?.msrp, source_url: e?.source_url || null, official: e?.confidence === 'OFICIAL',
    verifiedAt: lastVerifiedAt(e || {}),
    // a captura é automática; no banco, o robô grava cadastro com URL da loja como copag_loja (indistinguível da captura),
    // então cadastro com URL da loja também conta como automático — robô e API decidem igual
    automatic: origin === 'captura' || isCopagStoreUrl(e?.source_url) };
}

// ------------------------------------------------------------------ banco (hunter.reference_price)
// Fontes que o robô publica (as mesmas do site de hoje). Auditoria (copag_loja_catalog, copag_blog) e mercado ficam fora
// até a decisão da referência no motor (ver docs/copag-referencia.md).
export const DB_SOURCES = ['copag_loja', 'manual', 'internet'];
const DB_OFFICIAL = new Set(['copag_loja', 'manual']);
/** Normaliza uma linha de reference_price (value, source, source_url, verification_status, verified_at). */
export function fromDbRow(r) {
  return { value: r?.value, source_url: r?.source_url || null,
    official: r?.verification_status === 'verified' && DB_OFFICIAL.has(r?.source),
    verifiedAt: lastVerifiedAt({ verified_at: r?.verified_at }),
    automatic: r?.source !== 'manual' };
}

/**
 * Decide o preço Copag de um produto a partir de candidatos normalizados, na ordem de preferência.
 * O primeiro confirmado vence. Sem confirmado: o primeiro 'expirado' (fonte oficial vencida) e, sem ele, o primeiro
 * 'pendente' viram referência. Devolve evaluateReference + { index } (posição do candidato escolhido, -1 sem nenhum).
 */
export function decideCopag(candidates, { now = new Date(), productId = null } = {}) {
  const ev = (candidates || []).map((c) => evaluateReference(c, { now, productId }));
  for (const st of ['confirmado', 'expirado', 'pendente']) {
    const i = ev.findIndex((x) => x.status === st);
    if (i >= 0) return { ...ev[i], index: i };
  }
  const i = ev.findIndex((x) => x.reason); // sem referência: mantém o motivo do primeiro candidato
  return i >= 0 ? { ...ev[i], index: -1 } : { ...evaluateReference(null), index: -1 };
}

const DB_ORDER = { manual: 0, copag_loja: 1, internet: 2 };
/** API: linhas do banco de um produto → mesma decisão do robô. Ordem: manual > copag_loja > internet, verificação mais recente, id. */
export function decideCopagFromRows(rows, opts = {}) {
  const list = (rows || []).filter((r) => DB_SOURCES.includes(r?.source) && ['verified', 'pending'].includes(r?.verification_status) && r?.reference_scope !== 'historical')
    .sort((a, b) => (DB_ORDER[a.source] - DB_ORDER[b.source]) || ((ms(b.verified_at) ?? -Infinity) - (ms(a.verified_at) ?? -Infinity)) || Number(b.id ?? 0) - Number(a.id ?? 0));
  const d = decideCopag(list.map(fromDbRow), opts);
  return { ...d, row: d.index >= 0 ? list[d.index] : null };
}

/** Campos do produto (state.json / home da API) a partir de uma decisão. */
export function productCopagFields(d) {
  return { copagConfirmed: !!d.confirmed, msrp: d.confirmed ? d.msrp : null, copagReason: d.confirmed ? null : d.reason,
    copagReference: d.reference ?? null, copagReferenceUrl: d.referenceUrl ?? null,
    copagReferenceStatus: d.status === 'sem_referencia' ? null : d.status, copagVerifiedAt: d.verifiedAt ?? null };
}
