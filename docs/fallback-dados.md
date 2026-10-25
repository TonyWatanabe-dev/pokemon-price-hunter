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
- `api/_lib/legacy.mjs` ainda tenta o raw da `main` quando o ramo `data` falha. Com o banco em dia, campos que só o robô
  tem (pistas, reputação, atividade, menor preço histórico, média de mercado) podem vir da cópia de 07/10 por baixo dos
  preços do banco. Proposta: aceitar o raw da `main` só se `classify(stateDataAt(st))` não for `indisponivel`.
- Aba aberta por mais de 24 h sem conseguir atualizar continua mostrando "Ao vivo" (decisão de 17/10). Mudar o texto da
  barra para o caso `indisponivel` exige aprovação do dono.
