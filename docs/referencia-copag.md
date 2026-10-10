# Referência de preço Copag — origem, validade e fallback

## Origem
- Preço sugerido oficial da Copag, importado da auditoria (`db/reference-imports/`) para a tabela `reference_price`, uma linha por produto, tipo e fonte.
- Só é `COPAG_OFFICIAL_*` se a URL da fonte for de domínio Copag (`isCopagUrl`); a importação recusa o resto (`validateImportEntry`).
- Cada linha guarda fonte, URL, evidência, `observed_at`, `verified_at`, status (`verified`/`pending`) e confiança.

## Timestamp e validade
- A referência atual vale por 30 dias a partir de `verified_at` (`COPAG_MAX_AGE_DAYS`). Depois disso a linha continua gravada, com a data, mas não entra na nota.
- Sem `verified_at` ou sem `asOf` não há como medir a idade (`copagExpired` devolve falso); `copagReferenceStatus` trata linha sem data como desatualizada.

## Situação por produto (`copagReferenceStatus`)
| Situação | Significado |
|---|---|
| `missing` | nenhuma Copag atual verificada com preço válido |
| `stale` | há Copag verificada, mas vencida (ou sem data); nenhum preço é oferecido |
| `confirmed` | Copag verificada, dentro da validade, preço único |
| `conflicting` | Copag válida com preços diferentes; todos são listados, nenhum é escolhido — exige decisão humana |

É função de diagnóstico; a nota continua usando `resolveCurrentReference`.

## Regra de fallback
Copag atual verificada e válida → mercado atual robusto (mediana, ≥ 3 ofertas, ≥ 2 fontes independentes) → `NONE`.
Histórica e comunitária nunca viram referência atual. Nenhum preço é estimado, corrigido por inflação ou preenchido por scraping fora das regras existentes.
