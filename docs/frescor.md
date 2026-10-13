# Frescor e saúde da oferta, do coletor à UI

Mapa do fluxo e regras de "desatualizado" e "desconhecido". Nenhum limite novo: todos vêm de
`api/_lib/freshness.mjs` (`LIMITS`: 30 min, 90 min, 24 h), já documentado ali a partir do ciclo do robô.

## Fluxo dos horários e do status

| Etapa | Onde | O que acontece |
|---|---|---|
| Coletor | `src/run.js` | Leitura bem-sucedida: `source_timestamp` = horário da rodada, `stale: false`. |
| Falha da fonte | `src/run.js` (`staleCopy`) | Reaproveita a oferta anterior com `stale: true` e `stock: UNKNOWN`. **`source_timestamp` não muda** e a última leitura válida fica em `lastValid`. |
| Rodada pulada por prazo | `src/run.js` (`recentRead`) | Oferta lida há menos de 3 h e não stale é mantida como está, com o horário antigo. Horário ausente, inválido ou no futuro (> 5 min) não é recente: vira `staleCopy`. |
| Frete | `src/run.js` (`carryShipping`) | Se a simulação falha (ou a oferta é copiada sem nova leitura), o frete anterior só é reaproveitado dentro da validade de 24 h da cotação (`HUNTER_SHIPPING_TTL_H`), com `shippingAt` = data da cotação original (não renova); a falha da simulação fica em `shippingError`. Vencido ou sem data, o frete vira desconhecido e o total volta ao preço. |
| Banco | `src/core/mappers.js` | `last_seen_at` = `source_timestamp`; stale vira `status = 'pending'` e `stock_status = 'unknown'`. Oferta que sumiu da rodada vira `removed`. |
| API | `api/_lib/read-db.mjs`, `read-state.mjs` | `pending` volta como `stale: true`; `source_timestamp` = `last_seen_at`. O frescor da resposta é `freshness` (e os cabeçalhos `X-Data-*`); com o `state.json`, vem de `stateDataAt` (`dataAt`). |
| UI | `index.html` (`readKnown`/`readNote`, `freshState`) | "Atualizado há …" vem de `source_timestamp` (ausente, inválido ou no futuro além de 5 min: "Data da leitura desconhecida"); `stale` mostra o selo "Leitura antiga". A barra "Ao vivo / Atualizado há" usa o frescor da fonte servida (`freshness.dataAt`; no `state.json` lido direto, `dataAt`, e só sem o campo, `generatedAt`). |

## Regras

1. **Reaproveitar não renova.** Nenhum caminho de reaproveitamento (falha, rodada pulada, cache) pode gravar um
   horário novo. Só uma leitura real da fonte avança `source_timestamp` / `last_seen_at`.
2. **Desconhecido (`unknown`)**: oferta reaproveitada por falha tem estoque `UNKNOWN` e `stale`. Não conta como
   disponível, não gera reposição nem queda (a comparação usa `lastValid`, ver `lastValidOf`). Frete sem valor
   conhecido tem `shipping_status = unknown` e total nulo.
3. **Idade** (de `source_timestamp`/`last_seen_at`, pelos `LIMITS` existentes): atual até 30 min; atrasado até
   90 min; desatualizado até 24 h; indisponível acima disso ou sem horário válido (ausente, inválido ou no futuro
   além de 5 min). Só atual e atrasado são "utilizáveis" (`usable`).
4. **Apresentação**: dado desatualizado é servido só quando não há fonte mais nova, sempre marcado, sem cache;
   indisponível não é servido como dado.

## Matriz de estados (por oferta)

| Estado | Como se reconhece | Frescor (`classify`) | Ranking / alertas | Banco e API |
|---|---|---|---|---|
| Fresco | leitura real da rodada, `source_timestamp` ≤ 30 min | `atual` (utilizável) | entra (`liveForScore`, `rankBestDeals`, `live` da Home/API) se em estoque | `active`, estoque lido |
| Envelhecendo | sem leitura nova, mesmo horário | `atrasado` ≤ 90 min (utilizável) → `desatualizado` ≤ 24 h → `indisponivel` | rodada pulada mantém só até 3 h; depois vira stale | horário antigo, nunca renovado |
| Stale (falha da fonte) | `stale: true`, `stock: UNKNOWN`, `lastValid` | pela idade do horário antigo | fora do ranking e dos alertas; Opportunity Engine com teto `pending` e `evidence: 'stale'` | `pending`, `unknown`, total nulo sem frete; vem por último na lista |
| Falha parcial | parte das páginas/lojas falhou na rodada | cada oferta pelo seu horário | só a leitura atual concorre; preço antigo mais baixo não vence | as lidas `active`, as demais `pending` |
| Horário ausente | `source_timestamp` nulo/vazio | `indisponivel` | rodada pulada não a mantém (vira stale) | `last_seen_at` nulo no mapeamento (ver lacuna 2) |
| Horário inválido ou no futuro (> 5 min) | não interpretável por `Date.parse` ou adiantado | `indisponivel` | idem ausente | inválido: o mapeamento recusa (nunca grava horário inventado); futuro: o sync não grava e mantém a leitura válida anterior (#620) |

## Testes

- `test/collectors-tests.js`: falha da fonte, recuperação, sem reposição/queda falsa.
- `test/freshness-tests.js`: limites, fallback entre banco e `state.json`, cabeçalhos e páginas.
- `test/freshness-contract-tests.js`: a matriz acima (ausente, inválido, futuro, fresco, envelhecendo, stale e falha parcial).
- `test/collector-sync-contract-tests.js`: rodadas reais com coletor simulado, conferindo cada etapa (abaixo).
- `test/state-data-at-tests.js`: `dataAt` do `state.json` na falha total, parcial e recuperação (API e UI).
- `test/api-offer-freshness-tests.js`. horário preservado ao reaproveitar, mapeamento para o banco e envelhecimento
  pelos limites configurados.
- `test/future-last-seen-tests.js`: `last_seen_at` no futuro barrado no sync, recuperação de valor já gravado, frescor
  do banco e página de lojas (#620).

## Sincronização entre etapas (issue #614)

Cada etapa tem o seu horário e nenhum deles prova o frescor de outra. Testado em `test/collector-sync-contract-tests.js`
(VTEX + JSON-LD simulados, rodadas reais de `runOnce`).

| Horário / estado | Etapa | Avança quando | Não prova |
|---|---|---|---|
| `sources[id].lastCheck` → `source_health.last_check_at` | coletor → banco | a loja é tentada (não avança em backoff nem rodada pulada) | que a leitura deu certo |
| `sources[id].lastSuccess` → `source_health.last_success_at` (`coalesce` mantém o anterior) | coletor → banco | a loja respondeu, mesmo com páginas que falharam (`pageFailures`); no JSON-LD, ao menos uma página planejada abriu (#619) | que cada oferta foi lida |
| `status` da fonte (`ACTIVE`/`ERROR`/`BLOCKED`) → `source_health.status` (`store.status` fica `active` em `ERROR`) | coletor → banco | a cada tentativa | estado das ofertas |
| `offer.source_timestamp` → `offer.last_seen_at` → `last_seen_at` da API | coletor → banco → API → UI | só leitura real da oferta | — (é o horário por oferta) |
| `max(last_seen_at)` (ativas/pendentes) | banco → API (`freshness`) | alguma oferta foi lida e sincronizada | que todas estão frescas (cada uma tem o seu) |
| `state.generatedAt` | `state.json` (identifica a rodada; ops, watchdog, backup) | toda rodada que termina | que alguma oferta foi lida |
| `state.dataAt` (`lastReadAt`: maior `source_timestamp` das ofertas publicadas, ≤ rodada) | `state.json` → API (fallback, `stateDataAt`) → páginas/sitemap → UI (barra) | alguma oferta foi lida (reaproveitar não renova `source_timestamp`) | que todas estão frescas |

| Cenário | Coletor | Banco (`offersRows`/`storesRows`) | API (`stateProductOffers` + `classify`) | UI (`index.html`) |
|---|---|---|---|---|
| Sucesso | `stale: false`, horário da rodada; fonte `ACTIVE`, `lastSuccess` = rodada | `active`, `last_seen_at` = rodada | `active`, `atual` | "Atualizado agora/há N min" |
| Erro parcial: loja fora do ar | fonte `ERROR`, `lastCheck` novo, `lastSuccess` antigo; ofertas `staleCopy` | `pending`, `unknown`, `last_seen_at` antigo; `source_health` `ERROR` | `pending`, idade real | selo "Leitura antiga" |
| Erro parcial: página da loja | fonte `ACTIVE`, `lastSuccess` novo, `pageFailures` > 0; oferta `staleCopy` | idem (a fonte parece saudável) | idem | idem |
| JSON-LD: todas as páginas planejadas falharam (#619) | fonte `ERROR` (backoff), `lastCheck` novo, `lastSuccess` antigo, `pageFailures`/`pageFailReason` mantidos; ofertas `staleCopy` | idem loja fora do ar (`source_health` `ERROR`) | idem | idem |
| Falha total | todas `staleCopy`; `generatedAt` avança, `dataAt` não | `max(last_seen_at)` não avança | por oferta: idade real; `state.json`: idade de `dataAt` (#621) | "Última leitura há …"; barra pela idade de `dataAt` |
| Horário ausente (legado) | continua ausente na falha | `last_seen_at` nulo (sync grava `now()`: lacuna 2) | `null`, `indisponivel` | "Data da leitura desconhecida" |
| Horário no futuro | continua no futuro na falha (não corrigido nem renovado) | não gravado (> 5 min pelo relógio do banco): fica a última leitura válida (#620, lacuna 6) | `indisponivel` | "Data da leitura desconhecida" (corrigido na #614: antes "Atualizado agora") |
| Recuperação | `stale: false`, sem `lastValid`, horário novo; fonte `ACTIVE`, `fails: 0` | `active`, `last_seen_at` novo | `active`, `atual` | "Atualizado agora"; volta a concorrer |

## Lacunas conhecidas

1. **Corrigida na #625.** Cada oferta devolvida pela API (`/v1/produtos/:id/ofertas`, banco e fallback do
   `state.json`) traz `freshness: { status, ageMin }`, calculado por `offerFreshness` (`api/_lib/freshness.mjs`) sobre o
   `last_seen_at` da própria oferta, com os mesmos `LIMITS` do `classify`. Não herda o frescor da loja nem o
   `meta.freshness` da resposta: sem horário, inválido ou no futuro (> 5 min) = `indisponivel` com `ageMin: null`.
   É independente de `stale`/`status: 'pending'` (uma oferta reaproveitada continua `pending` e mostra a idade real da
   última leitura). Campos existentes inalterados; ranking e UI não mudam nesta entrega. Teste: `test/api-offer-freshness-tests.js`.
2. Sem horário da fonte, a sincronização grava `last_seen_at = now()` (`coalesce` em `src/core/sync.js`, contrato
   documentado ali para não congelar ofertas de fontes sem data). Uma oferta stale antiga sem horário ganharia, no
   banco, um horário de agora e entraria no `max(last_seen_at)` do frescor. Hoje o robô sempre grava o horário da
   rodada, então o caso só ocorre com dado legado; mudar exige decidir o tratamento no banco (`NOT NULL`) em issue própria.
3. Horário inválido (texto não interpretável) faz o mapeamento recusar a oferta e a sincronização falha inteira
   (fecha em vez de inventar); isolar a oferta ruim também fica para issue própria.
4. **Corrigida na #621.** `generatedAt` do `state.json` continua sendo o horário da rodada (avança mesmo quando todos
   os coletores falham) e segue identificando a rodada para ops, watchdog, backup e o "Dados novos" da UI. O frescor do
   `state.json` agora vem de `dataAt` (`lastReadAt` em `src/run.js`): o maior `source_timestamp` das ofertas publicadas,
   nunca depois da rodada. Inclui as stale porque reaproveitar não renova o horário, então na falha total ele fica na
   última leitura e envelhece; na falha parcial e na recuperação é a rodada. Sem horário válido, `null`
   (`indisponivel`). Usam `dataAt` (por `stateDataAt` em `api/_lib/freshness.mjs`): o fallback da API, as páginas, o
   sitemap, o cache do `_seo`, `tools/seo-audit.mjs` e `freshState` da UI. `state.json` antigo, sem o campo, continua
   no `generatedAt`. Teste: `test/state-data-at-tests.js` e os casos 3–6 de `test/collector-sync-contract-tests.js`.
5. **Corrigida na #619.** JSON-LD com todas as páginas planejadas fora do ar (rede, timeout, 5xx) contava como
   `ACTIVE` (o sitemap está em cache) e avançava `lastSuccess`. Agora é falha da fonte (`src/run.js`): `ERROR`, `fails`
   + 1, backoff, `lastSuccess` parado e `collectorsSummary` contando a loja como falha; `pageFailures`, `pageFailReason`,
   `errorClass` e `httpStatus` (do motivo da 1ª página) ficam como telemetria, e as ofertas como `staleCopy`. Basta uma
   página aberta para a loja seguir `ACTIVE` (falha parcial). Sitemap sem nenhuma página planejada não é falha.
   Teste: `test/jsonld-all-pages-failed-tests.js` e os casos 2–3 de `test/collector-sync-contract-tests.js`.
6. **Corrigida na #620.** Horário no futuro (relógio do robô adiantado) era gravado como veio em `last_seen_at`; a guarda
   do sync (`offer.last_seen_at <= EXCLUDED.last_seen_at`) passava a descartar as leituras reais seguintes e o
   `max(last_seen_at)` deixava o frescor do banco `indisponivel`. Agora (`src/core/sync.js`), com o relógio do banco
   (`SELECT now()`, não o do robô): oferta com `last_seen_at` mais de 5 min no futuro não é gravada (fica a última
   leitura válida, a oferta segue viva e conta em `offersFuture`); ponto de histórico no futuro também não entra; a
   guarda aceita substituir carimbo já gravado além de `now + 5 min` (recuperação de dado antigo); e o
   `max(observed_at)` do histórico ignora ponto futuro. O frescor do banco (`DB_AT_SQL` em `api/_lib/freshness.mjs`)
   ignora `last_seen_at` futuro. A página de lojas (`normalizeLojas`/`lojasNormalize`) não usa horário futuro (oferta
   ou `lastSuccess`) como última leitura. Teste: `test/future-last-seen-tests.js`. Dados de produção não são corrigidos
   em lote: o valor futuro some na próxima leitura válida da oferta.
