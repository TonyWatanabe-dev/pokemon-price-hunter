-- FASE 6B.0 — comparação com a referência atual, por oferta, gravada pelo próprio Opportunity Engine.
-- O motor já calculava a distância entre o preço da oferta e a referência atual que ele usou (Copag oficial atual ou
-- mercado atual robusto); ela só aparecia no texto das razões. Aqui ela passa a ser guardada como dado, para a API
-- filtrar e ordenar sem recalcular nada. Score, pesos, travas, confiança e regras de referência não mudam.
-- Histórico e referência comunitária nunca entram aqui (são contexto). Nada é apagado; nenhuma tabela é recriada.
SET search_path = hunter;

ALTER TABLE opportunity
  ADD COLUMN reference_kind  text,              -- referência ATUAL usada na avaliação: COPAG_OFFICIAL_CURRENT | MARKET_CURRENT | NONE
  ADD COLUMN reference_value numeric(12, 2),    -- valor dessa referência no momento do cálculo
  ADD COLUMN reference_gap   numeric(8, 4);     -- (referência − preço) / referência: positivo = abaixo, negativo = acima

ALTER TABLE opportunity ADD CONSTRAINT opportunity_reference_kind_check
  CHECK (reference_kind IS NULL OR reference_kind IN ('COPAG_OFFICIAL_CURRENT', 'MARKET_CURRENT', 'NONE'));
-- linhas antigas ficam NULL até a próxima rodada do motor (que regrava todas); depois: tipo atual ⇔ valor e distância
ALTER TABLE opportunity ADD CONSTRAINT opportunity_reference_value_check
  CHECK (reference_kind IS NULL OR (reference_kind = 'NONE') = (reference_value IS NULL AND reference_gap IS NULL));

CREATE INDEX opportunity_reference_gap_idx ON opportunity (reference_gap DESC NULLS LAST);

-- a view expande o.* no momento da criação: recriada para incluir as colunas novas (mesma regra e desempate da 005)
CREATE OR REPLACE VIEW product_opportunity AS
SELECT DISTINCT ON (o.product_id) o.*
  FROM opportunity o
 WHERE o.stock_signal = 1 AND NOT o.is_anomaly
 ORDER BY o.product_id, o.opportunity_score DESC, o.confidence DESC, o.price ASC, o.offer_id;
