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
| API | `api/_lib/read-db.mjs`, `read-state.mjs` | `pending` volta como `stale: true`; `source_timestamp` = `last_seen_at`. O frescor da resposta é `freshness` (e os cabeçalhos `X-Data-*`). |
| UI | `index.html` (`readKnown`/`readNote`, `freshState`) | "Atualizado há …" vem de `source_timestamp` (ausente, inválido ou no futuro além de 5 min: "Data da leitura desconhecida"); `stale` mostra o selo "Leitura antiga". A barra "Ao vivo / Atualizado há" usa o frescor da fonte servida (`freshness.dataAt` ou `generatedAt`). |

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
| Horário inválido ou no futuro (> 5 min) | não interpretável por `Date.parse` ou adiantado | `indisponivel` | idem ausente | inválido: o mapeamento recusa (nunca grava horário inventado) |

## Testes

- `test/collectors-tests.js`: falha da fonte, recuperação, sem reposição/queda falsa.
- `test/freshness-tests.js`: limites, fallback entre banco e `state.json`, cabeçalhos e páginas.
- `test/freshness-contract-tests.js`: a matriz acima (ausente, inválido, futuro, fresco, envelhecendo, stale e falha parcial).
- `test/collector-sync-contract-tests.js`: rodadas reais com coletor simulado, conferindo cada etapa (abaixo).
- `test/offer-freshness-tests.js`: horário preservado ao reaproveitar, mapeamento para o banco e envelhecimento
  pelos limites configurados.

## Sincronização entre etapas (issue #614)

Cada etapa tem o seu horário e nenhum deles prova o frescor de outra. Testado em `test/collector-sync-contract-tests.js`
(VTEX + JSON-LD simulados, rodadas reais de `runOnce`).

| Horário / estado | Etapa | Avança quando | Não prova |
|---|---|---|---|
| `sources[id].lastCheck` → `source_health.last_check_at` | coletor → banco | a loja é tentada (não avança em backoff nem rodada pulada) | que a leitura deu certo |
| `sources[id].lastSuccess` → `source_health.last_success_at` (`coalesce` mantém o anterior) | coletor → banco | a loja respondeu, mesmo com páginas que falharam (`pageFailures`) | que cada oferta foi lida |
| `status` da fonte (`ACTIVE`/`ERROR`/`BLOCKED`) → `source_health.status` (`store.status` fica `active` em `ERROR`) | coletor → banco | a cada tentativa | estado das ofertas |
| `offer.source_timestamp` → `offer.last_seen_at` → `last_seen_at` da API | coletor → banco → API → UI | só leitura real da oferta | — (é o horário por oferta) |
| `max(last_seen_at)` (ativas/pendentes) | banco → API (`freshness`) | alguma oferta foi lida e sincronizada | que todas estão frescas (cada uma tem o seu) |
| `state.generatedAt` | `state.json` → API (fallback) → UI (barra) | toda rodada que termina | que alguma oferta foi lida (lacuna 4) |

| Cenário | Coletor | Banco (`offersRows`/`storesRows`) | API (`stateProductOffers` + `classify`) | UI (`index.html`) |
|---|---|---|---|---|
| Sucesso | `stale: false`, horário da rodada; fonte `ACTIVE`, `lastSuccess` = rodada | `active`, `last_seen_at` = rodada | `active`, `atual` | "Atualizado agora/há N min" |
| Erro parcial: loja fora do ar | fonte `ERROR`, `lastCheck` novo, `lastSuccess` antigo; ofertas `staleCopy` | `pending`, `unknown`, `last_seen_at` antigo; `source_health` `ERROR` | `pending`, idade real | selo "Leitura antiga" |
| Erro parcial: página da loja | fonte `ACTIVE`, `lastSuccess` novo, `pageFailures` > 0; oferta `staleCopy` | idem (a fonte parece saudável) | idem | idem |
| Falha total | todas `staleCopy`; `generatedAt` avança | `max(last_seen_at)` não avança | por oferta: idade real; `state.json`: `atual` (lacuna 4) | "Última leitura há …"; barra pelo `generatedAt` |
| Horário ausente (legado) | continua ausente na falha | `last_seen_at` nulo (sync grava `now()`: lacuna 2) | `null`, `indisponivel` | "Data da leitura desconhecida" |
| Horário no futuro | continua no futuro na falha (não corrigido nem renovado) | gravado como veio (lacuna 6) | `indisponivel` | "Data da leitura desconhecida" (corrigido na #614: antes "Atualizado agora") |
| Recuperação | `stale: false`, sem `lastValid`, horário novo; fonte `ACTIVE`, `fails: 0` | `active`, `last_seen_at` novo | `active`, `atual` | "Atualizado agora"; volta a concorrer |

## Lacunas conhecidas (não alteradas aqui)

1. O frescor por oferta individual ainda não é devolvido pela API: a resposta traz o frescor da fonte inteira, e a
   UI só mostra o selo `stale` e o "Atualizado há …". Expor um status por oferta exigiria definir como ele se combina
   com `stale`; fica como decisão do roadmap, sem inventar limite novo.
2. Sem horário da fonte, a sincronização grava `last_seen_at = now()` (`coalesce` em `src/core/sync.js`, contrato
   documentado ali para não congelar ofertas de fontes sem data). Uma oferta stale antiga sem horário ganharia, no
   banco, um horário de agora e entraria no `max(last_seen_at)` do frescor. Hoje o robô sempre grava o horário da
   rodada, então o caso só ocorre com dado legado; mudar exige decidir o tratamento no banco (`NOT NULL`) em issue própria.
3. Horário inválido (texto não interpretável) faz o mapeamento recusar a oferta e a sincronização falha inteira
   (fecha em vez de inventar); isolar a oferta ruim também fica para issue própria.
4. `generatedAt` do `state.json` é o horário da rodada, não da última leitura: avança mesmo quando todos os coletores
   falham. O fallback da API para o `state.json` (`api/v1.mjs`, banco desatualizado) e a barra da UI podem então dizer
   "atual" com todas as ofertas stale (cada oferta continua marcada e com a idade real). Corrigir exige decidir um
   horário de "última leitura real" no `state.json` (por exemplo, o maior `source_timestamp` não stale) e como ele
   convive com o `generatedAt` que a Home, o sitemap e as páginas já usam; fica para issue própria.
5. JSON-LD com todas as páginas fora do ar conta como `ACTIVE` (a loja "respondeu" porque o sitemap está em cache) e
   avança `lastSuccess`; só `pageFailures` mostra a falha, e `collectorsSummary` conta a loja como ok.
   Tratar "todas as páginas falharam" como falha da fonte muda backoff e alertas: issue própria.
6. Horário no futuro (relógio do robô adiantado) é gravado como veio em `last_seen_at`. A guarda do sync
   (`offer.last_seen_at <= EXCLUDED.last_seen_at`) passa a descartar as leituras reais seguintes da oferta até o relógio
   alcançar, e o `max(last_seen_at)` deixa o frescor do banco `indisponivel`. Hoje `source_timestamp` é sempre o `T` da
   rodada, então só ocorre com relógio do runner errado; recusar ou limitar no mapeamento exige o `now` da
   sincronização e decidir o tratamento (issue própria). A página de lojas (`lojasNormalize`) também usa o maior
   `source_timestamp` sem esse limite.
