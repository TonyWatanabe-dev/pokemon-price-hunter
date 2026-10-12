# Auditoria: qualidade do histórico e das referências (Fase 2, issue #377)

Escopo: `src/history.js`, `src/copag-check.js`, política de referência e seus testes. Só leitura. Não repete `alertas`, `api`, `coletores`, `matching`, `motor` nem `seguranca`.
Nota: `api/_lib/copag-policy.mjs` **não existe**; a política vive em `api/_lib/references.mjs` (`isCopagUrl`, `pickCurrentReference`, `validateImportEntry`, `MARKET_RULE`), `src/core/references.js` e `copagStatus` em `src/score.js:6`.

## 1. Mapa
| Módulo | Função / trecho | Papel |
|---|---|---|
| `src/history.js:12` | `histPath`, `safeId` (l.11) | `data/hist/<id>.json`, id saneado |
| `src/history.js:14` | `merge` | menor preço do dia por loja; corte de 180 dias (l.25-26); grava direto (l.27) |
| `src/history.js:32` | `backfill` | monta `hist/` a partir de `history.jsonl`, só se a pasta não existe (l.33) |
| `src/history.js:56` | `recordDay` | registra a rodada; filtra stale/anômalo/suspeito (l.62-64); chamado em `src/run.js:467` |
| `src/history.js:77` | `trimJsonl` | mantém 45 dias se o arquivo passa de 3 MB; `src/run.js:509` |
| `src/history.js:90,100` | `cleanPoints`, `histSummary` | limpa pontos; `drop7d`, `enough` (`MIN_HIST_DAYS`) |
| `src/copag-check.js:6` | `copagCheck` | compara a página da fonte com `catalog.copag[].msrp`; `REVISAR` em divergência; roda em `hunter.yml:55` |
| `src/score.js:6` | `copagStatus` | só `confidence === 'OFICIAL'` e fonte fora de marketplace confirma |
| `api/_lib/references.mjs`, `src/core/references.js` | tipos, prioridade, validade de 30 dias, importação | referência atual x histórica |

## 2. Já coberto
| Comportamento | Teste |
|---|---|
| `cleanPoints`: inválidos, duplicatas, ordem | `test/history-quality-tests.js` |
| `histSummary`: série curta, suja, janela de desconfiança, janela de 7 dias | `test/history-quality-tests.js` |
| `recordDay`: menor do dia, descartes, suspeito, corte de 180 dias | `test/history-write-tests.js` |
| `trimJsonl` (limite 3 MB / 45 dias) e `backfill` idempotente | `test/history-write-tests.js` |
| Copag histórica nunca é referência atual; prioridade; importação | `test/reference-tests.js` |
| Política: Copag > mercado > NONE, validade de 30 dias, vencida | `test/reference-policy-tests.js` |
| Estados missing/confirmed/stale/conflicting, datas e fusos | `test/copag-status-tests.js` |
| Aviso de vencimento Copag (janela de 7 dias, vigia) | `test/copag-vencimento-tests.js` |
| `copagStatus` (de `score.js`) | só indiretamente em `test/run-tests.js` |

## 3. Lacunas atuais
**Alta**
1. `merge` grava com `fs.writeFileSync` direto (`history.js:27`), enquanto `writeJson` usa tmp + rename (`db.js:12`). Queda no meio da escrita deixa JSON truncado; `readJson(file, null)` (l.15) devolve `null` e o histórico do produto recomeça vazio, sem aviso.
2. `copagCheck` não tem teste algum (nenhum arquivo em `test/` o importa). Ele reescreve todo o `catalog.json` (l.133) mesmo sem mudança, e fonte sem preço (`seen === null`) vira `REVISAR` igual a divergência real (l.128-130).

**Média**
3. A mediana de `recordDay` (l.59) não exclui `o.anomalous`, que só é filtrado depois (l.62). Ofertas anômalas puxam a mediana usada no corte de suspeitos.
4. `histSummary` toma "hoje" como o último dia do arquivo (l.105), não a data atual. Produto sem coleta há semanas continua exibindo queda antiga.
5. `backfill` só roda se `data/hist` não existe (l.33). Falha no meio deixa a pasta criada e o backfill nunca é refeito. Além disso, `merge` lê e grava o arquivo uma vez por dia (l.50).
6. `trimJsonl` descarta linhas malformadas em silêncio e regrava sem escrita atômica (l.81-82).

**Baixa**
7. `safeId` (l.11) pode colidir (`a/b` e `a_b` viram o mesmo arquivo).
8. `copagStatus` sem teste direto; `last_check` (`copag-check.js:17`) não é lido por nenhum teste ou consumidor encontrado em `src`, `test` e `tools`.

## 4. Tarefas (pequenas, independentes, sem `index.html`)
| # | Tarefa | Arquivos | Risco | Aceite testável |
|---|---|---|---|---|
| T1 | Escrita atômica em `merge` (tmp + rename), reaproveitando o padrão de `writeJson` | `src/history.js`, `test/history-write-tests.js` | R1 | teste simula falha e o arquivo anterior fica íntegro; sem `.tmp` sobrando |
| T2 | Excluir `o.anomalous` da mediana de `recordDay` | `src/history.js`, `test/history-write-tests.js` | R1 | caso com 3 ofertas normais + 1 anômala muito alta: preço suspeito descartado como esperado; testes atuais seguem verdes |
| T3 | Testes de `copagCheck` com `get` simulado: OK, REVISAR, manual, fonte indisponível, `seen === null` | `test/copag-check-tests.js` (novo) | R0 | cada status do relatório coberto; `npm test` verde |
| T4 | `histSummary` aceitar `asOf` opcional e marcar `stale` quando o último dia é antigo | `src/history.js`, `test/history-quality-tests.js` | R1 | série terminada há mais de 7 dias dá `drop7d: 0`; sem `asOf` o resultado atual não muda |
| T5 | `backfill` retomável: refazer quando faltar marcador de conclusão e agrupar escrita por produto | `src/history.js`, `test/history-write-tests.js` | R2 | pasta parcial é completada; segunda execução devolve 0 |
| T6 | Teste direto de `copagStatus` (sem valor, sem fonte, marketplace, catálogo, oficial) | `test/copag-status-tests.js` | R0 | cinco ramos de `score.js:7-15` cobertos |
