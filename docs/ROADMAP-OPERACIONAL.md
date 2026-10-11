# Roadmap operacional — Pokémon TCG Price Hunter

> **Atualizado em:** 11/10/2026 às 19:40 (America/Sao_Paulo, UTC−03:00)  
> **Base consultada:** `main` em `593f6733a8c8fcb16f51f3f1aa06bc919f504627`; produção (Vercel) em `f66c929e10d50d6eae7cfb8ff4508599554a4e6c` (#217).  
> **Propósito:** fonte de contexto para Claude Code/agentes e para acompanhamento humano. Este arquivo documenta o estado observado; issue/PR/CI e execução real continuam sendo a fonte de verdade para cada entrega.

## Regras de operação

- Não fazer merge de PRs de produto, deploy, migration, nem alterar secrets/configuração de produção sem autorização explícita.
- Não marcar tarefa concluída apenas por label. Exigir diff versionado, testes apropriados e evidência verificável (CI/log/execução).
- Não presumir que o executor local `~/pph-executor` está sincronizado só porque `master` remoto está atualizado.
- Preferir trabalho remoto que não dependa do computador do usuário. Não inventar evidência de runtime.
- Manter branches/PRs pequenas e baseadas na `main` atual; evitar integrar branches empilhadas com conflitos.
- Não ligar `SHIPPING_CALC_ENABLED` sem validação real de cotação e autorização separada.

## Mapa de agentes

Detalhamento completo das responsabilidades, limites, dependências, status de implementação e critérios de ativação: [docs/MAPA-DE-AGENTES.md](./MAPA-DE-AGENTES.md). O inventário separa o que Claude já implementou no código do que ainda é futuro e exige pré-requisitos/aprovação. As capacidades futuras de UX Research, UI & Design System, Social Media, SEO & Content, Growth & CRO e Brand & Creative não devem ser iniciadas agora.

## Estado executivo

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

0. **Release autônomo:** revisar e integrar a #221 (merge humano, R3); criar o token Vercel com escopo do time e guardá-lo como secret; depois rodar `node tools/release-run.mjs deploy --pr N` num PR R1 para comprovar deploy + smoke.
1. **Sem depender do computador:** auditar as PRs abertas contra a `main` atual; resolver conflitos em branches isoladas; executar CI; atualizar este roadmap quando houver evidência concreta.
2. **PR #195:** rebase/merge da base atual na branch de trabalho, resolver conflitos, CI completo e revisão de segurança; manter draft/flag desligada até validação.
3. **PR #17 e mudanças de segurança relacionadas:** conferir o estado real do merge, CI e deploy; não inferir deploy pelo merge.
4. **Runtime do executor:** aguardar acesso ao computador para sincronização segura e verificação operacional; nenhuma alegação de runtime atualizado antes disso.
5. **Decisões comerciais/produção:** aguardar decisão explícita para #186 e autorização explícita para #20 ou qualquer alteração de produção.

## Evidências recentes registradas

- 11/10: `main` `593f673` (merge da #222 pela Release Executor Bridge); produção `f66c929` (#217, deploy `dpl_GxgGmsGFysrbi8AgZ1oaMNN861Mw` READY). A diferença main→produção é só Governor/CI/docs, que o site não importa.
- Base de referência anterior: commit `0e3adbfd6d143c637e5f695014a7e2de99a77475` — documentação do deploy da Fase 6C.0 (#212) em produção.
- Executor privado: `master` `5de582bf67312c2e43f30b84d689a79448cebfb8` (última SHA confirmada na auditoria do executor; conferir novamente antes de agir).
- PRs/Issues vinculadas: [#31](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/issues/31), [#30](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/issues/30), [#33](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/issues/33), [#195](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/195), [#186](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/186), [#20](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/20).

---
*Este roadmap é um resumo operacional versionado. Atualizar data/hora e evidências em cada revisão; nunca substituir validação de CI/runtime/produção por texto de status.*
