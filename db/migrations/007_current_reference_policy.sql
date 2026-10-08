-- FASE 6A — política de REFERÊNCIA ATUAL: Copag oficial atual > mercado atual robusto > NONE.
-- product_stats passa a guardar a referência atual RESOLVIDA pelo Price Engine (única fonte de verdade para o
-- Opportunity Engine e a API). Histórico e comunitária continuam só em reference_price (contexto/alerta).
-- Nada é apagado; nenhuma tabela é recriada.
SET search_path = hunter;

ALTER TABLE product_stats
  ADD COLUMN reference_confidence numeric(5, 4),   -- 0–1: Copag = confiança da linha/100; mercado = regra documentada (≤ 0,85)
  ADD COLUMN reference_reason     text;            -- verified_current_copag | robust_current_market | no_copag_<motivo do mercado>

-- semântica de reference_kind em product_stats: só tipos ATUAIS ou NONE (nunca histórico/comunitário)
-- (product_stats é derivado e recalculado a cada rodada; linhas antigas sem tipo ficam NONE até o próximo cálculo)
UPDATE product_stats SET reference_kind = 'NONE', reference_price = NULL, reference_status = NULL, reference_source = NULL,
       reference_verified_at = NULL, discount_vs_reference = NULL WHERE reference_kind IS NULL;
ALTER TABLE product_stats ALTER COLUMN reference_kind SET NOT NULL;
ALTER TABLE product_stats ADD CONSTRAINT product_stats_reference_kind_check
  CHECK (reference_kind IN ('COPAG_OFFICIAL_CURRENT', 'MARKET_CURRENT', 'NONE'));
ALTER TABLE product_stats ADD CONSTRAINT product_stats_reference_none_check
  CHECK ((reference_kind = 'NONE') = (reference_price IS NULL));
