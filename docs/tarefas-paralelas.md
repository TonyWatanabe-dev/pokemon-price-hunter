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

## Esforço adaptativo no worker (#235, etapa 2)

Antes de chamar uma sessão Claude, o worker executa `node tools/esforco.mjs "$ISSUE"` depois de validar o gatilho e a credencial. O comando é somente leitura: usa `GH_TOKEN` apenas dentro do próprio passo, lê título/corpo/labels/eventos da issue e calcula o perfil com regras locais determinísticas.

- **Mecânica/documentação isolada:** `sonnet` + `low` + 30 turnos.
- **Comum:** `sonnet` + `medium` + 60 turnos.
- **Complexa ou crítica/R3:** `opus` + `high` + 80 turnos; assuntos e áreas críticos não são rebaixados.
- **Escalada por falhas anteriores:** aumenta esforço e, quando aplicável, passa de `sonnet` para `opus`, com limites fechados. `max` nunca é escolhido automaticamente.
- O CLI escreve valores pré-validados em `GITHUB_OUTPUT`; ambos os caminhos (`executor:github` e Dispatcher) consomem o mesmo resultado. O texto da issue não é inserido em shell nem em `claude_args`.
- O perfil atua na seleção de modelo/esforço/turnos da sessão. O orçamento global (`budgetGate`) ainda não é aplicado pelo Dispatcher; não assumir que esse controle já está operacional.

Os testes de workflow verificam a ordem: revalidar despacho → marcar/instalar dependências → verificar credencial → selecionar perfil → executar Claude. O worker continua sem permissão para merge ou deploy.

## Telemetria por execução

Ao final de cada execução (sucesso ou falha, exceto quando falta a credencial do Claude), o passo "Resultado na issue" roda `node tools/telemetria.mjs registrar`. O script roda sem `GH_TOKEN` e sem rede. Depois o passo publica um comentário na issue com uma tabela legível e um marcador `<!-- telemetria:execucao v=1 {...} -->`. Esse marcador é lido apenas quando o autor é `github-actions[bot]`.

- **Fonte:** o `execution_file` da Claude Code Action (mensagens do Agent SDK).
  - Da mensagem `result`: turnos, duração, tokens (entrada, saída, cache de leitura e de criação), `total_cost_usd` e os modelos de `modelUsage`.
  - Da `system/init`: o modelo da sessão.
  - Do `tools/esforco.mjs`, saída `perfil`: o perfil solicitado (classe, modelo, esforço, turnos, falhas anteriores e escalada).
  - Do workflow: status, PR, chave e tentativa.
- **Sem estimativa:** quando um campo não vem, o registro guarda `null` e a tabela mostra "n/d". Se o `execution_file` não existir, `sessao` fica `null`.
- **Custo:** é o valor a preço de API que o SDK reporta. Com login por assinatura (`CLAUDE_CODE_OAUTH_TOKEN`), ele não é a cobrança efetiva. Serve para comparar tarefas e acompanhar tendência.
- **Sanitização:** o registro só tem números e valores de listas ou formatos fechados (modelo `claude-*`, chave `dispatch:N:T`, PR do próprio repositório). Nenhum texto do modelo, da issue ou do log é copiado. O `execution_file` inteiro nunca sai do runner.
- **Falha da telemetria:** gera só um aviso (`::warning`). Não muda `executor:done`/`executor:failed`.
- **Resumo:** `node tools/telemetria.mjs resumo [--desde AAAA-MM-DD] [--json]` é somente leitura e usa o `gh`. Mostra:
  - execuções, entregas com PR, falhas e escaladas;
  - tokens e custo reportado, com a contagem de execuções sem dado;
  - custo por PR integrada, somando todas as tentativas da issue (o retrabalho conta). Se alguma execução da PR não tiver custo, essa média fica `n/d`.

Próximo passo: o Dispatcher passa a usar `gastoNaJanela` + `budgetGate` (`src/agents/telemetria.js`, `src/agents/esforco.js`) com um limite configurável para pausar despachos quando o gasto reportado da janela passar do limite.

## Dispatcher (fila aprovada)

Issue #234. `src/agents/dispatcher.js` decide, de forma determinística, quais issues podem ir para o worker; `tools/dispatcher.mjs` lê issues/PRs pela API e `.github/workflows/dispatcher.yml` roda a cada hora (e por `workflow_dispatch`) publicando o plano no resumo do job.

- **Fila:** label `tarefa:aprovada`, válido só se a issue foi aberta por operador **e** o último evento desse label foi aplicado por operador (`TAREFAS_OPERADORES`, padrão: dono do repo).
- **Ordem:** linha `Ordem: N` do corpo; depois o número da issue.
- **Bloqueios:** `Depende de: #N` ainda aberta (ou desconhecida), PR aberto para a issue (branch `…/issue-N…` ou `Closes/Fixes/Resolves #N`), `executor:running`/`executor:github`, lease de 70 min após o despacho, `executor:done`, `executor:quarentena`, área crítica em uso (caminhos entre crases em `Áreas:` ou `Risco previsto:`), vagas (`TAREFAS_MAX`, 1..10, padrão 3) e pausa por rate limit (cota da API < 200 ou `DISPATCHER_PAUSA_ATE`).
- **Idempotência:** chave `dispatch:<issue>:<tentativa>` gravada num comentário-marcador **antes** do disparo; só valem marcadores do ator do dispatcher ou de operadores. Dois dispatchers concorrentes: relê depois de gravar e só dispara quem tem o comentário de menor id com a chave.
- **Retry e quarentena:** nova tentativa só depois de `executor:failed` (ou lease expirado) e do backoff (30 min, dobrando); com 2 tentativas sem sucesso, label `executor:quarentena` e comentário sanitizado, sem nova tentativa automática.
- **Disparo real (etapa 2), desligado por padrão:**
  - **Chave:** variável **`DISPATCHER_ATIVO=true`**, em Settings → Actions → Variables.
  - **Job `despacho`:** grava o marcador na issue, aplica quarentena e roda `gh workflow run tarefas.yml -f issue=N -f chave=dispatch:N:T`. Tem só `issues: write` e `actions: write`.
  - **Sem a variável:** só o job `plano` roda, somente leitura.
- **Revalidação no worker:** o `tarefas.yml` aceita `workflow_dispatch` só com a mesma variável. Antes de qualquer efeito, `tools/validar-despacho.mjs` confere:
  - issue aberta;
  - autor e aprovação feitos por operador;
  - sem quarentena e sem `executor:done`;
  - marcador do dispatcher com a mesma chave;
  - tentativa = a última registrada.
  Despacho recusado falha fechado sem marcar a issue.
- **Execução pelo despacho:** o Claude roda em modo agente com prompt fixo que só aponta o número da issue (lê título e corpo, nunca comentários). Os commits vão pela API do app (`use_commit_signing`) na branch `tarefa/issue-N-tT`, sem `git push` em Bash, e a PR é aberta para a `main`. Merge e deploy continuam fora do worker.
- **Teste controlado antes de ampliar:**
  1. Ligar `DISPATCHER_ATIVO=true` com `TAREFAS_MAX` em 1 ou 3.
  2. Aprovar **uma** issue de documentação (`tarefa:aprovada`).
  3. Rodar o Dispatcher manualmente.
  4. Conferir marcador, execução do worker, PR com `Closes #N`, CI e label `executor:done`.
  5. Rodar o Dispatcher de novo e confirmar que não há segundo despacho.

## Evidências do primeiro smoke test do Dispatcher — #247

**Estado atual: PENDENTE.** A label `tarefa:aprovada` não comprova que o despacho foi executado. Só marcar o teste como concluído quando houver evidências verificáveis dos itens abaixo.

### Pré-condições e execução
- [ ] Confirmar que a `main` contém o Dispatcher real e que `DISPATCHER_ATIVO` está desativado até o início deliberado do canário.
- [ ] Usar uma única issue documental R0 com escopo explícito; issue de teste: #247.
- [ ] Ativar o gate apenas para o canário, com `TAREFAS_MAX=1` se a configuração permitir; nunca registrar segredo ou chave em texto público.
- [ ] Disparar pelo workflow suportado e distinguir o job de planejamento (somente leitura) do job de despacho real.

### Evidências obrigatórias
- [ ] **Run do Dispatcher:** URL, SHA da `main`, evento e conclusão real.
- [ ] **Seleção da fila:** confirmar que somente #247 foi selecionada e que lock/idempotência foram respeitados.
- [ ] **Worker:** URL da execução `Tarefas`, issue validada e resultado final, sem expor a chave em claro.
- [ ] **PR produzida:** URL, branch e arquivos alterados; para #247, somente `docs/tarefas-paralelas.md`.
- [ ] **CI:** links e sucesso de `test`, `regression` e `golden` no HEAD final.
- [ ] **Revisão independente:** link do `qa-review` e veredito sem bloqueantes.
- [ ] **Conclusão:** `executor:done` só depois de o worker confirmar sucesso e existir PR; registrar falhas/quarentena com link do run.
- [ ] **Idempotência:** segunda execução não cria um despacho duplicado para a mesma tentativa.

### Critérios de sucesso e recuperação
- Marcar **PASSOU** somente quando todas as evidências obrigatórias existirem e o diff ficar dentro do escopo documental. Antes disso, manter **PENDENTE**.
- Se a validação recusar o despacho, não deve haver alteração de estado da issue nem branch/PR nova.
- Se o worker falhar antes da PR, não marcar `executor:done`; registrar o run e respeitar backoff/idempotência.
- Se houver arquivo fora do escopo, não integrar a PR; corrigir ou fechar a branch de teste e registrar a evidência.
- Este smoke test não inclui merge, deploy, migration nem alteração de secrets.

### Registro da execução
- Estado: **PENDENTE — nenhuma execução real comprovada neste registro**.
- Run do Dispatcher: `pendente`.
- Run de Tarefas: `pendente`.
- PR criada pelo worker: `pendente`.
- CI e `qa-review` da PR criada: `pendente`.
- Resultado de idempotência: `pendente`.
- Resultado final: `pendente`.
