-- FASE 2 — Price Engine (determinístico, sem IA, sem afiliado).
-- price_daily e product_stats existiam vazios e sem uso desde a 001; são recriados com o formato definitivo.
SET search_path = hunter;

-- Janelas de leitura não confiável por loja (vem do robô: state.distrust). Pontos de histórico dessas lojas
-- até o dia indicado (inclusive, UTC) ficam fora das estatísticas. Nada é apagado de price_history.
CREATE TABLE IF NOT EXISTS source_distrust (
  store_id   text PRIMARY KEY,
  until_day  date NOT NULL,
  reason     text NOT NULL,
  source     text NOT NULL DEFAULT 'robot',
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Série diária reconstruída por produto (store_id '' = todas as lojas). Derivada de price_history + stock_event;
-- recalculável a qualquer momento com o mesmo resultado.
DROP TABLE IF EXISTS price_daily;
CREATE TABLE price_daily (
  product_id   bigint NOT NULL REFERENCES product(id),
  store_id     text NOT NULL DEFAULT '',
  day          date NOT NULL,                      -- dia UTC
  min_price    numeric(12, 2) NOT NULL,            -- menor preço em estoque no dia (melhor preço do dia)
  max_price    numeric(12, 2) NOT NULL,            -- maior preço em estoque no dia
  avg_price    numeric(12, 2) NOT NULL,            -- média dos menores preços de cada oferta no dia
  close_price  numeric(12, 2),                     -- menor preço em estoque no fim do dia (nulo se nada em estoque)
  offers       int NOT NULL,                       -- ofertas com preço válido em estoque no dia
  engine_version text NOT NULL,
  PRIMARY KEY (product_id, store_id, day)
);
CREATE INDEX price_daily_day_idx ON price_daily (day);

DROP TABLE IF EXISTS product_stats;
CREATE TABLE product_stats (
  product_id   bigint PRIMARY KEY REFERENCES product(id),
  as_of_day    date NOT NULL,                      -- dia (UTC) do cálculo; variações são relativas a ele
  data_status  text NOT NULL CHECK (data_status IN ('ok', 'no_stock', 'no_offers')),

  -- Preço atual de mercado (só ofertas ativas, confirmadas, plausíveis, mesma condição do produto, em estoque)
  current_price         numeric(12, 2),            -- menor preço à vista em estoque
  current_offer_id      bigint REFERENCES offer(id),
  current_total_price   numeric(12, 2),            -- menor preço + frete, só com frete conhecido
  current_total_offer_id bigint REFERENCES offer(id),
  lowest_current_price  numeric(12, 2),
  highest_current_price numeric(12, 2),
  average_price         numeric(12, 2),
  median_price          numeric(12, 2),

  -- Histórico (série diária do melhor preço; mínimo de dias em history_min_days)
  history_days          int NOT NULL DEFAULT 0,
  history_from          date,
  history_status        text NOT NULL CHECK (history_status IN ('ok', 'insufficient')),
  historical_min        numeric(12, 2),
  historical_max        numeric(12, 2),
  historical_average    numeric(12, 2),
  historical_median     numeric(12, 2),
  variation_24h         numeric(10, 4),            -- razões: 0.1000 = +10%
  variation_7d          numeric(10, 4),
  variation_30d         numeric(10, 4),
  distance_from_historical_average numeric(10, 4),
  distance_from_historical_min     numeric(10, 4),

  -- Referência Copag (fonte independente; nunca tratada como preço de mercado)
  reference_price       numeric(12, 2),
  reference_status      text,
  reference_source      text,
  reference_verified_at timestamptz,
  discount_vs_reference numeric(10, 4),            -- (referência − preço atual) / referência; só com referência verificada

  -- Cobertura
  number_of_active_offers   int NOT NULL DEFAULT 0,
  number_of_in_stock_offers int NOT NULL DEFAULT 0,
  number_of_stores          int NOT NULL DEFAULT 0,
  number_of_marketplaces    int NOT NULL DEFAULT 0,
  shipping_coverage         numeric(5, 4),         -- fração das ofertas em estoque com frete conhecido

  quality        jsonb NOT NULL DEFAULT '{}',      -- o que ficou de fora e por quê (contagens)
  engine_version text NOT NULL,
  computed_at    timestamptz NOT NULL DEFAULT now()
);
