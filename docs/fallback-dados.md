# Fallback de dados do site (D4)

Como o navegador escolhe de onde vêm os preços e o que acontece quando a fonte principal falha.
Nenhum limite novo: tudo usa `LIMITS` de `api/_lib/freshness.mjs` (30 min, 90 min, 24 h), já documentados em
`docs/frescor.md` (regras 3 e 4).

## Fontes, na ordem

| # | Fonte | Quem usa | Horário que prova o frescor | Barreira de idade |
|---|---|---|---|---|
| 1 | `/api/v1/home` e `/api/v1/site/*` (banco; fallback `state.json` via `api/_lib/legacy.mjs`) | `fetchHome`, `apiGet` (`index.html`) | `freshness.dataAt` (banco: `max(last_seen_at)`; `state.json`: `dataAt`) | servidor: mais de 24 h ou sem horário = 503 (`api/v1.mjs`); cliente: `fetchHome` também recusa `indisponivel` |
| 2 | raw do ramo `data` (`data/state.json`) | `fetchState` → `fetchData` | `dataAt`; só sem o campo, `generatedAt` (#621) | cliente: `stateOk` |
| 3 | raw da `main` (`data/state.json` versionado, congelado em 07/10/2026 13:45 UTC) | idem | idem | cliente: `stateOk` |
| 4 | `/data/state.json` do deploy (o `npm run build` copia o arquivo da `main` para `public/data/`) | idem | idem | cliente: `stateOk` |
| — | SSR (`api/pagina.mjs` via `api/_seo.mjs`) | HTML inicial | `stateDataAt` do raw do ramo `data` | preço no HTML só até 90 min (`usable`); senão a página sai sem preço (e `noindex`, menos na Home) |
| — | Service worker / Cache API | — | — | não existem (`docs/pwa-conectividade.md`) |
| — | Histórico (`hist/*.json`) | `loadHist` → `fetchData` sem filtro | — | sem barreira: é histórico, não preço atual |

## Regra (`index.html`, `stateOk`)

Um `state.json` só vira dado se tiver `products` e `offers` (listas) e se `freshState` não der `indisponivel`, isto é:
horário válido, não mais de 5 min no futuro e com até 24 h (`FRESH_LIM.expira` = `LIMITS.EXPIRA_MIN`). Fonte recusada
é pulada como se tivesse falhado. Sem nenhuma fonte válida, o site mostra o estado de erro que já existia
("Não conseguimos carregar os preços agora" + "Tentar de novo"), nunca a cópia antiga.

- **Relógio de referência (rodada 2, R1):** a idade é medida contra o relógio do servidor que respondeu, nunca o do
  aparelho (`srvNow`): cabeçalho `Date` (mesma origem: `/data/`) ou, no raw do GitHub, `Expires − max-age` (o CORS do
  raw não expõe `Date`; `Expires` e `Cache-Control` são cabeçalhos liberados). Sem essa referência, o arquivo é tratado
  como sem horário confiável. Tolerância: a mesma do `classify` (até 5 min no futuro), sem margem nova. O `/api/v1/home`
  é aceito pelo `freshness.status` que o servidor mandou (`api/v1.mjs` já classifica com o próprio relógio).
- **Páginas da conta (rodada 2, R2):** se só o `state.json` falha com a Home vinda da API, conta, favoritos, alertas e
  configurações continuam na tela (`ensureFull` não as troca pelo estado de erro).
- `dataAt: null` = nenhuma leitura real = não recente, mesmo com `generatedAt` novo (`docs/frescor.md`, lacuna 4).
- Entre 90 min e 24 h o dado continua aceito e a barra continua neutra ("Ao vivo"): decisão do dono de 17/10/2026,
  coberta por `test/freshness-tests.js` (teste 4). Cada oferta segue com a própria data de leitura.
- Recuperação: nada é guardado da falha; o próximo `load()`/`refresh()` (botão, "Tentar de novo", volta para a aba)
  tenta as fontes de novo na ordem.

## O que o snapshot velho afetava (antes da correção)

Com API fora (503) e raw do ramo `data` indisponível, o site usava a cópia de 07/10 como dado atual: preço e menor preço
com estoque, disponibilidade ("com estoque"), notas e selos calculados no cliente, pré-vendas, pistas, contadores da Home,
alerta criado ("já tem loja nesse preço"), tudo sob "Ao vivo". Reproduzido em `frentes/T4-E.md` (me05-etb "R$ 388,00 …
Atualizado há 20 d") e coberto agora por `test/d4-fallback-browser.mjs`.

## Testes

- `test/d4-fallback-tests.js` (no `npm test`): trechos reais de `index.html` com fetch falso — ordem das fontes, cópia
  congelada recusada, limites 1440/1441 iguais ao `classify` da API, sem horário, JSON inválido/parcial, recuperação,
  histórico sem filtro e `fetchHome`.
- `test/d4-fallback-browser.mjs` (Playwright, fora do `npm test`): handlers reais (`api/pagina.mjs`, `api/v1.mjs`) e rotas
  interceptadas, 390 px e 1280 px, 17 cenários (inclui relógio do aparelho −30 min, +2 dias e 07/10, e páginas da conta). `D4_INDEX=<arquivo>` roda contra outro `index.html` (ex.: o da `main`).

## Pendências (fora do escopo desta correção)

- Excluir a cópia do deploy: tirar `cp data/state.json public/data/` do `build` (`package.json`). Mudança de build/deploy
  (R3): só como proposta.
- Aba aberta por mais de 24 h sem conseguir atualizar continua mostrando "Ao vivo" (decisão de 17/10). Mudar o texto da
  barra para o caso `indisponivel` exige aprovação do dono.

## D4b — o state.json do robô dentro da API (`api/_lib/legacy.mjs`)

`legacyState` lê o raw do ramo `data` e, se ele falha, o raw da `main` (a cópia congelada de 07/10). O módulo só
transporta; a idade é conferida em quem consome, sempre com `classify(stateDataAt(st))` e o limite que já existe
(`LIMITS.EXPIRA_MIN`, 24 h):

| Consumidor | Com o state.json vencido, sem horário ou ausente |
|---|---|
| Gate final do `api/v1.mjs` (fonte `state`) | 503 com `freshness.status = indisponivel` (já existia) |
| `catalogState('db')` (`api/_lib/catalog.mjs`, `legacyOverlay`): Home, `/site/*`, kit, lojas | preços, estoque, frete e nota continuam do banco, com o frescor do banco; os campos que só o robô tem saem nulos/vazios: menor preço já visto, média de mercado, histórico, primeira aparição, pistas, reputação, atividade, distrust, cobertura/totais, nota das lojas (`score`), validação da loja (`false`, o padrão de quando não há dado), lançamento de pré-venda. Fica só identidade e ordem (ids, tipos, nome/URL das lojas). O estado ganha `robotData: 'indisponivel'`. Sem state.json nenhum, o banco em dia segue servindo (antes, a falha do legado derrubava a resposta) |
| `/api/v1/frete` e `/frete/estado` | 503 `no-store`, sem cotação (oferta, item e vendedor vêm do state.json); nunca frete zero |

### Caches (nenhum segura dado vencido como atual)

| Cache | Regra | Pior caso |
|---|---|---|
| Memória do `api/v1.mjs` | TTL 60–120 s pelo relógio de frescor; resposta não utilizável fica 15 s e sai `no-store` | dado reclassificado a cada pedido fora do TTL |
| CDN (`api/v1.mjs`) | `s-maxage`/`stale-while-revalidate` só com frescor `atual`/`atrasado`; desatualizado, fallback e 5xx = `no-store` | 90 min + 60 s + 300 s (home/site) ou + 120 s + 600 s (demais): sempre ≪ 24 h |
| CDN do SSR (`api/pagina.mjs`) | `s-maxage=600, stale-while-revalidate=3600` só quando o HTML leva preço (state ≤ 90 min); sem preço, 30 s | 90 min + 70 min = 160 min ≪ 24 h |
| Memória do `_seo` (10 min) | cada página reclassifica o state em cache; na falha do raw, só usa a cópia se ainda `usable` | state vencido em cache = página sem preço (e sitemap só com as fixas) |
| `legacy.mjs` ("cópia antiga") | usado na falha da fonte | gate final (503) e `legacyOverlay` (campos omitidos) reclassificam |
| `catalog.mjs` (60 s) | cache curto por fonte | 60 s |

### Outros consumidores da cópia de 07/10 ou do raw da main

- Sitemap (`api/sitemap.mjs`): só o raw do ramo `data` via `_seo.state()`, com `usable`; vencido = só as páginas fixas.
- `og:image`: imagem do produto no SSR, que só monta com state `usable`; não é preço.
- Kit (`/api/v1/site/kit*`): vem de `catalogState`, coberto acima.
- Social (Top 3/10): ranking de `/api/v1/oportunidades` (só banco). Os demais workflows sociais passam `--state` do checkout
  do ramo `data` (`ref: data`) e filtram cada oferta pelo frescor (`elegiveis.js`). O padrão `data/state.json` de
  `tools/social-preview.mjs` só vale rodando local.
- `src/server.js` e `tools/local-server.mjs`: servidores locais de desenvolvimento.

Testes: `test/d4b-legacy-tests.js` (handlers reais `api/v1.mjs`, `api/pagina.mjs`, `api/sitemap.mjs`, banco simulado):
campos do robô omitidos com a cópia de 07/10, vencido, sem horário e ausente, e mantidos em dia; limite 1440/1441; frete
503; caches; SSR × API do mesmo produto (recente com o mesmo menor preço; 2 h: SSR sem preço e API marcada
`desatualizado`; 25 h: SSR sem preço e API 503); sitemap.
