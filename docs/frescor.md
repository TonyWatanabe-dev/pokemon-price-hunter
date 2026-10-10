# Frescor e saúde da oferta, do coletor à UI

Mapa do fluxo e regras de "desatualizado" e "desconhecido". Nenhum limite novo: todos vêm de
`api/_lib/freshness.mjs` (`LIMITS`: 30 min, 90 min, 24 h), já documentado ali a partir do ciclo do robô.

## Fluxo dos horários e do status

| Etapa | Onde | O que acontece |
|---|---|---|
| Coletor | `src/run.js` | Leitura bem-sucedida: `source_timestamp` = horário da rodada, `stale: false`. |
| Falha da fonte | `src/run.js` (`staleCopy`) | Reaproveita a oferta anterior com `stale: true` e `stock: UNKNOWN`. **`source_timestamp` não muda** e a última leitura válida fica em `lastValid`. |
| Rodada pulada por prazo | `src/run.js` | Oferta lida há menos de 3 h e não stale é mantida como está, com o horário antigo. |
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

## Testes

- `test/collectors-tests.js`: falha da fonte, recuperação, sem reposição/queda falsa.
- `test/freshness-tests.js`: limites, fallback entre banco e `state.json`, cabeçalhos e páginas.
- `test/offer-freshness-tests.js`: horário preservado ao reaproveitar, mapeamento para o banco e envelhecimento
  pelos limites configurados.

## Lacuna conhecida (não alterada aqui)

O frescor por oferta individual ainda não é devolvido pela API: a resposta traz o frescor da fonte inteira, e a
UI só mostra o selo `stale` e o "Atualizado há …". Expor um status por oferta exigiria definir como ele se combina
com `stale`; fica como decisão do roadmap, sem inventar limite novo.
