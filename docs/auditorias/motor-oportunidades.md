# Auditoria de lacunas: Opportunity Engine e explicabilidade do score — rodada 2 (issue #438)

Só leitura de `src/core/opportunity-engine.js`, `opportunity-run.js`, `src/opportunity-read.js`, `src/score.js`, `api/_lib/read-db.mjs`, `api/_lib/references.mjs` e dos testes do motor. Complementa `motor.md` (#295) sem repetir. **Correções a `motor.md`:** a lacuna 1 (DELETE com entrada vazia) já foi resolvida por `emptyRunGuard` (`opportunity-run.js` l.40/69, teste em `opportunity-db-tests.js` l.5-7); a 2 e a 9 também (`test/score-tests.js` importa `isAnomalous`, `storeScore`, `pickPrice`); a 4 também (`score.js` l.3 importa `PLAUSIBLE_MIN/MAX` do Price Engine). Testes `*-db-tests.js` só rodam com `TEST_DATABASE_URL`.

## 1. Mapa

| Arquivo | Trecho | Papel |
|---|---|---|
| `src/core/opportunity-engine.js` | `calculateOpportunity` (l.61); bloco `// --- referência atual` (l.77-92) | Só `COPAG_OFFICIAL_CURRENT` verificada ou `MARKET_CURRENT` pontuam (`refOk`, l.74) |
| idem | contexto histórico/comunitário (l.94-111) | Vira `warnings` (`HISTORICAL_REFERENCE_ONLY`, `COMMUNITY_REFERENCE*`); "não entra no score" |
| idem | `cap` (l.177-179) e travas (l.181-197) | Limita a nota e grava o código em `caps` |
| idem | `explain` (l.238) | Texto "nota — faixa" + `reasons` + `warnings`; ignora `caps` |
| `src/core/opportunity-run.js` | `runOpportunityEngine` (l.52) | Grava `caps`, `reasons`, `warnings` em `opportunity` |
| `api/_lib/read-db.mjs` | l.405-415 | Expõe `reasons`, `warnings`, `reference_comparison`, `current_reference`; **não** lê `caps` |
| `api/_lib/references.mjs` | `referenceComparison` (l.266) | Comparação oficial/mercado; `position` vem de `reasons` |
| `src/opportunity-read.js` | `SQL` (l.11) | Alertas: só `score`, `band`, `confidence`, `price` — sem motivo |
| `src/score.js` | `copagStatus` (l.6) | Copag `CATALOGO_COPAG` fica como referência, sem desconto |

## 2. Já coberto

| Comportamento | Teste |
|---|---|
| Travas `far_above_reference`, `above_reference`, `too_good` com aviso | `opportunity-engine-tests.js` l.47, 51, 116 |
| `explain` com frete desconhecido e `null` | `opportunity-engine-tests.js` l.166-168 |
| Mercado absorvido pela referência (sem dupla contagem), `MARKETPLACE_ONLY` | `market-composition-tests.js` l.39-70 |
| Copag oficial > mercado > `NONE`, mínimo de 3 fontes | `market-dedup-tests.js`, `copag-status-tests.js` |
| `referenceComparison` (Copag, mercado, acima, ausente) | `opportunity-contract-tests.js` l.31 |
| Trava esperada no conjunto dourado | `golden-eval-tests.js` l.45 |
| Frete (`UNKNOWN_FREIGHT`, custo total) | `freight-signal-tests.js` |

## 3. Lacunas priorizadas

### Alta
1. **`caps` lista travas que não limitaram a nota.** `cap` (l.178) faz `caps.push(code)` mesmo quando `score <= c`. Ex.: nota 30 por estoque esgotado também registra `anomaly`/`stock_unknown` se aplicáveis. Quem lê `caps` não distingue "limitou" de "só se aplica". Teste de `caps` só usa `includes` (l.47, 51, 116).
2. **Trava aplicada sem explicação na API/UI.** `read-db.mjs` não seleciona nem devolve `caps`; só chegam `reasons`/`warnings`. Uma nota 74 por `above_reference` ou 49 por `anomaly` não diz qual trava segurou. `explain` (l.238) também ignora `caps`.

### Média
3. **Oficial × referência só distinguível por `reference_kind`.** `reasons` de desconto trazem `reference_kind` (l.89), mas `HISTORICAL_REFERENCE_ONLY` e `COMMUNITY_REFERENCE` são `warnings` sem esse campo; consumidor que lê só `warnings` precisa deduzir pelo `code`. Sem teste que garanta que contexto nunca altere a nota (existe só para mercado, `market-composition-tests.js` l.70).
4. **Texto de `explain` não separa fonte.** Linhas "+ x% abaixo da referência de mercado" e "do preço sugerido Copag" diferem só pela frase (l.79); sem teste que fixe que a nota de mercado nunca usa "Copag" no texto.
5. **Alertas sem motivo.** `opportunity-read.js` l.11 não traz `reasons`/`warnings`; alerta mostra nota e faixa sem dizer que a referência é de mercado. Conferir `alerts.js` antes de agir.

### Baixa
6. **Confiança sem decomposição.** `conf` (l.201-208) multiplica 7 fatores e devolve um número; a API não diz qual reduziu. Só `confidence_level` e `evidence` aparecem.
7. **Sem teste de anomalia por régua versus marcada.** `isAnomaly = offer.anomalous || implausible` (l.180): o aviso muda por origem, mas só o texto diferencia; sem teste dos dois ramos.

## 4. Tarefas propostas (independentes)

| # | Tarefa | Arquivos | Risco | Aceite |
|---|---|---|---|---|
| T1 | Gravar em `caps` só as travas que reduziram a nota (`score > c`) | `src/core/opportunity-engine.js`, `test/opportunity-engine-tests.js` | R1 | Oferta esgotada e anômala: `caps` só com as que limitaram; notas, faixas e `golden` inalterados; `npm test` verde |
| T2 | Devolver `caps` em `read-db.mjs` e incluí-las no contrato | `api/_lib/read-db.mjs`, `test/opportunity-contract-tests.js` | R1 | Item da API traz `caps` (lista); contrato testado; sem mudança de nota |
| T3 | `explain` listar a trava que limitou ("limitada a 74: acima da referência") | `src/core/opportunity-engine.js`, `test/opportunity-engine-tests.js` | R0 | `explain` de oferta limitada cita a trava; sem trava, saída igual à atual |
| T4 | Teste: referência histórica/comunitária nunca altera nota nem `reference_kind` | `test/opportunity-engine-tests.js` | R0 | Mesma oferta com e sem `reference_context` dá o mesmo `opportunity_score` e `reference_kind = 'NONE'` |
| T5 | Teste: texto da referência de mercado não cita "Copag" e vice-versa | `test/opportunity-engine-tests.js` | R0 | Asserções sobre `reasons[].text` para `MARKET_CURRENT` e `COPAG_OFFICIAL_CURRENT` |
| T6 | Teste dos dois ramos de anomalia (`offer.anomalous` × régua) | `test/opportunity-engine-tests.js` | R0 | Ambos limitam a 49, `confidence` ×0,4 e o aviso `ANOMALY` tem texto distinto |
