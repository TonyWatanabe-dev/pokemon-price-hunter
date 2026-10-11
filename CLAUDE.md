# CLAUDE.md — TCG Price Hunter

Regras permanentes para qualquer executor (Claude ou outro agente) que trabalhe neste repositório.

## Arquitetura
- Preserve a arquitetura existente. Siga os padrões, a estrutura de pastas e as convenções já usadas no código.
- Não reestruture módulos, não troque bibliotecas e não reescreva componentes sem pedido explícito do usuário.

## Contexto local do executor (fora do repositório)
- Tarefa sobre o executor (fluxo, fila, status, logs) envolve arquivos que não estão neste repositório. Não conclua que algo não existe só porque não está aqui.
- O executor local fica em `~/pph-executor`, e o script é `~/pph-executor/executor.sh`.
- Comandos existentes do `executor.sh`: `start`, `once`, `stop`, `resume`, `status`, `logs [slug]`, `add <slug> "texto"` e `approve <slug>`. `status` lista as filas `inbox`, `doing`, `ready`, `done` e `failed`.
- Antes de afirmar detalhes além disso, confira o arquivo local. Não invente comandos e não leia secrets (veja a seção Secrets).

## Auditorias
- Não repita auditorias já concluídas. Antes de auditar, confira o histórico do git e o que já foi entregue.
- Só reabra uma auditoria se o usuário pedir.

## Isolamento do trabalho
- Trabalhe sempre em branches ou worktrees isoladas, nunca direto na `main`.
- Use um branch ou worktree por tarefa.

## Testes antes de integrar
- Rode `npm test` antes de integrar qualquer mudança.
- Corrija as falhas antes de integrar. Não desative, não pule e não enfraqueça testes para fazê-los passar.

## Trabalho alheio e conflitos
- Nunca sobrescreva trabalho de outra pessoa ou de outro agente.
- Nunca resolva conflitos descartando alterações automaticamente (por exemplo `git checkout --theirs/--ours` em massa, `git reset --hard`, `git push --force`, `git clean`).
- Em caso de conflito, analise as duas versões e preserve as duas intenções. Se houver dúvida, pergunte ao usuário.

## Secrets
- Não leia, não exiba, não copie e não altere secrets: arquivos `.env`, credenciais, tokens, chaves de API e variáveis de ambiente sensíveis.

## Produção
- Nunca faça deploy, nunca altere o ambiente de produção e nunca leia ou altere o banco de produção sem autorização explícita do usuário.
- Uma autorização vale só para a ação pedida. Ela não vale para ações futuras.
