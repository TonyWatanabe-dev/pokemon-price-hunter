# Tarefas paralelas no GitHub Actions

Cada issue com o label **`executor:github`** vira um job próprio do Claude Code (`.github/workflows/tarefas.yml`). O job:
- trabalha numa branch `tarefa/…`;
- roda `npm test` com um PostgreSQL descartável;
- abre um PR para a `main`.

Várias issues rodam ao mesmo tempo. O merge continua passando por CI + Release Governor (ou por você, se for R3). Este workflow nunca faz merge, deploy nem acessa o banco de produção.

O executor local (`executor:ready`, `~/pph-executor`) continua igual. Os dois labels são separados para que nunca peguem a mesma issue.

## Configuração (uma vez)

1. **Instalar o app do Claude no repositório:** https://github.com/apps/claude. Só neste repositório.
   - Os commits e o PR saem pelo app. Por isso a CI roda no PR; com o token padrão do Actions ela não rodaria.
   - O app não tem permissão de alterar workflows.
2. **Gerar o token da sua assinatura Claude:** no seu computador, rode `claude setup-token`.
3. **Guardar o token como secret:** no GitHub, vá em Settings → Secrets and variables → Actions → New repository secret.
   - Nome: `CLAUDE_CODE_OAUTH_TOKEN`.
   - Valor: o token gerado no passo 2. Cole só ali, nunca em chat, issue ou arquivo.
4. **Opcional:** em Settings → Secrets and variables → Actions → **Variables**:
   - `TAREFAS_MAX`: quantas tarefas rodam juntas. O padrão é 3, e o máximo é 10.
   - `TAREFAS_OPERADORES`: logins separados por vírgula, de quem pode disparar. O padrão é só o dono do repositório.

## Uso

1. Abra uma issue descrevendo a tarefa: o que mudar, onde e como saber que ficou certo.
2. Aplique o label `executor:github`.
3. O Claude comenta o progresso na própria issue.
   - **Com PR:** o label vira `executor:done` e o PR tem `Closes #N`.
   - **Sem PR:** o label vira `executor:failed`, com um comentário explicando o motivo.

Com mais issues do que vagas, as excedentes ficam **na fila do GitHub** (até 100 por vaga) e começam sozinhas. A vaga de cada tarefa é `número da issue % TAREFAS_MAX`.

## Limites e cuidados

- **Cota:** cada tarefa é uma sessão do Claude Code na sua assinatura. Tarefas em paralelo consomem o limite de uso mais rápido.
- **Conflitos:** tarefas que mexem nos mesmos arquivos (`index.html`, `api/v1.mjs`, `package.json`) tendem a gerar conflito. O Governor bloqueia o merge até a branch ser atualizada.
- **Duração:** o job tem até 55 minutos (o token do app vale 1 h). Tarefas maiores devem ser quebradas em issues menores.
- **Segurança (repositório público):**
  - Só dispara quando um operador aplica o label numa issue aberta por um operador.
  - Comentários de outras pessoas não entram no contexto do Claude.
  - O Claude só pode rodar `npm test`/`npm ci`/`node test/*`, ler o git e abrir/listar PRs. Não tem Bash livre, push forçado nem merge.
  - Os logs do Actions são públicos. O workflow não liga a saída completa do Claude.
