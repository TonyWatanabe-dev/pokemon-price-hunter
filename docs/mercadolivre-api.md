# Mercado Livre — API oficial: o que abre, o que dá 403 e como o estoque é lido

Coletor: `src/adapters/mercadolivre.js` (OAuth em `src/mlauth.js`). Diagnóstico de cada rodada: `data/ml-debug.json` (branch `data`), sem token.

## O que funciona hoje (app comum, token de usuário)
| Chamada | Estado | Uso |
|---|---|---|
| `GET /products/search?status=active&site_id=MLB&q=…` | OK | acha a página de catálogo de cada produto (cache 1 dia em `data/ml-catalog.json`) |
| `GET /products/{id}/items` | OK | lista cada vendedor que disputa a página, com preço e `available_quantity` |
| `GET /users/{seller_id}` | OK | apelido e reputação do vendedor (cache 7 dias) |
| `GET /sites/MLB/search?q=…` | **403** | busca aberta de anúncios; fechada para apps comuns desde 2025 |
| `GET /items?ids=…` (multiget) | **403 por anúncio** | HTTP 200 com `code: 403` em cada item: `{"message":"Access to the requested resource is forbidden","error":"access_denied","status":403,"cause":null}` (`ml-debug.json`, 2026-10-12: `itemsApi:false`, 284 ofertas publicadas, todas `UNKNOWN`) |

## Estoque pelo catálogo (em vigor)
Pela documentação do ML ("List of publications for a product page", `GET /products/$PRODUCT_ID/items`), cada item da lista traz
`item_id, seller_id, price, original_price, available_quantity, sold_quantity, condition, listing_type_id, shipping{free_shipping,…}, official_store_id, tags, …`
e **não traz `status`**: a lista é só de anúncios ativos que disputam a página. O coletor usa isso (`catalogStock`):

| Evidência no item | Estoque publicado |
|---|---|
| `available_quantity > 0` (e `status` ausente ou `active`) | `IN_STOCK`, `stockSource: 'ml-catalog'`, `quantity` quando > 1 |
| `available_quantity == 0` ou `status` pausado/fechado | `OUT_OF_STOCK` — não ocupa vaga das 6 ofertas por produto (contado em `drop`) |
| sem `available_quantity` | `UNKNOWN`, sem `stockSource` (nunca inventa) |
| `condition != 'new'` | excluído antes de tudo |

Quando `/items` voltar a abrir, a conferência por anúncio manda (`status`, `price`, `permalink`, `available_quantity`) com `stockSource: 'ml-items'`.
Preço, link (`/p/{produto}?pdp_filters=item_id:{anúncio}`) e estoque vêm da **mesma leitura** (`source_timestamp` por produto), com um anúncio por vendedor, vendedor com reputação (`MIN_SALES`, termômetro verde/amarelo) e `mlReject` para kits/lotes/outras coleções.
Em `src/run.js` nada muda de regra: oferta `IN_STOCK` entra em `liveForScore`/`bestDeals` como as demais; afiliado não entra na nota; o Opportunity Engine só reduz a confiança (×0,85) quando a referência de mercado é só de marketplace.

`ml-debug.json` passa a registrar: `catalogFields` (nomes dos campos que a API devolveu), `catalogSample` (um item, só campos de preço/estoque), `catalogStock` e `publishedStock` (contagens), `searchApi`/`searchError`, `itemsError` (corpo estruturado do 403), `scope` (nomes dos escopos do token OAuth, se o ML os devolver).

## Hipóteses para o 403 em `/items` e `/sites/MLB/search`
1. **Política de dados de terceiros (PolicyAgent)**: desde 2025 o ML só devolve anúncio de outro vendedor para apps com permissão específica; `access_denied` sem `cause` é o padrão desse bloqueio.
2. **Escopos do app**: o app foi criado só com `read`/`offline_access`; o ML não expõe escopo para "itens de terceiros" na tela comum — é liberado por solicitação.
3. **App sem produto/caso de uso declarado**: no DevCenter novo, apps sem "produto" (ex.: *Pricing/Catalog*) ficam no nível básico.
4. **Token de usuário vs. app**: o token é de uma conta pessoal sem perfil de vendedor; alguns recursos só abrem para contas vendedoras/desenvolvedor certificado.

## Checklist para o dono (DevCenter: developers.mercadolivre.com.br → Minhas aplicações)
1. Abrir o app e conferir **Escopos**: marcar `read` (e `offline_access`); salvar e **reautorizar** (workflow "Mercado Livre: autorizar") — o `scope` aparece em `ml-debug.json`.
2. Em **Produtos/Permissões do app**, pedir acesso ao recurso de **Itens (leitura de anúncios de terceiros)** / "Catalog" e descrever o caso de uso (comparador de preços, só leitura).
3. Conferir se a conta que autorizou é a dona do app e tem **status de vendedor** ativo; se não, autorizar com uma conta vendedora.
4. Abrir um chamado em **Suporte para desenvolvedores** anexando o corpo do 403 de `ml-debug.json` (`itemsError`) e o `item_id`; perguntar qual permissão libera `GET /items?ids=` para anúncios de outros vendedores.
5. Depois de qualquer mudança: rodar a coleta e checar `ml-debug.json` → `itemsApi: true` e `itemsError: null`; caso contrário o fallback pelo catálogo segue valendo.

## Fallback em vigor
Com `/items` fechado, o ranking usa o estoque do catálogo (tabela acima). Teste: `test/ml-estoque-tests.js` (mapeamento, adaptador e rodada completa com oferta do ML chegando ao `bestDeals`).


## Decisão de 12/10/2026 — publicação listada conta como disponível

A primeira rodada com o diagnóstico provou que o payload real de `GET /products/{id}/items` **não traz `available_quantity` nem `status`** (campos: `item_id`, `seller_id`, `price`, `original_price`, `condition`, `listing_type_id`, `shipping`, `official_store_id`, `tags`…). Como o catálogo do Mercado Livre só lista anúncios ativos, o dono decidiu: publicação listada, com preço e condição nova, entra como `IN_STOCK` com `stockSource: ml-catalog-listed` (quantidade desconhecida). O Opportunity Engine continua aplicando o teto de marketplace. Quando `/items` abrir, a leitura por anúncio (`ml-items`) volta a mandar.
