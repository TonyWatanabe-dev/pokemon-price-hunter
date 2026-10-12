# Auditoria de lacunas: observabilidade e alertas operacionais (issue #376)

Escopo: `src/ops-watch.js`, `src/ops-notify.js`, `tools/watchdog.mjs`, `src/opstate.js` e testes do Vigia. Só leitura da `main`; nada foi executado contra produção nem lido de secrets. Não repete `alertas.md` (alertas do usuário) nem `motor.md`.

## 1. Mapa

| Módulo | Função / trecho | Papel |
|---|---|---|
| `src/opstate.js` | `buildRunRecord`, `mergeOps`, `recordRun`, `writeJsonAtomic` | registro de cada rodada em `meta.json` (`KEEP_RUNS = 96`) |
| `src/opstate.js` | `readerSummary`, `storesSummary`, `collectorsSummary`, `watchedSummary` (`WATCHED_SOURCES = ['mercadolivre']`), `engineSummary`, `copagSummary` | resumos por área |
| `src/ops-watch.js` | `RULES`, `completedRuns`, `evaluate`/`evaluateStatus` | estado: `saudavel`, `degradado`, `parado`, `desconhecido` e códigos de motivo |
| `src/ops-watch.js` | `copagWarnings`, `decideWarning`, `commitWarning` | aviso antecipado `copag_vencendo` (fora do incidente) |
| `src/ops-watch.js` | `normalizeLedger`, `decide`, `commitLedger` | deduplicação, lembrete (6 h), recuperação (2 checagens) |
| `src/ops-notify.js` | `CHANNELS` (telegram, ntfy), `sendAll`, `mask` | envio; entregue = ao menos 1 canal aceitou |
| `tools/watchdog.mjs` | `main` | lê state/meta/runs/ledger, avalia, envia, grava o livro, `GITHUB_STEP_SUMMARY`; flags `--dry-run`, `--test`, `--now` |
| `.github/workflows/watchdog.yml` | cron `7,37 * * * *` + disparo externo; livro em cache | só lido, não alterar |

## 2. O que já está coberto

| Comportamento | Teste |
|---|---|
| Registro da rodada, sem segredo; `meta.json` preserva chaves e ignora registro inválido | `test/ops-detection-tests.js` 1, 4 |
| Escrita atômica concorrente | `ops-detection-tests.js` 5 |
| Estados saudável/parado/degradado; sync, leitor, fonte vigiada, rodadas falhando, meta ausente/ilegível | `ops-detection-tests.js` 6–11, 9b |
| Deduplicação, lembrete 6 h, recuperação, aviso não entregue não muda o livro | `ops-detection-tests.js` 12–14 |
| Canais: um falha e outro entrega; ambos falham; travado cai no prazo | `ops-detection-tests.js` 15 |
| `tools/watchdog.mjs` ponta a ponta, sem segredo na saída | `ops-detection-tests.js` 16 |
| `watchdog.yml`: disparo, concorrência, permissões, cache do livro | `ops-detection-tests.js` 17 |
| `readDbHealth` nunca lança nem vaza URL | `ops-detection-tests.js` 18–19 |
| Classe de erro, motivo seguro, vazio legítimo, execução vazia | `ops-detection-tests.js` 20–22 |
| `motor_parado` | `test/engine-watch-tests.js` 1–3; `ops-detection-tests.js` 23 |
| `copag_vencendo` (avaliação, aviso, vigia `--dry-run`) | `test/copag-vencimento-tests.js` |

## 3. Lacunas atuais

### Alta
1. **Estado `desconhecido` nunca avisa.** `decide` retorna `{ notify: null }` para `desconhecido` e `commitLedger` só atualiza `lastCheckAt`. `dados_indisponiveis` (ramo `data` ilegível) e `meta_ausente`/`ops_ausente` podem durar dias sem nenhuma mensagem. Há teste só do estado (test 11), não de persistência.
2. **Nenhum canal configurado passa em silêncio.** `sendAll` marca `skipped` e `delivered: false`; `tools/watchdog.mjs` apenas loga e termina com código 0, e o livro não avança, então o Vigia fica cego sem alarme. Não há teste do cenário "zero canais configurados" em `main()`.

### Média
3. **Só uma fonte vigiada.** `WATCHED_SOURCES = ['mercadolivre']` (`src/opstate.js`); outras lojas bloqueadas/zeradas não geram `fonte_degradada`.
4. **`--test` sem cobertura.** O ramo `flag('test')` em `tools/watchdog.mjs` não é exercitado em nenhum arquivo de `test/` (busca por `--test` sem resultado).
5. **Sem retentativa de envio.** `post` em `src/ops-notify.js` faz uma tentativa de 10 s; falha transitória só é refeita na próxima checagem (30 min no cron de reserva).
6. **`CODE_LABEL` sem teste de completude.** A mensagem de recuperação cai em `CODE_LABEL[c] || c`; um código novo em `evaluateStatus` sem rótulo vira código cru, e nada garante a sincronia.

### Baixa
7. **Livro só em cache do Actions** (`actions/cache` em `watchdog.yml`): se expirar, `normalizeLedger` volta ao vazio e um incidente em curso é reavisado. Aceitável; sem teste do comportamento.
8. **`GITHUB_STEP_SUMMARY` sem teste** (bloco em `main`, com `try/catch` silencioso).

## 4. Tarefas propostas (independentes, sem `index.html`)

| # | Tarefa | Arquivos | Risco | Critério de aceite |
|---|---|---|---|---|
| T1 | Teste do ramo `--test` de `watchdog.mjs` (canais simulados; livro intocado) | `test/watchdog-teste-tests.js` | R0 | `npm test` cobre `delivered` true/false e confirma que o `--ledger` não é gravado |
| T2 | Teste de `main()` sem nenhum canal configurado: `delivered: false`, livro sem avanço, aviso reenviado depois | `test/watchdog-sem-canal-tests.js` | R0 | teste verde documentando o comportamento atual (lacuna 2) |
| T3 | Teste de completude: todo `code` emitido por `evaluateStatus` tem `CODE_LABEL` | `test/ops-codigos-tests.js` (exporta `CODE_LABEL` só se necessário, ver T3b) | R1 | falha se um código novo não tiver rótulo |
| T4 | Aviso para `dados_indisponiveis` persistente (N checagens seguidas, lembrete próprio) | `src/ops-watch.js`, `test/ops-desconhecido-tests.js` | R2 | com 3 checagens `desconhecido` seguidas avisa uma vez e não repete; recuperação limpa o contador |
| T5 | Retentativa única com espera curta em `post` | `src/ops-notify.js`, `test/ops-notify-retry-tests.js` | R1 | 1ª tentativa 5xx e 2ª ok = entregue; 2 falhas = não entregue; sem segredo no erro |
| T6 | Teste do `GITHUB_STEP_SUMMARY` (arquivo temporário, conteúdo e erro de escrita ignorado) | `test/watchdog-resumo-tests.js` | R0 | arquivo contém `### Vigia: <status>` e o motivo; caminho inválido não derruba |
