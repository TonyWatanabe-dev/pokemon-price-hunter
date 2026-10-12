# Auditoria de lacunas: frescor dos dados e sincronização com o banco (issue #373)

Escopo: leitura do código na `main` (`5034d4f`). Só descreve o que existe; lacunas "a confirmar" não foram reproduzidas em execução. Não repete `api.md` (que já cita o frescor da API) nem `motor.md`.

## 1. Mapa
| Módulo | Função / trecho | Papel |
|---|---|---|
| `src/run.js:115` | `prevGeneratedAt` | lê `generatedAt` do `state.json` antes de sobrescrevê-lo |
| `src/run.js:445` | `readDbHealth()` | leitura do banco em paralelo ao leitor oficial |
| `src/run.js:507,513-521` | `writeJson(state.json)`, `buildRunRecord`, `recordRun` | grava o estado e o registro operacional (`data/meta.json` → `ops`) |
| `src/db-health.js:24,62` | `readDbHealth`, `syncStatus` | `max(last_seen_at)` do banco vs. rodada anterior: `ok`/`atrasado`/`indisponivel`/`desligado`/`sem_referencia` (tolerância 1 s) |
| `src/opstate.js:98-108` | `engineSummary` | batida do motor vs. sync (`parado` > 30 min) |
| `src/opstate.js:123-134` | `runIssues` | `sync_atrasado`, `banco_indisponivel`, `banco_desligado`, `motor_parado` |
| `src/opstate.js:166-182` | `mergeOps` | histórico `ops.runs` (`KEEP_RUNS`=96), `last`, `lastHealthy`, `lastInvalid` |
| `src/opstate.js:185,209` | `writeJsonAtomic`, `recordRun` | escrita atômica de `meta.json` |
| `src/ops-watch.js:93` | alerta `sync_falhando` | vigia: N rodadas seguidas com `dbSync.status === 'atrasado'` |
| `tools/db-sync.mjs:10-21` | script de sync | lê `state.json`/`history.jsonl`, chama `syncState` em `tx`; erro → `exitCode = 1` |
| `src/core/sync.js:94-113` | `syncState` | upsert de ofertas (`WHERE last_seen_at <= EXCLUDED.last_seen_at`), marca `removed` o que sumiu |
| `.github/workflows/hunter.yml:103-115` | passo "Sincronizar com o banco" | `continue-on-error: true`; roda migrate, sync, stats, opportunity |
| `api/_lib/freshness.mjs:25,38,45` | `classify`, `dbDataAt`, `attach`/`headers` | atual ≤30, atrasado ≤90, desatualizado ≤24 h, depois indisponível; cache do banco 60 s |
| `api/v1.mjs:215-244` | `handle` | escolhe banco/state por frescor, `fallback`, cabeçalhos `X-Data-*` |
| `api/_lib/read-db.mjs:31,235` | leituras | expõem `last_seen_at` por oferta |

## 2. Já coberto (teste)
- Classificação por idade, limites 30/90 min, futuro > 5 min, `usable`: `test/freshness-tests.js` (~45).
- Fallback banco → state, 503 por dado expirado, `stale_db`, sem vazar senha: `test/freshness-tests.js` (~80, ~183).
- Idade do banco = última leitura sincronizada: `test/api-db-tests.js:93` (exige `TEST_DATABASE_URL`).
- `syncStatus` (ok/atrasado) em cenários de motor e Copag: `test/engine-watch-tests.js`, `test/copag-vencimento-tests.js`.
- `mergeOps`, registro inválido não substitui o último, `KEEP_RUNS`, `recordRun`: `test/ops-detection-tests.js`.
- Alerta `sync_falhando`: `test/ops-detection-tests.js`, `test/burnin-tests.js:48`.
- Oferta mais antiga não sobrescreve a mais nova, estoque, remoção: `test/offer-freshness-tests.js`, `test/stock-events-db-tests.js`, `test/db-tests.js` (exigem banco).

## 3. Lacunas atuais
**Alta**
- Falha do sync passa despercebida no próprio passo: `hunter.yml:105` tem `continue-on-error: true` e `db-sync.mjs:18` só põe `exitCode`. A detecção ocorre só na rodada seguinte (`syncStatus` compara com `prevGeneratedAt`, `db-health.js:68-74`), ou seja ≥ 15 min depois; a primeira rodada falha é sempre vista como `ok` até a próxima. Sem teste do atraso de detecção.
- `db-sync.mjs:12-14` faz `JSON.parse` fora do `try`: `state.json` ou linha de `history.jsonl` corrompida derruba o script com stack, sem a mensagem "o site não é afetado" e sem teste (`tools/db-sync.mjs` não tem teste de script).

**Média**
- `freshness.mjs:38` cacheia `dbDataAt` por 60 s e `v1.mjs:215` usa `dbCache` junto de um cache de respostas: a idade exibida pode estar até 60 s defasada e não há teste do limite 30 min com cache (a confirmar).
- Banco sem nenhuma oferta ativa/pendente: `DB_AT_SQL` devolve `null` → `indisponivel` mesmo que o sync esteja saudável (ex.: todas `removed`). Sem teste dedicado.
- `syncStatus` usa `max(last_seen_at)` global (`db-health.js:45`): uma única oferta atualizada mascara um sync parcial (lojas atrasadas). Não há verificação por loja.

**Baixa**
- `mergeOps` (`opstate.js:169`) só descarta registros inválidos; `ops.lastHealthy` pode ficar muito antigo sem expirar, e não há teste de `meta.json` corrompido em `recordRun` (`readMeta` engole o erro e recomeça com `resetAt`, `opstate.js:204-206`, perdendo o histórico).
- `classify` não cobre `at` em formato sem fuso (a confirmar: `Date.parse` interpreta como local).

## 4. Tarefas sugeridas (pequenas e independentes, sem `index.html`)
1. **Teste do atraso de detecção do sync** — arquivos: `test/sync-detection-tests.js`. Risco R0. Aceite: teste novo mostra que, com sync falho na rodada N, `syncStatus` na N sendo comparada à N‑1 resulta `ok` e na N+1 `atrasado`; `npm test` verde.
2. **Robustez de `tools/db-sync.mjs` a arquivos corrompidos** — arquivos: `tools/db-sync.mjs`, `test/db-sync-script-tests.js`. Risco R1. Aceite: com `state.json` inválido, o script imprime mensagem sem stack, sai com código 1 e não toca o banco (teste roda sem `DATABASE_URL` real, usando executável com `pg` simulado ou apenas o caminho de parse).
3. **Banco sem ofertas ativas** — arquivos: `api/_lib/freshness.mjs` (só se necessário), `test/freshness-tests.js` ou novo `test/freshness-empty-db-tests.js`. Risco R1. Aceite: com `q` simulado devolvendo `[{at:null}]`, `dbDataAt` é `null`, a API cai para o state.json com `fallback` e o teste fixa esse comportamento.
4. **Teste de `meta.json` corrompido** — arquivos: `test/ops-meta-corrupt-tests.js`. Risco R0. Aceite: `recordRun` sobre arquivo com JSON inválido grava `ops` novo com `resetAt`, preserva escrita atômica (sem `.tmp` sobrando) e o teste documenta a perda do histórico.
5. **Cache de 60 s de `dbDataAt`** — arquivos: `test/freshness-cache-tests.js`. Risco R0. Aceite: com `setFreshnessClock`, duas chamadas em < 60 s fazem 1 consulta; após 60 s, 2; `clearFreshnessCache` zera.
6. **Sync parcial por loja (investigação)** — arquivos: `docs/auditorias/frescor-sync.md` (nota) ou novo `src/db-health.js` + teste. Risco R2 (muda alerta). Aceite: proposta com consulta `max(last_seen_at)` por loja e teste de `syncStatus` marcando `atrasado` quando uma loja ativa fica > 90 min atrás; só implementar após decisão.
