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

## Validade e renovação

### O que vence e quando (medido em 11/10/2026, sem rede e sem banco)
A view `reference_price_current` (migration 010) só aceita `COPAG_OFFICIAL_CURRENT` verificada há no máximo 30 dias, medidos contra o `asOf` da rodada. No instante `verified_at + 30 dias` a linha ainda vale; um segundo depois, sai.

| Produto | Fonte | Preço | Verificada em | Sai da nota após | Aviso `copag_vencendo` a partir de |
|---|---|---|---|---|---|
| `me04-box36` | `copag_loja_catalog` (import `2026-10-08-copag-audit.json`) | R$ 449,99 | 2026-10-08 00:00 UTC | 2026-11-07 00:00 UTC (06/11 21:00 em Brasília) | 2026-10-31 00:00 UTC |
| `me05-blister3` | `copag_loja_catalog` (mesmo import) | R$ 42,99 | 2026-10-08 00:00 UTC | 2026-11-07 00:00 UTC (06/11 21:00 em Brasília) | 2026-10-31 00:00 UTC |

- As outras 3 linhas `COPAG_OFFICIAL_CURRENT` do import (`me01-colecao_ex-mega-gengar`, `me03-colecao_ex-mega-zygarde`, `me05-colecao_ex-mega-greninja`) estão `pending`: nunca entraram na view, então não vencem.
- Capturas do robô (`copag_loja`, `data/copag-msrp.json`): o `verified_at` é renovado a cada rodada em que o produto aparece na loja Copag (em 11/10: 11 produtos, verificados às 11:00 UTC). Só vencem se o produto sumir da loja Copag por mais de 30 dias; nesse caso o mesmo aviso dispara 7 dias antes.
- Cadastros manuais `c30-*` em `config/catalog.json` (datas de 07/10): a fonte é `https://www.instagram.com/voltztcg/`, fora do domínio Copag. O robô os grava como `manual` com tipo `COMMUNITY_REFERENCE` (`robotReferenceKind`), então **não são `COPAG_OFFICIAL_CURRENT` no motor** e não entram nessa janela (nem antes, nem depois). No robô (`state.json`) eles continuam como preço Copag confirmado, sem prazo: essa regra não muda aqui. `c30-blister2` e `c30-colecao_poster` também têm captura da loja Copag em `copag-msrp.json`, parada em 08/10, mas o cadastro manual vence na escolha do robô (`resolveCopag`).

### O que acontece quando vence (se não renovar)
- A linha continua gravada em `reference_price`, com a data; nada é apagado.
- O Price Engine/Opportunity Engine deixa de ver a Copag do produto: a referência atual passa a ser o **mercado atual robusto** (mediana, ≥ 3 ofertas, ≥ 2 fontes independentes) ou, sem ele, **`NONE`** (sem referência). A nota da oportunidade passa a ser calculada contra essa referência, e a API mostra "Referência de mercado" em vez de "Preço sugerido Copag" (ou nenhuma).
- O selo/preço Copag da home não muda para esses dois produtos: a home já não mostra `copag_loja_catalog` como preço Copag (só `copag_loja`, `manual` e `internet`).
- Nenhum preço é estimado e nenhum prazo é estendido automaticamente.

### Aviso antecipado (`copag_vencendo`)
- A cada rodada, o robô lê do banco (só leitura, na mesma consulta de saúde: `readDbHealth` → `copagRefs`) as linhas Copag atuais verificadas e grava em `data/meta.json` → `ops.last.copag` a lista das que vencem em até 7 dias (`copagExpiringSoon`, `COPAG_WARN_DAYS`), com produto, verificação e vencimento.
- O vigia (`tools/watchdog.mjs`, `copagWarnings`/`decideWarning` em `src/ops-watch.js`) manda uma mensagem própria (🟡 aviso antecipado) com os produtos e a data; repete a cada 24 h enquanto continuar e de novo se a lista mudar. Não muda o estado do vigia, a nota nem o ranking.
- Sem banco (ou falha nessa leitura), não há medida e não há aviso.

### Procedimento de renovação (só com autorização do responsável)
1. Refazer a auditoria na loja oficial Copag (copagloja.com.br) para os produtos do aviso: conferir preço, página e evidência, como na auditoria de 08/10 (`tools/copag-reference-audit.json`).
2. Gerar um **novo** arquivo em `db/reference-imports/` (ex.: `AAAA-MM-DD-copag-audit.json`), no mesmo formato, com `verification_status: verified`, `verified_at` e `observed_at` da nova conferência e a evidência. Não editar o arquivo antigo.
3. Validar no PR (testes) e, com autorização explícita para tocar o banco de produção, importar: `DATABASE_URL=... node tools/db-import-references.mjs db/reference-imports/<novo>.json` (`npm run db:references`). Mesmo preço → a linha existente ganha o novo `verified_at`; preço diferente → nova linha (a antiga vence sozinha).
4. Na rodada seguinte, o aviso some (a lista do robô fica vazia).

**Quem decide:** o responsável pelo projeto. Renovar, mudar preço ou deixar vencer é decisão humana; nenhum agente faz a auditoria na Copag, gera import ou toca o banco sem autorização explícita para aquela ação (CLAUDE.md, seção Produção).

## Regra de fallback
Copag atual verificada e válida → mercado atual robusto (mediana, ≥ 3 ofertas, ≥ 2 fontes independentes) → `NONE`.
Histórica e comunitária nunca viram referência atual. Nenhum preço é estimado, corrigido por inflação ou preenchido por scraping fora das regras existentes.
