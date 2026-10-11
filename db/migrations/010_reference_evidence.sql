-- 010 — Evidência e validade da Copag oficial na referência ATUAL do motor (decisão do responsável, Lote 5).
-- Mesma regra de api/_lib/copag-policy.mjs (site/API/robô) e de api/_lib/references.mjs (COPAG_MAX_AGE_DAYS = 30):
-- uma linha COPAG_OFFICIAL_CURRENT só é referência atual do motor com evidência suficiente —
--   • verificada e com valor > 0;
--   • fonte da loja oficial Copag ou cadastro manual: 'copag_loja' (captura da loja gravada pelo robô),
--     'copag_loja_catalog' (catálogo público da loja oficial, importado de db/reference-imports/ por
--     tools/db-import-references.mjs) ou 'manual'. Qualquer outra fonte (internet, Instagram, lojas) não entra.
--     A fonte sozinha nunca basta: as três exigem também o domínio Copag e a janela de 30 dias abaixo;
--   • URL no domínio oficial da Copag (copagloja.com.br / copag.com.br e subdomínios);
--   • verificação há no máximo 30 dias (e no máximo 1 dia no futuro, a mesma tolerância de relógio da política),
--     medidos contra o "agora" do cálculo: hunter.as_of (o Price Engine grava o asOf da rodada com set_config local à
--     transação, o mesmo asOf que resolveCurrentReference usa) ou, sem ele, now().
-- Não há produto travado por nome: sem evidência, a linha simplesmente não entra (ex.: verificação vencida ou URL fora da Copag).
-- Mercado atual (MARKET_CURRENT) não muda. Só a VIEW muda: nenhuma linha é apagada ou alterada; CREATE OR REPLACE mantém
-- as mesmas colunas, na mesma ordem (r.*, priority), e pode ser reaplicada.
SET search_path = hunter;

CREATE OR REPLACE VIEW reference_price_current AS
SELECT DISTINCT ON (r.product_id) r.*,
       CASE r.reference_kind WHEN 'COPAG_OFFICIAL_CURRENT' THEN 1 WHEN 'MARKET_CURRENT' THEN 2 END AS priority
  FROM reference_price r
 WHERE r.reference_scope = 'current' AND r.verification_status = 'verified' AND r.value > 0
   AND (r.reference_kind <> 'COPAG_OFFICIAL_CURRENT' OR (
         r.source IN ('copag_loja', 'copag_loja_catalog', 'manual')
     AND r.source_url ~* '^https?://([a-z0-9-]+\.)*copag(loja)?\.com\.br(/|$)'
     AND r.verified_at IS NOT NULL
     AND r.verified_at >= coalesce(nullif(current_setting('hunter.as_of', true), '')::timestamptz, now()) - interval '30 days'
     AND r.verified_at <= coalesce(nullif(current_setting('hunter.as_of', true), '')::timestamptz, now()) + interval '1 day'))
 ORDER BY r.product_id, priority, r.confidence DESC, r.verified_at DESC NULLS LAST, r.id DESC;

COMMENT ON VIEW reference_price_current IS
  'Referência atual por produto (Copag oficial > mercado). Copag só com evidência: fonte da loja Copag (copag_loja/copag_loja_catalog) ou manual, URL Copag, verificada há ≤ 30 dias (migration 010).';
