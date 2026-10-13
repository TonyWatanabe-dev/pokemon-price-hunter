# Auditoria de lacunas: alertas ao usuário e retenção (Fase 4, issue #440)

Escopo: leitura da `main` (`6c8787a`). Complementa `alertas.md` (#293), sem repetir o que ele cobre; as tarefas 1–3 e 5 de lá (poda, rotação, `validateRule`, robustez de `dedupe`) já existem (`pruneSent`, `capJsonlLines`, `validateRule`, `test/alerts-*-tests.js`). Aqui o foco é o alerta **por usuário**. `account.js` (1 linha, bundle minificado do cliente com Firebase Auth/`localStorage`) foi só lido: não há nele regra de alerta ou preferência a auditar.

## 1. Mapa
| Arquivo | Trecho | Papel |
|---|---|---|
| `db/migrations/001_core.sql:346-367` | `favorite`, `price_alert`, `alert_delivery` | modelo por usuário: favorito, alerta (`target_price`, `active`), entrega única por (alerta, oferta, canal, dia) |
| `src/server.js:41-44,54` | `upsertRule`, `POST /watchlist` e `/alerts` | grava regra global em `config/watchlist.json` (sem usuário) |
| `src/alerts.js:144-157` | `transports.telegram/ntfy` | destino único vindo de `TELEGRAM_CHAT_ID`/`NTFY_TOPIC` do ambiente |
| `src/alerts.js:56,98` | `evaluate`, `dedupe` | queda/reposição/alvo; cooldown e `settings` globais (`config/watchlist.json:3`) |
| `src/alerts.js:185-200` | `retryPending` | reenvia a mensagem original até 24 h |
| `test/user-isolation-db-tests.js` | 7 casos `t(...)` | isolamento no Postgres (só com `TEST_DATABASE_URL`) |

## 2. Já coberto (teste)
- Queda real só como novo melhor preço, mesma base de frete: `alerts-drop-best-tests.js`, `alerts-shipping-tests.js`.
- Reposição só com evento `restock`; cooldown; preferências ausentes: `alerts-reliability-tests.js`, `alerts-idempotency-tests.js`.
- `sent` corrompido/`at` inválido: `alerts-dedupe-robustez-tests.js`; poda e rotação: `alerts-prune-tests.js`, `alerts-jsonl-rotation-tests.js`; validação de regra: `alerts-rule-validation-tests.js`.
- Isolamento A×B de favoritos, alertas e entregas, FK, rollback e cascata ao apagar usuário (SQL direto): `user-isolation-db-tests.js`.

## 3. Lacunas priorizadas
**Alta**
- Os alertas por usuário não têm código de aplicação: `grep price_alert|alert_delivery|favorite` em `src/`, `api/`, `tools/` não acha uso fora da migração. O isolamento só é provado com SQL escrito no próprio teste ("operações do app", `user-isolation-db-tests.js:20-23`), não com uma camada real que force `user_id`.
- Sem dono nem autenticação: `POST /alerts` grava em `config/watchlist.json` sem usuário e `src/server.js` não verifica credencial. Qualquer cliente que alcance a porta altera as regras de todos.
- Sem opt-in/opt-out: `transports` enviam ao canal do ambiente; não há tabela de canal/consentimento por usuário, nem descadastro. `price_alert.active` não tem fluxo que o leia.
**Média**
- Preferências são globais: `cooldownHours` e `minDropPct` vêm de um `settings` único (`alerts.js:98-101`); `app_user` não guarda preferência (canal, horário, limite diário).
- Anti-spam só por chave de regra/produto: não há limite por usuário/dia entre alertas diferentes; `alert_delivery` só impede repetição por (alerta, oferta, canal, dia).
- `retryPending` (`alerts.js:190`) não reconfere estoque/preço antes de reenviar (já listado em `alertas.md`, ainda aberto: nenhum teste em `alerts-reliability-tests.js` cobre pendente fora de estoque).
**Baixa**
- Cascata de `ON DELETE` coberta só para `favorite`/`price_alert`; `alert_delivery.offer_id` NULL não conta como duplicado (comentário em `user-isolation-db-tests.js:21`), sem proteção no schema.

## 4. Tarefas pequenas e independentes
1. **Repositório de alertas por usuário** — `src/db/user-alerts.js` com `listAlerts/createAlert/setActive/deleteAlert(userId, ...)`, sempre filtrando por `user_id`. R1. Aceite: `test/user-alerts-tests.js` (pula sem `TEST_DATABASE_URL`, como o de isolamento) prova que A não lê/edita/apaga alerta de B pela função.
2. **Validação de alerta de usuário** — função pura `validateUserAlert` (alvo > 0, `productId` inteiro, `active` booleano) em `src/db/user-alerts.js`. R0/R1. Aceite: teste puro rejeita alvo negativo/texto e aceita o válido.
3. **Limite diário por usuário** — função pura `capPerUser(hits, deliveredToday, max)` em `src/alerts.js`, ainda sem uso na rodada. R1. Aceite: com `max=3` e 2 já entregues, só 1 hit passa; ordem estável.
4. **Revalidar pendente** — em `retryPending`, descartar pendente cuja oferta não está `IN_STOCK`. R2 (muda envio). Aceite: teste em `test/alerts-reliability-tests.js` com oferta esgotada não envia e remove `pending`.
5. **Preferência de canal/consentimento (desenho)** — só migration nova `db/migrations/00N_*.sql` com `notification_pref(user_id, channel, enabled, opted_in_at)`; sem enviar nada. R2 (schema). Aceite: `tools/db-validate.mjs` e a migração aplicam em banco descartável; teste de isolamento cobre a tabela.
