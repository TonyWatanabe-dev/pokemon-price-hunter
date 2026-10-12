# Agentes — Hunter Orchestrator (F7, lote 1)

Fila de jobs de agentes sobre `automation_job` (migration 001; nenhuma migration nova).

## Regras

- **IA opcional.** Sem `AI_AGENTS_ENABLED=1`, jobs de handlers com `ai: true` ficam `blocked` (`ai_disabled`) sem consumir tentativa. O resto do sistema não muda.
- **Agentes só propõem por padrão.** Handler de IA não pode ser registrado em `price`, `score`, `ranking`, `opportunity`, `offer` nem `reference`. O Orchestrator escreve apenas em `automation_job` e `system_event`; o handler de referência escreve apenas em `review_item` (status `open`). Qualquer ampliação de escrita precisa de contrato, testes e permissões explícitas.
- **Autonomia operacional autorizada por política.** Agentes podem preparar, validar, aprovar tecnicamente, fazer merge de PRs e executar deploys de baixo/médio risco quando todos os gates objetivos desta documentação forem satisfeitos. Não devem pedir confirmação humana a cada PR ou deploy rotineiro.
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

## Autonomia de merge e deploy

### Responsável pela autorização: Release Governor

O **Release Governor** (agente de governança de release, também chamado *Release Authorization Agent*) é responsável por decidir automaticamente se uma mudança pode avançar, aplicando esta política versionada. Ele coordena a avaliação de risco e registra a decisão; não pode ignorar os gates nem conceder a si próprio exceções. Os agentes especialistas implementam e testam; o Orchestrator coordena jobs; o Release Governor classifica o risco, verifica evidências e autoriza ou bloqueia merge/deploy conforme as regras abaixo.

A autorização é **por política e evidência**, não por aprovação manual a cada operação. O agente só pode executar ações que os tokens, permissões de GitHub/Vercel e regras de branch já permitam. Não deve pedir nem armazenar credenciais fora dos mecanismos secretos oficiais.

### Regra operacional: autonomia ponta a ponta sem confirmações rotineiras

A diretriz do proprietário do projeto é que Claude Code trabalhe ponta a ponta e não peça autorização para operações rotineiras. Quando houver ferramentas/permissões disponíveis e todos os gates objetivos forem aprovados, os agentes devem automaticamente:

- criar e atualizar branches/worktrees isoladas e commits;
- abrir e atualizar PRs, corrigir falhas de CI, solicitar revisão independente e reexecutar os checks necessários;
- fazer merge pelo mecanismo governado e deploy dos commits elegíveis, executar smoke tests, verificar saúde pós-deploy e aplicar rollback automático somente quando seguro;
- atualizar issues, evidências e o roadmap e iniciar a próxima tarefa segura, sem perguntar “posso continuar?”, “posso commitar?”, “posso abrir PR?”, “posso fazer merge?” ou “posso publicar?”;
- continuar tarefas independentes se uma tarefa ficar bloqueada.

Esta diretriz concede autonomia às operações que a política já classifica como automaticamente aprováveis; **não** revoga R3/R-STOP, não concede permissões técnicas ausentes, não habilita secrets/feature flags por inferência e não autoriza ignorar falhas. O worker de `.github/workflows/tarefas.yml` segue limitado a branch + PR; merge/deploy devem passar pelo Release Governor/Bridge com as credenciais e gates próprios.

### Relatório de fase e comunicação com o proprietário

- Claude Code não deve enviar atualizações rotineiras nem pedir validação ao proprietário a cada PR. Ao concluir uma fase inteira, com todos os seus critérios de saída comprovados, atualizar `docs/ROADMAP-OPERACIONAL.md` com resultado, evidências/links, merges, deploys/smoke, métricas, pendências e fase seguinte.
- O monitor de projeto no ChatGPT é o canal para entregar um relatório por fase concluída. Entre fases, não emitir relatórios repetitivos de progresso.
- Se houver uma ação que não possa ser aprovada automaticamente, um R3, R-STOP persistente, incidente crítico ou decisão comercial que realmente exija o proprietário, registrar no GitHub o motivo, evidências, risco, recomendação e a única decisão necessária; o ChatGPT deve avisar o proprietário com esse contexto.
- Até haver evidência de conclusão de fase, continuar as tarefas elegíveis. Não declarar fase concluída só porque PRs foram abertas ou merged; aplicar critérios de saída e smoke/observação exigidos.

### Níveis de risco

| Nível | Exemplos | Comportamento |
|---|---|---|
| **R0 — rotineiro e reversível** | Docs, testes, lint, refatoração interna sem mudança de comportamento | Autonomia total: validar, marcar PR pronta, fazer merge e publicar quando aplicável. |
| **R1 — funcional de baixo risco** | Correções isoladas, UI sem impacto em dados críticos, ajustes de telemetria | Merge/deploy autônomos após todos os gates, testes relevantes e smoke tests verdes. |
| **R2 — mudança de produto controlada** | Regras de matching, catálogo, coleta, alertas, afiliados, cálculo de frete ou alteração de comportamento visível | Autonomia somente se houver testes de regressão/golden, rollout gradual ou feature flag desligada por padrão, métricas/rollback definidos e validação automatizada. O agente deve manter a feature desativada até cumprir os critérios de lançamento. |
| **R3 — crítico / alto impacto** | Migração destrutiva, alteração irreversível de dados, exposição de segredos/dados pessoais, permissões amplas, segurança/autenticação, cobrança/pagamentos, mudança de preços ou ranking em massa, desativar proteções, incidente de produção ou rollback que possa causar perda de dados | **Bloquear e escalar ao humano.** Não fazer merge, deploy, migração nem ação externa até autorização humana explícita. |
| **R-STOP — evidência insuficiente** | CI inconclusivo, checks ausentes, conflito, diff não entendido, origem de dados incerta, monitoramento indisponível ou rollback não confiável | Bloquear. Não interpretar falta de evidência como aprovação. Pedir intervenção apenas se o bloqueio não puder ser resolvido automaticamente com segurança. |

### Gates obrigatórios para merge autônomo

O Release Governor só pode autorizar merge se todos forem verdadeiros:

1. PR aberta, diff e arquivos alterados inspecionados; escopo corresponde ao objetivo declarado.
2. CI obrigatório concluído e verde; testes de regressão/golden e testes específicos do domínio passam.
3. Sem conflitos, sem mudanças não relacionadas, sem segredos, dados pessoais ou dependências suspeitas.
4. Sem alteração direta de `main`; todo código passa por branch e PR.
5. Revisores/agentes independentes verificam o diff para mudanças R1/R2; quem implementou não deve ser o único avaliador.
6. Proteções de branch e permissões do GitHub continuam ativas; o agente não pode removê-las ou contorná-las.
7. Para R2, plano de rollout, feature flag, critérios de sucesso e rollback estão documentados e testados.
8. O merge usa SHA esperado da cabeça da PR; se a branch mudar depois da avaliação, recalcular a decisão.
9. A decisão e as evidências ficam registradas em audit log com PR, commit SHA, checks, nível de risco, política aplicada, agente decisor e motivo.

### Gates obrigatórios para deploy autônomo

1. Deploy apenas de commit já integrado por um merge autorizado e identificável.
2. Verificar checks de build, configuração/ambiente e migrations pendentes antes de publicar.
3. R2 exige canário ou rollout gradual quando disponível, smoke tests e monitoramento de erros, latência e métricas de negócio.
4. Verificar saúde pós-deploy; se falhar, interromper rollout e executar rollback automatizado apenas se for seguro e reversível.
5. Registrar URL/identificador do deploy, commit, resultados e eventual rollback.
6. Nunca ligar uma feature flag de lançamento só porque o código foi publicado. O lançamento da funcionalidade é uma decisão separada sujeita aos gates R2.
7. Se a Vercel ou o ambiente de produção não fornecer evidência verificável, bloquear a declaração de conclusão e escalar.

### Ações sempre escaladas ao humano

- R3, R-STOP persistente ou qualquer risco de perda/corrupção de dados, vazamento, indisponibilidade grave ou impacto financeiro/legal.
- Pedidos de segredo, permissões novas/ampliadas, mudança de política de segurança, alteração de proteção de branch ou desativação de auditoria.
- Migração destrutiva ou irreversível; mudanças em autenticação/autorização, pagamentos, cobrança, dados pessoais ou efeitos externos em massa.
- Incidente de produção em que a correção/rollback não seja claramente segura.
- Qualquer ação fora do escopo autorizado ou para a qual a evidência seja ambígua.

**Não escalar** por rotinas como criar branches/PRs, corrigir testes, atualizar documentação, resolver conflitos simples sem alterar intenção, fazer merge de R0/R1 aprovado, executar deploy rotineiro aprovado ou verificar smoke tests. Se houver incerteza material, classificar como R-STOP.

### Limites absolutos

- Nunca fazer push direto em `main`, force-push, remover proteções ou ocultar falhas.
- Nunca escrever diretamente em preços, score, ranking, oportunidade, oferta ou referência com saída não validada de IA. Alterações nesses domínios exigem serviço de domínio, evidência e testes; alterações em massa ou com impacto financeiro são R3.
- Nunca ignorar CI, vulnerabilidades críticas, falhas de golden tests ou alertas de segurança para cumprir prazo.
- Nunca marcar uma tarefa como concluída sem evidência verificável do merge/deploy e validação posterior.
- O Release Governor não pode aprovar exceções a esta própria política; mudanças na política de autonomia e nos limites R3 exigem revisão humana explícita.
- Permissões técnicas devem seguir menor privilégio. A política não cria permissões por si só: GitHub Actions, ambientes protegidos, Vercel e secrets precisam ser configurados separadamente para corresponder a ela.

## Avaliação offline com casos dourados

`npm run golden:eval` (ou `node tools/golden-eval.mjs --out relatorio.json`) e `test/golden-eval-tests.js` (dentro do `npm test`). Sem rede, banco, IA ou escrita; roda os módulos de produção (`matchProduct`, `reviewCandidates`, `calculateOpportunity`) sobre `test/golden/cases.json`.

- **Sintético, não é produção.** Os casos são escritos à mão (catálogo e lojas fictícios, hosts `.invalid`, sem dados pessoais ou segredos). Os resultados medem regressão contra esses casos, nunca desempenho real do robô.
- **Matching:** falso positivo = casou o que devia ser recusado; produto errado = casou outro produto (conta como falso positivo); falso negativo = recusou o que devia casar. Cada caso também diz se deve virar revisão humana (`tipo_desconhecido`, `boosters_desconhecidos`, `colecao_ambigua`, `ean_divergente`, `baixa_confianca`) ou nenhuma.
- **Preço, frete, estoque:** limites de score, travas (`caps`), avisos e motivos esperados, e o sinal de frete (desconhecido é nulo, nunca zero).
- **Quando pedir revisão (oportunidade):** aviso `ANOMALY`, `TOO_GOOD` ou `UNCONFIRMED`.
- **Regressões:** `failures` lista caso, área, tipo, esperado e obtido; o comando sai com 1 se houver alguma. Mudança intencional de regra atualiza o caso no mesmo PR.

## Governança e permissões (issue #89)

`src/agents/governance.js` descreve e verifica; não concede acesso nem executa. Teste: `test/agents-governance-tests.js`.

- **Classes:** leitura (sempre ok); alteração em branch/PR (bloqueada em read-only); merge/deploy rotineiros são autorizáveis pelo Release Governor quando os gates desta documentação passam; migração destrutiva, segredos, notificações externas de alto impacto e escrita direta em produção permanecem restritos.
- **Padrão fechado:** ação desconhecida ou sem permissão (`grants`) é negada. Read-only nega tudo que não é leitura, mesmo com aprovação.
- **Aprovação:** a decisão automática do Release Governor vale só para a ação nomeada, commit e ambiente verificados. Não se estende a outras ações. A aprovação humana continua obrigatória para R3 e mudanças nesta política.
- **Auditoria:** `createAuditLog`/`guarded` registram ferramenta, objetivo, resultado (`ok`, `denied`, `failed`) e erro, com segredos redigidos (chaves sensíveis, tokens, URLs de banco). Toda decisão de merge/deploy precisa ser ligada a esse log, incluindo risco, evidências e resultado pós-deploy.
- **Estado de implementação (11/10/2026):** Release Governor v1.0.0 integrado na `main`, com classificação R0–R3 e decisões separadas para `pr.merge`, `deploy` e `deploy.verify`. O CI tem jobs independentes `regression` e `golden`. No repositório executor, o merge guard e o Deploy Agent opt-in foram integrados; o Deploy Agent permanece desligado por padrão.
- **Auditoria estruturada ainda em revisão:** PR #220 adiciona eventos auditáveis com SHA, ação, risco e fail-closed quando o sink falha; o CI passou, mas a PR continua draft. PR #12 do executor propõe exigir esse evento antes de qualquer autorização de merge e também depende da #220. Não considerar a cadeia de auditoria completa até ambas terem revisão humana, integração e testes de integração.
- **A política define o comportamento-alvo; não cria capacidade técnica.** A autonomia de desenvolvimento (branch, commit, PR, correção de CI e continuidade de tarefas) deve operar sem confirmações rotineiras. Merge/deploy automático só opera onde a Release Executor Bridge/Governor, o executor, os grants e o preflight estejam realmente integrados e saudáveis. Enquanto um destes pré-requisitos técnicos estiver ausente, não fingir que o merge/deploy aconteceu: manter a PR pronta, registrar o bloqueio no GitHub, continuar tarefas independentes e pedir ao ChatGPT que escale apenas a ação humana concreta que desbloqueia a ponte. Não pedir aprovação genérica para cada PR.
- A publicação Vercel exige token no secret oficial, vínculo/projeto e ambiente corretos, SHA de produção verificável, Preview READY quando aplicável, smoke tests e decisão `deploy.verify`. Não expor ou criar tokens por caminhos inseguros; CI verde ou deploy de GitHub Pages não comprova saúde do domínio Vercel.

## Evidência obrigatória (issue #36)

Proposta de `matching` sem `proposal.evidence` válido no contrato de `src/agents/evidence.js` (fonte, URL http(s), motivo, base `observado`/`inferido` e `status` coerente; ver `validateEvidence`) é payload inválido, mesmo que traga `url`, `title`, `why` ou `reason` soltos: o job vai direto para `failed`, sem retry e sem `review_item`. Auditoria da issue #36: fila, estados, idempotência, lease/retry/timeout, revisão humana e trilha (`REVIEW_DECIDED`) já existiam; não foi criado módulo novo.

Limitações: a execução é sequencial (sem concorrência paralela, por escolha); o estado `review` é representado por `review_item` aberto, não por status do job; não há tela própria para a fila.

## Ainda não integrado

Tela própria para a fila (hoje: Actions/CLI); rejeitar um caso de baixa confiança não remove a oferta já aceita; Catalog Agent com IA; integração executável do Release Governor com permissões reais do GitHub e deploy da Vercel.
