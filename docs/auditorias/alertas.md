# Auditoria de lacunas: alertas, notificações e retenção (issue #293)

Escopo: leitura do código na `main` (`c283216`). Só descreve o que existe; origem: #45, #85, #49, #86.
`account.js` na raiz é um bundle minificado (1 linha) do cliente e foi tratado só como leitura: não há regra de alerta do usuário nele a auditar com segurança.

## 1. Mapa
| Módulo | Função / trecho | Papel |
|---|---|---|
| `src/alerts.js:15` | `comparableDrop` | queda só na mesma base de frete |
| `src/alerts.js:32,44` | `bestByBasis`, `prevBestOf` | melhor oferta por produto e base (agora / rodada anterior) |
| `src/alerts.js:56` | `evaluate` | regras (`target`, `deal`, `restock`) + queda (`drop\|<id>`) |
| `src/alerts.js:98` | `dedupe` | cooldown (6 h), queda mínima (1%), +2 p.p. de desconto |
| `src/alerts.js:117,144` | `compose`, `transports` | mensagem; Telegram e ntfy (timeout 10 s) |
| `src/alerts.js:169,185,200` | `sendAll`, `retryPending`, `dispatch` | envio, canal "down" após 2 falhas, fila `pending` (24 h) |
| `src/alerts.js:216,225` | `tipHits`, `dispatchTips` | pistas (`tip\|<id>`) |
| `src/run.js:444-449,494,500` | chamada na rodada | grava `data/alerts-sent.json` e `alerts.jsonl` |
| `src/server.js:23` | `upsertRule` | `POST /watchlist` e `/alerts` gravam regra em `config/watchlist.json` |

## 2. Já coberto (teste)
- Dedupe, cooldown, preferências ausentes: `test/alerts-idempotency-tests.js`.
- Retry após falha, pendente > 24 h sai da fila, restock só com evento: `test/alerts-reliability-tests.js`.
- Queda só como novo melhor preço: `test/alerts-drop-best-tests.js`.
- Frete comparável / "frete a calcular": `test/alerts-shipping-tests.js`.
- Prazo por canal e canal fora após 2 falhas: `test/alerts-timeout-tests.js`.
- Nota oficial do Opportunity Engine: `test/alerts-opportunity-tests.js`.

## 3. Lacunas atuais
**Alta**
- Retenção: `sent` (`alerts-sent.json`) só ganha chaves; `src/run.js:494` regrava tudo e nenhum trecho remove entradas antigas (só `delete s.pending`, `alerts.js:189`). Cresce sem limite; também `alerts.jsonl` (`run.js:500`, `appendJsonl`) não tem rotação (o servidor só lê as últimas 200, `server.js:20`).
- `upsertRule` (`server.js:23-28`) valida só `id` e `filter`: aceita `maxPrice` negativo/texto, `mode` inválido, `minDiscount` fora de 0–1, regra sem nenhum critério (dispara em qualquer oferta elegível do filtro). Sem teste.
**Média**
- `dispatchTips`: falha total sempre vira `pending`, mas `tipHits` exclui qualquer `tip|id` já em `sent`; sem teste de pista pendente que expira (>24 h) ficar registrada sem envio (o teste de 24 h cobre só `drop`).
- `retryPending` reenvia a mensagem original após até 24 h sem rechecar estoque/preço: risco de avisar preço/estoque já vencido (`alerts.js:190`).
- `dedupe`: `Date.parse(prev.at)` inválido dá `NaN`, `old` fica `false` e o alerta nunca repete; sem teste de `sent` corrompido.
- `ntfy`/`telegram` com `r.ok` apenas; sem teste de HTTP 429/5xx distinguido de config ausente (`null`) além dos casos de timeout.
**Baixa**
- `compose` não escapa `msg.url`/`button`; `esc` cobre só o texto (`alerts.js:134`). Sem teste de caracteres especiais na loja/vendedor.
- Regra legada `minDealScore` só gera log (`alerts.js:62`); nenhum aviso ao usuário na UI.

## 4. Tarefas propostas (independentes)
1. **Poda de `alerts-sent.json`** — função pura `pruneSent(sent, now, maxAgeDays)` em `src/alerts.js` + chamada em `src/run.js`; testes novos. R1. Aceite: entradas sem `pending` e mais velhas que o limite somem; `pending` e recentes ficam; teste cobre os dois casos.
2. **Rotação de `alerts.jsonl`** — limitar linhas retidas em `src/run.js`/helper de jsonl. R1. Aceite: após N+k appends o arquivo tem ≤ N linhas e `GET /alerts` segue devolvendo as últimas 200.
3. **Validação de regra em `upsertRule`** — função `validateRule` em `src/server.js` (ou módulo novo em `src/`). R1. Aceite: rejeita (erro 4xx) tipos/intervalos inválidos e regra sem critério; regra válida existente continua aceita.
4. **Pendente revalidado** — em `retryPending`, descartar pendente cuja oferta não está mais `IN_STOCK`. R2 (muda envio). Aceite: teste com oferta fora de estoque não envia e remove `pending`.
5. **Testes de robustez de `dedupe`/`dispatchTips`** — só `test/`: `sent` com `at` inválido, pista pendente expirada, HTTP 429/5xx. R0. Aceite: novos testes passam; se revelarem bug, abrir issue separada.
