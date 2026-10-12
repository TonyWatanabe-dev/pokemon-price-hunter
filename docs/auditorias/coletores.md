# Auditoria de lacunas: coletores e contrato de ofertas (issue #290)

Escopo: `src/adapters/`, `src/run.js`, `src/core/offer-key.js`, `src/http.js` e os testes de coletores/contrato. Só descreve o que existe no código lido na `main` (c283216); lacunas marcadas "a confirmar" não foram reproduzidas em execução.

## 1. Mapa
| Módulo | Função principal |
|---|---|
| `src/adapters/index.js` | `adapters` (shopify, vtex, jsonld, mercadolivre); `detectPlatform(base)` |
| `src/adapters/common.js` | `guard(url)` (robots.txt → `BlockedError`), `brl()` (texto → preço), `findPix`, `searchTerms` |
| `src/adapters/contract.js` | `validateListing(listing, store, {now})`, `storeHosts`, `STOCK_VALUES`, `SOURCE_TYPES`, `PRICE_KEYS` |
| `src/adapters/shopify.js` | `search` (`/products.json` até `MAX_PAGES`=8 + coleções Pokémon), `toListing`, `httpHref` |
| `src/adapters/vtex.js` | `search` (catálogo público, só `sellerDefault`), `shipping` (simulação por CEP) |
| `src/adapters/jsonld.js` | `productUrls` (sitemap), `parseProductPage`, `search` (devolve `out.failed`/`failReasons`) |
| `src/adapters/mercadolivre.js` | `mlReject`, `search` (API oficial OAuth; busca e catálogo) |
| `src/adapters/parse-limits.js` | `parseLimits`, `jsonLdNodes`, `flattenLimited`, `clampTitle`, `extractLsVariants` |
| `src/core/offer-key.js` | `canonicalizeUrl`, `offerDedupeKey`, `groupDuplicateOffers` |
| `src/run.js` | `runOnce`: chama `adapters[platform].search`, depois `validateListing` por anúncio (linha ~215) |

## 2. O que já está coberto
| Comportamento | Teste |
|---|---|
| Estrutura comum, falha tipada (status/`blocked`), isolamento entre lojas, `search()` exposto | `test/adapter-contract-tests.js` |
| Regras do contrato: título, estoque, preço > 0, moeda BRL, host do link, `sourceType`, timestamp | `test/listing-contract-tests.js` |
| Contrato ligado à rodada: anúncio inválido não vira oferta; oferta existente vira stale, não removida | `test/listing-contract-run-tests.js` |
| Shopify (paginação, coleções, parcial) e VTEX (vendedor padrão, preço, frete) | `test/adapters-shopify-vtex-tests.js` |
| Falha passageira de página JSON-LD preserva a oferta | `test/jsonld-recovery-tests.js`, `test/collectors-tests.js` |
| Fluxo do catálogo do Mercado Livre | `test/ml-tests.js` |
| Mercado Livre: estoque pelo catálogo (`catalogStock`), 403 em `/items` e oferta no `bestDeals` | `test/ml-estoque-tests.js` (ver `docs/mercadolivre-api.md`) |
| Chave de deduplicação e URL canônica | `test/offer-key-tests.js` |
| Limites de parsing (`parse-limits.js`) | `test/parse-limits-tests.js` |

## 3. Lacunas atuais
**Alta**
- **Limites de parsing não estão ligados ao coletor.** Nenhum arquivo de `src/` importa `parse-limits.js` (grep por "parse-limits" só acha o próprio módulo). `jsonld.js` faz `JSON.parse(raw)` direto (linhas ~53 e ~111) e extrai blocos com regex própria, sem tamanho/profundidade máximos. A issue #106 tem teste do módulo, mas o caminho real de produção não o usa.
- **VTEX pode publicar título com "undefined".** `vtex.js`: `title: p.productName + (p.items.length > 1 ? ' ' + it.name : '')`. Se `it.name` faltar, o título vira "… undefined". O contrato (`validateListing`) só rejeita título que seja exatamente `undefined`/`null`, então passa. Os testes usam sempre `name` preenchido (`vtItem`). A confirmar.

**Média**
- **`groupDuplicateOffers`/`offerDedupeKey` não são usados em `src/`** (só `canonicalizeUrl`, por `src/url-quality.js`). A deduplicação de ofertas existe e tem teste, mas não participa da coleta nem da rodada.
- **Mercado Livre, caminho 1 (busca)**: monta o anúncio com `price: { base: r.price }` sem passar por `mlReject` (usado só nas linhas ~80 e ~108, no catálogo). Kits e lotes na busca dependem só do filtro a jusante. A confirmar.
- **Contrato não confere coerência entre campos**: `listPrice` menor que o preço, `price.pix` maior que `base`, e `stock: IN_STOCK` com `quantity: 0` passam (`contract.js` valida cada campo isolado).
- **`brl()` com milhar sem decimais é ambíguo**: `MONEY_THOUSANDS` trata "1.500" como 1500; "1.50" cai em `MONEY_INTL`. Sem teste de preço em formato misto no JSON-LD (a confirmar em `common.js`).

**Baixa**
- `shopify.js` `httpHref` descarta a query do link (`split('?')[0]`); links de variante dependem de `?variant=` adicionado depois.
- `contract.js` aceita `image` de qualquer host; só exige http(s).
- `vtex.shipping` assume `logisticsInfo[0]`; só o primeiro item é lido (sempre 1 item hoje).

## 4. Tarefas propostas (pequenas e independentes)
1. **Usar `parseLimits` no JSON-LD** (R1). Arquivos: `src/adapters/jsonld.js`, `test/jsonld-recovery-tests.js`. Aceite: página com JSON-LD acima do limite é descartada sem exceção; teste novo falha antes e passa depois.
2. **Título VTEX sem `it.name`** (R0/R1). Arquivos: `src/adapters/vtex.js`, `test/adapters-shopify-vtex-tests.js`. Aceite: SKU múltiplo sem `name` gera título só com `productName`, nunca contém "undefined".
3. **Coerência entre campos no contrato** (R1). Arquivos: `src/adapters/contract.js`, `test/listing-contract-tests.js`. Aceite: `IN_STOCK` com `quantity: 0` e `pix > base` são rejeitados com motivo; anúncios válidos existentes continuam passando.
4. **`mlReject` na busca do Mercado Livre** (R1). Arquivos: `src/adapters/mercadolivre.js`, `test/ml-tests.js`. Aceite: resultado da busca com "kit"/"lote" não vira anúncio.
5. **Decidir o destino de `groupDuplicateOffers`** (R0, só proposta). Arquivos: `src/core/offer-key.js`, `test/offer-key-tests.js`. Aceite: documento ou teste de integração mostrando onde a chave de deduplicação é aplicada na rodada.

## 5. Diagnóstico de bloqueio (Frente 6, 2026-10-12)

**Política de honestidade (inalterada e reafirmada).** O coletor se identifica (`User-Agent: PokeHunterBR/1.0 …`), lê e respeita o `robots.txt`, espera 1,5 s por domínio e obedece `Retry-After`. Ele **não** contorna WAF, CAPTCHA ou desafio anti-robô, **não** troca de User-Agent para parecer navegador, **não** usa proxies nem IPs rotativos e **não** repete indefinidamente quem respondeu 403/429. Loja que barra o agente honesto fica como `BLOCKED` e só volta pelo backoff (`src/run.js`, `backoffMs`) ou por liberação explícita do lojista. Esta frente acrescenta **observabilidade**, não insistência.

**O que passou a ser registrado em `data/sources.json`, por loja.**
- `lastFailure` (`src/diagnostico.js` → `forensicsOf`, anexado pelo `src/http.js` em todo erro HTTP/rede e carregado pelo `robots.js`/`guard()`): `{ at, status, errorCode, elapsedMs, server, cfRay, via, waf, setCookieNames, bodyHead }`. `cfRay` guarda só os 8 primeiros caracteres (presença), `setCookieNames` só os **nomes** dos cookies, `bodyHead` os 300 primeiros caracteres de texto sem script/style. Nunca valor de cookie, query, token ou corpo inteiro; poucas centenas de bytes por loja.
- `waf` (`wafOf`): `cloudflare | akamai | datadome | perimeterx | imperva | sucuri | aws-waf | generic-403 | timeout | dns | tls | unknown`, a partir de cabeçalhos (`server`, `cf-ray`, `x-datadome-*`, `x-px*`, `x-iinfo`, `x-amzn-waf-action`…), nomes de cookie (`datadome`, `_px*`, `visid_incap*`, `ak_bmsc`, `aws-waf-token`) e marcadores do corpo (`cf-chl`, `captcha-delivery`, `incapsula`…).
- `platformHint` (`platformHintOf`, anotado em respostas boas e gravado após a coleta): `vtex | shopify | nuvemshop | tray | lojaintegrada | woocommerce | magento`.

**Relatório.** `node tools/coleta-relatorio.mjs [data/sources.json] [--json]` imprime a tabela (loja, plataforma, status, última falha, anúncios/casados) agrupada por `waf`. Sem rede.

**Limpeza do inventário (mesma data).** Domínios mortos (ENOTFOUND em todas as rodadas), TLS quebrado no servidor, entradas `PENDING` duplicadas e loja fora do escopo (catálogo em inglês) saíram de `config/stores.json` e das listas `config/lojas/*.txt` para `config/lojas/removidas.txt` (só comentários, com data, motivo e evidência; a coleta ignora o arquivo).

**Filtro do sitemap (`src/adapters/jsonld.js`, `isProductCandidate`).** Além de "URL com `pokemon` + indício de lacrado", aceita link de produto (`/produtos/`, `/produto/`, `/product/`, `/products/`, `/p/`) cujo slug tem `pokemon|tcg|booster|blister|etb|elite-trainer|treinador|lata|tin|box|deck|colecao|coleção|bundle` (palavras inteiras, sem acento). Quem decide se é Pokémon/Copag continua sendo `src/match.js`; o teto de 25 páginas novas por rodada não mudou.

**tcgculture.com (Shopify, 8779 anúncios lidos, 0 casados).** Não é falha do coletor: os títulos são produto em inglês ("Scarlet & Violet", "Obsidian Flames", "Mini Tin") e cartas avulsas com condição TCGplayer ("Near Mint", "Lightly Played"); o catálogo é Copag PT-BR, então o matching recusa tudo (`coleção não identificada`). Retirada para `removidas.txt` (fora do escopo; ~16 requisições por rodada sem retorno). Moeda não confirmada: a rede estava indisponível na análise.
