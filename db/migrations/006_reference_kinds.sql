-- FASE 5.6 — Referência ATUAL × CONTEXTO HISTÓRICO.
-- Menor mudança possível em reference_price: reaproveita value/currency/source/source_url/verification_status/verified_at/confidence/notes
-- e acrescenta só o que faltava para não confundir preço sugerido de lançamento (2023) com preço sugerido de hoje.
-- Nenhuma linha é apagada. Nenhum preço é recalculado, corrigido por inflação ou estimado.
SET search_path = hunter;

ALTER TABLE reference_price
  ADD COLUMN reference_kind text,
  ADD COLUMN published_at   text,          -- quando a PÁGINA foi publicada (AAAA, AAAA-MM ou AAAA-MM-DD: sem inventar dia)
  ADD COLUMN effective_date text,          -- quando o PREÇO passou a valer, só com evidência explícita (mesmo formato)
  ADD COLUMN observed_at    timestamptz,   -- quando NÓS consultamos/encontramos (verified_at continua = quando foi validada)
  ADD COLUMN page_title     text,
  ADD COLUMN evidence_text  text;          -- trecho literal da fonte que sustenta o preço

-- tipo das linhas existentes: só é Copag oficial se a fonte estiver no domínio da Copag.
-- As 13 da tabela de 30 anos (Instagram de lojas) e as "internet" viram COMMUNITY_REFERENCE — os dados ficam, o rótulo muda.
UPDATE reference_price SET reference_kind = CASE
  WHEN source_url ~* '^https?://([a-z0-9-]+\.)*copag(loja)?\.com\.br(/|$)' THEN 'COPAG_OFFICIAL_CURRENT'
  ELSE 'COMMUNITY_REFERENCE' END;
-- linhas do robô: o carimbo que já existia é o da leitura da fonte (source_timestamp) → também é a observação
UPDATE reference_price SET observed_at = coalesce(verified_at, created_at) WHERE observed_at IS NULL;

ALTER TABLE reference_price
  ALTER COLUMN reference_kind SET NOT NULL,
  ADD CONSTRAINT reference_price_kind_check CHECK (reference_kind IN
    ('COPAG_OFFICIAL_CURRENT', 'COPAG_OFFICIAL_HISTORICAL', 'MARKET_CURRENT', 'MARKET_HISTORICAL', 'COMMUNITY_REFERENCE')),
  -- "Copag oficial" exige fonte no domínio da Copag (o banco recusa o contrário)
  ADD CONSTRAINT reference_price_copag_domain_check CHECK (reference_kind NOT LIKE 'COPAG_OFFICIAL%'
    OR source_url ~* '^https?://([a-z0-9-]+\.)*copag(loja)?\.com\.br(/|$)'),
  ADD CONSTRAINT reference_price_published_at_check CHECK (published_at IS NULL OR published_at ~ '^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$'),
  ADD CONSTRAINT reference_price_effective_date_check CHECK (effective_date IS NULL OR effective_date ~ '^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$'),
  -- escopo derivado do tipo (não pode divergir dele)
  ADD COLUMN reference_scope text GENERATED ALWAYS AS (CASE
    WHEN reference_kind IN ('COPAG_OFFICIAL_CURRENT', 'MARKET_CURRENT') THEN 'current'
    WHEN reference_kind IN ('COPAG_OFFICIAL_HISTORICAL', 'MARKET_HISTORICAL') THEN 'historical'
    ELSE 'community' END) STORED;
CREATE INDEX reference_price_scope_idx ON reference_price (product_id, reference_scope);

-- Referência ATUAL: a melhor por produto, só tipos atuais e verificados. Prioridade: Copag atual (1), mercado atual (2).
-- Sem linha = nenhuma referência atual ("NONE"). Histórico e comunidade nunca entram aqui.
DROP VIEW reference_price_current;
CREATE VIEW reference_price_current AS
SELECT DISTINCT ON (r.product_id) r.*,
       CASE r.reference_kind WHEN 'COPAG_OFFICIAL_CURRENT' THEN 1 WHEN 'MARKET_CURRENT' THEN 2 END AS priority
  FROM reference_price r
 WHERE r.reference_scope = 'current' AND r.verification_status = 'verified'
 ORDER BY r.product_id, priority, r.confidence DESC, r.verified_at DESC NULLS LAST, r.id DESC;

-- CONTEXTO histórico: preço sugerido de lançamento / histórico de mercado, com data, fonte e evidência.
CREATE VIEW reference_price_historical AS
SELECT r.* FROM reference_price r WHERE r.reference_scope = 'historical';

-- o Price Engine passa a registrar o TIPO da referência que usou (o consumidor não precisa adivinhar)
ALTER TABLE product_stats ADD COLUMN reference_kind text;

-- identificadores: o código de referência do fabricante (Cód. Copag, ex. 028D108800000BX) é "mpn".
-- EAN/GTIN já existiam (kinds 'ean', 'gtin'); nada é duplicado em product.
ALTER TABLE product_identifier DROP CONSTRAINT product_identifier_kind_check;
ALTER TABLE product_identifier ADD CONSTRAINT product_identifier_kind_check
  CHECK (kind IN ('ean', 'gtin', 'sku', 'mpn', 'mlb_catalog', 'asin', 'store_sku'));
