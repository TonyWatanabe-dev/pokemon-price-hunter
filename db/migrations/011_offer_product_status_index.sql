-- Consultas de busca: ofertas de um produto (API v1 /produtos/:id/ofertas, com ou sem ofertas=todas) e a base do estado
-- (status active/pending) filtram por product_id + status. O índice parcial offer_product_idx só cobre 'active',
-- então ofertas 'pending' ou de qualquer status caíam em varredura. Índice completo e idempotente.
-- Número 011: o 010 está reservado pela 010_reference_evidence.sql da PR #20 (já aplicada em produção, fora da main).
-- Sem CONCURRENTLY: tools/db-migrate.mjs roda cada arquivo dentro de uma transação, e CREATE INDEX CONCURRENTLY
-- não pode rodar em transação. O CREATE INDEX comum bloqueia escritas em offer (SHARE lock) enquanto o índice é
-- construído; leituras continuam. Em banco com muitas ofertas, criar antes, fora do horário de coleta, com
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS offer_product_status_idx ON hunter.offer (product_id, status);
-- o IF NOT EXISTS abaixo torna esta migration um no-op nesse caso.
SET search_path = hunter;
CREATE INDEX IF NOT EXISTS offer_product_status_idx ON offer (product_id, status);
