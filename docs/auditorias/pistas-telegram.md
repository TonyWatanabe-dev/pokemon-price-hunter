# Auditoria: pistas do Telegram e promoções externas

Escopo: pistas (Pelando e canais públicos do Telegram), do parser ao alerta e à API. Não repete `afiliados.md` (links sem afiliado, l.17/37/49) nem `alertas.md` (pista pendente expirada, já virou teste em `test/alerts-dedupe-robustez-tests.js`).

## 1. Mapa

| Etapa | Arquivo e trecho |
|---|---|
| Preço da pista | `src/tips.js:17` `firstPrice` (ignora parcela e cartão/cashback, prefere "Por" e a seta) |
| Parser Pelando | `src/tips.js:33` `parsePelando` (links `/d/<slug>`, janela de 6000 caracteres) |
| Parser Telegram | `src/tips.js:49` `parseTelegram` (prévia `t.me/s/<canal>`, links externos, `expired`) |
| Coleta | `src/tips.js:70` `collectTips` (`guard`, `get`, dedupe por `key`, `matchProduct`) |
| Persistência | `src/run.js:409-433` (`data/tips.json`, `isNew`, desconto vs Copag, `anomalous` < 55%, expira após `horasMaximas`) |
| Alerta | `src/alerts.js:235` `tipHits`, `:238` `composeTip`, `:244` `dispatchTips` (chave `tip\|id`) |
| API | `api/_lib/site.mjs:121` `tipHits`, `:129` `TIP_DROP`, `:148` página do produto; `api/_lib/home.mjs:60-97` |
| Bot | `src/inbox.js:8` reaproveita `firstPrice` |

## 2. Já coberto

- `firstPrice`: parcela, cartão, "De/Por" e seta em `test/run-tests.js:236-238,320-323`.
- Links sem tag de afiliado: `test/tips-links-tests.js` (3 casos).
- `tipHits`/`dispatchTips`: idempotência, pendente, 429/5xx, timeout em `test/alerts-idempotency-tests.js:90`, `alerts-reliability-tests.js:91`, `alerts-dedupe-robustez-tests.js:37-90`, `alerts-timeout-tests.js:112`.

## 3. Lacunas (por prioridade)

1. **Pista que nunca expira com data inválida.** `src/run.js:428`: `now - Date.parse(t.postedAt || t.firstSeen) > maxAge`. Se `postedAt` vier em formato inválido (`<time datetime>` em `tips.js:61` não é validado), `Date.parse` dá `NaN`, a comparação é falsa e a pista fica para sempre. Nenhum teste.
2. **Texto bruto vaza na busca do site.** `site.mjs:125` remove só `raw/html/media/entities`; `TIP_DROP` (`:129`, `home.mjs:26`) remove também `text`. `tipHits` devolve `text` (até 600 caracteres de post de terceiro) na rota de busca. Divergência sem teste.
3. **Parsers quase sem teste.** `parsePelando`/`parseTelegram` só são testados pelos links. Sem teste de `expired`, `title`, `store`, `postedAt`, post sem texto, nem de `channelOf` (`tips.js:67`) com `@canal`, URL `t.me/s/` e nome curto.
4. **`collectTips` sem teste.** Falha por fonte (`status.ok=false`), canal privado (`tips.js:82`), nome inválido (`:78`) e dedupe por `key` (`:86`) não têm cobertura; a rede precisaria de injeção ou stub de `get`.
5. **URL externa sem validação de destino.** `tips.js:56,60`: o primeiro link externo qualquer vira `url`, e `composeTip` o envia como botão `VER PROMOÇÃO` (`alerts.js:242`). Não há lista de hosts de loja nem teste; um post com link para host desconhecido segue para o alerta.
6. **Desconto/anomalia sem teste de limite.** `run.js:421-422`: `anomalous` com `price < msrp*0.55` e o corte `tipMinDiscount=0.15` de `alerts.js:235` só são exercitados indiretamente.

## 4. Tarefas pequenas e independentes (sem `index.html`)

| # | Tarefa | Arquivos | Risco | Aceite |
|---|---|---|---|---|
| 1 | Extrair a regra de expiração para função pura que trate data inválida (usar `firstSeen`) e testá-la | `src/run.js`, `test/tips-expiry-tests.js` (novo) | R1 | teste: `postedAt:'xx'` com `firstSeen` antigo é removido; data válida mantém o comportamento |
| 2 | Igualar `tipHits` do site ao `TIP_DROP` (sem `text`) e testar | `api/_lib/site.mjs`, `test/tips-api-tests.js` (novo) | R1 | resposta de `tipHits` não tem `text`; o filtro por termo continua achando pelo texto |
| 3 | Testes de `parsePelando`/`parseTelegram` para `expired`, `title`, `store`, `postedAt`, post sem texto | `test/tips-parsers-tests.js` (novo) | R0 | HTML de exemplo; todos passam sem mudar `src/` |
| 4 | Testes de `channelOf` | `test/tips-channel-tests.js` (novo) | R0 | `@canal`, `https://t.me/s/canal/12?x`, `telegram.me/canal` dão `canal` |
| 5 | Testes de `collectTips` com `get`/`guard` stubados (precisa de injeção opcional) | `src/tips.js`, `test/tips-collect-tests.js` (novo) | R1 | canal privado e nome inválido geram `ok:false`; `key` duplicada aparece uma vez |
| 6 | Só rotular o host do link da pista no alerta e testar | `src/alerts.js`, `test/tips-alert-host-tests.js` (novo) | R2 | `composeTip` mostra o host quando a loja não é conhecida; sem mudar `tipHits` |
