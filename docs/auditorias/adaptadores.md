# Auditoria de lacunas: adaptadores Shopify, VTEX e JSON-LD em profundidade (issue #472)

Escopo: `src/adapters/{shopify,vtex,jsonld,contract,parse-limits}.js` e os testes de adaptadores, lidos na `main` (fee68d0). Complementa `docs/auditorias/coletores.md` (#290) sem repeti-la. Lacunas "a confirmar" não foram reproduzidas em execução.

**Mudou desde a #290** (não são mais lacunas): `jsonld.js` já usa `jsonLdNodes` (import na linha 5, uso na ~121); o título VTEX já ignora `it.name` não textual (`skuName`, `vtex.js` ~179, teste em `adapters-shopify-vtex-tests.js` ~222); o contrato já checa `pix > base` e `IN_STOCK` com `quantity` 0 (`contract.js` ~79 e ~105).

## 1. Mapa
| Arquivo | Trecho |
|---|---|
| `shopify.js` | `detect` (`/products.json?limit=1`); `toListing`; `search`: `MAX_PAGES=8` × `PAGE=250`, `pokemonish`, `pokemonCollections`/`readCollections` (teto `MAX_EXTRA_REQUESTS=6`), `r.partial`; fallback `/search/suggest.json` |
| `vtex.js` | `detect` (`ft=pokemon&_from=0&_to=0`); `search`: um termo por requisição `_from=0&_to=49`, filtro `sellerDefault`; `shipping` (simulação, `/100`) |
| `jsonld.js` | `isProductCandidate`, `productUrls` (sitemap, até 15 mapas), `nuvemshop`, `microdata`, `pixNear`, `visiblePrice`, `parseProductPage`, `transientPageError`, `search` (`out.failed`/`failReasons`) |
| `contract.js` | `validateListing`: preço, moeda, estoque, `quantity`, pix ≤ base |

## 2. O que já está coberto
| Comportamento | Teste |
|---|---|
| Shopify: paginação, coleções Pokémon, leitura parcial; VTEX: vendedor padrão, preço, SKU sem nome, frete | `test/adapters-shopify-vtex-tests.js` |
| `parseProductPage`: Product próprio × vitrine, Nuvemshop (`LS.variants`), Loja Integrada, Woo, preço oculto → `null` | `test/run-tests.js` (~188–222) |
| `isProductCandidate`, `productUrls` com sitemap | `test/coleta-diagnostico-tests.js` (~126–142) |
| Falha passageira de página preserva oferta | `test/jsonld-recovery-tests.js` |
| Tetos de parsing do JSON-LD | `test/parse-limits-tests.js` |
| Contrato e disponibilidade | `test/listing-contract-tests.js`, `test/availability-tests.js` |
| `detect` existe como função | `test/adapter-contract-tests.js` (~96, só `typeof`) |

## 3. Lacunas priorizadas
**Alta**
- **VTEX sem paginação nem marca de parcial.** `vtex.js` ~165 pede só `_from=0&_to=49` por termo; resposta com 50 itens não pede a seguinte e não registra `partial` (o Shopify registra, `shopify.js` ~143). Produtos além do 50º somem sem sinal. Nenhum teste usa `_from` (grep em `test/adapters-shopify-vtex-tests.js`).
- **JSON-LD aceita oferta em moeda não BRL.** `jsonld.js` ~149: `offers.find(... (x.priceCurrency || 'BRL') === 'BRL') || offers[0]`. Se só existir oferta em USD, usa `offers[0].price` e o anúncio não leva `currency`, então `validateListing` não detecta. A confirmar; sem teste com moeda estrangeira.

**Média**
- **`quantity` do JSON-LD sem validação.** `jsonld.js` ~155: `Number(o.inventoryLevel.value)` pode dar `NaN`/negativo; o contrato (~104) rejeita o anúncio inteiro por causa disso, em vez de descartar só a quantidade. A confirmar.
- **`detect` sem teste de comportamento** nos três adaptadores (429 sobe, 401/403 vira `false`, formato inesperado). Só há `typeof` (`adapter-contract-tests.js` ~96).
- **`listPrice` nunca preenchido no ramo JSON-LD** (`jsonld.js` ~144 inicia `null` e só a Nuvemshop atribui): desconto "de/por" some nas lojas JSON-LD. Sem teste.

**Baixa**
- Extração de `LS.variants` depende de `\]);\s*\n` (`jsonld.js` ~61); fim de linha diferente descarta a página. A confirmar.
- `productUrls` percorre mapas em ordem de chegada, sem priorização (`jsonld.js` ~30).

## 4. Tarefas pequenas e independentes (sem `index.html`)
1. **VTEX: paginar além de 50** — `src/adapters/vtex.js`, `test/vtex-paginacao-tests.js`. Risco R1. Aceite: mock com 120 itens retorna os 120; teto de páginas atingido define `partial` com motivo.
2. **JSON-LD: rejeitar moeda não BRL** — `src/adapters/jsonld.js`, `test/jsonld-moeda-tests.js`. Risco R1. Aceite: página só com `priceCurrency: USD` devolve `null`; BRL e ausência de moeda seguem iguais.
3. **JSON-LD: `quantity` inválida vira `null`** — `src/adapters/jsonld.js`, `test/jsonld-quantidade-tests.js`. Risco R0/R1. Aceite: `inventoryLevel` `"abc"` ou `-1` mantém o anúncio com `quantity: null`.
4. **Testes de `detect`** — `test/adapters-detect-tests.js` (sem mudar `src/`). Risco R0. Aceite: 429 relança; 401/403 e HTML retornam `false`; JSON válido retorna `true`, nos três adaptadores.
5. **JSON-LD: `listPrice` por `priceSpecification` de referência** — `src/adapters/jsonld.js`, `test/jsonld-listprice-tests.js`. Risco R1. Aceite: preço "de" maior que o base é preenchido; igual ou menor fica `null`.
