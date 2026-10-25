# Política de ofertas e afiliados (estado do código em 25/10/2026, main c0b6bf4)

Documento descritivo: registra as regras **vigentes**, tiradas do código (arquivo:linha), o teste que cobre cada uma e as divergências entre superfícies. Não muda comportamento. Recomendações ficam no fim, marcadas **proposta — decisão do dono**.

Testes de caracterização das regras que não tinham cobertura: `test/politica-ofertas-tests.js` (marcados "caracterização" abaixo). Se uma divergência for corrigida, o caso correspondente precisa mudar junto.

Superfícies: **site** (`index.html` + SSR `api/pagina.mjs`), **API v1** (`api/v1.mjs` → `api/_lib/read-db.mjs` / fallback `api/_lib/read-state.mjs`), **kit** (`api/_lib/kit.mjs`), **grupos** (Telegram/WhatsApp: `tools/social-telegram-piloto.mjs`, `src/agents/social/auto.js`).

## 1. Ordenação e ranking

| Regra | Onde | Teste |
|---|---|---|
| "Menor total comparável": frete conhecido (ou grátis) antes de desconhecido; depois total; depois desempate registrado (afiliado); depois id | `api/_lib/offer-rank.mjs:12-14,27` | `best-offer-server-tests.js`, `afiliado-desempate-tests.js` |
| Desempate de afiliado só em empate exato, registrável; módulo não lê config | `offer-rank.mjs:19-22`; registro em `api/v1.mjs:47` e `api/pagina.mjs:13` via `affiliates.mjs:93-97` | `afiliado-desempate-tests.js`, `affiliate-links-tests.js` |
| Página do produto (cliente): `OFFER_SORTS.price` = viva → frete conhecido → total → afiliado | `index.html:2403-2408` | `afiliado-desempate-tests.js` |
| Grade do servidor (`/api/v1/site/produtos`, Home): `byComparableTotal` (modo "abrir": por booster) | `api/_lib/site.mjs:47`, `api/_lib/home.mjs:18` | `best-offer-server-tests.js` |
| SSR do produto: tabela por `byComparableTotal`; título/`lowPrice` = menor preço visível (Lote D) | `api/pagina.mjs:114-121` | `seo-product-shipping-tests.js` |
| Opportunity Engine (JS): score → confiança → frete conhecido → custo total → preço → id | `src/core/opportunity-engine.js:233-234` | `opportunity-engine-tests.js` |
| Opportunity no banco (o que o site lê): view `product_opportunity` = score → confiança → **preço** → id | `db/migrations/008_opportunity_reference_comparison.sql:26`; `read-db.mjs:319` (filtro loja/max) | caracterização |
| `/api/v1/oportunidades?ordem=`: `OPP_SORTS` | `read-db.mjs:298-305` | `api-db-tests.js` (parcial) |
| API v1 `/produtos/:id/ofertas`: ativa → em estoque → **menor preço** → id (sem frete, sem afiliado) | `read-db.mjs:250`, `read-state.mjs:94` | caracterização |
| Kit, recomendação: melhor oferta por produto = critério do site (`bestComparable`) | `kit.mjs:36-40` | caracterização (frete conhecido vence mais barata) |
| Kit, cesta: cada item pelo **menor preço**; empate → critério do site (correção de 24/10) | `kit.mjs:109` | `kit-cesta-tests.js` (caso 6), `kit-afiliado-tests.js` |
| Grupos, seleção: elegíveis por menor total comparável, dedupe, limite 50 | `src/agents/social/elegiveis.js:98-113`, `tools/social-telegram-piloto.mjs:54` | `social-elegiveis-tests.js` |
| **Grupos, ordem de envio: afiliado primeiro** (exceção vigente, decisão do dono 17-18/10) | `social-telegram-piloto.mjs:64` (sort estável); `auto.js:44-47` (afiliada fura a fila, espaçada 20 min Telegram / 60 min WhatsApp; repete a cada 24 h; não afiliada sai 1 vez no Telegram, volta após 6 h no WhatsApp) | `social-telegram-auto-tests.js` (regras de tempo); caracterização (ordem de `candidatos()` e afiliada atrás na fila) |

## 2. Preço no Pix

- Escolha do preço: Pix > à vista > cartão > base (`src/score.js:21-25`); `price`, `priceKind`, `prices` (todos os valores) gravados na oferta (`src/run.js:400`). Teste: `score-tests.js`.
- Total = preço escolhido + frete **só se conhecido**; sem frete, `total = price` e `shippingKnown=false` (`src/run.js:395`).
- Site: selo "no Pix" (`index.html:1615,1631`), nota da tabela (`index.html:2487`), título/descrição SSR (`api/_seo.mjs:52`, `api/pagina.mjs:93`). Testes: `ux-confianca-tests.js`, `home-page-tests.js`, `seo-lote-*`.
- API v1: `price_kind` e `pix_price` (`read-state.mjs:97` = `prices.pix`; banco `read-db.mjs:235`). Caracterização (fallback); banco em `domain-model-tests.js`.
- JSON-LD: `Offer.price = total` e `lowPrice` = menor total visível; **não diz que é Pix** (`api/pagina.mjs:49,136`). Teste do valor: `seo-product-shipping-tests.js`; ausência de marcação Pix sem teste (não travada de propósito: `api/pagina.mjs` está em PR aberta #920).
- Grupos: o post usa `o.price` sem "no Pix" na `main` (`src/agents/social/legenda.js:47`). A PR #917 (aberta) adiciona "no Pix"; não travado aqui para não conflitar.

## 3. Disponibilidade

| Superfície | Aceita | Onde | Teste |
|---|---|---|---|
| Site / SSR / Home / API site | `IN_STOCK`, não `stale`, não `anomalous`, `total > 0`. **Não** olha `confirmed` nem idade da leitura | `site.mjs:12`, `index.html:1610`, `_seo.mjs:36`, `home.mjs:15` | caracterização |
| Nota (robô) | idem + `confirmed !== false` | `src/run.js:132` | `run-tests.js` |
| API v1 lista/preço "a partir de" | `live` + `confirmed !== false` | `read-state.mjs:21` | `api-tests.js` |
| Kit | `IN_STOCK`, não stale/anômala, preço > 0, URL; **não** olha `confirmed` nem idade | `kit.mjs:38,105` | `kit-recomendar-tests.js`; caracterização (confirmed/idade) |
| Grupos | `IN_STOCK`, ativa, não anômala, `confirmed !== false`, URL https, frescor **"atual"** (≤ 30 min) | `elegiveis.js:53-71`, limites `api/_lib/freshness.mjs:16` | `social-elegiveis-tests.js`; caracterização (comparação) |

- `stale`: leitura que falhou e foi copiada; sai de "viva" em todas as superfícies; na API v1 vira `status: 'pending'` e vai para o fim.
- Pré-venda (`PRE_ORDER`): fora de site, kit, grupos, nota e alertas; a API v1 lista como `stock: 'preorder'` (`read-state.mjs:11`). Doc: `docs/availability-preorder.md`. Teste: `availability-tests.js`; caracterização (três superfícies).
- Frescor máximo: atual ≤ 30 min, atrasado ≤ 90 min, desatualizado ≤ 24 h, depois indisponível (`freshness.mjs:16-30`). Só os grupos exigem "atual" por oferta; o site exibe o frescor, não filtra por ele. Teste: `freshness-tests.js`, `api-offer-freshness-tests.js`.

## 4. Frete desconhecido

- Nunca zero: `shippingKnown=false` → o total não disputa o menor total (`offer-rank.mjs:12-14`); API v1 `total_price: null`, `shipping.status: 'unknown'` (`read-state.mjs:98-99`, `read-db.mjs:236-237`); kit `frete: null`, `total: null` (`kit.mjs:48-55,95-96`); Opportunity `cost_basis: 'price_only'` (`opportunity-engine.js:209-212`); rascunho social `precoTotal: null` (`tools/social-preview.mjs:71`). Testes: `shipping-compare-tests.js`, `kit-cesta-tests.js`, `social-preview-tests.js`.
- Texto: "frete a calcular" / "Preço antes do frete" (`index.html:1741,2425`; `api/pagina.mjs:94`). Testes: `home-oportunidade-frete-tests.js`, `shipping-compare-tests.js`.
- Frete grátis só com fonte: (a) loja informou `shipping=0` com `shippingKnown=true`; (b) regra pública em `config/frete-gratis.json` (fonte + data de conferência por loja). No site (b) é só selo "Frete grátis acima de R$ X" (`index.html:1739-1741`), não muda total, nota nem ordem. No kit, (b) zera o frete do pedido quando o subtotal da loja passa do mínimo (`kit.mjs:50`, carregado em `api/v1.mjs:45`). Testes: `frete-gratis-tests.js` (sincronia FG × config), `kit-cesta-tests.js` (caso 4).

## 5. Comissão e divulgação

- Única fonte de afiliados: `config/affiliates.json` lido só por `api/_lib/affiliates.mjs` (ML por anúncio; Shopee por item em `config/afiliados/shopee.json`). Listas curadas `config/afiliados/amazon.json` e `shopee-ofertas.json` alimentam blocos próprios ("Também na Amazon"), nunca preço, ranking ou nota. Testes: `affiliate-isolation-tests.js`, `affiliate-links-tests.js`, `amazon-links-tests.js`, `shopee-ofertas-tests.js`.
- Site/API/kit: afiliado só desempata total **exatamente igual** (seção 1). Teste: `afiliado-desempate-tests.js`, `kit-afiliado-tests.js`.
- Divulgação geral no rodapé (Amazon Associados + "Em empate de preço, a oferta com o nosso link aparece primeiro…", `index.html:1485`) e Termos seção 4; sem selo junto do botão; `rel="nofollow sponsored"` invisível. Teste: `affiliate-disclosure-site-tests.js`.
- Grupos: post sem frase de afiliado (decisão #873, 24/10). Teste: `social-disclosure-tests.js`. Rascunhos editoriais (carrossel/comparador) mantêm a frase.

## 6. Divergências entre superfícies

| id | Divergência | Evidência | Classificação |
|---|---|---|---|
| D1 | `CLAUDE.md` ("Comissão nunca pode influenciar ranking ou recomendação"), comentário de `elegiveis.js:5` ("afiliado nunca entra na seleção nem na ordem"), rodapé e guia ("só desempata") × grupos, onde afiliado vai primeiro e repete a cada 24 h | `social-telegram-piloto.mjs:64`, `auto.js:45` | confirmado (código + caracterização). **Exceção vigente por decisão do dono (17-18/10); não reverter** |
| D2 | `byTot` do cliente (grade de /colecao e /tipo, `bestLive` dos alertas, `bestOfferFor`) ignora frete conhecido × desconhecido; produto, servidor e SSR seguem a #84 | `index.html:2054,2649-2650,3086` | **resolvida** na branch `proposta/ordenacao-frete` (byTot = shipCmp, depois total; igual ao produto e ao servidor) |
| D3 | API v1 `/produtos/:id/ofertas` ordena por preço, sem frete e sem desempate de afiliado; site ordena por menor total comparável | `read-db.mjs:250`, `read-state.mjs:94` | confirmado (caracterização) |
| D4 | Melhor oportunidade: view do banco desempata por preço; motor JS (eventos de transição) por frete conhecido e custo total. Comentário de `read-db.mjs` diz "mesma ordem de desempate" (vale só entre view e filtro) | `008_...sql:26`, `opportunity-engine.js:234` | confirmado no código; impacto real (empate de score e confiança) **hipótese** |
| D5 | Kit: recomendação escolhe frete conhecido mesmo mais caro; a cesta escolhe o menor preço | `kit.mjs:39` × `kit.mjs:109` | confirmado (caracterização) |
| D6 | Disponibilidade: grupos exigem `confirmed` e frescor ≤ 30 min; site e kit não olham nenhum dos dois (só `stale`) | seção 3 | confirmado (caracterização) |
| D7 | `config/frete-gratis.json` `_doc` diz "não muda total, nota nem ordem"; no kit zera o frete do pedido e muda o total e a comparação | `kit.mjs:50` | confirmado (código; coberto por `kit-cesta-tests.js`) |
| D8 | JSON-LD declara `Offer.price` = total (com frete quando conhecido; Pix sem marcação) | `api/pagina.mjs:49` | confirmado (código) |
| D9 | Grupos: seleção limitada às 50 elegíveis de menor total antes do "afiliado primeiro"; afiliada fora desse corte não entra | `social-telegram-piloto.mjs:54` | confirmado (código); efeito prático hipótese |

## 7. Recomendações (proposta — decisão do dono)

1. **D1** — atualizar `CLAUDE.md` e o comentário de `elegiveis.js:5` para registrar a exceção dos grupos (texto, sem mudar código), ou decidir reverter. Hoje as regras escritas contradizem o código vigente.
2. **D2** — trocar `byTot` do `index.html` por `shipCmp(a,b)||…` (igual a `OFFER_SORTS.price`), para a grade e os alertas usarem a #84. Depende da PR #920 (mesmo arquivo).
3. **D3** — decidir se a API v1 deve ordenar ofertas pelo menor total comparável (e com o desempate) ou manter "por preço" documentado em `docs/api-v1.md`.
4. **D4** — alinhar a view (migration nova) ao `oppOrder` ou o `oppOrder` à view; hoje eventos e site podem eleger ofertas diferentes no empate.
5. **D6** — avaliar exigir `confirmed !== false` no kit (a nota já exige) antes de habilitar recomendação real.
6. **D8** — avaliar `Offer.price` = preço do produto (frete em `shippingDetails` só com fonte) e marcar Pix como `priceSpecification`, conforme as diretrizes do Google.
