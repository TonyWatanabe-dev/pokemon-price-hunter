# Vigia do robô: estado operacional e avisos

## O que existe

- **Robô (`src/run.js`)**: a cada rodada grava em `data/meta.json`, na seção `ops`, um registro com:
  - identificação da rodada (`runId`, tentativa, commit, gatilho);
  - horário dos dados, início, fim e duração;
  - resultado (`ok` ou `parcial`, quando o prazo adiou lojas);
  - situação da sincronização com o banco;
  - leitor oficial (`ok`/`unavailable`/`off`, com N válidas e M lidas);
  - lojas: ativas, com anúncios, sem resultado, bloqueadas, com erro e adiadas.
  - coletores (`collectors`): lojas tentadas na rodada, com sucesso, vazias (0 anúncios, sem ser falha), vazias suspeitas (já trouxeram anúncios antes), com falha, soma da duração, as mais lentas e os erros por classe (`bloqueio`, `timeout`, `rede`, `http_4xx`, `http_5xx`, `plataforma`, `parse`, `outro`). Se todos os coletores tentados falham, a rodada fica `degradado` (`coletores_todos_falharam`). O motivo do erro guardado e logado passa por `safeReason`, que remove URL de conexão, token, cookie, e-mail e query string.
  As outras chaves do arquivo (`dataVersion`, `distrust`) são preservadas. São guardados os últimos 96 registros, além de `last` e `lastHealthy`. Um registro inválido nunca substitui o último válido: fica em `lastInvalid`.
- **Sincronização**: o passo "Sincronizar com o banco" roda depois da publicação, então o resultado dele só pode ser visto na rodada seguinte.
  - A rodada seguinte lê, só para leitura, `max(offer.last_seen_at)` (ver `src/db-health.js`).
  - Se o valor for igual ao horário da rodada anterior, a sincronização chegou ao banco: `dbSync.status = ok`. Se for menor, não chegou: `atrasado`.
  - Outros estados: `indisponivel` (não deu para ler o banco), `desligado` (sem `DATABASE_URL`), `sem_referencia` (primeira rodada).
- **Motor de oportunidades**: cada execução concluída grava uma batida em `system_event` (tipo `ENGINE_HEARTBEAT`, fora do prefixo `OPPORTUNITY_` dos eventos de transição; guardada 14 dias, na mesma transação do motor). A rodada seguinte lê a última (`dbSync.engineRunAt`) e registra `engine.status`:
  - `ok`: batida recente;
  - `parado`: o banco sincronizou, mas a batida ficou mais de 30 min antes da rodada anterior;
  - `sem_heartbeat`: nenhuma batida ainda (estado logo após a implantação; nunca avisa);
  - `desconhecido`: sem banco, sem rodada anterior ou sincronização atrasada (aí o problema é a sincronização).
- **Vigia (`.github/workflows/watchdog.yml` → `tools/watchdog.mjs` → `src/ops-watch.js`)**:
  - lê os dados publicados e o `meta.json` do mesmo commit do ramo `data`, as últimas rodadas do robô na API do Actions e o último deploy de produção (API de deployments, só leitura);
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
| | **motor parado** (`motor_parado`): `engine.status = parado` nas 2 últimas rodadas registradas |
| | **deploy de produção** (`deploy_falhou` / `deploy_preso`): o último deployment `Production` da API do GitHub (criado pela integração da Vercel) terminou em `failure`/`error`, ou está pendente há mais de 30 min. Leitura só com `deployments: read`; sem dado (API fora, arquivo ilegível), o deploy não é verificado e nada muda |
| `desconhecido` | sem dados publicados legíveis, ou ainda sem `ops` registrado. Nunca avisa e não muda o livro |
| `saudavel` | nenhum dos casos acima |

**Avisos:**
- um na passagem para `degradado` ou `parado`, ou quando aparece um problema novo;
- um lembrete a cada 6 h enquanto o problema continuar;
- um de recuperação depois de 2 checagens saudáveis seguidas.

**Aviso antecipado (não é falha, não muda o estado):** `copag_vencendo` — a última rodada (`ops.last.copag`, lido do banco pelo robô) listou referência Copag oficial que sai da nota em até 7 dias (verificação passando de 30 dias). Mensagem própria (🟡) com os produtos e a data; avisa quando a lista muda e lembra a cada 24 h (`WARN_REMIND_MIN`). Não abre incidente, não muda nota nem ranking. Procedimento em `docs/referencia-copag.md`, "Validade e renovação".

O aviso imediato de falha do próprio robô (passo "Avisar falha no Telegram" do `hunter.yml`) sai só na primeira rodada que falha: se a rodada concluída anterior (cancelada ou pulada não conta) também falhou, ele fica quieto e o vigia (`rodadas_falhando`) cuida dos lembretes. Se não der para consultar as rodadas (`gh` com erro, lista vazia ou ilegível), avisa mesmo assim (`tools/failure-alert-gate.mjs`). Por isso o `hunter.yml` tem `actions: read` e passa `GH_TOKEN` (o token do próprio workflow) a esse passo.

O livro do que já foi avisado (`wd/ledger.json`, no cache do Actions) só muda quando a mensagem chega a pelo menos um canal. Se todos falharem, o aviso é tentado de novo na checagem seguinte. Cada canal tem prazo de 10 s.

## Issue de incidente (opcional, desligada por padrão)

Job `incidente` do `watchdog.yml` (`tools/vigia-incidente.mjs` → `src/ops-incident.js`). Roda só com a variável do repositório `VIGIA_ISSUES=true`.

- Lê o resumo da checagem: estado, estado anterior, motivos com texto e fatos.
- Aplica **uma** ação idempotente sobre a própria issue (autor `github-actions[bot]` + marcador `<!-- vigia:incidente -->`, label `ops:incidente`):
  - **cria** quando o estado fica `degradado`/`parado` e não há incidente aberto;
  - **comenta** só quando o conjunto de problemas (status + códigos) muda;
  - **fecha** depois de 2 checagens saudáveis seguidas.
- `desconhecido` ou resumo inválido não geram ação.
- O texto vindo dos dados passa por `redact`, sem marcador HTML e sem menção.
- O job tem só `issues: write`; o job `check` continua só leitura.
- O Vigia não reinicia, não altera dados nem faz deploy: a issue só registra o diagnóstico.

Para validar depois de ligar: no próximo estado degradado, conferir uma única issue `ops:incidente` com o diagnóstico; checagens repetidas não comentam de novo.

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
