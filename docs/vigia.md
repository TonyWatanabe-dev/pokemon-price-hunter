# Vigia do robô: estado operacional e avisos

## O que existe

- **Robô (`src/run.js`)**: a cada rodada grava em `data/meta.json`, na seção `ops`, um registro com:
  - identificação da rodada (`runId`, tentativa, commit, gatilho);
  - horário dos dados, início, fim e duração;
  - resultado (`ok` ou `parcial`, quando o prazo adiou lojas);
  - situação da sincronização com o banco;
  - leitor oficial (`ok`/`unavailable`/`off`, com N válidas e M lidas);
  - lojas: ativas, com anúncios, sem resultado, bloqueadas, com erro e adiadas.
  As outras chaves do arquivo (`dataVersion`, `distrust`) são preservadas. São guardados os últimos 96 registros, além de `last` e `lastHealthy`. Um registro inválido nunca substitui o último válido: fica em `lastInvalid`.
- **Sincronização**: o passo "Sincronizar com o banco" roda depois da publicação, então o resultado dele só pode ser visto na rodada seguinte.
  - A rodada seguinte lê, só para leitura, `max(offer.last_seen_at)` (ver `src/db-health.js`).
  - Se o valor for igual ao horário da rodada anterior, a sincronização chegou ao banco: `dbSync.status = ok`. Se for menor, não chegou: `atrasado`.
  - Outros estados: `indisponivel` (não deu para ler o banco), `desligado` (sem `DATABASE_URL`), `sem_referencia` (primeira rodada).
- **Vigia (`.github/workflows/watchdog.yml` → `tools/watchdog.mjs` → `src/ops-watch.js`)**:
  - lê os dados publicados e o `meta.json` do mesmo commit do ramo `data`, além das últimas rodadas do robô na API do Actions;
  - decide o estado e avisa só nas transições.

## Regras (constantes em `src/ops-watch.js`, objeto `RULES`)

| Estado | Quando |
|---|---|
| `parado` | dados publicados há mais de 45 min |
| `degradado` | as 2 últimas rodadas concluídas falharam |
| | `meta.json` ilegível |
| | seção `ops` mais de 45 min atrás dos dados |
| | nas 2 últimas rodadas registradas: banco sem a rodada anterior, banco ilegível, robô sem `DATABASE_URL` ou leitor indisponível |
| | **zero notas válidas**: leitor ok, pelo menos 10 linhas lidas e nenhuma válida, nas 2 últimas rodadas. Com menos de 10 lidas, só fica registrado |
| `desconhecido` | sem dados publicados legíveis, ou ainda sem `ops` registrado. Nunca avisa e não muda o livro |
| `saudavel` | nenhum dos casos acima |

**Avisos:**
- um na passagem para `degradado` ou `parado`, ou quando aparece um problema novo;
- um lembrete a cada 6 h enquanto o problema continuar;
- um de recuperação depois de 2 checagens saudáveis seguidas.

O livro do que já foi avisado (`wd/ledger.json`, no cache do Actions) só muda quando a mensagem chega a pelo menos um canal. Se todos falharem, o aviso é tentado de novo na checagem seguinte. Cada canal tem prazo de 10 s.

## Configuração externa (cron-job.org), a ser feita pelo dono da conta

Criar um job **igual ao do robô**, só que apontando para o vigia:

- **URL** (POST): `https://api.github.com/repos/TonyWatanabe-dev/pokemon-price-hunter/actions/workflows/watchdog.yml/dispatches`
- **Cabeçalhos**:
  - `Accept: application/vnd.github+json`
  - `X-GitHub-Api-Version: 2022-11-28`
  - `Content-Type: application/json`
  - `Authorization: Bearer <o mesmo token usado no job do robô>` (precisa de "Actions: read and write" neste repositório)
- **Corpo**: `{"ref":"main"}`
- **Horário**: a cada 15 min, nos minutos 7, 22, 37 e 52, defasado do robô.

Não é preciso criar endpoint público: o disparo usa a API do GitHub com o token que já existe.

Falhas e recuperação em geral: `docs/runbook.md`.

## Como validar

1. Depois da publicação, rodar **Vigia do robô** manualmente com `teste = true`. Deve chegar "🧪 Teste do vigia" no Telegram e no ntfy, e o livro não muda.
2. Ativar o job no cron-job.org e conferir em Actions → Vigia do robô:
   - execuções `workflow_dispatch` a cada ~15 min;
   - o resumo de cada execução mostrando o estado e a idade dos dados.
3. Conferir no ramo `data`, em `data/meta.json → ops.last`:
   - `dbSync.status = ok`;
   - `reader.status = ok` com N > 0;
   - `health = saudavel`.
