-- Rollback da migration 011 (índice offer_product_status_idx). NÃO fica em db/migrations/: nunca roda sozinho.
-- Uso manual, só com decisão humana e fora do horário da coleta:
--   1) psql "$DATABASE_URL" -f db/rollback/011_offer_product_status_index.down.sql
--   2) DELETE FROM hunter.schema_migrations WHERE version = '011_offer_product_status_index.sql';
--      (sem o passo 2 o db-migrate considera a 011 aplicada e NÃO recria o índice; com ele, a próxima coleta recria)
-- Efeito: só remove o índice (nenhum dado é alterado). Consultas por produto+status ficam mais lentas.
SET search_path = hunter;
DROP INDEX IF EXISTS offer_product_status_idx;
