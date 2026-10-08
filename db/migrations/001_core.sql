-- TCG Price Hunter · Marketplace Core (PostgreSQL 15+, sem recursos proprietários)
-- Tudo no schema "hunter": fora do "public", que o Supabase expõe pela API REST automática.
-- Regras: dinheiro numeric(12,2) + moeda; datas timestamptz; jsonb só para detalhes;
-- histórico só recebe INSERT; afiliado nunca é lido pelo cálculo de preço/ranking.

CREATE SCHEMA IF NOT EXISTS hunter;
SET search_path = hunter;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

-- ===================== TAXONOMIA =====================
CREATE TABLE tcg (
  id              text PRIMARY KEY,                 -- 'pokemon', 'magic', ...
  name            text NOT NULL,
  collect_enabled boolean NOT NULL DEFAULT false,   -- coleta automática ligada por jogo
  sort            int NOT NULL DEFAULT 100,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE category (
  id        text PRIMARY KEY,                       -- 'sealed', 'sealed.etb', 'protection.sleeve'
  parent_id text REFERENCES category(id),
  name      text NOT NULL,
  kind      text NOT NULL CHECK (kind IN ('group', 'type')),
  sort      int NOT NULL DEFAULT 100,
  attrs     jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX category_parent_idx ON category (parent_id);

CREATE TABLE collection (
  id           text PRIMARY KEY,                    -- 'pokemon:me05'
  tcg_id       text NOT NULL REFERENCES tcg(id),
  code         text NOT NULL,                       -- 'me05'
  name         text NOT NULL,                       -- 'Escuridão Absoluta'
  series       text,
  language     text NOT NULL DEFAULT 'pt-BR',
  release_date date,
  logo_path    text,
  aliases      text[] NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tcg_id, code, language)
);

-- ===================== PRODUTO (canônico) =====================
CREATE TABLE product (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug           text NOT NULL UNIQUE,              -- fixo depois de criado (URL /produto/<slug>)
  legacy_id      text UNIQUE,                       -- id antigo ('me05-etb'): favoritos, alertas, URLs
  tcg_id         text REFERENCES tcg(id),           -- nulo = acessório universal
  collection_id  text REFERENCES collection(id),
  category_id    text NOT NULL REFERENCES category(id),
  brand          text,
  canonical_name text NOT NULL,
  language       text NOT NULL DEFAULT 'pt-BR',
  condition      text NOT NULL DEFAULT 'new' CHECK (condition IN ('new', 'used', 'damaged')),
  edition        text,
  rarity         text,
  set_number     text,
  units          int,                               -- boosters na embalagem, cartas no deck...
  variant        text,
  attrs          jsonb NOT NULL DEFAULT '{}',
  image_url      text,
  description    text,
  release_date   date,
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'preorder', 'discontinued')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX product_collection_idx ON product (collection_id);
CREATE INDEX product_category_idx ON product (category_id);

CREATE TABLE product_identifier (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id bigint NOT NULL REFERENCES product(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('ean', 'gtin', 'sku', 'mlb_catalog', 'asin', 'store_sku')),
  value      text NOT NULL,
  source     text NOT NULL DEFAULT '',
  confidence smallint NOT NULL DEFAULT 100 CHECK (confidence BETWEEN 0 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, value, source)
);
CREATE INDEX product_identifier_product_idx ON product_identifier (product_id);

-- ===================== MARKETPLACE · LOJA · VENDEDOR =====================
CREATE TABLE marketplace (
  id          text PRIMARY KEY,                     -- 'direct' (site próprio), 'mercadolivre', 'amazon'...
  name        text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('direct', 'marketplace')),
  base_url    text,
  api_enabled boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE store (
  id         text PRIMARY KEY,                      -- id atual do robô ('tocadotabuleiro')
  name       text NOT NULL,
  domain     text,
  platform   text,                                  -- jsonld, vtex, shopify, mercadolivre...
  kind       text,                                  -- specialist, toy, bookstore, marketplace...
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'blocked', 'pending', 'unavailable', 'removed')),
  ra_status  text,                                  -- Reclame Aqui
  ra_score   numeric(3, 1),
  ra_url     text,
  attrs      jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Onde a loja vende: site próprio e/ou contas em marketplaces (evita duplicar a loja)
CREATE TABLE store_channel (
  store_id           text NOT NULL REFERENCES store(id) ON DELETE CASCADE,
  marketplace_id     text NOT NULL REFERENCES marketplace(id),
  external_seller_id text NOT NULL DEFAULT '',
  url                text,
  PRIMARY KEY (store_id, marketplace_id, external_seller_id)
);

CREATE TABLE seller (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  marketplace_id   text NOT NULL REFERENCES marketplace(id),
  external_id      text NOT NULL,
  name             text,
  is_official      boolean NOT NULL DEFAULT false,
  reputation_level text,
  sales_completed  int,
  store_id         text REFERENCES store(id),       -- vendedor que também é uma loja cadastrada
  checked_at       timestamptz,
  UNIQUE (marketplace_id, external_id)
);

-- ===================== OFERTA =====================
CREATE TABLE offer (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  legacy_id           text UNIQUE,                  -- hash atual (loja + URL + vendedor)
  product_id          bigint NOT NULL REFERENCES product(id),
  store_id            text REFERENCES store(id),
  marketplace_id      text NOT NULL REFERENCES marketplace(id),
  seller_id           bigint REFERENCES seller(id),
  external_product_id text,
  external_offer_id   text,
  title_raw           text NOT NULL,
  url                 text NOT NULL,
  image_url           text,
  condition           text NOT NULL DEFAULT 'new',
  currency            char(3) NOT NULL DEFAULT 'BRL',
  price               numeric(12, 2),
  price_kind          text,                         -- base, pix, list
  list_price          numeric(12, 2),
  pix_price           numeric(12, 2),
  shipping_price      numeric(12, 2),
  shipping_status     text NOT NULL DEFAULT 'unknown' CHECK (shipping_status IN ('known', 'free', 'unknown')),
  total_price         numeric(12, 2),               -- só quando o frete é conhecido; nunca inventado
  stock_status        text NOT NULL DEFAULT 'unknown' CHECK (stock_status IN ('in_stock', 'out_of_stock', 'preorder', 'unknown')),
  quantity            int,
  match_confidence    smallint CHECK (match_confidence BETWEEN 0 AND 100),
  confirmed           boolean NOT NULL DEFAULT false,
  anomalous           boolean NOT NULL DEFAULT false,
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'removed', 'blocked')),
  source_type         text,
  first_seen_at       timestamptz NOT NULL DEFAULT now(),
  last_seen_at        timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (total_price IS NULL OR shipping_status <> 'unknown')
);
CREATE INDEX offer_product_idx ON offer (product_id) WHERE status = 'active';
CREATE INDEX offer_store_idx ON offer (store_id, status);
CREATE UNIQUE INDEX offer_external_uq ON offer (marketplace_id, external_offer_id, coalesce(seller_id, 0)) WHERE external_offer_id IS NOT NULL;

-- ===================== HISTÓRICO (só INSERT, particionado por mês) =====================
CREATE TABLE price_history (
  id             bigint GENERATED ALWAYS AS IDENTITY,
  offer_id       bigint NOT NULL,
  product_id     bigint NOT NULL,
  price          numeric(12, 2),
  shipping_price numeric(12, 2),
  total_price    numeric(12, 2),
  stock_status   text NOT NULL,
  observed_at    timestamptz NOT NULL,
  source         text NOT NULL DEFAULT 'robot',
  PRIMARY KEY (id, observed_at),
  UNIQUE (offer_id, observed_at)
) PARTITION BY RANGE (observed_at);
CREATE TABLE price_history_default PARTITION OF price_history DEFAULT;
CREATE INDEX price_history_product_idx ON price_history (product_id, observed_at DESC);

-- Partições mensais: as primeiras aqui; as seguintes o código cria antes de inserir (src/db/partitions.js).
-- Linhas fora de qualquer mês caem na partição default.
CREATE TABLE price_history_2026_09 PARTITION OF price_history FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE price_history_2026_10 PARTITION OF price_history FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE price_history_2026_11 PARTITION OF price_history FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE price_history_2026_12 PARTITION OF price_history FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE price_history_2027_01 PARTITION OF price_history FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');
CREATE TABLE price_history_2027_02 PARTITION OF price_history FOR VALUES FROM ('2027-02-01') TO ('2027-03-01');
CREATE TABLE price_history_2027_03 PARTITION OF price_history FOR VALUES FROM ('2027-03-01') TO ('2027-04-01');
CREATE TABLE price_history_2027_04 PARTITION OF price_history FOR VALUES FROM ('2027-04-01') TO ('2027-05-01');
CREATE TABLE price_history_2027_05 PARTITION OF price_history FOR VALUES FROM ('2027-05-01') TO ('2027-06-01');
CREATE TABLE price_history_2027_06 PARTITION OF price_history FOR VALUES FROM ('2027-06-01') TO ('2027-07-01');
CREATE TABLE price_history_2027_07 PARTITION OF price_history FOR VALUES FROM ('2027-07-01') TO ('2027-08-01');
CREATE TABLE price_history_2027_08 PARTITION OF price_history FOR VALUES FROM ('2027-08-01') TO ('2027-09-01');
CREATE TABLE price_history_2027_09 PARTITION OF price_history FOR VALUES FROM ('2027-09-01') TO ('2027-10-01');
CREATE TABLE price_history_2027_10 PARTITION OF price_history FOR VALUES FROM ('2027-10-01') TO ('2027-11-01');
CREATE TABLE price_history_2027_11 PARTITION OF price_history FOR VALUES FROM ('2027-11-01') TO ('2027-12-01');
CREATE TABLE price_history_2027_12 PARTITION OF price_history FOR VALUES FROM ('2027-12-01') TO ('2028-01-01');

-- Resumo diário (gráficos, médias, futuro Market Index): guardado para sempre
CREATE TABLE price_daily (
  product_id bigint NOT NULL REFERENCES product(id),
  store_id   text NOT NULL DEFAULT '',
  day        date NOT NULL,
  min_price  numeric(12, 2) NOT NULL,
  max_price  numeric(12, 2) NOT NULL,
  avg_price  numeric(12, 2) NOT NULL,
  close_price numeric(12, 2) NOT NULL,
  samples    int NOT NULL,
  PRIMARY KEY (product_id, store_id, day)
);

-- ===================== ESTOQUE · FRETE =====================
CREATE TABLE stock_event (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  offer_id    bigint NOT NULL REFERENCES offer(id),
  from_status text,
  to_status   text NOT NULL,
  quantity    int,
  observed_at timestamptz NOT NULL,
  UNIQUE (offer_id, observed_at)
);

CREATE TABLE shipping_quote (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  offer_id   bigint NOT NULL REFERENCES offer(id) ON DELETE CASCADE,
  cep_prefix char(5) NOT NULL DEFAULT '00000',      -- '00000' = regra geral (ex.: frete grátis)
  method     text NOT NULL DEFAULT '',
  price      numeric(12, 2) NOT NULL,
  days_min   int,
  days_max   int,
  checked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (offer_id, cep_prefix, method)
);

-- ===================== REFERÊNCIA COPAG =====================
CREATE TABLE reference_price (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id          bigint NOT NULL REFERENCES product(id),
  value               numeric(12, 2) NOT NULL CHECK (value > 0),
  currency            char(3) NOT NULL DEFAULT 'BRL',
  source              text NOT NULL,                -- copag_loja, copag_ml, manual, ...
  source_url          text NOT NULL,                -- sem fonte, não entra
  verification_status text NOT NULL CHECK (verification_status IN ('verified', 'pending', 'conflicting', 'unknown')),
  verified_at         timestamptz,
  confidence          smallint NOT NULL DEFAULT 50 CHECK (confidence BETWEEN 0 AND 100),
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, source, value)
);
-- Referência vigente: a verificada mais recente
CREATE VIEW reference_price_current AS
SELECT DISTINCT ON (product_id) *
FROM reference_price
WHERE verification_status = 'verified'
ORDER BY product_id, verified_at DESC NULLS LAST, confidence DESC;

-- ===================== INTELIGÊNCIA (calculada por código, não por IA) =====================
CREATE TABLE product_stats (
  product_id    bigint PRIMARY KEY REFERENCES product(id),
  best_offer_id bigint REFERENCES offer(id),
  offers_live   int NOT NULL DEFAULT 0,
  min_price     numeric(12, 2), max_price numeric(12, 2), avg_price numeric(12, 2), median_price numeric(12, 2),
  hist_min      numeric(12, 2), hist_max numeric(12, 2),
  avg_7d        numeric(12, 2), avg_30d numeric(12, 2), avg_90d numeric(12, 2),
  chg_24h       numeric(7, 4), chg_7d numeric(7, 4), chg_30d numeric(7, 4),
  computed_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE opportunity (
  offer_id    bigint PRIMARY KEY REFERENCES offer(id) ON DELETE CASCADE,
  product_id  bigint NOT NULL REFERENCES product(id),
  score       smallint NOT NULL CHECK (score BETWEEN 0 AND 100),
  band        text NOT NULL CHECK (band IN ('excelente', 'boa', 'normal', 'pouco_atrativo')),
  parts       jsonb NOT NULL DEFAULT '{}',
  computed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX opportunity_score_idx ON opportunity (score DESC);

-- ===================== AFILIADOS (camada separada; nunca lida pelo ranking) =====================
CREATE TABLE affiliate_program (
  id             text PRIMARY KEY,                  -- 'mercadolivre', 'amazon'
  marketplace_id text NOT NULL REFERENCES marketplace(id),
  name           text NOT NULL,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'paused')),
  params         jsonb NOT NULL DEFAULT '{}',       -- tag/ids públicos; segredos ficam em variáveis de ambiente
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE affiliate_link (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  program_id text NOT NULL REFERENCES affiliate_program(id),
  offer_id   bigint REFERENCES offer(id) ON DELETE CASCADE,
  url        text NOT NULL,
  status     text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'broken')),
  checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (program_id, offer_id)
);

CREATE TABLE affiliate_click (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  link_id    bigint REFERENCES affiliate_link(id) ON DELETE SET NULL,
  offer_id   bigint,
  clicked_at timestamptz NOT NULL DEFAULT now()
);

-- ===================== USUÁRIOS · PAPÉIS · PERMISSÕES =====================
CREATE TABLE app_user (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_provider text NOT NULL DEFAULT 'firebase',
  external_uid  text NOT NULL,
  email         text,
  display_name  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz,
  UNIQUE (auth_provider, external_uid)
);
CREATE UNIQUE INDEX app_user_email_uq ON app_user (lower(email)) WHERE email IS NOT NULL;

CREATE TABLE role (id text PRIMARY KEY, name text NOT NULL, rank int NOT NULL);
CREATE TABLE permission (id text PRIMARY KEY, description text NOT NULL);
CREATE TABLE role_permission (
  role_id       text NOT NULL REFERENCES role(id) ON DELETE CASCADE,
  permission_id text NOT NULL REFERENCES permission(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);
CREATE TABLE user_role (
  user_id    uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  role_id    text NOT NULL REFERENCES role(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid REFERENCES app_user(id),
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE favorite (
  user_id    uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  product_id bigint NOT NULL REFERENCES product(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, product_id)
);
CREATE TABLE price_alert (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  product_id   bigint NOT NULL REFERENCES product(id),
  target_price numeric(12, 2) NOT NULL,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE alert_delivery (
  id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  alert_id bigint NOT NULL REFERENCES price_alert(id) ON DELETE CASCADE,
  offer_id bigint REFERENCES offer(id),
  channel  text NOT NULL,
  sent_on  date NOT NULL DEFAULT current_date,
  sent_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (alert_id, offer_id, channel, sent_on)     -- sem aviso repetido no mesmo dia
);

-- ===================== AUTOMAÇÃO =====================
CREATE TABLE automation_job (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type            text NOT NULL,                    -- crawl.store, match.review, price.recompute...
  entity_type     text,
  entity_id       text,
  priority        smallint NOT NULL DEFAULT 100,    -- menor = antes
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'retry', 'blocked')),
  attempts        int NOT NULL DEFAULT 0,
  max_attempts    int NOT NULL DEFAULT 5,
  idempotency_key text NOT NULL UNIQUE,             -- repetir não duplica
  payload         jsonb NOT NULL DEFAULT '{}',
  result          jsonb,
  error           text,
  run_after       timestamptz NOT NULL DEFAULT now(),
  locked_by       text,
  locked_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  started_at      timestamptz,
  finished_at     timestamptz
);
CREATE INDEX automation_job_ready_idx ON automation_job (priority, run_after) WHERE status IN ('pending', 'retry');

CREATE TABLE system_event (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type        text NOT NULL,                        -- PRICE_CHANGED, OFFER_CREATED, CRAWLER_FAILED...
  entity_type text,
  entity_id   text,
  payload     jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX system_event_type_idx ON system_event (type, created_at DESC);

CREATE TABLE review_item (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category    text NOT NULL CHECK (category IN ('matching', 'reference_conflict', 'price_anomaly', 'store_blocked', 'duplicate_product', 'affiliate_missing', 'crawler_broken')),
  entity_type text,
  entity_id   text,
  proposal    jsonb NOT NULL DEFAULT '{}',
  confidence  smallint,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'approved', 'rejected', 'dismissed')),
  dedupe_key  text UNIQUE,
  decided_by  uuid REFERENCES app_user(id),
  decided_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX review_item_open_idx ON review_item (category, created_at) WHERE status = 'open';

CREATE TABLE crawl_run (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  store_id    text REFERENCES store(id),
  started_at  timestamptz NOT NULL,
  finished_at timestamptz,
  status      text NOT NULL,
  listings    int,
  matched     int,
  error       text,
  UNIQUE (store_id, started_at)
);

CREATE TABLE source_health (
  store_id        text PRIMARY KEY REFERENCES store(id) ON DELETE CASCADE,
  status          text NOT NULL,
  fails           int NOT NULL DEFAULT 0,
  reason          text,
  last_check_at   timestamptz,
  last_success_at timestamptz,
  next_try_at     timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ===================== FUTURO: SETUP BUILDER (reservado) =====================
CREATE TABLE bundle (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug        text NOT NULL UNIQUE,
  name        text NOT NULL,
  kind        text,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE bundle_item (
  bundle_id   bigint NOT NULL REFERENCES bundle(id) ON DELETE CASCADE,
  category_id text NOT NULL REFERENCES category(id),
  product_id  bigint REFERENCES product(id),
  quantity    int NOT NULL DEFAULT 1,
  optional    boolean NOT NULL DEFAULT false,
  PRIMARY KEY (bundle_id, category_id)
);
