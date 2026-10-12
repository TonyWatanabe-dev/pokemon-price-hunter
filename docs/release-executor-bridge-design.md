# Release Executor Bridge

## Required invariants

- Fetch authoritative GitHub/Vercel evidence from provider adapters; never trust claims supplied by an agent.
- Evaluate the Release Governor and persist the decision before a side effect.
- Serialize work with a distributed lock; local-only mutexes are insufficient across workers.
- Re-fetch evidence immediately before merge/deploy and require the exact same SHA, base/head refs, checks, and deployment state.
- Any missing evidence, stale SHA, permission error, conflict, or audit failure blocks the action.
- Re-evaluate and persist a distinct authorization for merge and deploy; neither action grants the other.
- Persist the execution outcome with an idempotency key and exact SHA. An outcome-audit failure must not be reported as success.
- R3 remains human-required. Production migrations, secrets, and commercial policy decisions are never inferred from broad autonomy.

## Adapter contract

The executor must inject `readEvidence`, `withLock`, `execute`, and `auditSink`. `readEvidence` must query GitHub checks/PR metadata and Vercel deployment metadata directly. `withLock` must be distributed and release on all exits. `execute` must enforce least privilege and verify the final SHA after the provider confirms the operation.

## Rollout gates

1. Unit tests for stale evidence, missing permissions, duplicate workers, audit outage, and provider failures.
2. End-to-end dry run on a documentation-only PR.
3. Actual low-risk merge only after green checks and a fresh exact-SHA recheck.
4. Preview deployment and smoke tests before production.
5. Production deploy only after a separately evaluated Governor decision and a verified Preview.

## Sink de auditoria GitHub (opção C)

Status: **implementado, NÃO ativo.** A escolha do destino da auditoria continua aberta na #231 item 3; este código só entra em uso depois que o proprietário decidir pela opção C e configurar o ambiente do executor. Refs #237.

- `githubIssueAuditSink({ repo, issueNumber, expectedActor, api })` (`src/agents/release-adapters.js`) grava cada evento de auditoria como **um** comentário append-only na issue de auditoria: uma linha legível + marcador `<!-- ponte:auditoria v=1 {json} -->`.
- O JSON é sanitizado (`redact` da ponte + remoção de credenciais em URLs) e `<`, `>`, `&` são escapados (`<`...), então o marcador não pode ser fechado por conteúdo do evento. A linha legível só usa `[\w.:-]` (sem @menções nem links).
- Fail-closed: erro/timeout da API, status não-2xx, resposta sem `id`, ou leitura de volta (GET do comentário pelo id) com issue, autor ou `eventId` divergente → lança; como a auditoria vem antes da ação, a ponte não faz merge/deploy.
- Leitura (`auditEventsFromComments`) só aceita marcadores escritos pelo `expectedActor`; marcadores de outros autores são ignorados.
- Seleção só por configuração explícita em `tools/release-run.mjs`: `RELEASE_AUDIT_SINK=github` + `RELEASE_AUDIT_ISSUE=<n>` + `RELEASE_AUDIT_ACTOR=<login do executor>`. Sem `RELEASE_AUDIT_SINK` o comportamento é exatamente o anterior (PostgreSQL). Valor desconhecido, issue ausente/inválida ou ator ausente → saída 3 antes de abrir banco ou chamar o GitHub.
- Limite: lock distribuído e registro de resultado/idempotência (`pgAdvisoryLock`, `pgOutcomeStore`) continuam no PostgreSQL; este sink troca apenas a auditoria das decisões do Governor.
- Nenhum workflow, permissão, secret, política do Governor ou configuração de produção foi alterado. Testes: `test/release-audit-github-tests.js`.
