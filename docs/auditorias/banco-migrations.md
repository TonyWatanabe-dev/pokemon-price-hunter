# Auditoria: schema, migrations e rollback do banco (Fase 6, issue #474)

Escopo: `db/migrations/`, `db/rollback/`, `tools/db-*.mjs`, `docs/migrations.md` e os testes de banco. Só leitura, sem acesso a produção.
Não repete: `docs/migrations.md` (inventário, ordem e destrutivas por arquivo), `frescor-sync` (passo "Sincronizar com o banco" com `continue-on-error`), `alertas-usuario` (tabelas por usuário sem código de app) nem `docs/backup.md` (backup do banco depende do plano Supabase, não verificado; nenhum workflow faz cópia, l.57-61,78).

## 1. Mapa
| Arquivo | Trecho | Papel |
|---|---|---|
| `tools/db-migrate.mjs:9` | `CREATE TABLE IF NOT EXISTS hunter.schema_migrations (version text PRIMARY KEY, applied_at ...)` | controle de versão: a chave é o **nome do arquivo** |
| `tools/db-migrate.mjs:10-21` | `done.has(f)` → `BEGIN; sql; INSERT ...; COMMIT` / `ROLLBACK; break` | aplica pendentes em ordem alfabética, uma transação por arquivo, para no primeiro erro |
| `db/migrations/001..011` | `SET search_path = hunter;` | 11 arquivos; 004:17,32 e 005:6 com `DROP TABLE IF EXISTS`; 006:17,21 e 007:13 com `UPDATE` |
| `db/migrations/011_offer_product_status_index.sql:11` | `CREATE INDEX IF NOT EXISTS ...` (sem `CONCURRENTLY`, l.5-8) | único índice criado fora do schema base |
| `db/rollback/010_reference_evidence.down.sql` | `CREATE OR REPLACE VIEW reference_price_current` (corpo da 006) | rollback manual da 010; não apaga o registro em `schema_migrations` (l.14-21) |
| `db/rollback/011_offer_product_status_index.down.sql:9` | `DROP INDEX IF EXISTS offer_product_status_idx;` | rollback manual da 011 + `DELETE FROM hunter.schema_migrations` (l.4) |
| `tools/db-validate.mjs:34-36` | `check('migrations 001 e 002 registradas', ...)` | relatório do banco real; só exige 001 e 002 |
| `tools/db-grants.mjs:12-14` | `GRANT SELECT ON ALL TABLES` + `ALTER DEFAULT PRIVILEGES` | leitura para `hunter_api`, inclusive tabelas futuras |
| `.github/workflows/hunter.yml:113` | `node tools/db-migrate.mjs` (grupo `concurrency: hunter`, l.15-16) | migra produção a cada rodada |
| `.github/workflows/review.yml:35` | `node tools/db-migrate.mjs` (grupo `concurrency: review`, l.21-22) | migra produção ao processar revisões |
| `.github/workflows/db-validate.yml:42-47,94-98` | migra 2×, depois `db-validate.mjs` | validação manual em Supabase e em Postgres local |

## 2. Já coberto
| Comportamento | Teste / evidência |
|---|---|
| Nome `NNN_*.sql`, sequência sem buraco, `SET search_path`, sem `BEGIN/COMMIT`, sem `DROP SCHEMA` | `test/migrations-static-tests.js:14-33` |
| Lista fechada de destrutivas por arquivo (nova `DROP/TRUNCATE/DELETE` falha) | `test/migrations-static-tests.js:19-40` |
| `docs/migrations.md` cita toda migration | `test/migrations-static-tests.js:42-44` |
| Schema do zero + migrador rodado 2× (2ª não faz nada) | `test/db-tests.js:9-11` (CI: `ci.yml:35-36` com Postgres) |
| 010 aplicada pelo migrador real sobre 001..009, reaplicação e **rollback da 010** comparado por `pg_get_viewdef` | `test/reference-evidence-db-tests.js:1-7,39-47,91,115-121` |
| FK/unicidade produto ↔ oferta ↔ histórico e o que o schema não impede | `test/integrity-db-tests.js:1-4` |
| Isolamento por usuário, rollback de transação e cascata | `test/user-isolation-db-tests.js:1-2` |
| Migrador sobre schema limpo em outros fluxos | `api-db-tests.js:50-51`, `opportunity-db-tests.js:19-20`, `backup-tests.js:182-183` |

## 3. Lacunas priorizadas
**Alta**
1. **Migrador sem trava entre execuções.** `db-migrate.mjs` não usa `pg_advisory_lock` (nenhuma ocorrência de `advisory`/`lock` no arquivo). `hunter.yml` e `review.yml` rodam o migrador em produção em grupos de concorrência **diferentes** (`hunter` × `review`), então podem coincidir quando há migration pendente. As duas leem `done` antes (l.10) e tentam aplicar o mesmo arquivo; a segunda falha (DDL repetido ou PK de `schema_migrations`), faz `ROLLBACK` e sai com código 1. Nenhum teste roda dois migradores em paralelo.
2. **Rollback da 011 nunca foi executado em teste.** Só `test/reference-evidence-db-tests.js` lê `db/rollback/` (grep por `db/rollback`/`down.sql` em `test/`). O `.down.sql` da 011 e o passo manual de `DELETE FROM hunter.schema_migrations` (l.4-5) não têm prova de que o índice some e volta na próxima rodada.
3. **Divergência banco × repositório não é detectada.** A versão é o nome do arquivo (`db-migrate.mjs:12`): renomear uma migration aplicada faz o migrador rodá-la de novo; editar o conteúdo não é percebido (`docs/migrations.md:9`, "Não há checksum"). `db-validate.mjs:36` só confere 001 e 002, não a lista completa nem versões registradas sem arquivo.

**Média**
4. **`db/rollback/` fora da validação estática.** `migrations-static-tests.js` só lê `db/migrations` (l.9). Um `.down.sql` sem `SET search_path`, com `BEGIN/COMMIT` ou apontando para migration inexistente passa no `npm test`.
5. **Documento desatualizado sobre rollback.** `docs/migrations.md:9` diz "Não existe migration 'down'", mas há dois `.down.sql`; a l.48 cita só o da 011 e o da 010 não é mencionado.

**Baixa**
6. 004/005 recriam tabelas com `DROP TABLE` e 006/007 fazem `UPDATE` sem guardar o valor antigo; o rollback depende de recálculo ou de backup cuja existência não é verificada (`docs/backup.md:57-61`). Isso já está documentado; fica como risco para próximas migrations destrutivas, não como tarefa aqui.

## 4. Tarefas pequenas e independentes (sem `index.html`)
1. **Trava no migrador** — `tools/db-migrate.mjs`: `pg_advisory_lock(<constante>)` numa conexão dedicada antes de ler `schema_migrations`, liberada no `finally`. Teste novo `test/db-migrate-lock-tests.js` (pula sem `TEST_DATABASE_URL`). **R1.**
   Aceite: com schema limpo, dois `node tools/db-migrate.mjs` em paralelo saem com código 0 e cada versão aparece uma única vez em `hunter.schema_migrations`.
2. **Teste do rollback da 011** — só teste novo `test/offer-index-rollback-db-tests.js`. **R0.**
   Aceite: depois do migrador, `offer_product_status_idx` existe em `pg_indexes`; aplicar o `.down.sql` remove o índice; sem o `DELETE` em `schema_migrations` o migrador **não** recria; com o `DELETE`, recria.
3. **Validação estática de `db/rollback/`** — teste novo `test/rollback-static-tests.js`. **R0.**
   Aceite: todo arquivo bate com `^\d{3}_[a-z0-9_]+\.down\.sql$`, existe `db/migrations/<mesmo nome>.sql`, tem `SET search_path = hunter`, não tem `BEGIN/COMMIT/ROLLBACK` e é citado em `docs/migrations.md` (falha hoje para a 010, até a tarefa 4).
4. **Corrigir `docs/migrations.md`** — trocar a frase da l.9 por "rollbacks manuais ficam em `db/rollback/`, fora do migrador" e citar `010_reference_evidence.down.sql` junto da linha da 011. **R0.**
   Aceite: `npm test` verde; com a tarefa 3 integrada, o teste dela passa.
5. **Conferir versões no `db-validate`** — `tools/db-validate.mjs`: check "toda migration do repositório registrada" e "nenhuma versão registrada sem arquivo" (lista de `db/migrations/*.sql` × `rep.migrations`), sem alterar o banco. Teste em `test/db-validate-migrations-tests.js` com função pura extraída, sem banco. **R1.**
   Aceite: lista igual → os dois checks `ok`; versão faltando ou sobrando (ex.: arquivo renomeado) → check `ok: false` com o nome no `detail`.

Fora do escopo: checksum em `schema_migrations` (muda o schema de controle, R2, exige decisão), `CREATE INDEX CONCURRENTLY` fora de transação e backup automático do banco (`docs/backup.md:76-78`, decisão do dono por o repositório ser público).
