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
| UI | `tools/page.template.html` | "Atualizado há …" vem de `source_timestamp`; `stale` mostra o selo "Leitura antiga". |

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
- `test/offer-freshness-tests.js`: horário preservado ao reaproveitar, mapeamento para o banco e envelhecimento
  pelos limites configurados.

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
