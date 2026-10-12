# Auditoria de lacunas: desempenho da rodada e da API (issue #375)

Escopo: `src/run.js`, `src/http.js`, `api/v1.mjs`, `api/_lib/` e testes. Só descreve o código da `main`. Não repete `api.md` (rotas, validação, frescor) nem `coletores.md` (parsing).

## 1. Mapa
| Módulo | Trecho | Papel |
|---|---|---|
| `src/run.js:13` | `pool(items, n, fn)` | Lojas em paralelo; `n = HUNTER_CONCURRENCY` (padrão 16, linha 174). |
| `src/run.js:171,181` | `deadline = now + HUNTER_BUDGET_MIN (7) min` | Loja que começa após o prazo vai para `skipped` (rodízio por `lastCheck`, linha 173). |
| `src/run.js:198-210` | `urlCache` (`candidates`, `visited`, `relevant`) | Descoberta JSON-LD: renova a cada 24 h, lê no máximo 25 URLs novas por rodada. |
| `src/http.js:6,15,103` | `DELAY` (1500 ms por host), `gates`, `requestOnce(timeout=10000)` | Intervalo por domínio e timeout de 10 s por requisição; `retries` 0 por padrão, máx. 2. |
| `api/v1.mjs:39-43,208-250` | `CDN`, `MAX_CACHE=300`, `cache` (Map FIFO) | Cache em memória por URL e `s-maxage` da CDN. |
| `api/v1.mjs:184-193` | `DEADLINE_MS=12000` | Prazo total do pedido → 503 com `Retry-After`. |
| `api/_lib/catalog.mjs:7-17`, `legacy.mjs:8-30` | `TTL_MS=60_000` | Cache do catálogo e do state.json (5 s por URL). |
| `api/_lib/db.mjs:16-17` | `max: 2`, `statement_timeout: 5000`, `query_timeout: 6000` | Pool e prazos das consultas. |
| `api/_lib/read-db.mjs:146,246,283,345` | `LIMIT/OFFSET` | Paginação das consultas. |

## 2. Já coberto
- Prazo do pedido → 503 + `Retry-After`: `test/api-tests.js:120` (`deadlineMs: 50`).
- Limites de `pagina`/`limite`, parâmetros desconhecidos fora da chave do cache: `test/api-tests.js` (~75–108).
- Timeout/retry/limites do cliente HTTP: `test/http-retry-tests.js`, `test/http-security-tests.js`, `test/parse-limits-tests.js`.
- Backoff por loja e bloqueio (não é prazo da rodada): `test/store-blocking-tests.js`.
- Frescor e expiração do dado: `test/freshness-tests.js`.

## 3. Lacunas atuais
**Alta**
- **Prazo da rodada sem teste.** `HUNTER_BUDGET_MIN` só é apagado do ambiente nos testes (`collectors-tests.js:6`, `store-blocking-tests.js:155`); nenhum teste define `HUNTER_BUDGET_MIN` pequeno para provar que `skipped` recebe as lojas restantes e que o log da linha 333 sai.
- **O prazo é checado só ao iniciar a loja** (`run.js:181`). Uma loja iniciada aos 6m59s ainda faz até 25 páginas novas + `relevant` + `retry` (linhas 202-210), cada uma ≥1,5 s por host (`http.js:6`) e 10 s de timeout: a rodada pode passar muito do orçamento. Não há teste nem limite por loja.
- **Concorrência sem teste.** `HUNTER_CONCURRENCY` (16) e `pool` (`run.js:13`) não aparecem em nenhum arquivo de `test/` (grep). Um `n` inválido (`NaN`, 0, negativo) gera `Array.from({length: n})` vazio ou erro: nenhuma loja coletada, sem aviso.

**Média**
- **Cache da API é FIFO, não LRU** (`v1.mjs:248-249`: acerto não renova a posição). Rotas quentes (home) podem sair antes de rotas raras. Só o limite de 300 é verificado indiretamente; não há teste de remoção.
- **Falha do state.json sem cache negativo.** Em `legacy.mjs` a falha de ambas as URLs (até 10 s) é repetida a cada pedido sem cache; o prazo de 12 s do handler cobre, mas cada pedido paga o custo. Sem teste.
- **`OFFSET` profundo.** `pagina` vai até 10 000 em `v1.mjs:61` e `limite` até 50: `OFFSET` de até ~500 mil linhas em `read-db.mjs:146`. Não há teste de desempenho com volume.

**Baixa**
- `url-cache.json` cresce com `candidates` (até 3000 por loja, `run.js:199`) e é regravado inteiro (linha 500); sem medida de tamanho.
- `pool` do banco com `max: 2` (`db.mjs:16`): sem teste de espera quando as duas conexões estão ocupadas.

## 4. Tarefas (pequenas, independentes, sem `index.html`)
1. **Teste do prazo da rodada.** Arquivos: novo `test/run-budget-tests.js`. Risco R0. Aceite: com `HUNTER_BUDGET_MIN` ínfimo e lojas simuladas, `skipped` recebe as lojas e o log "ficaram para a próxima rodada" aparece; `npm test` verde.
2. **Validar `HUNTER_CONCURRENCY`/`HUNTER_BUDGET_MIN`.** Arquivos: `src/run.js` (leitura das duas variáveis) + teste novo. Risco R1. Aceite: valor inválido (`0`, `-1`, `abc`) usa o padrão 16/7; teste de `pool` com `n` inválido processa todos os itens.
3. **Limite de páginas por loja dentro do prazo.** Arquivos: `src/run.js` (laço da loja) + teste. Risco R2 (muda a coleta). Aceite: loja iniciada perto do fim não lê páginas após `deadline`; teste com relógio simulado.
4. **Teste de remoção do cache da API.** Arquivos: novo `test/api-cache-tests.js` (usa `_cache`). Risco R0. Aceite: após >300 chaves distintas, `_cache.size === 300` e a mais antiga saiu; documenta o comportamento FIFO.
5. **Cache negativo curto do state.json.** Arquivos: `api/_lib/legacy.mjs` + teste. Risco R1. Aceite: duas chamadas seguidas com carregador falhando disparam uma só tentativa de rede dentro de ~5 s; sucesso posterior limpa o estado.
6. **Teto de `OFFSET` na API.** Arquivos: `api/v1.mjs` (`route`) + `test/api-tests.js`. Risco R1. Aceite: `pagina * limite` acima de um teto definido responde 400; páginas normais seguem 200.
