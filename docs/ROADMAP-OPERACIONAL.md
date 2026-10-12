# Roadmap operacional — Pokémon TCG Price Hunter

> **Atualizado em:** 11/10/2026 às 23:00 (America/Sao_Paulo, UTC−03:00)  
> **Base consultada:** `main` em `790de4504f45dcf8aabfb38a07a660ef3dd707c1`; produção (Vercel), última evidência registrada, em `f66c929e10d50d6eae7cfb8ff4508599554a4e6c` (#217).  
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
- [PR #221](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/221) — Release Executor Bridge (`runMerge`/`runDeploy`, lock `pg_try_advisory_lock`, idempotência, fail-closed, smoke, CLI `tools/release-run.mjs`). **R3 pela política: merge humano obrigatório**, o Governor bloqueia o merge autônomo dela.
  - 11/10 ~23h: conflito com a `main` `790de45` resolvido (só o script `test` do `package.json`; listas das duas versões preservadas — merge `29fcd93` publicado pelo worker da #233, equivalente ao feito localmente).
  - Correção `62d0183`: o CLI não autodeclara mais `rollback.tested`/`rollout.*` como `true` (era alegação do executor, não evidência); deploy R2 pela ponte fica bloqueado até haver fonte verificável. +2 grupos de teste (R2 sem rollout bloqueia; nenhum workflow invoca a ponte; `allowedTools` do `tarefas.yml` sem `node tools/`, `gh api`, `gh pr merge` ou `vercel`).
  - CI no HEAD `62d01834941116a24c1287675a6fe1f065fab504`: [run 38193821300](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/actions/runs/38193821300) — `test` ✅ (`29 grupos de testes passaram`), `regression` ✅, `golden` ✅; `mergeable: MERGEABLE`; `reviewDecision: REVIEW_REQUIRED`.
  - Decisão do Governor registrada na PR ([comentário](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/221#issuecomment-6116402327)): `pr.merge` → **R3 / `human_required`** (`src/agents/` e `package.json` em `CRITICAL_PATHS`). **Decisão única do proprietário:** revisar e aprovar a #221.
- **Lacunas de governança observadas em 11/10 (não alteradas: R3/política):** a proteção da `main` exige 1 aprovação, mas `required_status_checks.contexts` está vazio — `test`/`regression`/`golden` não são exigidos tecnicamente pelo GitHub; `enforce_admins` está desligado. O `GH_TOKEN` (`contents: write`) do `tarefas.yml` está no `env` do job inteiro, visível também no passo do Claude; hoje a exigência de aprovação impede merge por esse token. Rollback automático (promover o deploy anterior) não existe na ponte: smoke de produção reprovado só registra `failed` com "considerar rollback".
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
3. **Planner + Dispatcher + QA Reviewer:** implementar fila de issues pré-aprovadas, seleção por dependência/risco/arquivos, despacho idempotente, quarentena/retry e revisão independente. A action atual continua por label até que o novo dispatcher tenha CI e testes; não relaxar permissões do trigger. **Estado (12/10):** etapa 1 do Dispatcher (#234) na [PR #240](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/240) — plano determinístico + `dispatcher.yml` só leitura; o despacho real ainda depende de `workflow_dispatch` validado no `tarefas.yml` (R3). Não declarar o critério "sem label manual" como cumprido.
4. **Release bridge (#221):** PR atualizada, sem conflito e com os três checks verdes no HEAD `62d0183`; aguardando o gate humano R3 (aprovação). Depois: configurar `VERCEL_TOKEN` no escopo correto no ambiente seguro e provar deploy + smoke com um PR R1 elegível. Antes de qualquer deploy R2: fonte verificável de evidência de rollout/rollback e rollback automático. A ponte **não** está operacional até merge governado + deploy real + smoke comprovados. Não confundir merge com publicação.
5. **Dados e matching:** usar as issues existentes de contratos de coletores (#47/#103/#106), matching (#42/#109/#110), preço/moeda (#79), frescor/histórico (#104/#46/#112/#113), dedupe (#78) e referência Copag (#41). Não duplicar issues.
6. **Fluxo do site:** busca/detalhe/comparação (#43), estados vazios/loading/erro (#83), acessibilidade/mobile (#82/#98), erros seguros (#100/#115), diretório de lojas (#55) e links/tracking (#116).
7. **Frete (#195/#84):** resolver conflitos e validar cotações reais da VTEX; manter flag desligada até smoke/rollout e autorização. Ampliar para outras plataformas somente via contratos reais de cada loja.
8. **Retenção e alertas:** favoritos/contas (#49/#86), quedas/restocks reais (#45), opt-in/dedupe/preferências (#85); provar isolamento entre usuários e entrega idempotente.
9. **Opportunity Engine e monetização:** score explicável (#44), histórico/fonte oficial, links Meli/Amazon e disclosure. A #186 exige decisão de negócio; #20 permanece bloqueada sem autorização específica de migration e plano de rollback.
10. **Ativar especialistas por dependência:** Catalog → Marketplace Health → Price Intelligence → Shipping Verification → Alert → Affiliate. UX Research, UI & Design System, SEO & Content, Social Media, Growth & CRO e Brand & Creative continuam futuros até produto/analytics/brand readiness e aprovação.
11. **Hardening + estabilidade:** segurança/dependências/SSRF (#94/#105), API/paginação/performance (#80/#81/#114), backup/restore/runbook (#87/#108/#118), painel de saúde (#92), SEO (#96) e E2E. Exigir sete dias de observação 24/7 com coleta, sync, fila, CI, deploy e recuperação verificados antes de declarar conclusão.

## Evidências recentes registradas

- 11/10 ~23h: PR #221 atualizada com a `main` `790de45` (conflito só em `package.json`), correção `62d0183` (sem evidência R2 autodeclarada no CLI), CI [run 38193821300](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/actions/runs/38193821300) `test`/`regression`/`golden` success; Governor `pr.merge` = R3 `human_required`. Sem merge e sem deploy.

- 11/10 à noite: primeira execução do executor Claude Code Actions concluída ponta a ponta; run #38189573700 success; smoke issue #225; PR #228 mergeada após CI #38189888732 success; merge commit `eb6554a1b84a88ffe0e45cbfb647518748e51e5e`.
- Configuração de concorrência `TAREFAS_MAX`: o workflow aceita até 10, mas o default de código é 3. O valor real configurado nas Actions não foi verificável pela conexão usada nesta revisão; confirmar e configurar como `10` antes de lançar a fila em escala.
- Hardening do executor verificado nesta etapa: correção da allowlist Docker na #226 e preflight de credencial na #227. CI dessas PRs: runs #38188177289 e #38188485587, ambos success.
- 11/10: `main` `593f673` (merge da #222 pela Release Executor Bridge); produção `f66c929` (#217, deploy `dpl_GxgGmsGFysrbi8AgZ1oaMNN861Mw` READY). A diferença main→produção é só Governor/CI/docs, que o site não importa.
- Base de referência anterior: commit `0e3adbfd6d143c637e5f695014a7e2de99a77475` — documentação do deploy da Fase 6C.0 (#212) em produção.
- Executor privado: `master` `5de582bf67312c2e43f30b84d689a79448cebfb8` (última SHA confirmada na auditoria do executor; conferir novamente antes de agir).
- PRs/Issues vinculadas: [#31](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/issues/31), [#30](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/issues/30), [#33](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/issues/33), [#195](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/195), [#186](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/186), [#20](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/20).

---
*Este roadmap é um resumo operacional versionado. Atualizar data/hora e evidências em cada revisão; nunca substituir validação de CI/runtime/produção por texto de status.*
