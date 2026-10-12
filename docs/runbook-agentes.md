# Runbook — operação da fábrica de agentes

Guia curto para o operador. Detalhes em `docs/tarefas-paralelas.md` (worker e Dispatcher), `docs/revisor.md` (`qa-review`) e `docs/agentes.md` (política e riscos).

## 1. Aprovar uma tarefa

Abra a issue como operador, com o escopo (o que mudar, onde, como saber que ficou certo) e estas linhas no corpo:

```
Ordem: 1
Fase: 0 · Risco previsto: R0 (documentação)
Áreas: `docs/arquivo.md`
Depende de: #N
```

- **`Ordem: N`:** posição na fila; empate pelo número da issue.
- **`Risco previsto:`** e **`Áreas:`:** caminhos entre crases marcam a área em uso. Duas tarefas na mesma área crítica não rodam juntas.
- **`Depende de: #N`:** a tarefa espera até a #N ser fechada. Dependência desconhecida também bloqueia.

Depois aplique o label **`tarefa:aprovada`**. Só vale se a issue foi aberta por operador **e** o último evento desse label foi aplicado por operador. O Dispatcher roda a cada hora (ou por `workflow_dispatch`) e publica o plano no resumo do job.

Fora da fila: o label `executor:github` dispara o worker direto para aquela issue.

## 2. Acompanhar

- **`executor:running`:** job em andamento, ou interrompido antes do passo final.
- **`executor:done`:** a action terminou com sucesso **e** existe PR aberta.
- **`executor:failed`:** a tarefa não foi concluída com segurança (credencial ausente, action sem sucesso ou nenhuma PR aberta). O comentário traz status, link do log e, se houver, o link da PR para triagem.
- **`executor:quarentena`:** 2 tentativas sem sucesso; não há nova tentativa automática.
- **Telemetria:** ao final de cada execução (exceto sem credencial), o `github-actions[bot]` comenta na issue uma tabela com turnos, duração, tokens, custo reportado e modelos. Campo ausente aparece como "n/d". O custo é a preço de API; com assinatura, não é a cobrança efetiva. Resumo: `node tools/telemetria.mjs resumo [--desde AAAA-MM-DD] [--json]`.
- **`qa-review`:** check da revisão independente em toda PR para a `main`. Passa só com `aprovado=true` e nenhum bloqueante; sem veredito válido, falha. O Release Governor exige `qa-review` verde no mesmo SHA para autorizar merge.
- **Onde ver o job:** Actions → **Tarefas** → execução da issue → Summary (`Resultado: sucesso` com o link da PR, ou `Resultado: falha`).

## 3. Destravar

- **Falha simples:** corrija a causa, remova `executor:failed` se ainda estiver na issue e aplique `executor:github` de novo. Pela fila, o Dispatcher faz a nova tentativa sozinho depois do backoff.
- **Backoff:** espera entre tentativas, 30 min dobrando. Uma tentativa só conta como concluída com um `executor:failed`/`done` posterior ao seu despacho (ou com o lease de 70 min expirado).
- **Quarentena:** leia o comentário do Dispatcher e corrija a causa. Depois, um **operador** remove `executor:quarentena`; isso concede novas tentativas e a numeração das chaves `dispatch:<issue>:<tentativa>` continua (#256; confira o estado de integração em `docs/agentes.md`). Não force a chave nem remova outros labels para contornar a proteção.
- **Pausa por rate limit:** com cota da API < 200 ou `DISPATCHER_PAUSA_ATE`, o Dispatcher não despacha.
- **Pausa por orçamento:** com a soma do custo reportado na janela ≥ `DISPATCHER_ORCAMENTO_USD`, pausa como no rate limit: sem despacho nem quarentena, a fila fica intacta e volta sozinha quando a janela anda. Com limite definido, valor inválido ou falha ao ler a telemetria também pausa (fail-closed).
- **Diagnóstico de secret, app ou runner:** tabela em `docs/tarefas-paralelas.md` → "Diagnóstico da primeira execução".

## 4. Variáveis

Em Settings → Secrets and variables → Actions → Variables:

| Variável | Efeito | Sem a variável |
| --- | --- | --- |
| `DISPATCHER_ATIVO` | `true` liga o job `despacho` e o `workflow_dispatch` do worker. | Só o job `plano` roda, somente leitura. |
| `TAREFAS_MAX` | Jobs simultâneos, limitado a 1–10. | 3. |
| `TAREFAS_OPERADORES` | Logins, separados por vírgula, que podem abrir/aprovar/disparar. | Só o dono do repositório. |
| `DISPATCHER_ORCAMENTO_USD` | Limite de custo reportado na janela. | O plano só mostra o gasto da janela. |
| `DISPATCHER_ORCAMENTO_JANELA_H` | Janela do orçamento, 1–168 h. | 24 h. |

Não afirme que um valor está ativo sem conferir essa tela. Secrets (ex.: `CLAUDE_CODE_OAUTH_TOKEN`) nunca vão para issue, chat ou log.

## 5. Limites

- O worker (`tarefas.yml`) entrega só branch `tarefa/…` + testes + PR para a `main`. Não faz merge, deploy, push na `main` nem acessa o banco de produção.
- O merge passa por CI + Release Governor (`test`, `regression`, `golden`, `qa-review` no mesmo SHA). Nenhum agente aprova a própria mudança.
- **R3** (migração destrutiva, secrets, permissões, segurança/auth, pagamentos, mudança de preços/ranking em massa) é bloqueado e exige decisão humana explícita. Evidência ausente é R-STOP: bloqueio, não aprovação.
