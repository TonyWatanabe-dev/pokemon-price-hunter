# Checklist de release e evidências pré-merge

Checklist reproduzível para PRs na `main`. Complementa `docs/executor.md` e o `CLAUDE.md`; não os substitui.

## Como usar

- Copie as seções abaixo para a descrição do PR e marque cada item com a evidência (link do job, comando e resultado resumido, ou "N/A" com o motivo).
- **Obrigatório** vale para todo PR. **Condicional** vale só quando o gatilho descrito ocorre; fora disso, marque "N/A" e diga por quê.
- Evidência não inclui segredos, valores de variáveis nem dados de conexão. Em PR de repositório público, nada de trechos de log com dados sensíveis.
- **Este checklist não autoriza merge nem deploy.** Merge na `main` publica em produção e exige aprovação explícita do usuário, válida só para aquele PR (`docs/executor.md`). Checklist completo é condição necessária, não suficiente.

## 1. Obrigatórios (todo PR)

- [ ] **Origem isolada:** o PR sai de um branch `task/<slug>` (ou worktree própria) e não mexe direto na `main`. Um branch por tarefa.
- [ ] **Escopo:** o diff faz só o que a tarefa/issue pede; sem reestruturar módulos, trocar bibliotecas ou reescrever componentes sem pedido. Commit(s) com mensagem em português.
- [ ] **Testes locais:** `npm test` rodou e passou antes de integrar. Evidência: resultado final do comando. Nenhum teste foi desativado, pulado ou enfraquecido.
- [ ] **CI:** o job `test` do workflow **CI** (`ci.yml`, roda `npm ci` e `npm test` com PostgreSQL descartável) está verde no último commit do PR.
- [ ] **Conflitos:** nenhum conflito foi resolvido descartando alterações (`--ours`/`--theirs` em massa, `reset --hard`, `push --force`, `clean`). Se houve conflito, as duas intenções foram preservadas.
- [ ] **Secrets:** o diff não contém `.env`, tokens, chaves, credenciais nem URLs de conexão. Nada de secrets em descrição, comentários ou logs colados.
- [ ] **Produção:** nenhuma ação em produção foi feita (deploy, alteração de ambiente, leitura ou escrita no banco de produção) sem autorização explícita, e a autorização citada vale só para a ação pedida.
- [ ] **Impacto de produção declarado:** a descrição diz o que muda para o usuário final e para o robô após o merge (ou "nada: só documentação/testes").
- [ ] **Reversão:** a descrição diz como desfazer (reverter o PR; se houver migration ou dado gravado, o que fazer além do revert).

## 2. Condicionais (conforme o que o PR toca)

### Migrations (`db/migrations/*.sql`)
Gatilho: o PR adiciona ou altera migration.
- [ ] Arquivo novo numerado em sequência (próximo número livre); migration já aplicada não é editada.
- [ ] Aplica em banco limpo e em banco já migrado: `node tools/db-migrate.mjs` rodado duas vezes, a 2ª sem fazer nada (mesmo critério do `db-validate.yml`).
- [ ] Os testes de banco (`*-db-tests.js`) passaram com `TEST_DATABASE_URL` apontando para um PostgreSQL descartável, **nunca** o de produção.
- [ ] Para mudança relevante de schema ou invariantes: workflow **Banco: validar Marketplace Core** (`db-validate.yml`, manual) rodado com o resultado anexado, e só com autorização do usuário, pois usa o banco real e o secret `DATABASE_URL`.
- [ ] Efeito em `src/`, `api/` e `tools/` que leem as tabelas verificado.

### Riscos de dados
Gatilho: o PR toca `data/`, `config/`, `db/snapshots`, `db/reference-imports`, sincronização, matching, preço, score, ranking ou oportunidade.
- [ ] Arquivos de `data/` não são editados à mão; eles pertencem ao robô (ramo `data`). Se for inevitável, justificar.
- [ ] Mudança em `config/` (catálogo, lojas, watchlist, `matching-overrides.json`) tem exemplo antes/depois e efeito esperado nas ofertas.
- [ ] Mudança de regra de preço/score/oportunidade: comparação antes/depois (por exemplo `npm run opportunity:compare` ou `npm run api:compare` sobre `data`), com diferenças explicadas.
- [ ] Idempotência: reexecutar a rotina não duplica registros (chaves únicas, `dedupe_key`).
- [ ] Revisão humana (`tools/review.mjs`, `docs/agentes.md`): agentes só propõem; nada escreve preço, score, ranking, oportunidade, oferta ou referência pela revisão.

### Workflows (`.github/workflows/*.yml`)
Gatilho: o PR cria ou altera workflow.
- [ ] Permissões mínimas (`permissions:`); sem novos secrets sem pedido explícito.
- [ ] Workflow do PR continua sem secrets e só leitura (como o `ci.yml`).
- [ ] Mudança em `hunter.yml`/`watchdog.yml`: impacto na frequência, na `concurrency` (grupo `hunter`) e no vigia (`docs/vigia.md`) descrito.
- [ ] Workflows com `workflow_dispatch` ou agendados não foram disparados sem autorização.

### Segurança
Gatilho: autenticação, permissões, entrada de usuário, API pública, dependências, links externos.
- [ ] Entradas validadas; sem SQL montado por concatenação; saída HTML escapada.
- [ ] Permissões respeitadas (`review.decide`, `REVIEW_OPERATORS`, usuário só-leitura da API: `tools/db-grants.mjs`).
- [ ] Dependências: mudança em `package.json`/lockfile justificada; sem nova dependência sem pedido.
- [ ] Nada sensível exposto em respostas da API, logs, relatórios ou artefatos.

### UX (`index.html`, `account.js`, `api/pagina.mjs`, `api/_seo.mjs`, páginas)
Gatilho: o PR muda o que o usuário vê.
- [ ] Descrição com captura de tela ou texto antes/depois dos estados principais (normal, vazio, erro, carregando).
- [ ] Verificado em tela estreita (celular) e larga; textos em português do Brasil.
- [ ] Preço, data e fonte mostrados batem com os dados; estado desatualizado é sinalizado (`api/_lib/freshness.mjs`).
- [ ] Páginas indexáveis: SEO e `sitemap` continuam coerentes.

### Compatibilidade
Gatilho: contrato da API (`api/v1.mjs`, `api/_lib/*`), formato de `data/*`, `config/*`, Node, banco.
- [ ] Contrato da API: campos existentes mantidos; mudança incompatível descrita e coberta por teste (`opportunity-contract-tests.js`, `api-tests.js`).
- [ ] Consumidores do formato antigo (`api/_lib/legacy.mjs`, front, robô) continuam funcionando.
- [ ] Node `>=20` (CI usa 22) e PostgreSQL 17 (versão do CI e do `db-validate.yml`).
- [ ] Arquivos novos que não devem ir para o deploy estão cobertos por `.vercelignore` (há teste em `deploy-safety-tests.js`).

### Coletores e fontes externas (`src/` coletores, Mercado Livre, VTEX, lojas)
Gatilho: o PR muda como se coleta preço, frete ou catálogo.
- [ ] Falha de fonte não vira queda de preço nem apaga o último valor conhecido; fica sinalizada (vigia por fonte).
- [ ] Testes de coletores (`collectors-tests.js`, `ml-tests.js`) cobrem o caso novo, sem chamadas reais à rede.

### Documentação apenas
Gatilho: o PR só altera `.md`.
- [ ] Comandos, caminhos e nomes citados existem no repo.
- [ ] Mesmo assim, `npm test` e o job `test` do CI estão verdes (ver seção 1).

## 3. Antes de pedir o merge

- [ ] Todos os itens obrigatórios marcados, e os condicionais aplicáveis marcados ou com "N/A" justificado.
- [ ] Pendências e riscos residuais listados na descrição do PR.
- [ ] Pedido explícito de aprovação ao usuário, citando o número do PR. Sem aprovação explícita, não há merge nem deploy; aprovação anterior não vale para este PR.
