-- FASE 5 — Opportunity Engine (opportunity-v1). Determinístico, sem IA, sem afiliado.
-- A tabela opportunity existia vazia e sem uso desde a 001 (formato provisório); é recriada no formato definitivo:
-- uma linha por oferta avaliada. product_stats continua só com FATOS do Price Engine; aqui fica a INTERPRETAÇÃO.
SET search_path = hunter;

DROP TABLE IF EXISTS opportunity;
CREATE TABLE opportunity (
  offer_id           bigint PRIMARY KEY REFERENCES offer(id) ON DELETE CASCADE,
  product_id         bigint NOT NULL REFERENCES product(id),
  opportunity_score  smallint NOT NULL CHECK (opportunity_score BETWEEN 0 AND 100),
  opportunity_band   text NOT NULL CHECK (opportunity_band IN ('excelente', 'boa', 'normal', 'baixa')),
  confidence         numeric(4, 3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  price              numeric(12, 2) NOT NULL,                 -- preço do item avaliado (desempate e eventos)
  -- sinais 0–1; nulo = sem dado confiável para aquele critério
  price_signal       numeric(5, 4),
  historical_signal  numeric(5, 4),
  reference_signal   numeric(5, 4),
  stock_signal       numeric(5, 4),
  freight_signal     numeric(5, 4),
  market_signal      numeric(5, 4),
  reliability_signal numeric(5, 4),
  raw_score          numeric(5, 2),                            -- média ponderada antes do encolhimento e das travas
  coverage           numeric(5, 4),                            -- fração dos pesos com dado disponível
  caps               jsonb NOT NULL DEFAULT '[]',               -- travas aplicadas (sem estoque, anomalia...)
  reasons            jsonb NOT NULL DEFAULT '[]',               -- [{code, text, impact}] para o site explicar o score
  warnings           jsonb NOT NULL DEFAULT '[]',               -- [{code, text}]
  is_anomaly         boolean NOT NULL DEFAULT false,
  engine_version     text NOT NULL,
  calculated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX opportunity_product_idx ON opportunity (product_id, opportunity_score DESC);
CREATE INDEX opportunity_band_idx ON opportunity (opportunity_band, opportunity_score DESC);

-- Melhor oportunidade COMPRÁVEL de cada produto (com estoque, sem anomalia). Sem tabela redundante: só uma view.
-- Desempate: score, confiança, menor preço, id da oferta (o mesmo do código: oppOrder).
CREATE VIEW product_opportunity AS
SELECT DISTINCT ON (o.product_id) o.*
  FROM opportunity o
 WHERE o.stock_signal = 1 AND NOT o.is_anomaly
 ORDER BY o.product_id, o.opportunity_score DESC, o.confidence DESC, o.price ASC, o.offer_id;
