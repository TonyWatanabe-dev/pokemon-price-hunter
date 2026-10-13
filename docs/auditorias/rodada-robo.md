# Auditoria de lacunas: orquestração da rodada do robô (issue #531)

Escopo: `src/run.js` (`runOnce`) e os testes de rodada, na `main`. Não repete `desempenho.md` (prazo/concorrência, já tratados lá e hoje com teste) nem `frescor-sync.md` (sync e frescor). Lacunas "a confirmar" não foram reproduzidas em execução.

## 1. Mapa
| Etapa | Trecho | Papel |
|---|---|---|
| Entrada | `run.js:114-117` | `prevGeneratedAt` lido do `state.json` antes de tudo |
| Coleta | `run.js:171-176` | `deadline` (`HUNTER_BUDGET_MIN`), `urlCache`, ordem por `lastCheck`, `pool(..., HUNTER_CONCURRENCY)` |
| Erro por loja | `run.js:326-332` | `catch` grava `BLOCKED`/`ERROR`, `fails`, `errorClass`; a rodada segue |
| Prazo | `run.js:181,333` | loja após o prazo → `skipped`; log "ficaram para a próxima rodada" |
| Fontes falhas | `run.js:334-340` | oferta antiga: `carryShipping` se `skipped` e < 3 h, senão `staleCopy` |
| Pistas | `run.js:416-425` | `collectTips` em `try/catch` isolado |
| Bot | `run.js:440` | `processInbox` em `try/catch` |
| Leitura paralela | `run.js:447` | `readOfficial` + `readDbHealth` em `Promise.all` |
| Alertas | `run.js:454-457` | `evaluate` → `dedupe` → `dispatch`/`dispatchTips` (envia de fato) |
| Histórico/atividade | `run.js:474-477` | `try/catch` por etapa |
| Gravação | `run.js:497-515` | `writeJson` (tmp + rename, `db.js:12`) arquivo a arquivo; `state.json` quase por último; `history.jsonl`/`alerts.jsonl` por append |
| Estado operacional | `run.js:517-526` | `recordRun` em `try/catch` |
| Entrada CLI | `run.js:532-538` | `--loop`; falha vira `exitCode = 1` (sem loop) |

## 2. Já coberto
- Prazo esgotado: `test/run-budget-tests.js` (4 lojas, só ≤1 coleta, `skipped` sem requisição, log com a contagem) e `test/run-tests.js:160-164` (loja pulada mantém oferta recente, não stale).
- Variáveis de ambiente e `pool` com `n` inválido: `test/run-env-tests.js`.
- Contrato de anúncio na rodada: `test/listing-contract-run-tests.js`.
- Backoff/bloqueio por loja: `test/store-blocking-tests.js`.
- Poda de alertas: `test/alerts-prune-tests.js`; descoberta: `test/run-all-discovery-tests.js`.

## 3. Lacunas priorizadas
**Alta**
- **Alerta enviado antes da persistência.** `dispatch` roda na linha 457 e `alerts-sent.json` só é gravado na linha 508. Se o processo cair (ou um `writeJson` anterior lançar, ex.: disco cheio) entre os dois, a próxima rodada reenvia o mesmo alerta. Nenhum teste simula falha de gravação no meio da sequência (grep em `test/run*-tests.js`: sem `writeJson` forçado a falhar).
- **Gravação sem atomicidade entre arquivos.** São ~10 `writeJson` seguidos (linhas 498-509); cada um é atômico, o conjunto não. Queda no meio deixa `offers.json`/`sources.json` novos com `state.json` antigo. O `prevGeneratedAt` da rodada seguinte (linha 117) então mede contra um estado que não corresponde às ofertas. Sem teste.
**Média**
- **Exceção fora dos `try/catch` derruba a rodada.** `readOfficial`/`readDbHealth` (linha 447), `evaluate`/`dispatch` (454-457) e `writeJson` não têm captura; o CLI só registra `Falha na rodada` (linha 536). Se `readOfficial` ou `dispatch` lançarem, nada é gravado, nem `sources.json` com as falhas da coleta (a coleta é perdida). `db-health` e `opportunity-read` costumam devolver status em vez de lançar, mas isso não é provado por teste de `runOnce`.
- **Ordem das etapas sem teste.** Nada garante que o estado operacional (`recordRun`) é registrado após `state.json`, nem que falha em `recordRun` não derruba a rodada (linha 526).
- **`--loop` sem teste.** O bloco `isMain` (532-538) não é importado em nenhum teste; `exitCode = 1` em falha e o intervalo `HUNTER_INTERVAL_MIN` não são verificados.
**Baixa**
- `alerts.jsonl` é reescrito com `fs.writeFileSync` direto (linha 515), sem tmp+rename: queda durante a escrita trunca o log.
- `state.json` é relido na linha 504 só para `recentAlerts`, depois de já ter sido lido na linha 117; o valor da rodada anterior poderia ser reaproveitado (a confirmar se há motivo para reler).

## 4. Tarefas pequenas e independentes (sem `index.html`)
1. **Teste: falha de gravação no meio.** Arquivos: novo `test/run-write-failure-tests.js`. Risco R0. Aceite: com `fs.renameSync` forçado a lançar na gravação de `state.json`, `runOnce` rejeita e o teste documenta quais arquivos já foram gravados (e se `alerts-sent.json` foi); `npm test` verde.
2. **Gravar `alerts-sent.json` logo após o envio.** Arquivos: `src/run.js` (mover o `writeJson` da linha 508 para logo depois do `dispatch`) + teste da tarefa 1. Risco R2 (alertas ao usuário). Aceite: com falha injetada em `state.json`, `alerts-sent.json` já contém os alertas enviados e uma segunda rodada não os reenvia.
3. **Preservar `sources.json` se a pós-coleta falhar.** Arquivos: `src/run.js` (gravar `sources.json`/`url-cache.json` logo após a coleta) + teste. Risco R1. Aceite: com `readOfficial` simulado lançando, `sources.json` da rodada fica gravado com `checks` incrementado.
4. **Teste do estado operacional isolado.** Arquivos: novo `test/run-ops-failure-tests.js`. Risco R0. Aceite: com `meta.json` ilegível/não gravável, `runOnce` ainda devolve `state` e loga `[estado operacional]`.
5. **Teste do CLI `--loop`/`exitCode`.** Arquivos: novo `test/run-cli-tests.js` (processo filho com diretório temporário). Risco R0. Aceite: rodada com falha forçada sem `--loop` sai com código 1 e imprime `Falha na rodada`; sem segredo no texto.
6. **Escrita atômica de `alerts.jsonl`.** Arquivos: `src/run.js` (linha 515) ou helper em `src/db.js` + teste. Risco R1. Aceite: com `renameSync` falhando, o `alerts.jsonl` original permanece íntegro (mesmo conteúdo).
