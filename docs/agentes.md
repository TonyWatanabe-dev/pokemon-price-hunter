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
- `src/core/review.js`, `tools/review.mjs`, `.github/workflows/review.yml` — revisão humana.
- `src/agents/matching-review.js`, `src/agents/notify.js`, `src/agents/cycle.js`, `tools/agents-run.mjs` — integração com a rodada.
- Testes: `test/agents-orchestrator-tests.js` (puro), `test/agents-db-tests.js` e `test/agents-integration-tests.js` (banco com `TEST_DATABASE_URL`).

## Na rodada do robô (lote 2)

Passo **Agentes (fila de revisão)** em `hunter.yml`, depois de "Sincronizar com o banco": preços, ramo `data`, estatísticas e oportunidades já estão gravados. Rodadas são serializadas (`concurrency: hunter`); o passo tem `continue-on-error`, `timeout-minutes: 2`, prazo interno de 45 s e `tools/agents-run.mjs` sempre sai com 0.

- **O que vira revisão** (`src/agents/matching-review.js`): anúncio Pokémon recusado por um único motivo específico (tipo não identificado, quantidade de boosters, duas coleções no título, EAN divergente) e oferta aceita com confiança ≤ 0,6. "Coleção não identificada" fica de fora (ruído). Até 25 novos por rodada.
- **Sem repetição:** chave por tipo + loja + página (URL sem query, sem `www`). A mesma página gera um único `review_item` (`matching:…`), mesmo depois de rejeitado ou com a fila limpa. Não colide com as revisões de duplicidade da sincronização (`dup:…`).
- **Avisos** (`src/agents/notify.js`): `AGENT_JOB_FAILED` e `AGENT_JOB_BLOCKED` novos viram uma mensagem agregada pelo canal do vigia (`sendAll`). Cursor `AGENT_ALERT_CURSOR` em `system_event` só avança se a mensagem foi entregue. `ai_disabled` não avisa.

## Revisão humana (lote 3)

- **Operar:** Actions → **Revisão** (`review.yml`) ou `node tools/review.mjs list | triage | approve | reject | dismiss | export`. Casos iniciais e sugestões: `docs/revisao-casos-iniciais.md`.
- **Quem decide:** login do GitHub em `REVIEW_OPERATORS` (variável do repositório; padrão: dono do repositório), ou `app_user` com a permissão `review.decide` (papéis OPERATOR, ADMIN, SUPER_ADMIN). VIEWER só lê.
- **Registro:** `status`, `decided_at`, `decision_reason`, `decided_by`/`decided_by_label`, `resolution` (migration 009) e um `REVIEW_DECIDED` em `system_event`, na mesma transação. Se o evento não grava, a decisão também não.
- **Sem duplicar:** `SELECT … FOR UPDATE` + `status = 'open'`. Repetir a mesma decisão não gera evento; uma decisão diferente, ou outra simultânea, é recusada (`already_decided`).
- **Aprovar:** só para `matching`, com coleção, tipo e boosters validados contra o catálogo e contra a coleção que o anúncio traz. O id do produto é calculado, nunca digitado.
- **Caminho até o matching:** `export` → `config/matching-overrides.json` num branch `review/overrides-*` para PR (nunca direto na `main`), que o robô só usa com `enabled: true`. O override só resolve tipo ou boosters não identificados, ou duas coleções no título, e só na loja e página revisadas. Não passa por cima de idioma, acessório, kit, EAN ou coleção divergente, e a trava de link continua valendo. Preço, score, ranking e oportunidade nunca são escritos pela revisão.

## Governança e permissões (issue #89)

`src/agents/governance.js` descreve e verifica; não concede acesso nem executa. Teste: `test/agents-governance-tests.js`.

- **Classes:** leitura (sempre ok); alteração em branch/PR (bloqueada em read-only); exige aprovação humana (`pr.merge`, `deploy`, `db.migrate.production`, `secrets.access`, `notify.real`); proibida (`main.push`, `git.force`, `db.write.production`).
- **Padrão fechado:** ação desconhecida ou sem permissão (`grants`) é negada. Read-only nega tudo que não é leitura, mesmo com aprovação.
- **Aprovação:** vale só para a ação nomeada e precisa de quem aprovou (`by`); não se estende a outras ações.
- **Auditoria:** `createAuditLog`/`guarded` registram ferramenta, objetivo, resultado (`ok`, `denied`, `failed`) e erro, com segredos redigidos (chaves sensíveis, tokens, URLs de banco). Quem grava é o `sink` (ex.: `system_event`); ligar isso a `AGENT_*` fica para a #36, sem duplicar aqui.
- **Fora de escopo:** o executor local segue `CLAUDE.md` e `docs/executor.md`; nenhum agente novo nem acesso novo foi criado.

## Ainda não integrado

Tela própria para a fila (hoje: Actions/CLI); rejeitar um caso de baixa confiança não remove a oferta já aceita; Catalog Agent com IA.
