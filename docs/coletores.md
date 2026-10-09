# Coletores: falhas de leitura, estoque e frete (Lote 7)

Regras que evitam que uma falha de leitura vire fato publicado.

## Páginas JSON-LD (`src/run.js`, `src/adapters/jsonld.js`)

- **Falha × resposta definitiva.**
  - Falha de leitura (tentar de novo): timeout, erro de rede, HTTP 5xx, 408 e "fora do ar".
  - Resposta definitiva: 404, 410 e outros 4xx (a página sumiu), ou página que não é produto.
- **Página que já tinha oferta e falha:** a oferta fica `stale` (estoque `UNKNOWN`, fora do ranking e dos alertas), nunca `removed`. A página continua relevante e é lida de novo na rodada seguinte.
- **Página nova que falha:** não conta como visitada. Ela é tentada de novo nas rodadas seguintes, até `HUNTER_JSONLD_RETRY_MAX` vezes (padrão 3). Depois disso, só volta no intervalo de releitura.
- **Página lida e não relevante:** é relida depois de `HUNTER_JSONLD_RECHECK_H` horas (padrão 24), no máximo `HUNTER_JSONLD_RECHECK_MAX` por rodada (padrão 10), da mais antiga para a mais nova. Páginas do cache antigo, sem data de leitura, entram primeiro.
- **Na fonte (`sources.json`):** `pageFailures` e `pageFailReason` mostram quantas páginas falharam na rodada.

## Estoque

- **Base dos eventos de estoque.** "Voltou ao estoque" e "queda" comparam com o último estado lido de verdade.
  - A oferta `stale` guarda `lastKnownStock`.
  - Oferta desatualizada ou estoque `UNKNOWN` nunca vira restock.
- **No banco (`src/core/sync.js`):**
  - Oferta `pending` (stale) não gera `stock_event`.
  - Quando o estoque anterior era `unknown`, a origem do evento é o último estoque conhecido em `price_history`.
  - Sem estoque conhecido, não há evento.
- **Mercado Livre pela lista do catálogo (`/products/{id}/items`):**
  - O anúncio entra como `IN_STOCK` com `stockVerified: false`.
  - O alerta diz "anunciado, quantidade não verificada", nunca "confirmado".
  - Com `/items` aberto, a quantidade comprova o estoque: `available_quantity` 0 = `OUT_OF_STOCK`.

## Frete VTEX por CEP

- **Simulação que falha:** vale o último frete simulado da mesma oferta, com a data dele (`shippingAt`, `shippingSource: 'anterior'`), por até `HUNTER_SHIPPING_TTL_H` horas (padrão 24).
- **Sem frete anterior válido:** o frete fica desconhecido. Nunca é inventado.
- **Motivo da falha:**
  - na oferta, em `shippingError`;
  - na fonte, em `shippingFailures` e `shippingFailReason`;
  - no log da rodada.
- **Comparação entre leituras (`src/offer-compare.js`):**
  - Usa o total só quando a situação do frete é a mesma nas duas leituras; senão, usa o preço do produto.
  - Frete que some ou volta não é queda nem alta.
- **No banco:** frete reaproveitado não renova `shipping_quote.checked_at`.

## Mercado Livre: catálogo

- **Algumas buscas falham:** o catálogo anterior é mantido e somado ao que veio. Nova tentativa em 1 h.
- **Todas respondem, mas sem nenhum produto:** o catálogo anterior é mantido. Nova tentativa em 1 h.
- **Todas as buscas, ou todas as consultas de ofertas, falham:** a leitura falha, a fonte fica com erro e as ofertas ficam `stale`. Nunca anuncia "zero anúncios".
- **Vigia:** a regra "fonte acompanhada zerada" está em `docs/vigia.md`.

## Matching

- **"Case" de loja:** uma caixa com várias unidades ("Case Blister Quádruplo", "Case Combo de Booster") não casa com o produto unitário.
- **"Case vazio":** continua recusado como acessório.
