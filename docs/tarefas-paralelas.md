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
