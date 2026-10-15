# Backup e restauração

## Por que existe

O ramo `data` é reescrito a cada rodada do robô (`tools/push-data.sh`: um commit só, `push -f`). Não há histórico: uma rodada ruim apaga a única cópia de `state.json`, `offers.json`, `history.jsonl`, `hist/`, `alerts-sent.json`, `meta.json`, `copag-msrp.json` etc.

## Estado: ligado (agendamento diário)

Decisão do proprietário de 15/10/2026: o workflow **Backup dos dados** roda sozinho **todo dia às 04:37 UTC** (01:37 em Brasília), pelo `schedule` de `.github/workflows/backup-data.yml`, longe da rodada diária das 09:17.

- `workflow_dispatch` continua: dá para rodar à mão (Actions → Backup dos dados → Run workflow) ou pelo cron-job.org (ver "Disparo pelo cron-job.org"). Repetir no mesmo dia não faz mal (idempotente).
- O job só roda a partir da `main` (`if: github.ref == 'refs/heads/main'`): um disparo manual escolhendo outro ramo é pulado e não marca nem apaga nada.
- O agendador do GitHub pode atrasar ou pular execuções em horário de pico. Se aparecerem dias sem etiqueta, o cron-job.org vira a fonte principal e o `schedule` fica como reserva. Conferência rápida: `node tools/data-backup.mjs --check-age` (sai 1 se a etiqueta mais nova tiver mais de 2 dias).
- O primeiro retrato só existe depois da primeira execução após o merge. Para tê-lo no mesmo dia, rodar uma vez à mão (ver "Como validar depois da publicação").
- Para desligar: remover o bloco `schedule` por PR (ou Actions → Backup dos dados → … → Disable workflow).

## O que está coberto: a pasta data/, por etiquetas

- **Workflow**: `.github/workflows/backup-data.yml` → `tools/data-backup.mjs`.
- **O que faz**, a cada disparo (uma vez por dia pelo agendamento, mais os disparos manuais):
  1. busca o ramo `data` e fixa o sha do commit;
  2. valida o retrato:
     - `state.json` legível, com `generatedAt` válido e com a lista `offers`;
     - `meta.json` legível.
  3. se válido, cria a etiqueta anotada `data-backup/AAAA-MM-DD` (data em UTC) **nesse sha**. A mensagem da etiqueta traz `generatedAt`, ofertas, produtos e `ops.last.runId`.
- **Por que funciona**: a etiqueta mantém o commit vivo no GitHub mesmo depois dos `push -f` seguintes.
- **Sem corrida com o robô**: o backup tem grupo de concorrência próprio (`data-backup`) e marca o sha que buscou, nunca o nome do ramo. Se o robô reescrever o ramo no meio, a etiqueta continua apontando para um retrato completo.
- **Idempotente**: se a etiqueta do dia já existe, não mexe nela. Fica o primeiro retrato válido do dia.
- **Retrato inválido**:
  - não é marcado;
  - o job falha (vermelho no Actions, com o motivo no resumo);
  - nada é apagado.
  O vigia não olha este workflow: falha de backup aparece só no Actions e no e-mail de falha do GitHub.
- **Permissões**: `contents: write`, só para criar e apagar etiquetas. Nenhum secret é usado (só o `GITHUB_TOKEN` do próprio job e a variável opcional `BACKUP_RETENTION_DAYS`).
- **Simulação**: `node tools/data-backup.mjs --dry-run` valida e mostra o que faria, sem enviar nada ao remoto.

### Retenção

- Padrão: **14 dias**. Para mudar, criar a variável do repositório `BACKUP_RETENTION_DAYS` (Settings → Secrets and variables → Actions → Variables). Aceita de 3 a 365; valor inválido volta para 14.
- Só são apagadas as etiquetas no formato exato `data-backup/AAAA-MM-DD` mais velhas que a retenção (`planPrune` em `tools/data-backup.mjs`). Ramos, outras etiquetas e qualquer outra ref nunca são apagados.
- Com o agendamento diário e o padrão de 14 dias, ficam em torno de 15 etiquetas (≈ duas semanas de retratos).
- **As 3 mais recentes nunca são apagadas**, mesmo velhas (ex.: robô parado há um mês).
- Etiqueta com outro nome nunca é apagada. Exemplo: `data-backup/antes-da-restauracao`, para guardar um retrato à mão por tempo indeterminado.
- Tamanho: cada retrato tem ~7,5 MB (out/2026). Arquivos que não mudam entre dias são guardados uma vez só pelo Git.

## O que NÃO está coberto: o banco (Supabase)

- **Plano Free**: sem backup automático e sem PITR.
- **Planos pagos**: backup diário (Pro guarda 7 dias). PITR só como adicional pago.
- **Plano atual**: não sabemos. O dono confere em Supabase → Project Settings → Billing / Database → Backups.

### O que se perde se o banco sumir

- **Dá para reconstruir a partir de `data/`** (ver "Ressincronizar o banco"):
  - produtos, lojas e ofertas;
  - histórico de preços que ainda está em `history.jsonl`;
  - referências Copag do robô e as auditadas (`db/reference-imports/`, no `main`);
  - notas do motor (recalculadas).
- **Não dá para reconstruir**:
  - histórico de preços mais antigo que o `history.jsonl`;
  - decisões tomadas na fila de revisão (`review_item`);
  - eventos (`system_event`);
  - o usuário só-leitura `hunter_api` e as senhas.

### Recomendado: cópia do banco cifrada e guardada em lugar privado

Este repositório é **público**: artefatos do Actions, ramos e etiquetas daqui podem ser lidos por qualquer pessoa. Por isso nenhum workflow de cópia do banco foi criado.

O dono precisa decidir:

1. **Onde guardar.** Opções: repositório privado separado, bucket privado (S3/R2/Backblaze) ou disco próprio. Nunca neste repositório.
2. **Chave de cifra.** Exemplo: senha `age` ou `gpg --symmetric`, em Secret (`BACKUP_PASSPHRASE`) e guardada fora do GitHub também. Sem ela a cópia não serve para nada.
3. **URL do banco para a cópia.** Usar o **Session pooler (porta 5432)** do Supabase, nunca o Transaction pooler (6543). O `pg_dump` não funciona direito no 6543.
4. **Frequência e retenção.**

Comandos para o dono rodar à mão, na própria máquina, até que isso esteja decidido. Não enviam nada:

```bash
# URL do Session pooler: Supabase → Connect → Session pooler (porta 5432). Nunca a de 6543.
export DB_SESSION_URL='postgresql://postgres.<ref>:<senha>@aws-0-<região>.pooler.supabase.com:5432/postgres'
pg_dump "$DB_SESSION_URL" --schema=hunter --no-owner --no-privileges -Fp -f hunter-$(date -u +%F).sql
# ou: supabase db dump --db-url "$DB_SESSION_URL" -s hunter -f hunter-$(date -u +%F).sql
gpg --symmetric --cipher-algo AES256 hunter-$(date -u +%F).sql && shred -u hunter-$(date -u +%F).sql
```

- **Versão do `pg_dump`**: precisa ser igual ou maior que a do servidor.
- **Restauração** num banco vazio, tudo ou nada:

  ```bash
  gpg -d hunter-AAAA-MM-DD.sql.gpg | psql "$DB_SESSION_URL" --single-transaction -v ON_ERROR_STOP=1
  ```

## Restauração de data/

Ferramenta: `tools/data-restore.mjs`. Só lê do GitHub e grava numa pasta local. **Nunca faz push** e nunca mexe no ramo `data`.

- Sem `--apply`, `--to` é sempre **simulação**: só lista o que seria extraído e não grava nada.
- `--apply` é a confirmação explícita para gravar, e só numa pasta vazia (recusa sobrescrever).
- Voltar o ramo `data` no GitHub não é feito pela ferramenta: é um passo manual do dono, descrito abaixo.

```bash
node tools/data-restore.mjs --list                          # etiquetas no GitHub, mais nova primeiro
node tools/data-restore.mjs --verify 2026-10-09             # confere o retrato (aceita a data ou o nome completo)
node tools/data-restore.mjs --to /tmp/rest 2026-10-09       # SIMULAÇÃO: lista o que seria extraído
node tools/data-restore.mjs --to /tmp/rest 2026-10-09 --apply   # extrai para /tmp/rest/data (pasta vazia)
```

O `--verify` confere e mostra:
- se os JSONs abrem;
- `generatedAt`;
- número de ofertas e de produtos;
- se há `meta.ops`;
- número de arquivos, `hist/` e linhas do `history.jsonl`.

### Voltar o ramo data para um retrato (manual, pelo dono)

Antes de tudo:

- **Pausar o robô**:
  - desativar o job dele no cron-job.org;
  - desativar o workflow **Price Hunter** em Actions (… → Disable workflow).
  Se não pausar, a próxima rodada reescreve o ramo por cima.
- **Guardar o estado atual**, mesmo ruim, numa etiqueta que nunca é apagada:

  ```bash
  git fetch --depth 1 origin data
  git tag data-backup/antes-da-restauracao-$(date -u +%F) FETCH_HEAD
  git push origin refs/tags/data-backup/antes-da-restauracao-$(date -u +%F)
  ```

Depois, restaurar, **mantendo o acesso atual ao Mercado Livre**. O token renovável é de uso único: o `ml-auth.enc` do retrato antigo provavelmente já foi usado. Trocar pelo atual:

```bash
node tools/data-restore.mjs --to /tmp/rest 2026-10-09 --apply
git show FETCH_HEAD:data/ml-auth.enc > /tmp/rest/data/ml-auth.enc   # token atual (FETCH_HEAD = ramo data de agora)
cd /tmp/rest
git init -q -b data
git add data
git commit -qm "restauração de data-backup/2026-10-09"
git push -f https://github.com/TonyWatanabe-dev/pokemon-price-hunter.git data
```

Se o `ml-auth.enc` atual também estiver estragado, pular a troca e refazer a autorização depois, pelo workflow **Mercado Livre: autorizar** (`ml-auth.yml`).

Atalho sem a troca, só se o token do retrato ainda for o atual:

```bash
git push -f origin 'data-backup/2026-10-09^{commit}:refs/heads/data'
```

Por fim, reativar o robô e conferir a próxima rodada em Actions e no `meta.json`.

**Efeitos de voltar no tempo**:
- o que aconteceu entre o retrato e agora some do ramo (`history.jsonl`, `hist/`);
- o `alerts-sent.json` também volta, então alertas recentes podem ser repetidos uma vez.

### Ressincronizar o banco a partir de um data/ restaurado (manual, pelo dono)

Só é preciso se o banco foi perdido ou corrompido. No dia a dia, o robô já sincroniza a cada rodada.

```bash
export DATABASE_URL='<URL do banco, Session pooler 5432>'
node tools/db-migrate.mjs                    # cria o esquema hunter (idempotente)
node tools/db-grants.mjs                     # leitura para hunter_api, se o usuário existir
node tools/db-sync.mjs /tmp/rest/data        # produtos, lojas, ofertas e histórico do retrato (idempotente)
node tools/db-import-references.mjs          # referências auditadas (db/reference-imports, no main)
node tools/db-stats.mjs                      # Price Engine: product_stats e série diária (sem ele, a próxima linha avalia 0 produtos)
node tools/db-opportunity.mjs                # recalcula as notas
node tools/db-validate.mjs /tmp/rest/data /tmp/rest/validacao.json   # confere contagens e invariantes: "VALIDAÇÃO OK"
```

Com um retrato mais velho que o banco:
- ofertas que não estão no retrato ficam como `removed`;
- o histórico só recebe linhas mais novas que a última gravada (não duplica).

A rodada seguinte do robô volta a sincronizar normalmente.

Teste automático desta volta completa: `test/backup-tests.js`. Ele restaura um retrato, roda o `db-sync` num banco descartável e confere se o número de ofertas é igual.

A ordem acima é a mesma do passo de banco do robô (`.github/workflows/hunter.yml`); `test/backup-runbook-tests.js` falha se as duas divergirem.

**Ensaio registrado:** 15/10/2026, seguindo só este documento, num ambiente de teste (remoto git local + PostgreSQL 16 descartável): `docs/smoke/restore-drill-2026-10-15.md`. O ensaio achou a falta do `db-stats` nesta lista (corrigida).

## Disparo pelo cron-job.org (a ser feito pelo dono da conta)

Mesmo padrão do vigia (`docs/vigia.md`). Opcional desde que o `schedule` foi ligado: serve de redundância, porque o agendador do GitHub pode pular execuções neste repositório.

- **URL** (POST): `https://api.github.com/repos/TonyWatanabe-dev/pokemon-price-hunter/actions/workflows/backup-data.yml/dispatches`
- **Cabeçalhos**:
  - `Accept: application/vnd.github+json`
  - `X-GitHub-Api-Version: 2022-11-28`
  - `Content-Type: application/json`
  - `Authorization: Bearer <o mesmo token usado no job do robô>` (precisa de "Actions: read and write")
- **Corpo**: `{"ref":"main"}`
- **Horário**: uma vez por dia, ex.: 04:41 UTC (01:41 em Brasília), poucos minutos depois do `schedule` das 04:37 e longe da rodada diária das 09:17. Se o `schedule` já marcou o dia, o disparo só confirma "Retrato do dia já existia".

Repetir no mesmo dia não faz mal (idempotente).

## Como validar depois da publicação

1. Rodar **Backup dos dados** à mão (Actions → Run workflow). O resumo deve mostrar "Retrato marcado" e a etiqueta deve aparecer em Tags.
2. Rodar de novo: "Retrato do dia já existia".
3. Na máquina local, conferir o retrato com `node tools/data-restore.mjs --list` e depois `--verify <data>`.
4. No dia seguinte, conferir em Actions uma execução com evento `schedule` perto das 04:37 UTC e a etiqueta nova em Tags.

## Riscos e limites

- **Repositório público**: as etiquetas são públicas, como o ramo `data`. Nada novo fica exposto (`ml-auth.enc` é cifrado com Secret). **Nunca** guardar cópia do banco aqui.
- **Mesmo lugar**: as etiquetas ficam no próprio GitHub. Protegem contra rodada ruim e `push -f`, não contra perda do repositório ou da conta. Para isso, fazer de vez em quando `git clone --mirror` numa máquina própria.
- **Regras de proteção de etiquetas**: se alguma regra (ruleset) proteger `data-backup/*`, o `GITHUB_TOKEN` pode não conseguir apagar etiquetas e a poda falha.
- **Não é instantâneo**: um retrato por dia. O que foi gerado entre dois backups pode se perder.
- **Primeiro retrato válido do dia**: se o dia começou com dados ruins, mas válidos no formato, é esse que fica. Para guardar outro, criar à mão uma etiqueta com nome livre.
