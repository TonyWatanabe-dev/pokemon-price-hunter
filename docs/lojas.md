# Página /lojas e "Procurar em outras lojas" (Frente 7)

Toda loja que o projeto conhece aparece em `/lojas`, inclusive as que o robô não consegue ler, cada uma com um link para a busca de Pokémon na própria loja. O objetivo é levar gente de verdade para a loja; o site nunca vende.

## Regras do dono (valem para SSR e para o site)
- Nunca prejudicar uma loja: o texto diz "sem leitura automática", nunca "fora do ar"; o motivo técnico cru (timeout, HTTP, bloqueio) não vai para a página.
- Nunca mostrar preço que o robô não leu: `/lojas` não tem preço; "Procurar em outras lojas" é só link de busca.
- Pix sempre sinalizado onde há preço (as ofertas em "Onde comprar" seguem como antes).
- Links externos sempre com `rel="noopener nofollow"` e nova aba. Sem tag de afiliado: a busca abre o endereço da loja, nada é anexado (a lista curada "Também na Amazon" é à parte: `docs/afiliados.md`).

## De onde vêm os dados
- `sources.json` do branch `data` (vem dentro do `state.json` como `sources`; sem ele, `api/_lib/lojas.mjs` busca o arquivo com o mesmo cache de 10 min). Status do robô → status da página: `ACTIVE` → monitorada, `BLOCKED`/`ERROR`/`PENDING` → sem leitura automática, `UNAVAILABLE` → sem API (mesma seção), `PAUSED` → pausada; Amazon, Shopee e Magalu → marketplaces (Mercado Livre é monitorado pela API e fica em "Monitoradas agora").
- `config/stores.json`: plataforma e `enabled` das lojas semeadas (a função `api/pagina.mjs` leva o arquivo via `includeFiles`).
- Mesmo domínio duas vezes (amazon × amazon.com.br) vira uma entrada; fonte `PENDING` sem domínio que já existe com domínio não duplica.
- Campos opcionais que o robô pode passar a gravar são lidos se existirem: `platformHint` (vale antes de qualquer inferência).

## Busca por plataforma (`LOJAS_CFG.busca`)
Shopify `/search?q=` · VTEX `/{q}?_q={q}&map=ft` · Nuvemshop `/search/?q=` · Tray `/loja/busca.php?palavra_busca=` · WooCommerce `/?s={q}&post_type=product` · Loja Integrada `/buscar?q=` · Magento `/catalogsearch/result/?q=` · OpenCart `index.php?route=product/search&search=`.

Como a plataforma é decidida, nesta ordem: `platformHint` da fonte → `config/stores.json` → `plataformaPorHost` (confirmada na home da loja em 12/10/2026) → plataforma que o robô já distingue (Shopify/VTEX; "jsonld" é método de leitura, não plataforma) → inferência pelas URLs das ofertas (`/products/` Shopify, `/produtos/` Nuvemshop, `/p` VTEX; `/produto/` não prova nada: há Wix com o mesmo caminho). Sem confirmação, o botão vira "Abrir a loja" e leva à página inicial: nunca se chuta uma URL de busca que pode dar 404 na loja.

Lojas sem padrão confirmado (link para a página inicial): plataformas próprias ou fora da lista (Commerceplus, Magazord, Simplo7, Climba, Wix, Next.js próprio, Liga Pokémon, MYP Cards, Kalunga com busca própria já mapeada em `buscaPorHost`) e todas as lojas que bloqueiam leitura (não deu para confirmar nada nelas).

Para confirmar uma loja nova: abrir a home, achar o marcador da plataforma (cdn.shopify, vteximg, mitiendanube, tcdn/Tray, awsli/Loja Integrada, wp-content + add-to-cart, catalogsearch, `route=product/search`) e anotar o host em `plataformaPorHost` (ou a URL de busca própria em `buscaPorHost`) em `api/_lib/lojas.mjs` **e** na cópia literal `const LOJAS_CFG` do `index.html` (`test/lojas-page-tests.js` confere que as duas são iguais).

## Onde está
- `api/_lib/lojas.mjs`: normalização, busca por loja, seções, `outrasLojas` (até 12: marketplaces primeiro, depois lojas não monitoradas com busca própria, em ordem alfabética).
- `api/pagina.mjs`: SSR de `/lojas` (1 h1, um h2 por seção, JSON-LD `ItemList` de `Store`/`Organization`) e o bloco `<details>` do produto, abaixo de "Onde comprar".
- `index.html`: rota `/lojas`, `renderLojas`, `outrasLojasBlock` (fechado no celular), item no menu "Mais" e no rodapé; "Ver ofertas" abre Oportunidades filtrada pela loja.
- `api/sitemap.mjs` (`/lojas`, daily 0.6) e `vercel.json` (rewrite + `includeFiles`).
