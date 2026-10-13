# Auditoria de lacunas: pistas do Telegram e promoções externas (issue #530)

Escopo: `src/tips.js`, o trecho de pistas em `src/run.js`, o envio (`tipHits`/`composeTip`/`dispatchTips` em `src/alerts.js`), as rotas que servem pistas (`api/_lib/site.mjs`, `api/_lib/home.mjs`) e os testes, na `main` (`733737e`).
Não repete o que já está em outras auditorias:
- `afiliados.md` item 6: links de pista sem `rel` de afiliado (hoje com `test/tips-links-tests.js`).
- `seguranca.md` item 6: URL de pista sem validação na coleta.
- `alertas.md`: robustez de `dispatchTips` (hoje com `test/alerts-dedupe-robustez-tests.js`).
- `rodada-robo.md`: `collectTips` isolado em `try/catch`.

## 1. Mapa
| Peça | Arquivo · trecho | Papel |
|---|---|---|
| Preço do texto | `src/tips.js:17-28` `firstPrice` | ignora parcela/cartão/cashback; seta `R$ a ➡️ R$ b` vale `b`; "por/agora"; com "de" e vários preços, o menor |
| Loja pelo link | `src/tips.js:30` `storeFromHost` | nome por `h.includes(k.replace('-', ''))` sobre `STORE_NAMES`; `amzn.`/`meli.la` à parte |
| Pelando | `src/tips.js:33-46` `parsePelando` | links `/d/<slug>`, trecho até o próximo slug (ou +6000 chars), `expired` por palavra |
| Telegram | `src/tips.js:49-64` `parseTelegram` | prévia `t.me/s/<canal>`; `url = links[0]` (qualquer host fora de `t.me`), `postedAt` do `<time datetime>` |
| Nome do canal | `src/tips.js:67` `channelOf` + `:78` | aceita `@`/link; formato `^[A-Za-z0-9_]{4,}$` |
| Coleta | `src/tips.js:70-94` `collectTips` | sequencial; `guard` (robots) + `get`; dedupe só por `key` (`pelando:<slug>` / `tg:<post>`); `matchProduct` no título e, se falhar, nas 3 primeiras linhas |
| Rodada | `src/run.js:409-436` | `config/pistas.json`, `HUNTER_TIPS=0` desliga; Copag → `discount`/`anomalous` (<55%); expira por `horasMaximas` (72 h) sobre `postedAt \|\| firstSeen`; repreço de pistas antigas |
| Alerta | `src/alerts.js:235-254` | `tipHits` (`isNew`, produto, Copag, não anômala/expirada, desconto ≥ 15%, sem `tip\|id`); `composeTip` "PISTA (NÃO VERIFICADA)"; `dispatchTips` com fila `pending` |
| Busca | `api/_lib/site.mjs:121-125` `tipHits` | filtra por palavras em título/**texto**/loja; remove só `raw/html/media/entities` |
| Produto / Início | `site.mjs:129,148`, `home.mjs:26,60-61,97` | `TIP_DROP` inclui `text`; só `productId && !expired && price > 0` |

## 2. O que já está coberto
| Regra | Teste |
|---|---|
| Pelando e Telegram identificados (preço, loja, produto), expirada marcada, canal privado reportado, pista nunca vira oferta nem `bestDeals`, alerta único "NÃO VERIFICADA", sem repetição na 2ª rodada | `test/run-tests.js:279-295` (fixture integrada) |
| `firstPrice`: parcela, preço com cartão, "De/Por" | `test/run-tests.js:236-238`, `:321` |
| Links extraídos sem `tag=` do site nem host de afiliado | `test/tips-links-tests.js` |
| Aviso único por id, desconto mínimo | `test/alerts-idempotency-tests.js:87-93` |
| Falha total → `pending`, reenvio uma vez, expirada >24 h | `test/alerts-reliability-tests.js:89-100`, `test/alerts-dedupe-robustez-tests.js:35-56` |
| Canal travado/fora | `test/alerts-timeout-tests.js:98-113` |
| Página do produto sem texto bruto; busca devolve a pista | `test/api-tests.js:176`, `:183` |
| Pistas desligadas em outros testes | `HUNTER_TIPS=0` em `test/adapter-contract-tests.js:8`, `test/store-blocking-tests.js` |

## 3. Lacunas priorizadas
**Alta**
1. **Nome da loja falsificável pelo host.** `storeFromHost` (`tips.js:30`) usa `includes` sobre o hostname. `amazon-ofertas.exemplo.com`, `promo.amazon.golpe.net` ou `magazineluizaa.shop` viram "Amazon"/"Magalu". O nome vai para o alerta (`composeTip`, `alerts.js:239`: `Loja: ${t.store}`) e para a busca (`site.mjs:123`). Só há teste com `www.amazon.com.br`/ML legítimos (`run-tests.js:283,287`). Efeito: pista de golpe com selo de loja conhecida.
2. **Pista com `postedAt` inválido nunca expira.** `run.js:428`: `now - Date.parse(t.postedAt || t.firstSeen) > maxAge`. `postedAt` vem do HTML externo (`tips.js:61`). Com valor não vazio e ilegível, `Date.parse` dá `NaN` e a comparação é `false`. Com data futura, a pista também fica. A ordenação por string (`home.mjs:62`, `site.mjs:124`) põe essa pista no topo. Sem teste.
3. **Mesma promoção de duas fontes gera dois alertas.** O dedupe é só por `key` (`tips.js:86-87`). A mesma oferta no Pelando e em um canal, ou em dois canais (`config/pistas.json` tem 3), tem `id` diferente. `tipHits` (`alerts.js:236`) a aceita duas vezes, e não há cooldown por produto/preço como em `dedupe` das ofertas. Sem teste.

**Média**
4. **Parsers sem teste unitário.** `parsePelando`/`parseTelegram` só são exercitados pela fixture de `run-tests.js` e por `tips-links-tests.js` (que checa só links). Faltam casos de bordas:
   - post sem `tgme_widget_message_text` (pulado, `tips.js:54`);
   - vários links em que o primeiro é cupom/grupo (`links[0]`, `:60`);
   - `title` vazio no Pelando (filtrado, `:45`);
   - entidades `&#x…;`, `expired` por "esgotou"/"acabou";
   - `postedAt` ausente → `null`.
   Uma mudança de markup na fonte passa sem alarme.
5. **Busca devolve o texto bruto do canal.** `site.mjs:125` remove só `raw/html/media/entities` e mantém `text` (até 600 chars, `tips.js:59`). Produto e Início removem `text` (`TIP_DROP`). O front não usa `t.text` ao exibir (`tipCard`, `index.html:1577-1587`); só o `tipHits` local (`index.html:2147`) usa para filtrar. `api-tests.js:183` só checa a quantidade. Efeito: payload maior e texto de terceiro republicado sem necessidade.
6. **Coleta de pistas fora do prazo da rodada.** O `deadline` (`run.js:173`) só vale para lojas. `collectTips` faz 4 buscas + 3 canais em série (`tips.js:72-85`), cada um com `guard` + `get`, sem limite de tempo próprio. Sem teste de prazo para pistas.

**Baixa**
7. Ramo "use o @ ou o link t.me do canal" (`tips.js:78`) sem teste. A fixture usa `@grupo_privado`, que tem formato válido.
8. Pista >72 h volta a cada rodada como `isNew:true` (`run.js:421`) e é apagada logo depois (`:428`). Não alerta (é removida antes de `tipHits`), mas nenhum teste prova isso.

## 4. Tarefas pequenas e independentes (sem `index.html`)
| # | Tarefa | Arquivos | Risco | Aceite testável |
|---|---|---|---|---|
| 1 | Testes unitários de `parsePelando`/`parseTelegram`/`channelOf` com HTML de exemplo: bordas da lacuna 4 + formato de canal inválido (lacuna 7) | `test/tips-parse-tests.js` (novo) | R0 | `npm test` verde sem rede; remover o `if (!body) continue` (`tips.js:54`) em experimento local faz falhar |
| 2 | `storeFromHost` por domínio (host igual ou subdomínio de domínio conhecido, ex. `amazon.com.br`, `mercadolivre.com.br`); fora disso, devolve o host | `src/tips.js`, `test/tips-store-host-tests.js` (novo) | R1 | `www.amazon.com.br`, `amzn.to`, `meli.la` → nome; `amazon-ofertas.exemplo.com`, `promo.amazon.golpe.net` → host; fixture de `run-tests.js` segue verde |
| 3 | Expiração robusta: `postedAt` ilegível ou no futuro cai para `firstSeen` no corte de `horasMaximas` | `src/run.js` (l.428), `test/tips-expiry-tests.js` (novo, `runOnce` em diretório temporário como `run-tests.js`) | R1 | pista com `postedAt:'lixo'` e `firstSeen` > 72 h some do `tips.json`; com `postedAt` futuro também; pista recente fica |
| 4 | Sem texto bruto na busca: aplicar `TIP_DROP` em `tipHits` de `site.mjs` depois do filtro | `api/_lib/site.mjs`, `test/site-tips-text-tests.js` (novo) | R1 | `/api/v1/site/ofertas?busca=...` devolve a pista sem `text`; o filtro por palavra do texto continua achando a pista |
| 5 | Um alerta por produto e preço entre fontes: `tipHits` ignora pista cujo `productId`+`price` já está em `sent` nas últimas N horas (marca `tipp\|<produto>\|<preço>`) | `src/alerts.js`, `test/tips-cross-source-tests.js` (novo) | R2 (muda envio) | duas pistas (Pelando + Telegram) do mesmo produto/preço → 1 envio; preço diferente → 2; testes de pista existentes seguem verdes |
| 6 | Prazo para pistas: `collectTips` recebe `deadline` e pula fontes restantes, marcando `status` `ok:false, reason:'prazo'` | `src/tips.js`, `src/run.js`, `test/tips-deadline-tests.js` (novo) | R1 | com `deadline` vencido, nenhuma requisição é feita e cada fonte aparece com `reason:'prazo'` |

Cada tarefa cria um arquivo `test/<nome>-tests.js`, descoberto por `test/run-all.mjs`. Nenhuma altera `package.json`, workflows, `config/` ou `data/`.
