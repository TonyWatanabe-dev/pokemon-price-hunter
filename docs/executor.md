# Fluxo do executor local

O executor é o agente local que aplica mudanças no repositório seguindo o `CLAUDE.md`.

## Passo a passo

1. **Entrada:** as tarefas chegam em `~/pph-executor/inbox`. O executor processa uma tarefa por vez.
2. **Isolamento:** cada tarefa ganha uma worktree própria e um branch `task/<slug>`, criados a partir de `origin/main`. Nunca se trabalha direto na `main`.
3. **Mudança:** o executor faz só o que a tarefa pede, em um único commit com mensagem em português.
4. **Testes locais:** o executor roda `npm test` e corrige as falhas antes de integrar. Testes não são desativados nem enfraquecidos.
5. **Pull request:** o branch `task/<slug>` é enviado e abre-se um PR para a `main`.
6. **CI:** o GitHub Actions roda `npm ci` e `npm test` no job `test` em todo PR para a `main`. O PR só deve ser integrado com o job `test` verde.

Checklist de evidências para o PR: `docs/checklist-release.md`.

## Merge e produção

Merge na `main` publica em produção. Por isso o merge exige aprovação explícita do usuário. A aprovação vale só para aquele PR e não vale para ações futuras.

## Regras importantes

- Nunca sobrescrever trabalho alheio nem resolver conflitos descartando alterações.
- Não ler nem alterar secrets (`.env`, tokens, chaves).
- Não fazer deploy nem mexer no banco de produção sem autorização.
