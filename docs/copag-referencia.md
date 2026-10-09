# Preço sugerido Copag — política única (Lote 5)

## Regra

Um produto só tem **Copag confirmado** (`copagConfirmed: true`, `msrp`) quando as quatro condições valem. A mesma regra vale no site/API, no robô e na view do motor (migration 010).

1. **Valor > 0.**
2. **Fonte oficial da Copag**: URL `http(s)` em `copagloja.com.br` ou `copag.com.br` (e subdomínios), marcada como oficial na origem.
   - Robô: `confidence: 'OFICIAL'`. Vale para a captura da loja oficial (`data/copag-msrp.json`) e para o cadastro manual no `config/catalog.json`.
   - Banco: linha `verified` com `source` `copag_loja` ou `manual`.
3. **Última verificação há no máximo 30 dias** em relação ao momento da rodada (robô) ou da consulta (API). A data usada é a mais recente entre `verified_at`, `source_timestamp`, `msrp_updated_at` e `last_check.at`, esta só quando a conferência diária (`copag-check`) bateu. Exatamente 30 dias ainda vale; 30 dias + 1 ms já está vencido. A constante e a conta são as do motor (`COPAG_MAX_AGE_DAYS` e `copagExpired` em `api/_lib/references.mjs`, PR #10); a política importa as duas, não há um segundo 30.
4. **A fonte é do mesmo produto.** Se a fonte traz EAN e o produto tem EAN no `catalog.json`, eles precisam bater (zeros à esquerda ignorados, como no matching). Fonte com EAN de outro produto nem entra na disputa: não vira preço nem referência. A captura da loja oficial passa a guardar o EAN que a loja mostrou (`ean` em `data/copag-msrp.json`); captura antiga sem EAN não é barrada.

Se uma das condições falha, o valor aparece só como referência (`copagReference`, `copagReferenceUrl`), e o motivo vai em `copagReason`. Nesse caso o produto não tem desconto Copag, não entra na regra `copag-25` e não dispara pista.

Estados possíveis em `copagReferenceStatus`:

| Estado | Quando |
|---|---|
| `confirmado` | As quatro condições valem. |
| `expirado` | A fonte é oficial, mas a verificação tem mais de 30 dias. |
| `pendente` | Sem fonte, fonte fora do domínio da Copag, sem marcação oficial, sem data ou com data no futuro (mais de 1 dia). |
| `null` | Não existe valor nenhum, a fonte é um marketplace ou a fonte tem EAN de outro produto. |

**Sem lista de produtos travados.** A versão anterior deste lote travava `me04-box36` por nome. Saiu: o produto fica sem Copag oficial porque hoje não há evidência suficiente, e a mesma regra vale para qualquer produto.

- O anúncio dele na loja oficial mostra o EAN `0196214156081` (catálogo público). O cadastro e a página do produto têm `0196214156098`. O matching recusa o anúncio ("EAN diverge do catálogo"), então o robô não tem captura. Se tivesse, a regra 4 a descartaria.
- O preço 449,99 só existe na auditoria (`copag_loja_catalog`, catálogo público da loja; a página esgotada não mostra preço). A auditoria sozinha não vira Copag oficial em lugar nenhum (ver a view do motor, abaixo).
- Libera com evidência: cadastro manual no `catalog.json` com URL oficial da Copag e data de verificação (o banco grava como `manual`), ou a loja passar a mostrar o anúncio com o EAN do cadastro.

O produto continua no catálogo, com ofertas e nota (referência de mercado).

**Os 11 produtos do Instagram** (tabela "Preços de 30 anos", cadastrada como OFICIAL à mão) ficam pendentes sem exceção: fonte fora do domínio da Copag. Voltam a oficial só com evidência verificável da loja oficial ou de outra fonte que a política aceite. Teste: `test/data-quality-tests.js`, grupo 5b.

## Onde está

- **Implementação:** `api/_lib/copag-policy.mjs`. Fica em `api/_lib` porque a Vercel não publica `src/`.
- **Robô:** `src/copag-policy.js` só reexporta o módulo (mesmo padrão de `src/core/references.js`). Ele é usado por:
  - `src/run.js`, em `resolveCopag`, que monta os candidatos na ordem cadastro OFICIAL › captura da loja › demais cadastros e fica com o primeiro confirmado. Sem confirmado, usa o primeiro expirado e, sem expirado, o primeiro pendente. Candidatos com EAN de outro produto ficam de fora;
  - `src/score.js` (`copagStatus`);
  - `src/copag-check.js`, que agora confere toda fonte oficial da Copag, mesmo vencida, porque a conferência que bate é o que renova a validade.
- **API:** `api/_lib/read-db.mjs` (home e página de produto pelo banco). O SQL só traz as linhas candidatas, das fontes que o robô publica (`copag_loja`, `manual`, `internet`). Quem decide é `decideCopagFromRows`, com a ordem `manual` › `copag_loja` › `internet` e, dentro dela, a verificação mais recente.
- **Sincronização:** `src/core/mappers.js` grava `verified_at` com a data de verificação decidida pela política (`copagVerifiedAt`), para que a API calcule a mesma validade.
- **Motor:** a view `reference_price_current` (migration 010) aplica as mesmas fontes, domínio e validade. Ver a seção da view.
- **Paridade:** `test/data-quality-tests.js`, grupo 7, roda 8 cenários × 6 momentos. Primeiro a rodada grava as linhas com o mapeamento real da sincronização; depois a API lê essas linhas e o robô decide com as mesmas fontes. O resultado precisa ser igual em estado, valor, referência e motivo. O grupo 11 faz a mesma conferência no PostgreSQL, incluindo a view do motor. `test/reference-evidence-db-tests.js` confere a paridade view × política cenário a cenário.

**Limitação conhecida.** Se uma fonte oficial já está vencida na primeira sincronização, o banco só recebe a linha pendente (`internet`). Nesse caso a API mostra `pendente` e o robô mostra `expirado`. O valor e a ausência de confirmação são os mesmos nos dois.

## Impacto nos dados reais

Base: branch `data`, `state.json` de 2026-10-09T19:30:29Z (243 produtos), `copag-msrp.json` (13 capturas) e `config/catalog.json` de `main` (12 cadastros OFICIAL, todos do Instagram, e 1 CATALOGO_COPAG). Cálculo feito com o momento da própria rodada.

| | Antes | Depois |
|---|---|---|
| Produtos com Copag confirmado | **24** | **13** |
| Ofertas elegíveis a alerta com Copag (de 497) | 198 | 140 |
| Ofertas na regra `copag-25` (≥ 25%) | 6 | 6 (as mesmas: blisters quádruplos me03/me04/me05) |

**Perdem a confirmação (11), por fonte fora do domínio oficial.** Os 11 vinham da tabela "Preços de 30 anos" divulgada no Instagram, cadastrada como OFICIAL à mão em 07/10/2026. O valor continua visível como referência pendente:
`c30-colecao_fichario` 230,99 · `c30-etb` 399,99 · `c30-blister3` 99,99 · `c30-combo` 199,99 · `c30-combo6` 199,99 · `c30-minilata` 77,99 · `c30-colecao` 599,99 · `c30-colecao_miniatura` 245,99 · `c30-colecao_ex-greninja` / `-estampas` / `-sylveon` 160,99.

**Continuam confirmados, mas com outra fonte (2).** `c30-blister2` (69,99) e `c30-colecao_poster` (115,99) deixam a fonte do Instagram e passam à captura da loja oficial, com o mesmo valor. Essas capturas foram vistas pela última vez em 08/10 e vencem em **07/11/2026** se a loja não as mostrar de novo.

**Sem mudança (11).** Capturas da loja oficial vistas na rodada (`me03-blister4`, `me04-blister1/3/4`, `me04-etb`, `me04-combo`, `me05-blister1/4`, `me05-etb`, `me05-combo`, `sv10-box36`). Vencem em 08/11/2026 se não forem vistas de novo.

**Por motivo:** expirado = 0 hoje; fonte não oficial = 11. `me04-box36` não tem valor no robô (sem captura, ver acima) e continua sem Copag oficial.

## View do motor `reference_price_current`: migration 010

> **Atenção: o merge deste ramo na `main` aplica a 010 no banco de produção.** O `hunter.yml` roda `node tools/db-migrate.mjs` a cada rodada do robô; a primeira rodada depois do merge aplica a migration e recalcula as notas. Não há passo manual nem como "segurar" a migration depois do merge. O número é 010 porque a `main` já tem a `009_review_resolution.sql` (PR #7).

**Antes (migration 006):** a view aceitava qualquer linha `current` verificada, sem prazo, sem olhar a fonte. Por isso o motor usava a auditoria (`copag_loja_catalog`) como Copag oficial: `me04-box36` (449,99) e `me05-blister3` (42,99), que o site não mostra.

**Depois (`db/migrations/010_reference_evidence.sql`):** uma linha `COPAG_OFFICIAL_CURRENT` só entra com:

- `verification_status = 'verified'` e valor > 0;
- fonte `copag_loja` (captura da loja gravada pelo robô) ou `manual`. A auditoria (`copag_loja_catalog`) continua gravada e serve à auditoria e à validação, mas sozinha não entra;
- URL no domínio da Copag;
- verificação há no máximo 30 dias, e no máximo 1 dia no futuro, medidos contra o `asOf` da rodada. O Price Engine grava esse `asOf` em `hunter.as_of` (`set_config` local à transação), o mesmo que o `resolveCurrentReference` usa. Sem ele, a view usa `now()`.

Mercado atual não muda. Nada é apagado nem alterado: só a view é recriada (`CREATE OR REPLACE`, mesmas colunas). A migration pode ser reaplicada sem efeito. Não há produto citado por nome.

Testes: `test/reference-evidence-db-tests.js` (PostgreSQL, 9 grupos). Aplica 001–009 num banco limpo e confere os cenários antes e depois da 010:

| Cenário | Antes | Depois |
|---|---|---|
| verificada há 2 dias e há 29,99 dias | entra | entra |
| verificada há 31 dias | entra | não |
| verificada com data 3 dias no futuro | entra | não |
| fonte `internet` com URL da Copag | entra | não |
| só auditoria (`copag_loja_catalog`) | entra | não |
| `me04-box36` só na auditoria | entra | não |
| `me04-box36` com cadastro manual, URL Copag, verificado | — | entra |
| Instagram (comunitária) | não | não |
| valor 0 ou Copag fora do domínio | o banco recusa a linha | idem |

Também confere:
- nenhuma linha de `product`/`reference_price` alterada;
- 010 aplicada duas vezes;
- paridade view × `decideCopagFromRows` em todos os cenários;
- mesma lista de fontes (`DB_OFFICIAL_SOURCES`) e mesmo prazo nos dois lados;
- Price Engine lendo a view.

### Impacto medido (sem banco de produção)

Base: banco local reconstruído do ramo `data` público (commit `c153c90`, `state.json` de 2026-10-08T16:29Z, 236 produtos, 948 ofertas), pelo fluxo de `docs/backup.md` (Lote 4): `db-migrate` → `db-grants` → `db-sync` → `db-import-references` → `db-stats` → `db-opportunity`. Primeiro com 001–009, depois com a 010 aplicada pelo `db-migrate`. Notas comparadas com `tools/opportunity-snapshot.mjs` e `tools/opportunity-diff.mjs`. `tools/db-validate.mjs` passou (75 verificações OK) com a 010.

**Só a 010 (mesmos dados):**

- Copag na view: **13 → 11**. Saem `me04-box36` (449,99) e `me05-blister3` (42,99), ambos só da auditoria. Os dois passam a usar o mercado atual robusto: 427,40 e 39,99. Nenhum produto fica sem referência.
- Ofertas avaliadas: 912. Mudaram de nota: **38** (todas desses 2 produtos; 13 subiram, 25 desceram; 24 mudaram mais de 5 pontos, 4 mais de 10, nenhuma mais de 25). A confiança mudou em 40 (Copag → mercado: 0,77–0,95 → 0,60–0,76).
- Faixas: 2 `boa → normal` (`me04-box36` gorupa 379,05: 78 → 69; `me05-blister3` omniverse 32,46: 82 → 70) e 2 `normal → baixa` (`me04-box36` Mercado Livre 419: 51 → 47; `me05-blister3` lojabrmetaverso 37: 56 → 47). A melhor de `me05-blister3` (Mercado Livre 31,83) continua `boa` (88 → 76).
- Eventos na rodada: 1 `OPPORTUNITY_EXPIRED`, 1 `OPPORTUNITY_CHANGED`.
- Nenhuma linha de `reference_price` mudou (mesmo hash antes e depois; 84 linhas, 236 produtos).

**Junto com o robô deste lote (o merge leva os dois):** o robô passa a gravar `copag_loja` para `c30-blister2` (69,99) e `c30-colecao_poster` (115,99), porque o cadastro do Instagram deixa de ter prioridade sobre a captura. Recalculando o `state.json` com a política nova e sincronizando:

- Copag na view: **13** (11 + esses 2).
- Esses 2 ganham Copag no motor: mais 28 notas mudam, todas para baixo (17 mais de 10 pontos) e 5 `normal → baixa`.
- Total contra hoje: **66 notas mudam em 4 produtos**: 7 `normal → baixa`, 2 `boa → normal`, confiança em 71.

**Datas:**
- as capturas da loja vistas em 08/10 vencem em **07/11/2026** se a loja não as mostrar de novo (a rodada renova a data a cada leitura);
- a auditoria não renova data, mas já não entra.

**Riscos e conferências:**
- O PR muda notas em produção na primeira rodada após o merge. Conferir no mesmo dia `tools/db-validate.mjs` (a regra "Copag atual ⇔ linha em `reference_price_current`" continua valendo) e comparar as notas com `tools/opportunity-snapshot.mjs` antes e depois.
- Reverter = nova migration recriando a view da 006. Nenhum dado se perde em nenhum dos sentidos.
- Empate entre `manual` e `copag_loja` válidos com valores diferentes no mesmo produto: a view desempata por confiança e data (como antes) e a API prefere `manual`. Hoje não existe esse caso nos dados.

## Outros itens do Lote 5 (mesma base de dados)

- **Lojas.** Para cada loja passa a existir o campo derivado `yield` em `sources`, mais o contador `emptyStreak`. O `status` não mudou. Totais novos em `state.coverage.yield` e em `meta.json → ops.last.stores.yield`.
  - Distribuição das 128 lojas: 56 `nunca_funcionou` (54 BLOCKED + 2 ERROR, ok = 0, entre 63 e 196 tentativas cada), 4 `sem_match` (bynx.gg, tcgculture.com, kantonerd.com.br, shisuistore.com.br), 50 `ok` e 18 fora da coleta.
  - As 22 ativas sem anúncio passam a `sem_resultado` depois de 3 leituras vazias seguidas (o contador começa no deploy).
  - Espera máxima das lojas `nunca_funcionou`: 24 h em vez de 6 h, o que dá cerca de 56 tentativas por dia em vez de ~224. Nenhuma loja ou contador é apagado.
- **Mercado Livre.** O `/items` está fechado para o app, então as **282 ofertas** do ML (252 elegíveis a alerta) passam a ter `stockVerified: false`. O alerta mostra "Estoque: não conferido (anúncio do Mercado Livre)" em vez de "confirmado". A elegibilidade não muda. O campo fica só no `state.json`/`offers.json`: a tabela `offer` não tem coluna para ele e nenhuma migration foi criada.
