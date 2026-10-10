# Pré-venda e disponibilidade futura

## Estados hoje

| Robô (`offer.stock`) | Banco (`offers.stock_status`) | Origem |
|---|---|---|
| `IN_STOCK` | `in_stock` | adaptadores; JSON-LD `InStock`/`LimitedAvailability` |
| `OUT_OF_STOCK` | `out_of_stock` | adaptadores; JSON-LD `OutOfStock`/`SoldOut` |
| `PRE_ORDER` | `preorder` | JSON-LD `PreOrder`/`PreSale`/`BackOrder`; título com "pré-venda", "encomenda", "reserva" (vence `IN_STOCK`) |
| `UNAVAILABLE` | `unknown` (sem valor próprio no CHECK) | JSON-LD `Discontinued`/`InStoreOnly` |
| `UNKNOWN` | `unknown` | leitura sem sinal, falha de coleta (cópia stale) |

Pré-venda nunca entra em `liveForScore`, em alertas (`eligible` exige `IN_STOCK`) nem na atividade; o Opportunity Engine limita a nota a 60.

## Entregue nesta mudança (sem alterar esquema)

- `src/availability.js`: `isRestock` (pré-venda → estoque é lançamento, não restock), `releaseDateOf`/`availableFromOf` (só data completa AAAA-MM-DD informada pela loja; descartada fora de pré-venda).
- `run.js`: evento `restock` deixa de disparar quando a leitura anterior era pré-venda ou desconhecida (`UNKNOWN`: unknown não vira in/out).
- JSON-LD: `offers.availabilityStarts` vira `availableFrom` no estado (`state.json`), apenas em pré-venda. Nada é inferido de texto livre.

## Proposta compatível para o banco (não aplicada)

Migration aditiva e não destrutiva, a ser revisada antes de rodar:

1. `offers.available_from date NULL` (data prevista informada pela loja; `NULL` = desconhecida).
2. Ampliar o CHECK de `stock_status` com `'unavailable'` (hoje cai em `unknown`). Fazer com `ADD CONSTRAINT ... NOT VALID` + `VALIDATE`, mantendo os valores atuais.
3. `mappers.js`: mapear `UNAVAILABLE → unavailable` e `availableFrom → available_from` somente depois da migration aplicada.

Nenhuma coluna é removida e nenhum dado existente muda; linhas atuais ficam com `available_from` nulo. Aplicação em produção depende de autorização explícita.
