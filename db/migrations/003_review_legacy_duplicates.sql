-- Decisão do dono do projeto (08/10/2026): os 7 produtos com código de coleção antigo (ev09) são duplicatas
-- legadas de produtos que já existem na coleção atual (sv9). Rejeitados na fila de revisão, sem apagar nada.
-- Auditoria: motivo na própria linha (decision_reason) + um system_event por decisão.
-- Idempotente: se o item ainda não existir (banco novo), já nasce rejeitado e a sincronização não o reabre
-- (ela usa ON CONFLICT (dedupe_key) DO NOTHING).
SET search_path = hunter;

ALTER TABLE review_item ADD COLUMN IF NOT EXISTS decision_reason text;
ALTER TABLE review_item ADD COLUMN IF NOT EXISTS decided_by_label text;   -- quem decidiu, enquanto não há app_user

WITH ids(entity_id) AS (VALUES
  ('ev09-blister1'), ('ev09-blister3'), ('ev09-blister4'), ('ev09-booster'),
  ('ev09-combo'), ('ev09-etb'), ('ev09-colecao_ex-bellibolt')
),
before AS (
  SELECT r.dedupe_key, r.status FROM review_item r JOIN ids ON r.dedupe_key = 'dup:' || ids.entity_id
),
up AS (
  INSERT INTO review_item (category, entity_type, entity_id, proposal, confidence, status, dedupe_key, decided_at, decision_reason, decided_by_label)
  SELECT 'duplicate_product', 'legacy_product', entity_id,
         jsonb_build_object('reason', 'código de coleção antigo; já existe o produto na coleção atual', 'collection_code', 'ev09', 'current_collection', 'sv9'),
         90, 'rejected', 'dup:' || entity_id, now(),
         'duplicate legacy: coleção antiga (ev09); o produto já existe na coleção atual (sv9). Registro mantido, não importado.',
         'owner (aprovação de 08/10/2026)'
  FROM ids
  ON CONFLICT (dedupe_key) DO UPDATE SET status = 'rejected', decided_at = EXCLUDED.decided_at,
    decision_reason = EXCLUDED.decision_reason, decided_by_label = EXCLUDED.decided_by_label
  WHERE review_item.status = 'open'
  RETURNING id, entity_id, dedupe_key, decision_reason, decided_by_label
)
INSERT INTO system_event (type, entity_type, entity_id, payload)
SELECT 'REVIEW_DECIDED', 'review_item', up.id::text,
       jsonb_build_object('category', 'duplicate_product', 'legacy_product', up.entity_id,
                          'from_status', coalesce(b.status, '(novo)'), 'to_status', 'rejected',
                          'reason', up.decision_reason, 'decided_by', up.decided_by_label, 'source', 'migration 003')
FROM up LEFT JOIN before b ON b.dedupe_key = up.dedupe_key;
