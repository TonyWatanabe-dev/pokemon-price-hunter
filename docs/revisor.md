# Revisor independente de PR (`qa-review`)

Issue #236 · workflow `.github/workflows/revisor.yml` · testes `test/revisor-workflow-tests.js`.

## O que faz
Em toda PR para a `main` (aberta, atualizada, reaberta ou que saiu de draft), uma sessão **separada** do Claude lê o diff e a issue citada e publica:
- um comentário de resumo;
- comentários inline nos pontos específicos.

O veredito estruturado (`aprovado`, `bloqueantes`, `observacoes`) vira o check **`qa-review`**:
- passa só com `aprovado=true` e nenhum bloqueante;
- falha quando não há veredito, quando o veredito é inválido, quando não aprova ou quando há bloqueante (fail-closed).

## Limites (por desenho)
- **Não altera nada:** sem ferramentas de edição, sem push, sem commit.
- **Não aprova:** não usa a API de review, então não satisfaz a aprovação exigida pela proteção da `main`. Nenhum agente aprova a própria mudança.
- **Não faz merge nem deploy.**
- **Só PRs do próprio repositório:** secrets nunca vão para PR de fork. Drafts e Dependabot não são revisados.
- **Token mínimo:** usa o token do workflow, restrito a `contents: read` e `pull-requests: write`. Não usa o token do app do Claude.
- **Texto não confiável:** o texto da PR e da issue é tratado como dado. O prompt só interpola o número da PR.

## Custo
Cada push numa PR aberta roda uma revisão. Um push novo cancela a revisão anterior da mesma PR (`concurrency`).

## Próximo passo (fora desta PR)
Tornar `qa-review` check obrigatório na proteção da `main` e exigir o check no Release Governor. São mudanças de política, R3, com decisão humana, e só depois de observar as primeiras revisões reais.
