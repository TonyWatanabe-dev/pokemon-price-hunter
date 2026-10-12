# Tarefas paralelas no GitHub Actions

Cada issue com o label **`executor:github`** vira um job próprio do Claude Code (`.github/workflows/tarefas.yml`). O job:
- trabalha numa branch `tarefa/…`;
- roda `npm test` com um PostgreSQL descartável;
- abre um PR para a `main`.

Várias issues rodam ao mesmo tempo. O merge continua passando por CI + Release Governor (ou por você, se for R3). Este workflow nunca faz merge, deploy nem acessa o banco de produção.

O executor local (`executor:ready`, `~/pph-executor`) continua igual. Os dois labels são separados para que nunca peguem a mesma issue.

## Configuração (uma vez)

1. **Instalar o app do Claude no repositório:** https://github.com/apps/claude. Instale somente neste repositório.
   - A action oficial usa a identidade do app para criar a branch e a PR; a CI roda na PR.
2. **Gerar o token da sua assinatura Claude:** no seu computador, rode `claude setup-token`.
3. **Guardar o token como secret:** no GitHub, vá em Settings → Secrets and variables → Actions → New repository secret.
   - Nome: `CLAUDE_CODE_OAUTH_TOKEN`.
   - Valor: o token gerado no passo 2. Cole só ali, nunca em chat, issue ou arquivo.
4. **Definir a concorrência:** em Settings → Secrets and variables → Actions → Variables:
   - `TAREFAS_MAX=10` para até dez jobs simultâneos. Sem essa variável, o padrão conservador é 3. O valor é limitado a 1–10.
   - `TAREFAS_OPERADORES` é opcional: logins separados por vírgula de quem pode disparar. Sem ela, só o dono do repositório.
5. **Não remova o isolamento de rede:** o job usa `ubuntu-24.04-firewall` e `.github/egress-firewall.yaml`, seguindo o hardening de segurança da Claude Code Action. Se esse runner não estiver disponível na conta/repositório, não troque por um runner comum sem revisão de segurança.

O workflow só deve ser habilitado depois de o app e o secret estarem configurados. O token é um segredo: nunca publique o conteúdo, nem em logs.

## Uso

1. Abra uma issue descrevendo a tarefa: o que mudar, onde e como saber que ficou certo.
2. Aplique o label `executor:github`. Só o owner/operadores podem disparar, e a issue também precisa ter sido aberta por um operador.
3. O Claude comenta o progresso na própria issue e tenta abrir uma PR.
   - **Concluída:** somente quando a execução da action retornar sucesso **e** existir uma PR aberta; a issue recebe `executor:done`.
   - **Falha:** recebe `executor:failed`. Se a PR chegou a ser criada, o link é mantido no comentário para triagem.

Com mais issues do que vagas, as excedentes ficam na fila do GitHub (até 100 por grupo) e começam quando uma vaga é liberada. A vaga de cada tarefa é `número da issue % TAREFAS_MAX`.

## Limites e cuidados

- **Cota:** cada tarefa é uma sessão do Claude Code na sua assinatura. Dez tarefas em paralelo consomem a cota muito mais rapidamente do que três; valide primeiro com uma issue pequena.
- **Conflitos:** tarefas que mexem nos mesmos arquivos (`index.html`, `api/v1.mjs`, `package.json`) tendem a gerar conflito. O Governor bloqueia o merge até a branch ser atualizada.
- **Duração:** o job tem até 55 minutos (o token do app vale cerca de 1 h). Tarefas maiores devem ser quebradas em issues menores.
- **Ferramentas:** a action está fixada por SHA na versão `v1.0.248`, com `--permission-mode auto`. As ferramentas de shell autorizadas são restritas a testes e a criação/listagem de PRs. Não existe permissão para merge/deploy automatizado neste workflow.
- **Rede:** o runner de firewall limita saídas aos hosts listados no arquivo de allowlist. Dependências de teste que precisem de outro host exigem revisão explícita e allowlist específica.
- **Logs:** logs de Actions podem ser visíveis no repositório público. A saída completa da conversa do Claude não é habilitada.

## Diagnóstico da primeira execução

Use esta seção quando uma issue com `executor:github` não se comportar como esperado.

### Como verificar o resultado do job

1. Abra a aba **Actions** → workflow **Tarefas** e procure a execução da issue (o título traz o número dela).
2. Confira o **Summary** da execução. O passo "Resultado na issue" grava ali `Resultado: sucesso` (com o link da PR) ou `Resultado: falha`.
3. Confira a issue:
   - `executor:running`: o job está em andamento (ou foi interrompido sem passar pelo passo final).
   - `executor:done`: a action terminou com sucesso **e** existe uma PR aberta.
   - `executor:failed`: veja o comentário automático, que traz o status e o link do log.
4. Abra os logs do passo que falhou. Os passos relevantes, em ordem, são: marcar em execução, `npm ci`, **Validar credencial Claude**, a Claude Code Action e o resultado na issue.

### Falta de secret, app ou runner

| Sintoma | Causa provável | O que fazer |
| --- | --- | --- |
| Passo "Validar credencial Claude" falha com `Credencial Claude ausente` | Secret `CLAUDE_CODE_OAUTH_TOKEN` não cadastrado ou vazio | Gere o token com `claude setup-token` e cadastre em Settings → Secrets and variables → Actions. Não cole o token em issue, chat ou log. |
| A action falha com `Environment variable validation failed` | Nenhuma credencial de modelo chegou à action | Mesma correção do secret acima. |
| Erro ao criar branch/PR ou ao comentar (403/404) | App do Claude não instalado no repositório ou sem permissão | Instale/revise o app em https://github.com/apps/claude, somente neste repositório. |
| Job fica em fila (`Queued`) e não inicia | Runner `ubuntu-24.04-firewall` indisponível na conta ou repositório | Verifique a disponibilidade do runner. Não troque por runner comum sem revisão de segurança. |
| Falha de DNS/download (por exemplo imagem `postgres:17`) | Host fora da allowlist de rede | Revise `.github/egress-firewall.yaml` em uma PR separada; não desative o firewall. |

### Como interpretar `executor:failed`

`executor:failed` significa apenas que a tarefa **não foi concluída com segurança**. Ele aparece quando:
- a validação de credencial falhou (a Claude Code Action nem chegou a ser chamada);
- a action terminou com status diferente de sucesso;
- a action terminou com sucesso, mas não há PR aberta.

Se o comentário trouxer o link de uma PR, ela existe mas precisa de triagem manual antes de qualquer merge. Para repetir: corrija a causa, remova `executor:failed` se ainda estiver na issue e aplique `executor:github` novamente.

### Nenhuma tarefa faz merge ou deploy sozinha

- O workflow só permite ao Claude `npm test`, `npm ci`, `node test/*`, leitura de git e `gh pr create`/`gh pr list`. Não há permissão para `gh pr merge`, push na `main` ou deploy.
- O resultado de uma tarefa é sempre uma PR aberta para a `main`; o merge depende de CI + Release Governor ou de revisão humana.
- Para confirmar em uma execução: a PR deve estar **Open**, sem merge, e nenhum deploy deve ter sido disparado por ela.

## Dispatcher (fila aprovada) — etapa 1: só plano

Issue #234. `src/agents/dispatcher.js` decide, de forma determinística, quais issues podem ir para o worker; `tools/dispatcher.mjs` lê issues/PRs pela API e `.github/workflows/dispatcher.yml` roda a cada hora (e por `workflow_dispatch`) publicando o plano no resumo do job.

- **Fila:** label `tarefa:aprovada`, válido só se a issue foi aberta por operador **e** o último evento desse label foi aplicado por operador (`TAREFAS_OPERADORES`, padrão: dono do repo).
- **Ordem:** linha `Ordem: N` do corpo; depois o número da issue.
- **Bloqueios:** `Depende de: #N` ainda aberta (ou desconhecida), PR aberto para a issue (branch `…/issue-N…` ou `Closes/Fixes/Resolves #N`), `executor:running`/`executor:github`, lease de 70 min após o despacho, `executor:done`, `executor:quarentena`, área crítica em uso (caminhos entre crases em `Áreas:` ou `Risco previsto:`), vagas (`TAREFAS_MAX`, 1..10, padrão 3) e pausa por rate limit (cota da API < 200 ou `DISPATCHER_PAUSA_ATE`).
- **Idempotência:** chave `dispatch:<issue>:<tentativa>` gravada num comentário-marcador **antes** do disparo; só valem marcadores do ator do dispatcher ou de operadores. Dois dispatchers concorrentes: relê depois de gravar e só dispara quem tem o comentário de menor id com a chave.
- **Retry e quarentena:** nova tentativa só depois de `executor:failed` (ou lease expirado) e do backoff (30 min, dobrando); com 2 tentativas sem sucesso, label `executor:quarentena` e comentário sanitizado, sem nova tentativa automática.
- **Estado atual:** o workflow tem só permissões de leitura e não passa `--executar`. Ligar o disparo depende de uma entrada `workflow_dispatch` validada no `tarefas.yml` (a Claude Code Action precisaria rodar em modo `prompt` nesse caminho) e de `issues: write` + `actions: write` no dispatcher — mudança R3 de workflow/permissões, com revisão humana. O `--executar` recusa rodar enquanto o `tarefas.yml` não declarar essa entrada.