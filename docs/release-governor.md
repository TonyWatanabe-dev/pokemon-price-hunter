# Release Governor — política executável (primeira fatia)

**Status:** núcleo de avaliação implementado; integração operacional com GitHub/executor/Vercel ainda não ativa.

## Objetivo

Reduzir confirmações humanas em mudanças rotineiras, sem deixar um LLM decidir sozinho se pode alterar ou publicar. O Release Governor é o responsável pela decisão baseada em risco e evidências; a classificação é determinística e fechada.

## Níveis de risco

| Nível | Escopo típico | Política |
|---|---|---|
| R0 | apenas documentação/testes | pode autorizar merge após CI + testes verdes no SHA atual; não exige deploy |
| R1 | UI isolada | pode autorizar merge/deploy após CI, testes, preview e acessibilidade no mesmo SHA |
| R2 | código funcional/runtime | autonomia condicional após CI, testes, regressão, golden tests, rollback documentado e testado, métricas/gatilhos de rollout e feature flag segura ou justificativa explícita para não aplicá-la |
| R3 | produção/dados, migrations, secrets/auth, workflow, config crítica, score/ranking, governança ou escopo incerto | nunca autoautoriza; exige escalonamento humano |

## Regras de classificação

- A classificação usa os caminhos reais alterados, não o risco declarado pelo agente.
- Vale sempre o maior risco entre os arquivos alterados.
- Arquivo crítico, caminho desconhecido, escopo vazio, traversal ou base/evidência incerta falham fechados em R3 ou bloqueio.
- Cada check precisa estar em `success` e comprovar exatamente o `headSha` analisado; check verde de commit anterior não vale.
- A branch precisa ser isolada, a base precisa ser `main` e a ausência de conflitos precisa estar comprovada.
- A primeira implementação não executa comandos, não chama APIs, não lê secrets e não altera permissões. Ela retorna decisão, ações elegíveis e evidências faltantes.

## O que ainda não está ativo

Este módulo **não concede credenciais ou permissões** e não está ligado ao executor local. Para autonomia real, a próxima etapa é integrar um cliente que obtenha os arquivos alterados, status de checks e SHA diretamente do GitHub; reavalie o mesmo SHA antes de merge; registre decisão auditável; e só então chame a API autorizada de merge/deploy. A publicação manual da Vercel e a permissão de GitHub continuam sujeitas aos controles já existentes.

## Testes

`node test/agents-release-governor-tests.js` e o mesmo teste na suíte `npm test`. Os testes cobrem classificação R0–R3, evidência faltante, checks de SHA antigo, branch isolada, falha de CI e bloqueios de rollout.
