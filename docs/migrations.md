# Migrations, estado esperado e rollback

Documento de inventário (issue #87). Nada aqui executa migration em produção; aplicar em produção exige autorização explícita e separada.

## Como o runner funciona (`tools/db-migrate.mjs`)
- Aplica `db/migrations/*.sql` em ordem alfabética do nome, uma vez cada, registrando em `hunter.schema_migrations (version, applied_at)`.
- Cada arquivo roda numa transação própria (`BEGIN` … `INSERT` em `schema_migrations` … `COMMIT`). Se falhar, faz `ROLLBACK` daquele arquivo, para no primeiro erro e sai com código 1. Migrations anteriores permanecem aplicadas.
- Não existe migration "down". Não há checksum: editar um arquivo já aplicado não é detectado e não reexecuta.
- Os arquivos usam `SET search_path = hunter;` e nomes sem prefixo de schema. Não use `BEGIN/COMMIT` dentro deles.

## Inventário

| # | Arquivo | O que faz | Destrutivo? |
|---|---------|-----------|-------------|
| 001 | `001_core.sql` | Schema `hunter` e tabelas do Marketplace Core | Não |
| 002 | `002_seed.sql` | Dados iniciais | Não |
| 003 | `003_review_legacy_duplicates.sql` | Colunas em `review_item`; insere duplicatas legadas como rejeitadas (`ON CONFLICT DO UPDATE`) | Não apaga; atualiza linhas de revisão com a mesma `dedupe_key` |
| 004 | `004_price_engine.sql` | `source_distrust`; recria `price_daily` e `product_stats` | **Sim**: `DROP TABLE IF EXISTS` das duas (eram vazias/sem uso; são derivadas e recalculáveis) |
| 005 | `005_opportunity_engine.sql` | Recria `opportunity` | **Sim**: `DROP TABLE IF EXISTS opportunity` (derivada, recalculável pelo Opportunity Engine) |
| 006 | `006_reference_kinds.sql` | Colunas e constraints em `reference_price`, rótulos `reference_kind`, views atual/histórico, `reference_kind` em `product_stats`, troca de constraint de `product_identifier` | Recria views e uma constraint; `UPDATE` reclassifica linhas existentes (rótulo muda, dado fica) |
| 007 | `007_current_reference_policy.sql` | Colunas de referência atual em `product_stats`; constraints `NOT NULL`/`CHECK` | `UPDATE` zera referência de linhas sem tipo (dado derivado) |
| 008 | `008_opportunity_reference_comparison.sql` | Colunas e constraints em `opportunity` | Não |
| 009 | `009_review_resolution.sql` | Coluna `resolution jsonb` em `review_item` | Não |
| 010 | `010_reference_evidence.sql` | `CREATE OR REPLACE VIEW reference_price_current`: Copag oficial só entra como referência atual com evidência (fonte, domínio Copag, verificação em até 30 dias) (#185) | Não: só a view muda, mesmas colunas e ordem; nenhuma linha é apagada ou alterada; pode ser reaplicada |
| 011 | `011_offer_product_status_index.sql` | Índice `offer_product_status_idx` em `offer (product_id, status)`, com `CREATE INDEX IF NOT EXISTS` (#132) | Não: não muda dados nem colunas; pode ser reaplicada. Bloqueia escritas em `offer` enquanto o índice é criado (sem `CONCURRENTLY`, porque o runner usa transação) |

## Dependências de ordem e compatibilidade
- 004 e 005 dependem de `product` e `offer` (001). 007 depende de `product_stats` (004) e de `reference_kind` (006). 008 depende de `opportunity` (005) e do vocabulário de 006/007. 010 recria a view `reference_price_current` de 006 sobre as colunas de `reference_price`. Por isso a ordem numérica é obrigatória e o runner não pula arquivos.
- 006 e 007 adicionam `CHECK`/`NOT NULL` em tabelas existentes: falham (e revertem aquele arquivo) se houver linhas fora da regra. Em 007 o `UPDATE` anterior cuida das linhas sem tipo; linhas com tipo inválido não são corrigidas e abortam a migration.
- Código novo que lê `reference_kind`, `reference_confidence`, `resolution` etc. exige o schema já migrado. Fluxo seguro: migrar o banco antes de publicar o código que depende dele. As mudanças aditivas (colunas novas) são compatíveis com o código anterior; 004/005/006/007 mudam constraints e podem recusar escritas do código antigo.

## Validação automatizada
- `test/migrations-static-tests.js` (roda no `npm test`, sem banco): nomes `NNN_descricao.sql`, sequência sem buracos, `SET search_path = hunter` em todos, ausência de controle de transação, e lista fechada de operações destrutivas por arquivo (tabela acima). Uma nova `DROP`/`TRUNCATE`/`DELETE` falha o teste até ser revisada e documentada aqui. Também exige que este documento cite cada migration.
- `test/db-tests.js` (com `TEST_DATABASE_URL`, banco descartável): recria o schema, aplica todas as migrations duas vezes (a segunda não faz nada) e exercita o Core. Sem `TEST_DATABASE_URL` ele é pulado; no ambiente sem banco, só a validação estática é garantida.
- Não validado automaticamente: equivalência entre o schema de um banco já em produção e o resultado das migrations (não há comparação de schema nem checksum). Verifique manualmente comparando `hunter.schema_migrations` com a lista de arquivos.

## Rollback e forward-fix (honestamente)
- **Não há rollback automático entre migrations.** O único rollback garantido é o da transação do arquivo que falhou.
- **Migrations aditivas (003, 008, 009 e as colunas de 006/007):** reverter exige novo SQL manual (`DROP COLUMN`/`DROP CONSTRAINT`), que é destrutivo para dados já gravados nelas. Preferir *forward-fix*: nova migration numerada que corrige o problema.
- **004/005 (tabelas recriadas):** o conteúdo anterior foi descartado no `DROP`. Os dados são derivados e recalculáveis (`price_daily` de `price_history` + `stock_event`; `product_stats` e `opportunity` pelos engines), então a recuperação é recalcular, não restaurar.
- **006/007 (`UPDATE` de reclassificação):** o valor antigo das colunas atualizadas não é guardado. Reverter de verdade só com backup/snapshot do banco anterior à migration. Os rótulos novos são deriváveis, os antigos não.
- **Regra prática:** antes de qualquer migration com operação destrutiva ou `UPDATE` em produção, tirar backup do banco e registrar a versão atual de `schema_migrations`. Se a migration já foi aplicada e há problema, corrigir adiante com nova migration; restaurar backup só como último recurso e com autorização.
- Não editar migration já aplicada: crie a próxima número.

## Fora do escopo desta entrega
Nenhuma migration foi executada, nenhum banco de produção foi lido ou alterado e não houve deploy. A PR #20 continua **NÃO INTEGRAR**.
