-- Consultas de busca: ofertas de um produto (API v1 /produtos/:id/ofertas, com ou sem ofertas=todas) e a base do estado
-- (status active/pending) filtram por product_id + status. O índice parcial offer_product_idx só cobre 'active',
-- então ofertas 'pending' ou de qualquer status caíam em varredura. Índice completo e idempotente.
SET search_path = hunter;
CREATE INDEX IF NOT EXISTS offer_product_status_idx ON offer (product_id, status);
