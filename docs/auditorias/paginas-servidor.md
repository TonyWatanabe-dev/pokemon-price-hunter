# Auditoria de lacunas: páginas renderizadas no servidor (SSR) e sitemap (issue #476)

Escopo: `api/pagina.mjs`, `api/sitemap.mjs`, `api/_lib/guia.mjs` (com `api/_seo.mjs` e `vercel.json`, de que dependem) e os testes de SEO/SSR. Só lacunas técnicas (dados errados, 5xx, cache, escape); nada de proposta de conteúdo. Não repete `seguranca.md`: o SSRF de `pickFetchHost` e a falta da guarda de URL nos fetches de `_seo.mjs` e `pagina.mjs` já estão registrados lá.

## 1. Mapa
| Arquivo | Trecho | Papel |
|---|---|---|
| `vercel.json` | `rewrites` `/produto/:slug`, `/colecao/:slug`, `/tipo/:slug`, `/lojas`, `/guia/glossario`… → `/api/pagina?t=…&slug=:slug`; `/sitemap.xml` → `/api/sitemap` | Rotas públicas. `functions["api/pagina.mjs"].includeFiles` leva `index.html` e `config/stores.json`; sem `maxDuration` (só `api/v1.mjs` tem 15 s). |
| `api/pagina.mjs` | `handler` (l.231–277) | `t`/`slug` da query, casca HTML (`readLocal` → `fetch https://${host}/app.html` → 302 `/app.html`), frescor, `build`, troca de `<title>`, metas, canonical, JSON-LD e `<div id="view">`. |
| `api/pagina.mjs` | `build(t, slug, s, opp, lojas)` (l.82–218) | Monta `{ title, desc, url, json, body, img?, noindex? }` para `produto`, `colecao`, `tipo` (+ `/tipo/blister`), `lojas` e as fixas em `STATIC`. Devolve `null` → 404 + `noindex`. |
| `api/pagina.mjs` | `fitDesc`, `ld`, `crumbs`, `bc`, `prodRow`, `lojaRow`, `extA`, `shipTag`, `ldOffer` | Descrição ≤160, JSON-LD (`<` → `<`), trilha, linhas de lista e links externos `nofollow noopener`. |
| `api/pagina.mjs` | `catch {}` (l.268–272) e `cache-control` (l.275) | Sem dados em dia: casca sem SSR; fora da Home, `noindex` sem canonical. O mesmo `s-maxage=600, stale-while-revalidate=3600` vale para 200, 404 e casca sem dados. |
| `api/_seo.mjs` | `state()` (l.18–22), `slugs`, `bestBy`, `live`, `esc`, `brl`, `pix` | Lê `state.json` do GitHub raw (cache de 10 min no módulo, sem prazo de rede), slugs e melhor oferta (#84). |
| `api/sitemap.mjs` | `handler` (l.4–31) | Páginas fixas + coleções, formatos, `/tipo/blister` e produtos com estoque, `lastmod` por produto. Dados velhos ou erro: só as fixas. `s-maxage=3600`. |
| `api/_lib/guia.mjs` | `GUIA`, `guiaHTML`, `faqHTML`, `glossarioHTML`, `faqLD`, `glossarioLD`, `slugT`, `plain` | Guia/FAQ/glossário como fragmentos HTML confiáveis (sem dado externo) e JSON-LD. |

## 2. Já coberto
- Melhor oferta e regra de frete (#84/Lote D): título, descrição, og:, `AggregateOffer.lowPrice`, nada de `shippingDetails`, produto sem estoque com `noindex` e sem `offers`: `test/seo-product-shipping-tests.js`.
- `/oportunidades` sem banco (lista do state.json), `/precos` com fonte e data, título/canonical/descrição de `/termos` e `/privacidade`, descrições ≤160, `lastmod` no sitemap, pré-venda fora do sitemap, `X-Robots-Tag` em `vercel.json`: `test/seo-lote-c-tests.js`.
- `/como-funciona` (FAQPage = h3), `/tipo/blister` (200 e 404 sem blister, no sitemap ou fora dele), `/guia/glossario` (DefinedTermSet, âncoras): `test/seo-lote-e-tests.js`.
- Guia do site idêntico ao módulo, contagens de h2/h3/dt e `slugT`: `test/guia-sync-tests.js`.
- `/lojas` (seções, ItemList, contagens), "Procurar em outras lojas", `/lojas` no sitemap, `includeFiles`, `/lojas` com dados velhos = sem SSR + `noindex`: `test/lojas-page-tests.js`.
- Dados velhos ou `generatedAt` inválido: sem preço no HTML (teste 11); fora da Home sem canonical e com `noindex` (teste 12): `test/freshness-tests.js`.
- `pickFetchHost` (Host forjado): `test/urlguard-tests.js`; um único `fetch` em `pagina.mjs`: `test/fetch-allowlist-tests.js`.
- `/produtos` fora do sitemap: `test/opportunities-page-tests.js`; sem "tempo real" em `pagina.mjs`: `test/ux-confianca-tests.js`.

## 3. Lacunas atuais

**Alta**
1. **Padrões `$` do `String.replace` corrompem a página.** `handler` (l.255–264) usa `html.replace(alvo, \`…${m.body}…\`)` com texto vindo de dados. `esc` não neutraliza `$` (e `$&` vira `$&amp;`, que ainda começa por `$&`), e `JSON.stringify` em `ld` também não. Nome de loja ou de vendedor (`o.seller`, lido de marketplace) com `$&`, `` $` ``, `$'` ou `$$` insere o trecho casado, o documento anterior ou o posterior. Reproduzido aqui com `storeName: 'Loja $& X'` e `seller: 'Vend $\` Y'`: resposta 200 com **dois** `<!doctype>` e ~777 KB, e o nome da loja não aparece. No JSON-LD, `` $` ``/`$'` dentro de `<script>` também copiaria HTML para o script. Sem teste.
2. **Slug com `%` dá 5xx.** `handler` l.232: `decodeURIComponent(q.get('slug') || '')` roda **fora** do `try`, e `URLSearchParams` já decodificou. `/produto/%25` (slug `%`) ou `/produto/100%25` lança `URIError: URI malformed` (reproduzido); a função cai com 500 em vez de 404. Sem teste.

**Média**
3. **Cache da CDN igual para página boa, 404 e página sem dados.** l.275 aplica `s-maxage=600, stale-while-revalidate=3600` em tudo. 404 de slug que acabou de entrar no catálogo e casca `noindex` (dados velhos) podem ficar até ~70 min na CDN; o inverso também: HTML com preço segue servido até ~70 min depois de os dados ficarem velhos. A API usa `no-store` nesses casos (`test/freshness-tests.js` l.60); as páginas não. Verificado: 404 sai com `s-maxage=600`. Sem teste de cabeçalho nas páginas.
4. **Erro de programação vira "dados velhos" em silêncio.** O `catch {}` de l.268 engole qualquer exceção de `build` (ex.: `rc.percentage_below.toFixed` em l.188 com valor não numérico vindo do banco) e responde 200 sem SSR — fora da Home, `noindex` — sem `console.error`. O sitemap faz o mesmo (l.27). Nenhum log distingue erro de dado velho.
5. **Sitemap encolhe e fica 1 h em cache quando o state.json falha.** `state()` (`_seo.mjs` l.20) lança com `!r.ok` (ex.: 429/5xx do GitHub raw) e não usa o último cache bom; o sitemap cai para as 9 fixas com `lastmod` = hoje (l.6) e `s-maxage=3600` (l.29). Coleções, formatos e produtos somem do mapa durante esse tempo. Sem teste de falha de rede.
6. **Sem prazo nos fetches.** `state()`, `loadSources` (`api/_lib/lojas.mjs` l.161) e o `fetch` de `app.html` (l.237) não têm `AbortSignal.timeout`, e `api/pagina.mjs`/`api/sitemap.mjs` não têm `maxDuration` em `vercel.json`. Rede lenta segura a função até o limite da plataforma (504) em vez de cair no caminho sem dados.

**Baixa**
7. **`/lojas` vazia e indexável.** Se `lojasFromState` lançar (l.250, `catch { lojas = []; }`), `lojasPage([])` responde 200, com canonical e sem `noindex`, dizendo "0 monitoradas agora". Sem teste.
8. **Cache da casca HTML sem validade.** `page.t` é gravado (l.235/237) e nunca lido; casca obtida por `fetch` de `app.html` vale por toda a vida da instância. Só afeta quando `index.html` não vem no pacote.
9. **`og:image`/`Product.image` sem validação.** l.114 usa `b0?.image || p.image` como vier da loja (pode ser `http://` ou relativo); só passa por `esc`.

## 4. Tarefas propostas (pequenas e independentes, sem `index.html`)
1. **Substituição literal no `handler`** — `api/pagina.mjs` (usar função de substituição, `() => texto`, nas chamadas de l.255–264) + `test/paginas-servidor-escape-tests.js`. R1. Aceite: com `storeName`/`seller` contendo `$&`, `` $` ``, `$'` e `$$`, a página tem um só `<!doctype>`, um só `<div id="view">`, o nome aparece escapado no HTML e intacto no JSON-LD (que segue válido por `JSON.parse`).
2. **Slug malformado responde 404** — `api/pagina.mjs` (tirar o `decodeURIComponent` duplo ou protegê-lo) + teste no mesmo arquivo novo. R1. Aceite: `t=produto&slug=%25` e `slug=100%25` → 404 com `noindex`; slugs com acento já decodificados continuam abrindo a mesma página de hoje.
3. **Cache por tipo de resposta nas páginas** — `api/pagina.mjs` + `test/paginas-servidor-cache-tests.js`. R1. Aceite: 200 com SSR mantém o cabeçalho atual; 404 e casca sem dados (catch) saem com `s-maxage` curto ou `no-store`; teste confere os três cabeçalhos.
4. **Log de erro inesperado no SSR e no sitemap** — `api/pagina.mjs`, `api/sitemap.mjs` + teste. R0. Aceite: exceção dentro de `build` gera um `console.error` com rota e mensagem (sem URL de fonte nem segredo); "dados desatualizados" não gera log de erro; resposta e status iguais aos de hoje.
5. **Sitemap usa o último state bom** — `api/_seo.mjs` (`state()` devolve `cache.s` se o fetch falhar e ele ainda estiver dentro do frescor) + `test/sitemap-falha-tests.js`. R1. Aceite: primeiro fetch ok e segundo 503 → o sitemap segue com coleções e produtos; sem cache, só as fixas, como hoje.
6. **Prazo nos fetches do SSR** — `api/_seo.mjs`, `api/_lib/lojas.mjs`, `api/pagina.mjs` (`AbortSignal.timeout`) + teste com fetch que nunca responde. R1. Aceite: a função responde dentro do prazo, com casca sem SSR (`noindex` fora da Home) ou sitemap só com as fixas; caminho feliz inalterado.
