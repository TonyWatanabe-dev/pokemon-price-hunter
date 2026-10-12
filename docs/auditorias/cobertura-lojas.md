# Auditoria de lacunas: cobertura e saúde das lojas monitoradas (issue #374)

Escopo: `config/stores.json`, `config/lojas/*.txt` (só leitura), `src/discover.js`, `src/discovery/`, estado das fontes (`data/sources.json`), `src/opstate.js`, `src/ops-watch.js` e os testes de lojas. Lido na `main` (5034d4f). Não repete `coletores.md` (adapters/contrato) nem `motor.md`. O `data/sources.json` local é um instantâneo (sem `generatedAt`); o estado vivo está no branch `data` — números abaixo são "a confirmar" na próxima rodada.

## 1. Mapa
| Módulo | Função / trecho |
|---|---|
| `config/stores.json` | 14 lojas fixas; `platform` (auto/shopify/vtex/jsonld/mercadolivre/unsupported), `enabled:false` = pausada |
| `config/lojas/*.txt` | um domínio por linha; `#` ignora; `removidas.txt` é todo comentário (histórico) |
| `src/run.js` ~120-134 | junta `stores.json` + `lojas.txt` + `lojas/*.txt` + `data/discovery-stores.txt` |
| `src/run.js` ~175-184 | status por loja: `UNAVAILABLE` (unsupported / `BIG_MARKETPLACES`), `PENDING` (sem url), `PAUSED`, pula por prazo |
| `src/run.js` `backoffMs` | espera de BLOCKED/ERROR: 429 30 min→2 h; demais 15 min→6 h |
| `src/run.js` ~318-330 | sucesso grava `ACTIVE`, `listings`, `lastNonEmpty`; falha grava `BLOCKED`/`ERROR`, `errorClass`, `fails` |
| `src/opstate.js` | `collectors` (ok/empty/suspectEmpty/failed por classe) e contagem de status |
| `src/ops-watch.js` ~98-104 | alerta se fonte vigiada está BLOCKED/ERROR/ACTIVE com 0 anúncios |
| `src/discover.js` | descoberta legada (Brave, `HUNTER_DISCOVERY=0`); `QUERIES`, `IGNORE`, `discover()` |
| `src/discovery/` | motor atual: `hosts.js` (inventário, `listedHosts`), `ledger.js`, `pipeline.js`, `handoff.js` |

## 2. O que já está coberto
| Comportamento | Teste |
|---|---|
| Espera própria para 429, motivo real da falha, volume Shopify | `test/store-blocking-tests.js` |
| `removidas.txt` não vira loja; duplicatas PENDING fora do `stores.json` | `test/coleta-diagnostico-tests.js` |
| Isolamento entre lojas e falha tipada | `test/adapter-contract-tests.js`, `test/collectors-tests.js` |
| Diretório de lojas do site (domínio, HTTPS, sem oferta × sem dados recentes) | `test/stores-tests.js` |
| Página `/lojas` (nunca preço não lido, nunca "fora do ar") | `test/lojas-page-tests.js` |
| Descoberta nova: conectores, ledger, pipeline, hand-off, inventário | `test/discovery-tests.js` |
| Alerta de fonte vigiada BLOCKED/vazia | `test/ops-detection-tests.js` |

## 3. Lacunas atuais
**Alta**
1. **Saúde ruim e sem prioridade de ação.** O instantâneo de `data/sources.json` tem 90 fontes: 34 BLOCKED, 2 ERROR, 23 ACTIVE (13 delas com 0 anúncios), 10 UNAVAILABLE, 6 PENDING, 2 PAUSED. Só ~10 lojas entregam anúncios; nada ordena as BLOCKED por motivo (WAF × DNS morto). Evidência: `src/opstate.js` só conta, não lista.
2. **BLOCKED por "fora do ar" nunca sai da fila.** `uzgamescombr`, `geekshopcombr`, `monsterstcgcombr`, `collectandplaycombr` estão BLOCKED por "fora do ar ou lento"; o backoff vai a 6 h para sempre (`backoffMs`, teto 360 min) e `removidas.txt` já registra DNS ENOTFOUND para uzgames/geek-shop mas as fontes seguem em `sources.json`. Sem teste de aposentadoria automática.
3. **ERROR "plataforma não reconhecida"** (`kalungacombr`, `ggtcgonline`): `detectPlatform` falha e a loja é retentada sem diagnóstico de qual plataforma é (`src/run.js` ~190).

**Média**
4. **ACTIVE vazia (13 fontes)**: `suspectEmpty` só conta quem já teve anúncio (`opstate.js` l.73); lojas que nunca trouxeram anúncio não geram alerta (`ops-watch.js` l.98 só olha fontes "vigiadas").
5. **`src/discover.js` legado sem teste**: nenhum arquivo em `test/` importa `discover.js`; `IGNORE` de `discover.js` e de `src/discovery/hosts.js` são duas listas separadas (o comentário de `hosts.js` diz "espelha"), sem teste de paridade.
6. **`BIG_MARKETPLACES` × `stores.json`**: lojas `unsupported` (amazon, shopee, magalu) têm `note` manual; nenhuma checagem de que todo `unsupported` tem `note`/`url` válidos.

**Baixa**
7. `config/lojas/*.txt`: duplicatas entre arquivos de varredura e domínios já em `stores.json` só são filtradas em `hosts.js`, sem teste.
8. `reclameaqui.json` cobre poucas lojas (`src/run.js` l.492), sem verificação de cobertura.

## 4. Tarefas (pequenas e independentes, sem `index.html`)
| # | Tarefa | Arquivos | Risco | Aceite |
|---|---|---|---|---|
| T1 | Teste de paridade `IGNORE` (`discover.js`) × `hosts.js` e de import sem efeito colateral | `test/discover-legado-tests.js` | R0 | `npm test` verde; teste falha se um marketplace estiver só em uma lista |
| T2 | Teste de consistência de `config/stores.json`: ids únicos, `unsupported` com `note`, `url` HTTPS, `platform` válido | `test/stores-config-tests.js` | R0 | falha ao quebrar cada regra num fixture; passa no arquivo real |
| T3 | `opstate`: listar as fontes BLOCKED/ERROR por `errorClass` (ids, até 10) em `collectors` | `src/opstate.js`, `test/opstate-tests.js` | R1 | saída traz `failedBy` com ids por classe; contadores atuais inalterados |
| T4 | Marcar `vazioNunca` (ACTIVE, 0 anúncios, sem `lastNonEmpty`) em `collectors` | `src/opstate.js`, `test/opstate-tests.js` | R1 | fonte nunca-povoada conta separada de `suspectEmpty`; teste cobre os 3 casos |
| T5 | Teste de que `config/lojas/*.txt` ativos não repetem host de `stores.json` nem de `removidas.txt` | `test/lojas-txt-tests.js` | R0 | falha com host duplicado em fixture; passa no repositório real |
| T6 | Teste de `backoffMs`: curva 15 min→6 h, 429 com `Retry-After`, `fails` ausente | `test/backoff-tests.js` | R0 | casos de 1, 2, 6 e 10 falhas e 429 com Retry-After > curva |
