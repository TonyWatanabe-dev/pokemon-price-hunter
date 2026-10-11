# Modelo de domínio: coleção, produto, variante e oferta

Auditoria do que **já existe** (migrations `001`–`009`, `src/core/mappers.js`, `src/core/sync.js`). Nenhuma mudança de schema ou de código de produção acompanha este documento; o contrato fica em `test/domain-model-tests.js`.

Escopo da V1: **Pokémon TCG selado**. Sem cartas avulsas e sem outros TCGs (a tabela `tcg` existe, mas só `pokemon` é usado pelos mappers).

## 1. Entidades e relações

```
tcg 1─* collection 1─* product 1─* offer *─1 store
                          │          │ └─*─1 marketplace
                          │          └─*─1 seller (opcional)
                          ├─* product_identifier (EAN, SKU, MLB...)
                          ├─* reference_price (referência Copag)
                          └─1 product_stats
category 1─* product          offer 1─* price_history / stock_event / shipping_quote
                              offer 1─1 opportunity
```

| Conceito | Tabela | Identidade | O que representa |
|---|---|---|---|
| Coleção | `collection` | `id` = `pokemon:<code>` (`UNIQUE tcg_id, code, language`) | Expansão/linha de lançamento (ex.: `me05`). |
| Produto selado | `product` | `id` (identity), `slug` fixo, `legacy_id` (`me05-etb`) | Item canônico do catálogo: coleção + tipo (categoria) + variante. Independe de loja. |
| Variante | coluna `product.variant` (+ `units`) | parte da identidade lógica do produto | Hoje **não é entidade**: é texto no produto (ex.: Box ex Greninja). Em `sync.js`, a chave lógica é `coleção\|tipo\|variante`. |
| Oferta de loja | `offer` | `id`, `legacy_id` (hash loja+URL+vendedor), índice único `(marketplace, external_offer_id, seller)` | Um anúncio concreto de um produto numa loja/marketplace. |
| Loja / canal / vendedor | `store`, `store_channel`, `marketplace`, `seller` | `store.id` do robô | Quem vende e onde. |

Cadeia de dependência: **coleção → produto → oferta**. Uma oferta sempre aponta para um produto (`offer.product_id NOT NULL`); o produto aponta para a coleção (`collection_id`, nulo só para acessório universal, que está fora do escopo da V1).

## 2. Atributos estáveis × voláteis

**Estáveis (pertencem ao produto/coleção, mudam raramente e só por decisão de catálogo):** `collection_id`, `category_id`, `brand`, `canonical_name`, `language`, `units`, `variant`, `slug` (nunca muda depois de criado), `legacy_id`, EAN/GTIN em `product_identifier`, `release_date`, `edition`.

**Voláteis (pertencem à oferta, mudam a cada rodada do robô):**

| Grupo | Colunas em `offer` | Histórico |
|---|---|---|
| Preço | `price`, `price_kind`, `list_price`, `pix_price` | `price_history` (só INSERT) |
| Estoque | `stock_status`, `quantity` | `stock_event` |
| Frete | `shipping_status`, `shipping_price`, `total_price` | `shipping_quote` |
| URL e anúncio | `url`, `title_raw`, `image_url`, `external_*` | não versionado |
| Estado do vínculo | `status`, `confirmed`, `anomalous`, `match_confidence`, `last_seen_at` | — |

Regras já aplicadas no código e travadas pelo teste:
- Produto **não** guarda preço, estoque, frete nem URL de loja.
- Oferta **não** guarda coleção, categoria, unidades nem variante (herda do produto).
- `total_price` só existe com frete conhecido; nunca é inventado.
- O `slug` do produto não é atualizado pelo upsert de `sync.js`.

## 3. Duplicações conhecidas (documentadas, não corrigidas)

Nenhuma delas causa erro hoje; a correção ampla foi deliberadamente evitada.

1. **Tipo do produto em dois lugares:** `product.category_id` e `product.attrs.type/typeLabel/group` (gravados por `productsRows`). A categoria é a fonte; `attrs` é legado de apresentação.
2. **Coleção no `legacy_id`:** o prefixo de `me05-etb` repete `collection_id`. Produtos com código de coleção antigo viram `review_item` de categoria `duplicate_product` em `sync.js`.
3. **Variante como texto livre:** a identidade lógica (`coleção|tipo|variante`) só é garantida por código (`sync.js`), não por constraint no banco.
4. **Imagem:** `product.image_url` e `offer.image_url`; o produto herda a foto do anúncio (`coalesce` no upsert).
5. **Condição:** `product.condition` e `offer.condition`; na V1 tudo é `new`.
6. **`product_id` desnormalizado:** em `price_history`, `opportunity` e `price_daily`. Em `price_history` é de propósito (consultas por produto sem join); se uma oferta for reclassificada para outro produto, o histórico antigo mantém o produto anterior.
7. **Preço derivado:** `total_price` = `price` + frete; `discount`/referência em `product_stats` e `opportunity` (migrations 006–008) repetem dados de `reference_price`.
8. **Frete e estoque:** estado atual em `offer`; eventos em `stock_event` e `shipping_quote`. `shipping_quote` é gravado só com CEP `00000` (regra geral).
9. **EAN:** vem no mapper de produto (`ean`), mas não é coluna de `product`; `sync.js` o grava em `product_identifier`.
10. **Loja × canal × vendedor:** `store`, `store_channel` e `seller.store_id` se sobrepõem (vendedor que também é loja). Em loja direta com vendedor parceiro, o `external_id` do vendedor é prefixado pela loja.

## 4. Lacunas e propostas (etapa separada, **sem migration nesta entrega**)

Nada abaixo foi aplicado. Qualquer item exige migration própria, revisada à parte, e **nenhuma migration de produção** faz parte desta tarefa.

- **Variante como entidade** (`product_variant` ou constraint única em `(collection_id, category_id, coalesce(variant,''))`): hoje a unicidade é só por código. Opção de baixo risco: apenas o índice único parcial, após checar duplicatas existentes via `review_item`.
- **Restringir V1 no banco:** `CHECK (category_id LIKE 'sealed.%')` ou validação em `categoryOf` (já lança erro para tipo desconhecido; o teste garante que todo tipo mapeia para `sealed.*`).
- **Remover `attrs.type/typeLabel/group`** do produto depois que o site deixar de lê-los.
- **Cartas individuais e outros TCGs:** fora da V1; exigiriam entidade própria (carta ≠ produto selado) e não devem reutilizar `variant` como texto.

## 5. Contrato (testes)

`test/domain-model-tests.js` (entra no `npm test`, sem banco) verifica:
- colunas de `product`, `collection` e `offer` lidas da migration `001` não misturam estável com volátil;
- as linhas geradas pelos mappers só usam colunas existentes (com as exceções explícitas e documentadas);
- V1: tcg `pokemon` e categorias `sealed.*` apenas;
- `sync.js` não reescreve o `slug` do produto.
