# Release Governor — política executável (primeira fatia)

**Status:** núcleo de avaliação implementado; integração operacional com GitHub/executor/Vercel ainda não ativa.

## Objetivo

Reduzir confirmações humanas em mudanças rotineiras, sem deixar um LLM decidir sozinho se pode alterar ou publicar. O Release Governor é o responsável pela decisão baseada em risco e evidências; a classificação é determinística e fechada.

## Níveis de risco

| Nível | Escopo típico | Política |
|---|---|---|
| R0 | apenas documentação | pode autorizar merge após CI e testes verdes no SHA atual; não exige deploy |
| R1 | UI estática isolada | pode autorizar merge após CI, testes, preview e acessibilidade no mesmo SHA. Deploy é uma decisão separada, pós-merge |
| R2 | código funcional/runtime | pode autorizar merge condicional após CI/testes, regressão, golden tests, rollback documentado e testado, métricas/gatilhos de rollout e feature flag segura ou justificativa explícita. Deploy é uma decisão separada, pós-merge |
| R3 | produção/dados, migrations, secrets/auth, workflow, config crítica, score/ranking, governança ou escopo incerto | nunca autoautoriza; exige escalonamento humano |

## Decisões separadas: merge × deploy

Uma aprovação para `pr.merge` concede somente o merge; nunca concede permissão implícita para publicar. Uma decisão `deploy` autoriza iniciar a publicação somente com evidências do commit **já integrado** na `main` e uma Preview validada. A decisão `deploy.verify` só confirma que a publicação terminou com sucesso:

- `merged=true`, `baseRef=headRef=targetRef=main`, e `mainSha=headSha`;
- Para `deploy`: deployment de **Preview** na Vercel com estado `READY`, URL HTTPS pública e SHA idêntico ao HEAD da `main`, mais `test` e `preview-smoke` verdes; mudanças R1 exigem também acessibilidade.
- Para `deploy.verify`: deployment de **produção** na Vercel com estado `READY`, URL HTTPS pública e SHA publicado idêntico ao HEAD validado; exige `test` e `smoke` verdes no SHA exato; mudanças R1 exigem também acessibilidade;
- mudanças R2 exigem também regressão/golden no mesmo SHA, rollback documentado e testado, métricas e gatilhos de rollback e feature flag segura (ou motivo explícito de inaplicabilidade);
- documentação pura e R3 nunca recebem autorização autônoma de deploy.

O módulo apenas avalia esses dados. O executor de deploy real ainda precisa coletar as evidências diretamente do GitHub/Vercel e executar a ação somente depois da decisão positiva. Nenhum fluxo de deploy está ativado por esta PR.

## Regras de classificação

- A classificação usa os caminhos reais alterados, não o risco declarado pelo agente.
- Vale sempre o maior risco entre os arquivos alterados.
- Arquivo crítico, caminho desconhecido, escopo vazio, traversal ou base/evidência incerta falham fechados em R3 ou bloqueio.
- Cada check precisa estar em `success` e comprovar exatamente o `headSha` analisado; check verde de commit anterior não vale. No CI atual do repositório, o job `test` executa `npm test` completo e pode satisfazer os gates base de CI/testes. Regressão e golden são checks separados e obrigatórios para R2; o check `test` não os substitui.
- A branch precisa ser isolada, a base precisa ser `main` e a ausência de conflitos precisa estar comprovada.
- A implementação do governor não executa comandos, não chama APIs, não lê secrets e não altera permissões. Ela retorna decisão, ações elegíveis e evidências faltantes.

## O que ainda não está ativo

Este módulo **não concede credenciais ou permissões** e não está ligado ao executor local. Para autonomia real, a próxima etapa é integrar um cliente que obtenha os arquivos alterados, status de checks e SHA diretamente do GitHub; reavalie o mesmo SHA antes de merge; registre decisão auditável; e só então chame a API autorizada de merge/deploy. A publicação manual da Vercel e a permissão de GitHub continuam sujeitas aos controles já existentes.

## Testes

`node test/agents-release-governor-tests.js` e o mesmo teste na suíte `npm test`. Os testes cobrem classificação R0–R3, evidência faltante, checks de SHA antigo, branch isolada, falha de CI, autorização prévia por Preview, verificação pós-deploy e bloqueios de rollout.
