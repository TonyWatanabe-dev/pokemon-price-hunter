# Ensaio de backup e restauração — 15/10/2026

Fase 8, critério "backup restaurado num ambiente de teste; runbook seguido por outro worker sem improviso".
Executor: sessão Claude (worker diferente de quem escreveu `docs/backup.md`), seguindo só `docs/backup.md`.
Nada foi enviado ao GitHub nem ao banco de produção: remoto git local e PostgreSQL 16 descartável (porta local).

## Ambiente de teste

- **Retrato real:** conteúdo do ramo `data` de produção em `09c2bbc` (lido com `git fetch --depth 1 origin data`, só leitura), copiado para um repositório bare local que faz o papel do GitHub. Árvore idêntica: `2fb7ba2` nos dois lados.
- **Código:** `main` em `3324e54`.
- **Banco:** PostgreSQL 16 local, banco vazio `drill`, criado e descartado no ensaio.

## Passos e resultado

| Passo do runbook | Comando | Resultado |
|---|---|---|
| Simulação do backup | `node tools/data-backup.mjs --dry-run` | `[simulação] criaria data-backup/2026-10-15` |
| Backup | `node tools/data-backup.mjs` | `data-backup/2026-10-15 criada (1457 ofertas, dados de 2026-10-15T13:00:33.510Z)` |
| Idempotência | `node tools/data-backup.mjs` (2ª vez) | `já existe: nada a marcar hoje` |
| Listar | `node tools/data-restore.mjs --list` | 1 etiqueta |
| Verificar | `--verify 2026-10-15` | `ofertas: 1457  produtos: 263  meta.ops: sim`, 162 arquivos (13.5 MB; `hist/` 141; `history.jsonl` 24142 linhas), "Retrato válido." |
| Simulação | `--to <pasta> 2026-10-15` | "SIMULAÇÃO: 162 arquivos"; pasta não criada |
| Restaurar | `--to <pasta> 2026-10-15 --apply` | 162 arquivos extraídos; `diff -r` contra o ramo `data` original: **idêntico** |
| Proteção | `--apply` de novo na mesma pasta | recusado ("já existe e não está vazia") |
| Banco: esquema | `node tools/db-migrate.mjs` | migrations até `011_offer_product_status_index.sql` |
| Banco: grants | `node tools/db-grants.mjs` | `hunter_api` não existe (esperado em banco novo) |
| Banco: sync | `node tools/db-sync.mjs <pasta>/data` | 1457 ofertas, 256 produtos, 122 lojas, 16195 linhas de histórico, 0 timestamps inválidos |
| Banco: referências | `node tools/db-import-references.mjs` | 60 entradas válidas, 0 rejeitadas |
| Banco: notas | `node tools/db-opportunity.mjs` | **0 produtos avaliados** (`EMPTY_RUN_DELETE_SKIPPED`) — ver "Achado" |
| (correção) Price Engine | `node tools/db-stats.mjs` | 256 produtos, 3170 linhas diárias |
| Banco: notas | `node tools/db-opportunity.mjs` | 1418 ofertas avaliadas, 109 com melhor oferta |
| Validação | `node tools/db-validate.mjs <pasta>/data <saida.json>` | 77 checagens OK, **VALIDAÇÃO OK** |
| Re-sync | `node tools/db-sync.mjs <pasta>/data` (2ª vez) | idempotente: 1457 ofertas, 0 histórico novo |

Contagens no banco restaurado: 1457 ofertas ativas (= `state.json`), 256 produtos (263 − 7 duplicatas em revisão), 1418 notas, 16195 linhas de histórico.

## Achado (corrigido no mesmo PR)

A lista "Ressincronizar o banco" de `docs/backup.md` pulava `node tools/db-stats.mjs`. Sem ele, `db-opportunity` não acha `product_stats` e não calcula nada. A ordem certa é a do robô (`hunter.yml`): migrate → grants → sync → referências → **stats** → opportunity. O runbook ganhou o passo e a validação final; `test/backup-runbook-tests.js` compara as duas listas.

## O que este ensaio não cobre

- **Nenhuma etiqueta `data-backup/*` existe no GitHub:** o workflow "Backup dos dados" nunca rodou (0 execuções) e segue sem agendamento. O ensaio criou a etiqueta no remoto de teste. Ligar o backup é decisão do proprietário (`docs/backup.md`, "Como ativar o agendamento").
- **Banco Supabase:** sem backup próprio (plano Free, sem PITR). A recuperação do banco depende de restaurar `data/` e ressincronizar (provado acima); dados só do banco (contas/favoritos/alertas de usuário, se migrados para lá) não têm cópia.
- O passo "voltar o ramo `data` no GitHub" (push -f) não foi ensaiado: escreve em produção.
