// Contrato de evidência das decisões dos agentes (issue #91). Toda proposta que um agente (regra hoje,
// IA no futuro) manda para revisão humana carrega um bloco `evidence` que diz DE ONDE veio a decisão,
// QUANDO o dado foi lido e POR QUÊ. Puro e determinístico: não lê rede, banco nem relógio por conta própria.
//
// Campos:
//   source      de onde o agente leu (ex.: 'state.unmatched', 'state.offers')                 obrigatório
//   url         página http(s) que sustenta a decisão                                           obrigatório
//   reason      motivo legível da decisão                                                       obrigatório
//   basis       'observado' (lido no anúncio) ou 'inferido' (deduzido pelo matching)            obrigatório
//   observedAt  horário ISO da leitura que gerou a decisão; nunca inventado: se a fonte não tem,
//               fica null e a evidência é rotulada 'incompleta'
//   status      'completa' | 'incompleta' (calculado aqui, nunca vindo de fora)
//   missing     campos que faltaram ou foram descartados por serem inválidos
//
// Regra: sem source, url ou reason válidos, ou com basis desconhecido, a decisão é RECUSADA (não vira
// proposta). Horário ausente, ilegível ou no futuro não é corrigido nem substituído: vira null e a
// evidência sai rotulada 'incompleta', para o revisor saber que não há horário confiável.

export const EVIDENCE_BASIS = Object.freeze(['observado', 'inferido']);
export const EVIDENCE_STATUS = Object.freeze(['completa', 'incompleta']);
const FUTURE_TOLERANCE_MS = 5 * 60_000; // relógios de máquinas diferentes; além disso é dado errado

const text = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const httpUrl = (v) => {
  if (typeof v !== 'string' || v.length > 2000) return null;
  try { const u = new URL(v); return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null; } catch { return null; }
};
const isoTime = (v, nowMs) => {
  if (typeof v !== 'string') return null;
  const t = Date.parse(v);
  if (!Number.isFinite(t)) return null;
  if (Number.isFinite(nowMs) && t > nowMs + FUTURE_TOLERANCE_MS) return null;
  return new Date(t).toISOString();
};

/**
 * Monta e valida a evidência de uma decisão.
 * @returns {{ ok: true, evidence: object } | { ok: false, error: string, missing: string[] }}
 */
export function buildEvidence({ source, url, reason, basis, observedAt } = {}, { now = Date.now() } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const ev = { source: text(source, 100), url: httpUrl(url), reason: text(reason, 200), basis: EVIDENCE_BASIS.includes(basis) ? basis : null, observedAt: isoTime(observedAt, nowMs) };
  const missing = ['source', 'url', 'reason', 'basis', 'observedAt'].filter((k) => ev[k] == null);
  const fatal = missing.filter((k) => k !== 'observedAt');
  if (fatal.length) return { ok: false, error: `decisão sem evidência válida: falta ${fatal.join(', ')}`, missing };
  return { ok: true, evidence: { ...ev, status: missing.length ? 'incompleta' : 'completa', missing } };
}

/**
 * Confere um bloco `evidence` já pronto (ex.: lido de um review_item ou vindo de outro agente).
 * Não confia no `status` recebido: recalcula. Devolve null se válido e coerente, ou a mensagem de erro.
 */
export function validateEvidence(ev, { now = Date.now() } = {}) {
  if (ev === null || typeof ev !== 'object' || Array.isArray(ev)) return 'evidência ausente';
  const r = buildEvidence(ev, { now });
  if (!r.ok) return r.error;
  if (ev.observedAt != null && r.evidence.observedAt == null) return 'observedAt inválido ou no futuro';
  if (ev.status !== r.evidence.status) return `status de evidência incoerente: ${ev.status} (esperado ${r.evidence.status})`;
  return null;
}
