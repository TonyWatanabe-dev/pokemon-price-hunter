-- Resolução estruturada da decisão humana (ex.: produto do catálogo que um anúncio é). Só a fila de
-- revisão usa; o matching recebe isso apenas via config/matching-overrides.json (tools/review.mjs export).
SET search_path = hunter;
ALTER TABLE review_item ADD COLUMN IF NOT EXISTS resolution jsonb;
