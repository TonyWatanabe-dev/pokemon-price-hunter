# Auditoria de lacunas: backup, restauração e recuperação do robô

Escopo: lacunas atuais em backup/restauração de `data/`. Não repete `docs/auditorias/*` (nenhuma delas trata de backup; `grep -il backup docs/auditorias/*` não retorna nada antes deste arquivo). Só leitura: nada foi executado contra produção.

## 1. Mapa

| Peça | Arquivo e trecho |
|---|---|
| Publicação (gera o único retrato vivo) | `tools/push-data.sh`: `git init -q -b data` → `git commit` → `git push -q -f ... data` |
| Publicação de `config/` | `tools/push-config.sh`: rebase, em conflito `git rebase --abort`, 3 tentativas |
| Backup diário por etiqueta | `tools/data-backup.mjs`: `runBackup()`, `tagFor()`, `planPrune()`, `KEEP_MIN = 3` |
| Validação do retrato | `validateSnapshot()`: só `data/state.json` (`generatedAt`, `offers`) e `data/meta.json` |
| Restauração | `tools/data-restore.mjs`: `--list`, `--verify`, `--to <pasta> [--apply]` (só extrai, nunca envia) |
| Agendamento | `.github/workflows/backup-data.yml`: `schedule` comentado, só `workflow_dispatch` |
| Procedimento | `docs/backup.md` ("Estado: desligado por padrão", "Restauração de data/", "O que NÃO está coberto: o banco") |
| Runbook | `docs/runbook.md`: seções Rodada falha, Banco, Site e deploy etc. |

## 2. O que já está coberto (`test/backup-tests.js`, executado via `test/redact-tests.js`)

- Retenção, formato de data em UTC, etiquetas fora do padrão e mínimo de 3: bloco "unidades" (`retentionDays`, `tagFor`, `tagDate`, `planPrune`).
- Criação anotada, idempotência no mesmo dia, sha fixo mesmo se o robô reescrever o ramo (`push -f`): bloco "backup".
- Retrato inválido não é marcado e o CLI sai com 1; poda sem tocar `antes-da-migracao`; `--dry-run`: blocos "backup" e retenção.
- `--list`, `--verify`, simulação, `--apply` em pasta vazia, etiqueta inválida (`../../heads/data`), remoto intacto: bloco "restauração".
- Volta completa restaurar → `db-sync` → mesma contagem de ofertas, só com `TEST_DATABASE_URL`: bloco "volta completa no banco".

## 3. Lacunas priorizadas

1. **Alta: backup desligado e sem alarme.** `backup-data.yml` não tem `schedule` e `docs/backup.md` diz "Nada acontece sozinho". Nada detecta que a última etiqueta `data-backup/*` está velha ou ausente; o repositório só tem um commit de `data` reescrito.
2. **Alta: `push-data.sh` publica sem validar.** Roda `set -e`, copia `data/` e faz `push -f` direto. Um `data/` vazio ou com `state.json` corrompido substitui o ramo; o backup só pega isso se já existir etiqueta boa. Sem retry de push (`push-config.sh` tem 3 tentativas).
3. **Média: validação superficial.** `validateSnapshot` não olha `history.jsonl` nem `data/hist/`; `data-restore.mjs` só conta linhas/arquivos (`historyLines`, `histFiles`) e não falha se vierem zerados. Não há teste de retrato sem `hist/` aceito como válido.
4. **Média: runbook sem caminho de recuperação de dados.** `docs/runbook.md` não menciona backup nem `data-restore.mjs` (nenhuma ocorrência de "backup"/"restaur"); a pessoa de plantão precisa achar `docs/backup.md`.
5. **Média: banco fora do backup.** `docs/backup.md` admite que Supabase não é coberto e a cópia cifrada é só "recomendada"; não há script nem teste.
6. **Baixa: testes do fluxo de publicação.** `test/backup-tests.js` reimplementa o procedimento de `push-data.sh` (comentário "Mesmo procedimento"), mas não executa o script real; `push-config.sh` idem não tem teste citado ali.
7. **Baixa: mesmo ponto de falha.** As etiquetas ficam no mesmo repositório (`docs/backup.md`, "Riscos e limites: Mesmo lugar"); sem espelho externo.

## 4. Tarefas pequenas e independentes (nenhuma toca `index.html`)

| # | Tarefa | Arquivos | Risco | Aceite testável |
|---|---|---|---|---|
| T1 | Subcomando `--check-age [--max-days N]` em `data-backup.mjs`: sai 1 se a etiqueta mais nova for mais velha que N dias ou não existir | `tools/data-backup.mjs`, `test/backup-age-tests.js` | R0 | Teste com repositório bare: sem etiquetas → 1; etiqueta de hoje → 0; de 3 dias com N=2 → 1 |
| T2 | `push-data.sh` recusa publicar se `data/state.json` não tiver `offers` ou `generatedAt` (sai 1 antes do `push -f`) | `tools/push-data.sh`, `test/push-data-tests.js` | R1 | Teste roda o script real com remoto bare: `data/` vazio → exit 1 e ramo intacto; `data/` válido → publicado |
| T3 | Retry de 3 tentativas no `push -f` de `push-data.sh`, com `PUSH_DATA_RETRY_SEC` | `tools/push-data.sh`, `test/push-data-retry-tests.js` | R1 | Teste com hook `pre-receive` que falha 2 vezes: exit 0 na 3ª; falha nas 3 → exit 1 |
| T4 | `validateSnapshot` avisa (warning) quando `data/history.jsonl` ou `data/hist/` faltam; `--verify` mostra o aviso | `tools/data-backup.mjs`, `test/backup-hist-tests.js` | R0 | Retrato sem `hist/` continua `ok: true` com warning; com `hist/` sem warning |
| T5 | Seção "Perdi dados" no runbook apontando `--list`, `--verify`, `--to ... --apply` e o passo de `db-sync` | `docs/runbook.md` | R0 | `grep -c "data-restore.mjs" docs/runbook.md` ≥ 1 e comandos iguais aos de `docs/backup.md`; `npm test` verde |
| T6 | Teste que executa `tools/push-config.sh` de verdade (sem mudança → 0; conflito → aborta e sai 0; push que falha 3 vezes → 1) | `test/push-config-tests.js` | R0 | Os três cenários passam com `PUSH_CONFIG_RETRY_SEC=0` |

Ordem sugerida: T2 e T1 primeiro (fecham as lacunas 1 e 2); as demais em qualquer ordem.
