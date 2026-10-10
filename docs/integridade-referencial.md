# Integridade referencial: produto, oferta e histórico

Auditoria do schema (`db/migrations/001`–`009`) e do `src/core/sync.js`, feita só por leitura de código e por fixtures
(`test/integrity-db-tests.js`, roda com `TEST_DATABASE_URL`). Nenhuma limpeza foi executada e nenhum dado real foi lido.

## O que o schema já garante
- `offer.product_id`, `offer.store_id`, `offer.marketplace_id`: FK. Produto com oferta não pode ser apagado.
- `legacy_id` único em produto e oferta; `slug` único; EAN/SKU único por `(kind, value, source)`.
- `price_history`: único por `(offer_id, observed_at)` (reenvio não duplica); `stock_event` exige oferta.
- `opportunity`, `product_stats`, `reference_price`, `price_daily`: FK para produto/oferta.

## Lacunas (o banco aceita; as queries abaixo detectam)
| # | Lacuna | Por quê | Query (somente leitura) |
|---|--------|---------|-------------------------|
| 1 | Histórico de oferta inexistente | `price_history.offer_id` sem FK | `historyWithoutOffer` |
| 2 | Histórico de produto inexistente | `price_history.product_id` sem FK | `historyWithoutProduct` |
| 3 | `price_history.product_id` ≠ `offer.product_id` | oferta reclassificada pelo sync (`ON CONFLICT ... SET product_id`); linhas antigas ficam com o produto antigo | `historyProductMismatch` |
| 4 | Clique de afiliado de oferta inexistente | `affiliate_click.offer_id` sem FK (de propósito: não perder clique) | `clickWithoutOffer` |
| 5 | Ofertas vivas duplicadas (mesmo marketplace, loja, URL, vendedor) | só `legacy_id` (hash) é único; `offer_external_uq` só vale com `external_offer_id` | `duplicateLiveOffers` |
| 6 | Produtos canônicos duplicados | `slug`/`legacy_id` diferentes não bloqueiam o mesmo produto; hoje a fila `duplicate_product` cobre só código de coleção antigo | `duplicateProducts` |

As queries estão em `DETECT` no teste. O caso 3 pode ser legítimo (histórico preserva o que foi observado); tratar como revisão, não como erro.
O sync atual não produz 1, 2 nem 4 (usa `oid`/`pid` resolvidos e descarta linhas sem par; `historySkipped`), então no estado normal o esperado é zero.

## Constraints: decisão
- **Nenhuma constraint foi adicionada neste PR.** Todas as opções abaixo exigem migration em tabela com dados de produção.
- FK em `price_history` (1 e 2): suportada pelo PostgreSQL 12+ em tabela particionada, mas muda tabela grande e a regra "histórico só recebe INSERT" passaria a depender de `offer` nunca ser apagada (hoje oferta sumida vira `removed`, não é apagada, então é compatível).
- Caso 3 e 5: não são candidatos a constraint sem decisão de produto (3 é legítimo; 5 exige normalizar URL).

## Plano separado (migration futura, não executar sem autorização)
1. Rodar as queries `DETECT` em leitura contra produção (com autorização) e registrar as contagens.
2. Se 1, 2 e 4 forem zero: migration `010` com `ADD CONSTRAINT ... FOREIGN KEY ... NOT VALID` em `price_history(offer_id)` e `(product_id)`, depois `VALIDATE CONSTRAINT` em janela de baixa carga; `affiliate_click.offer_id` só se for decidido perder cliques de oferta apagada (hoje é a escolha inversa).
3. Se houver órfãos: listar na fila de revisão (`review_item`), decidir caso a caso; nunca apagar em lote.
4. Casos 5 e 6: índice único parcial em oferta viva só após dedupe revisado; ampliar `duplicate_product` para detectar o caso 6.
5. Incluir as contagens de `DETECT` em `tools/db-validate.mjs` (a checagem `histórico sem oferta órfã` já cobre o caso 1).
