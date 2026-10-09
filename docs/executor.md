# Fluxo do executor local

O executor é um agente local que processa tarefas do repositório de forma isolada e previsível.

## Passo a passo

1. **Fila**: as tarefas ficam em `~/pph-executor/inbox`. O executor pega **uma tarefa por vez**.
2. **Isolamento**: para cada tarefa é criada uma worktree própria e um branch `task/<slug>`, sempre a partir de `origin/main`. Nada é feito direto na `main`.
3. **Execução**: o executor segue o `CLAUDE.md` e altera só o que a tarefa pede.
4. **Testes locais**: o executor roda `npm test` antes de integrar.
5. **Pull request**: o branch `task/<slug>` é enviado e abre-se um PR para a `main`.
6. **CI**: todo PR para a `main` roda `npm ci` e `npm test` no GitHub Actions (job `test`). O PR só pode ser integrado com o job `test` verde.

## Merge e produção

**Merge na `main` publica em produção.** Por isso o merge exige aprovação explícita do usuário. A aprovação vale só para aquele PR e não vale para ações futuras.

## O que o executor nunca faz

- Trabalhar direto na `main`.
- Sobrescrever trabalho alheio ou resolver conflitos descartando alterações.
- Ler ou alterar secrets (`.env`, tokens, chaves).
- Fazer deploy ou mexer no banco de produção sem autorização.
