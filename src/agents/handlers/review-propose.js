// Handler seguro de referência: transforma uma proposta (de regra ou, no futuro, de um agente de IA)
// em item da fila de revisão humana (review_item, status 'open'). Não toca em preço, oferta,
// referência, score nem oportunidade. Idempotente por dedupe_key: repetir após timeout ou queda
// não cria segundo item.

export const REVIEW_CATEGORIES = ['matching', 'reference_conflict', 'price_anomaly', 'store_blocked', 'duplicate_product', 'affiliate_missing', 'crawler_broken'];
const MAX_PROPOSAL_BYTES = 8 * 1024;
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const shortStr = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;

export function validateReviewProposal(p) {
  if (!isPlainObject(p)) return 'payload deve ser objeto';
  if (!REVIEW_CATEGORIES.includes(p.category)) return `categoria desconhecida: ${p.category}`;
  if (!shortStr(p.dedupeKey, 200)) return 'dedupeKey obrigatória (até 200 caracteres)';
  if (p.entityType != null && !shortStr(p.entityType, 100)) return 'entityType inválido';
  if (p.entityId != null && !shortStr(String(p.entityId), 100)) return 'entityId inválido';
  if (p.confidence != null && !(Number.isInteger(p.confidence) && p.confidence >= 0 && p.confidence <= 100)) return 'confidence deve ser inteiro 0–100';
  if (!isPlainObject(p.proposal)) return 'proposal deve ser objeto';
  if (Buffer.byteLength(JSON.stringify(p.proposal)) > MAX_PROPOSAL_BYTES) return `proposal acima de ${MAX_PROPOSAL_BYTES} bytes`;
  return null;
}

export function reviewProposeHandler({ sink, timeoutMs = 5_000 }) {
  if (!sink?.propose) throw new Error('sink obrigatório');
  return {
    type: 'review.propose',
    ai: false,
    timeoutMs,
    validate: validateReviewProposal,
    async run(p, { signal, job }) {
      if (signal.aborted) throw new Error('cancelado antes de gravar');
      const item = {
        category: p.category, entityType: p.entityType ?? null, entityId: p.entityId == null ? null : String(p.entityId),
        confidence: p.confidence ?? null, dedupeKey: p.dedupeKey,
        proposal: { ...p.proposal, _source: { jobId: String(job.id), jobType: job.type } },
      };
      const { id, created } = await sink.propose(item, { signal });
      return { reviewItemId: String(id), created };
    },
  };
}

export function memoryReviewSink() {
  const items = [];
  return {
    items,
    async propose(item) {
      const found = items.find((i) => i.dedupeKey === item.dedupeKey);
      if (found) return { id: found.id, created: false };
      const row = { id: items.length + 1, status: 'open', ...structuredClone(item) };
      items.push(row);
      return { id: row.id, created: true };
    },
  };
}

export function pgReviewSink(db) {
  return {
    async propose(i) {
      const ins = await db.query(
        `INSERT INTO review_item (category, entity_type, entity_id, proposal, confidence, dedupe_key)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6) ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
        [i.category, i.entityType, i.entityId, JSON.stringify(i.proposal), i.confidence, i.dedupeKey]);
      if (ins.rows[0]) return { id: ins.rows[0].id, created: true };
      const { rows } = await db.query('SELECT id FROM review_item WHERE dedupe_key = $1', [i.dedupeKey]);
      return { id: rows[0].id, created: false };
    },
  };
}
