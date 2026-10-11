-- ROLLBACK da migration 010_reference_evidence.sql — NÃO é migration: fica fora de db/migrations/ de propósito,
-- para tools/db-migrate.mjs (e o passo db-migrate do hunter.yml) nunca o aplicar sozinho.
--
-- O que faz: recria hunter.reference_price_current EXATAMENTE como está na main antes da 010 — o corpo da
-- migration 006_reference_kinds.sql (a 007, 008 e 009 não tocam nessa view) — e remove o COMMENT que a 010 adiciona
-- (antes da 010 a view não tinha comentário). Nenhuma linha é apagada ou alterada; mesmas colunas, mesma ordem
-- (r.*, priority), por isso CREATE OR REPLACE basta. Pode ser reaplicado.
--
-- Como aplicar (só com autorização explícita para mexer no banco de produção):
--   1. antes: SELECT pg_get_viewdef('hunter.reference_price_current'::regclass, true);   -- guardar a saída
--   2. psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f db/rollback/010_reference_evidence.down.sql
--   3. conferir: pg_get_viewdef igual ao de um banco só com 001..009 (o teste test/reference-evidence-db-tests.js compara).
--
-- ATENÇÃO — schema_migrations: este arquivo NÃO apaga o registro da 010. Enquanto a linha
-- '010_reference_evidence.sql' existir em hunter.schema_migrations, o migrador considera a 010 aplicada e não a roda
-- de novo (a view fica na versão da 006). Escolha UM caminho e registre a decisão:
--   (a) reaplicar a 010 mais tarde, como está: rode, na mesma janela,
--         DELETE FROM hunter.schema_migrations WHERE version = '010_reference_evidence.sql';
--       e a próxima rodada do hunter.yml (passo db-migrate) aplica a 010 outra vez;
--   (b) desistir da 010 ou mudar a regra: NÃO apague o registro; crie uma migration nova (011+/próximo número livre)
--       com a view desejada — migrations aplicadas não são editadas.
-- Sem nenhum dos dois, a main e o banco ficam divergentes (o arquivo 010 existe, mas a view é a da 006).
SET search_path = hunter;

CREATE OR REPLACE VIEW reference_price_current AS
SELECT DISTINCT ON (r.product_id) r.*,
       CASE r.reference_kind WHEN 'COPAG_OFFICIAL_CURRENT' THEN 1 WHEN 'MARKET_CURRENT' THEN 2 END AS priority
  FROM reference_price r
 WHERE r.reference_scope = 'current' AND r.verification_status = 'verified'
 ORDER BY r.product_id, priority, r.confidence DESC, r.verified_at DESC NULLS LAST, r.id DESC;

COMMENT ON VIEW reference_price_current IS NULL;
