# Auditoria de lacunas: fábrica de agentes (Dispatcher, worker, revisor, Governor) — issue #378

Leitura de `src/agents/`, `tools/dispatcher.mjs`, `tools/telemetria.mjs`, `tools/burnin.mjs` e dos testes de agentes na `main`. Só leitura de código; foco em robustez operacional, não em permissões. Não repete `seguranca.md`, `coletores.md` etc.

## 1. Mapa

| Módulo | Função / trecho | Papel |
|---|---|---|
| `src/agents/dispatcher.js` | `planDispatch` (l.157), `applyPlan` (l.265), `validateDispatchRequest` (l.300), `parseDispatchMarkers` (l.65), `DEFAULTS` (l.17) | Plano puro de despacho, quarentena, lease, marcador com chave `dispatch:<issue>:<tentativa>` |
| `tools/dispatcher.mjs` | `snapshot` (l.31), `budget` (l.67), adapters de `applyPlan` | Lê issues/PRs via `gh`, aplica o plano, pausa por rate limit/orçamento |
| `src/agents/orchestrator.js` | `backoffMs` (l.28), `withTimeout` (l.31), `createOrchestrator` (l.53) | Fila de jobs de IA: retry, lease, timeout, bloqueio sem handler |
| `src/agents/stores.js` | `memoryStore`, `pgStore` (l.56) | Persistência com fencing por `locked_by` |
| `src/agents/cycle.js` | `runAgentCycle` (l.12), `CYCLE` (l.10) | Ciclo enfileirar → executar (prazo 45 s) → avisar |
| `src/agents/notify.js` | `pendingAgentEvents` (l.28), `notifyAgentEvents` (l.39) | Alerta de jobs falhos/bloqueados |
| `src/agents/telemetria.js` + `tools/telemetria.mjs` | `parseRecords` (l.97), `summarize` (l.115), `gastoNaJanela` (l.154) | Registro de execuções e gasto na janela |
| `src/agents/burnin.js` + `tools/burnin.mjs` | `avaliarDia` (l.76), `parseDias` (l.144), `planoPublicacao` (l.162) | Avaliação diária do burn-in |
| `src/agents/esforco.js` | `budgetGate` | Gate de orçamento |
| `src/agents/release-governor*.js`, `release-executor-bridge.js` | Governor/bridge | Gates de release (fora do foco de permissões) |

## 2. O que já está coberto

| Tema | Teste |
|---|---|
| Plano, dependências, áreas, lease, quarentena, corrida entre dois dispatchers (`applyPlan` x2) | `test/dispatcher-tests.js` |
| Backoff, timeout, fencing, lease expirada, bloqueio sem IA | `test/agents-orchestrator-tests.js`, `test/agents-db-tests.js` (exige `TEST_DATABASE_URL`) |
| Ciclo de agentes de ponta a ponta | `test/agents-integration-tests.js` |
| Telemetria: parse, autor confiável, agregados | `test/telemetria-tests.js` |
| Burn-in: dias, sequência verde, publicação | `test/burnin-tests.js` |
| Orçamento/esforço | `test/esforco-tests.js` |
| Governor, bridge, auditoria | `test/agents-release-governor-tests.js`, `test/release-executor-bridge-tests.js`, `test/release-audit-github-tests.js` |
| Workflows do worker/revisor | `test/tarefas-workflow-tests.js`, `test/revisor-workflow-tests.js` |

## 3. Lacunas atuais

### Alta
1. **`applyPlan` aborta o lote inteiro em erro de API.** `adapters.addLabel`, `comment` e `reload` (`dispatcher.js` l.270-281) ficam fora de `try`; só `adapters.dispatch` (l.288) é capturado. Uma falha de rede no 1º item impede as demais quarentenas e despachos do ciclo; um comentário já gravado sem `dispatch` deixa a chave consumida (tentativa gasta sem execução). Evidência: `grep -c throw test/dispatcher-tests.js` = 4, nenhum com adapter que lança em `comment`/`reload`.
2. **Leitura de rate limit é fail-open.** `tools/dispatcher.mjs` l.36: `api('rate_limit').catch(() => null)`; se a leitura falha, `pauseUntil` não é definido e o despacho segue sem checar cota.

### Média
3. **`gh` sem retry.** `gh()` (`tools/dispatcher.mjs` l.22, `tools/burnin.mjs` l.23) tem `timeout: 60_000` mas nenhuma nova tentativa; um 502 transitório derruba o ciclo inteiro (`snapshot` não trata erro por issue, l.44-45).
4. **N+1 de chamadas no `snapshot`.** Para cada issue são feitas duas listagens paginadas sequenciais (eventos e comentários, l.44-45), e `reload` repete o mesmo por despacho (l.~88). Consome cota justamente quando há fila grande.
5. **`runAgentCycle` sem teste de prazo.** O laço `while (clock() - started < cfg.deadlineMs)` (`cycle.js` l.32) e o `break` por `claimed < batch` não têm teste dedicado (só `agents-integration-tests.js` de caminho feliz).

### Baixa
6. **`parseRecords` não deduplica.** `telemetria.js` l.97-108 aceita o mesmo marcador em comentários repetidos (reenvio do workflow), o que soma custo duas vezes em `gastoNaJanela`; `parseDias` (burnin l.144) já protege com `!out.has(av.dia)`.
7. **Constantes duplicadas** de lease/backoff em `DEFAULTS` do dispatcher (`leaseMinutes: 70`) sem teste que a relacione ao `timeout-minutes` de `tarefas.yml`.

## 4. Tarefas propostas (pequenas, independentes, sem `index.html`)

| # | Tarefa | Arquivos | Risco | Critério de aceite |
|---|---|---|---|---|
| T1 | Isolar erro por item em `applyPlan`: falha em `reload`/`comment`/`addLabel` vira `status: 'dispatch_failed'`/`'error'` e o laço continua | `src/agents/dispatcher.js`, `test/dispatcher-tests.js` | R1 | Teste: adapter que lança em `comment` do 1º item; o 2º ainda é `dispatched` e `npm test` passa |
| T2 | Rate limit fail-closed: se `rate_limit` falhar, pausar o despacho com motivo | `tools/dispatcher.mjs` (extrair função pura em `src/agents/dispatcher.js`), `test/dispatcher-tests.js` | R1 | Teste da função pura: entrada `null` → `pauseUntil` definido; entrada com `remaining >= 200` → sem pausa |
| T3 | Retry com backoff limitado no wrapper `gh` (só leituras `api`) | `tools/dispatcher.mjs`, `tools/burnin.mjs`, novo `tools/gh-retry.mjs`, `test/gh-retry-tests.js` | R1 | Teste: runner falso falha 2x e depois responde; 3ª tentativa devolve; 4 falhas propagam erro; escrita não é repetida |
| T4 | Teste de prazo e lote de `runAgentCycle` com relógio injetado | `test/agents-cycle-tests.js` | R0 | Teste: `clock` que avança além de `deadlineMs` interrompe o laço; `claimed < batch` encerra; erro em `candidatos` não impede `notify` |
| T5 | Deduplicar registros de telemetria por `(issue, chave, runId, runAttempt)` | `src/agents/telemetria.js`, `test/telemetria-tests.js` | R1 | Teste: dois comentários com o mesmo registro contam uma vez em `gastoNaJanela` |
| T6 | Teste de coerência `leaseMinutes` x `timeout-minutes` do `tarefas.yml` | `test/dispatcher-lease-tests.js` | R0 | Teste lê o YAML e falha se `DEFAULTS.leaseMinutes` < `timeout-minutes` |
