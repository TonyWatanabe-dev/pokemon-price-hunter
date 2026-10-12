# Auditoria de lacunas: API pública v1 (issue #292)

Escopo: `api/v1.mjs`, `api/_lib/` e testes da API. Só descreve o que existe no código da `main`.

## 1. Mapa
| Módulo | Função / trecho | Papel |
|---|---|---|
| `api/v1.mjs` | `route(segs, qs)` | Valida parâmetros e escolhe a rota (`HttpError` 400/404). `intIn`, `str`, `bool` normalizam entrada; `SLUG_RE` valida ids. |
| `api/v1.mjs` | `run(rt, source)` | Executa a rota no banco (`DB.*`) ou no state.json (`ST.*`); `paged()` monta `meta`. |
| `api/v1.mjs` | `handle()` / `handler()` | Método (GET/HEAD), cache em memória (`cache`, `MAX_CACHE=300`, `KEY_PARAMS`), frescor, fallback banco→state, prazo `DEADLINE_MS=12000` (503). |
| `api/_lib/read-db.mjs` | `listProducts`, `getProduct`, `productOffers`, `productHistory`, `productStats`, `listReferences`, `listOpportunities`, `opportunityStores`, `offerChanges` | Leituras no PostgreSQL. |
| `api/_lib/read-state.mjs` | `stateListProducts`, `stateGetProduct`, `stateProductOffers`, `stateProductHistory`, `stateProductStats`, `stateListReferences` | Mesmas leituras pelo state.json. |
| `api/_lib/site.mjs`, `stores.mjs`, `home.mjs` | `siteProducts`, `siteOffers`, `siteProduct`, `siteStores`, `slimHome` | Formato das páginas do site. |
| `api/_lib/freshness.mjs` | `classify`, `usable`, `attach`, `headers`, `dbDataAt` | Frescor (atual ≤30 min, atrasado ≤90, expira 24 h). |
| `api/_lib/legacy.mjs`, `catalog.mjs` | `legacyState`, `catalogState` | Carga e cache do state.json. |
| `api/_lib/affiliates.mjs` | `publicAffiliates`, `resolveOutbound` | Rota `/afiliados`. |
| `api/_lib/offer-change.mjs`, `offer-rank.mjs`, `references.mjs`, `db.mjs`, `ssl.mjs`, `search.mjs` | `classifyOfferChange`, `byComparableTotal`, `resolveCurrentReference`, `apiPool`, `pgConnectionConfig`, `sqlFold` | Regras de apoio. |

Rotas: `home`, `produtos`, `produtos/:id[/ofertas|historico|estatisticas]`, `referencias`, `oportunidades`, `oportunidades/lojas`, `site/{produtos,ofertas,lojas,produto/:id}`, `afiliados`.

## 2. Já coberto
- Home enxuta, sem campos internos, ≤150 KB: `test/api-tests.js` (parte A, `slimHome`).
- Paginação, limites, slug inválido (400), rota inexistente (404), POST (405), `busca` gigante, >60 ids, `pagina`/`limite` absurdos, parâmetros desconhecidos não enchem o cache: `test/api-tests.js` (linhas ~75–108).
- Prazo total → 503 com `Retry-After`: `test/api-tests.js` (~109).
- Validação de `/oportunidades` (faixa, ofertas, loja, max, ordem) e `requires_db` sem banco: `test/api-tests.js` (~126–131).
- Frescor, `stale_db`, 503 por dado expirado: `test/freshness-tests.js`.
- Campo `change` do feed, consulta em lote, falha da consulta extra: `test/opportunity-change-api-tests.js`.
- Afiliados: `test/affiliate-links-tests.js`, `test/outbound-links-tests.js`.
- Paridade banco × state.json, fallback com banco fora, vazamento de campos internos: `test/api-tests.js` parte B (exige `TEST_DATABASE_URL`; pulada sem ele, `process.exit(0)` na linha 165).

## 3. Lacunas atuais
**Alta**
- A parte B (banco) de `test/api-tests.js` termina o processo com `process.exit(0)` sem `TEST_DATABASE_URL`; nada após a linha 165 roda localmente e a cobertura de `read-db.mjs` depende só do CI com banco.
- Filtros numéricos de `/oportunidades` aceitam lixo em silêncio: `minimo`, `abaixo`, `confianca_minima` usam `intIn(...)` (`api/v1.mjs`, rota `oportunidades`), então `abaixo=abc` vira `0` e `minimo=12abc` vira `12` (`parseInt`), em vez de 400. Pode mostrar lista mais ampla que a pedida. Sem teste.
- `max` aceita formatos como `0x10` ou `1e3` (`Number(maxS)`), tratados como valor válido; sem teste.

**Média**
- Sem teste da rota `GET /api/v1/afiliados` pelo handler (`handle()` responde antes de `route`) nem de `HEAD`.
- `site/produtos` e `site/ofertas` sem teste de erro para `modo`, `ordem`, `grupo` e `max` inválidos (400 em `route`); só os casos felizes e >60 ids aparecem em `test/api-tests.js`.
- Chave de cache sensível a maiúsculas: `SLUG_RE` tem flag `i`, então `/produtos/ABC` e `/produtos/abc` geram entradas separadas (`key` em `handle()`).
- `fonte=state` é aceito de qualquer cliente e não faz parte de `KEY_PARAMS` (a chave usa `preferred`); fora dos testes de banco não há asserção do cabeçalho `X-Data-Source` para ele.

**Baixa**
- `historico`: `dias` fora de 1–365 é ajustado em silêncio (`intIn`), sem aviso em `meta`.
- Em `route`, `oportunidades` sem `ofertas` e parâmetros ignorados (ex.: `estoque` em `/referencias`) não geram erro.
- `X-Payload-Bytes` e `Allow` (405) sem teste explícito.

## 4. Tarefas propostas (pequenas e independentes)
1. **Rejeitar números inválidos em `/oportunidades`** — `api/v1.mjs`, `test/api-tests.js`. R1. Aceite: `minimo`, `abaixo`, `confianca_minima` não numéricos ou com sufixo respondem 400; valores válidos e ausentes mantêm o comportamento atual.
2. **Validar `max` estritamente** (decimal simples ≥ 0) em `oportunidades` e `site/produtos` — `api/v1.mjs`, `test/api-tests.js`. R1. Aceite: `0x10`, `1e3`, `Infinity` → 400; `12.5` → 200.
3. **Testes de borda das rotas `site/*`, `afiliados` e HEAD** — só `test/api-tests.js` (novo bloco). R0. Aceite: 400 para `modo/ordem/grupo/max` inválidos; `/afiliados` 200 com `Cache-Control`; `HEAD` não retorna 5xx; `Allow: GET, HEAD` no 405.
4. **Normalizar caixa na chave do cache** — `api/v1.mjs`, teste em `test/api-tests.js`. R1. Aceite: `/produtos/ABC` e `/produtos/abc` usam uma só entrada de `_cache` e retornam o mesmo corpo.
5. **Rodar a parte A de `api-tests` sem sair da parte B** — mover a parte de banco para `test/api-db-tests.js` (sem alterar `package.json` neste passo; verificar se o runner de `npm test` já varre `test/`). R0. Aceite: sem `TEST_DATABASE_URL` o arquivo novo imprime "pulado" e `npm test` continua verde, com as asserções idênticas às atuais.
