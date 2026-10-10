# Preço sugerido Copag no site — política única

> **Exige decisão do dono.** Extraída do Lote 5 (PR #20) sem a migration 010. Muda o que o site mostra como "Copag confirmado"
> (robô e home da API). A view do motor (`reference_price_current`) não muda aqui; alinhá-la é a migration 010 (PR #20 / PR-A).

## Regra

Um produto só tem **Copag confirmado** (`copagConfirmed: true`, `msrp`) quando as quatro condições valem. A mesma regra vale no robô (`state.json`) e na home da API (`stateLikeFromDb`).

1. **Valor > 0.**
2. **Fonte oficial da Copag**: URL `http(s)` em `copagloja.com.br` ou `copag.com.br` (e subdomínios), marcada como oficial na origem.
   - Robô: `confidence: 'OFICIAL'`. Vale para a captura da loja oficial (`data/copag-msrp.json`) e para o cadastro manual no `config/catalog.json`.
   - Banco (home da API): linha `verified` com `source` `copag_loja`, `copag_loja_catalog` (catálogo público da loja Copag, importado da auditoria) ou `manual` (`DB_OFFICIAL_SOURCES`, a mesma lista da migration 010 / PR #185). O nome da fonte só habilita: URL, data e EAN passam pelas mesmas regras. `internet`, `copag_blog` e qualquer outra fonte nunca confirmam.
3. **Última verificação há no máximo 30 dias** em relação ao momento da rodada (robô) ou da consulta (API). A data é a mais recente entre `verified_at`, `source_timestamp`, `msrp_updated_at` e `last_check.at` (esta só quando a conferência diária `copag-check` bateu). Exatamente 30 dias ainda vale; 30 dias + 1 ms está vencido. A constante e a conta são as do motor (`COPAG_MAX_AGE_DAYS` e `copagExpired` em `api/_lib/references.mjs`); não há um segundo "30".
4. **A fonte é do mesmo produto.** Se a fonte traz EAN e o produto tem EAN no `catalog.json`, eles precisam bater (zeros à esquerda ignorados). Fonte com EAN de outro produto não vira preço nem referência. A captura da loja oficial passa a guardar o EAN que a loja mostrou (`ean` em `data/copag-msrp.json`); captura antiga sem EAN não é barrada.

Se uma condição falha, o valor aparece só como referência (`copagReference`, `copagReferenceUrl`) e o motivo vai em `copagReason`. O produto fica sem desconto Copag, fora da regra `copag-25` e sem pista.

`copagReferenceStatus` (campo do produto no `state.json`/home; não confundir com a função de diagnóstico `copagReferenceStatus(rows)` do motor em `references.mjs`):

| Estado | Quando |
|---|---|
| `confirmado` | As quatro condições valem. |
| `expirado` | Fonte oficial, mas verificada há mais de 30 dias. |
| `pendente` | Sem fonte, fora do domínio da Copag, sem marcação oficial, sem data ou com data no futuro (mais de 1 dia). |
| `null` | Sem valor, fonte marketplace ou fonte com EAN de outro produto. |

Não há lista de produtos travados: um produto fica sem Copag oficial por falta de evidência, e a mesma regra vale para todos.

## Onde está

- **Implementação:** `api/_lib/copag-policy.mjs` (a Vercel não publica `src/`). `src/copag-policy.js` só reexporta.
- **Robô:** `src/run.js` (`resolveCopag`: candidatos cadastro OFICIAL › captura da loja › demais cadastros; vence o primeiro confirmado, senão o primeiro expirado, senão o primeiro pendente; captura guarda o EAN), `src/score.js` (`copagStatus`), `src/copag-check.js` (confere toda fonte oficial da Copag, mesmo vencida: a conferência que bate renova a validade).
- **API:** `api/_lib/read-db.mjs` (home). O SQL traz as linhas candidatas das fontes que o robô publica (`copag_loja`, `manual`, `internet`) e do catálogo público da loja Copag (`copag_loja_catalog`) — `DB_SOURCES`; quem decide é `decideCopagFromRows` (ordem `manual` › `copag_loja` › `copag_loja_catalog` › `internet`, depois a verificação mais recente). O robô não lê `copag_loja_catalog` (só existe no banco): para `me04-box36`/`me05-blister3` a home pode mostrar Copag confirmado enquanto o `state.json` não.
- **Sincronização:** `src/core/mappers.js` grava `verified_at` com a data decidida pela política (`copagVerifiedAt`).
- **Testes:** `test/copag-policy-tests.js` (executado no fim de `test/copag-status-tests.js`): bordas de data, domínio, EAN, os 11 produtos do Instagram, ordem do resolvedor, paridade robô × API (8 cenários × 6 momentos), fontes do banco (`copag_loja_catalog` aceita com as mesmas exigências; URL fora da Copag, vencida, não verificada, fonte desconhecida, Instagram e EAN divergente recusados) e, com `TEST_DATABASE_URL`, a home da API no PostgreSQL. `test/run-tests.js` passa a usar a loja Copag com domínio real (`www.copagloja.com.br`) na rodada simulada.

**Limitação conhecida.** Se uma fonte oficial já está vencida na primeira sincronização, o banco só recebe a linha pendente (`internet`): a API mostra `pendente` e o robô `expirado`. Valor e ausência de confirmação são os mesmos.

## Impacto nos dados reais (só leitura, sem rede)

Base: `config/catalog.json` da `main` (12 cadastros OFICIAL, todos com fonte no Instagram, e 1 CATALOGO_COPAG), ramo `data` (`state.json` de 2026-10-10T16:00:27Z, 252 produtos, 1022 ofertas; `copag-msrp.json` com 13 capturas da loja oficial). Calculado com as funções desta política no momento da rodada.

| | Hoje | Com a política |
|---|---|---|
| Produtos com Copag confirmado (robô) | **24** | **13** |
| Perdem por fonte no Instagram (fora do domínio) | — | **11** |
| Perdem por idade > 30 dias / sem data / EAN | — | 0 / 0 / 0 |
| Continuam, trocando Instagram → captura da loja | — | 2 (`c30-blister2`, `c30-colecao_poster`) |
| Ofertas ao vivo com desconto Copag nos 11 | 31 (todas acima do preço Copag: desconto negativo) | 0 |

Os 11: `c30-colecao_fichario` 230,99 · `c30-etb` 399,99 · `c30-blister3` 99,99 · `c30-combo` 199,99 · `c30-combo6` 199,99 · `c30-minilata` 77,99 · `c30-colecao` 599,99 · `c30-colecao_miniatura` 245,99 · `c30-colecao_ex-greninja` / `-estampas` / `-sylveon` 160,99. Nenhum fica sem referência: o valor continua visível como referência `pendente`. 5 deles têm média de mercado no robô; 6 não (sem ofertas ao vivo suficientes).

**Notas do motor.** Os 11 do Instagram já não eram Copag no motor (o mapeamento grava fonte fora do domínio como `COMMUNITY_REFERENCE`), então as notas deles não mudam. O que muda no motor vem de `c30-blister2` e `c30-colecao_poster`, que passam a ser gravados como `copag_loja` (captura) e entram como Copag na view atual: segundo a medição do PR #20, cerca de 28 notas mudam, todas para baixo (5 `normal → baixa`). As 38 notas de `me04-box36`/`me05-blister3` medidas no PR #20 dependem da 010 e **não** mudam aqui; com `copag_loja_catalog` aceita (aqui e na 010 ajustada), os dois **seguem** `COPAG_OFFICIAL_CURRENT` no motor e passam a aparecer como Copag confirmado na home da API (449,99 e 42,99, verificados em 08/10, válidos até 07/11/2026).

**Validade.** As capturas dos 2 c30 foram vistas pela última vez em 08/10 e vencem em 07/11/2026 se a loja não as mostrar de novo; as outras 11 são renovadas a cada rodada.

## Decisões pendentes

1. **Aceitar a regra** (menos falso "oficial", menos produtos com Copag confirmado). Mitigação: re-verificar os 11 c30 na loja Copag e cadastrá-los com URL de `copagloja.com.br`/`copag.com.br` e data (`config/catalog.json`, `confidence: 'OFICIAL'`), ou deixar a captura da loja oficial cobri-los.

## Corrigido

- **`copag_loja_catalog` era barrada só pelo nome.** É o catálogo público da própria loja Copag (`copagloja.com.br`), importado por `tools/db-import-references.mjs` de `db/reference-imports/2026-10-08-copag-audit.json`. `me04-box36` (449,99) e `me05-blister3` (42,99) passam em domínio, validade e EAN, e seriam barradas só pelo nome da fonte. Agora `DB_OFFICIAL_SOURCES = copag_loja, copag_loja_catalog, manual` (mesma lista da migration 010 ajustada, PR #185), com as mesmas exigências; os outros 3 itens `copag_loja_catalog` da auditoria estão `pending` e continuam sem confirmar. `test/copag-policy-tests.js` (grupo 8) cobre o aceite e as recusas.
