# Auditoria de lacunas: Opportunity Engine, score e histórico (issue #295)

Leitura do código e dos testes na `main` (commit `c283216`). Só leitura: nenhum código foi alterado. Testes de banco (`*-db-tests.js`) só rodam com `TEST_DATABASE_URL`; sem ele são pulados, então a cobertura abaixo para eles é "existe, não executado aqui".

## 1. Mapa

| Módulo | Função / trecho | Papel |
|---|---|---|
| `src/core/price-engine.js` | `computeProductStats` (l.130), `dailySeries` (l.67), `plausible` (l.52), `anchorOf`/`historyAnchorOf` (l.110-120) | Estatísticas por produto, série diária, régua de plausibilidade 0,55×–3× |
| `src/core/opportunity-engine.js` | `calculateOpportunity` (l.61), `WEIGHTS`/`CAPS`/`BANDS` (l.35-40), `productOpportunity` (l.231), `eventsFor` (l.256) | Nota 0–100, faixa, confiança, travas |
| `src/core/opportunity-run.js` | `computeOpportunities` (l.37), `runOpportunityEngine` (l.52) | Rodada: upsert em `opportunity`, DELETE das ausentes, eventos, batida `ENGINE_HEARTBEAT` |
| `src/opportunity-read.js` | `readOfficial` (l.23), `officialFor` (l.59) | Nota oficial para alertas; vale por `MAX_AGE_MIN = 60` |
| `src/score.js` | `copagStatus` (l.4), `storeScore` (l.23), `isAnomalous` (l.38), `pickPrice` (l.17) | Preço Copag, reputação da loja, anomalia do robô |
| `src/history.js` | `recordDay` (l.100), `backfill` (l.76), `trimJsonl` (l.121), `cleanPoints`/`histSummary` (l.134-156) | Histórico em `data/hist/<id>.json` (180 dias) e ranking "maior queda" |
| `api/_lib/freshness.mjs` | `classify`, `usable`, `LIMITS` | Frescor exibido pela API/site |
| `db/migrations/005`, `007`, `008` | tabelas `opportunity`, referência atual | Persistência |

Há **duas implementações de histórico**: `dailySeries` (banco, usada pelo motor) e `data/hist` (arquivo JSON, usada pelo site/ranking). Constantes duplicadas: `0.55`/`3` em `score.js` l.39-43, `history.js` l.87/108 e `price-engine.js` l.20-21; `MIN_HIST_DAYS = 3` em `history.js` l.133 e `MIN_HISTORY_DAYS` em `price-engine.js` l.19.

## 2. O que já está coberto

| Comportamento | Teste |
|---|---|
| 14 cenários do motor (excelente, boa, normal, ruim, sem referência, sem histórico, sem estoque, frete desconhecido, anomalia, loja ruim, empate, sem ofertas, várias ofertas), contrato da saída, explicação, eventos só em transição, afiliado não influencia, custo total/evidência | `test/opportunity-engine-tests.js` |
| Estatística, centavos, elegibilidade, qualidade, série diária, variações, referência Copag × mercado, histórico insuficiente, determinismo | `test/price-engine-tests.js` |
| Pontos inválidos/duplicados, série curta (< 3 dias), `distrust` em `histSummary` | `test/history-quality-tests.js` |
| Frescor por oferta (cópia antiga não renova horário) | `test/offer-freshness-tests.js` |
| Frescor da API/site, pausa `stale_db` | `test/freshness-tests.js` |
| `officialFor`/`officialLine`/`readOfficial`, `MAX_AGE_MIN` | `test/alerts-opportunity-tests.js` |
| Motor parado: `ENGINE_HEARTBEAT` → `db-health` → vigia | `test/engine-watch-tests.js` |
| Contrato de `/api/v1/oportunidades`; só a nota oficial na UI | `test/opportunity-contract-tests.js`, `test/score-consistency-tests.js` |
| Rodada no PostgreSQL (precisa de banco) | `test/opportunity-db-tests.js`, `test/price-db-tests.js` |
| `copagStatus` (caso fonte de catálogo) | `test/run-tests.js` l.133 |

## 3. Lacunas atuais

### Alta
1. **`runOpportunityEngine` apaga tudo se a entrada vier vazia.** `src/core/opportunity-run.js` l.64: `DELETE ... WHERE NOT (offer_id = ANY($1))` com `rows = []` remove todas as linhas de `opportunity`. Não vi guarda para "carga vazia/falha parcial" em `loadOpportunityInputs`. Risco: nota some para todos (alertas e site caem em "sem nota") após uma leitura vazia. Não localizei teste desse caso.
2. **`score.js` sem teste: `isAnomalous` e `storeScore`.** Busca em `test/` só acha `copagStatus`. `isAnomalous` decide o que vai para investigação (limites `0.55`/`3`, l.39-43); `storeScore` define `validated` (≥ 50, l.34). Erro aqui gera dado errado para o usuário sem alerta de teste.

### Média
3. **Escrita do histórico sem teste.** `recordDay`, `backfill` e `trimJsonl` (`src/history.js`) só aparecem em `src/run.js`/`src/activity.js`; nenhum teste os chama. Pontos: filtro de suspeitos (l.108), mediana por produto (l.103-104), corte de 180 dias (l.69), `backfill` que sai se `hist/` existe (l.77).
4. **Limites duplicados** (ver mapa): mudar a régua em um lugar deixa o histórico do site divergente do que o motor considera plausível. Sem teste que os compare.
5. **Frete conhecido inconsistente.** `opportunity-engine.js` l.147-155: `shipping_status === 'known'` com `shipping_price` ausente e `total_price` ≤ `price` (frete negativo/nulo) cai em `UNKNOWN_FREIGHT`. Não localizei teste para frete negativo ou `total_price` menor que `price`.
6. **`officialFor` e arredondamento de preço** (`opportunity-read.js` l.61): compara em centavos; sem teste localizado para preço com mais de 2 casas ou string numérica.

### Baixa
7. `histSummary` (`history.js` l.150): janela de 7 dias é ancorada no último dia da série, não em "hoje"; série parada há semanas ainda produz `drop7d`. Sem teste.
8. `calculateOpportunity` com `stats` nulo (`const st = stats || {}`, l.71) é suportado, mas o único teste de "sem dados" é de produto sem ofertas (cenário 13).
9. `pickPrice` (`score.js` l.17) sem teste localizado (ordem Pix > à vista > cartão > base).

## 4. Tarefas propostas (pequenas e independentes)

| # | Tarefa | Arquivos prováveis | Risco | Critério de aceite |
|---|---|---|---|---|
| T1 | Testes de `isAnomalous`, `storeScore` e `pickPrice` | `test/score-tests.js` (novo) | R0 | `npm test` roda o arquivo; cobre limites 0,55/3 (iguais e vizinhos), `validated` em 49/50, sem evidência → `score: null`, ordem de `pickPrice` |
| T2 | Testes de `recordDay`, `trimJsonl` e `backfill` com diretório temporário | `test/history-write-tests.js` (novo) | R0 | Cobre menor valor do dia, descarte de suspeito/anômalo/stale, corte de 180 dias, `backfill` idempotente |
| T3 | Guarda no DELETE da rodada quando não há linhas avaliadas | `src/core/opportunity-run.js`, `test/opportunity-db-tests.js` | R1 | Entrada vazia não apaga `opportunity` existente e registra aviso; teste de banco prova; fluxo normal inalterado |
| T4 | Centralizar `0.55`/`3` e `MIN_HIST_DAYS` numa só constante | `src/score.js`, `src/history.js`, `src/core/price-engine.js` | R1 | Mesmos valores importados de um só lugar; todos os testes atuais e `golden` inalterados; teste compara as constantes |
| T5 | Testes de frete: negativo, `total_price` < `price`, `shipping_price` ausente | `test/opportunity-engine-tests.js` (ou arquivo novo) | R0 | Frete inválido → `UNKNOWN_FREIGHT`, `freight_signal` nulo, `cost_basis = 'price_only'` |
| T6 | Testes de `officialFor` com preço fracionado/string e `histSummary` com série antiga | `test/alerts-opportunity-tests.js`, `test/history-quality-tests.js` | R0 | Casos documentados passam; comportamento atual descrito no teste |
