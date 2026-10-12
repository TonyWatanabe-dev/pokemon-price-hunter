# Roadmap operacional — Pokémon TCG Price Hunter

> **Atualizado em:** 12/10/2026 às 05:55 (America/Sao_Paulo, UTC−03:00)
> **Base consultada:** `main` em `eb6554a1b84a88ffe0e45cbfb647518748e51e5e` (após PR #228); produção (Vercel), última evidência registrada, em `f66c929e10d50d6eae7cfb8ff4508599554a4e6c` (#217).  
> **Propósito:** fonte de contexto para Claude Code/agentes e para acompanhamento humano. Este arquivo documenta o estado observado; issue/PR/CI e execução real continuam sendo a fonte de verdade para cada entrega.
> **Plano até a entrega:** [docs/PLANO-ENTREGA-TURBO.md](./PLANO-ENTREGA-TURBO.md) — fases de produto, ciclo 24/7, agentes futuros, critérios de conclusão e política de notificação.

## Regras de operação

- Não fazer merge de PRs de produto, deploy, migration, nem alterar secrets/configuração de produção sem autorização explícita.
- Não marcar tarefa concluída apenas por label. Exigir diff versionado, testes apropriados e evidência verificável (CI/log/execução).
- Não presumir que o executor local `~/pph-executor` está sincronizado só porque `master` remoto está atualizado.
- Preferir trabalho remoto que não dependa do computador do usuário. Não inventar evidência de runtime.
- Manter branches/PRs pequenas e baseadas na `main` atual; evitar integrar branches empilhadas com conflitos.
- Não ligar `SHIPPING_CALC_ENABLED` sem validação real de cotação e autorização separada.

## Mapa de agentes

Detalhamento completo das responsabilidades, limites, dependências, status de implementação e critérios de ativação: [docs/MAPA-DE-AGENTES.md](./MAPA-DE-AGENTES.md). O inventário separa o que Claude já implementou no código do que ainda é futuro e exige pré-requisitos/aprovação. As capacidades futuras de UX Research, UI & Design System, Social Media, SEO & Content, Growth & CRO e Brand & Creative não devem ser iniciadas agora.

## Contrato de autonomia e comunicação

- **Executor:** Claude Code conduz o desenvolvimento ponta a ponta. Não pede permissão para commits, branches, PRs, resolver CI ou continuar trabalho seguro. Merge/deploy são automáticos para R0/R1 e R2 quando Release Governor, permissões técnicas, CI, auditoria e smoke aplicáveis aprovarem.
- **Fronteira:** `tarefas.yml` continua branch + PR. Não conferir ao worker poderes novos para merge/deploy; usar Release Executor Bridge/Governor. R3 e R-STOP continuam a exigir intervenção do proprietário e não podem ser contornados.
- **Relatórios:** atualizar este arquivo somente com evidências reais, inclusive ao final de cada fase. O relatório de fase inclui critérios de saída, PRs/commits, CI, merges/deploys/smoke, métricas disponíveis, estabilidade, pendências e fase seguinte.
- **Canal do usuário:** o monitor do ChatGPT deve apresentar os relatórios quando uma fase completar seus critérios e notificar antes quando existir ação crítica realmente não aprovável automaticamente. Sem atualizações repetitivas a cada PR; não confundir a verificação horária do monitor com alerta instantâneo.
- **Bloqueio:** registrar no GitHub evidência, impacto, recomendação e uma única decisão necessária. Continuar tarefas independentes e seguras enquanto o bloqueio persistir.


## Atualização operacional — 12/10/2026 (pós-PRs #252 e #250)

### Evidências confirmadas
- PR [#252](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/252) integrada: `claude_despacho` permite explicitamente `github-actions` e o teste de contrato restringe a exceção à etapa de despacho; sem wildcard e sem alteração do caminho acionado por `issues`.
- PR [#250](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/250) integrada: `.github/workflows/dispatcher.yml` contém `workflow_run` para iniciar o Dispatcher após o workflow “Vigia do robô” concluído na `main`, além do cron e do acionamento manual.
- O run [Dispatcher #5](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/actions/runs/38225705913) terminou com sucesso antes do merge da #250, mas a #247 ficou em backoff até `2026-10-12T08:59:02Z` (05:59, horário de Brasília). Esse run não comprova o novo gatilho pós-merge nem a execução bem-sucedida da Claude Code Action.
- A última execução observada de “Vigia do robô” antes do merge da #250 foi [run #38226234736](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/actions/runs/38226234736), às 08:52 UTC. É anterior ao merge; portanto, ainda falta evidência de um evento `workflow_run` pós-merge.

### Próximas verificações obrigatórias
1. Capturar uma execução de “Vigia do robô” concluída na `main` depois do merge da #250 e confirmar que ela inicia automaticamente o Dispatcher.
2. No Dispatcher, confirmar o job `despacho` (não apenas `plano`) e verificar se a #247 foi despachada após o backoff, sem duplicar a chave nem remover labels manualmente.
3. No workflow `Tarefas`, verificar que a Claude Code Action executa sem a recusa de ator não humano e que o agente abre a PR documental esperada.
4. Registrar run IDs, commit, logs, PR e CI. Não declarar autonomia ponta a ponta concluída antes dessas evidências.

### Estado executivo atualizado
- Gatilho de workflow: implementado na `main`; validação automática pós-merge pendente.
- Despacho: o Dispatcher #5 executou com sucesso, mas respeitou o backoff da #247; o despacho posterior ao prazo ainda precisa ser comprovado.
- Claude Code: a allowlist restrita foi integrada; execução bem-sucedida após a correção ainda não comprovada.
- Gate de segurança: não usar bypass de branch protection, não usar `allowed_bots: "*"` e não manipular manualmente a chave/labels para contornar backoff.


## Validação em runtime — 12/10/2026, 09:06–09:45 UTC

Esta seção responde às "Próximas verificações obrigatórias" acima. Evidências lidas da API do GitHub; os horários estão em UTC.

| Etapa | Resultado | Evidência |
|---|---|---|
| Vigia na `main` depois do merge da #250 → Dispatcher automático | ✅ **comprovado** | Vigia `38227708569` concluído às 09:06:23 → Dispatcher por `workflow_run` [38227741030](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/actions/runs/38227741030) às 09:06:25. Repetiu às 09:22 (Vigia → Dispatcher → despacho de #257). |
| Job `despacho` real e backoff | ✅ **comprovado** | #247 tentativa 1 às 08:29:02; tentativa 2 só às 09:06:38, depois dos 30 min. Chave `dispatch:247:2`, sem repetição. |
| Worker pelo caminho `workflow_dispatch`, Claude Code Action sem recusa de ator (#252) | ✅ **comprovado** | Issue #257 → worker [38229495517](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/actions/runs/38229495517): `Validar despacho` ✅, `claude_despacho` ✅, issue marcada `executor:done`. |
| PR criada pelo agente | ✅ **comprovado** | PR **#258** aberta pelo `claude[bot]` na branch `tarefa/issue-257-t1`, commit com assinatura verificada, só o arquivo pedido, com `Closes #257`. CI `test`/`regression`/`golden` ✅. |
| Revisão independente da PR do agente | ✅ **comprovado depois da correção** | Primeiro `qa-review` da #258 recusado pela action ("non-human actor: claude"), com veredito fail-closed. Corrigido pela **#261** (integrada; a #259 ficou redundante). Depois de atualizar a branch da #258, o `qa-review` revisou a PR e **aprovou sem bloqueantes** (09:50 UTC). |
| Governor sobre a PR do agente | ⚠️ **defeito** | A `main` dava `R0 · autonomous` para a #258 com `qa-review` ❌. Correção: **#260** (exige `qa-review` no mesmo SHA). |
| #247 | ⚠️ **quarentena indevida** | O ciclo das 09:07:23 viu a tentativa 2 (em curso) como concluída, por causa do label `executor:failed` da tentativa 1, e aplicou quarentena. O worker recusou a tentativa 2. Correção: **#256** (lease pela tentativa atual; reinício só por operador). O label **não** foi removido manualmente. |
| #255 | ℹ️ **sem defeito** | Tarefa de relatório pelo caminho de label: o Claude terminou com sucesso sem PR, e o worker marcou `executor:failed` por desenho (só conta como entregue com PR). |

**Testes:**
- **Local:** `npm test` passou nas branches #256, #259 e #260. A única falha é o teste de busca sem acento, que falha só no ambiente local e passa na CI.
- **CI:** `test`, `regression` e `golden` passaram nas três; `qa-review` passou na #256 e na #259.
- **Regressão da #256:** o teste reproduz o incidente com os horários reais e falha na `main` anterior.

**Pendências com causa concreta:**
- Merges R3 (aprovação humana obrigatória): #256, #260, #254 (ou esta PR, que a inclui), #248 e #221. A #259 é redundante com a #261.
- **#247:** só um operador pode tirar `executor:quarentena`. Depois da #256, isso abre uma nova tentativa (`dispatch:247:3`).
- **Proteção da `main`:** tornar `qa-review` check obrigatório. A aprovação humana obrigatória impede merge autônomo, inclusive R0 (#231, item 8).
- **Ponte (#221):** o sink de auditoria e o `VERCEL_TOKEN` não estão definidos. Merge e deploy governados continuam inoperantes.
- **Rotina agendada do Claude Code:** não criada.

**Próxima prioridade objetiva:** integrar a #260 e a #256. A #258 já tem os 4 checks ✅ e o Governor, pela política da #260, dá `R0 · autonomous`, mas o merge depende da aprovação obrigatória e da Ponte (#221). Depois, a Ponte (#221), após a decisão do sink de auditoria.

## Estado executivo

### Meta de operação 24/7 — lacunas para fechar
**Coleta periódica e watchdog estão codificados; desenvolvimento autônomo de ponta a ponta ainda precisa do Planner/Dispatcher.** O plano completo está em [PLANO-ENTREGA-TURBO.md](./PLANO-ENTREGA-TURBO.md).

- Hunter `hunter.yml`: cron a cada 15 min, mínimo entre rodadas de 8 min por padrão e descoberta/Copag diária. Schedule do GitHub é best-effort; verificar cron-job.org e a saúde real dos dados para comprovar continuidade.
- Vigia `watchdog.yml`: cron de fallback a cada 30 min e configuração documentada para disparo externo a cada 15 min. A existência do workflow não prova que o cron externo está ativo: verificar runs `workflow_dispatch`, teste de notificação e recuperação.
- Executor Claude: já foi validado em smoke real (#225 → PR #228 → CI verde), mas ainda depende de issue/label; não existe ainda Dispatcher de backlog comprovado que selecione e envie tarefas elegíveis sem ação por tarefa.
- Concorrência: workflow suporta 1–10, padrão 3. Confirmar `TAREFAS_MAX=10` em Actions Variables antes de anunciar 10 workers ativos. Realizar teste gradual antes de manter 10 em uso contínuo.
- Release: manter separação dos workers de implementação e do Release Governor. Nenhum worker de tarefa ganha permissão de merge/deploy; release bridge precisa de configuração, CI, gates e smoke real comprovados.
- Decisões R3/bloqueios acionáveis devem ser registrados com evidência e recomendação; aviso ao usuário por meio do monitor de projeto do ChatGPT já configurado. Telegram/ntfy seguem para incidentes operacionais, não como substituto da aprovação de decisão.


### Gestão adaptativa de esforço e consumo Claude — prioridade Fase 0
**Objetivo:** manter a fábrica progredindo sem desperdiçar tokens ou esgotar a cota com sessões desnecessárias.

- Classificar tarefas de forma determinística usando tipo, risco, escopo, dependências e falhas anteriores; não chamar um modelo separado para tarefas simples só para escolher esforço.
- Ajustar esforço por sessão/tarefa com os parâmetros oficialmente suportados pelo modelo/runtime real. Início orientativo: Low (mecânico/documentação), Medium (desenvolvimento comum), High (depuração/arquitetura), nível máximo suportado somente em exceções justificadas. Não reduzir análise de R3/segurança.
- Roteamento de modelos econômicos apenas quando suportado e validado; revisão independente continua obrigatória.
- Concorrência adaptativa, retries limitados, backoff para quota/rate limit, fila persistente, checkpoint/retomada, idempotência e controle contra ciclos de tentativas caras. Em falta de cota, preservar estado e aguardar capacidade; não contornar limites.
- Instrumentar modelo/esforço/tokens/cache/duração/custo apenas se dados reais estiverem disponíveis. Medir custo por PR aprovada, retrabalho e qualidade; documentar métricas indisponíveis em vez de estimar ou inventar.
- Validar em sandbox/CI com tarefas representativas e comparar consumo junto com sucesso, regressões e defeitos; economia não pode relaxar testes, revisão, segurança ou governança.
- **Estado:** requisito incorporado ao plano; implementação ainda não declarada como concluída. Próximo passo é auditar o executor real e abrir PRs pequenas cobrindo configuração por sessão, budget/queue/retry e telemetria conforme dependências.

### Executor paralelo do Claude Code — GitHub Actions
**Status: primeira execução ponta a ponta comprovada; capacidade instalada para até 10 tarefas, mas valor de concorrência ativo ainda precisa ser conferido/configurado.**

- Workflow: [`.github/workflows/tarefas.yml`](../.github/workflows/tarefas.yml). Uma issue aberta, criada por operador autorizado, recebe `executor:github` e inicia uma sessão isolada numa branch `tarefa/*`; o resultado esperado é uma PR para `main`.
- Segurança integrada pelas PRs [#224](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/224), [#226](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/226) e [#227](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/227): trigger restrito a operadores; permissões mínimas; ação Anthropic fixada por SHA; runner `ubuntu-24.04-firewall`; allowlist de saída sem wildcards; PostgreSQL descartável para teste; pré-checagem do secret; relatório de falhas; nenhuma permissão de merge ou deploy no workflow.
- [Smoke test #225](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/issues/225) concluído. [Run #38189573700](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/actions/runs/38189573700) terminou `success`: container/runner, `npm ci`, validação da credencial e Claude Code Action passaram; o agente abriu a [PR #228](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/228), limitada a documentação. A execução reportou `npm test` com exit 0; a [CI da PR #228, run #38189888732](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/actions/runs/38189888732) também terminou `success`. A PR #228 foi integrada por squash no commit `eb6554a1b84a88ffe0e45cbfb647518748e51e5e`.
- Diagnósticos que levaram ao sucesso: [#38188101767](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/actions/runs/38188101767) identificou hostname ausente na allowlist; [#38188341990](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/actions/runs/38188341990) identificou secret Claude ausente; a correção de rede entrou na #226 e o preflight fail-fast na #227. Não repetir essa investigação sem novos sinais.
- Documentação operacional e de troubleshooting: [`docs/tarefas-paralelas.md`](./tarefas-paralelas.md). Labels: `executor:github` agenda, `executor:running` executa, `executor:done` significa execução bem-sucedida com PR aberta, `executor:failed` exige consultar o comentário/log.
- **Concorrência:** o código suporta `TAREFAS_MAX=1..10`; sem a variável de Actions, o padrão é **3**, não 10. Próxima ação operacional é confirmar/criar a variável em **Settings → Secrets and variables → Actions → Variables → `TAREFAS_MAX=10`**. A ferramenta de acesso usada nesta atualização não confirma nem altera variáveis de Actions, então não declarar que 10 vagas já estão ativadas até verificar a configuração na conta.
- Atingir 10 vagas significa até 10 sessões Claude simultâneas — uso de cota maior e mais conflitos se várias tasks alterarem os mesmos arquivos. Decompor trabalho por áreas/arquivos, não enfileirar PRs concorrentes que modificam `package.json`, `index.html`, `api/v1.mjs` ou o mesmo workflow sem dependências definidas.
- **Limite inviolável:** este runner só produz branch + PR; nunca merge, deploy, migration ou escrita em banco de produção. Merge/deploy rotineiros pertencem ao processo Release Governor separado e só podem avançar com gates e evidência. R3 (segurança, secrets, permissões, migrations críticas, dados/impacto financeiro) escala ao humano conforme a política; este roadmap não concede exceções.

### Ciclo autônomo de release (Release Governor + Executor Bridge)
**Status: merge R0 ponta a ponta comprovado; deploy pelo código bloqueado por credencial; ponte aguardando merge humano (R3).**

- Governor e auditoria (`src/agents/release-governor*.js`) estão na `main`. Checks da CI: `test` (com PostgreSQL), `regression`, `golden`.
- [PR #221](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/221) — Release Executor Bridge (`runMerge`/`runDeploy`, lock `pg_try_advisory_lock`, idempotência, fail-closed, smoke, CLI `tools/release-run.mjs`). 27 grupos de testes (mocks + PostgreSQL descartável) no `npm test`; CI verde. **R3 pela política: merge humano obrigatório**, o Governor bloqueia o merge autônomo dela.
- Ciclo real executado em 11/10 com o código da #221: [PR #222](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/222) (só `docs/`) → CI verde → Governor `R0 / autonomous` com evidência lida da API do GitHub → merge pela ponte com SHA fixado (`593f673`) → auditoria `RELEASE_GOVERNOR_DECISION` ×2 + `RELEASE_EXECUTION` started/succeeded → repetição respondeu idempotente → deploy decidido como `not_required` (docs-only, sem tocar na Vercel). A auditoria desse ciclo ficou num PostgreSQL local descartável, não no banco de produção.
- **Não comprovado ainda:** deploy + smoke de produção pela ponte. Faltam (a) `VERCEL_TOKEN` no ambiente do executor e (b) um PR R1/R2 elegível. O sandbox do Claude não alcança `*.vercel.app` nem `api.vercel.com`, então o smoke precisa rodar no executor ou numa Action.
- **403 "Not authorized to access scope tonywatanabeart-1457s-projects":** a conta do usuário (via integração Vercel) acessa normalmente o time `team_lQeGJ3CtqA0g9zbhvrcAxY8h` (slug `tonywatanabeart-1457s-projects`) e o projeto `prj_Y4MFVCbc8h7aqX9pMSnwcY1TwH5b`. O 403 vem do token/CLI usado no executor, que pertence a outra conta ou foi criado com escopo diferente desse time. Correção (humana, no painel da Vercel): criar um token com escopo **tonywatanabeart-1457's projects** e guardá-lo como secret do executor/Action (`VERCEL_TOKEN`, `VERCEL_TEAM_ID=team_lQeGJ3CtqA0g9zbhvrcAxY8h`). Nunca colar em chat, terminal compartilhado, log ou arquivo versionado.
- Hunter Orchestrator: passo "Agentes (fila de revisão)" do workflow `hunter.yml` com `success` em todas as rodadas de 15 min observadas em 11/10, sem anotações de aviso. Testes: orquestrador 16 (puro) + 5 (banco), integração 9, revisão humana 13. O workflow de revisão nunca foi acionado manualmente.


### Fase 1 — Confiabilidade operacional e executor
**Status: código remoto avançou; sincronização do runtime local ainda não confirmada.**

- Repositório privado do executor: [pokemon-price-hunter-executor](https://github.com/TonyWatanabe-dev/pokemon-price-hunter-executor).
- Último `master` confirmado na auditoria: `5de582bf67312c2e43f30b84d689a79448cebfb8`.
- PRs #7 e #8 integradas; CI verde registrado. A PR #8 reportou 139 testes aprovados e zero falhas.
- [Issue #31 — versionar executor e preservar estado](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/issues/31): fechada com `executor:done`, mas falta confirmação atual do runtime local após as últimas integrações.
- [Issue #30 — idempotência e recuperação](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/issues/30): histórico remoto de código/testes e recuperação registrado; não confundir esse histórico com prova de que a máquina está executando a versão atual.
- [Issue #33 — circuito completo e canário com entrega](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/issues/33): já existe; canário histórico e CI foram documentados. Não criar issue duplicada.
- **Bloqueio humano único quando voltar ao computador:** seguir o README do executor para verificar fila/estado, parar com segurança, atualizar por fast-forward sem sobrescrever alterações, rodar a suíte e reiniciar/verificar PID + heartbeat + log + blob do script. Não executar atualização cega enquanto o processo estiver ativo.

### Fase 2 — Comparador confiável e dados
**Status: núcleo em evolução; consolidar lacunas e validar regressões antes de expandir.**

Prioridades:
1. Matching conservador de produtos e variantes, sem falsos positivos.
2. Preço/estoque/frete com origem, validade e incerteza explícitas.
3. Alertas comparáveis apenas na mesma base de frete; frete desconhecido nunca é zero.
4. Integridade do Opportunity Engine e coerência entre robô, API, home e banco.
5. Busca sem acentos e robustez dos dados, validando as PRs/issues ativas antes de iniciar trabalho duplicado.

### Fase 3 — Experiência de compra
- Fluxo de busca e comparação claro, landing/home com hierarquia visual de ecommerce, cards e estados de carregamento/erro/vazio.
- Acessibilidade, responsividade e navegação mobile.
- Frete por CEP: [PR #195](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/195) — draft. Em 11/10 a `main` foi integrada na branch (`d732af8`; conflito só no script de teste, as duas listas preservadas). Bloqueios: revisão humana, tirar de draft (decisão do usuário) e, para ativar, validação real de cotação + autorização separada. `SHIPPING_CALC_ENABLED` segue desligada.

### Fase 4 — Retenção e alertas
- Watchlist, notificações confiáveis, deduplicação/anti-spam, preferências e estados claros.
- Alertas de queda devem refletir novo melhor preço comparável, sem confundir uma oferta isolada com oportunidade real.
- Respeitar opt-in, limites e proteção de dados.

### Fase 5 — Inteligência de mercado
- Explicabilidade de scores e oportunidades, qualidade das referências oficiais, validade das evidências e distinção entre preço oficial confirmado e referência pendente.
- [PR #186 — política Copag](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/186): draft, CI verde e sem conflito em 11/10, 11 commits atrás da `main`. Bloqueio único: decisão comercial do responsável sobre os 11 produtos cuja referência vinha do Instagram. Manter em draft até essa decisão.
- [PR #20 — migration Copag](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/20): marcada explicitamente como **NÃO INTEGRAR sem autorização**; pode executar migration em produção e alterar notas do Opportunity Engine. Em 11/10: draft, com conflito, 152 commits atrás da `main`; a parte de política foi extraída para a #186. Não fechar sem decisão do usuário.

### Fase 6 — Segurança, escala e automação
- Segurança de workflows, cadeia de dependências, TLS, proteção de configuração e regras do Firestore versionadas.
- A PR #17 foi relatada como integrada em 11/10; confirmar o estado de CI/deploy por evidência específica antes de alegar que está publicado.
- Regras Firebase/Firestore e alterações de produção devem seguir revisão e procedimento de rollback; documentação ou commit não substituem confirmação do estado real do console.
- Agentes futuros de UX Research, UI/Design System, Social Media, SEO/Content, Growth/CRO e Brand/Creative permanecem **planejamento futuro**, não iniciar até produto/infra estarem maduros e haver autorização explícita.

## Próximos passos ordenados

1. **Esforço/custo adaptativos:** auditar o executor para configurar esforço por sessão, roteamento de modelo suportado, orçamento, retries/backoff, fila retomável e métricas de consumo. Validar economia junto com qualidade antes de aumentar workers.
2. **Fábrica 24/7:** conferir `TAREFAS_MAX`, operadores autorizados, app/secret Claude e runner de firewall; confirmar cron-job.org para Hunter/Vigia e o fluxo de aviso/recuperação. O valor atual da variável e o cron externo não são verificáveis apenas pelo código do repo.
3. **Planner + Dispatcher + QA Reviewer:** implementar fila de issues pré-aprovadas, seleção por dependência/risco/arquivos, despacho idempotente, quarentena/retry e revisão independente. A action atual continua por label até que o novo dispatcher tenha CI e testes; não relaxar permissões do trigger.
4. **Release bridge (#221):** revalidar PR/diff/checks, cumprir o gate humano R3 estabelecido, configurar credencial Vercel no ambiente seguro e provar deploy + smoke com um PR elegível. Não confundir merge com publicação.
5. **Dados e matching:** usar as issues existentes de contratos de coletores (#47/#103/#106), matching (#42/#109/#110), preço/moeda (#79), frescor/histórico (#104/#46/#112/#113), dedupe (#78) e referência Copag (#41). Não duplicar issues.
6. **Fluxo do site:** busca/detalhe/comparação (#43), estados vazios/loading/erro (#83), acessibilidade/mobile (#82/#98), erros seguros (#100/#115), diretório de lojas (#55) e links/tracking (#116).
7. **Frete (#195/#84):** resolver conflitos e validar cotações reais da VTEX; manter flag desligada até smoke/rollout e autorização. Ampliar para outras plataformas somente via contratos reais de cada loja.
8. **Retenção e alertas:** favoritos/contas (#49/#86), quedas/restocks reais (#45), opt-in/dedupe/preferências (#85); provar isolamento entre usuários e entrega idempotente.
9. **Opportunity Engine e monetização:** score explicável (#44), histórico/fonte oficial, links Meli/Amazon e disclosure. A #186 exige decisão de negócio; #20 permanece bloqueada sem autorização específica de migration e plano de rollback.
10. **Ativar especialistas por dependência:** Catalog → Marketplace Health → Price Intelligence → Shipping Verification → Alert → Affiliate. UX Research, UI & Design System, SEO & Content, Social Media, Growth & CRO e Brand & Creative continuam futuros até produto/analytics/brand readiness e aprovação.
11. **Hardening + estabilidade:** segurança/dependências/SSRF (#94/#105), API/paginação/performance (#80/#81/#114), backup/restore/runbook (#87/#108/#118), painel de saúde (#92), SEO (#96) e E2E. Exigir sete dias de observação 24/7 com coleta, sync, fila, CI, deploy e recuperação verificados antes de declarar conclusão.

## Evidências recentes registradas

- 11/10 à noite: primeira execução do executor Claude Code Actions concluída ponta a ponta; run #38189573700 success; smoke issue #225; PR #228 mergeada após CI #38189888732 success; merge commit `eb6554a1b84a88ffe0e45cbfb647518748e51e5e`.
- Configuração de concorrência `TAREFAS_MAX`: o workflow aceita até 10, mas o default de código é 3. O valor real configurado nas Actions não foi verificável pela conexão usada nesta revisão; confirmar e configurar como `10` antes de lançar a fila em escala.
- Hardening do executor verificado nesta etapa: correção da allowlist Docker na #226 e preflight de credencial na #227. CI dessas PRs: runs #38188177289 e #38188485587, ambos success.
- 11/10: `main` `593f673` (merge da #222 pela Release Executor Bridge); produção `f66c929` (#217, deploy `dpl_GxgGmsGFysrbi8AgZ1oaMNN861Mw` READY). A diferença main→produção é só Governor/CI/docs, que o site não importa.
- Base de referência anterior: commit `0e3adbfd6d143c637e5f695014a7e2de99a77475` — documentação do deploy da Fase 6C.0 (#212) em produção.
- Executor privado: `master` `5de582bf67312c2e43f30b84d689a79448cebfb8` (última SHA confirmada na auditoria do executor; conferir novamente antes de agir).
- PRs/Issues vinculadas: [#31](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/issues/31), [#30](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/issues/30), [#33](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/issues/33), [#195](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/195), [#186](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/186), [#20](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/20).


## Atualização operacional — autonomia dos agentes (12/10/2026, revisão mais recente)

> Esta seção prevalece sobre notas anteriores deste arquivo que descrevam o ciclo Planner/Dispatcher/worker/revisor como ainda não comprovado. As evidências históricas permanecem preservadas para auditoria.

### Estado do ciclo de desenvolvimento autônomo

- **Comprovado em runtime:** Vigia → Dispatcher → worker Claude Code → PR do agente → revisão independente qa-review → classificação pelo Release Governor. O canário #257 gerou a PR #258, com commit verificado e CI verde; qa-review aprovou a mesma SHA e a PR foi integrada.
- **Correções integradas reportadas:** #250 (gatilho do Dispatcher após o Vigia), #252 (ator github-actions restrito ao despacho), #256 (lease/quarentena considera a tentativa atual), #260 (Governor exige qa-review aprovado na mesma SHA) e #261 (revisor aceita PRs de agentes sem abrir a allowlist de forma ampla). #243/#244/#246 também integram partes do Dispatcher, QA e classificação de esforço.
- **Esforço adaptativo:** classificador integrado; ligação ao worker reportada como concluída/destravada. Isso não equivale a telemetria real de tokens/custos, que continua sendo a próxima tarefa técnica.
- **Limpeza reportada:** #254 e #259 foram fechadas sem merge por redundância; #247 foi concluída com o canário #257/#258. Revalidar no GitHub antes de usar estes itens para decisões futuras.
- **Conclusão:** a cadeia funcional foi demonstrada, mas isso ainda não prova operação 24/7 sustentada nem autonomia completa de release/deploy.

### Lacunas para a fábrica 24/7

1. **Telemetria real por execução (próxima tarefa técnica):** instrumentar modelo/esforço efetivamente usados, tokens de entrada/saída/cache e custo apenas quando disponibilizados pelo runtime/provedor; duração, tentativas, resultado, escaladas e custo por tarefa/PR aprovada. Não estimar nem inventar valores. Incluir logs sanitizados e testes.
2. **Rotina recorrente:** ativar a rotina horária pelo mecanismo de agendamento disponível e validar execuções consecutivas, idempotência, ausência de duplicação e aviso de incidentes. O arquivo rotina-horaria-prompt.md contém o roteiro; a rotina não deve ser declarada ativa sem confirmação de execução real.
3. **Concorrência:** confirmar TAREFAS_MAX nas Actions Variables. O workflow suporta até 10, mas o padrão no YAML é 3; não anunciar 10 workers ativos sem comprovar o valor configurado e a estabilidade.
4. **Release Governor / bridge #221:** continua bloqueada por gate humano R3. A ponte não deve ser considerada operacional para deploy até concluir a revisão/decisão de auditoria, configurar VERCEL_TOKEN com segurança e comprovar deploy real + smoke pós-deploy de um SHA elegível.
5. **Auditoria de release:** a decisão do sink ainda depende do proprietário. A recomendação documentada é começar com comentários append-only no GitHub (opção C); isso é recomendação, não decisão aprovada.
6. **Proteção da main:** confirmar nos Settings os checks obrigatórios e manter PR, test, regression, golden e revisão independente. Não contornar branch protection nem converter qa-review em aprovação humana.
7. **Burn-in operacional:** reunir evidências por sete dias de scheduler, coleta/frescor, sincronização, fila, CI, releases, smoke e recuperação antes de declarar a fábrica 24/7 concluída.

### Decisões e limites

- A issue [#231 — decisões pendentes do proprietário](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/issues/231) continua sendo o registro único de decisões humanas: sink de auditoria, credencial Vercel segura, configuração de proteção/checks e ativação de rotina.
- O executor de tarefas continua responsável por branch + PR; merge/deploy só pela ponte e pelo Governor, com permissões próprias e evidência. R3 e R-STOP continuam bloqueados até a decisão/autorização exigida.
- Não alterar nem ativar automaticamente SHIPPING_CALC_ENABLED; #195 permanece dependente de cotação real e autorização. #186 continua dependendo da decisão comercial Copag; #20 permanece explicitamente **NÃO INTEGRAR** sem autorização específica.
- Enquanto existir bloqueio humano de release, continuar em paralelo as tarefas R0–R2 pré-aprovadas e independentes. Notificar o usuário apenas por marco material, incidente crítico ou decisão real, não por cada PR.
- Critério de sucesso: cadeia autônoma comprovada + rotina recorrente real + métricas observáveis + governança de release validada + sete dias de estabilidade. Uma execução canário bem-sucedida não substitui esses critérios.

---
*Este roadmap é um resumo operacional versionado. Atualizar data/hora e evidências em cada revisão; nunca substituir validação de CI/runtime/produção por texto de status.*
