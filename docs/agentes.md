# Agentes — Hunter Orchestrator (F7, lote 1)

Fila de jobs de agentes sobre `automation_job` (migration 001; nenhuma migration nova).

## Regras

- **IA opcional.** Sem `AI_AGENTS_ENABLED=1`, jobs de handlers com `ai: true` ficam `blocked` (`ai_disabled`) sem consumir tentativa. O resto do sistema não muda.
- **Agentes só propõem.** Handler de IA não pode ser registrado em `price`, `score`, `ranking`, `opportunity`, `offer` nem `reference`. O Orchestrator escreve apenas em `automation_job` e `system_event`; o handler de referência escreve apenas em `review_item` (status `open`).
- **Idempotência.** `idempotency_key` única por job; mesma chave com outro tipo é erro. Efeitos colaterais também precisam ser idempotentes (ex.: `review_item.dedupe_key`), porque um timeout pode deixar a escrita acontecer depois.
- **Falhas.** Erro comum → `retry` com backoff (1 min, 2 min, 4 min… até 1 h). `PermanentError`, payload inválido ou resultado inválido → `failed` direto. Tentativas esgotadas → `failed` + evento `AGENT_JOB_FAILED`. Sem handler → `blocked` + `AGENT_JOB_BLOCKED`.
- **Timeout e lease.** Cada execução tem limite (`timeoutMs`, padrão 30 s) e recebe `signal` para abortar. Job `running` além da lease (120 s) volta para a fila; escrita tardia do worker antigo é ignorada (`locked_by`).

## Arquivos

- `src/agents/orchestrator.js` — `createOrchestrator({ store, handlers })` → `enqueue`, `runOnce`.
- `src/agents/stores.js` — `pgStore(pool)` (FOR UPDATE SKIP LOCKED) e `memoryStore()`.
- `src/agents/handlers/review-propose.js` — handler `review.propose`, sem IA.
- Testes: `test/agents-orchestrator-tests.js` (puro), `test/agents-db-tests.js` (`TEST_DATABASE_URL`).

## Ainda não integrado

Nenhum ponto do robô (`src/run.js`, workflows) enfileira nem executa jobs. Ver "O que falta" no PR/branch `agentes-orquestrador`.
